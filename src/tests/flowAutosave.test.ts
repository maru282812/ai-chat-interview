/**
 * flowAutosave.test.ts
 *
 * 「設問を渡り歩くと編集が消える／毎回保存を押さされる」の回帰テスト。
 *
 * 背景（実際に起きていたこと）:
 *   フロー設計画面の右パネルは DOM だけが編集バッファで、値は保存ボタンを
 *   押した瞬間に初めて読まれていた。別ノードを選ぶと innerHTML が丸ごと
 *   上書きされるため、入力は無警告で消えた（dirty 判定も下書きも無かった）。
 *
 *   さらに saveBranchRule() は DOM ではなく questions[]（＝最後にサーバから
 *   返った古い値）から payload を組んでいたため、「設問文を書き換えた直後に
 *   線を引く」と書き換え前の値でサーバを上書きし、変更が黙って消えていた。
 *   画面には新しい文字が残るので気付く手段が無い。
 *
 * ここでは flowCanvas.js（ブラウザ専用・DOM 依存）の配線をソース上で固定する。
 * 純関数だけのテストでは「その仕組みを使うのをやめる」形の再発を検出できない。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { sanitizeAdminRedirect } from "../controllers/adminController";

/**
 * このリポジトリのファイルは CRLF。改行を前提にした検索は LF に揃えてから行う
 * （揃えずに "\n  }" を探すと一致0件になり、テストが黙って空振りする）。
 */
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}

const flowCanvasSrc = readSrc("src/public/flowCanvas.js");
const formV3Src = readSrc("src/views/admin/questions/formV3.ejs");

/** 関数本体をざっくり切り出す（次のトップレベル定義まで）。 */
function sliceFn(src: string, marker: string, len = 2500): string {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `${marker} が見つかりません`);
  return src.slice(start, start + len);
}

/**
 * 関数本体だけを正確に切り出す。
 *
 * 固定長で切ると隣の関数まで含んでしまい、「その関数から呼び出しを消しても
 * 隣に同じ呼び出しがあるのでテストが通る」という空振りが起きる（実際に起きた）。
 * インデント2の閉じ括弧を終端として本体を確定させる。
 */
function fnBody(src: string, marker: string): string {
  // 同じ名前が別の関数の中から呼ばれている場合があるので、
  // 行頭インデント2の「定義」を狙って探す（先頭一致だと呼び出し側を掴む）。
  const start = src.indexOf(`\n  ${marker}`);
  assert.ok(start >= 0, `${marker} の定義が見つかりません`);
  const end = src.indexOf("\n  }\n", start);
  assert.ok(end > start, `${marker} の終端が見つかりません`);
  return src.slice(start, end);
}

// ─── ノード切替時の自動保存 ────────────────────────────────

test("ノードを切り替える前に編集内容をサーバへ逃がす", () => {
  const body = fnBody(flowCanvasSrc, "async function selectNode(");
  assert.ok(
    /await flushPendingEdits\(\)/.test(body),
    "selectNode が flushPendingEdits を通していません（別ノードを選ぶと編集が消えます）",
  );
});

test("選択を外すときも編集内容を逃がす", () => {
  const body = fnBody(flowCanvasSrc, "async function clearSelection(");
  assert.ok(
    /await flushPendingEdits\(\)/.test(body),
    "clearSelection が flushPendingEdits を通していません（背景クリックで編集が消えます）",
  );
});

test("差分が無いときはサーバへ保存要求を出さない", () => {
  const body = fnBody(flowCanvasSrc, "async function doFlush(");
  assert.ok(
    /isDirtyAgainstBaseline\(payload\)/.test(body),
    "doFlush が差分判定を通していません（変更なしでも POST が飛び「保存しました」が連打されます）",
  );
});

test("必須未入力なら保存せず下書きに退避し、移動は止めない", () => {
  const body = fnBody(flowCanvasSrc, "async function doFlush(");
  // 必須が空のときは postQuestion ではなく writeDraft へ分岐する
  assert.ok(
    /!payload\.question_text \|\| \(payload\.ai_probe_enabled && !payload\.question_goal\)/.test(body),
    "必須未入力の分岐がありません",
  );
  const guardIdx = body.indexOf("!payload.question_text ||");
  const branch = body.slice(guardIdx, guardIdx + 400);
  assert.ok(
    /writeDraft\(targetId, payload\)/.test(branch),
    "必須未入力のとき下書きへ退避していません（書きかけが失われます）",
  );
  assert.ok(
    !/throw|return true/.test(branch),
    "必須未入力で移動をブロックしています（作業の手が止まります）",
  );
});

