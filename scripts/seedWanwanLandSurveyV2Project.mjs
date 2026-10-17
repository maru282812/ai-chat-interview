/**
 * seedWanwanLandSurveyV2Project.mjs
 *
 * つくばわんわんランド 来園者アンケート【改善版】（1案件・15問）を冪等投入する。
 * 調査票（Excel「わんわんランド (2)」シート・2026-10-18）をそのまま設問定義に落としている。
 * 初版（scripts/seedWanwanLandSurveyProject.mjs・entry_code=wanwan-land）は別案件として残す。
 *
 *   案件: 【つくばわんわんランド】来園者アンケート（改善版）   entry_code=wanwan-land-v2
 *   回答者に見えるタイトル: わんわんらんどの簡単アンケート
 *   店舗QR / 専用URL からの流入のみ（visibility_type=private_store・探す一覧には出ない）
 *
 * 【調査票の記法 → この repo の設定への対応】（初版と同じものは省略。初版 seed 冒頭を参照）
 *
 *  - F列の数値（1 / 1.1 / 1.2 / 4.1 …）＝1の位でグループ化したランダマイズ（Q6・Q7・Q13）。
 *  - Q5「ひとりで」＝排他だが「ペット」だけ同時選択可 → option.exclusive_with（ペット以外の全 value）。
 *  - Q8〜Q10 はランダムなし・写真つきカード（初版と同じ写真）。
 *  - Q9「Q8=1-14」＝Q8 で 1〜14 をひとつ以上選んだ人（＝「特になし」でない人。特になしは排他）。
 *      選択肢は Q8 で選んだものだけに絞り、「特になし」は常に出す
 *      → optionSource { fromQuestion:"q8", mode:"selected", alwaysInclude:["none"] }
 *  - Q10「Q5=6-8いずれか」＝小学生以下 / 中学生 / 高校生のお子さま。Q8 では絞らない。
 *  - Q11 と Q12 は同時表示 → display_tags_parsed.screenGroup。
 *  - Q13（SAMTX）は行を F列どおりグループランダム（園内の清潔さ 7.1 / ニオイ 7.2 は隣り合う）。
 *      matrix_list で 4 項目ずつページ分割（初版と同じ）。
 *  - Q14「Q13の項目と同順」→ option_randomization.follow_question = "Q13"
 *      （回答者ごとに Q13 で実際に表示された行の順に並べる。その他 / 特になしは末尾固定）。
 *  - 設問文の「※…」注記は comment_bottom（設問文の直下・選択肢の上）に出す。
 *
 * Usage:
 *   node scripts/seedWanwanLandSurveyV2Project.mjs            # 投入（画像アップロード込み）
 *   node scripts/seedWanwanLandSurveyV2Project.mjs --cleanup  # 案件と子レコードを削除
 *
 * ⚠ 再実行は questions を delete→insert する。回答が1件でも入っていたら止まる（--force で続行。回答は消える）。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ID = "1a0d0002-0000-4000-8000-000000000001"; // 1a0d = "land" / 0002 = 改善版
export const ENTRY_CODE = "wanwan-land-v2";
export const STORAGE_BUCKET = "question-images";
export const STORAGE_PREFIX = "wanwan-land";
export const ASSET_DIR = path.join(process.cwd(), "scripts", "assets", "wanwan-land");

const now = new Date().toISOString();

export const project = {
  id: PROJECT_ID,
  name: "【つくばわんわんランド】来園者アンケート（改善版）",
  user_display_title: "わんわんらんどの簡単アンケート",
  client_name: "つくばわんわんランド",
  objective: "来園者の属性・同行者・認知経路・来園理由・園内で体験したものと、総合満足度・項目別満足度・改善要望を把握する",
  status: "published",
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
  reward_points: 10,
  estimated_minutes: 3,
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

const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));

/** 「その他（）」= 自由記述つき。 */
const OTHER = { value: "other", label: "その他", allow_free_text: true };
/** 「特になし」= 排他。 */
const NONE = { value: "none", label: "特になし", exclusive: true };

