// 複製された店舗案件から消えてしまった「表示制御」項目を、テンプレ原本から復元する。
//
// 背景:
//   projectRepository.copyProject が設問を作り直すときのフィールド列挙漏れで、
//   display_tags_parsed / visibility_conditions / comment_top / comment_bottom /
//   display_tags_raw が複製先に写っていなかった。
//   店舗展開(storeProvisioningService)はこの copyProject を通るため、
//   テンプレ原本は正しいのに、生成された店舗案件だけ設定が空になっていた。
//
//   実害: A-Q10「今日、特に重視していることは？」は A-Q9 で選んだ選択肢だけを出す
//   carry-forward 設定(display_tags_parsed.optionSource)を持つが、それが消えていたため
//   全選択肢が出ていた。<disable> と表示条件も同様に効いていない。
//
//   コード側は修正済み（以降の複製は正しく写る）。このスクリプトは
//   **修正前に作られてしまった既存の店舗案件**を直すためのもの。
//
// なぜ seed を流さないか:
//   seedSalonSurveyProjects.mjs は questions を delete→insert で作り直すため、
//   本番で流すと answers が CASCADE で消える（回答が失われる）。
//   ここでは該当設問の UPDATE だけを当てる。
//
// 対応づけ: 案件の industry_template_id + template_step_role で原本を特定し、
//   question_code 一致で設問を突き合わせる。
//
// 冪等。何度実行しても同じ状態に収束する。
//
// Usage:
//   node scripts/repairCopiedDisplayControl.mjs           # dry-run（変更しない）
//   node scripts/repairCopiedDisplayControl.mjs --apply    # 適用
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
 * 複製先(dst)とテンプレ原本(src)の設問を突き合わせる。
 *
 * 対象は「原本に設定があるのに複製先で空」の項目だけ。
 * 複製先で人が編集した値を原本で上書きしないよう、空の項目しか埋めない。
 */
const MATCH = `
  FROM questions dq
  JOIN projects dp ON dp.id = dq.project_id
  JOIN industry_templates it ON it.id = dp.industry_template_id
  JOIN projects sp ON sp.template_step_role = 'template'
                  AND sp.id = CASE dp.template_step_role
                        WHEN 'entry'    THEN it.entry_template_project_id
                        WHEN 'followup' THEN it.followup_template_project_id
                        WHEN 'verify'   THEN it.verify_template_project_id
                      END
  JOIN questions sq ON sq.project_id = sp.id AND sq.question_code = dq.question_code
  WHERE dp.template_step_role IN ('entry','followup','verify')
    AND (
         (dq.display_tags_parsed  IS NULL AND sq.display_tags_parsed  IS NOT NULL)
      OR (dq.display_tags_raw     IS NULL AND sq.display_tags_raw     IS NOT NULL)
      OR (dq.visibility_conditions IS NULL AND sq.visibility_conditions IS NOT NULL)
      OR (dq.comment_top          IS NULL AND sq.comment_top          IS NOT NULL)
      OR (dq.comment_bottom       IS NULL AND sq.comment_bottom       IS NOT NULL)
    )`;

async function main() {
  const dryRun = !process.argv.includes("--apply");

  console.log("=== 復元対象（原本に設定があるのに複製先が空の設問）===");
  const targets = await q(`
    SELECT dp.entry_code, dq.question_code,
      (dq.display_tags_parsed IS NULL AND sq.display_tags_parsed IS NOT NULL) AS 持ち越し欠落,
      (dq.visibility_conditions IS NULL AND sq.visibility_conditions IS NOT NULL) AS 表示条件欠落,
      sq.display_tags_parsed::text AS 原本の表示タグ
    ${MATCH}
    ORDER BY dp.entry_code, dq.sort_order;`);

  if (targets.length === 0) {
    console.log("復元が必要な設問はありません（すでに正しい状態です）。");
    return;
  }
  console.table(targets);
  console.log(`対象 ${targets.length} 件。`);

  if (dryRun) {
    console.log("\n--apply が無いので変更しません（dry-run）。");
    return;
  }

  // COALESCE で「複製先が空のときだけ原本の値を入れる」。人が入れた値は残す。
  const res = await q(`
    UPDATE questions AS t SET
      display_tags_parsed  = COALESCE(t.display_tags_parsed,  m.s_display_tags_parsed),
      display_tags_raw     = COALESCE(t.display_tags_raw,     m.s_display_tags_raw),
      visibility_conditions = COALESCE(t.visibility_conditions, m.s_visibility_conditions),
      comment_top          = COALESCE(t.comment_top,          m.s_comment_top),
      comment_bottom       = COALESCE(t.comment_bottom,       m.s_comment_bottom),
      updated_at           = now()
    FROM (
      SELECT dq.id AS dst_id,
        sq.display_tags_parsed   AS s_display_tags_parsed,
        sq.display_tags_raw      AS s_display_tags_raw,
        sq.visibility_conditions AS s_visibility_conditions,
        sq.comment_top           AS s_comment_top,
        sq.comment_bottom        AS s_comment_bottom
      ${MATCH}
    ) AS m
    WHERE t.id = m.dst_id
    RETURNING t.id;`);
  console.log(`\n${res.length} 件の設問を復元しました。`);

  console.log("\n=== 適用後の確認（carry-forward を持つ設問）===");
  console.table(await q(`
    SELECT p.entry_code, qq.question_code,
      qq.display_tags_parsed->'optionSource'->>'fromQuestion' AS 参照元,
      qq.display_tags_parsed->'optionSource'->>'mode' AS mode
    FROM questions qq JOIN projects p ON p.id = qq.project_id
    WHERE qq.display_tags_parsed->'optionSource' IS NOT NULL
    ORDER BY p.entry_code, qq.sort_order;`));

  const left = await q(`SELECT count(*)::int AS n ${MATCH};`);
  console.log(`\n未復元の残り: ${left[0].n}（0 が正しい）`);
  if (left[0].n !== 0) {
    console.error("⚠ 復元しきれていません。原本側の設定を確認してください。");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