test("右パネル描画時に差分判定の基準を取り直す", () => {
  const body = sliceFn(flowCanvasSrc, "function showRightPanel(q)", 4000);
  assert.ok(
    /rpBaseline = collectRpData\(\)/.test(body),
    "showRightPanel が rpBaseline を設定していません（差分判定が常に誤ります）",
  );
});

// ─── 事故A: 線を引くと編集が巻き戻る ───────────────────────

test("線をつなぐ前に編集内容を確定させる（編集が巻き戻らない）", () => {
  const body = sliceFn(flowCanvasSrc, "async function applyConnection(", 3000);
  const flushIdx = body.indexOf("await flushPendingEdits()");
  // 冒頭のコメントにも関数名が出るので、実際の呼び出し行を探す
  const saveIdx = body.indexOf("\n    saveBranchRule(");
  assert.ok(flushIdx >= 0, "applyConnection が flushPendingEdits を通していません");
  assert.ok(
    flushIdx < saveIdx,
    "flushPendingEdits が saveBranchRule より後です（古い値で上書きされます）",
  );
});

test("線を消す前にも編集内容を確定させる", () => {
  const body = sliceFn(flowCanvasSrc, "async function deleteSelectedConnection(", 3000);
  const flushIdx = body.indexOf("await flushPendingEdits()");
  const saveIdx = body.indexOf("\n    saveBranchRule(");
  assert.ok(flushIdx >= 0, "deleteSelectedConnection が flushPendingEdits を通していません");
  assert.ok(flushIdx < saveIdx, "flushPendingEdits が saveBranchRule より後です");
});

// ─── 事故B: 回答形式変更で型別入力が消える ─────────────────

