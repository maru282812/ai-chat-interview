/**
 * 美容室ABCサイクルの「お礼」を、最後の設問から送信完了画面へ移す (Migration 108)。
 *
 * 背景:
 *   A / C はお礼の文言を「最後の設問の comment_bottom」に載せていた。comment_bottom は
 *   設問の下＝まだ送信していない画面に出るため、回答者から見ると
 *   「お礼が出たのに、まだ送信ボタンを押していない」状態だった。
 *   B にはそもそもお礼が無く、汎用文で終わっていた。
 *
 * この処理:
 *   1) A / C の該当設問から comment_bottom を外す（お礼が二重に出ないようにする）
 *   2) A / B / C の projects.completion_message にお礼文を入れる
 *
 * ⚠ seedSalonSurveyProjects.mjs は再実行すると questions を delete する＝回答が
 *   CASCADE で消える。このスクリプトは UPDATE だけを行い、行の削除・作成はしない。
 *
 * 使い方:
 *   node scripts/applySalonCompletionMessage.mjs           # 変更内容の確認のみ（既定）
 *   node scripts/applySalonCompletionMessage.mjs --apply   # 実際に更新する
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const url = (process.env.SUPABASE_URL || "").trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です（.env）");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const P_A = "5a10c001-0000-4000-8000-000000000001";
const P_B = "5a10c002-0000-4000-8000-000000000002";
const P_C = "5a10c003-0000-4000-8000-000000000003";

/**
 * 送信完了画面に出すお礼文。
 * A/C は従来 comment_bottom にあった文言をそのまま使う（文面は変えない＝回答者の体験を
 * 変えるのは「出る場所」だけ）。B は元々お礼が無かったため、A/C と口調を揃えて新規に用意する。
 */
const MESSAGES = [
  {
    projectId: P_A,
    label: "A：来店すぐアンケート",
    // 施術前に答えるアンケート。この後さらに B があるため「続きは施術後」と繋ぐ。
    message: "ご協力ありがとうございました。続きは施術後にお答えください。"
  },
  {
    projectId: P_B,
    label: "B：施術後アンケート",
    // 新規。この後 C（後日）が控えているので、そこへ繋ぐ言い方にする。
    message: "ご協力ありがとうございました。後日、最後のアンケートをお送りしますので、そちらもどうぞよろしくお願いいたします。"
  },
  {
    projectId: P_C,
    label: "C：本音アンケート",
    // サイクルの最後。次に繋がず、締めの挨拶にする。
    message: "ご協力ありがとうございました。引き続き美容室ぐるとアンケートサイトHibiをどうぞよろしくお願いいたします。"
  }
];

/** comment_bottom を外す対象（お礼が設問側に残っていると二重に出る）。 */
const CLEAR_COMMENT_BOTTOM = [
  { projectId: P_A, questionCode: "Q13", label: "A-Q13" },
  { projectId: P_C, questionCode: "Q10", label: "C-Q10" }
];

async function main() {
  console.log(APPLY ? "=== 適用モード（--apply）===" : "=== 確認モード（--apply で実行）===");

  // --- 1) 事前確認: 対象が存在するか ---
  const { data: projects, error: pErr } = await db
    .from("projects")
    .select("id, name, completion_message")
    .in("id", [P_A, P_B, P_C]);
  if (pErr) throw pErr;

  const found = new Set((projects || []).map((p) => p.id));
  const missing = MESSAGES.filter((m) => !found.has(m.projectId));
  if (missing.length > 0) {
    console.error("対象案件が見つかりません:", missing.map((m) => m.label).join(", "));
    console.error("本番DBに美容室ABCが投入済みか確認してください。");
    process.exit(1);
  }

  // --- 2) completion_message を入れる ---
  for (const m of MESSAGES) {
    const before = (projects || []).find((p) => p.id === m.projectId);
    const current = (before?.completion_message || "").trim();
    if (current === m.message) {
      console.log(`- ${m.label}: 既に同じ文言（変更なし）`);
      continue;
    }
    console.log(`- ${m.label}: completion_message を設定`);
    console.log(`    ${m.message}`);
    if (APPLY) {
      const { error } = await db
        .from("projects")
        .update({ completion_message: m.message })
        .eq("id", m.projectId);
      if (error) throw error;
    }
  }

  // --- 3) 設問側の comment_bottom を外す ---
  for (const t of CLEAR_COMMENT_BOTTOM) {
    const { data: qs, error: qErr } = await db
      .from("questions")
      .select("id, question_code, comment_bottom")
      .eq("project_id", t.projectId)
      .eq("question_code", t.questionCode);
    if (qErr) throw qErr;

    const target = (qs || [])[0];
    if (!target) {
      console.log(`- ${t.label}: 設問が見つからない（スキップ）`);
      continue;
    }
    if (!target.comment_bottom) {
      console.log(`- ${t.label}: comment_bottom は既に空（変更なし）`);
      continue;
    }
    console.log(`- ${t.label}: comment_bottom を外す`);
    console.log(`    外す文言: ${target.comment_bottom}`);
    if (APPLY) {
      const { error } = await db
        .from("questions")
        .update({ comment_bottom: null })
        .eq("id", target.id);
      if (error) throw error;
    }
  }

  // --- 4) 適用後の確認（実際にDBを読み直す） ---
  if (APPLY) {
    const { data: after, error: aErr } = await db
      .from("projects")
      .select("id, name, completion_message")
      .in("id", [P_A, P_B, P_C]);
    if (aErr) throw aErr;
    const bad = (after || []).filter((p) => !(p.completion_message || "").trim());
    if (bad.length > 0) {
      console.error("適用後もお礼文が空の案件があります:", bad.map((p) => p.name).join(", "));
      process.exit(1);
    }

    const { data: leftover, error: lErr } = await db
      .from("questions")
      .select("question_code, project_id")
      .in("project_id", [P_A, P_C])
      .not("comment_bottom", "is", null);
    if (lErr) throw lErr;
    if ((leftover || []).length > 0) {
      console.error("comment_bottom が残っています:", leftover.map((q) => q.question_code).join(", "));
      process.exit(1);
    }
    console.log("\n適用完了。お礼は送信完了画面に出ます。");
  } else {
    console.log("\n※ 確認のみ。実行するには --apply を付けてください。");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