/**
 * F列の数値からランダマイズ設定を作る（1の位でグループ化・群順も群内もランダム）。
 * items = [[value, label, group], ...] / fixed = 末尾固定（その他 / 特になし 等）
 */
export function randomized(items, fixed = []) {
  const groupMap = new Map();
  for (const [value, , group] of items) {
    const key = String(group).split(".")[0];
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(value);
  }
  return {
    options: [...items.map(([value, label]) => ({ value, label })), ...fixed],
    option_randomization: {
      enabled: true,
      randomize_groups: true,
      groups: [...groupMap.entries()].map(([label, values]) => ({ label, values })),
      anchored_values: fixed.map((o) => o.value)
    }
  };
}

// ------------------------------------------------------------------
// 園内施設（Q8〜Q10 で共有。value を揃えることで Q8→Q9 の持ち越しが value 一致で成立する）
// [value, label, imageKey]  imageKey は scripts/assets/wanwan-land/<key>.jpg（初版と同じ写真）
// ------------------------------------------------------------------

export const FACILITIES = [
  ["rental", "わんわんレンタル", "rental"],
  ["fureai_small", "わんちゃんふれあいコーナー（小型犬）", "fureai"],
  ["fureai_large", "わんちゃんふれあいコーナー（中型〜大型犬）", "fureai"],
  ["neko_house", "ねこハウス", "neko_house"],
  ["dream_show", "わんわんドリームショー", "dream_show"],
  ["race_show", "わんわんレースショー", "race_show"],
  ["puppy_hall", "子犬展示館", "puppy_hall"],
  ["large_dog_hall", "大型展示館", "large_dog_hall"],
  ["mokkun", "モックン広場", "mokkun"],
  ["dakkun", "だっくん広場", "dakkun"],
  ["kitchen", "わんわんkitchen", "kitchen"],
  ["gift_shop", "わんわんギフトショップ", "gift_shop"],
  ["dog_run", "ドッグラン", "dog_run"]
];

/** Q10 だけにある子ども向け遊具（公式サイトに写真が無いため文字のみ）。 */
export const CHILD_PLAY = [
  ["anpanman_play", "アンパンマンの遊具", null],
  ["lawn_play", "芝生の遊具", null]
];

/** 項目別満足度（Q13 の行・Q14 の選択肢で共有）。[value, label, group] */
export const ASPECTS = [
  ["parking", "駐車場の案内", "1"],
  ["homepage", "ホームページの見やすさ", "2"],
  ["animal_variety", "ふれあえる犬・猫の種類", "3"],
  ["fureai_time", "動物とふれあえる時間", "4"],
  ["wait_time", "体験・サービスの待ち時間", "5"],
  ["staff", "スタッフの説明・対応", "6"],
  ["cleanliness", "園内の清潔さ", "7.1"],
  ["smell", "園内のニオイへの対策", "7.2"],
  ["rest_comfort", "休憩所の快適さ", "8"],
  ["guide_info", "園内案内・イベント情報の分かりやすさ", "9"],
  ["price", "支払った料金に対する満足感", "10"],
  ["activities", "遊び・体験の種類の豊富さ", "11"]
];

/** 施設カード（写真つき）。imageUrlByKey に無いキーは文字のみ。 */
function facilityCards(items, imageUrlByKey) {
  return items.map(([value, label, imageKey]) =>
    imageKey && imageUrlByKey[imageKey] ? { value, label, imageUrl: imageUrlByKey[imageKey] } : { value, label }
  );
}

/** 「お子さま」= Q5 の 6〜8（小学生以下 / 中学生 / 高校生）。大学生以上は含めない。 */
export const CHILD_VALUES = ["child_elementary", "child_junior_high", "child_high_school"];
const WITH_CHILD = CHILD_VALUES.map((v) => `q5 includes ${v}`).join(" or ");

const CARD = { display_format: "card", grid_cols: 2 };

