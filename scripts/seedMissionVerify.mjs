/**
 * seedMissionVerify.mjs
 *
 * ミッション Phase 2残（部屋）＋ Phase 3（隠し部屋）の実機検証データを本番 Supabase へ投入する。
 * 仕様: docs/spec-mission-phase23-rooms-hidden.md
 *
 * 投入内容:
 *   - 検証案件4件（category: たべもの×2 / くらし×1 / ひみつ×1・すべて is_discoverable）
 *   - 横断型ミッション1件（今日〜7日後・テーマ forest・ステージ3段）
 *   - 隠し部屋（open_mode=rooms_cleared 1部屋・award=split 原資50,000pt）
 *   - 検証ユーザー tmtest_mission_user の respondents 完了2件
 *     （「たべもの」の2案件を回答済み＝部屋クリア→隠し部屋が開いた状態を見る）
 *
 * ⚠ .env は本番 Supabase を向いている。検証後は必ず --cleanup すること
 *   （respondents の消し忘れが過去の定番事故）。
 *
 * 使い方:
 *   node scripts/seedMissionVerify.mjs            投入
 *   node scripts/seedMissionVerify.mjs --cleanup  撤去
 */

import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadDotEnv({ quiet: true });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const CLEANUP = process.argv.includes("--cleanup");

// 固定 UUID（冪等 upsert / cleanup 用の専用レンジ）
const PID = (n) => `dd260904-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const MISSION_ID = "dd260904-0000-4000-8000-000000000100";
const HIDDEN_ROOM_ID = "dd260904-0000-4000-8000-000000000200";
const RID = (n) => `dd260904-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const VERIFY_USER = "tmtest_mission_user";

const now = new Date();
const iso = (d) => d.toISOString();
const addDays = (d, days) => new Date(d.getTime() + days * 86400000);

const common = {
  client_name: "動作確認",
  status: "published",
  reward_points: 10,
  visibility_type: "public",
  is_discoverable: true,
  apply_mode: "auto",
  delivery_enabled: false,
  estimated_minutes: 3,
  research_mode: "survey",
  display_mode: "survey_question",
  answer_ui_preset: "standard",
  ai_prompt_mode: "custom",
  primary_objectives: [],
  secondary_objectives: [],
  comparison_constraints: [],
  prompt_rules: [],
  updated_at: iso(now),
};

const projects = [
  { ...common, id: PID(1), category: "たべもの", name: "【検証】朝ごはんについて", objective: "部屋検証" },
  { ...common, id: PID(2), category: "たべもの", name: "【検証】外食の頻度", objective: "部屋検証" },
  { ...common, id: PID(3), category: "くらし", name: "【検証】睡眠の習慣", objective: "部屋検証" },
  { ...common, id: PID(4), category: "ひみつ", name: "【検証】隠し部屋のアンケート", objective: "隠し部屋検証" },
];

async function seed() {
  const { error: pErr } = await supabase.from("projects").upsert(projects, { onConflict: "id" });
  if (pErr) throw new Error(`projects upsert failed: ${pErr.message}`);
  console.log(`projects upserted: ${projects.length}`);

  const { error: mErr } = await supabase.from("missions").upsert(
    {
      id: MISSION_ID,
      name: "【検証】秋のミッション",
      scope: "platform",
      project_id: null,
      theme_key: "forest",
      starts_at: iso(addDays(now, -1)),
      ends_at: iso(addDays(now, 7)),
      is_active: true,
      updated_at: iso(now),
    },
    { onConflict: "id" }
  );
  if (mErr) throw new Error(`missions upsert failed: ${mErr.message}`);

  await supabase.from("mission_stages").delete().eq("mission_id", MISSION_ID);
  const { error: sErr } = await supabase.from("mission_stages").insert([
    { mission_id: MISSION_ID, stage_no: 1, need_answers: 3, need_invites: 1, reward_points: 150, is_masked: false },
    { mission_id: MISSION_ID, stage_no: 2, need_answers: 10, need_invites: 3, reward_points: 300, is_masked: true },
    { mission_id: MISSION_ID, stage_no: 3, need_answers: 20, need_invites: 5, reward_points: 550, is_masked: true },
  ]);
  if (sErr) throw new Error(`mission_stages insert failed: ${sErr.message}`);
  console.log("mission + stages upserted");

  const { error: hErr } = await supabase.from("mission_hidden_rooms").upsert(
    {
      id: HIDDEN_ROOM_ID,
      mission_id: MISSION_ID,
      category: "ひみつ",
      open_mode: "rooms_cleared",
      rooms_needed: 1,
      opens_at: null,
      closes_at: null,
      first_n: null,
      award_mode: "split",
      pot_points: 50000,
      flat_points: null,
      prize_points: null,
      winners_count: null,
      is_active: true,
      updated_at: iso(now),
    },
    { onConflict: "mission_id" }
  );
  if (hErr) throw new Error(`hidden room upsert failed: ${hErr.message}`);
  console.log("hidden room upserted (rooms_cleared=1, split 50,000pt)");

  // 検証ユーザーの回答完了（「たべもの」2件＝部屋クリア→隠し部屋 open）
  const respondents = [
    { id: RID(1), line_user_id: VERIFY_USER, display_name: "TM Test User", project_id: PID(1), status: "completed", is_test: false },
    { id: RID(2), line_user_id: VERIFY_USER, display_name: "TM Test User", project_id: PID(2), status: "completed", is_test: false },
  ];
  const { error: rErr } = await supabase.from("respondents").upsert(respondents, { onConflict: "id" });
  if (rErr) throw new Error(`respondents upsert failed: ${rErr.message}`);
  console.log("respondents upserted (たべもの 2件 completed)");

  console.log("\n投入完了。確認: http://localhost:3100/liff/mission （tmtest:tmtest_mission_user）");
  console.log("検証後は node scripts/seedMissionVerify.mjs --cleanup を忘れずに。");
}

async function cleanup() {
  // 依存順: entries/awards は hidden_rooms の CASCADE、stages/stage_awards は missions の CASCADE
  const del = async (table, apply) => {
    const { error } = await apply(supabase.from(table).delete());
    if (error) console.error(`${table} delete failed: ${error.message}`);
    else console.log(`${table} cleaned`);
  };
  await del("missions", (q) => q.eq("id", MISSION_ID));
  await del("respondents", (q) => q.eq("line_user_id", VERIFY_USER));
  await del("point_histories", (q) => q.eq("line_user_id", VERIFY_USER));
  await del("user_points", (q) => q.eq("line_user_id", VERIFY_USER));
  await del("user_profiles", (q) => q.eq("line_user_id", VERIFY_USER));
  await del(
    "projects",
    (q) => q.in("id", projects.map((p) => p.id))
  );
  console.log("撤去完了。");
}

(CLEANUP ? cleanup() : seed()).catch((e) => {
  console.error(e);
  process.exit(1);
});
