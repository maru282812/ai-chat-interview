import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual
} from "node:crypto";

/**
 * promisify は多重定義のうち options 無しの3引数版を拾ってしまうため、
 * options 付きの形を明示して包む（N/r/p と maxmem を渡す必要がある）。
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * 管理画面パスワードのハッシュ化と検証。
 *
 * 環境変数に平文を置くのをやめ、scrypt ハッシュを置く。守る対象は
 * 「Vercel の環境変数を読める攻撃者」ではない（それはもう管理者権限を持っている）。
 * **同じパスワードを他所でも使い回していた場合に、そちらへ被害が波及するのを断つ**
 * のが目的。ソルトを行ごとに変えるのも同じ理由（レインボーテーブル対策）。
 *
 * scrypt を選んだのは Node 標準 crypto だけで完結し、依存を増やさずに済むため。
 * bcrypt/argon2 と同じくメモリ困難な関数で、総当たりのコストを引き上げる。
 *
 * 保存形式: `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`
 * パラメータを値の中に埋めるのは、将来コストを引き上げても
 * **既存のハッシュを壊さずに検証し続けられる**ようにするため。
 */

const KEY_LENGTH = 64;

// 対話ログイン1回分としては十分で、Vercel の実行時間内にも収まる強度。
const DEFAULT_COST = { N: 16384, r: 8, p: 1 } as const;

export async function hashAdminPassword(password: string): Promise<string> {
  const { N, r, p } = DEFAULT_COST;
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * 平文と保存済みハッシュを突き合わせる。
 * 形式不正・パラメータ不正は例外にせず false を返す（認証は落ちる側に倒す）。
 */
export async function verifyAdminPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return false;
  }
  // 壊れた（あるいは細工された）ハッシュ文字列で過大なメモリを掴まされないための上限。
  if (N <= 0 || r <= 0 || p <= 0 || N > 1 << 20 || r > 32 || p > 16) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "hex");
    expected = Buffer.from(parts[5] ?? "", "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LENGTH) {
    return false;
  }

  try {
    // maxmem の既定（32MB）は N=16384,r=8 で足りないため明示的に広げる。
    const derived = await scrypt(password, salt, KEY_LENGTH, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
