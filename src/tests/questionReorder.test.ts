/**
 * questionReorder.test.ts
 *
 * 設問の並べ替え API（POST /admin/api/projects/:projectId/questions/reorder）の回帰テスト。
 *
 * 背景:
 *   設問一覧は読み取り専用の表で、並べ替える手段が無かった。フロー設計にも
 *   ノードをドラッグする実装はあったが、mouseup が dragState を捨てるだけで
 *   位置も sort_order も保存しておらず、リロードすると必ず元に戻っていた
 *   （＝ドラッグでの並べ替えは機能として存在しなかった）。
 *
 * ここで固定したい契約:
 *   1. 渡された並び順どおりに sort_order が 1..n で詰め直される
 *   2. 画面に出ないシステム設問（自由記述など）は並びの後ろに温存される。
 *      落とすと sort_order に欠番が残り、次の設問を sort_order で決める
 *      determineNextQuestion の遷移がずれる。
 *   3. 他案件の設問IDを混ぜても書き換えられない（案件をまたいだ改竄の防止）
 *   4. 同じIDの重複を弾く（片方が並びから落ちて順序が壊れるため）
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, beforeEach, test } from "node:test";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const PROJECT_ID = "00000000-0000-4000-8000-0000000000a1";

let adminController: typeof import("../controllers/adminController").adminController;
let questionRepository: typeof import("../repositories/questionRepository").questionRepository;

/** reorderByIds に渡った引数を記録する */
let reordered: { projectId: string; orderedIds: string[] } | null;

function makeQuestion(id: string, code: string, sortOrder: number, isHidden = false) {
  return {
    id,
    project_id: PROJECT_ID,
    question_code: code,
    question_text: `${code} の設問文`,
    question_type: "single_choice",
    sort_order: sortOrder,
    is_hidden: isHidden,
    is_system: isHidden
  };
}

/** q1..q3 が表示設問、__free_comment__ が画面に出ないシステム設問。 */
const PROJECT_QUESTIONS = [
  makeQuestion("q1", "Q1", 1),
  makeQuestion("q2", "Q2", 2),
  makeQuestion("q3", "Q3", 3),
  makeQuestion("sys", "__free_comment__", 4, true)
];

/** res のふりをして status / json を記録する最小のスタブ。 */
function makeRes() {
  const captured: { status: number; body: unknown } = { status: 200, body: null };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    }
  };
  return { res, captured };
}

function makeReq(orderedIds: unknown) {
  return { params: { projectId: PROJECT_ID }, body: { orderedIds } };
}

before(async () => {
  ({ adminController } = await import("../controllers/adminController"));
  ({ questionRepository } = await import("../repositories/questionRepository"));
});

beforeEach(() => {
  reordered = null;

  questionRepository.listByProject = (async () =>
    PROJECT_QUESTIONS) as unknown as typeof questionRepository.listByProject;

  questionRepository.reorderByIds = (async (projectId: string, orderedIds: string[]) => {
    reordered = { projectId, orderedIds };
  }) as unknown as typeof questionRepository.reorderByIds;
});

test("渡した並び順どおりに sort_order を詰め直す", async () => {
  const { res, captured } = makeRes();
  // q3 を先頭へ持ってくる（一覧でいちばん下を上へドラッグした状態）
  await adminController.apiReorderQuestions(
    makeReq(["q3", "q1", "q2"]) as never,
    res as never
  );

  assert.equal(captured.status, 200);
  assert.ok(reordered, "reorderByIds が呼ばれること");
  assert.equal(reordered?.projectId, PROJECT_ID);
  assert.deepEqual(
    reordered?.orderedIds.slice(0, 3),
    ["q3", "q1", "q2"],
    "受け取った並びがそのまま先頭に来ること"
  );
});

test("画面に出ないシステム設問は並びの後ろに温存される", async () => {
  const { res } = makeRes();
  await adminController.apiReorderQuestions(
    makeReq(["q3", "q1", "q2"]) as never,
    res as never
  );

  assert.deepEqual(
    reordered?.orderedIds,
    ["q3", "q1", "q2", "sys"],
    "並べ替え対象に入っていないシステム設問が末尾に連結されること"
  );
});

