import assert from "node:assert/strict";
import { test } from "node:test";
import { supabase } from "../config/supabase";
import { userPointService } from "../services/userPointService";

/**
 * userPointService.ensureRow の upsert オプション。
 *
 * ensureRow は「残高行が無ければ 0 で作る」だけのつもりのコードだが、
 * Supabase の upsert は競合時に「指定した列で上書き」する。ignoreDuplicates を
 * 付けないと、0 を並べたこの行が既存ユーザーに当たって available_points /
 * lifetime_points がまるごと 0 に潰れる。
 *
 * 呼び出し元（ついでスワイプ・デイリーアンケート）は付与の直前にこれを呼ぶため、
 * 実際に「スワイプに答えるたび残高が消えて付与分だけになる」事故が起きていた
 * （本番で最大 28pt の消失を確認）。オプションが外れたら落とす。
 */

test("ensureRow は ignoreDuplicates 付きで upsert する（既存残高を 0 で上書きしない）", async () => {
  const calls: { values: unknown; options: unknown }[] = [];
  const originalFrom = supabase.from.bind(supabase);

  // supabase.from("user_points").upsert(...) の引数だけを捕まえる
  (supabase as unknown as { from: unknown }).from = ((table: string) => {
    if (table !== "user_points") {
      return originalFrom(table as never);
    }
    return {
      upsert: (values: unknown, options: unknown) => {
        calls.push({ values, options });
        return Promise.resolve({ error: null });
      }
    };
  }) as never;

  try {
    await userPointService.ensureRow("U_test_ensure_row");
  } finally {
    (supabase as unknown as { from: unknown }).from = originalFrom;
  }

  assert.equal(calls.length, 1, "user_points への upsert が1回走る");
  const options = calls[0]?.options as { onConflict?: string; ignoreDuplicates?: boolean };
  assert.equal(options?.onConflict, "line_user_id");
  assert.equal(
    options?.ignoreDuplicates,
    true,
    "ignoreDuplicates が無いと既存ユーザーの残高が 0 に潰れる"
  );
});

test("ensureRow が書き込もうとする値は 0（＝新規行の初期値としてのみ正しい）", async () => {
  const calls: { values: Record<string, unknown> }[] = [];
  const originalFrom = supabase.from.bind(supabase);

  (supabase as unknown as { from: unknown }).from = ((table: string) => {
    if (table !== "user_points") {
      return originalFrom(table as never);
    }
    return {
      upsert: (values: Record<string, unknown>) => {
        calls.push({ values });
        return Promise.resolve({ error: null });
      }
    };
  }) as never;

  try {
    await userPointService.ensureRow("U_test_ensure_row");
  } finally {
    (supabase as unknown as { from: unknown }).from = originalFrom;
  }

  // 値が 0 であること自体は正しい（新規行の初期値）。
  // 危険なのは「この 0 を既存行に当てる」ことなので、上のテストと対で意味を持つ。
  assert.deepEqual(calls[0]?.values, {
    line_user_id: "U_test_ensure_row",
    total_points: 0,
    available_points: 0,
    lifetime_points: 0
  });
});
