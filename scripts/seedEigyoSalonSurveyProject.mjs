/**
 * seedEigyoSalonSurveyProject.mjs
 *
 * （営業）美容室 お客様アンケート（1案件・13問）を冪等投入する。
 * 調査票: Box「調査票一覧.xlsx」シート「（営業）美容室」（2026-10-21 取得・P1=作成中）
 *
 *   管理用プロジェクト名(L1): 2026-C0004-0001_（営業）美容室
 *   USER表示タイトル(E1):     美容室お客様アンケート
 *   クライアント(F1):          （営業）美容室（企業コード C0004）
 *   管理年 2026 / 確定番号 1 / 用途 store / entry_code=eigyo-salon
 *   作成のみ（status=draft）。公開・配信はしない。
 *
 * 【調査票の記法 → この repo の設定への対応】
 *  - B列は全問「全員」＝表示条件なし。H列は Q12 の「1～7のスケール」のみ。I列（画像）は全問空。
 *  - 選択肢番号(D列)をそのまま value にする（"1","2",…）。
 *  - F列に数値ラベルは無い＝どの設問もランダマイズしない。
 *    Q11 の 13・14 に付く fix は「ランダマイズ時の位置固定」だが、ランダマイズ対象が無いので調査票どおり末尾に置くだけ。
 *  - ex / 排他 = exclusive / FA（選択肢行・F列/G列どちらでも）= allow_free_text。
 *  - 「その他（）」の括弧は記入欄の意味。Q6 の「その他（）」は F/G に FA 指定が無いが、同じ表記の Q3・Q7・Q11 に揃えて記述欄を付ける。
 *  - Q3 の「答えたくない」(ex) は SA なので排他は実質無意味。value・文言だけ保持する。
 *  - Q10 SAMTX = matrix_single。調査票の「項目」ブロック（5段階＋利用していない）が列、「選択肢」ブロック（12項目）が行。
 *    F列なし＝ランダムなし。matrix_list で 4 項目ずつページ分割（12行 → 4/4/4）。
 *  - Q12「1～7のスケール」= numeric の 1〜7 を縦並びボタンで出す。ラベルは調査票の 1・4・7 のみ（2,3,5,6 は数字だけ）。
 *  - 設問文の「※…」注記・補足行は comment_bottom に出す。
 *  - Q2 年齢（FA）は他案件と同じ numeric（1〜100歳）。Q13「〜があれば」の FA は任意。謝礼は指示がないため 0。
 *
 * Usage:
 *   node scripts/seedEigyoSalonSurveyProject.mjs            # 投入
 *   node scripts/seedEigyoSalonSurveyProject.mjs --cleanup  # 案件と子レコードを削除（クライアントは残す）
 *
 * ⚠ 再実行は questions を delete→insert する。回答が1件でも入っていたら止まる（--force で続行。回答は消える）。
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ID = "5a1e0004-0000-4000-8000-000000000001"; // 5a1e = "sale" / 0004 = C0004-0001
export const ENTRY_CODE = "eigyo-salon";
export const CLIENT = { name: "（営業）美容室", company_code: "C0004" };

const now = new Date().toISOString();

export const project = {
  id: PROJECT_ID,
  name: "2026-C0004-0001_（営業）美容室",
  user_display_title: "美容室お客様アンケート",
  client_name: CLIENT.name,
  management_year: 2026,
  confirmed_number: 1,
  survey_purpose: "store",
  objective: "来店客の属性・来店回数・利用メニュー・認知経路と、総合満足度・項目別満足度・改善要望・推奨意向を把握する",
  status: "draft",
  visibility_type: "private_store",
  is_discoverable: false,
  apply_mode: "auto",
  delivery_enabled: false,
  research_mode: "survey",
  display_mode: "survey_question",
  answer_ui_preset: "standard",
  ai_prompt_mode: "custom",
  primary_objectives: [],
  secondary_objectives: [],
  comparison_constraints: [],
  prompt_rules: [],
  reward_points: 0,
  estimated_minutes: 5,
  entry_code: ENTRY_CODE,
  completion_message: "ご協力ありがとうございました。いただいたご意見は、より快適にご利用いただくために活用いたします。",
  carry_forward_sources: null,
  updated_at: now
};

// ------------------------------------------------------------------
// ヘルパ
// ------------------------------------------------------------------

const q = (code, text, type, sortOrder, config, extra = {}) => ({
  project_id: PROJECT_ID,
  question_code: code,
  question_text: text,
  question_role: "main",
  question_type: type,
  is_required: true,
  sort_order: sortOrder,
  branch_rule: null,
  visibility_conditions: null,
  question_config: config,
  ai_probe_enabled: false,
  probe_guideline: null,
  max_probe_count: null,
  render_strategy: "static",
  is_system: false,
  is_hidden: false,
  comment_top: null,
  comment_bottom: null,
  created_at: now,
  updated_at: now,
  ...extra
});

/** 調査票の選択肢番号をそのまま value にする（"1","2",…）。 */
const numbered = (labels, start = 1) => labels.map((label, i) => ({ value: String(i + start), label }));

