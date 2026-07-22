/**
 * adminViewFoundation.test.ts
 *
 * 管理画面の共通基盤（日時ヘルパ / ステータスラベル / フラッシュ）と、
 * 今回書き換えたビューが実際に EJS としてレンダリングできることを見る。
 *
 * ビューのレンダリングを含めているのは、EJS の構文エラーや変数の渡し忘れが
 * typecheck をすり抜けて本番の 500 になるため（過去に partials/liff-bottom-nav.ejs の
 * コメント内タグ入れ子で include 先が丸ごと 500 になった事例がある）。
 * DB には触らない。
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import ejs from "ejs";
import {
  formatDateTimeJst,
  formatDateJst,
  toDateTimeLocalJst,
  fromDateTimeLocalJst,
  formatRelativeJst,
  statusLabel,
  shortId,
  adminViewHelpers
} from "../lib/adminView";
import { redirectWithFlash, readFlashFromQuery } from "../lib/adminFlash";

const VIEWS_ROOT = path.join(process.cwd(), "src", "views");

// ---------------------------------------------------------------------------
// 日時ヘルパ
// ---------------------------------------------------------------------------

test("UTC の ISO 文字列を JST の壁時計時刻で表示する", () => {
  // 2026-07-22T00:30:00Z は JST では同日 09:30
  assert.equal(formatDateTimeJst("2026-07-22T00:30:00.000Z"), "2026/07/22 09:30 (JST)");
  // 日付境界: UTC 22日 15:00 は JST 23日 00:00
  assert.equal(formatDateJst("2026-07-22T15:00:00.000Z"), "2026/07/23");
});

test("空値・不正値はフォールバックを返す（生の ISO 文字列を漏らさない）", () => {
  assert.equal(formatDateTimeJst(null), "-");
  assert.equal(formatDateTimeJst(""), "-");
  assert.equal(formatDateTimeJst("not-a-date"), "-");
  assert.equal(formatDateJst(undefined, "未設定"), "未設定");
});

test("datetime-local は JST で往復しても値がずれない", () => {
  // 従来は toISOString().slice(0,16) を value に入れていたため、
  // 開いて保存し直すたびに9時間ずれ続けていた。
  const stored = "2026-07-22T00:30:00.000Z"; // JST 09:30
  const forInput = toDateTimeLocalJst(stored);
  assert.equal(forInput, "2026-07-22T09:30");

  const roundTripped = fromDateTimeLocalJst(forInput);
  assert.equal(roundTripped, stored);
});

test("datetime-local の空入力は null を返す", () => {
  assert.equal(fromDateTimeLocalJst(""), null);
  assert.equal(fromDateTimeLocalJst("   "), null);
  assert.equal(fromDateTimeLocalJst(undefined), null);
});

test("相対表示は経過時間の帯で切り替わる", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  assert.equal(formatRelativeJst("2026-07-22T11:59:30.000Z", now), "たった今");
  assert.equal(formatRelativeJst("2026-07-22T11:30:00.000Z", now), "30分前");
  assert.equal(formatRelativeJst("2026-07-22T09:00:00.000Z", now), "3時間前");
  assert.equal(formatRelativeJst("2026-07-20T12:00:00.000Z", now), "2日前");
});

// ---------------------------------------------------------------------------
// ステータスラベル
// ---------------------------------------------------------------------------

test("既知のコード値は日本語ラベルになる", () => {
  assert.equal(statusLabel("projectStatus", "published"), "LIFF掲載中");
  assert.equal(statusLabel("respondentStatus", "active"), "参加中");
  assert.equal(statusLabel("assignmentStatus", "undelivered"), "未配信");
  assert.equal(statusLabel("researchMode", "interview_chat"), "チャット型");
});

test("未知のコード値はそのまま返す（辞書の取りこぼしで画面が空にならない）", () => {
  assert.equal(statusLabel("projectStatus", "brand_new_status"), "brand_new_status");
  assert.equal(statusLabel("unknownKind", "whatever"), "whatever");
  assert.equal(statusLabel("projectStatus", null), "-");
});

test("shortId は UUID を先頭8桁に丸める", () => {
  assert.equal(shortId("ddde0000-0000-4000-8000-000000000001"), "ddde0000…");
  assert.equal(shortId(null), "-");
});

// ---------------------------------------------------------------------------
// フラッシュ
// ---------------------------------------------------------------------------

test("redirectWithFlash はメッセージをクエリに載せ、既存クエリを保持する", () => {
  const redirects: string[] = [];
  const res = { redirect: (url: string) => redirects.push(url) } as never;

  redirectWithFlash(res, "/admin/points?page=3", "保存しました。");
  const url = redirects[0] ?? "";
  assert.ok(url.startsWith("/admin/points?"));

  const params = new URLSearchParams(url.split("?")[1]);
  assert.equal(params.get("page"), "3");
  assert.equal(params.get("flash"), "保存しました。");
  assert.equal(params.get("flash_type"), "success");
});

test("readFlashFromQuery はメッセージが無ければ null を返す", () => {
  assert.equal(readFlashFromQuery({}), null);
  assert.equal(readFlashFromQuery({ flash: "   " }), null);

  const flash = readFlashFromQuery({ flash: "失敗しました", flash_type: "error" });
  assert.deepEqual(flash, { type: "error", message: "失敗しました" });
});

test("不正な flash_type は info に丸める（任意の文字列を type に入れさせない）", () => {
  const flash = readFlashFromQuery({ flash: "x", flash_type: "<script>" });
  assert.equal(flash?.type, "info");
});

// ---------------------------------------------------------------------------
// ビューのレンダリング
// ---------------------------------------------------------------------------

/** res.locals 相当（adminLocals ミドルウェアが配る値） */
function baseLocals(overrides: Record<string, unknown> = {}) {
  return {
    ...adminViewHelpers,
    adminFlash: null,
    currentPath: "/admin",
    adminUser: "admin",
    ...overrides
  };
}

