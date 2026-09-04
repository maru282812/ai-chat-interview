/**
 * adminScreenCatalog.test.ts
 *
 * 画面カタログ（src/lib/adminScreenCatalog.ts）と実際の Express ルート定義を
 * **双方向**に突き合わせる。台帳はコード内定数なので、放っておくと必ず陳腐化する。
 * 「新画面を足したのに台帳へ書き忘れた」「ルートを消したのに台帳に残っている」を
 * ここで落とすのが台帳鮮度の生命線。
 *
 * ページ扱いしないもの（＝カタログ対象外）:
 * - `/api/*`（JSON API）
 * - `.csv` / `.png` / `.json` / `.zip`（エクスポート・画像）
 * - `/login`（認証前。ナビも出ない）
 * - 拡張子は無いが `res.json` を返す JSON API（下の JSON_API_PATHS）
 *
 * DB には触らない。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { adminRoutes } from "../routes/adminRoutes";
import {
  ADMIN_SCREENS,
  buildNavGroups,
  buildPinnedNavItems,
  getScreenByKey,
  resolveScreenByPath
} from "../lib/adminScreenCatalog";

/**
 * 拡張子を持たないが `res.json` を返すため「画面」ではないルート。
 * ここに足すときは adminController の実装が res.json であることを確認する
 * （res.render に変わったなら台帳へ載せる側が正しい）。
 */
const JSON_API_PATHS = new Set([
  "/exchange-requests/pending-count",
  "/projects/:projectId/validate",
  "/projects/:projectId/snapshots",
  "/projects/:projectId/exports/stat/status-counts",
  "/projects/:projectId/exports/stat/history"
]);

const NON_PAGE_EXTENSIONS = [".csv", ".png", ".json", ".zip"];