/** 選択肢番号 n の「その他（）」= 自由記述つき。 */
const other = (n) => ({ value: String(n), label: "その他", allow_free_text: true });
/** 選択肢番号 n の排他選択肢。 */
const exclusive = (n, label) => ({ value: String(n), label, exclusive: true });

// ------------------------------------------------------------------
// 共有の選択肢
// ------------------------------------------------------------------

/** Q10 の行・Q11 の選択肢（選択肢番号 1〜12）。 */
export const ASPECTS = [
  "仕上がり",
  "自分に合った提案",
  "スタッフとの会話・接客",
  "店内の居心地",
  "店内の清潔感",
  "施術技術（カットやカラー技術）",
  "施術の丁寧さ（ハサミやシャンプーの仕方など）",
  "施術時間",
  "待ち時間",
  "料金設定",
  "髪や頭皮の悩み解決",
  "自宅での扱いやすさ（家でもセットできそうか）"
];

const SATISFACTION = numbered([
  "とても満足した",
  "やや満足した",
  "どちらともいえない",
  "あまり満足しなかった",
  "まったく満足しなかった"
]);

// ------------------------------------------------------------------
// 設問定義
// ------------------------------------------------------------------

export function buildQuestions() {
  return [
    // 性別の「その他」は調査票にFA指定なし → 記述欄なし（画面側の自動付与を止める）。
    q("Q1", "性別を教えてください（ひとつだけ）", "single_choice", 1, {
      options: [...numbered(["男性", "女性"]), { value: "3", label: "その他", allow_free_text: false }]
    }),

    q("Q2", "年齢を教えてください", "numeric", 2, { min: 1, max: 100, unit: "歳", placeholder: "例: 35" }),

    // A市・B市は調査票の文言どおり（営業用の雛形）。
    q("Q3", "現在お住まいの市区町村を教えてください。（ひとつだけ）", "single_choice", 3, {
      options: [...numbered(["A市", "B市"]), other(3), exclusive(4, "答えたくない")]
    }),

    // カレンダー。過去のみ（本日を含む）。
    q(
      "Q4",
      "この美容室を利用したのはいつですか。",
      "date",
      4,
      { date_max_offset: 0 },
      { comment_bottom: "※本日ご利用の場合は本日の日付を選択してください。" }
    ),

    q("Q5", "この美容室に来たのは何回目ですか（ひとつだけ）", "single_choice", 5, {
      options: numbered(["１回目（初めて）", "２回目", "３回目", "４回目以上"])
    }),

    q("Q6", "今回、利用したメニューを教えてください（いくつでも）", "multi_choice", 6, {
      options: [
        ...numbered(["カット", "カラー", "パーマ", "縮毛矯正・ストレート", "トリートメント", "ヘッドスパ"]),
        other(7)
      ]
    }),

    q("Q7", "この美容室を知ったきっかけを教えてください（いくつでも）", "multi_choice", 7, {
      options: [
        ...numbered([
          "Googleマップ",
          "Google・Yahoo!などのネット検索",
          "家族・友人・知人からの紹介",
          "Instagram",
          "TikTokなどその他のSNS",
          "ホットペッパービューティーなどの美容室予約サイト",
          "Web広告・SNS広告",
          "チラシ",
          "店前を通りかかった時に見かけた"
        ]),
        other(10),
        exclusive(11, "覚えていない・分からない")
      ]
    }),

    q("Q8", "今回の総合的な満足度を教えてください。（ひとつだけ）", "single_choice", 8, { options: SATISFACTION }),

    q(
      "Q9",
      "その理由について具体的にお聞かせください。印象に残った出来事や体験について、どんなところが良かった・気になったのかを詳しくお聞かせください。",
      "free_text_long",
      9,
      { placeholder: "ご自由にご記入ください" }
    ),

    // SAMTX: 行＝評価項目12（ランダムなし）・列＝5段階＋利用していない・分からない
    q(
      "Q10",
      "以下の項目について、今回の満足度を教えてください。（それぞれひとつだけ）",
      "matrix_single",
      10,
      {
        matrix_rows: numbered(ASPECTS),
        matrix_cols: [...SATISFACTION, { value: "6", label: "利用していない・分からない" }],
        presentation: { pattern: "matrix_list" },
        matrix_page_size: 4
      },
      { comment_bottom: "利用・体験していない場合や判断できない場合は、「利用していない・分からない」をお選びください。" }
    ),

    // 13・14 は fix（ランダマイズ対象が無いので調査票どおり末尾）。
    q("Q11", "特に改善してほしいと感じたものを教えてください（いくつでも）", "multi_choice", 11, {
      options: [...numbered(ASPECTS), other(13), exclusive(14, "特になし")]
    }),

    // 1～7のスケール。ラベルは調査票の 1・4・7 のみ。
    q("Q12", "あなたはこの美容室をどのくらい友人に勧めたいですか", "numeric", 12, {
      min: 1,
      max: 7,
      options: [
        { value: "1", label: "とても勧めたい" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "どちらともいえない" },
        { value: "5", label: "5" },
        { value: "6", label: "6" },
        { value: "7", label: "まったく勧めたくない" }
      ]
    }),

    q(
      "Q13",
      "最後に、何かご要望や意見など、伝えたいことがあればなんでもお書きください",
      "free_text_long",
      13,
      { placeholder: "ご自由にご記入ください（任意）" },
      // 設問文が「伝えたいことがあれば」なので任意
      { is_required: false }
    )
  ];
}

