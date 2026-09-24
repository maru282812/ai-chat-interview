/**
 * retailSurveySeed.test.ts
 *
 * 小売店 A/B/C の seed（scripts/seedRetailSurveyProjects.mjs）と
 * 業種テンプレ（scripts/seedRetailIndustryTemplate.mjs）の不変条件を守る。
 *
 * なぜ seed にテストを書くか:
 *   seed はコードではなく「データ」なので typecheck が効かない。しかし壊れ方は
 *   静かで、本番に投入して初めて分かる。過去に同型の事故が複数回起きている。
 *     - 選択肢の value がラベルで作り直されて表示条件が全滅した
 *     - 頻度設問の value が引けず C の送付日が既定値に落ちた
 *     - 開示設問の notice と画面文言がズレた（利用規約 第9条3項の説明がつかない）
 *
 * ここで守りたいこと:
 *   1. UUID が hex として妥当（"retail" を字面で入れると Postgres に弾かれる）
 *   2. A-Q7 の value と業種テンプレの日数表キーが1対1（片方だけ直すと頻度が引けない）
 *   3. 開示設問の helpText と share_with_store.notice が同一（利用規約 第9条3項）
 *   4. 表示条件・disableRules の参照先が実在する
 *   5. 小売固有の設計判断（未購入者の分岐・ネット通販の離脱先）が壊れていない
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

const SEED_PATH = path.join(process.cwd(), "scripts", "seedRetailSurveyProjects.mjs");
const TEMPLATE_PATH = path.join(process.cwd(), "scripts", "seedRetailIndustryTemplate.mjs");

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
type Project = {
  id: string;
  entry_code: string;
  carry_forward_sources?: { namespace: string; entry_code: string }[] | null;
};

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
const valuesOf = (q: Question): string[] =>
  (q.question_config.options ?? []).map((o: Option) => o.value);

// ------------------------------------------------------------------

test("案件の UUID が hex として妥当（retail を字面で入れると Postgres に弾かれる）", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const p of seed.projects) {
    assert.match(p.id, UUID, `${p.entry_code} の id が UUID として不正`);
  }
  assert.equal(seed.projects.length, 3);
});

test("他業種の seed と案件IDが衝突しない（上書き事故の防止）", () => {
  const others = [
    "seedSalonSurveyProjects.mjs",
    "seedNailSurveyProjects.mjs",
    "seedRestaurantSurveyProjects.mjs",
    "seedAcupunctureSurveyProjects.mjs"
  ];
  for (const file of others) {
    const src = readFileSync(path.join(process.cwd(), "scripts", file), "utf8");
    for (const p of seed.projects) {
      assert.ok(!src.includes(p.id), `${p.id} が ${file} と重複している`);
    }
  }
});

test("question_code が案件ごとに一意で、sort_order が 1..n の連番", () => {
  for (const [name, qs] of [
    ["A", seed.questionsA],
    ["B", seed.questionsB],
    ["C", seed.questionsC]
  ] as const) {
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
  for (const [name, qs] of [
    ["A", seed.questionsA],
    ["B", seed.questionsB],
    ["C", seed.questionsC]
  ] as const) {
    const have = new Set(qs.map((q) => q.question_code.toLowerCase()));
    for (const q of qs) {
      for (const cond of q.visibility_conditions ?? []) {
        // `a:q5` のような名前空間付き参照は別案件（A）を指すので対象外
        const expression = cond.expression.replace(/\ba:q\d+\b/g, "");
        for (const ref of expression.matchAll(/\bq(\d+)\b/g)) {
          assert.ok(
            have.has(`q${ref[1]}`),
            `${name}-${q.question_code}: 表示条件が存在しない q${ref[1]} を参照`
          );
        }
      }
    }
  }
});

test("表示条件が参照する選択肢 value が参照先の設問に実在する", () => {
  // `q1!=not_bought` の not_bought が B-Q1 に無ければ、条件が常に真になって
  // 未購入者にもマトリクスが出る（静かに壊れる）。
  for (const [name, qs] of [
    ["A", seed.questionsA],
    ["B", seed.questionsB],
    ["C", seed.questionsC]
  ] as const) {
    const byLower = new Map(qs.map((q) => [q.question_code.toLowerCase(), q]));
    for (const q of qs) {
      for (const cond of q.visibility_conditions ?? []) {
        const expression = cond.expression.replace(/\ba:q\d+[!=]=?\w+/g, "");
        for (const m of expression.matchAll(/\b(q\d+)(?:!=|=)(\w+)/g)) {
          const target = byLower.get(m[1] ?? "");
          if (!target) continue;
          assert.ok(
            valuesOf(target).includes(m[2] ?? ""),
            `${name}-${q.question_code}: 表示条件の ${m[1]}=${m[2]} が参照先の選択肢に無い`
          );
        }
      }
    }
  }
});

test("B-Q3/Q4/Q5 が ASPECTS を共有する（B内の持ち越しの前提）", () => {
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));

  const rows = new Set(
    (byCode(seed.questionsB, "Q3").question_config.matrix_rows ?? []).map((r: Option) => r.value)
  );
  assert.deepEqual([...rows].sort(), [...aspects].sort(), "B-Q3 の matrix_rows が ASPECTS と不一致");

  for (const code of ["Q4", "Q5"]) {
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
      assert.ok(
        own.has(rule.targetChoice),
        `C-${q.question_code}: targetChoice ${rule.targetChoice} が選択肢に無い`
      );
      for (const m of String(rule.condition).matchAll(/a:q5 includes (\w+)/g)) {
        const purpose = m[1] ?? "";
        assert.ok(aq5.has(purpose), `C-${q.question_code}: a:q5 の value ${purpose} が A-Q5 に無い`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 0, "disableRules が1件も無い（来店目的の絞り込みが効いていない）");
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
  assert.equal(disclosed, 2, "開示設問は A-Q8（声かけ希望）と A-Q9（伝えたいこと）の2件のはず");
});

test("自由記述の開示設問は任意回答（強制すると書きたくない人が詰まる）", () => {
  const q9 = byCode(seed.questionsA, "Q9");
  assert.equal(q9.question_type, "free_text_long");
  assert.equal(q9.is_required, false);
});

test("A-Q7 の value と業種テンプレの日数表キーが1対1で一致する", () => {
  // 片方だけ直すと頻度が引けず、C の送付日が undecided_days に落ちる。
  const table = templateSrc.match(/RETAIL_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(table, "RETAIL_FREQUENCY_DAYS が見つかりません");

  const keys = [...(table[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((m) => m[1] ?? "").sort();
  const values = valuesOf(byCode(seed.questionsA, "Q7"))
    .filter((v) => v !== "undecided") // undecided は日数表ではなく undecided_days で扱う
    .sort();

  assert.deepEqual(keys, values, "A-Q7 の value と日数表のキーがズレている");
  assert.ok(!keys.includes("undecided"), "undecided を日数表に入れてはいけない");
});

test("業種テンプレの frequency_question_code が A に実在し、来店回数の設問ではない", () => {
  const code = templateSrc.match(/frequency_question_code: "(\w+)"/)?.[1];
  assert.ok(code, "frequency_question_code が見つかりません");
  const target = seed.questionsA.find((q) => q.question_code === code);
  assert.ok(target, `frequency_question_code=${code} が A に存在しない`);

  // ⚠ A-Q4（来店回数）を頻度設問と混同すると、送付日が「1回目/2回目」で
  //   決まることになり日数表が一切引けなくなる。
  assert.notEqual(code, "Q4", "A-Q4 は来店回数であって頻度設問ではない");
  const vals = valuesOf(target!);
  assert.ok(vals.includes("undecided"), "頻度設問に「特に決まっていない」が無い");
});

test("小売の来店頻度が週単位から年単位まで広く取られている", () => {
  // 日用品（週数回）とアパレル・家電（年数回）が同じテンプレートに乗るため。
  // ⚠ ファイル全体から数値を拾うと followup_b_delay_minutes(120) 等まで混ざる。
  //   頻度表のブロック内だけを見る。
  const block = templateSrc.match(/RETAIL_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(block, "RETAIL_FREQUENCY_DAYS が見つかりません");
  const days = [...(block[1] ?? "").matchAll(/^\s*\w+: (\d+),?/gm)].map((m) => Number(m[1]));
  assert.ok(days.length >= 6, "日数表の件数が足りません");
  assert.ok(Math.min(...days) <= 7, "最短が1週間より長い（日用品の来店周期を拾えない）");
  assert.ok(Math.max(...days) >= 300, "最長が短すぎる（アパレル・家電の年単位を拾えない）");

  const cooldown = Number(templateSrc.match(/restart_cooldown_days: (\d+)/)?.[1]);
  // 美容室25日・ネイル14日だと小売の正常な再来店（週数回）を取りこぼす。
  assert.ok(cooldown <= 7, `restart_cooldown_days=${cooldown} では小売の再来店を取りこぼす`);
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

test("店内環境の設問がマトリクスではなく独立設問になっている", () => {
  // matrix_single は 1行=1画面で出るため、行を足すと画面数がそのまま増える。
  // BGM・照明・空調は5段階満足度では分散が出ないので「気づかれたか」を聞く。
  const rows = new Set(
    (byCode(seed.questionsB, "Q3").question_config.matrix_rows ?? []).map((r: Option) => r.value)
  );
  for (const banned of ["bgm", "lighting", "temperature", "scent", "fitting"]) {
    assert.ok(!rows.has(banned), `B-Q3 のマトリクスに ${banned} が入っている（画面数が膨らむ）`);
  }

  const q7 = byCode(seed.questionsB, "Q7");
  assert.equal(q7.question_type, "multi_choice", "B-Q7 は複数選択のはず");
  for (const expected of ["bgm", "lighting", "temperature", "signage", "fitting"]) {
    assert.ok(valuesOf(q7).includes(expected), `B-Q7 に ${expected} が無い`);
  }
});

// ------------------------------------------------------------------
// 小売固有の設計判断（冒頭コメント2・4）
// ------------------------------------------------------------------

test("未購入者に満足度マトリクスを出さない（neutral の量産で購入者の満足度が薄まる）", () => {
  // ⚠ ここが小売版の要点。分岐を外すと「価格への納得感」を買っていない人が
  //   neutral で埋め、B-Q3 の平均が動かなくなる。
  const q1 = byCode(seed.questionsB, "Q1");
  assert.ok(valuesOf(q1).includes("not_bought"), "B-Q1 に「何も買わなかった」が無い");

  for (const code of ["Q3", "Q4", "Q5"]) {
    const q = byCode(seed.questionsB, code);
    const expressions = (q.visibility_conditions ?? []).map((c) => c.expression).join(" ");
    assert.ok(
      expressions.includes("q1!=not_bought"),
      `B-${code} に未購入者を除く表示条件が無い（満足度が薄まる）`
    );
  }
});

test("未購入理由の設問が未購入・一部購入者にだけ出る", () => {
  // 「買わずに出た人」の理由は小売で最も改善余地の大きい情報。
  // 逆に全員に出すと、買えた人に「なぜ買わなかったか」を聞くことになる。
  for (const code of ["Q10", "Q11", "Q12"]) {
    const q = byCode(seed.questionsB, code);
    const expressions = (q.visibility_conditions ?? []).map((c) => c.expression).join(" ");
    assert.ok(
      expressions.includes("q1=not_bought"),
      `B-${code} が未購入者に限定されていない`
    );
    assert.ok(
      expressions.includes("q1=bought_partly"),
      `B-${code} が一部購入者を拾っていない（買えなかったものがあるのに聞けない）`
    );
  }

  // 欠品・未取扱いは発注改善に直結する選択肢なので必ず残す
  const q10 = valuesOf(byCode(seed.questionsB, "Q10"));
  for (const expected of ["out_of_stock", "not_carried", "too_expensive", "could_not_find"]) {
    assert.ok(q10.includes(expected), `B-Q10 に ${expected} が無い`);
  }
});

test("C にネット通販への離脱先がある（無いと離脱理由が価格・距離に流れ込む）", () => {
  // 小売は他業種と違い最大の競合がネット通販。実店舗の選択肢しか用意しないと
  // 離脱先が見えず、改善の打ち手が店内改善に偏る。
  const q6 = valuesOf(byCode(seed.questionsC, "Q6"));
  assert.ok(q6.includes("online"), "C-Q6 にネット通販の選択肢が無い");

  const q7 = valuesOf(byCode(seed.questionsC, "Q7"));
  assert.ok(q7.includes("online"), "C-Q7 にネット通販の選択肢が無い");

  const q9 = valuesOf(byCode(seed.questionsC, "Q9"));
  assert.ok(q9.includes("price_online"), "C-Q9 に「他店・ネットの方が安かった」が無い");
  assert.ok(q9.includes("convenience_online"), "C-Q9 にネットの利便性の選択肢が無い");
  assert.ok(q9.includes("out_of_stock"), "C-Q9 に欠品の選択肢が無い");
});

test("C-Q9（離反理由）の表示条件がネット通販の離脱層を取りこぼさない", () => {
  // ⚠ q6=other_store だけ見ていると、ネットに流れた層に離反理由を聞けない。
  const expression = (byCode(seed.questionsC, "Q9").visibility_conditions ?? [])
    .map((c) => c.expression)
    .join(" ");
  for (const needed of ["q6=online", "q7=online", "q6=other_store", "q7=other_store"]) {
    assert.ok(expression.includes(needed), `C-Q9 の表示条件に ${needed} が無い`);
  }
});

test("小売固有の評価軸が入り、他業種固有の軸が残っていない", () => {
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));
  for (const required of ["lineup", "stock", "findability", "checkout", "layout"]) {
    assert.ok(aspects.has(required), `ASPECTS に ${required} が無い`);
  }
  for (const foreign of ["skill", "trouble", "home_styling", "taste", "portion", "durability"]) {
    assert.ok(!aspects.has(foreign), `ASPECTS に他業種固有の ${foreign} が残っている`);
  }
});

test("A が入店直後に収まる長さ（設問を増やすと A の完了率が落ちてサイクルごと消える）", () => {
  // A で完了しないと B も C も紐づかない。小売は待ち時間という概念が無いため
  // 飲食（11問）よりさらに短く保つ。
  assert.ok(
    seed.questionsA.length <= 10,
    `A が ${seed.questionsA.length} 問ある（入店直後には長すぎる）`
  );
  // ただし頻度設問は削れない（削ると C の送付日が決まらない）
  assert.ok(
    seed.questionsA.some((q) => valuesOf(q).includes("weekly_plus")),
    "A に頻度設問が無い（C の送付日が決まらない）"
  );
});
