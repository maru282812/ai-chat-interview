/**
 * lodgingSurveySeed.test.ts
 *
 * 宿泊 A/B/C の seed（scripts/seedLodgingSurveyProjects.mjs）と
 * 業種テンプレ（scripts/seedLodgingIndustryTemplate.mjs）の不変条件を守る。
 *
 * なぜ seed にテストを書くか:
 *   seed はコードではなく「データ」なので typecheck が効かない。しかし壊れ方は
 *   静かで、本番に投入して初めて分かる。過去に同型の事故が複数回起きている。
 *     - 選択肢の value がラベルで作り直されて表示条件が全滅した
 *     - 頻度設問の value が引けず C の送付日が既定値に落ちた
 *     - 開示設問の notice と画面文言がズレた（利用規約 第9条3項の説明がつかない）
 *
 * ここで守りたいこと（1・2 が宿泊固有の要点）:
 *   1. B が24時間後（1440分）に送られる
 *      他業種の120分に「揃えられる」と、Aの2時間後＝入室直後にBが届き、
 *      風呂・朝食・寝具を何も経験していない状態で滞在の満足度を聞くことになる。
 *   2. C が「再訪したか」ではなく再訪意向・推奨意向で離脱を見る
 *      宿泊は再訪率が構造的に低く、行動で測ると満足度ではなく
 *      「その地方に用事があるか」を測ってしまう。
 *   3. A-Q9 の value と業種テンプレの日数表キーが1対1
 *   4. 開示設問の helpText と share_with_store.notice が同一（利用規約 第9条3項）
 *   5. 表示条件・disableRules の参照先が実在する
 *   6. 素泊まり客に食事の設問を出さない
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

const SEED_PATH = path.join(process.cwd(), "scripts", "seedLodgingSurveyProjects.mjs");
const TEMPLATE_PATH = path.join(process.cwd(), "scripts", "seedLodgingIndustryTemplate.mjs");

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
  MEAL_PLANS: string[];
}> {
  const body = readFileSync(SEED_PATH, "utf8")
    .replace(/^import .*$/gm, "")
    .replace(/loadDotEnv\(\);/, "")
    .replace(/const url = [\s\S]*?auth: \{ persistSession: false \} \}\);/, "")
    .replace(/main\(\)\.catch[\s\S]*$/, "")
    .replace(/async function main\(\)[\s\S]*?\n\}\n/, "")
    .replace(/async function cleanup\(\)[\s\S]*?\n\}\n/, "");

  const exports_ =
    "\nexport { projects, questions, questionsA, questionsB, questionsC, ASPECTS, MEAL_PLANS };";
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

test("案件の UUID が hex として妥当（lodging を字面で入れると Postgres に弾かれる）", () => {
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
    "seedRetailSurveyProjects.mjs",
    "seedFitnessSurveyProjects.mjs"
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
  // `q7=probably_not` の probably_not が C-Q7 に無ければ条件が常に偽になり、
  // 離反理由の設問が誰にも出ない（静かに壊れる）。
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
      // A-Q5 は single_choice なので `=`/`!=` で比較する（includes ではない）
      for (const m of String(rule.condition).matchAll(/a:q5!?=(\w+)/g)) {
        const plan = m[1] ?? "";
        assert.ok(aq5.has(plan), `C-${q.question_code}: a:q5 の value ${plan} が A-Q5 に無い`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 0, "disableRules が1件も無い（プランの絞り込みが効いていない）");
});

test("排他の「特になし」に exclusive が付いている", () => {
  for (const q of seed.questions) {
    const none = (q.question_config.options ?? []).find((o: Option) => o?.value === "none");
    if (!none) continue;
    assert.equal(none.exclusive, true, `${q.question_code}: none に exclusive が無い`);
  }
});

test("施設開示設問の notice が画面の helpText と同一（利用規約 第9条3項）", () => {
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
  assert.equal(disclosed, 2, "開示設問は A-Q7（同行者）と A-Q8（要望・アレルギー）の2件のはず");
});

test("アレルギーを聞く設問の notice が用途を明示している（要配慮個人情報に近い扱い）", () => {
  // ⚠ 設問文で用途（客室準備・食事手配）を明示していないと、
  //   要配慮情報に近いデータを目的不明で集めることになる。
  const q8 = byCode(seed.questionsA, "Q8");
  assert.match(q8.question_text, /アレルギー/, "A-Q8 がアレルギーを聞く設問ではない");
  const notice = q8.question_config.meta?.share_with_store?.notice ?? "";
  assert.match(notice, /お食事|手配/, "A-Q8 の notice に食事手配の用途が書かれていない");
  assert.equal(q8.is_required, false, "A-Q8 は任意回答であるべき（書きたくない人が詰まる）");
});

test("A-Q9 の value と業種テンプレの日数表キーが1対1で一致する", () => {
  // 片方だけ直すと頻度が引けず、C の送付日が undecided_days に落ちる。
  const table = templateSrc.match(/LODGING_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(table, "LODGING_FREQUENCY_DAYS が見つかりません");

  const keys = [...(table[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((m) => m[1] ?? "").sort();
  const values = valuesOf(byCode(seed.questionsA, "Q9"))
    .filter((v) => v !== "undecided") // undecided は日数表ではなく undecided_days で扱う
    .sort();

  assert.deepEqual(keys, values, "A-Q9 の value と日数表のキーがズレている");
  assert.ok(!keys.includes("undecided"), "undecided を日数表に入れてはいけない");
});

test("業種テンプレの frequency_question_code が A に実在し、宿泊回数の設問ではない", () => {
  const code = templateSrc.match(/frequency_question_code: "(\w+)"/)?.[1];
  assert.ok(code, "frequency_question_code が見つかりません");
  const target = seed.questionsA.find((q) => q.question_code === code);
  assert.ok(target, `frequency_question_code=${code} が A に存在しない`);

  // ⚠ A-Q4（この施設への宿泊回数）を頻度設問と混同すると、初回客が全員
  //   同じ扱いになり日数表が引けなくなる。
  assert.notEqual(code, "Q4", "A-Q4 は宿泊回数であって頻度設問ではない");
  assert.ok(valuesOf(target!).includes("undecided"), "頻度設問に「特に決まっていない」が無い");

  // 「旅行そのものの頻度」を聞いていること（施設単位だと初回客が全員 undecided に倒れる）
  assert.match(target!.question_text, /旅行|出張/, "頻度設問が旅行の頻度を聞いていない");
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
  // 香り・BGM・照明は5段階満足度では分散が出ないので「気づかれたか」を聞く。
  const rows = new Set(
    (byCode(seed.questionsB, "Q3").question_config.matrix_rows ?? []).map((r: Option) => r.value)
  );
  for (const banned of ["scent", "bgm", "lighting", "temperature", "view"]) {
    assert.ok(!rows.has(banned), `B-Q3 のマトリクスに ${banned} が入っている（画面数が膨らむ）`);
  }

  const q7 = byCode(seed.questionsB, "Q7");
  assert.equal(q7.question_type, "multi_choice", "B-Q7 は複数選択のはず");
  for (const expected of ["scent", "bgm", "pillow", "view"]) {
    assert.ok(valuesOf(q7).includes(expected), `B-Q7 に ${expected} が無い`);
  }
});

// ------------------------------------------------------------------
// 宿泊固有の設計判断（冒頭コメント1・2）
// ------------------------------------------------------------------

test("B が24時間後（1440分）に送られる ＝ 他業種の120分に揃えてはいけない", () => {
  // ⚠ ここが宿泊版の最重要設定。120分にすると Bが「入室直後」に届き、
  //   風呂・朝食・寝具を何も経験していない状態で滞在の満足度を聞くことになる。
  const delay = Number(templateSrc.match(/followup_b_delay_minutes: (\d+)/)?.[1]);
  assert.equal(delay, 1440, `followup_b_delay_minutes=${delay}（宿泊は1440分でなければならない）`);
});

test("B に泊数の設問がある（Bが翌日固定で届くため多泊客を集計で分離する必要がある）", () => {
  // 2泊以上の客には B が滞在中の中日に届く。集計時に1泊客と分けられないと
  // 「チェックアウト時の評価」と「滞在途中の評価」が混ざる。
  const q1 = byCode(seed.questionsB, "Q1");
  const vals = valuesOf(q1);
  for (const expected of ["one", "two", "three_plus"]) {
    assert.ok(vals.includes(expected), `B-Q1 に ${expected} が無い`);
  }
});

test("C の離脱判定が行動ではなく再訪意向・推奨意向で行われている", () => {
  // ⚠ 宿泊は再訪率が構造的に低い。行動（再訪したか）で判定すると満足度ではなく
  //   「その地方に用事があるか」を測ってしまい、ほぼ全員が離脱に分類される。
  const q7 = byCode(seed.questionsC, "Q7");
  assert.match(q7.question_text, /宿泊したいと思いますか/, "C-Q7 が再訪意向の設問ではない");
  for (const expected of ["definitely", "probably", "undecided", "probably_not", "definitely_not"]) {
    assert.ok(valuesOf(q7).includes(expected), `C-Q7 に ${expected} が無い`);
  }

  // 推奨意向の実績（行動）も取る
  const q8 = byCode(seed.questionsC, "Q8");
  const q8vals = valuesOf(q8);
  for (const expected of ["recommended", "negative", "not_yet"]) {
    assert.ok(q8vals.includes(expected), `C-Q8 に ${expected} が無い`);
  }

  // 離反理由は「意向が低い or 悪く話した」層に出す（再訪しなかった層ではない）
  const q9expr = (byCode(seed.questionsC, "Q9").visibility_conditions ?? [])
    .map((c) => c.expression)
    .join(" ");
  for (const needed of ["q7=probably_not", "q7=definitely_not", "q7=undecided", "q8=negative"]) {
    assert.ok(q9expr.includes(needed), `C-Q9 の表示条件に ${needed} が無い`);
  }
  // ⚠ C-Q6（実際どこに泊まったか）で離反理由を絞ってはいけない
  assert.ok(
    !q9expr.includes("q6="),
    "C-Q9 が実際の宿泊行動（q6）で絞られている（旅行先が変わるだけで離反扱いになる）"
  );
});

test("C が「旅行そのものをしたか」を先に聞く（しないと離反分析が成立しない）", () => {
  // これが無いと「再訪しなかった」が「旅行しなかった」なのか
  // 「別の宿を選んだ」なのか区別できない。
  const q5 = byCode(seed.questionsC, "Q5");
  assert.match(q5.question_text, /旅行|出張/, "C-Q5 が旅行の有無を聞いていない");
  assert.deepEqual(valuesOf(q5).sort(), ["no", "yes"], "C-Q5 は はい／いいえ のはず");

  // 実際の宿泊先は行動データとして取る（判定には使わない）
  const q6 = byCode(seed.questionsC, "Q6");
  for (const expected of ["same", "other_area", "same_area_other"]) {
    assert.ok(valuesOf(q6).includes(expected), `C-Q6 に ${expected} が無い`);
  }
  const q6expr = (q6.visibility_conditions ?? []).map((c) => c.expression).join(" ");
  assert.ok(q6expr.includes("q5=yes"), "C-Q6 が旅行した人に限定されていない");
});

test("離反理由に「その地域に行く予定がない」がある（不満と混ぜないため）", () => {
  // ⚠ 宿泊固有。これを不満として数えると離反理由が実態より悪く出る。
  //   逆に選択肢が無いと、地理的理由が「価格」「立地」に流れ込んで真因が消える。
  const q9 = byCode(seed.questionsC, "Q9");
  const vals = valuesOf(q9);
  assert.ok(vals.includes("no_plan_to_visit"), "C-Q9 に「その地域に行く予定がない」が無い");
  assert.ok(vals.includes("want_new_place"), "C-Q9 に「毎回違う場所に行きたい」が無い");
  // 画面側でも「不満でなくてよい」と伝える
  assert.match(
    q9.question_config.helpText ?? "",
    /不満/,
    "C-Q9 の helpText が「不満でなくてよい」と伝えていない"
  );
});

test("B に再訪意向と推奨意向の両方がある（Cとの比較で意向の変化を見る）", () => {
  const q10 = byCode(seed.questionsB, "Q10");
  const q11 = byCode(seed.questionsB, "Q11");
  assert.match(q10.question_text, /宿泊したい/, "B-Q10 が再訪意向の設問ではない");
  assert.match(q11.question_text, /薦め/, "B-Q11 が推奨意向の設問ではない");

  // B-Q10 と C-Q7 は同じ選択肢（時間経過による意向の変化を見るため）
  assert.deepEqual(
    valuesOf(q10).sort(),
    valuesOf(byCode(seed.questionsC, "Q7")).sort(),
    "B-Q10 と C-Q7 の選択肢がズレている（意向の変化を比較できない）"
  );
});

test("素泊まり客に食事の設問を出さない（答えようがなく neutral が量産される）", () => {
  // B-Q8（食事の詳細）は食事付きプランにだけ出す
  const q8expr = (byCode(seed.questionsB, "Q8").visibility_conditions ?? [])
    .map((c) => c.expression)
    .join(" ");
  for (const plan of seed.MEAL_PLANS) {
    assert.ok(q8expr.includes(`a:q5=${plan}`), `B-Q8 の表示条件に ${plan} が無い`);
  }
  assert.ok(!q8expr.includes("room_only"), "B-Q8 が素泊まり客にも出る条件になっている");

  // C-Q2/C-Q3 の食事関連選択肢は disableRules で落ちる
  const mealTargets = new Map([
    ["Q2", "meal_memory"],
    ["Q3", "meal_issue"]
  ]);
  for (const [code, target] of mealTargets) {
    const rules = byCode(seed.questionsC, code).display_tags_parsed?.disableRules ?? [];
    const rule = rules.find((r: any) => r.targetChoice === target);
    assert.ok(rule, `C-${code} に ${target} の disableRule が無い`);
    for (const plan of seed.MEAL_PLANS) {
      assert.ok(
        String(rule.condition).includes(`a:q5!=${plan}`),
        `C-${code}: ${target} の条件に ${plan} の除外が無い`
      );
    }
  }
});

test("宿泊固有の評価軸が入り、他業種固有の軸が残っていない", () => {
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));
  for (const required of ["cleanliness", "bedding", "soundproof", "bath", "meal"]) {
    assert.ok(aspects.has(required), `ASPECTS に ${required} が無い`);
  }
  for (const foreign of ["skill", "trouble", "home_styling", "lineup", "stock", "durability"]) {
    assert.ok(!aspects.has(foreign), `ASPECTS に他業種固有の ${foreign} が残っている`);
  }
});

test("C の送付が記憶の風化前に収まっている（意向を聞くので行動を待たない）", () => {
  // ⚠ 年1回以下の層に実際の旅行間隔（365日）で送ると、滞在の記憶が薄れて
  //   C-Q2/C-Q3 が「覚えていない」に潰れる。
  const block = templateSrc.match(/LODGING_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(block, "LODGING_FREQUENCY_DAYS が見つかりません");
  const days = [...(block[1] ?? "").matchAll(/^\s*\w+: (\d+),?/gm)].map((m) => Number(m[1]));
  assert.ok(days.length >= 5, "日数表の件数が足りません");
  assert.ok(
    Math.max(...days) <= 120,
    `最長が ${Math.max(...days)}日（滞在の記憶が風化して設問が成立しない）`
  );
});

test("再宿泊のクールダウンが連泊を吸収できる長さになっている", () => {
  // ⚠ 3日だと3泊以上の滞在中に新しいサイクルが立つ恐れがある。
  const cooldown = Number(templateSrc.match(/restart_cooldown_days: (\d+)/)?.[1]);
  assert.ok(cooldown >= 4, `restart_cooldown_days=${cooldown} では連泊中に新サイクルが立つ`);
  assert.ok(cooldown <= 14, `restart_cooldown_days=${cooldown} では出張の再訪を取りこぼす`);
});