test("他案件の設問IDが混ざっていたら 400 で拒否する", async () => {
  const { res, captured } = makeRes();
  await adminController.apiReorderQuestions(
    makeReq(["q1", "other-project-question"]) as never,
    res as never
  );

  assert.equal(captured.status, 400);
  assert.equal(reordered, null, "1件も書き換えないこと");
});

test("同じ設問IDが重複していたら 400 で拒否する", async () => {
  const { res, captured } = makeRes();
  await adminController.apiReorderQuestions(
    makeReq(["q1", "q2", "q1"]) as never,
    res as never
  );

  assert.equal(captured.status, 400);
  assert.equal(reordered, null, "1件も書き換えないこと");
});

test("orderedIds が空・配列でないときは 400 で拒否する", async () => {
  for (const bad of [[], "q1", null, undefined]) {
    const { res, captured } = makeRes();
    await adminController.apiReorderQuestions(makeReq(bad) as never, res as never);
    assert.equal(captured.status, 400, `${JSON.stringify(bad)} は拒否されること`);
    assert.equal(reordered, null);
  }
});

// ─────────────────────────────────────────────────────────────
// フロー設計：ドラッグした結果が保存されること
//
// flowCanvas.js はブラウザ専用（DOM 依存）なので、配線をソース上で固定する。
// 以前の mouseup は dragState を捨てるだけで、位置も sort_order も保存して
// いなかった。そのためドラッグは見た目が動くだけで、リロードすると必ず元へ
// 戻っていた（＝ドラッグでの入れ替えが成立していなかった）。
// 「保存呼び出しを消す」形の再発は純粋な単体テストでは検出できない。
// ─────────────────────────────────────────────────────────────

/** このリポジトリのファイルは CRLF。LF に揃えてから検索する。 */
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}

const flowCanvasSrc = readSrc("src/public/flowCanvas.js");
const indexDesignerSrc = readSrc("src/views/admin/questions/indexDesigner.ejs");

