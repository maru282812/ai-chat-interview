/**
 * nailSurveySeed.test.ts
 *
 * ネイルサロン A/B/C の seed（scripts/seedNailSurveyProjects.mjs）と
 * 業種テンプレ（scripts/seedNailIndustryTemplate.mjs）の不変条件を守る。
 *
 * なぜ seed にテストを書くか:
 *   seed はコードではなく「データ」なので typecheck が効かない。しかし壊れ方は
 *   静かで、本番に投入して初めて分かる。過去に同型の事故が複数回起きている。
 *     - 選択肢の value がラベルで作り直されて表示条件が全滅した
 *     - A-Q11 の頻度が引けず C の送付日が既定値に落ちた
 *     - 開示設問の notice と画面文言がズレた（利用規約 第9条3項の説明がつかない）
 *
 * ここで守りたいこと:
 *   1. UUID が hex として妥当（"nail" を字面で入れると Postgres に弾かれる）
 *   2. carry-forward は value 一致が前提 — 参照元と参照先の value が揃っている
 *   3. A-Q11 の value と業種テンプレの日数表キーが1対1（片方だけ直すと頻度が引けない）
 *   4. 開示設問の helpText と share_with_store.notice が同一（利用規約 第9条3項）
 *   5. 表示条件・disableRules の参照先が実在する
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

const SEED_PATH = path.join(process.cwd(), "scripts", "seedNailSurveyProjects.mjs");
const TEMPLATE_PATH = path.join(process.cwd(), "scripts", "seedNailIndustryTemplate.mjs");

type Option = { value: string; label: string; exclusive?: boolean };
type Question = {
  question_code: string;
  question_type: string;
  sort_order: number;
  is_required: boolean;
  question_config: Record<string, any>;
  visibility_conditions?: { type: string; expression: string }[] | null;
  display_tags_parsed?: Record<string, any>;
};
type Project = { id: string; entry_code: string; carry_forward_sources?: { namespace: string; entry_code: string }[] | null };

/**
 * seed は import すると main() が走って本番DBに触れてしまう。
 * 実行部を落としたうえでデータ定義だけを評価する。
 */
async function loadSeed(): Promise<{
  projects: Project[];
  questions: Question[];
  questionsA: Question[];
  questionsB: Question[];
  questionsC: Question[];
  ASPECTS: [string, string][];
}> {
  const body = readFileSync(SEED_PATH, "utf8")
    .replace(/^import .*$/gm, "")
    .replace(/loadDotEnv\(\);/, "")
    .replace(/const url = [\s\S]*?auth: \{ persistSession: false \} \}\);/, "")
    .replace(/main\(\)\.catch[\s\S]*$/, "")
    .replace(/async function main\(\)[\s\S]*?\n\}\n/, "")
    .replace(/async function cleanup\(\)[\s\S]*?\n\}\n/, "");

  const exports_ = "\nexport { projects, questions, questionsA, questionsB, questionsC, ASPECTS };";
  const encoded = Buffer.from(body + exports_, "utf8").toString("base64");
  return (await import(`data:text/javascript;base64,${encoded}`)) as any;
}

// tsx は CJS へ変換するためトップレベル await が使えない。before で読み込む。
let seed: Awaited<ReturnType<typeof loadSeed>>;
const templateSrc = readFileSync(TEMPLATE_PATH, "utf8");

before(async () => {
  seed = await loadSeed();
});

const byCode = (qs: Question[], code: string) => {
  const q = qs.find((x) => x.question_code === code);
  assert.ok(q, `設問 ${code} が見つかりません`);
  return q!;
};
const valuesOf = (q: Question): string[] => (q.question_config.options ?? []).map((o: Option) => o.value);

// ------------------------------------------------------------------

test("案件の UUID が hex として妥当（nail を字面で入れると Postgres に弾かれる）", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const p of seed.projects) {
    assert.match(p.id, UUID, `${p.entry_code} の id が UUID として不正`);
  }
  assert.equal(seed.projects.length, 3);
});

test("美容室 seed と案件IDが衝突しない（上書き事故の防止）", () => {
  const salon = readFileSync(path.join(process.cwd(), "scripts", "seedSalonSurveyProjects.mjs"), "utf8");
  for (const p of seed.projects) {
    assert.ok(!salon.includes(p.id), `${p.id} が美容室 seed と重複している`);
  }
});

test("question_code が案件ごとに一意で、sort_order が 1..n の連番", () => {
  for (const [name, qs] of [["A", seed.questionsA], ["B", seed.questionsB], ["C", seed.questionsC]] as const) {
    const codes = qs.map((q) => q.question_code);
    assert.equal(new Set(codes).size, codes.length, `${name}: question_code が重複`);
    assert.deepEqual(
      qs.map((q) => q.sort_order),
      qs.map((_, i) => i + 1),
      `${name}: sort_order が連番でない`
    );
  }
});