// ------------------------------------------------------------------
// 設問定義
// ------------------------------------------------------------------

/** Q5 同行者。「ひとりで」はペット以外と排他。 */
const COMPANIONS = [
  ["alone", "ひとりで"],
  ["partner", "恋人・パートナー"],
  ["spouse", "配偶者"],
  ["parent", "親"],
  ["grandparent", "祖父母"],
  ["child_elementary", "小学生以下のお子さま"],
  ["child_junior_high", "中学生のお子さま"],
  ["child_high_school", "高校生のお子さま"],
  ["child_university", "大学生以上のお子さま"],
  ["other_family", "その他の家族・親族"],
  ["friend", "友人"],
  ["coworker", "仕事仲間"],
  ["pet", "ペット"]
];

/**
 * @param imageUrlByKey { rental: "https://…/rental.jpg", … }（テストでは任意の文字列でよい）
 */
export function buildQuestions(imageUrlByKey = {}) {
  const facilities = facilityCards(FACILITIES, imageUrlByKey);
  const aloneExclusiveWith = [...COMPANIONS.map(([v]) => v).filter((v) => v !== "alone" && v !== "pet"), OTHER.value];

  return [
    // 性別の「その他」は記述欄なし（画面側の自動付与を明示的に止める）。
    q("Q1", "性別を教えてください（ひとつだけ）", "single_choice", 1, {
      options: [...opts(["male", "男性"], ["female", "女性"]), { value: "other", label: "その他", allow_free_text: false }]
    }),

    q("Q2", "年齢を教えてください", "numeric", 2, { min: 1, max: 100, unit: "歳", placeholder: "例: 35" }),

    // カレンダー。過去のみ（本日を含む）。
    q(
      "Q3",
      "「つくばわんわんランド」に来園したのはいつですか",
      "date",
      3,
      { date_max_offset: 0 },
      { comment_bottom: "※本日来園した場合は本日の日付をお選びください" }
    ),

    q("Q4", "「つくばわんわんランド」に来園したのは、今回で何回目ですか（ひとつだけ）", "single_choice", 4, {
      options: opts(["first", "1回目（初めて）"], ["second", "2回目"], ["third", "3回目"], ["fourth_plus", "4回目以上"])
    }),

    q(
      "Q5",
      "誰と一緒に来園されましたか（いくつでも）",
      "multi_choice",
      5,
      {
        options: [
          ...COMPANIONS.map(([value, label]) =>
            value === "alone"
              ? { value, label, exclusive_with: aloneExclusiveWith }
              : // 「その他の家族・親族」は記述欄なし（「その他」始まりのラベルは画面側が自動で記述欄を付けるため止める）
                value === "other_family"
                ? { value, label, allow_free_text: false }
                : { value, label }
          ),
          OTHER
        ]
      },
      { comment_bottom: "※お子さまの区分には、お孫さま・同行者のお子さまも含みます" }
    ),

    q(
      "Q6",
      "「つくばわんわんランド」を知ったきっかけを教えてください（いくつでも）",
      "multi_choice",
      6,
      randomized(
        [
          ["google_map", "Googleマップ", "1"],
          ["net_search", "Google・Yahoo!などのネット検索", "1"],
          ["referral", "家族・友人・知人からの紹介", "1"],
          ["instagram", "Instagram", "1"],
          ["youtube", "YouTube", "1"],
          ["tiktok_sns", "TikTokなどその他のSNS", "1"],
          ["travel_site", "観光・お出かけ情報サイト", "1"],
          ["web_ad", "Web広告・SNS広告", "1"],
          ["flyer", "チラシ", "1"],
          ["passing_by", "当園の前を通りかかった時に見かけた", "1"]
        ],
        [OTHER, { value: "unknown", label: "覚えていない・分からない", exclusive: true }]
      )
    ),

    q(
      "Q7",
      "今回、「つくばわんわんランド」に来園することを決めた理由を教えてください（いくつでも）",
      "multi_choice",
      7,
      randomized(
        [
          ["touch_dogs", "犬とふれあいたかったから", "1.1"],
          ["touch_cats", "猫とふれあいたかったから", "1.2"],
          ["rental_walk", "わんわんレンタルで犬と散歩したかったから", "2"],
          ["favorite_breed", "お気に入りの犬・猫や、特定の犬種に会いたかったから", "3"],
          ["child_experience", "子どもに動物とのふれあいを体験させたかったから", "4.1"],
          ["child_request", "子どもが行きたがっていたから", "4.2"],
          ["shows_events", "ショー・レース・イベントを楽しみたかったから", "5"],
          ["with_pet_place", "愛犬と一緒に楽しめる施設だったから", "6"],
          ["sns", "SNSの投稿・動画を見て行きたくなったから", "7"],
          ["invited", "家族・友人などに誘われた、勧められたから", "8"],
          ["dog_run", "愛犬をドッグランで遊ばせたかったから", "9"],
          ["famous", "有名な施設だったから", "10"]
        ],
        [OTHER]
      )
    ),

    // ランダムなし・写真つきカード。
    q("Q8", "今回、あなた自身が体験したり、利用したものをすべてお選びください（いくつでも）", "multi_choice", 8, {
      options: [...facilities, OTHER, NONE],
      ...CARD
    }),

    // Q8 で 1〜14 を選んだ人（＝特になしでない人）。Q8 で選んだもの＋常に「特になし」。
    q(
      "Q9",
      "その中で、特に楽しめたものを最大3つまでお選びください（3つまで）",
      "multi_choice",
      9,
      { options: [...facilities, OTHER, NONE], max_select: 3, ...CARD },
      {
        visibility_conditions: [{ type: "pipe_expression", expression: "not q8 includes none" }],
        display_tags_parsed: { optionSource: { fromQuestion: "q8", mode: "selected", alwaysInclude: [NONE.value] } }
      }
    ),

    // お子さま（Q5 の 6〜8）と来園した人。Q8 では絞らない。
    q(
      "Q10",
      "ご一緒のお子さまが、特に楽しそうにしていたものを最大3つまでお選びください（3つまで）",
      "multi_choice",
      10,
      {
        options: [
          ...facilities,
          ...facilityCards(CHILD_PLAY, imageUrlByKey),
          OTHER,
          NONE,
          { value: "unknown", label: "分からない・判断できない", exclusive: true }
        ],
        max_select: 3,
        ...CARD
      },
      {
        visibility_conditions: [{ type: "pipe_expression", expression: WITH_CHILD }],
        comment_bottom: "※複数のお子さまがいる場合は、お子さま全体についてお答えください。※お孫さま・同行者のお子さまも含みます"
      }
    ),

    // Q11 と Q12 は同じ画面に出す。
    q(
      "Q11",
      "今回の総合的な満足度を教えてください（ひとつだけ）",
      "single_choice",
      11,
      {
        options: opts(
          ["very_satisfied", "とても満足した"],
          ["satisfied", "やや満足した"],
          ["neutral", "どちらともいえない"],
          ["dissatisfied", "あまり満足しなかった"],
          ["very_dissatisfied", "まったく満足しなかった"]
        )
      },
      { display_tags_parsed: { screenGroup: { groupId: "overall" } } }
    ),

    // 任意（初版と同じ。未入力でも次へ進める）
    q(
      "Q12",
      "その理由について具体的にお聞かせください。印象に残ったイベントや体験について、どんなところが良かった・気になったのかを詳しくお聞かせください",
      "free_text_long",
      12,
      { placeholder: "ご自由にご記入ください（任意）" },
      { is_required: false, display_tags_parsed: { screenGroup: { groupId: "overall" } } }
    ),

    // SAMTX: 行＝評価項目（F列どおりグループランダム）・列＝5段階＋利用していない・分からない
    q(
      "Q13",
      "以下の項目について、今回の満足度を教えてください（それぞれひとつだけ）",
      "matrix_single",
      13,
      {
        matrix_rows: randomized(ASPECTS).options,
        matrix_cols: opts(
          ["very_satisfied", "とても満足した"],
          ["satisfied", "やや満足した"],
          ["neutral", "どちらともいえない"],
          ["dissatisfied", "あまり満足しなかった"],
          ["very_dissatisfied", "まったく満足しなかった"],
          ["not_used", "利用していない・分からない"]
        ),
        option_randomization: randomized(ASPECTS).option_randomization,
        presentation: { pattern: "matrix_list" },
        matrix_page_size: 4
      },
      { comment_bottom: "※利用・体験していない場合や判断できない場合は、「利用していない・分からない」をお選びください" }
    ),

    // Q13 で表示された行と同じ順に並べる（その他 / 特になしは末尾固定）。
    q("Q14", "特に改善してほしいと感じたものを教えてください（いくつでも）", "multi_choice", 14, {
      options: [...ASPECTS.map(([value, label]) => ({ value, label })), OTHER, NONE],
      option_randomization: { enabled: true, follow_question: "Q13", anchored_values: [OTHER.value, NONE.value] }
    }),

    q(
      "Q15",
      "最後に、何かご要望や意見など、伝えたいことがあればなんでもお書きください",
      "free_text_long",
      15,
      { placeholder: "ご自由にご記入ください（任意）" },
      { is_required: false }
    )
  ];
}

