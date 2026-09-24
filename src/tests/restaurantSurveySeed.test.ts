/**
 * restaurantSurveySeed.test.ts
 *
 * 飲食店 A/B/C の seed（scripts/seedRestaurantSurveyProjects.mjs）と
 * 業種テンプレ（scripts/seedRestaurantIndustryTemplate.mjs）の不変条件を守る。
 *
 * なぜ seed にテストを書くか:
 *   seed はコードではなく「データ」なので typecheck が効かない。しかし壊れ方は
 *   静かで、本番に投入して初めて分かる。過去に同型の事故が複数回起きている。
 *     - 選択肢の value がラベルで作り直されて表示条件が全滅した
 *     - A-Q11 の頻度が引けず C の送付日が既定値に落ちた
 *     - 開示設問の notice と画面文言がズレた（利用規約 第9条3項の説明がつかない）
 *
 * ここで守りたいこと:
 *   1. UUID が hex として妥当（"resto" を字面で入れると Postgres に弾かれる）
 *   2. A-Q11 の value と業種テンプレの日数表キーが1対1（片方だけ直すと頻度が引けない）
 *   3. 開示設問の helpText と share_with_store.notice が同一（利用規約 第9条3項）
 *   4. 表示条件・disableRules の参照先が実在する
 *   5. 飲食固有の設計判断（A の設問数・単一選択の A-Q5・短いクールダウン）が壊れていない
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

const SEED_PATH = path.join(process.cwd(), "scripts", "seedRestaurantSurveyProjects.mjs");
const TEMPLATE_PATH = path.join(process.cwd(), "scripts", "seedRestaurantIndustryTemplate.mjs");

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

test("案件の UUID が hex として妥当（resto を字面で入れると Postgres に弾かれる）", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const p of seed.projects) {
    assert.match(p.id, UUID, `${p.entry_code} の id が UUID として不正`);
  }
  assert.equal(seed.projects.length, 3);
});

test("美容室・ネイル seed と案件IDが衝突しない（上書き事故の防止）", () => {
  for (const other of ["seedSalonSurveyProjects.mjs", "seedNailSurveyProjects.mjs"]) {
    const src = readFileSync(path.join(process.cwd(), "scripts", other), "utf8");
    for (const p of seed.projects) {
      assert.ok(!src.includes(p.id), `${p.id} が ${other} と重複している`);
    }
  }
});

test("question_code が案件ごとに一意で、sort_order が 1..n の連番", () => {
  for (const [name, qs] of [
    ["A", seed.questionsA],
    ["B", seed.questionsB],
    ["C", seed.questionsC],
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
    ["C", seed.questionsC],
  ] as const) {
    const have = new Set(qs.map((q) => q.question_code.toLowerCase()));
    for (const q of qs) {
      for (const cond of q.visibility_conditions ?? []) {
        // `a:q5` のような名前空間付き参照は別案件なのでここでは見ない
        const expr = cond.expression.replace(/\ba:q\d+\b/g, "");
        for (const ref of expr.matchAll(/\bq(\d+)\b/g)) {
          assert.ok(
            have.has(`q${ref[1]}`),
            `${name}-${q.question_code}: 表示条件が存在しない q${ref[1]} を参照`
          );
        }
      }
    }
  }
});

test("A は配膳までの数分で終わる分量に収まっている（12問以下）", () => {
  // 飲食の A は着席から配膳までの短い空き時間で答えてもらう。ここが長いと
  // 料理が来た瞬間に離脱し、A が完了しないと B も C も紐づかない（サイクルごと消える）。
  assert.ok(
    seed.questionsA.length <= 12,
    `A が ${seed.questionsA.length} 問ある（配膳前に終わらない）`
  );
  // サロン版（14問）より短いことを明示的に守る
  const salon = readFileSync(
    path.join(process.cwd(), "scripts", "seedSalonSurveyProjects.mjs"),
    "utf8"
  );
  const salonACount = (salon.match(/q\(\s*P_A,/g) ?? []).length;
  assert.ok(
    seed.questionsA.length < salonACount,
    `A がサロン版(${salonACount}問)より短くない`
  );
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

test("B-Q2 のマトリクス行数が10行以下（1行=1画面で画面数が増える）", () => {
  const rows = (byCode(seed.questionsB, "Q2").question_config.matrix_rows ?? []).length;
  assert.ok(rows <= 10, `B-Q2 のマトリクスが ${rows} 行（画面数がそのまま増える）`);
});

test("A-Q9 は「待ち時間」を含まない（食事前に会計の待ち時間は評価できない）", () => {
  assert.ok(!valuesOf(byCode(seed.questionsA, "Q9")).includes("wait"), "A-Q9 に wait がある");
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
      for (const m of String(rule.condition).matchAll(/a:q5\s*(?:!=|=)\s*(\w+)/g)) {
        const scene = m[1] ?? "";
        assert.ok(aq5.has(scene), `C-${q.question_code}: a:q5 の value ${scene} が A-Q5 に無い`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 0, "disableRules が1件も無い（シーン絞り込みが効いていない）");
});

test("A-Q5 は単一選択で、disableRules は includes ではなく等号で比較している", () => {
  // ネイル版の A-Q5（メニュー）は multi_choice なので `includes` で書くが、
  // 飲食の A-Q5（利用シーン）は single_choice。`includes` のまま流用すると
  // 条件が常に偽になり、絞り込みが黙って全部効かなくなる。
  assert.equal(byCode(seed.questionsA, "Q5").question_type, "single_choice");
  for (const q of seed.questionsC) {
    for (const rule of q.display_tags_parsed?.disableRules ?? []) {
      assert.ok(
        !/a:q5 includes/.test(String(rule.condition)),
        `C-${q.question_code}: 単一選択の A-Q5 に includes を使っている`
      );
    }
  }
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
  assert.equal(disclosed, 2, "開示設問は A-Q10（アレルギー）と A-Q12（伝えたいこと）の2件のはず");
});

test("アレルギー設問は選択式かつ任意（要配慮情報を自由記述で集めない）", () => {
  const q10 = byCode(seed.questionsA, "Q10");
  assert.equal(q10.question_type, "multi_choice", "アレルギー設問が選択式でない");
  assert.equal(q10.is_required, false, "アレルギー設問が必須になっている");
  assert.equal(
    q10.question_config.meta?.share_with_store?.timing,
    "immediate",
    "アレルギーが即時開示になっていない（提供前に届かないと事故になる）"
  );
  // 集計モードであること＝原文がそのまま店舗に出ない
  assert.equal(q10.question_config.meta?.share_with_store?.mode, "aggregate");
});

test("自由記述の開示設問は任意回答（強制すると書きたくない人が詰まる）", () => {
  const q12 = byCode(seed.questionsA, "Q12");
  assert.equal(q12.question_type, "free_text_long");
  assert.equal(q12.is_required, false);
});

test("A-Q11 の value と業種テンプレの日数表キーが1対1で一致する", () => {
  // 片方だけ直すと頻度が引けず、C の送付日が undecided_days に落ちる。
  const table = templateSrc.match(/RESTAURANT_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(table, "RESTAURANT_FREQUENCY_DAYS が見つかりません");

  const keys = [...(table[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((m) => m[1] ?? "").sort();
  const values = valuesOf(byCode(seed.questionsA, "Q11"))
    .filter((v) => v !== "undecided") // undecided は日数表ではなく undecided_days で扱う
    .sort();

  assert.deepEqual(keys, values, "A-Q11 の value と日数表のキーがズレている");
  assert.ok(keys.includes("undecided") === false, "undecided を日数表に入れてはいけない");
});

test("業種テンプレの frequency_question_code が A に実在する", () => {
  const code = templateSrc.match(/frequency_question_code: "(\w+)"/)?.[1];
  assert.ok(code, "frequency_question_code が見つかりません");
  assert.ok(
    seed.questionsA.some((q) => q.question_code === code),
    `frequency_question_code=${code} が A に存在しない`
  );
});

test("送付日が申告頻度より十分に長い（外食頻度＝その店の来店頻度ではない）", () => {
  // 「週2回外食する」人がこの店に週2回来るわけではない。申告値をそのまま
  // 送付日にすると C が早すぎて「まだ行っていないだけ」を離脱と誤判定する。
  // ⚠ ファイル全体から数値を拾うと followup_b_delay_minutes 等まで混ざる。
  //   頻度表のブロック内だけを見る。
  const block = templateSrc.match(/RESTAURANT_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(block, "RESTAURANT_FREQUENCY_DAYS が見つかりません");
  const days = [...(block[1] ?? "").matchAll(/^\s*\w+: (\d+),/gm)].map((m) => Number(m[1]));
  assert.ok(days.length >= 6, "日数表の件数が足りません");

  // 最短でも3週間は空ける（週2回以上の層でも外食機会が数回は挟まる）
  assert.ok(Math.min(...days) >= 21, "最短が短すぎる（まだ行っていないだけを離脱と誤判定する）");
  // 半年を超えると来店体験そのものを覚えておらず C の回答精度が落ちる
  assert.ok(Math.max(...days) <= 180, "最長が長すぎる（記憶が薄れて C が答えられない）");

  // 日数表は申告頻度の昇順（=日数の昇順）で並んでいること
  assert.deepEqual(days, [...days].sort((a, b) => a - b), "日数表が頻度順に並んでいない");
});

test("クールダウンが飲食の再来店周期より短い（日常利用を握り潰さない）", () => {
  const cooldown = Number(templateSrc.match(/restart_cooldown_days: (\d+)/)?.[1]);
  // サロンの25日のままだと「週2回以上」の層の正常な再来店が
  // 「クールダウン中」と判定されて新しいサイクルが1本も立たない。
  assert.ok(
    cooldown <= 7,
    `restart_cooldown_days=${cooldown} では飲食の日常利用（週数回）を取りこぼす`
  );
});

test("B の遅延がサロンより短い（席を立つ前に答えてもらう）", () => {
  const delay = Number(templateSrc.match(/followup_b_delay_minutes: (\d+)/)?.[1]);
  assert.ok(delay > 0, "followup_b_delay_minutes が見つかりません");
  assert.ok(delay <= 120, `followup_b_delay_minutes=${delay} では退店後になる`);
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
  // BGM・照明は5段階満足度では分散が出ないので「気づかれたか」を聞く。
  const rows = new Set(
    (byCode(seed.questionsB, "Q2").question_config.matrix_rows ?? []).map((r: Option) => r.value)
  );
  for (const banned of ["bgm", "lighting", "private_room", "restroom", "smoking"]) {
    assert.ok(!rows.has(banned), `B-Q2 のマトリクスに ${banned} が入っている（画面数が膨らむ）`);
  }

  const q8 = byCode(seed.questionsB, "Q8");
  assert.equal(q8.question_type, "multi_choice", "B-Q8 は複数選択のはず");
  for (const expected of ["bgm", "seat_space", "private_room", "restroom", "kids_friendly"]) {
    assert.ok(valuesOf(q8).includes(expected), `B-Q8 に ${expected} が無い`);
  }
});

test("C に「飽き」「気分」がある（無いと離脱理由が価格に流れ込んで値下げに誘導される）", () => {
  // 飲食の離脱は不満ではなく選択肢の多さで起きることが多い。これを分離できないと
  // 「値下げ」という誤った打ち手に誘導してしまう。
  const q9 = valuesOf(byCode(seed.questionsC, "Q9"));
  assert.ok(q9.includes("menu_bored"), "C-Q9 に「飽きた」が無い");
  assert.ok(q9.includes("mood"), "C-Q9 に「その日の気分」が無い");
  assert.ok(q9.includes("no_reason"), "C-Q9 に「特に理由はない」が無い");

  // リピート側にも味以外（距離・使い勝手）を置く
  const q8 = valuesOf(byCode(seed.questionsC, "Q8"));
  for (const expected of ["access", "easy_booking", "habit"]) {
    assert.ok(q8.includes(expected), `C-Q8 に ${expected} が無い`);
  }
});

test("飲食固有の評価軸が入り、サロン固有の軸が残っていない", () => {
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));
  for (const required of ["taste", "speed", "portion", "menu_variety", "hygiene"]) {
    assert.ok(aspects.has(required), `ASPECTS に ${required} が無い`);
  }
  for (const salonOnly of ["skill", "trouble", "home_styling", "durability", "nail_care", "care"]) {
    assert.ok(!aspects.has(salonOnly), `ASPECTS にサロン固有の ${salonOnly} が残っている`);
  }
});