test("回答形式を変えて入力済み設定が消える前に確認する", () => {
  const body = sliceFn(flowCanvasSrc, "if (e.target.id !== 'rp-question_type') return;", 1200);
  assert.ok(
    /typeSpecificHasInput\(typeArea\)/.test(body) && /confirm\(/.test(body),
    "型変更時の確認がありません（matrix の行列などが復元不能に消えます）",
  );
  assert.ok(
    /e\.target\.value = prevType/.test(body),
    "確認をキャンセルしても select が元に戻りません",
  );
});

// ─── 下書き（localStorage） ────────────────────────────────

test("下書きはプロジェクト・設問ごとに分けて保存する", () => {
  assert.ok(
    /const DRAFT_PREFIX = 'hibi:flow:draft:' \+ DATA\.projectId \+ ':'/.test(flowCanvasSrc),
    "下書きキーがプロジェクト単位で分かれていません（別案件の下書きが混ざります）",
  );
  const body = sliceFn(flowCanvasSrc, "function draftKey(", 300);
  assert.ok(/DRAFT_PREFIX \+ questionId/.test(body), "下書きキーに設問IDが含まれていません");
});

test("下書きは自動復元せず、必ずユーザーに選ばせる", () => {
  const body = sliceFn(flowCanvasSrc, "function maybeShowDraftBanner(", 2000);
  assert.ok(/rp-draft-restore/.test(body), "復元ボタンがありません");
  assert.ok(/rp-draft-discard/.test(body), "破棄ボタンがありません");
  // バナーを出さずいきなり値を流し込む形になっていないこと
  const restoreIdx = body.indexOf("applyDraftToPanel");
  const clickIdx = body.indexOf("addEventListener('click'");
  assert.ok(
    clickIdx >= 0 && clickIdx < restoreIdx,
    "下書きが自動復元されています（古い値が勝手に入ります）",
  );
});

test("サーバ保存に成功したときだけ下書きを捨てる", () => {
  const body = fnBody(flowCanvasSrc, "async function doFlush(");
  // 保存結果を受け取り、その値そのもので分岐していること。
  // 定数で握りつぶす（if (true) 等）と失敗時にも下書きが消えて書きかけが失われる。
  assert.ok(
    /var ok = await postQuestion\(/.test(body),
    "保存結果を受け取っていません",
  );
  assert.ok(
    /if \(ok\) \{[\s\S]{0,200}clearDraft\(targetId\)/.test(body),
    "保存成功時に下書きを消していません",
  );
  assert.ok(
    /\} else \{[\s\S]{0,200}writeDraft\(targetId, payload\)/.test(body),
    "保存失敗時に下書きへ退避していません（失敗すると書きかけが失われます）",
  );
});

// ─── 詳細編集ページの前後ナビ ──────────────────────────────

test("前後の設問へ移動するとき、破棄の確認ではなく保存してから移動する", () => {
  const body = sliceFn(formV3Src, "function navigateTo(href)", 1600);
  assert.ok(
    !/保存せずに移動しますか/.test(body),
    "「保存せずに移動しますか？」の確認が残っています（毎回押させられます）",
  );
  assert.ok(
    /mainForm\.requestSubmit\(\)/.test(body),
    "移動前に保存していません",
  );
  assert.ok(
    /_redirect_to/.test(body),
    "移動先をサーバへ渡していません（保存後に元の画面へ戻ってしまいます）",
  );
});

test("保存できない入力では移動せずエラーを見せる", () => {
  const body = sliceFn(formV3Src, "function navigateTo(href)", 1600);
  assert.ok(
    /checkValidity\(\)/.test(body) && /reportValidity\(\)/.test(body),
    "移動前の検証がありません",
  );
  assert.ok(
    /updateTabErrorBadges\(\)/.test(body),
    "どのタブにエラーがあるか示していません",
  );
});

test("保存後の遷移先はサーバ側でも検証する", () => {
  const body = sliceFn(
    // updateQuestion 内の redirect 箇所
    formV3Src.length > 0
      ? fs.readFileSync(path.join(process.cwd(), "src/controllers/adminController.ts"), "utf8")
      : "",
    "async updateQuestion(",
    12000,
  );
  assert.ok(
    /sanitizeAdminRedirect\(req\.body\._redirect_to\)/.test(body),
    "updateQuestion が遷移先を検証せず使っています（オープンリダイレクト）",
  );
});

// ─── 遷移先の検証（純関数） ────────────────────────────────

test("管理画面内の相対パスだけを許可する", () => {
  assert.equal(
    sanitizeAdminRedirect("/admin/questions/abc/edit"),
    "/admin/questions/abc/edit",
  );
  assert.equal(
    sanitizeAdminRedirect("/admin/projects/1/questions?notice=x"),
    "/admin/projects/1/questions?notice=x",
  );
  assert.equal(sanitizeAdminRedirect("/admin"), "/admin");
});

test("外部へ飛ばす遷移先は拒否する", () => {
  // プロトコル相対 URL はブラウザが外部ホストとして解決する
  assert.equal(sanitizeAdminRedirect("//evil.com/steal"), null);
  assert.equal(sanitizeAdminRedirect("https://evil.com"), null);
  assert.equal(sanitizeAdminRedirect("http://evil.com"), null);
  // Windows 系パス区切りでの回避
  assert.equal(sanitizeAdminRedirect("/\\evil.com"), null);
});

test("管理画面の外を指す遷移先は拒否する", () => {
  assert.equal(sanitizeAdminRedirect("/liff/survey"), null);
  assert.equal(sanitizeAdminRedirect("/adminsomething"), null);
  assert.equal(sanitizeAdminRedirect(""), null);
  assert.equal(sanitizeAdminRedirect(undefined), null);
  assert.equal(sanitizeAdminRedirect(123), null);
});

// ─── 「知りたいこと」を深掘り時だけ必須にする ──────────────
//
// 既存設問 238 件中 192 件（81%）は question_goal が空だった。
// これを無条件必須にすると、その 8 割を編集するたび保存が 400 で弾かれ、
// 自動保存が事実上効かない（＝「保存されない」体験がそのまま残る）。
// 詳細編集画面は元から AI 深掘り ON のときだけ必須にしていた（syncProbeOptions）。

test("深掘りを使わない設問では知りたいことを必須にしない", () => {
  const src = readSrc("src/controllers/adminController.ts");
  const body = sliceFn(src, "apiUpdateQuestionFlow", 3000);
  assert.ok(
    /aiProbeEnabled && !questionGoal/.test(body),
    "question_goal を無条件必須にしています（既存設問の自動保存が全滅します）",
  );
  assert.ok(
    !/if \(!questionGoal\) \{/.test(body),
    "無条件の question_goal 必須チェックが残っています",
  );
});

test("知りたいことが空で送られても既存値を消さない", () => {
  const src = readSrc("src/controllers/adminController.ts");
  const body = sliceFn(src, "apiUpdateQuestionFlow", 3000);
  // ?? だけだと空文字が「指定あり」と扱われ、既存値を空で上書きする
  assert.ok(
    /String\(body\.question_goal \?\? ""\)\.trim\(\) \|\| String\(existingMeta\.research_goal \?\? ""\)\.trim\(\)/.test(body),
    "空文字が既存の research_goal を上書きします",
  );
});

test("未完成バッジは保存できない設問にだけ出す", () => {
  const body = sliceFn(flowCanvasSrc, "var researchGoal =", 400);
  assert.ok(
    /q\.ai_probe_enabled && !String\(researchGoal\)\.trim\(\)/.test(body),
    "深掘りを使わない設問にも未完成バッジが出ます（8割が警告まみれになります）",
  );
});