async function render(view: string, data: Record<string, unknown>): Promise<string> {
  return ejs.renderFile(path.join(VIEWS_ROOT, view), data, { root: VIEWS_ROOT });
}

test("header: ナビが現在地を点灯させ、全ページへのリンクを持つ", async () => {
  const html = await render("partials/header.ejs", {
    ...baseLocals({ currentPath: "/admin/respondents" }),
    title: "回答者"
  });

  // 現在地
  assert.match(html, /class="is-active"[^>]*aria-current="page"/);
  // 従来ナビから漏れていて到達できなかった画面
  for (const href of [
    "/admin/user-profiles",
    "/admin/ai-logs",
    "/admin/delivery-templates",
    "/admin/scheduler-settings",
    "/admin/reward-campaigns",
    "/admin/daily-question-priorities"
  ]) {
    assert.ok(html.includes(`href="${href}"`), `${href} へのリンクが無い`);
  }
});

test("header: フラッシュメッセージはエスケープされて描画される", async () => {
  const html = await render("partials/header.ejs", {
    ...baseLocals({ adminFlash: { type: "error", message: '<img src=x onerror="alert(1)">' } }),
    title: "t"
  });

  assert.ok(html.includes('class="flash flash-error"'));
  // 生のタグとして出てはいけない
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
});

test("respondents 一覧: 日本語ラベル・空状態・ページングが出る", async () => {
  const html = await render("admin/respondents/index.ejs", {
    ...baseLocals(),
    title: "回答者",
    respondents: [],
    total: 0,
    page: 1,
    perPage: 50,
    totalPages: 1,
    projects: [{ id: "p1", name: "テスト案件" }],
    filters: { projectId: "", status: "", q: "" }
  });

  assert.ok(html.includes("条件に一致する回答者がいません"));
  assert.ok(html.includes("全 0 件"));
  // 旧実装の英語ヘッダが残っていないこと
  assert.ok(!html.includes("<th>Project</th>"));
  assert.ok(!html.includes(">Detail<"));
});