test("フロー設計: ノードを離したら並び順の保存へ進む", () => {
  const start = flowCanvasSrc.indexOf("document.addEventListener('mouseup'");
  assert.ok(start >= 0, "mouseup ハンドラが見つかりません");
  // ハンドラ本体だけを切り出す。固定長で切ると下にある commitDragReorder の
  // 「定義」まで含んでしまい、呼び出しを消してもテストが通ってしまう（実際に起きた）。
  const end = flowCanvasSrc.indexOf("\n  });\n", start);
  assert.ok(end > start, "mouseup ハンドラの終端が見つかりません");
  const body = flowCanvasSrc.slice(start, end);
  assert.ok(
    /dragState\.moved/.test(body) && /commitDragReorder\(/.test(body),
    "mouseup が commitDragReorder を呼んでいません（ドラッグしても並び順が保存されません）"
  );
});

test("フロー設計: 並び順は縦位置の順で決まり、reorder API へ送られる", () => {
  const start = flowCanvasSrc.indexOf("async function commitDragReorder(");
  assert.ok(start >= 0, "commitDragReorder の定義が見つかりません");
  const body = flowCanvasSrc.slice(start, flowCanvasSrc.indexOf("\n  }\n", start));

  assert.ok(/nodePositions\[/.test(body), "縦位置（nodePositions）から並びを決めていません");
  assert.ok(
    /questions\/reorder/.test(body),
    "reorder API を叩いていません（一覧と別の保存経路を作らないこと）"
  );
  assert.ok(
    /__start__|__end__/.test(body),
    "開始/終了ノードを除外していません（設問ではないので並び順を持ちません）"
  );
  assert.ok(
    /await flushPendingEdits\(\)/.test(body),
    "保存前に flushPendingEdits を通していません（再描画で編集中の入力が消えます）"
  );
  assert.ok(
    /q\.sort_order = i \+ 1/.test(body),
    "手元の sort_order を更新していません（保存済みでも毎回 POST が飛びます）"
  );
});

test("設問一覧: ドラッグ直後ではなく保存ボタンで確定させる", () => {
  // 離した瞬間に保存すると、掴み損ねただけで本番の設問順が変わる
  assert.ok(
    /id="reorderSaveBtn"/.test(indexDesignerSrc),
    "並び順の保存ボタンがありません"
  );
  const dropStart = indexDesignerSrc.indexOf("tbody.addEventListener('drop'");
  assert.ok(dropStart >= 0, "drop ハンドラが見つかりません");
  const dropBody = indexDesignerSrc.slice(dropStart, dropStart + 700);
  assert.ok(
    !/questions\/reorder/.test(dropBody),
    "drop の中で保存してしまっています（確認なしで並び順が変わります）"
  );
});

test("設問一覧: 一覧とフローが同じ reorder API を使う", () => {
  assert.ok(
    /questions\/reorder/.test(indexDesignerSrc) && /questions\/reorder/.test(flowCanvasSrc),
    "一覧とフローで保存経路が分かれています（片方だけ直す事故が起きます）"
  );
});

// ─────────────────────────────────────────────────────────────
// 詳細ページ右カラム（プレビュー）の貼り付き
//
// sticky は「親の箱の中」しか移動できない。grid の align-items:start だと
// 右カラム(aside)が中身の高さまでしか伸びず、その高さを超えてスクロールした
// 時点でプレビューが一緒に流れて画面から消えていた（実機で発覚）。
// top も固定値だと sticky なヘッダーの裏に潜る。
// ─────────────────────────────────────────────────────────────

const formV3Src = readSrc("src/views/admin/questions/formV3.ejs");

test("右カラムは中身の高さで切り上げない（sticky の可動域を潰さない）", () => {
  const m = formV3Src.match(/\.qedit-layout \{[^}]*\}/);
  assert.ok(m, ".qedit-layout の定義が見つかりません");
  assert.ok(
    !/align-items:\s*start/.test(m[0]),
    "align-items:start だと aside が中身の高さで止まり、途中でプレビューが流れて消えます"
  );
});

test("プレビューはヘッダーの高さを避けて貼り付く", () => {
  const m = formV3Src.match(/\.qedit-preview-inner \{[^}]*\}/);
  assert.ok(m, ".qedit-preview-inner の定義が見つかりません");
  assert.ok(
    /top:\s*calc\(var\(--admin-header-h/.test(m[0]),
    "top が --admin-header-h 基準ではありません（ヘッダーの裏に潜ります）"
  );
  assert.ok(
    /max-height:\s*calc\(100vh - var\(--admin-header-h/.test(m[0]),
    "max-height がヘッダー分を引いていません（下端が画面の外へ出ます）"
  );
});

test("プレビューのiframeは枠より高くならない", () => {
  const m = formV3Src.match(/\.qedit-preview-stage iframe \{[^}]*\}/);
  assert.ok(m, ".qedit-preview-stage iframe の定義が見つかりません");
  assert.ok(
    /min-height:\s*0/.test(m[0]),
    "固定の min-height があると画面が低いとき下端（次へボタン）がはみ出します"
  );
});

test("新規作成でも保存後の遷移先の指定を尊重する", () => {
  const src = readSrc("src/controllers/adminController.ts");
  const start = src.indexOf("async createQuestion(");
  assert.ok(start >= 0, "createQuestion が見つかりません");
  const body = src.slice(start, start + 4000);
  assert.ok(
    /sanitizeAdminRedirect\(req\.body\._redirect_to\)/.test(body),
    "createQuestion が _redirect_to を見ていません（新規作成中だけ一覧へ戻れなくなります）"
  );
});

test("ドラッグ中は端で自動スクロールし、落下位置を線で示す", () => {
  assert.ok(
    /function autoScrollWhileDragging\(/.test(flowCanvasSrc),
    "自動スクロールがありません（画面外の位置へは設問を運べません）"
  );
  assert.ok(
    /function showDropIndicator\(/.test(flowCanvasSrc),
    "落下位置の表示がありません（離すまで結果が分かりません）"
  );
  assert.ok(
    /autoScrollWhileDragging\(e\.clientY\)/.test(flowCanvasSrc),
    "mousemove から自動スクロールが呼ばれていません"
  );
});