// ------------------------------------------------------------------
// 投入 / 後片付け
// ------------------------------------------------------------------

async function createSupabase() {
  const { config: loadDotEnv } = await import("dotenv");
  loadDotEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 企業コードでクライアントを探し、無ければ登録する。同名で別コードがあれば止める。 */
async function ensureClient(supabase) {
  const { data: byCode, error } = await supabase.from("clients").select("id,name,company_code").ilike("company_code", CLIENT.company_code);
  if (error) throw new Error(`clients select failed: ${error.message}`);
  if (byCode.length > 0) {
    if (byCode[0].name !== CLIENT.name) {
      throw new Error(`企業コード ${CLIENT.company_code} は別名「${byCode[0].name}」で登録済みです。`);
    }
    return byCode[0].id;
  }
  const { data: byName } = await supabase.from("clients").select("id,company_code").eq("name", CLIENT.name);
  if ((byName ?? []).length > 0) {
    throw new Error(`「${CLIENT.name}」が企業コード ${byName[0].company_code ?? "(なし)"} で登録済みです。手動で確認してください。`);
  }
  const { data, error: insErr } = await supabase.from("clients").insert(CLIENT).select("id").single();
  if (insErr) throw new Error(`clients insert failed: ${insErr.message}`);
  console.log(`client created: ${CLIENT.name} (${CLIENT.company_code})`);
  return data.id;
}

async function cleanup(supabase) {
  const { data: sessions } = await supabase.from("sessions").select("id").eq("project_id", PROJECT_ID);
  const sessionIds = (sessions ?? []).map((s) => s.id);
  if (sessionIds.length > 0) {
    await supabase.from("answers").delete().in("session_id", sessionIds);
    await supabase.from("conversation_logs").delete().in("session_id", sessionIds);
  }
  for (const table of ["sessions", "project_assignments", "project_applications", "project_favorites", "questions"]) {
    const { error } = await supabase.from(table).delete().eq("project_id", PROJECT_ID);
    if (error) console.warn(`cleanup ${table}: ${error.message}`);
  }
  const { error } = await supabase.from("projects").delete().eq("id", PROJECT_ID);
  if (error) throw new Error(`projects delete failed: ${error.message}`);
  console.log("cleanup done");
}

async function main() {
  const supabase = await createSupabase();
  if (process.argv.includes("--cleanup")) {
    await cleanup(supabase);
    return;
  }

  // 同じ管理用名の別案件があれば重複作成しない。
  const { data: sameName } = await supabase.from("projects").select("id").eq("name", project.name).neq("id", PROJECT_ID);
  if ((sameName ?? []).length > 0) {
    throw new Error(`同じ管理用プロジェクト名の案件が既にあります: ${sameName.map((r) => r.id).join(", ")}`);
  }

  const { data: existingQs } = await supabase.from("questions").select("id").eq("project_id", PROJECT_ID);
  const existingIds = (existingQs ?? []).map((r) => r.id);
  if (existingIds.length > 0) {
    const { count } = await supabase.from("answers").select("id", { count: "exact", head: true }).in("question_id", existingIds);
    if ((count ?? 0) > 0 && !process.argv.includes("--force")) {
      throw new Error(`この案件には回答が ${count} 件あります。再投入すると回答が消えるため中止しました（--force で続行）。`);
    }
  }

  const clientId = await ensureClient(supabase);
  const questions = buildQuestions();

  const { error: pErr } = await supabase.from("projects").upsert({ ...project, client_id: clientId }, { onConflict: "id" });
  if (pErr) throw new Error(`projects upsert failed: ${pErr.message}`);
  console.log("project upserted");

  const { error: sErr } = await supabase.from("sessions").update({ current_question_id: null }).eq("project_id", PROJECT_ID);
  if (sErr) throw new Error(`sessions detach failed: ${sErr.message}`);
  const { error: dErr } = await supabase.from("questions").delete().eq("project_id", PROJECT_ID);
  if (dErr) throw new Error(`questions delete failed: ${dErr.message}`);
  const { error: qErr } = await supabase.from("questions").insert(questions);
  if (qErr) throw new Error(`questions insert failed: ${qErr.message}`);
  console.log(`questions inserted: ${questions.length}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
