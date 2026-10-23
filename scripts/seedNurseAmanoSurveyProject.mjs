/**
 * seedNurseAmanoSurveyProject.mjs
 *
 * 看護師（天野）授業後アンケート（1案件・16問）を冪等投入する。
 * 調査票: Box「調査票一覧.xlsx」シート「看護師（天野）」（2026-10-23 取得・P1=確定）
 *
 *   管理用プロジェクト名(L1): 2026-C0005-0001_看護師（天野）
 *   USER表示タイトル(E1):     授業後アンケート
 *   クライアント(F1):          看護師（天野）（企業コード C0005）
 *   管理年 2026 / 確定番号 1 / 用途 store / entry_code=nurse-amano
 *   作成のみ（status=draft）。公開・配信はしない。
 *
 * 【調査票の記法 → この repo の設定への対応】
 *  - B列は全問「全員」＝表示条件なし。H列（備考）・I列（画像）は全問空。
 *  - 選択肢番号(D列)をそのまま value にする（"1","2",…）。
 *  - F列の数値ラベルは Q14 の 1〜5（すべて「1」）のみ＝1〜5 をフルランダマイズ。
 *    6「その他（）」・7「特になし」は fix ＝ anchored_values（元の位置＝末尾に固定し、先頭には来ない）。
 *  - ex = exclusive / 選択肢行の FA = allow_free_text。
 *  - Q1 性別の「その他」は F/G に FA 指定なし → 記述欄なし。Q3/Q6 の「答えたくない」は ex 指定なし（SA なので影響なし）。
 *  - Q2 年齢は調査票が年代 SA なので single_choice のまま（他案件の numeric 1〜100歳 にはしない）。
 *  - Q9 SAMTX = matrix_single。「項目」ブロック（4項目）が行、「選択肢」ブロック（5段階）が列。F列なし＝ランダムなし。
 *  - Q12/Q13/Q15/Q16 の FA は設問文が「〜があれば」なので任意。謝礼は指示がないため 0。
 *
 * Usage:
 *   node scripts/seedNurseAmanoSurveyProject.mjs            # 投入
 *   node scripts/seedNurseAmanoSurveyProject.mjs --cleanup  # 案件と子レコードを削除（クライアントは残す）
 *
 * ⚠ 再実行は questions を delete→insert する。回答が1件でも入っていたら止まる（--force で続行。回答は消える）。
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ID = "a3a00005-0000-4000-8000-000000000001"; // a3a0 = "amano" / 0005 = C0005-0001
export const ENTRY_CODE = "nurse-amano";
export const CLIENT = { name: "看護師（天野）", company_code: "C0005" };

const now = new Date().toISOString();

export const project = {
  id: PROJECT_ID,
  name: "2026-C0005-0001_看護師（天野）",
  user_display_title: "授業後アンケート",
  client_name: CLIENT.name,
  management_year: 2026,
  confirmed_number: 1,
  survey_purpose: "store",
  objective: "受講者の属性・受講回数と、授業の総合満足度・項目別満足度・時間/難易度の適切さ・現場で役立つ点・改善要望・次回テーマを把握する",
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
  completion_message: "ご協力ありがとうございました。いただいたご意見は、今後の授業づくりに活用いたします。",
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

/** 「〜があれば」の任意自由記述。 */
const optionalFreeText = (code, text, sortOrder) =>
  q(code, text, "free_text_long", sortOrder, { placeholder: "ご自由にご記入ください（任意）" }, { is_required: false });

/**
 * F列のランダマイズラベル（[文言, ラベル]）→ options + option_randomization。
 * 整数部分でグループ化し、グループの順をランダム化。小数付きのグループは内部の順を固定する。
 */
export function groupRandom(items, fixed) {
  const options = items.map(([label], i) => ({ value: String(i + 1), label }));
  const groups = new Map();
  items.forEach(([, f], i) => {
    const key = String(f).split(".")[0];
    if (!groups.has(key)) groups.set(key, { label: key, values: [], decimals: 0, integers: 0 });
    const g = groups.get(key);
    g.values.push(String(i + 1));
    if (String(f).includes(".")) g.decimals += 1;
    else g.integers += 1;
  });
  for (const g of groups.values()) {
    if (g.decimals > 0 && g.integers > 0) throw new Error(`グループ ${g.label} に小数付きと小数なしが混在しています`);
  }
  return {
    options: [...options, ...fixed],
    option_randomization: {
      enabled: true,
      randomize_groups: true,
      groups: [...groups.values()].map(({ label, values, decimals }) => ({ label, values, ...(decimals > 0 ? { keep_order: true } : {}) })),
      anchored_values: fixed.map((o) => o.value)
    }
  };
}

// ------------------------------------------------------------------
// 共有の選択肢
// ------------------------------------------------------------------

