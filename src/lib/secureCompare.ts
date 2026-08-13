import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 秘密情報どうしを定数時間で比較する。
 *
 * 素の `===` は先頭から1文字ずつ比べて違えば即座に返るため、
 * 応答時間の差から「どこまで合っていたか」が理論上漏れる。
 *
 * 両者を SHA-256 ダイジェスト（常に32バイト）に通してから timingSafeEqual に渡すのは、
 * timingSafeEqual が長さの違う Buffer で例外を投げる仕様への対処も兼ねる。
 * ダイジェスト化すれば長さは必ず揃うので、**入力の長さそのものも漏らさない**。
 *
 * 元は partnerAdminAuth.ts のローカル実装。管理画面認証でも同じものが必要になったため
 * ここへ切り出して共有する（同じ判定が2箇所で食い違わないようにする意図）。
 */
export function secureEquals(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
