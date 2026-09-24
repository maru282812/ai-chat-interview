/**
 * fitnessSurveySeed.test.ts
 *
 * フィットネス A/B/C の seed（scripts/seedFitnessSurveyProjects.mjs）と
 * 業種テンプレ（scripts/seedFitnessIndustryTemplate.mjs）の不変条件を守る。
 *
 * なぜ seed にテストを書くか:
 *   seed はコードではなく「データ」なので typecheck が効かない。しかし壊れ方は
 *   静かで、本番に投入して初めて分かる。過去に同型の事故が複数回起きている。
 *     - 選択肢の value がラベルで作り直されて表示条件が全滅した
 *     - 頻度設問の value が引けず C の送付日が既定値に落ちた
 *     - 開示設問の notice と画面文言がズレた（利用規約 第9条3項の説明がつかない）
 *
 * ここで守りたいこと:
 *   1. UUID が hex として妥当（"fitness" を字面で入れると Postgres に弾かれる）
 *   2. A-Q9 の value と業種テンプレの日数表キーが1対1（片方だけ直すと頻度が引けない）
 *   3. 開示設問の helpText と share_with_store.notice が同一（利用規約 第9条3項）
 *   4. 表示条件・disableRules の参照先が実在する
 *   5. フィットネス固有の設計判断が壊れていない
 *      - 離脱を「来たか」の二値ではなく頻度の低下で見る（会員制のため）
 *      - A-Q9 と C-Q5 が同じ刻み（差分が継続の主指標）
 *      - 身体情報・既往症を設問として取らない（要配慮個人情報）
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

const SEED_PATH = path.join(process.cwd(), "scripts", "seedFitnessSurveyProjects.mjs");
const TEMPLATE_PATH = path.join(process.cwd(), "scripts", "seedFitnessIndustryTemplate.mjs");

type Option = { value: string; label: string; exclusive?: boolean };
type Question = {
  question_code: string;
  question_text: string;
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
  FREQUENCY: [string, string][];
}> {
  const body = readFileSync(SEED_PATH, "utf8")
    .replace(/^import .*$/gm, "")
    .replace(/loadDotEnv\(\);/, "")
    .replace(/const url = [\s\S]*?auth: \{ persistSession: false \} \}\);/, "")
    .replace(/main\(\)\.catch[\s\S]*$/, "")
    .replace(/async function main\(\)[\s\S]*?\n\}\n/, "")
    .replace(/async function cleanup\(\)[\s\S]*?\n\}\n/, "");

  const exports_ =
    "\nexport { projects, questions, questionsA, questionsB, questionsC, ASPECTS, FREQUENCY };";
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

test("案件の UUID が hex として妥当（fitness を字面で入れると Postgres に弾かれる）", () => {
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
    "seedAcupunctureSurveyProjects.mjs",
    "seedRetailSurveyProjects.mjs"
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
  // `q5=stopped` の stopped が C-Q5 に無ければ、条件が常に偽になって
  // 退会理由の設問が誰にも出ない（静かに壊れる）。
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
      assert.ok(
        own.has(rule.targetChoice),
        `C-${q.question_code}: targetChoice ${rule.targetChoice} が選択肢に無い`
      );
      for (const m of String(rule.condition).matchAll(/a:q5 includes (\w+)/g)) {
        const usage = m[1] ?? "";
        assert.ok(aq5.has(usage), `C-${q.question_code}: a:q5 の value ${usage} が A-Q5 に無い`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 0, "disableRules が1件も無い（利用内容の絞り込みが効いていない）");
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
  assert.equal(disclosed, 2, "開示設問は A-Q7（声かけ希望）と A-Q8（伝えたいこと）の2件のはず");
});

test("自由記述の開示設問は任意回答（強制すると書きたくない人が詰まる）", () => {
  const q8 = byCode(seed.questionsA, "Q8");
  assert.equal(q8.question_type, "free_text_long");
  assert.equal(q8.is_required, false);
});

test("A-Q9 の value と業種テンプレの日数表キーが1対1で一致する", () => {
  // 片方だけ直すと頻度が引けず、C の送付日が undecided_days に落ちる。
  const table = templateSrc.match(/FITNESS_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(table, "FITNESS_FREQUENCY_DAYS が見つかりません");

  const keys = [...(table[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((m) => m[1] ?? "").sort();
  const values = valuesOf(byCode(seed.questionsA, "Q9"))
    .filter((v) => v !== "undecided") // undecided は日数表ではなく undecided_days で扱う
    .sort();

  assert.deepEqual(keys, values, "A-Q9 の value と日数表のキーがズレている");
  assert.ok(!keys.includes("undecided"), "undecided を日数表に入れてはいけない");
  // C-Q5 の "stopped" は頻度ではなく結果なので送付日計算に使わない
  assert.ok(!keys.includes("stopped"), "stopped（行かなくなった）を日数表に入れてはいけない");
});

test("業種テンプレの frequency_question_code が A に実在し、会員歴の設問ではない", () => {
  const code = templateSrc.match(/frequency_question_code: "(\w+)"/)?.[1];
  assert.ok(code, "frequency_question_code が見つかりません");
  const target = seed.questionsA.find((q) => q.question_code === code);
  assert.ok(target, `frequency_question_code=${code} が A に存在しない`);

  // ⚠ A-Q4（会員歴）を頻度設問と混同すると、送付日が「1か月未満/1年以上」で
  //   決まることになり日数表が一切引けなくなる。
  assert.notEqual(code, "Q4", "A-Q4 は会員歴であって頻度設問ではない");
  assert.ok(valuesOf(target!).includes("undecided"), "頻度設問に「特に決まっていない」が無い");
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

test("館内環境の設問がマトリクスではなく独立設問になっている", () => {
  // matrix_single は 1行=1画面で出るため、行を足すと画面数がそのまま増える。
  // BGM・照明・空調は5段階満足度では分散が出ないので「気づかれたか」を聞く。
  const rows = new Set(
    (byCode(seed.questionsB, "Q2").question_config.matrix_rows ?? []).map((r: Option) => r.value)
  );
  for (const banned of ["bgm", "lighting", "temperature", "towel", "mirror"]) {
    assert.ok(!rows.has(banned), `B-Q2 のマトリクスに ${banned} が入っている（画面数が膨らむ）`);
  }

  const q7 = byCode(seed.questionsB, "Q7");
  assert.equal(q7.question_type, "multi_choice", "B-Q7 は複数選択のはず");
  for (const expected of ["bgm", "lighting", "air", "towel", "mirror"]) {
    assert.ok(valuesOf(q7).includes(expected), `B-Q7 に ${expected} が無い`);
  }
});

// ------------------------------------------------------------------
// フィットネス固有の設計判断（冒頭コメント1・4・5）
// ------------------------------------------------------------------

test("A-Q9 と C-Q5 が同じ頻度の刻みを共有する（差分が継続の主指標）", () => {
  // ⚠ ここが本業種の要点。刻みがズレると「頻度が落ちたか」を比較できず、
  //   継続判定そのものが成立しない。
  const frequency = seed.FREQUENCY.map(([v]) => v);

  const aq9 = valuesOf(byCode(seed.questionsA, "Q9"));
  for (const v of frequency) {
    assert.ok(aq9.includes(v), `A-Q9 に頻度 ${v} が無い`);
  }

  const cq5 = valuesOf(byCode(seed.questionsC, "Q5"));
  for (const v of frequency) {
    assert.ok(cq5.includes(v), `C-Q5 に頻度 ${v} が無い（A-Q9 と比較できない）`);
  }

  // C 側にだけ「行かなくなった」がある（A には存在しない状態）
  assert.ok(cq5.includes("stopped"), "C-Q5 に「行かなくなった・退会した」が無い");
  assert.ok(!aq9.includes("stopped"), "A-Q9 に stopped があってはいけない");
});

test("C の離脱判定が二値ではなく頻度の低下で行われている", () => {
  // ⚠ 会員制なので「利用したか」の二値ではほぼ全員が「した」になり、
  //   離脱が一切検出できない。頻度の低下こそが離脱の前兆である。
  const cq5 = byCode(seed.questionsC, "Q5");
  assert.equal(cq5.question_type, "single_choice");
  assert.ok(
    valuesOf(cq5).length >= 6,
    "C-Q5 が二値に近い（頻度の低下を検出できない）"
  );

  // 退会理由は頻度が落ちた層にだけ出す
  const q6expr = (byCode(seed.questionsC, "Q6").visibility_conditions ?? [])
    .map((c) => c.expression)
    .join(" ");
  assert.ok(q6expr.includes("q5=stopped"), "C-Q6 が退会者に出ない");
  assert.ok(
    q6expr.includes("q5=monthly") || q6expr.includes("q5=biweekly"),
    "C-Q6 が頻度低下層に出ない（退会前の予兆を拾えない）"
  );

  // 継続理由は通えている層にだけ出す
  const q7expr = (byCode(seed.questionsC, "Q7").visibility_conditions ?? [])
    .map((c) => c.expression)
    .join(" ");
  for (const needed of ["q5=four_plus", "q5=three", "q5=twice", "q5=once"]) {
    assert.ok(q7expr.includes(needed), `C-Q7 の表示条件に ${needed} が無い`);
  }
});

test("B に「次回いつ来るか」がある（「また来たいか」では差がつかない）", () => {
  // 1回の満足度と継続は相関しない業種なので、意向ではなく予定を聞く。
  const q9 = byCode(seed.questionsB, "Q9");
  const vals = valuesOf(q9);
  for (const expected of ["this_week", "next_week", "undecided", "no_plan"]) {
    assert.ok(vals.includes(expected), `B-Q9 に ${expected} が無い`);
  }
});

test("身体情報・既往症を設問として収集していない（要配慮個人情報）", () => {
  // ⚠ 体重・体脂肪率・既往症・服薬は個人情報保護法上の要配慮個人情報（病歴）に
  //   該当しうる。満足度調査に必要ないため設問として置かない。
  //   自由記述に本人が書くのは別（設問として体系収集するのとは扱いが違う）。
  const banned = [/体重/, /体脂肪/, /既往/, /服薬/, /持病/, /BMI/, /身長/, /血圧/];
  for (const q of seed.questions) {
    // 自由記述の placeholder は本人記入の例示なので対象外。設問文と選択肢を見る。
    const labels = (q.question_config.options ?? [])
      .map((o: Option) => o.label)
      .join(" ");
    const haystack = `${q.question_text} ${labels}`;
    for (const pattern of banned) {
      assert.ok(
        !pattern.test(haystack),
        `${q.question_code}: 身体情報・既往症を聞いている（${pattern}）`
      );
    }
  }

  // numeric は年齢だけであること（体重・体脂肪率の numeric が増えていないか）
  const numerics = seed.questions.filter((q) => q.question_type === "numeric");
  assert.equal(numerics.length, 1, "numeric 設問が増えている（身体情報の可能性）");
  assert.equal(numerics[0]?.question_config.unit, "歳", "numeric が年齢以外になっている");
});

test("目的を目標（痩せたい等）ではなく行動で聞いている", () => {
  // ダイエット目的を体系収集すると健康情報の取得に近づく（冒頭コメント4）。
  const q5 = byCode(seed.questionsA, "Q5");
  const labels = (q5.question_config.options ?? []).map((o: Option) => o.label).join(" ");
  for (const pattern of [/痩せ/, /ダイエット/, /減量/, /体型/]) {
    assert.ok(!pattern.test(labels), `A-Q5 に目標（${pattern}）が入っている`);
  }
  // 行動として聞けているか
  for (const expected of ["machine", "cardio", "studio", "personal"]) {
    assert.ok(valuesOf(q5).includes(expected), `A-Q5 に ${expected} が無い`);
  }
});

test("混雑（マシンの空き）が評価軸と実測の両方で取れている", () => {
  // 退会理由の最上位。5段階だけだと「何が待たされたか」が分からず
  // 設備投資の判断材料にならない。
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));
  assert.ok(aspects.has("equipment_availability"), "ASPECTS にマシンの空きが無い");

  const q6 = byCode(seed.questionsB, "Q6");
  assert.equal(q6.question_type, "multi_choice", "B-Q6 は複数選択のはず");
  for (const expected of ["machine", "cardio", "locker", "shower"]) {
    assert.ok(valuesOf(q6).includes(expected), `B-Q6 に ${expected} が無い`);
  }
});

test("フィットネス固有の評価軸が入り、他業種固有の軸が残っていない", () => {
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));
  for (const required of ["equipment_availability", "locker", "cleanliness", "trainer"]) {
    assert.ok(aspects.has(required), `ASPECTS に ${required} が無い`);
  }
  for (const foreign of ["skill", "trouble", "home_styling", "taste", "lineup", "durability"]) {
    assert.ok(!aspects.has(foreign), `ASPECTS に他業種固有の ${foreign} が残っている`);
  }
});

test("再来館のクールダウンが短い（週4回来る会員を離脱扱いにしない）", () => {
  const cooldown = Number(templateSrc.match(/restart_cooldown_days: (\d+)/)?.[1]);
  assert.ok(
    cooldown <= 7,
    `restart_cooldown_days=${cooldown} ではフィットネスの正常な来館を取りこぼす`
  );
  // ⚠ 1日にすると同日の再入館（朝サウナ→夜トレーニング）を拾う恐れがある
  assert.ok(cooldown >= 2, `restart_cooldown_days=${cooldown} は短すぎる（同日再入館を拾う）`);
});

test("C の送付が継続判定に足る長さまで引き伸ばされている", () => {
  // ⚠ 来館間隔をそのまま使うと週4回の人に数日後にCが届き、
  //   「続けられているか」が何も分からない。最低30日は置く。
  const block = templateSrc.match(/FITNESS_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(block, "FITNESS_FREQUENCY_DAYS が見つかりません");
  const days = [...(block[1] ?? "").matchAll(/^\s*\w+: (\d+),?/gm)].map((m) => Number(m[1]));
  assert.ok(days.length >= 6, "日数表の件数が足りません");
  assert.ok(
    Math.min(...days) >= 30,
    `最短が ${Math.min(...days)}日（継続を判定するには短すぎる）`
  );
});