test("表示条件が参照する設問コードが同じ案件に実在する", () => {
  for (const [name, qs] of [["A", seed.questionsA], ["B", seed.questionsB], ["C", seed.questionsC]] as const) {
    const have = new Set(qs.map((q) => q.question_code.toLowerCase()));
    for (const q of qs) {
      for (const cond of q.visibility_conditions ?? []) {
        for (const ref of cond.expression.matchAll(/\bq(\d+)\b/g)) {
          assert.ok(
            have.has(`q${ref[1]}`),
            `${name}-${q.question_code}: 表示条件が存在しない q${ref[1]} を参照`
          );
        }
      }
    }
  }
});

test("A-Q10 の選択肢が A-Q9 に完全に含まれる（carry-forward は value 一致が前提）", () => {
  const q10 = byCode(seed.questionsA, "Q10");
  const source = q10.display_tags_parsed?.optionSource;
  assert.equal(source?.fromQuestion, "q9", "A-Q10 の optionSource が A-Q9 を指していない");

  const q9values = new Set(valuesOf(byCode(seed.questionsA, "Q9")));
  for (const v of valuesOf(q10)) {
    assert.ok(q9values.has(v), `A-Q10 の選択肢 ${v} が A-Q9 に無い（持ち越しで消える）`);
  }
});

test("B-Q2/Q3/Q4 が ASPECTS を共有する（B内の持ち越しの前提）", () => {
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));

  const rows = new Set(
    (byCode(seed.questionsB, "Q2").question_config.matrix_rows ?? []).map((r: Option) => r.value)
  );
  assert.deepEqual([...rows].sort(), [...aspects].sort(), "B-Q2 の matrix_rows が ASPECTS と不一致");

  for (const code of ["Q3", "Q4"]) {
    const vals = new Set(valuesOf(byCode(seed.questionsB, code)));
    for (const v of aspects) {
      assert.ok(vals.has(v), `B-${code} に ASPECTS の ${v} が無い`);
    }
  }
});

