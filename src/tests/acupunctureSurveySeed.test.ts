/**
 * acupunctureSurveySeed.test.ts
 *
 * 鍼灸院 A/B/C の seed（scripts/seedAcupunctureSurveyProjects.mjs）と
 * 業種テンプレ（scripts/seedAcupunctureIndustryTemplate.mjs）の不変条件を守る。
 *
 * なぜ seed にテストを書くか:
 *   seed はコードではなく「データ」なので typecheck が効かない。しかし壊れ方は
 *   静かで、本番に投入して初めて分かる。過去に同型の事故が複数回起きている。
 *
 * この業種だけの追加の理由:
 *   鍼灸は**広告規制（あん摩マツサージ指圧師等法 第7条）**があり、効能・効果の
 *   広告が認められていない。設問文に医療効果を断定する語が紛れ込むと、
 *   集計結果が使えなくなる（使うと違法になり得る）。文言は好みの問題ではなく
 *   法令の制約なので、テストで固定する。
 *
 * ここで守りたいこと:
 *   1. UUID が hex として妥当（"acu" を字面で入れると Postgres に弾かれる）
 *   2. 設問文に医療効果を断定する語が無い（広告規制）
 *   3. 症状に関する開示は集計のみ（要配慮情報を院へ個票で返さない）
 *   4. A-Q11 の value と業種テンプレの日数表キーが1対1
 *   5. 開示設問の helpText と share_with_store.notice が同一（利用規約 第9条3項）
 *   6. 通院計画の設問（B-Q9）が存在する＝この業種の離脱の核心
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

const SEED_PATH = path.join(process.cwd(), "scripts", "seedAcupunctureSurveyProjects.mjs");
const TEMPLATE_PATH = path.join(process.cwd(), "scripts", "seedAcupunctureIndustryTemplate.mjs");

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
/** 設問文＋選択肢ラベル＋helpText を1本の文字列にする（文言チェック用）。 */
const textOf = (q: Question): string =>
  [
    q.question_text,
    q.question_config.helpText ?? "",
    ...(q.question_config.options ?? []).map((o: Option) => o.label),
    ...(q.question_config.matrix_rows ?? []).map((r: Option) => r.label),
  ].join(" / ");

// ------------------------------------------------------------------

test("案件の UUID が hex として妥当（acu を字面で入れると Postgres に弾かれる）", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const p of seed.projects) {
    assert.match(p.id, UUID, `${p.entry_code} の id が UUID として不正`);
  }
  assert.equal(seed.projects.length, 3);
});

