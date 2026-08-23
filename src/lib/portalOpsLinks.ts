import { env } from "../config/env";

/**
 * 会員ポータル（hibi-site / アンケでYOTTO）運営画面への**リンク**の唯一の定義場所。
 *
 * 運営が ACI 管理画面とアンケでYOTTO 運営画面を1つの管理画面のタブ感覚で行き来できる
 * ようにするためのもの。API 接続でも SSO でもなく、**ただのリンク**。
 *
 * ## 方針（hibi 側 lib/aci-admin-links.ts と対になる作法）
 * - ベースURLは env `PORTAL_OPS_URL`。**未設定ならリンクを一切出さない**
 *   （リンク切れを運営に見せない。fail-closed）
 * - http(s) 以外（`javascript:` 等）は無視する
 * - リンクは**同一タブ**（target を指定しない）。タブが増え続けるのを避ける
 * - **認可は一切バイパスしない**。hibi 側の運営 allowlist・404 は従来どおり効く。
 *   ここが渡すのは URL 文字列だけ
 *
 * env は `config/env.ts` の zod スキーマ経由で読む（optional なので未設定でも起動する）。
 * Cloudflare Workers には process.env が無いため、直接読みは使えない。
 *
 * ただしこの値だけは **参照のたびに process.env を優先して見る**。
 * リンクの有無を切り替える任意設定で、テスト（adminViewFoundation.test.ts）が
 * 実行中に process.env を差し替えて挙動を確かめるため。
 * Workers には process.env が無いので、その場合は注入済み env にフォールバックする。
 */

/** ポータル運営画面のベースURL（末尾スラッシュなし）。未設定・不正なら null。 */
export function getPortalOpsUrl(): string | null {
  // Node では process.env を唯一の真実とする（**未設定であることも含めて**）。
  // ?? でフォールバックすると、テストが削除した値を .env 由来の値が
  // 復活させてしまい「未設定なら出さない」検証が通らなくなる。
  const hasProcessEnv = typeof process !== "undefined" && Boolean(process?.env);
  const raw = (hasProcessEnv ? process.env.PORTAL_OPS_URL : env.PORTAL_OPS_URL)?.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * ポータル運営画面内のパスから絶対URLを組み立てる。
 * env 未設定なら null（呼び出し側はリンクごと出さない）。
 */
export function portalOpsHref(path: string): string | null {
  const base = getPortalOpsUrl();
  if (!base) return null;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** ナビ「アンケでYOTTO」グループの項目。hibi の /ops に実在するルートだけを並べる。 */
export const PORTAL_OPS_NAV_ITEMS: { path: string; label: string }[] = [
  { path: "/ops/projects", label: "プロジェクト・納品" },
  { path: "/ops/surveys", label: "設問の写真" },
  { path: "/ops/assignments", label: "アンケート割り当て" },
  { path: "/ops/ledger", label: "チケット台帳" },
  { path: "/ops/packages", label: "パッケージ" },
  { path: "/ops/members", label: "会員管理" }
];

/**
 * ナビ用のリンク一覧。env 未設定なら空配列（＝グループごと非表示）。
 */
export function portalOpsNavLinks(): { href: string; label: string }[] {
  const base = getPortalOpsUrl();
  if (!base) return [];
  return PORTAL_OPS_NAV_ITEMS.map((item) => ({ href: `${base}${item.path}`, label: item.label }));
}
