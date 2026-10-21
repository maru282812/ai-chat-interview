/**
 * seedTsuribuneJokerSurveyProject.mjs
 *
 * 釣り船ジョーカー お客様アンケート（1案件・15問）を冪等投入する。
 * 調査票: Box「調査票一覧.xlsx」シート「釣り船ジョーカー」（2026-10-21 取得・P1=作成中）
 *
 *   管理用プロジェクト名(L1): 2026-C0003-0001_釣り船ジョーカー
 *   USER表示タイトル(E1):     釣り船ジョーカーお客様アンケート
 *   クライアント(F1):          釣り船ジョーカー（企業コード C0003・B1=https://yuriagejoker.amebaownd.com/）
 *   管理年 2026 / 確定番号 1 / 用途 store / entry_code=tsuribune-joker
 *   作成のみ（status=draft）。公開・配信はしない。
 *
 * 【調査票の記法 → この repo の設定への対応】
 *  - B列は全問「全員」＝表示条件なし。H列（備考）・I列（画像）は全問空＝同時表示・画像の指定なし。
 *  - 選択肢番号(D列)をそのまま value にする（"1","2",…）。表示順を変えても value は変わらない。
 *  - F列の数値＝整数部分でグループ化し、グループの順をランダム化。Q8・Q9 は全行 1 ＝フルランダム。
 *  - fix = anchored_values（調査票どおり末尾。先頭には来ない）/ ex = exclusive / FA（選択肢行）= allow_free_text。
 *  - Q7「ひとりで」の ex は例外注記なし＝他のすべての選択肢と排他（exclusive: true）。
 *  - Q12 SAMTX = matrix_single（F列なし＝ランダムなし）。matrix_list で 4 項目ずつページ分割（11行 → 4/4/3）。
 *  - 設問文の「※…」注記・補足行は comment_bottom に出す。
 *  - Q2 年齢（FA）はかすみがうら／つくばわんわんランドと同じ numeric（1〜100歳）。
 *  - Q15「〜があれば」の FA は任意。謝礼は指示がないため 0。
 *
 * Usage:
 *   node scripts/seedTsuribuneJokerSurveyProject.mjs            # 投入
 *   node scripts/seedTsuribuneJokerSurveyProject.mjs --cleanup  # 案件と子レコードを削除（クライアントは残す）
 *
 * ⚠ 再実行は questions を delete→insert する。回答が1件でも入っていたら止まる（--force で続行。回答は消える）。
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ID = "b0a70001-0000-4000-8000-000000000001"; // b0a7 = "boat" / 0001 = C0003-0001
export const ENTRY_CODE = "tsuribune-joker";
export const CLIENT = { name: "釣り船ジョーカー", company_code: "C0003" };

const now = new Date().toISOString();

export const project = {
  id: PROJECT_ID,
  name: "2026-C0003-0001_釣り船ジョーカー",
  user_display_title: "釣り船ジョーカーお客様アンケート",
  client_name: CLIENT.name,
  management_year: 2026,
  confirmed_number: 1,
  survey_purpose: "store",
  objective: "乗船客の属性・船釣り経験・同行者・認知経路・利用理由と、総合満足度・項目別満足度・改善要望・再利用意向を把握する",
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
  completion_message:
    "ご協力ありがとうございました。いただいたご意見は、釣り船ジョーカーをより快適にご利用いただくために活用いたします。",
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

/**
 * F列の数値ラベルからランダマイズ設定を作る。
 * items = [[label, "1.1"], …]（選択肢番号は並び順）/ fixed = 末尾固定（調査票の位置）
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

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県",
  "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

/** Q12 の行・Q13 の選択肢（選択肢番号 1〜11）。 */
export const ASPECTS = [
  "ホームページの見やすさ",
  "予約・問い合わせへの対応",
  "集合場所・駐車場の案内",
  "船上の雰囲気",
  "船長の説明・対応",
  "安全面の説明・声かけ",
  "レンタル品の手入れ具合",
  "船内の清潔感",
  "トイレの清潔感",
  "今回のご自身の釣果（釣れた魚の数・大きさ・種類など）",
  "料金設定"
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
  const companions = [
    "ひとりで",
    "恋人・パートナー",
    "配偶者",
    "親",
    "祖父母",
    "小学生以下のお子さま",
    "中学生のお子さま",
    "高校生のお子さま",
    "大学生以上のお子さま",
    "その他の家族・親族",
    "友人",
    "仕事仲間"
  ];

  return [
    // 性別の「その他」は調査票にFA指定なし → 記述欄なし（画面側の自動付与を止める）。
    q("Q1", "性別を教えてください（ひとつだけ）", "single_choice", 1, {
      options: [...numbered(["男性", "女性"]), { value: "3", label: "その他", allow_free_text: false }]
    }),

    q("Q2", "年齢を教えてください", "numeric", 2, { min: 1, max: 100, unit: "歳", placeholder: "例: 35" }),

    q(
      "Q3",
      "現在お住まいの都道府県を教えてください。（ひとつだけ）",
      "single_choice",
      3,
      { options: [...PREFECTURES.map((label) => ({ value: label, label })), { value: "overseas", label: "海外" }] },
      { comment_bottom: "※海外にお住まいの方は「海外」をお選びください" }
    ),

    // カレンダー。過去のみ（本日を含む）。
    q(
      "Q4",
      "「釣り船 ジョーカー」に乗船したのはいつですか。",
      "date",
      4,
      { date_max_offset: 0 },
      { comment_bottom: "※本日乗船した場合は本日の日付を選択してください。" }
    ),

    q("Q5", "「釣り船 ジョーカー」に乗船したのは、今回で何回目ですか（ひとつだけ）", "single_choice", 5, {
      options: numbered(["１回目（初めて）", "２回目", "３回目", "４回目以上"])
    }),

    q(
      "Q6",
      "今回を含めて、船釣りをした経験は何回ありますか。（ひとつだけ）",
      "single_choice",
      6,
      { options: numbered(["１回目（今回が初めて）", "２回目", "３回目～５回目", "６回目～９回目", "１０回～"]) },
      { comment_bottom: "海・川・湖は問いません。" }
    ),

    // ひとりで(1) は ex（例外注記なし）＝他のすべてと排他。
    q(
      "Q7",
      "今回は、誰と一緒に乗船されましたか（いくつでも）",
      "multi_choice",
      7,
      {
        options: [
          ...numbered(companions).map((o) =>
            o.value === "1"
              ? { ...o, exclusive: true }
              : // 「その他」始まりのラベルは画面側が自動で記述欄を付けるため止める（調査票にFA指定なし）
                o.label === "その他の家族・親族"
                ? { ...o, allow_free_text: false }
                : o
          ),
          other(13)
        ]
      },
      { comment_bottom: "※お子さまの区分には、お孫さま・同行者のお子さまも含みます。" }
    ),

    q(
      "Q8",
      "「釣り船 ジョーカー」を知ったきっかけを教えてください（いくつでも）",
      "multi_choice",
      8,
      groupRandom(
        [
          ["Googleマップ", "1"],
          ["Google・Yahoo!などのネット検索", "1"],
          ["家族・友人・知人からの紹介", "1"],
          ["釣具店からの紹介", "1"],
          ["Instagram", "1"],
          ["YouTube", "1"],
          ["TikTokなどその他のSNS", "1"],
          ["釣り情報サイト・遊漁船検索サイト", "1"],
          ["Web広告・SNS広告", "1"],
          ["チラシ", "1"],
          ["漁港で見かけた", "1"]
        ],
        [other(12), exclusive(13, "覚えていない・分からない")]
      )
    ),

    q(
      "Q9",
      "今回、「釣り船 ジョーカー」を利用することを決めた理由を教えてください。（いくつでも）",
      "multi_choice",
      9,
      groupRandom(
        [
          ["狙いたい魚が釣れそうだったから", "1"],
          ["釣果情報を見て、釣れそうだと思ったから", "1"],
          ["船の設備や快適さが良さそうだったから", "1"],
          ["船長の人柄や対応が良さそうだったから", "1"],
          ["初心者でも楽しめそうだったから", "1"],
          ["料金が予算に合っていたから", "1"],
          ["出船場所が利用しやすかったから", "1"],
          ["希望する日に予約できたから", "1"],
          ["少人数で貸し切りができるから", "1"],
          ["以前利用して良かったから", "1"],
          ["家族・友人などに勧められたから", "1"],
          ["同行者が選んだ・誘ってくれたから", "1"],
          ["子どもが行きたがっていたから", "1"],
          ["SNSの投稿・動画を見て行きたくなったから", "1"]
        ],
        [other(15), exclusive(16, "なんとなく・特になし")]
      )
    ),

    q("Q10", "今回の乗船について、総合的な満足度を教えてください。（ひとつだけ）", "single_choice", 10, { options: SATISFACTION }),

    // 調査票 H列に同時表示の指定なし → Q10 とは別画面。
    q(
      "Q11",
      "その理由について具体的にお聞かせください。印象に残った出来事や体験について、どんなところが良かった・気になったのかを詳しくお聞かせください。",
      "free_text_long",
      11,
      { placeholder: "ご自由にご記入ください" }
    ),

    // SAMTX: 行＝評価項目（ランダムなし）・列＝5段階＋利用していない・分からない
    q(
      "Q12",
      "以下の項目について、今回の満足度を教えてください。（それぞれひとつだけ）",
      "matrix_single",
      12,
      {
        matrix_rows: numbered(ASPECTS),
        matrix_cols: [...SATISFACTION, { value: "6", label: "利用していない・分からない" }],
        presentation: { pattern: "matrix_list" },
        matrix_page_size: 4
      },
      { comment_bottom: "利用・体験していない場合や判断できない場合は、「利用していない・分からない」をお選びください。" }
    ),

    q("Q13", "特に改善してほしいと感じたものを教えてください（いくつでも）", "multi_choice", 13, {
      options: [...numbered(ASPECTS), other(12), exclusive(13, "特になし")]
    }),

    q("Q14", "あなたは、また「釣り船 ジョーカー」を利用したいですか。（ひとつだけ）", "single_choice", 14, {
      options: numbered(["とても利用したい", "やや利用したい", "どちらともいえない", "あまり利用したくない", "まったく利用したくない"])
    }),

    q(
      "Q15",
      "最後に、何かご要望や意見など、伝えたいことがあればなんでもお書きください",
      "free_text_long",
      15,
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
