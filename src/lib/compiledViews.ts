/**
 * プリコンパイル済み EJS ビューのレンダリングエンジン。
 *
 * 目的: Cloudflare Workers には FS が無く、EJS の既定動作（views ディレクトリから
 * ファイルを読む）が使えない。scripts/compileViews.mjs がビルド時に生成した
 * COMPILED_VIEW_SOURCES を使い、FS に触れずにレンダリングする。
 *
 * Vercel / ローカルでも同じ経路を通す（環境ごとに描画方式が変わると、
 * 片方でしか出ない不具合が生まれるため）。
 */
import { COMPILED_VIEW_SOURCES } from "../views/_compiled";

type TemplateFn = (
  locals: Record<string, unknown>,
  escapeFn?: (markup: unknown) => string,
  include?: (path: string, data?: Record<string, unknown>) => string,
  rethrow?: unknown
) => string;

/** 評価済み関数のキャッシュ（毎リクエスト new Function すると遅い） */
const cache = new Map<string, TemplateFn>();

/**
 * ビュー名を正規化する。
 * express の res.render は "admin/projects/index" のような拡張子なしの相対パスを渡す。
 * include は "../partials/header" のような相対指定を使うため、呼び出し元からの
 * 相対解決が要る。
 */
function normalizeKey(name: string): string {
  return name.replace(/\\/g, "/").replace(/\.ejs$/, "").replace(/^\.\//, "");
}

/** base（呼び出し元ビューのキー）から見た相対パスを解決する */
function resolveFrom(base: string, target: string): string {
  const t = normalizeKey(target);
  if (!t.startsWith(".")) {
    // "partials/header" のようなルート相対指定
    if (COMPILED_VIEW_SOURCES[t] !== undefined) return t;
    // 呼び出し元のディレクトリ基準でも探す
    const baseDir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
    const joined = baseDir ? `${baseDir}/${t}` : t;
    return COMPILED_VIEW_SOURCES[joined] !== undefined ? joined : t;
  }
  // "./x" / "../x" の解決
  const baseDir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const segs = baseDir ? baseDir.split("/") : [];
  for (const seg of t.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") segs.pop();
    else segs.push(seg);
  }
  return segs.join("/");
}

function getTemplate(key: string): TemplateFn {
  const cached = cache.get(key);
  if (cached) return cached;

  const source = COMPILED_VIEW_SOURCES[key];
  if (source === undefined) {
    throw new Error(`compiled view not found: ${key}`);
  }
  // コンパイル済み関数のソースを評価して関数へ戻す。
  // ソースは `with (locals || {})` を含むため ESM 直書きはできない（Phase 0 の実測）。
  // new Function の中は非 strict なので with が使える。
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return (${source})`)() as TemplateFn;
  cache.set(key, fn);
  return fn;
}

const escapeFn = (markup: unknown): string => {
  if (markup === undefined || markup === null) return "";
  return String(markup)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;");
};

/**
 * プリコンパイル済みビューをレンダリングする。
 *
 * @param name  views ルートからの相対パス（拡張子なし）
 * @param data  テンプレートに渡すローカル変数
 */
export function renderCompiled(name: string, data: Record<string, unknown> = {}): string {
  const key = normalizeKey(name);
  const fn = getTemplate(key);

  // include は呼び出し元ビューを基準に相対解決する。
  const makeInclude =
    (currentKey: string) =>
    (path: string, includeData?: Record<string, unknown>): string => {
      const resolved = resolveFrom(currentKey, path);
      const childFn = getTemplate(resolved);
      // EJS の include は親の locals を引き継ぎ、第2引数で上書きする
      const childLocals = { ...data, ...(includeData ?? {}) };
      // locals を参照するテンプレートがあるので自己参照も渡す
      (childLocals as Record<string, unknown>).locals = childLocals;
      return childFn(childLocals, escapeFn, makeInclude(resolved), undefined);
    };

  const locals: Record<string, unknown> = { ...data };
  // テンプレート内の `locals.foo` 参照に対応する（EJS の慣習）
  locals.locals = locals;

  return fn(locals, escapeFn, makeInclude(key), undefined);
}

/** 登録済みビュー数（自己診断用） */
export function compiledViewCount(): number {
  return Object.keys(COMPILED_VIEW_SOURCES).length;
}
