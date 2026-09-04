/**
 * 埋め込み済み静的ファイル（src/public/_compiled.ts）の配信。
 *
 * express.static は FS を読むため Workers で動かない。ここはビルド時に
 * バンドルへ入れた内容をそのまま返す。ETag による 304 応答まで面倒を見る。
 */
import type { Request, Response, NextFunction } from "express";
import { COMPILED_ASSETS } from "../public/_compiled";

/** 内容から安定した ETag を作る（ビルドごとに変わり、同一ビルドでは変わらない） */
function weakEtag(body: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h1 ^= body.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `W/"${body.length.toString(16)}-${h1.toString(16)}"`;
}

const etagCache = new Map<string, string>();

/**
 * 資産のバージョン文字列（`?v=` に付ける）。
 *
 * ⚠ ここが無いと本番で「HTML は新しいのに CSS だけ古い」状態が起きる。
 * HTML はキャッシュされないが /public/styles.css は max-age=3600 なので、
 * デプロイ直後の1時間、既に開いたことのあるブラウザは古い CSS を使い続ける。
 * 新しいマークアップを古い CSS で描くと当然レイアウトが崩れる
 * （実際にヘッダー改修で、畳んだはずのメニューが全部開いた状態で表示された）。
 * URL にビルドごとの指紋を入れておけば、新ビルドは別 URL になるので
 * 古いキャッシュに当たりようがない。
 */
export function assetVersion(key: string): string {
  const asset = COMPILED_ASSETS[key];
  if (!asset) return "0";
  let etag = etagCache.get(key);
  if (!etag) {
    etag = weakEtag(asset.body);
    etagCache.set(key, etag);
  }
  // ETag は `W/"len-hash"` の形。URL に載せるので英数字だけ取り出す。
  return etag.replace(/[^a-z0-9]/gi, "");
}

/** ビューから `<%= assetUrl("styles.css") %>` で使う */
export function assetUrl(key: string): string {
  return `/public/${key}?v=${assetVersion(key)}`;
}

/**
 * /public/* を埋め込み資産から配信する express ミドルウェア。
 * 見つからなければ next() して 404 は既存のハンドラに任せる。
 */
export function serveCompiledAsset(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  // app.use("/public", ...) でマウントされるため req.path は /styles.css の形
  const key = decodeURIComponent(req.path.replace(/^\/+/, ""));
  const asset = COMPILED_ASSETS[key];
  if (!asset) {
    next();
    return;
  }

  let etag = etagCache.get(key);
  if (!etag) {
    etag = weakEtag(asset.body);
    etagCache.set(key, etag);
  }

  res.setHeader("Content-Type", asset.type);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }

  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }

  if (asset.encoding === "base64") {
    res.status(200).end(Buffer.from(asset.body, "base64"));
    return;
  }
  res.status(200).end(asset.body);
}