/** Express router stack から admin の GET ページルートを列挙する（`/admin` 込みのパスで返す）。 */
function listAdminGetPagePaths(): string[] {
  const stack = (adminRoutes as unknown as { stack: Array<Record<string, any>> }).stack;
  const paths: string[] = [];
  for (const layer of stack) {
    const route = layer.route as { path?: unknown; methods?: Record<string, boolean> } | undefined;
    if (!route || typeof route.path !== "string") continue;
    if (!route.methods?.get) continue;

    const path = route.path;
    if (path === "/login") continue;
    if (path.startsWith("/api/")) continue;
    if (NON_PAGE_EXTENSIONS.some((ext) => path.endsWith(ext))) continue;
    if (JSON_API_PATHS.has(path)) continue;

    paths.push(path === "/" ? "/admin" : `/admin${path}`);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// 双方向突合
// ---------------------------------------------------------------------------

test("実在する admin の GET ページはすべてカタログに載っている（台帳漏れ）", () => {
  const catalogPaths = new Set(ADMIN_SCREENS.map((s) => s.path));
  const missing = listAdminGetPagePaths().filter((path) => !catalogPaths.has(path));

  assert.deepEqual(
    missing,
    [],
    `カタログに無いページがある。src/lib/adminScreenCatalog.ts に追記すること:\n${missing.join("\n")}`
  );
});

test("カタログのパスはすべて実在するルートに対応している（幽霊パス）", () => {
  const routePaths = new Set(listAdminGetPagePaths());
  const ghosts = ADMIN_SCREENS.map((s) => s.path).filter((path) => !routePaths.has(path));

  assert.deepEqual(
    ghosts,
    [],
    `実在しないパスがカタログに残っている。ルート定義と突き合わせて削除・修正すること:\n${ghosts.join("\n")}`
  );
});

test("ルート列挙とカタログの件数が一致する", () => {
  assert.equal(new Set(listAdminGetPagePaths()).size, ADMIN_SCREENS.length);
});

// ---------------------------------------------------------------------------
// エントリ自体の健全性
// ---------------------------------------------------------------------------

test("key が重複していない（screenKey は会話・監査ログの識別子）", () => {
  const seen = new Set<string>();
  const duplicated: string[] = [];
  for (const screen of ADMIN_SCREENS) {
    if (seen.has(screen.key)) duplicated.push(screen.key);
    seen.add(screen.key);
  }
  assert.deepEqual(duplicated, []);
});

test("path が重複していない", () => {
  const seen = new Set<string>();
  const duplicated: string[] = [];
  for (const screen of ADMIN_SCREENS) {
    if (seen.has(screen.path)) duplicated.push(screen.path);
    seen.add(screen.path);
  }
  assert.deepEqual(duplicated, []);
});

test("description が空のエントリが無い（AIの根拠テキストと検索の素材になる）", () => {
  const empty = ADMIN_SCREENS.filter((s) => s.description.trim().length === 0).map((s) => s.key);
  assert.deepEqual(empty, []);
});

test("label / group が空のエントリが無い", () => {
  const broken = ADMIN_SCREENS.filter(
    (s) => s.label.trim().length === 0 || s.group.trim().length === 0
  ).map((s) => s.key);
  assert.deepEqual(broken, []);
});

test("synonyms が空のエントリが無い（検索の言い換え素材）", () => {
  const empty = ADMIN_SCREENS.filter(
    (s) => s.synonyms.filter((v) => v.trim().length > 0).length === 0
  ).map((s) => s.key);
  assert.deepEqual(empty, []);
});

test("settings は詳細・確認系を除いて埋まっている", () => {
  // 「見るだけ」の画面（詳細・ログ・確認）は設定項目が無いのが正しいので、
  // 空を許すのはその種別に限る。それ以外で空なら書き忘れ。
  const readOnlyKeys = new Set([
    "dashboard",
    "project-prompt-package-history",
    "daily-survey-show",
    "daily-survey-analytics",
    "store-survey-flyer",
    "session-show",
    "ai-log-show",
    "prompt-packages-migration"
  ]);
  const empty = ADMIN_SCREENS.filter(
    (s) => !readOnlyKeys.has(s.key) && s.settings.filter((v) => v.trim().length > 0).length === 0
  ).map((s) => s.key);
  assert.deepEqual(empty, []);
});

test("related は実在する key しか指していない", () => {
  const dangling: string[] = [];
  for (const screen of ADMIN_SCREENS) {
    for (const key of screen.related) {
      if (!getScreenByKey(key)) dangling.push(`${screen.key} -> ${key}`);
    }
  }
  assert.deepEqual(dangling, []);
});

test("動的パスのエントリは dynamicParam を持つか nav:false である", () => {
  // `:param` を含むパスはナビに直接出せない（URL を組み立てられない）。
  const navWithParam = ADMIN_SCREENS.filter((s) => s.nav && s.path.includes("/:")).map((s) => s.key);
  assert.deepEqual(navWithParam, []);
});

// ---------------------------------------------------------------------------
// 既存 screenKey の固定（sessionStorage 会話キー・admin_ai_actions.screen_key 互換）
// ---------------------------------------------------------------------------

test("既存AIチャット4画面の screenKey とパスが変わっていない", () => {
  const expected: Array<[string, string]> = [
    ["research-form", "/admin/projects/:projectId/edit"],
    ["respondent-show", "/admin/respondents/:respondentId"],
    ["sessions-index", "/admin/sessions"],
    ["session-show", "/admin/sessions/:sessionId"]
  ];
  for (const [key, path] of expected) {
    const screen = getScreenByKey(key);
    assert.ok(screen, `screenKey "${key}" がカタログから消えている`);
    assert.equal(screen?.path, path);
  }
});

// ---------------------------------------------------------------------------
// resolveScreenByPath
// ---------------------------------------------------------------------------

test("静的パスを解決する", () => {
  assert.equal(resolveScreenByPath("/admin")?.key, "dashboard");
  assert.equal(resolveScreenByPath("/admin/cycles")?.key, "cycles-index");
  assert.equal(resolveScreenByPath("/admin/stores")?.key, "stores-index");
});

test("`:param` 付きパスを解決する", () => {
  assert.equal(
    resolveScreenByPath("/admin/projects/ddde0000-0000-4000-8000-000000000001/edit")?.key,
    "research-form"
  );
  assert.equal(resolveScreenByPath("/admin/sessions/abc-123")?.key, "session-show");
  assert.equal(resolveScreenByPath("/admin/clients/c-1/overview")?.key, "client-overview");
});

test("静的セグメントの多いエントリを優先する（/segments/campaigns が /segments/:id に負けない）", () => {
  assert.equal(resolveScreenByPath("/admin/segments/campaigns")?.key, "segments-campaigns-index");
  assert.equal(resolveScreenByPath("/admin/segments/new")?.key, "segment-new");
  assert.equal(resolveScreenByPath("/admin/prompt-packages/migration")?.key, "prompt-packages-migration");
  assert.equal(resolveScreenByPath("/admin/prompt-packages/pkg-1")?.key, "prompt-package-show");
});

test("クエリ文字列と末尾スラッシュを無視する", () => {
  assert.equal(resolveScreenByPath("/admin/sessions?page=3")?.key, "sessions-index");
  assert.equal(resolveScreenByPath("/admin/sessions/")?.key, "sessions-index");
  assert.equal(resolveScreenByPath("/admin/")?.key, "dashboard");
});

test("台帳に無いパス・空文字は null を返す（例外を投げない）", () => {
  assert.equal(resolveScreenByPath("/admin/api/ai-chat"), null);
  assert.equal(resolveScreenByPath("/liff/projects"), null);
  assert.equal(resolveScreenByPath(""), null);
});

// ---------------------------------------------------------------------------
// buildNavGroups
// ---------------------------------------------------------------------------

test("ナビは nav:true のエントリだけをグループ順に並べる", () => {
  const groups = buildNavGroups();
  const labels = groups.map((g) => g.label);
  assert.deepEqual(labels, ["調査", "店舗", "回答者", "報酬", "配信", "投稿・分析", "設定"]);

  const navCount = ADMIN_SCREENS.filter((s) => s.nav).length;
  assert.equal(
    groups.reduce((sum, g) => sum + g.items.length, 0),
    navCount
  );
});

test("旧ナビ（6グループ29項目）の全リンクがナビに残っている", () => {
  const hrefs = new Set(buildNavGroups().flatMap((g) => g.items.map((i) => i.href)));
  for (const href of [
    "/admin/projects",
    "/admin/daily-surveys",
    "/admin/daily-question-priorities",
    "/admin/pool-questions",
    "/admin/store-surveys",
    "/admin/respondents",
    "/admin/sessions",
    "/admin/user-profiles",
    "/admin/applications",
    "/admin/attributes",
    "/admin/points",
    "/admin/ranks",
    "/admin/badges",
    "/admin/reward-campaigns",
    "/admin/exchange-requests",
    "/admin/delivery-operations",
    "/admin/delivery-calendar",
    "/admin/segments",
    "/admin/delivery-templates",
    "/admin/notification-templates",
    "/admin/scheduler-settings",
    "/admin/posts",
    "/admin/post-analysis",
    "/admin/ai-analysis",
    "/admin/ai-logs",
    "/admin/data-management",
    "/admin/documents",
    "/admin/prompt-packages",
    "/admin/experience-settings",
    "/admin/quality-scoring"
  ]) {
    assert.ok(hrefs.has(href), `旧ナビにあった ${href} が消えている`);
  }
});

test("到達不能だった画面がナビか台帳から辿れる", () => {
  const navHrefs = new Set(buildNavGroups().flatMap((g) => g.items.map((i) => i.href)));
  // ナビから直接行けるようになったもの
  for (const href of [
    "/admin/stores",
    "/admin/cycles",
    "/admin/segments/campaigns",
    "/admin/prompt-packages/migration",
    "/admin/quality-scoring/recent",
    "/admin/ai-analysis/report"
  ]) {
    assert.ok(navHrefs.has(href), `${href} がナビに出ていない`);
  }
  // 動的URLなのでナビには出せない。台帳には載っていて関連から辿れること
  const clientOverview = getScreenByKey("client-overview");
  assert.ok(clientOverview);
  assert.equal(clientOverview?.nav, false);
  assert.ok(getScreenByKey("stores-index")?.related.includes("client-overview"));
});

test("配信オペレーションの強調がナビ項目に載る", () => {
  const items = buildNavGroups().flatMap((g) => g.items);
  assert.equal(items.find((i) => i.href === "/admin/delivery-operations")?.primary, true);
});

// ---------------------------------------------------------------------------
// buildPinnedNavItems（ヘッダー1段目の「よく使う」外出し列）
// ---------------------------------------------------------------------------

test("ピン留めは pinned:true の画面だけを宣言順で返す", () => {
  const hrefs = buildPinnedNavItems().map((i) => i.href);
  assert.deepEqual(hrefs, [
    "/admin/projects",
    "/admin/daily-surveys",
    "/admin/respondents",
    "/admin/exchange-requests",
    "/admin/delivery-operations",
    "/admin/delivery-calendar"
  ]);
});

test("ピン留めした画面はグループ側からも消えない（近道であって引っ越しではない）", () => {
  const groupHrefs = new Set(buildNavGroups().flatMap((g) => g.items.map((i) => i.href)));
  for (const item of buildPinnedNavItems()) {
    assert.ok(groupHrefs.has(item.href), `${item.href} がグループから消えている`);
  }
});

test("交換申請バッジの DOM id はピン留め側にだけ出る（id 重複を作らない）", () => {
  // 同じ id が2箇所にあると getElementById が先勝ちになり、片方が黙って更新されない。
  assert.equal(
    buildPinnedNavItems().find((i) => i.href === "/admin/exchange-requests")?.badgeId,
    "nav-exchange-badge"
  );
  const groupItems = buildNavGroups().flatMap((g) => g.items);
  assert.equal(
    groupItems.find((i) => i.href === "/admin/exchange-requests")?.badgeId,
    undefined
  );
  const badgeIds = [...buildPinnedNavItems(), ...groupItems]
    .map((i) => i.badgeId)
    .filter((id) => id !== undefined);
  assert.equal(new Set(badgeIds).size, badgeIds.length, "ナビ全体でバッジ id が重複している");
});

test("ピン留めは全て nav:true（ドロップダウン側にも必ず居場所がある）", () => {
  for (const screen of ADMIN_SCREENS) {
    if (screen.pinned) assert.ok(screen.nav, `${screen.key} は pinned だが nav:false`);
  }
});
