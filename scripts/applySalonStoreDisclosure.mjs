// 美容室ABC A案件の Q12/Q13 に「店舗への開示」設定を反映する。
//
// なぜ seed を流さないか:
//   seedSalonSurveyProjects.mjs は questions を delete→insert で作り直すため、
//   本番で流すと answers が CASCADE で消える（回答が失われる）。
//   設定の正は seed 側に書いたうえで、本番へは該当設問の UPDATE だけを当てる。
//
// 冪等。何度実行しても同じ状態に収束する。
import "dotenv/config";

const token = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
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

// 告知文は回答画面の helpText と必ず一致させる（規約 第9条3項の「あらかじめ明示」）。
const Q12_NOTICE = "この設問のみ担当者が施術前に確認いたします。会話の量はいつでも変えていただけます。";
const Q13_NOTICE = "この設問のみ担当者が施術前に確認いたします。";

const TARGETS = [
  { code: "Q12", mode: "aggregate", notice: Q12_NOTICE },
  { code: "Q13", mode: "verbatim",  notice: Q13_NOTICE }
];

const ENTRY_CODE = "yotto-salon-a";

async function main() {
  const dryRun = !process.argv.includes("--apply");

  console.log("=== 現在の状態 ===");
  const before = await q(`SELECT qq.question_code, qq.question_type,
      qq.question_config->'meta'->'share_with_store' IS NOT NULL AS 開示設定あり,
      qq.question_config->>'helpText' AS helptext
    FROM questions qq JOIN projects p ON p.id = qq.project_id
    WHERE p.entry_code = '${ENTRY_CODE}' AND qq.question_code IN ('Q12','Q13')
    ORDER BY qq.sort_order;`);
  console.table(before);

  if (before.length !== 2) {
    console.error(`対象設問が2件見つかりません（${before.length}件）。中止します。`);
    process.exit(1);
  }

  // 告知文が回答画面の文言と一致しているか確認する。
  // ズレたまま開示すると「画面で明示した内容」と食い違い、規約上の根拠が崩れる。
  for (const t of TARGETS) {
    const row = before.find((r) => r.question_code === t.code);
    if (row.helptext !== t.notice) {
      console.error(`${t.code}: 回答画面の helpText と告知文が一致しません。中止します。`);
      console.error(`  画面: ${row.helptext}`);
      console.error(`  設定: ${t.notice}`);
      process.exit(1);
    }
  }
  console.log("告知文の一致を確認しました（画面の文言＝開示の根拠）。");

  if (dryRun) {
    console.log("\n--apply が無いので変更しません（dry-run）。");
    return;
  }

  for (const t of TARGETS) {
    const payload = JSON.stringify({
      enabled: true, mode: t.mode, timing: "immediate", notice: t.notice
    }).replace(/'/g, "''");
    await q(`UPDATE questions qq
      SET question_config = COALESCE(qq.question_config, '{}'::jsonb)
        || jsonb_build_object('meta',
             COALESCE(qq.question_config->'meta', '{}'::jsonb)
             || jsonb_build_object('share_with_store', '${payload}'::jsonb))
      FROM projects p
      WHERE p.id = qq.project_id AND p.entry_code = '${ENTRY_CODE}'
        AND qq.question_code = '${t.code}';`);
    console.log(`${t.code} を開示ON（mode=${t.mode}）にしました。`);
  }

  console.log("\n=== 適用後 ===");
  console.table(await q(`SELECT qq.question_code,
      qq.question_config->'meta'->'share_with_store'->>'mode' AS mode,
      qq.question_config->'meta'->'share_with_store'->>'timing' AS timing,
      left(qq.question_config->'meta'->'share_with_store'->>'notice', 24) || '…' AS notice
    FROM questions qq JOIN projects p ON p.id = qq.project_id
    WHERE p.entry_code = '${ENTRY_CODE}' AND qq.question_code IN ('Q12','Q13')
    ORDER BY qq.sort_order;`));

  // 開示ONにした設問が想定どおり2件だけであることを確認する。
  const all = await q(`SELECT count(*)::int AS n FROM questions qq JOIN projects p ON p.id = qq.project_id
    WHERE p.entry_code LIKE 'yotto-salon-%'
      AND qq.question_config->'meta'->'share_with_store'->>'enabled' = 'true';`);
  console.log(`\n美容室ABC全体で開示ONの設問数: ${all[0].n}（2 が正しい）`);
  if (all[0].n !== 2) {
    console.error("⚠ 想定外の件数です。管理画面で確認してください。");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