const SATISFACTION = numbered([
  "とても満足した",
  "やや満足した",
  "どちらともいえない",
  "あまり満足しなかった",
  "まったく満足しなかった"
]);

/** Q9 の行（項目番号 1〜4）。 */
export const ASPECTS = ["授業テーマ", "授業のわかりやすさ", "講師の話す声量", "講師の話すスピード"];

/** Q14 の選択肢 1〜5（F列はすべて「1」＝フルランダマイズ）。 */
export const USEFUL_FORMATS = ["実際の事例", "自分の部署での場面例", "手元に残る資料", "手を動かす演習", "質問の時間"];

// ------------------------------------------------------------------
// 設問定義
// ------------------------------------------------------------------

export function buildQuestions() {
  return [
    // 性別の「その他」は調査票にFA指定なし → 記述欄なし（画面側の自動付与を止める）。
    q("Q1", "性別を教えてください（ひとつだけ）", "single_choice", 1, {
      options: [...numbered(["男性", "女性"]), { value: "3", label: "その他", allow_free_text: false }]
    }),

    q("Q2", "年齢を教えてください（ひとつだけ）", "single_choice", 2, {
      options: numbered(["10代", "20代", "30代", "40代", "50代", "60代", "70代以上"])
    }),

    // A市・B市は調査票の文言どおり。
    q("Q3", "現在お住まいの市区町村を教えてください。（ひとつだけ）", "single_choice", 3, {
      options: [...numbered(["A市", "B市"]), other(3), { value: "4", label: "答えたくない" }]
    }),

    q("Q4", "現在の職種を教えてください。（ひとつだけ）", "single_choice", 4, {
      options: [
        ...numbered(["看護師", "准看護師", "医師", "薬剤師", "リハビリ職（PT・OT・ST）", "介護職"]),
        other(7)
      ]
    }),

    q("Q5", "現在の職種での経験年数を教えてください。（ひとつだけ）", "single_choice", 5, {
      options: numbered(["3年未満", "3年以上10年未満", "10年以上"])
    }),

    q("Q6", "主な勤務先・所属部署を教えてください。（ひとつだけ）", "single_choice", 6, {
      options: [...numbered(["病棟", "外来", "在宅・訪問"]), other(4), { value: "5", label: "答えたくない" }]
    }),

    q("Q7", "この講師の授業を受けに来たのは何回目ですか（ひとつだけ）", "single_choice", 7, {
      options: numbered(["１回目（初めて）", "２回目", "３回目", "４回目以上"])
    }),

    q("Q8", "今回の授業の総合的な満足度を教えてください。（ひとつだけ）", "single_choice", 8, { options: SATISFACTION }),

    // SAMTX: 行＝項目4（ランダムなし）・列＝5段階
    q(
      "Q9",
      "以下の項目について、今回の満足度を教えてください。（それぞれひとつだけ）",
      "matrix_single",
      9,
      {
        matrix_rows: numbered(ASPECTS),
        matrix_cols: SATISFACTION,
        presentation: { pattern: "matrix_list" },
        matrix_page_size: 4
      }
    ),

    q("Q10", "今回の授業時間は、内容に対していかがでしたか。（ひとつだけ）", "single_choice", 10, {
      options: numbered(["長すぎた", "やや長かった", "ちょうどよかった", "やや短かった", "短すぎた"])
    }),

    q("Q11", "今回の内容は、ご自身にとってどうでしたか。（ひとつだけ）", "single_choice", 11, {
      options: numbered([
        "とても難しい内容だった",
        "やや難しい内容だった",
        "ちょうどよかった",
        "やや簡単な内容だった",
        "とても簡単な内容だった"
      ])
    }),

    optionalFreeText(
      "Q12",
      "今回の授業で、ご自身の仕事に役立ちそうだと思ったことはありますか。具体的な内容や、使えそうな場面があれば教えてください。",
      12
    ),

    optionalFreeText(
      "Q13",
      "今回の授業で、もう少し説明を聞きたかったことや、具体例を見たかったことがあれば教えてください。",
      13
    ),

    // 1〜5 はF列「1」＝フルランダマイズ。6・7 は fix（末尾固定）。7 は ex。
    q(
      "Q14",
      "どのようなものがあれば、より現場で使える授業になると思いますか。（いくつでも）",
      "multi_choice",
      14,
      groupRandom(
        USEFUL_FORMATS.map((label) => [label, "1"]),
        [other(6), exclusive(7, "特になし")]
      )
    ),

    optionalFreeText(
      "Q15",
      "普段の仕事で「判断に迷う」「対応に自信がない」「理由をうまく説明できない」と感じた場面があれば教えてください。また次回取り上げてほしいテーマがあれば、あわせて教えてください。",
      15
    ),

    optionalFreeText("Q16", "その他、感想や講師に伝えたいことがあれば、ご自由にお書きください。", 16)
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
