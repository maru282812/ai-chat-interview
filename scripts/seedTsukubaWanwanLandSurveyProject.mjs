/**
 * seedTsukubaWanwanLandSurveyProject.mjs
 *
 * つくばわんわんランド お客様アンケート（1案件・16問）を冪等投入する。
 * 調査票: Box「調査票一覧.xlsx」シート「つくばわんわんランド」（2026-10-21 取得）
 * 既存の wanwan-land / wanwan-land-v2 とは別案件。
 *
 *   管理用プロジェクト名(L1): 2026-C0002-0001_つくばわんわんランド
 *   USER表示タイトル(E1):     つくばわんわんランドお客様アンケート
 *   クライアント(F1):          つくばわんわんランド（企業コード C0002）
 *   管理年 2026 / 確定番号 1 / 用途 store / entry_code=tsukuba-wanwan-land
 *   作成のみ（status=draft）。公開・配信はしない。
 *
 * 【調査票の記法 → この repo の設定への対応】
 *  - 選択肢番号(D列)をそのまま value にする（"1","2",…）。表示順を変えても value は変わらない。
 *  - F列の数値＝整数部分でグループ化し、グループの順をランダム化。
 *      小数（1.1, 1.2 …）は同じグループで、その順に固定（groups[].keep_order）。
 *      同じ整数だけが並ぶグループ（Q7 の 1）はグループ内をフルランダム。
 *  - fix = anchored_values（調査票どおり末尾。先頭には来ない）/ ex = exclusive / FA（選択肢行）= allow_free_text。
 *  - Q6「1は13のみ同時選択可能」= ひとりで(1) は ペット(13) 以外と排他 → exclusive_with。
 *  - Q10「Q9=1-14」＋H列 = Q9 で特になし以外を選んだ人。選択肢は Q9 で選んだものだけ＋常に「特になし」。
 *      Q9 は必須回答で「特になし」は排他なので、「特になしでない」＝「1〜14 をひとつ以上」。
 *      Q9 の「その他」は記述文で保存され value が一致しないため Q10 には持ち越せない。
 *  - Q11「Q6=6-8いずれか」= 小学生以下・中学生・高校生のいずれか（OR）。H列「Q9で絞り込まない」。
 *  - Q9〜Q11 の I列画像 = 選択肢カードの写真（wanwan-land.co.jp・目視で照合済み）。アンパンマンの遊具は画像指定なし。
 *  - Q13「Q12と同時表示」= display_tags_parsed.screenGroup。
 *  - Q14 SAMTX = matrix_single（F列なし＝ランダムなし）。matrix_list で 4 項目ずつページ分割。
 *  - 設問文の「※…」注記は comment_bottom に出す。Q2 年齢はわんわんランド既存案件と同じ numeric。
 *
 * Usage:
 *   node scripts/seedTsukubaWanwanLandSurveyProject.mjs            # 投入（画像アップロード込み）
 *   node scripts/seedTsukubaWanwanLandSurveyProject.mjs --cleanup  # 案件と子レコードを削除（クライアントは残す）
 *
 * ⚠ 再実行は questions を delete→insert する。回答が1件でも入っていたら止まる（--force で続行。回答は消える）。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ID = "1a0d0003-0000-4000-8000-000000000001"; // 1a0d = "land" / 0003 = C0002-0001
export const ENTRY_CODE = "tsukuba-wanwan-land";
export const CLIENT = { name: "つくばわんわんランド", company_code: "C0002" };
export const STORAGE_BUCKET = "question-images";
export const STORAGE_PREFIX = "tsukuba-wanwan-land";
export const ASSET_DIR = path.join(process.cwd(), "scripts", "assets", "tsukuba-wanwan-land");

const now = new Date().toISOString();

export const project = {
  id: PROJECT_ID,
  name: "2026-C0002-0001_つくばわんわんランド",
  user_display_title: "つくばわんわんランドお客様アンケート",
  client_name: CLIENT.name,
  management_year: 2026,
  confirmed_number: 1,
  survey_purpose: "store",
  objective: "来園者の属性・同行者・認知経路・来園理由・体験したものと、総合満足度・項目別満足度・改善要望を把握する",
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
    "ご協力ありがとうございました。いただいたご意見は、つくばわんわんランドをより楽しんでいただくために活用いたします。",
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

/** Q9〜Q11 の園内施設（選択肢番号 1〜13）。[label, imageKey] imageKey は I列の画像ファイル名。 */
export const FACILITIES = [
  ["わんわんレンタル", "img_area01"],
  ["わんちゃんふれあいコーナー（小型犬）", "img_enjoy02"],
  ["わんちゃんふれあいコーナー（中型～大型犬）", "img_enjoy02"],
  ["ねこハウス", "img_enjoy03"],
  ["わんわんドリームショー", "img_enjoy04"],
  ["わんわんレースショー", "img_enjoy05"],
  ["子犬展示館", "img_enjoy06"],
  ["大型展示館", "img_enjoy07"],
  ["モックン広場", "img_enjoy08"],
  ["だっくん広場", "img_enjoy09"],
  ["わんわんkitchen", "img_enjoy10"],
  ["わんわんギフトショップ", "img_enjoy11"],
  ["ドッグラン", "img_area10"]
];