test("respondents 一覧: 生の ISO 文字列を出さず、ステータスを日本語化する", async () => {
  const html = await render("admin/respondents/index.ejs", {
    ...baseLocals(),
    title: "回答者",
    respondents: [
      {
        respondent: {
          id: "r1",
          display_name: "テスト太郎",
          line_user_id: "U1234567890abcdef",
          status: "active",
          total_points: 120,
          current_rank: { rank_name: "シルバー" }
        },
        project: { id: "p1", name: "テスト案件", research_mode: "interview_chat" },
        latestSession: { status: "completed", last_activity_at: "2026-07-22T00:30:00.000Z" },
        sessionCount: 2,
        completedSessionCount: 1
      }
    ],
    total: 1,
    page: 1,
    perPage: 50,
    totalPages: 1,
    projects: [],
    filters: { projectId: "", status: "", q: "" }
  });

  assert.ok(html.includes("参加中"));
  assert.ok(html.includes("チャット型"));
  assert.ok(html.includes("2026/07/22 09:30 (JST)"));
  assert.ok(!html.includes("2026-07-22T00:30:00.000Z"));
});

test("ページネーション: ページ番号を無制限に列挙せず窓で出す", async () => {
  const html = await render("partials/admin-pagination.ejs", {
    page: 25,
    totalPages: 50,
    total: 2500,
    basePath: "/admin/points",
    query: { q: "テスト" }
  });

  assert.ok(html.includes("全 2,500 件"));
  // 窓は前後2ページ
  for (const p of [23, 24, 25, 26, 27]) {
    assert.ok(html.includes(`>${p}<`), `${p} が窓に無い`);
  }
  assert.ok(!html.includes(">1<") || html.includes("«"), "全ページ列挙になっている");
  // 絞り込み条件がページ送りで失われない
  assert.ok(html.includes("q=%E3%83%86%E3%82%B9%E3%83%88"));
});

test("ランク設定: 生カラム名ではなく日本語ラベルで表示する", async () => {
  const html = await render("admin/ranks/index.ejs", {
    ...baseLocals(),
    title: "ランク設定",
    ranks: [
      { id: "r1", rank_name: "ブロンズ", min_points: 0, badge_label: "🥉" },
      { id: "r2", rank_name: "シルバー", min_points: 100, badge_label: "🥈" }
    ]
  });

  assert.ok(html.includes("必要ポイント（下限）"));
  assert.ok(html.includes("バッジ表示ラベル"));
  assert.ok(!html.includes(">min_points<"));
  // 破壊的操作なので確認を通す
  assert.ok(html.includes("confirmRankUpdate"));
});

// ---------------------------------------------------------------------------
// ページングの offset 丸め
// ---------------------------------------------------------------------------

/**
 * PostgREST は総件数を超える range を要求すると
 * 「Requested range not satisfiable」で失敗する（＝画面が 500 になる）。
 * リポジトリ／サービス側で使っている丸めの計算をここで固定しておく。
 */
function clampOffset(total: number, limit: number, requestedOffset: number): number {
  if (total === 0) return 0;
  const maxOffset = Math.max(0, Math.floor((total - 1) / limit) * limit);
  return Math.min(Math.max(0, requestedOffset), maxOffset);
}

test("範囲外のページ要求は最終ページの offset に丸める", () => {
  // 502件・50件/ページ → 11ページ（最終ページの offset は 500）
  assert.equal(clampOffset(502, 50, 9999 * 50), 500);
  assert.equal(clampOffset(502, 50, 0), 0);
  assert.equal(clampOffset(502, 50, 500), 500);
});

test("ちょうど割り切れる件数でも最終ページを飛び越さない", () => {
  // 100件・50件/ページ → 2ページ。offset 100 は存在しないので 50 に丸める
  assert.equal(clampOffset(100, 50, 100), 50);
  assert.equal(clampOffset(50, 50, 50), 0);
});

test("0件・負のページは offset 0 になる", () => {
  assert.equal(clampOffset(0, 50, 500), 0);
  assert.equal(clampOffset(10, 50, -100), 0);
});