test("他業種 seed と案件IDが衝突しない（上書き事故の防止）", () => {
  for (const other of [
    "seedSalonSurveyProjects.mjs",
    "seedNailSurveyProjects.mjs",
    "seedRestaurantSurveyProjects.mjs",
  ]) {
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

// ------------------------------------------------------------------
// 広告規制（あん摩マツサージ指圧師等法 第7条）
// ------------------------------------------------------------------

test("設問文に医療効果を断定する語が無い（あはき法 第7条・効能効果の広告は不可）", () => {
  // 「治る」「改善」「効果」を設問側が名乗ると、集計結果が効能の訴求に読める。
  // 主観の実感として聞く言い方（らくになった／続いた）に統一する。
  // ⚠ ここは好みではなく法令の制約。緩めるときは弁護士確認を挟むこと。
  const BANNED = [
    "治る",
    "治った",
    "治り",
    "治療効果",
    "完治",
    "改善し",
    "改善さ",
    "改善度",
    "効果があ",
    "効きま",
    "根治",
    "必ず",
  ];
  for (const q of seed.questions) {
    const text = textOf(q);
    for (const word of BANNED) {
      assert.ok(
        !text.includes(word),
        `${q.question_code}: 医療効果を断定する語「${word}」が含まれる → ${text.slice(0, 60)}`
      );
    }
  }
});

test("体調の変化は主観の実感として聞いている（C-Q1・C-Q2）", () => {
  // 「らく」という主観語で受けることで、効能の測定ではないことを担保する。
  const q1 = byCode(seed.questionsC, "Q1");
  assert.ok(textOf(q1).includes("らく"), "C-Q1 が主観の言い方になっていない");

  // 持続期間はこの業種の核心（B 直後は誰でもらくになる）。
  const q2 = byCode(seed.questionsC, "Q2");
  assert.ok(textOf(q2).includes("らく"), "C-Q2 が主観の言い方になっていない");
  assert.ok(valuesOf(q2).includes("not_felt"), "C-Q2 に「変化を感じなかった」が無い");
  assert.ok(valuesOf(q2).includes("still"), "C-Q2 に「今も続いている」が無い");
});

test("症状に関する開示は集計のみ（要配慮情報を院へ個票で返さない）", () => {
  // A-Q5（主訴部位）は病歴に準じる要配慮情報に当たり得るので開示しない。
  const q5 = byCode(seed.questionsA, "Q5");
  assert.ok(
    !q5.question_config.meta?.share_with_store?.enabled,
    "A-Q5（主訴部位）が店舗開示になっている"
  );

  // 選択式の開示設問は aggregate であること
  for (const q of seed.questionsA) {
    const share = q.question_config.meta?.share_with_store;
    if (!share?.enabled) continue;
    if (q.question_type === "free_text_long") continue; // 申し送りは verbatim で可
    assert.equal(
      share.mode,
      "aggregate",
      `A-${q.question_code}: 選択式の開示が aggregate になっていない`
    );
  }
});

test("傷病名を書かせる自由記述が無い（主訴は部位レベルに留める）", () => {
  const q5 = byCode(seed.questionsA, "Q5");
  assert.equal(q5.question_type, "multi_choice", "A-Q5 が選択式でない");
  // 「その他」の自由入力は許容するが、設問自体を自由記述にはしない
  assert.ok(valuesOf(q5).includes("maintenance"), "A-Q5 に「不調なし（メンテナンス）」が無い");
});

// ------------------------------------------------------------------
// 通院計画 — この業種の離脱の核心
// ------------------------------------------------------------------

test("B-Q9 に通院の見通しが伝わったかの設問がある", () => {
  // 「効かなかったから来ない」より「次いつ来ればいいか分からないまま終わった」
  // が実際には多い。これが無いと離脱が説明できない。
  const q9 = byCode(seed.questionsB, "Q9");
  const vals = valuesOf(q9);
  for (const expected of ["clear_booked", "clear_not_booked", "vague", "none"]) {
    assert.ok(vals.includes(expected), `B-Q9 に ${expected} が無い`);
  }
});

test("C の離反理由に「押し売り感」と「時間が取れない」が分かれている", () => {
  // ⚠ 回数券・物販の勧誘を価格と混ぜると「値下げ」という誤った打ち手に誘導される。
  // ⚠ 「通う時間が取れない」は院の質の問題ではないので分けないと打ち手を見誤る。
  const q10 = valuesOf(byCode(seed.questionsC, "Q10"));
  assert.ok(q10.includes("pushy_sales"), "C-Q10 に「回数券・物販の勧誘」が無い");
  assert.ok(q10.includes("price"), "C-Q10 に「価格」が無い");
  assert.ok(q10.includes("no_time"), "C-Q10 に「時間が取れない」が無い");
  assert.ok(q10.includes("plan_unclear"), "C-Q10 に「どのくらい通えばよいか不明」が無い");
  // 「良くなったので通う必要がなくなった」は離脱だが失敗ではない。分けないと
  // 成功例を離脱率に数えてしまう。
  assert.ok(q10.includes("recovered"), "C-Q10 に「良くなったので通う必要がなくなった」が無い");

  // リピート側は関係性の価値を拾う
  const q9 = valuesOf(byCode(seed.questionsC, "Q9"));
  for (const expected of ["trust_person", "listens", "clear_plan", "no_pressure"]) {
    assert.ok(q9.includes(expected), `C-Q9 に ${expected} が無い`);
  }
});

test("B-Q8 に痛み・熱さの体感が独立で入っている（満足度には現れない）", () => {
  // 我慢した人も「やや満足」を選ぶため、5段階では初回離脱の主因を拾えない。
  const q8 = byCode(seed.questionsB, "Q8");
  assert.equal(q8.question_type, "multi_choice");
  for (const expected of ["needle_pain", "moxa_heat", "too_strong", "too_weak"]) {
    assert.ok(valuesOf(q8).includes(expected), `B-Q8 に ${expected} が無い`);
  }
});

// ------------------------------------------------------------------
// 構造（他業種と共通の不変条件）
// ------------------------------------------------------------------

test("表示条件が参照する設問コードが同じ案件に実在する", () => {
  for (const [name, qs] of [
    ["A", seed.questionsA],
    ["B", seed.questionsB],
    ["C", seed.questionsC],
  ] as const) {
    const have = new Set(qs.map((q) => q.question_code.toLowerCase()));
    for (const q of qs) {
      for (const cond of q.visibility_conditions ?? []) {
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

test("A-Q10 の選択肢が A-Q9 に完全に含まれる（carry-forward は value 一致が前提）", () => {
  const q10 = byCode(seed.questionsA, "Q10");
  assert.equal(
    q10.display_tags_parsed?.optionSource?.fromQuestion,
    "q9",
    "A-Q10 の optionSource が A-Q9 を指していない"
  );
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

test("B-Q2 のマトリクス行数が10行以下（1行=1画面で画面数が増える）", () => {
  const rows = (byCode(seed.questionsB, "Q2").question_config.matrix_rows ?? []).length;
  assert.ok(rows <= 10, `B-Q2 のマトリクスが ${rows} 行（画面数がそのまま増える）`);
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
        const sym = m[1] ?? "";
        assert.ok(aq5.has(sym), `C-${q.question_code}: a:q5 の value ${sym} が A-Q5 に無い`);
      }
      checked += 1;
    }
  }
  assert.ok(checked > 0, "disableRules が1件も無い（主訴による絞り込みが効いていない）");
});

test("A-Q5 は複数選択なので disableRules は includes で比較している", () => {
  // 飲食の A-Q5（利用シーン）は単一選択で等号だが、鍼灸の主訴は複数選択。
  // 等号で書くと複数選んだ人で条件が壊れる。
  assert.equal(byCode(seed.questionsA, "Q5").question_type, "multi_choice");
  for (const q of seed.questionsC) {
    for (const rule of q.display_tags_parsed?.disableRules ?? []) {
      assert.ok(
        /a:q5 includes/.test(String(rule.condition)),
        `C-${q.question_code}: 複数選択の A-Q5 に includes を使っていない`
      );
    }
  }
});

test("排他の「特になし」に exclusive が付いている", () => {
  // ⚠ value==="none" だけで判定しないこと。B-Q9 の none は
  //   「特に説明はなかった」という**単一選択の普通の選択肢**であって排他ではない。
  //   排他にすべきなのは複数選択の「特になし」だけなので、ラベルと型で絞る。
  let checked = 0;
  for (const q of seed.questions) {
    if (q.question_type !== "multi_choice") continue;
    const none = (q.question_config.options ?? []).find((o: Option) => o?.label === "特になし");
    if (!none) continue;
    assert.equal(none.exclusive, true, `${q.question_code}: 「特になし」に exclusive が無い`);
    checked += 1;
  }
  assert.ok(checked > 0, "「特になし」を持つ複数選択が1問も無い（判定が空振りしている）");
});

test("単一選択の none を排他扱いしていない（B-Q9 の「特に説明はなかった」）", () => {
  // 上のテストが value 一致に戻されると、B-Q9 が誤って排他にされる。
  const q9 = byCode(seed.questionsB, "Q9");
  assert.equal(q9.question_type, "single_choice");
  const none = (q9.question_config.options ?? []).find((o: Option) => o.value === "none");
  assert.ok(none, "B-Q9 に none が無い");
  assert.equal(none!.label, "特に説明はなかった");
  assert.ok(!none!.exclusive, "単一選択の選択肢に exclusive が付いている");
});

test("店舗開示設問の notice が画面の helpText と同一（利用規約 第9条3項）", () => {
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
  assert.equal(disclosed, 2, "開示設問は A-Q12（鍼の経験）と A-Q13（伝えたいこと）の2件のはず");
});

test("自由記述の開示設問は任意回答（強制すると書きたくない人が詰まる）", () => {
  const q13 = byCode(seed.questionsA, "Q13");
  assert.equal(q13.question_type, "free_text_long");
  assert.equal(q13.is_required, false);
});

test("A-Q11 の value と業種テンプレの日数表キーが1対1で一致する", () => {
  const table = templateSrc.match(/ACUPUNCTURE_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(table, "ACUPUNCTURE_FREQUENCY_DAYS が見つかりません");

  const keys = [...(table[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((m) => m[1] ?? "").sort();
  const values = valuesOf(byCode(seed.questionsA, "Q11"))
    .filter((v) => v !== "undecided") // undecided は日数表ではなく undecided_days で扱う
    .sort();

  assert.deepEqual(keys, values, "A-Q11 の value と日数表のキーがズレている");
  assert.ok(keys.includes("undecided") === false, "undecided を日数表に入れてはいけない");
  // as_needed は「頻度」ではないが、表から漏らすと undecided_days に落ちて早すぎる
  assert.ok(keys.includes("as_needed"), "as_needed が日数表に無い（60日相当に落ちて早すぎる）");
});

test("業種テンプレの frequency_question_code が A に実在する", () => {
  const code = templateSrc.match(/frequency_question_code: "(\w+)"/)?.[1];
  assert.ok(code, "frequency_question_code が見つかりません");
  assert.ok(
    seed.questionsA.some((q) => q.question_code === code),
    `frequency_question_code=${code} が A に存在しない`
  );
});

test("送付日が通院予定間隔の2回分程度（本人の計画なので飲食ほど倍率を取らない）", () => {
  // 飲食の A-Q11 は「外食全体の頻度」で3倍を取ったが、鍼灸は「この院に通う計画」
  // なので申告値がそのまま再来院予定になる。倍率は小さくてよい。
  const block = templateSrc.match(/ACUPUNCTURE_FREQUENCY_DAYS = \{([\s\S]*?)\};/);
  assert.ok(block, "ACUPUNCTURE_FREQUENCY_DAYS が見つかりません");
  const days = [...(block[1] ?? "").matchAll(/^\s*\w+: (\d+),/gm)].map((m) => Number(m[1]));
  assert.ok(days.length >= 6, "日数表の件数が足りません");

  // 週2回以上の人に2週間も空けずに送ると「まだ来ていないだけ」を拾う
  assert.ok(Math.min(...days) >= 14, "最短が短すぎる（予定どおり来られない週を拾ってしまう）");
  // 離脱の理由を覚えているうちに聞く
  assert.ok(Math.max(...days) <= 150, "最長が長すぎる（離脱の理由を覚えていない）");
});

test("クールダウンが急性期の通院間隔より短い（週2回の通院を握り潰さない）", () => {
  const cooldown = Number(templateSrc.match(/restart_cooldown_days: (\d+)/)?.[1]);
  // サロンの25日のままだと急性期（週2回以上）の正常な再来院が
  // 「クールダウン中」と判定されて新しいサイクルが1本も立たない。
  assert.ok(
    cooldown <= 3,
    `restart_cooldown_days=${cooldown} では急性期の週2回通院を取りこぼす`
  );
});

test("計画未定の人へのCが遅すぎない（離脱予備軍なので早めに聞く）", () => {
  // 初回で計画が決まっていない人こそ離脱予備軍（B-Q9 の vague/none と重なる）。
  // ここを長くすると本人が理由を覚えていない。
  const undecided = Number(templateSrc.match(/undecided_days: (\d+)/)?.[1]);
  assert.ok(undecided > 0, "undecided_days が見つかりません");
  assert.ok(undecided <= 60, `undecided_days=${undecided} では離脱の理由を覚えていない`);
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

test("鍼灸固有の評価軸が入り、他業種固有の軸が残っていない", () => {
  const aspects = new Set(seed.ASPECTS.map(([v]) => v));
  for (const required of ["relief", "explanation", "interview", "plan", "gentleness"]) {
    assert.ok(aspects.has(required), `ASPECTS に ${required} が無い`);
  }
  for (const otherIndustry of ["taste", "speed", "portion", "durability", "design", "nail_care"]) {
    assert.ok(!aspects.has(otherIndustry), `ASPECTS に他業種固有の ${otherIndustry} が残っている`);
  }
});