test("C の disableRules が実在する選択肢と A-Q5 の value を参照する", () => {
  const aq5 = new Set(valuesOf(byCode(seed.questionsA, "Q5")));
  let checked = 0;

  for (const q of seed.questionsC) {
    const rules = q.display_tags_parsed?.disableRules ?? [];
    const own = new Set(valuesOf(q));
    for (const rule of rules) {
      assert.ok(own.has(rule.targetChoice), `C-${q.question_code}: targetChoice ${rule.targetChoice} が選択肢に無い`);
      for (const m of String(rule.condition).matchAll(/a:q5 includes (\w+)/g)) {
        const menu = m[1] ?? "";
        assert.ok(aq5.has(menu), `C-${q.question_code}: a:q5 の value ${menu} が A-Q5 に無い`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 0, "disableRules が1件も無い（メニュー絞り込みが効いていない）");
});

test("排他の「特になし」に exclusive が付いている", () => {
  for (const q of seed.questions) {
    const none = (q.question_config.options ?? []).find((o: Option) => o?.value === "none");
    if (!none) continue;
    assert.equal(none.exclusive, true, `${q.question_code}: none に exclusive が無い`);
  }
});

test("店舗開示設問の notice が画面の helpText と同一（利用規約 第9条3項）", () => {
  // 「回答画面上であらかじめ明示したうえで」が開示の条件なので、
  // 画面に出した文言と開示の根拠がズレると規約上の説明がつかなくなる。
  let disclosed = 0;
  for (const q of seed.questionsA) {
    const share = q.question_config.meta?.share_with_store;
    if (!share?.enabled) continue;
    assert.equal(
      share.notice,
      q.question_config.helpText,
      `A-${q.question_code}: helpText と share_with_store.notice が不一致`
    );
    assert.ok(share.notice.length > 0, `A-${q.question_code}: notice が空`);
    disclosed += 1;
  }
  assert.equal(disclosed, 2, "開示設問は A-Q12（会話量）と A-Q14（伝えたいこと）の2件のはず");
});

test("自由記述の開示設問は任意回答（強制すると書きたくない人が詰まる）", () => {
  const q14 = byCode(seed.questionsA, "Q14");
  assert.equal(q14.question_type, "free_text_long");
  assert.equal(q14.is_required, false);
});

test("A-Q11 の value と業種テンプレの日数表キーが1対1で一致する", () => {
  // 片方だけ直すと頻度が引けず、C の送付日が undecided_days に落ちる。
  const table = templateSrc.match(/NAIL_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(table, "NAIL_FREQUENCY_DAYS が見つかりません");

  const keys = [...(table[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((m) => m[1] ?? "").sort();
  const values = valuesOf(byCode(seed.questionsA, "Q11"))
    .filter((v) => v !== "undecided") // undecided は日数表ではなく undecided_days で扱う
    .sort();

  assert.deepEqual(keys, values, "A-Q11 の value と日数表のキーがズレている");
  assert.ok(values.includes("undecided") === false, "undecided を日数表に入れてはいけない");
});

test("業種テンプレの frequency_question_code が A に実在する", () => {
  const code = templateSrc.match(/frequency_question_code: "(\w+)"/)?.[1];
  assert.ok(code, "frequency_question_code が見つかりません");
  assert.ok(
    seed.questionsA.some((q) => q.question_code === code),
    `frequency_question_code=${code} が A に存在しない`
  );
});

test("ネイルの再来店周期が美容室より短く設定されている", () => {
  // ネイルは「爪が伸びてリフトする」トリガーで 3〜4週が実質固定。
  // 美容室の刻み（21/30/45/60/90/120）のままだと離脱判定がぼやける。
  // ⚠ ファイル全体から数値を拾うと followup_b_delay_minutes(120) 等まで混ざる。
  //   頻度表のブロック内だけを見る。
  const block = templateSrc.match(/NAIL_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(block, "NAIL_FREQUENCY_DAYS が見つかりません");
  const days = [...(block[1] ?? "").matchAll(/^\s*\w+: (\d+),/gm)].map((m) => Number(m[1]));
  assert.ok(days.length >= 6, "日数表の件数が足りません");
  assert.ok(Math.min(...days) <= 21, "最短が美容室（21日）より長い");
  assert.ok(Math.max(...days) <= 90, "最長が長すぎる（ネイルで120日は離脱確定）");

  const cooldown = Number(templateSrc.match(/restart_cooldown_days: (\d+)/)?.[1]);
  // 25日（美容室の既定）だとネイルの正常な再来店を「クールダウン中」と誤判定する。
  assert.ok(cooldown < 21, `restart_cooldown_days=${cooldown} ではネイルの再来店を取りこぼす`);
});

test("C の carry_forward_sources が実在する案件を指す", () => {
  const codes = new Set(seed.projects.map((p) => p.entry_code));
  let declared = 0;
  for (const p of seed.projects) {
    for (const s of p.carry_forward_sources ?? []) {
      assert.ok(codes.has(s.entry_code), `${p.entry_code}: 参照先 ${s.entry_code} が無い`);
      declared += 1;
    }
  }
  assert.equal(declared, 1, "C だけが A を参照するはず");
});

test("雰囲気・設備の設問がマトリクスではなく独立設問になっている", () => {
  // matrix_single は 1行=1画面で出るため、行を足すと画面数がそのまま増える。
  // 香り・BGM・照明は5段階満足度では分散が出ないので「気づかれたか」を聞く。
  const rows = new Set(
    (byCode(seed.questionsB, "Q2").question_config.matrix_rows ?? []).map((r: Option) => r.value)
  );
  for (const banned of ["scent", "bgm", "lighting", "equipment", "privacy"]) {
    assert.ok(!rows.has(banned), `B-Q2 のマトリクスに ${banned} が入っている（画面数が膨らむ）`);
  }

  const q8 = byCode(seed.questionsB, "Q8");
  assert.equal(q8.question_type, "multi_choice", "B-Q8 は複数選択のはず");
  for (const expected of ["scent", "bgm", "equipment", "hygiene", "privacy"]) {
    assert.ok(valuesOf(q8).includes(expected), `B-Q8 に ${expected} が無い`);
  }
});

test("C に担当者との相性の選択肢がある（無いと離脱理由が価格・距離に流れ込む）", () => {
  const q9 = valuesOf(byCode(seed.questionsC, "Q9"));
  assert.ok(q9.includes("person_mismatch"), "C-Q9 に担当者との相性が無い");
  assert.ok(q9.includes("atmosphere_mismatch"), "C-Q9 に雰囲気の不一致が無い");

  const q8 = valuesOf(byCode(seed.questionsC, "Q8"));
  assert.ok(q8.includes("nailist_person"), "C-Q8 に担当者の人柄が無い");
  assert.ok(q8.includes("atmosphere"), "C-Q8 に店の雰囲気が無い");
});

test("ネイル固有の評価軸が入り、美容室固有の軸が残っていない", () => {
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));
  for (const required of ["durability", "design", "nail_care"]) {
    assert.ok(aspects.has(required), `ASPECTS に ${required} が無い`);
  }
  for (const salonOnly of ["skill", "trouble", "home_styling"]) {
    assert.ok(!aspects.has(salonOnly), `ASPECTS に美容室固有の ${salonOnly} が残っている`);
  }
});