// ------------------------------------------------------------------
// 投入 / 後片付け
// ------------------------------------------------------------------

async function createClient() {
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

/** 施設写真を Storage へ複製し、{ key: 公開URL } を返す（初版と同じパス＝upsert で上書きしても同一画像）。 */
async function uploadImages(supabase) {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`storage listBuckets failed: ${listErr.message}`);
  if (!(buckets ?? []).some((b) => b.name === STORAGE_BUCKET)) {
    const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: true });
    if (error) throw new Error(`storage createBucket failed: ${error.message}`);
    console.log(`storage bucket created: ${STORAGE_BUCKET} (public)`);
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
  const supabase = await createClient();
  if (process.argv.includes("--cleanup")) {
    await cleanup(supabase);
    return;
  }

  const { data: existingQs } = await supabase.from("questions").select("id").eq("project_id", PROJECT_ID);
  const existingIds = (existingQs ?? []).map((r) => r.id);
  if (existingIds.length > 0) {
    const { count } = await supabase.from("answers").select("id", { count: "exact", head: true }).in("question_id", existingIds);
    if ((count ?? 0) > 0 && !process.argv.includes("--force")) {
      throw new Error(`この案件には回答が ${count} 件あります。再投入すると回答が消えるため中止しました（--force で続行）。`);
    }
  }

  const imageUrlByKey = await uploadImages(supabase);
  const questions = buildQuestions(imageUrlByKey);

  const { error: pErr } = await supabase.from("projects").upsert(project, { onConflict: "id" });
  if (pErr) throw new Error(`projects upsert failed: ${pErr.message}`);
  console.log("project upserted");

  const { error: sErr } = await supabase.from("sessions").update({ current_question_id: null }).eq("project_id", PROJECT_ID);
  if (sErr) throw new Error(`sessions detach failed: ${sErr.message}`);
  const { error: dErr } = await supabase.from("questions").delete().eq("project_id", PROJECT_ID);
  if (dErr) throw new Error(`questions delete failed: ${dErr.message}`);
  const { error: qErr } = await supabase.from("questions").insert(questions);
  if (qErr) throw new Error(`questions insert failed: ${qErr.message}`);
  console.log(`questions inserted: ${questions.length}`);

  const liffId = process.env.LINE_LIFF_ID_SURVEY ?? "<LINE_LIFF_ID_SURVEY>";
  console.log(`\n--- entry URL ---\n${project.name}\n  https://liff.line.me/${liffId}?entry_code=${ENTRY_CODE}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