/** Q14 の行・Q15 の選択肢（選択肢番号 1〜12）。 */
const ASPECTS = [
  "ホームページの見やすさ",
  "駐車場の案内",
  "ふれあえる犬・猫の種類",
  "遊び・体験の種類の豊富さ",
  "スタッフの説明・対応",
  "動物とふれあえる時間",
  "体験・サービスの待ち時間",
  "園内案内・イベント情報の分かりやすさ",
  "園内の清潔さ",
  "園内のニオイへの対策",
  "休憩場所の快適さ",
  "料金設定"
];

const SATISFACTION = numbered([
  "とても満足した",
  "やや満足した",
  "どちらともいえない",
  "あまり満足しなかった",
  "まったく満足しなかった"
]);

const CARD = { display_format: "card", grid_cols: 2 };

/** Q6 の「お子さま」= 6 小学生以下 / 7 中学生 / 8 高校生。 */
const WITH_CHILD = ["6", "7", "8"].map((v) => `q6 includes ${v}`).join(" or ");

// ------------------------------------------------------------------
// 設問定義
// ------------------------------------------------------------------

/**
 * @param imageUrlByKey { img_area01: "https://…/img_area01.jpg", … }（テストでは任意の文字列でよい）
 */
export function buildQuestions(imageUrlByKey = {}) {
  const facilities = () =>
    FACILITIES.map(([label, key], i) => {
      const o = { value: String(i + 1), label };
      if (key && imageUrlByKey[key]) o.imageUrl = imageUrlByKey[key];
      return o;
    });

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
    "仕事仲間",
    "ペット"
  ];
  // ひとりで(1) はペット(13) 以外のすべて（その他 14 を含む）と排他。
  const aloneExclusiveWith = [...companions.map((_, i) => String(i + 1)).filter((v) => v !== "1" && v !== "13"), "14"];

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
      "「つくばわんわんランド」に来園したのはいつですか。",
      "date",
      4,
      { date_max_offset: 0 },
      { comment_bottom: "※本日来園した場合は本日の日付を選択してください。" }
    ),

    q("Q5", "「つくばわんわんランド」に来園したのは、今回で何回目ですか（ひとつだけ）", "single_choice", 5, {
      options: numbered(["１回目（初めて）", "２回目", "３回目", "４回目以上"])
    }),

    q(
      "Q6",
      "誰と一緒に来園されましたか（いくつでも）",
      "multi_choice",
      6,
      {
        options: [
          ...numbered(companions).map((o) =>
            o.value === "1"
              ? { ...o, exclusive_with: aloneExclusiveWith }
              : // 「その他」始まりのラベルは画面側が自動で記述欄を付けるため止める（調査票にFA指定なし）
                o.label === "その他の家族・親族"
                ? { ...o, allow_free_text: false }
                : o
          ),
          other(14)
        ]
      },
      { comment_bottom: "※お子さまの区分には、お孫さま・同行者のお子さまも含みます。" }
    ),

    q(
      "Q7",
      "「つくばわんわんランド」を知ったきっかけを教えてください（いくつでも）",
      "multi_choice",
      7,
      groupRandom(
        [
          ["Googleマップ", "1"],
          ["Google・Yahoo!などのネット検索", "1"],
          ["家族・友人・知人からの紹介", "1"],
          ["Instagram", "1"],
          ["YouTube", "1"],
          ["TikTokなどその他のSNS", "1"],
          ["観光・お出かけ情報サイト", "1"],
          ["Web広告・SNS広告", "1"],
          ["チラシ", "1"],
          ["当園の前を通りかかった時に見かけた", "1"]
        ],
        [other(11), exclusive(12, "覚えていない・分からない")]
      )
    ),

    q(
      "Q8",
      "今回、「つくばわんわんランド」に来園することを決めた理由を教えてください。（いくつでも）",
      "multi_choice",
      8,
      groupRandom(
        [
          ["犬とふれあいたかったから", "1.1"],
          ["猫とふれあいたかったから", "1.2"],
          ["わんわんレンタルで犬と散歩したかったから", "2"],
          ["お気に入りの犬・猫や、特定の犬種に会いたかったから", "3"],
          ["子どもに動物とのふれあいを体験させたかったから", "4.1"],
          ["子どもが行きたがっていたから", "4.2"],
          ["ショー・レース・イベントを楽しみたかったから", "5"],
          ["愛犬と一緒に楽しめる施設だったから", "6"],
          ["SNSの投稿・動画を見て行きたくなったから", "7"],
          ["家族・友人などに誘われた、勧められたから", "8"],
          ["愛犬をドッグランで遊ばせたかったから", "9"],
          ["有名な施設だったから", "10"]
        ],
        [other(13)]
      )
    ),

    // ランダムなし・写真つきカード。
    q("Q9", "今回、あなた自身が体験したり、利用したものをすべてお選びください（いくつでも）", "multi_choice", 9, {
      options: [...facilities(), other(14), exclusive(15, "特になし")],
      ...CARD
    }),

    // Q9 で特になし以外（1〜14）を選んだ人。Q9 で選んだもの＋常に「特になし」。
    q(
      "Q10",
      "その中で、特に楽しめたものを最大３つまでお選びください（３つまで）",
      "multi_choice",
      10,
      { options: [...facilities(), other(14), exclusive(15, "特になし")], max_select: 3, ...CARD },
      {
        visibility_conditions: [{ type: "pipe_expression", expression: "not q9 includes 15" }],
        display_tags_parsed: { optionSource: { fromQuestion: "q9", mode: "selected", alwaysInclude: ["15"] } }
      }
    ),

    // お子さま（Q6 の 6〜8 のいずれか）と来園した人。Q9 では絞らない。
    q(
      "Q11",
      "ご一緒のお子さまが、特に楽しそうにしていたものを最大３つまでお選びください。（３つまで）",
      "multi_choice",
      11,
      {
        options: [
          ...facilities(),
          { value: "14", label: "アンパンマンの遊具" },
          other(15),
          exclusive(16, "特になし"),
          exclusive(17, "分からない・判断できない")
        ],
        max_select: 3,
        ...CARD
      },
      {
        visibility_conditions: [{ type: "pipe_expression", expression: WITH_CHILD }],
        comment_bottom: "※複数のお子さまがいる場合は、お子さま全体についてお答えください。\n※お孫さま・同行者のお子さまも含みます"
      }
    ),

    // Q12 と Q13 は同じ画面に出す。
    q("Q12", "今回の総合的な満足度を教えてください。（ひとつだけ）", "single_choice", 12, { options: SATISFACTION }, {
      display_tags_parsed: { screenGroup: { groupId: "overall" } }
    }),

    q(
      "Q13",
      "その理由について具体的にお聞かせください。印象に残ったイベントや体験について、どんなところが良かった・気になったのかを詳しくお聞かせください。",
      "free_text_long",
      13,
      { placeholder: "ご自由にご記入ください" },
      { display_tags_parsed: { screenGroup: { groupId: "overall" } } }
    ),

    // SAMTX: 行＝評価項目（ランダムなし）・列＝5段階＋利用していない・分からない
    q(
      "Q14",
      "以下の項目について、今回の満足度を教えてください。（それぞれひとつだけ）",
      "matrix_single",
      14,
      {
        matrix_rows: numbered(ASPECTS),
        matrix_cols: [...SATISFACTION, { value: "6", label: "利用していない・分からない" }],
        presentation: { pattern: "matrix_list" },
        matrix_page_size: 4
      },
      { comment_bottom: "利用・体験していない場合や判断できない場合は、「利用していない・分からない」をお選びください。" }
    ),

    q("Q15", "特に改善してほしいと感じたものを教えてください（いくつでも）", "multi_choice", 15, {
      options: [...numbered(ASPECTS), other(13), exclusive(14, "特になし")]
    }),

    q(
      "Q16",
      "最後に、何かご要望や意見など、伝えたいことがあればなんでもお書きください",
      "free_text_long",
      16,
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

async function uploadImages(supabase) {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`storage listBuckets failed: ${listErr.message}`);
  if (!(buckets ?? []).some((b) => b.name === STORAGE_BUCKET)) {
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
    if (error) throw new Error(`storage createBucket failed: ${error.message}`);
  }
  const result = {};
  for (const file of readdirSync(ASSET_DIR).filter((f) => f.endsWith(".jpg")).sort()) {
    const key = file.replace(/\.jpg$/, "");
    const storagePath = `${STORAGE_PREFIX}/${file}`;
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, readFileSync(path.join(ASSET_DIR, file)), { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(`upload ${file} failed: ${error.message}`);
    result[key] = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }
  console.log(`images uploaded: ${Object.keys(result).length}`);
  return result;
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
  const imageUrlByKey = await uploadImages(supabase);
  const questions = buildQuestions(imageUrlByKey);

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
