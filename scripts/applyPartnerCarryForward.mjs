// Partner API 経由で作られた既存アンケートに、carry-forward（選択肢の持ち越し）を後付けする。
//
// 背景:
//   「今日、重視していること（いくつでも）」→「今日、特に重視していること（ひとつだけ）」は、
//   前問で選んだものだけを出す設計。ACI 内製テンプレ(yotto-salon-a Q10)には
//   display_tags_parsed.optionSource が入っているが、Partner API にはその口が無かったため、
//   hibi 経由で作られた案件では全選択肢が出ていた。
//
//   口は実装済み（docs/partner-api.md §3.6 / carry_forward）。hibi のパッケージ定義も修正済みなので
//   **新規発行分は最初から効く**。このスクリプトは**修正前に作られてしまった既存案件**を直す。
//
// なぜ PUT /surveys/:id を使わないか:
//   PUT は設問を全置換する。既に回答が付いている案件で流すと question を作り直す経路に入り、
//   answers の参照や question_code の採番に影響が出る。ここは該当設問の UPDATE だけを当てる。
//
// 対象の決め方:
//   「選択肢の value 集合が完全一致する multi_choice → single_choice の隣接ペア」を探す。
//   持ち越しは value 一致で絞るため、集合が一致しないペアは対象にしてはいけない
//   （絞った結果0件になって回答不能になる）。
//
// 冪等。何度実行しても同じ状態に収束する。
//
// Usage:
//   node scripts/applyPartnerCarryForward.mjs           # dry-run（変更しない）
//   node scripts/applyPartnerCarryForward.mjs --apply    # 適用
import "dotenv/config";

const token = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN が必要です");
  process.exit(1);
}
const ref = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function q(query) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const t = await r.text();
  if (!r.ok) { console.error("SQL ERR", r.status, t.slice(0, 800)); process.exit(1); }
  return JSON.parse(t);
}

/**
 * 持ち越しを入れるべきペアを探す。
 *
 * 条件:
 *   - 同一案件・パートナー設問（pq*）
 *   - src が multi_choice、dst が single_choice
 *   - src の方が先（sort_order が小さい）
 *   - **選択肢の value 集合が完全一致**（一致しないと絞った結果が0件になりうる）
 *   - dst にまだ持ち越し設定が無い（冪等）
 *
 * 設問文は見ない。文言は店舗ごとに変わりうるので、構造だけで判定する。
 */
const CANDIDATES = `
  WITH pq AS (
    SELECT qq.id, qq.project_id, qq.question_code, qq.question_type, qq.sort_order,
           qq.question_text, qq.display_tags_parsed,
           (SELECT array_agg(x->>'value' ORDER BY x->>'value')
              FROM jsonb_array_elements(qq.question_config->'options') x) AS vals
    FROM questions qq
    WHERE qq.question_code LIKE 'pq%' AND qq.is_hidden = false
  )
  SELECT p.entry_code, p.id AS project_id,
         src.question_code AS src_code, src.sort_order AS src_sort, left(src.question_text,30) AS src_text,
         dst.question_code AS dst_code, dst.sort_order AS dst_sort, left(dst.question_text,30) AS dst_text,
         dst.id AS dst_id, array_length(dst.vals,1) AS 選択肢数
  FROM pq dst
  JOIN pq src ON src.project_id = dst.project_id
             AND src.question_type = 'multi_choice'
             AND src.sort_order < dst.sort_order
             AND src.vals = dst.vals
  JOIN projects p ON p.id = dst.project_id
  WHERE dst.question_type = 'single_choice'
    AND dst.display_tags_parsed IS NULL
    AND dst.vals IS NOT NULL
    -- 直前の multi_choice だけを参照元にする（間に別の候補があれば、より近い方を採る）
    AND NOT EXISTS (
      SELECT 1 FROM pq mid
      WHERE mid.project_id = dst.project_id
        AND mid.question_type = 'multi_choice'
        AND mid.vals = dst.vals
        AND mid.sort_order > src.sort_order
        AND mid.sort_order < dst.sort_order
    )`;

async function main() {
  const dryRun = !process.argv.includes("--apply");

  console.log("=== 持ち越しを入れる対象 ===");
  const targets = await q(`${CANDIDATES} ORDER BY p.entry_code, dst.sort_order;`);

  if (targets.length === 0) {
    console.log("対象はありません（すでに設定済み、または条件に合うペアが無い）。");
    return;
  }
  console.table(targets);
  console.log(`対象 ${targets.length} 件。`);
  console.log("※ いずれも「選択肢の value 集合が完全一致する multi→single の隣接ペア」です。");

  if (dryRun) {
    console.log("\n--apply が無いので変更しません（dry-run）。");
    return;
  }

  for (const t of targets) {
    const tags = JSON.stringify({
      optionSource: { fromQuestion: t.src_code.toLowerCase(), mode: "selected" }
    }).replace(/'/g, "''");
    await q(`UPDATE questions
      SET display_tags_parsed = '${tags}'::jsonb, updated_at = now()
      WHERE id = '${t.dst_id}' AND display_tags_parsed IS NULL;`);
    console.log(`${t.entry_code} ${t.dst_code} ← ${t.src_code} を設定しました。`);
  }

  console.log("\n=== 適用後 ===");
  console.table(await q(`
    SELECT p.entry_code, qq.question_code,
      qq.display_tags_parsed->'optionSource'->>'fromQuestion' AS 参照元,
      qq.display_tags_parsed->'optionSource'->>'mode' AS mode
    FROM questions qq JOIN projects p ON p.id = qq.project_id
    WHERE qq.question_code LIKE 'pq%' AND qq.display_tags_parsed->'optionSource' IS NOT NULL
    ORDER BY p.entry_code, qq.sort_order;`));

  const left = await q(`SELECT count(*)::int AS n FROM (${CANDIDATES}) c;`);
  console.log(`\n未適用の残り: ${left[0].n}（0 が正しい）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
