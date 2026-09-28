import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * screenGroup = 複数設問を1画面にまとめる指定（survey_question モード）。
 *
 * 守りたいこと:
 *   1. 同じ groupId の設問が1画面にまとまる（Q10 満足度 + Q11 その理由）
 *   2. まとめた画面では「画面内の全設問」を検証・保存・活性判定する
 *      → 落とすと同居設問の回答が静かに欠ける
 *   3. 次へ進む位置は「画面の最後の設問」から解く
 *      → 先頭設問基準だと同じ画面をもう一度描く無限ループになる
 *   4. 同じ groupId でも連続していなければまとめない
 *      → 分岐で飛んできた設問を巻き込んで表示順が壊れる
 *
 * grouping は survey.ejs 内のクライアント関数なので、ソースから関数だけを
 * 取り出して実際に動かす（文字列マッチだと「関数を使うのをやめた」再発を検出できない）。
 */

const ROOT = path.join(__dirname, "..", "..");
const SURVEY_EJS = fs.readFileSync(
  path.join(ROOT, "src", "views", "liff", "survey.ejs"),
  "utf8"
);

/** survey.ejs から grouping 関数群を切り出して評価する。 */
function loadGroupingFns() {
  const start = SURVEY_EJS.indexOf("function screenGroupIdOf(");
  const endMarker = "  // ---- pipe 条件式の簡易評価 ----";
  const end = SURVEY_EJS.indexOf(endMarker);
  assert.ok(start > 0, "screenGroupIdOf が survey.ejs に無い");
  assert.ok(end > start, "grouping 関数ブロックの終端が見つからない");
  const src = SURVEY_EJS.slice(start, end);
  const factory = new Function(
    `${src}; return { screenGroupIdOf, groupByScreen, screenQuestionsAt, screenStartIndex };`
  );
  return factory() as {
    screenGroupIdOf: (q: unknown) => string | null;
    groupByScreen: (l: unknown[]) => Array<{ groupId: string | null; title: string | null; questions: Array<{ question_code: string }> }>;
    screenQuestionsAt: (l: unknown[], i: number) => Array<{ question_code: string }>;
    screenStartIndex: (l: unknown[], i: number) => number;
  };
}

const q = (code: string, groupId?: string, title?: string) => ({
  question_code: code,
  display_tags_parsed: groupId ? { screenGroup: { groupId, ...(title ? { title } : {}) } } : null,
});

// 本番の美容室/コーヒー案件と同じ形: Q10(満足度) と Q11(その理由) が satisfaction
const REAL = [
  q("Q9"), q("Q10", "satisfaction"), q("Q11", "satisfaction"), q("Q12"),
];

test("同じ groupId の連続設問が1画面にまとまる", () => {
  const { groupByScreen } = loadGroupingFns();
  const screens = groupByScreen(REAL);
  assert.equal(screens.length, 3, "Q9 / [Q10+Q11] / Q12 の3画面になるはず");
  assert.deepEqual(screens[1]?.questions.map((x) => x.question_code), ["Q10", "Q11"]);
});

test("groupId 未設定の設問は従来どおり1問1画面", () => {
  const { groupByScreen } = loadGroupingFns();
  const screens = groupByScreen([q("Q1"), q("Q2"), q("Q3")]);
  assert.equal(screens.length, 3);
  for (const s of screens) assert.equal(s.questions.length, 1);
});

test("画面内のどの設問から引いても同じ画面の全設問が返る（=全問を検証・保存できる）", () => {
  const { screenQuestionsAt } = loadGroupingFns();
  // Q10(index1) からも Q11(index2) からも [Q10, Q11] が返ること。
  for (const idx of [1, 2]) {
    assert.deepEqual(
      screenQuestionsAt(REAL, idx).map((x) => x.question_code),
      ["Q10", "Q11"],
      `index=${idx} で画面内の全設問が返らない`
    );
  }
});

test("グループ途中に着地しても先頭へ寄せる（設問が欠けた画面を出さない）", () => {
  const { screenStartIndex } = loadGroupingFns();
  assert.equal(screenStartIndex(REAL, 2), 1, "Q11 に着地したら Q10 へ寄せる");
  assert.equal(screenStartIndex(REAL, 1), 1);
  assert.equal(screenStartIndex(REAL, 0), 0, "グループ外は動かさない");
});

test("同じ groupId でも連続していなければまとめない", () => {
  const { groupByScreen } = loadGroupingFns();
  // 分岐で間に別設問が挟まったケース。まとめると表示順が壊れる。
  const screens = groupByScreen([q("Q10", "sat"), q("QX"), q("Q11", "sat")]);
  assert.equal(screens.length, 3, "離れた同名グループは別画面のままにする");
});

test("groupId が空文字/空白なら未設定として扱う", () => {
  const { screenGroupIdOf } = loadGroupingFns();
  assert.equal(screenGroupIdOf(q("Q1", "  ")), null);
  assert.equal(screenGroupIdOf(q("Q1")), null);
  assert.equal(screenGroupIdOf(q("Q1", "satisfaction")), "satisfaction");
});

test("次へ進む位置は画面の最後の設問から解く（同じ画面の再描画を防ぐ）", () => {
  // 先頭設問(Q10)基準で解くと次は Q11 ＝ 同じ画面に戻ってしまう。
  assert.match(
    SURVEY_EJS,
    /screenNow\[screenNow\.length - 1\]/,
    "次位置を画面の最終設問から解いていない（同じ画面をもう一度描く）"
  );
});

test("画面内の全設問を保存する（同居設問の回答を落とさない）", () => {
  assert.match(
    SURVEY_EJS,
    /for \(const sq of screenQs\)[\s\S]{0,400}?submitAnswer\(sq\.question_code/,
    "画面内の全設問を保存していない"
  );
});

test("画面内の全設問が回答済みで初めて「次へ」が活性化する", () => {
  assert.match(
    SURVEY_EJS,
    /screenQuestionsAt\(visibleQs, cursor\)\.every\(isQuestionAnswered\)/,
    "同居設問の未回答を無視して次へ進めてしまう"
  );
});

test("グループ同居時は自動で次へ進まない（同居設問を飛ばさない）", () => {
  // big_slider 等は1問1画面前提で commit 時に自動遷移する。
  assert.match(
    SURVEY_EJS,
    /if \(screenGroupIdOf\(q\) !== null\) return;/,
    "グループ内で自動遷移を止めていない（同居設問が飛ばされる）"
  );
});
