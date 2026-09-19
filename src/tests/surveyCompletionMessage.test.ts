import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * 送信完了画面のお礼文 (Migration 108)。
 *
 * 守りたいこと:
 *   お礼は「送信し終えた画面」に出す。設問の comment_bottom に書くと、
 *   設問の下＝まだ送信していない画面に出てしまい、回答者からは
 *   「お礼が出たのに、まだ送信ボタンを押していない」状態に見える。
 *
 * ここはビューとシードの"置き場所"を固定するテストなので、DOM ではなくソースを見る。
 * 実描画（見た目・2経路の出し分け）は Playwright 側で確認している。
 */

const ROOT = path.join(__dirname, "..", "..");
const SURVEY_EJS = fs.readFileSync(
  path.join(ROOT, "src", "views", "liff", "survey.ejs"),
  "utf8"
);
const SALON_SEED = fs.readFileSync(
  path.join(ROOT, "scripts", "seedSalonSurveyProjects.mjs"),
  "utf8"
);

test("完了画面に案件ごとのお礼文を差し込む口がある", () => {
  // サーバーから渡す口
  assert.match(
    SURVEY_EJS,
    /const COMPLETION_MESSAGE = /,
    "completionMessage をビューへ渡す定数が無い"
  );
  // 差し込み先の要素
  assert.match(
    SURVEY_EJS,
    /id="completeMessage"/,
    "お礼文の差し込み先 #completeMessage が無い"
  );
});

test("お礼文は textContent で入れる（案件文言をHTMLとして解釈しない）", () => {
  const fn = SURVEY_EJS.match(
    /function renderCompletionMessage\(\)[\s\S]*?\n    \}/
  );
  assert.ok(fn, "renderCompletionMessage が無い");
  assert.match(fn[0], /\.textContent = msg/, "textContent で入れていない");
  assert.doesNotMatch(
    fn[0],
    /\.innerHTML\s*=/,
    "innerHTML を使うと案件文言がHTMLとして解釈される"
  );
});

test("完了は2経路あるので、両方でお礼文を出す", () => {
  // survey_question 経路
  assert.match(
    SURVEY_EJS,
    /renderCompletionMessage\(\);/,
    "survey_question 経路でお礼文を出していない"
  );
  // interview_chat 経路（addBubble で出す）
  assert.match(
    SURVEY_EJS,
    /if \(COMPLETION_MESSAGE && COMPLETION_MESSAGE\.trim\(\)\) \{\s*\n\s*addBubble\(/,
    "interview_chat 経路でお礼文を出していない（片方だけ直すと不揃いになる）"
  );
});

test("未設定の案件は従来どおり汎用文で終わる", () => {
  const fn = SURVEY_EJS.match(
    /function renderCompletionMessage\(\)[\s\S]*?\n    \}/
  );
  assert.ok(fn);
  // 空なら何もせず return ＝ #completeMessage は display:none のまま、
  // 汎用の .complete-sub が残る。
  assert.match(fn[0], /if \(!msg\) return;/, "未設定時に早期 return していない");
});

test("美容室ABCの設問にお礼文を戻さない（comment_bottom に置かない）", () => {
  // これが本丸の回帰テスト。seed に comment_bottom が復活したら落ちる。
  const thanksInComment = /comment_bottom:\s*\n?\s*"[^"]*ありがとうございました/;
  assert.doesNotMatch(
    SALON_SEED,
    thanksInComment,
    "お礼が設問の comment_bottom に戻っている。" +
      "comment_bottom は送信前の画面に出るため、completion_message に置くこと"
  );
});

test("店舗アンケートの完了画面はポイ活CTAが主役（お礼で導線を壊さない）", () => {
  // お礼文を completeActions の前に入れたため、並べ替えが無いと
  // 「お礼 → LINEに戻る(離脱) → ポイ活CTA」になり、CTA到達前に離脱させてしまう。
  // 実コードは CTA を出したあと completeActions を completeError の直前へ移して
  // 「お礼 → CTA → LINEに戻る(控えめリンク)」にしている。その並べ替えを固定する。
  assert.match(
    SURVEY_EJS,
    /completeActions\.classList\.add\('complete-actions--secondary'\);[\s\S]*?completeScreen\.insertBefore\(completeActions, completeError\);/,
    "完了画面で completeActions を CTA の下へ移していない（離脱ボタンがCTAより上に出る）"
  );
});

test("お礼文はボタン群より前に置く（送信直後に読ませる）", () => {
  const msgAt = SURVEY_EJS.indexOf('id="completeMessage"');
  const actionsAt = SURVEY_EJS.indexOf('id="completeActions"');
  assert.ok(msgAt > 0 && actionsAt > 0);
  assert.ok(
    msgAt < actionsAt,
    "お礼文がボタン群より後ろにある（送信直後に読まれない）"
  );
});

