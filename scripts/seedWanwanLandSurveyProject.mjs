/**
 * seedWanwanLandSurveyProject.mjs
 *
 * つくばわんわんランド 来園者アンケート（1案件・17問＋来園日）を冪等投入する。
 * 調査票（Excel「わんわんランド」シート・2026-10-15）をそのまま設問定義に落としている。
 *
 *   案件: 【つくばわんわんランド】来園者アンケート   entry_code=wanwan-land
 *   店舗QR / 専用URL からの流入のみ（visibility_type=private_store・探す一覧には出ない）
 *
 * 【調査票の記法 → この repo の設定への対応】
 *
 *  - F列「条件」の数値（1 / 1.1 / 1.2 / 2 / 5.1 …）＝選択肢のランダマイズ指定。
 *      1の位が同じ選択肢は1つのグループ（1.1 / 1.2 / 1.3 は常に隣り合う）。
 *      グループの順番をランダムにし、さらにグループ内の順番もランダムにする。
 *      → question_config.option_randomization = { enabled, groups, randomize_groups:true }
 *        （src/lib/optionRandomization.ts の computeOptionOrder がこの通りに並べる）
 *  - F列「固定」＝並べ替えの対象外で、必ず末尾に出る（その他 / 特になし / 覚えていない）。
 *      → option_randomization.anchored_values（元の位置＝末尾に固定）
 *  - タイプ「ex」＝排他（選ぶと他が外れる）。 → option.exclusive = true
 *  - タイプ「FA」の「その他（）」＝自由記述つき。 → option.allow_free_text = true
 *  - 「Q7=on」「Q9=on」＝前の設問で選んだものだけを選択肢に出す（持ち越し）。
 *      → display_tags_parsed.optionSource = { fromQuestion, mode:"selected" }
 *        あわせて前の設問が「特になし」のときは設問ごと出さない（visibility_conditions）。
 *  - 「子供あり」＝Q4（誰と来園）で「自分の子供」または「自分の孫」を選んだ人。
 *  - 「最大3つまで」 → question_config.max_select = 3（画面とサーバーの両方で強制）。
 *  - 備考「画像表示」 → option.imageUrl（公式サイト 園内MAP の写真を Storage に複製して配信）。
 *      ⚠ 「アンパンマンの遊具」「芝生の遊具」は公式サイトに写真が無いため文字のみ。
 *  - 「Q13と同時表示」 → display_tags_parsed.screenGroup（同じ groupId の設問を1画面に）。
 *  - Q3「来園したのはいつ」= カレンダー（question_type=date・過去のみ）。
 *      調査票では来園日と来園回数が両方 Q3 なので、回数の方は Q3B にしている
 *      （表示条件の式が参照するのは Q4 / Q7 / Q9 だけなので、Q3B は式に出てこない）。
 *  - Q11（SAMTX）は matrix_single。横に段階・縦に項目の表はスマホで読めないため、
 *      項目ごとに縦の選択ボタンを並べ 4項目ずつページ分割する matrix_list で描く。
 *      列に「利用していない・わからない」を足している（未利用者が「どちらともいえない」に
 *      流れて満足度の集計が歪むのを防ぐ）。調査票の行末「その他 / 特になし」は
 *      満足度の対象にならないため行に含めない。
 *
 * 【画像】scripts/assets/wanwan-land/*.jpg（公式サイト 園内MAP の写真を 640px に縮小）を
 *   Supabase Storage のバケット question-images（管理画面の画像アップロードと同じ）へ
 *   wanwan-land/<key>.jpg として upsert し、その公開URLを option.imageUrl に入れる。
 *   バケットが無ければ public で作る。
 *
 * Usage:
 *   node scripts/seedWanwanLandSurveyProject.mjs            # 投入（画像アップロード込み）
 *   node scripts/seedWanwanLandSurveyProject.mjs --cleanup  # 案件と子レコードを削除
 *
 * ⚠ 再実行は questions を delete→insert する。answers は questions を参照するため、
 *   回答が1件でも入っていたら止まる（--force で続行。回答は消える）。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ID = "1a0d0001-0000-4000-8000-000000000001"; // 1a0d = "land"
export const ENTRY_CODE = "wanwan-land";
export const STORAGE_BUCKET = "question-images";
export const STORAGE_PREFIX = "wanwan-land";
export const ASSET_DIR = path.join(process.cwd(), "scripts", "assets", "wanwan-land");

const now = new Date().toISOString();

export const project = {
  id: PROJECT_ID,
  name: "【つくばわんわんランド】来園者アンケート",
  user_display_title: "つくばわんわんランド 来園者アンケート",
  client_name: "つくばわんわんランド",
  objective: "来園者の属性・来園経路・園内で体験したものと、項目別の満足度・改善要望・再来園意向を把握する",
  status: "published",
  visibility_type: "private_store",
  is_discoverable: false,
  apply_mode: "auto",
  delivery_enabled: false,
  research_mode: "survey",
  display_mode: "survey_question",
  // standard: 単一選択=大型タップカード / 複数選択=チップ（casual のスワイプ演出は来園者向けには使わない）
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
  created_at: now,
  updated_at: now,
  ...extra
});

/** [value, label] の配列から options を作る。 */
const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));

/** 「その他（）」= 自由記述つき。 */
const OTHER = { value: "other", label: "その他", allow_free_text: true };
/** 「特になし」= 排他。 */
const NONE = { value: "none", label: "特になし", exclusive: true };

/**
 * F列「条件」の数値からランダマイズ設定を作る。
 * items = [[value, label, group], ...]（group は "1" / "1.1" のような文字列。1の位でグループ化）
 * fixed = 末尾に固定する選択肢（その他 / 特になし 等）
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

/** 5段階満足度（Q11 の列・Q13）。調査票どおり「とても満足」が先頭。 */
const SAT5 = opts(
  ["very_satisfied", "とても満足した"],
  ["satisfied", "やや満足した"],
  ["neutral", "どちらともいえない"],
  ["dissatisfied", "あまり満足しなかった"],
  ["very_dissatisfied", "まったく満足しなかった"]
);

// ------------------------------------------------------------------
// 園内施設（Q7〜Q10 で共有。value を揃えることで持ち越しが value 一致で成立する）
// [value, label, group, imageKey]  imageKey は scripts/assets/wanwan-land/<key>.jpg
// ------------------------------------------------------------------

export const FACILITIES = [
  ["rental", "わんわんレンタル", "1.1", "rental"],
  ["fureai_small", "わんちゃんふれあいコーナー（小型犬）", "1.2", "fureai"],
  ["fureai_large", "わんちゃんふれあいコーナー（中型〜大型犬）", "1.3", "fureai"],
  ["neko_house", "ねこハウス", "2", "neko_house"],
  ["dream_show", "わんわんドリームショー", "3", "dream_show"],
  ["race_show", "わんわんレースショー", "4", "race_show"],
  ["puppy_hall", "子犬展示館", "5.1", "puppy_hall"],
  ["large_dog_hall", "大型展示館", "5.2", "large_dog_hall"],
  ["mokkun", "モックン広場", "6.1", "mokkun"],
  ["dakkun", "だっくん広場", "6.2", "dakkun"],
  ["kitchen", "わんわんkitchen", "7.1", "kitchen"],
  ["gift_shop", "わんわんギフトショップ", "7.2", "gift_shop"],
  ["anpanman_play", "アンパンマンの遊具", "8.1", null],
  ["lawn_play", "芝生の遊具", "8.2", null],
  ["dog_run", "ドッグラン", "8.3", "dog_run"]
];

/** 満足度の評価項目（Q11 の行・Q12 で共有）。[value, label, group] */
export const ASPECTS = [
  ["parking", "駐車場の案内", "1"],
  ["homepage", "ホームページ", "2"],
  ["payment", "料金の支払い方法", "3"],
  ["dog_variety", "犬の種類", "4"],
  ["cleanliness", "園内の清潔感", "5.1"],
  ["smell", "園内のニオイ", "5.2"],
  ["fureai_time", "ふれあいの時間", "6.1"],
  ["wait_time", "待ち時間", "6.2"],
  ["rest_comfort", "休憩所の居心地", "7.1"],
  ["rest_clean", "休憩所の清潔感", "7.2"],
  ["staff", "スタッフの接客態度", "8"],
  ["activities", "体験できる遊びの多さ", "9"],
  ["price", "価格の納得感", "10"]
];

/** 施設を [value, label, group, imageUrl|null] にする（imageUrlByKey に無いキーは文字のみ）。 */
function facilityOptions(imageUrlByKey) {
  return FACILITIES.map(([value, label, group, imageKey]) => [
    value,
    label,
    group,
    imageKey && imageUrlByKey[imageKey] ? imageUrlByKey[imageKey] : null
  ]);
}

function withImages(randomizedConfig, items) {
  const urlByValue = new Map(items.map(([value, , , url]) => [value, url]));
  return {
    ...randomizedConfig,
    options: randomizedConfig.options.map((o) => (urlByValue.get(o.value) ? { ...o, imageUrl: urlByValue.get(o.value) } : o))
  };
}

/** 「子供あり」= Q4 で自分の子供 or 自分の孫。 */
const WITH_CHILD = "q4 includes child or q4 includes grandchild";

// ------------------------------------------------------------------
// 設問定義
// ------------------------------------------------------------------

/**
 * @param imageUrlByKey { rental: "https://…/rental.jpg", … }（テストでは任意の文字列でよい）
 */
export function buildQuestions(imageUrlByKey = {}) {
  const facilityItems = facilityOptions(imageUrlByKey);
  const facilityWithImages = withImages(randomized(facilityItems.map(([v, l, g]) => [v, l, g]), [OTHER, NONE]), facilityItems);

  return [
    // 性別の「その他」は調査票で FA ではない。画面側が「その他」ラベルに自動で記述欄を付けるので明示的に止める。
    q("Q1", "性別を教えてください（ひとつだけ）", "single_choice", 1, {
      options: [...opts(["male", "男性"], ["female", "女性"]), { value: "other", label: "その他", allow_free_text: false }]
    }),

    q("Q2", "年齢を教えてください", "numeric", 2, { min: 1, max: 100, unit: "歳", placeholder: "例: 35" }),

    // カレンダー。過去のみ（本日を含む）。
    q("Q3", "つくばわんわんランドに来園したのはいつですか", "date", 3, {
      date_max_offset: 0,
      helpText: "※本日来園した場合は本日の日付を選んでください"
    }),

    q("Q3B", "つくばわんわんランドに来園したのは何回目ですか（ひとつだけ）", "single_choice", 4, {
      options: opts(["first", "1回目（初めて）"], ["second", "2回目"], ["third", "3回目"], ["fourth_plus", "4回目以上"])
    }),

    // Q9 / Q10 の表示条件（子供あり）がここの child / grandchild を参照する。
    q("Q4", "誰と一緒に来園されましたか（いくつでも）", "multi_choice", 5, {
      options: [
        ...opts(
          ["alone", "ひとりで"],
          ["parent", "親"],
          ["child", "自分の子供"],
          ["grandchild", "自分の孫"],
          ["friend", "友達"],
          ["partner", "恋人"],
          ["spouse", "夫婦"],
          ["pet", "ペット"],
          ["coworker", "仕事仲間"]
        ),
        OTHER
      ]
    }),

    q(
      "Q5",
      "「つくばわんわんランド」を知ったきっかけを教えてください（いくつでも）",
      "multi_choice",
      6,
      randomized(
        [
          ["google_map", "Googleマップ", "1"],
          ["net_search", "Google・Yahoo!などのネット検索", "1"],
          ["referral", "家族・友人・知人からの紹介", "1"],
          ["instagram", "Instagram", "1"],
          ["tiktok_sns", "TikTokなどその他のSNS", "1"],
          ["travel_site", "観光情報サイト", "1"],
          ["web_ad", "Web広告・SNS広告", "1"],
          ["flyer", "チラシ", "1"],
          ["passing_by", "当園を通りかかった時に見かけた", "1"]
        ],
        [OTHER, { value: "unknown", label: "覚えていない・分からない", exclusive: true }]
      )
    ),

    q(
      "Q6",
      "本日は、どのような目的で来園しましたか（いくつでも）",
      "multi_choice",
      7,
      randomized(
        [
          ["rental_walk", "レンタル犬を散歩するため", "1"],
          ["dogrun_pet", "自分のペットをドッグランで遊ばせるため", "1"],
          ["child_request", "子供が行きたいと言っていたため", "1"],
          ["famous", "有名だから", "1"],
          ["sns_interest", "SNSで気になっていたから", "1"],
          ["like_animals", "犬や猫が好きで気になっていたから", "1"],
          ["buy_dog", "犬を購入するため", "1"],
          ["with_pet_place", "ペットを連れて行ける場所だったため", "1"],
          ["watch_race", "レースが見たかったから", "1"]
        ],
        [OTHER]
      )
    ),

    // Q7〜Q10 はすべて公式サイトの写真つきカード（調査票の「画像表示」は Q8〜Q10 だが Q7 も揃える指示・2026-10-15）
    q(
      "Q7",
      "本日、あなた自身が遊んだり、経験したものをすべてお選びください（いくつでも）",
      "multi_choice",
      8,
      { ...facilityWithImages, display_format: "card", grid_cols: 2 }
    ),

    // Q7 で選んだものだけを出し、最大3つ。Q7 が「特になし」なら出さない。
    q(
      "Q8",
      "その中で、特に印象に残ったものを最大3つまでお選びください（3つまで）",
      "multi_choice",
      9,
      { ...facilityWithImages, max_select: 3, display_format: "card", grid_cols: 2 },
      {
        visibility_conditions: [{ type: "pipe_expression", expression: "not q7 includes none" }],
        display_tags_parsed: { optionSource: { fromQuestion: "q7", mode: "selected" } }
      }
    ),

    // 子供あり（Q4 = 自分の子供 / 自分の孫）
    q(
      "Q9",
      "あなたのお子様が、楽しそうにしていたものをすべてお選びください（いくつでも）",
      "multi_choice",
      10,
      { ...facilityWithImages, display_format: "card", grid_cols: 2 },
      { visibility_conditions: [{ type: "pipe_expression", expression: WITH_CHILD }] }
    ),

    q(
      "Q10",
      "あなたのお子様が、特に楽しそうにしていたものを最大3つまでお選びください（3つまで）",
      "multi_choice",
      11,
      { ...facilityWithImages, max_select: 3, display_format: "card", grid_cols: 2 },
      {
        visibility_conditions: [
          { type: "pipe_expression", expression: `(${WITH_CHILD}) and not q9 includes none` }
        ],
        display_tags_parsed: { optionSource: { fromQuestion: "q9", mode: "selected" } }
      }
    ),

    // SAMTX: 行＝評価項目（グループランダム）・列＝5段階＋「利用していない・わからない」
    q("Q11", "以下の項目について、あなたの印象を教えてください（それぞれひとつだけ）", "matrix_single", 12, {
      matrix_rows: randomized(ASPECTS).options,
      matrix_cols: [...SAT5, { value: "not_used", label: "利用していない・わからない" }],
      option_randomization: randomized(ASPECTS).option_randomization,
      presentation: { pattern: "matrix_list" },
      matrix_page_size: 4
    }),

    q(
      "Q12",
      "反対に、改善してほしいと感じたものを教えてください（いくつでも）",
      "multi_choice",
      13,
      randomized(ASPECTS, [OTHER, NONE])
    ),

    q("Q13", "本日のご来園について総合的な満足度を教えてください（ひとつだけ）", "single_choice", 14, {
      options: opts(
        ["very_satisfied", "とても満足した"],
        ["satisfied", "やや満足した"],
        ["neutral", "どちらともいえない"],
        ["dissatisfied", "あまり満足していない"],
        ["very_dissatisfied", "まったく満足していない"]
      )
    }, {
      display_tags_parsed: { screenGroup: { groupId: "overall" } }
    }),

    // Q13 と同じ画面に出す。任意（未入力でも次へ進める・2026-10-15 指示）
    q(
      "Q14",
      "その理由について具体的にお聞かせください。特に印象に残ったイベントや体験についてもお聞かせください",
      "free_text_long",
      15,
      { placeholder: "ご自由にご記入ください（任意）" },
      { is_required: false, display_tags_parsed: { screenGroup: { groupId: "overall" } } }
    ),

    q("Q15", "あなたは次回もまた、来園したいと思いますか（ひとつだけ）", "single_choice", 16, {
      options: opts(
        ["very_want", "とても来たい"],
        ["want", "やや来たい"],
        ["neutral", "どちらともいえない・未定"],
        ["not_want", "あまり来たくない"],
        ["never", "まったく来たくない"]
      )
    }),

    q("Q16", "あなたは「つくばわんわんランド」をどの程度友人に勧めたいと思いますか（ひとつだけ）", "single_choice", 17, {
      options: opts(
        ["very_recommend", "とても勧めたい"],
        ["recommend", "やや勧めたい"],
        ["neutral", "どちらともいえない"],
        ["not_recommend", "あまり勧めたくない"],
        ["never", "まったく勧めたくない"]
      )
    }),

    q(
      "Q17",
      "最後に、何かご要望や意見など、伝えたいことがあればなんでもお書きください",
      "free_text_long",
      18,
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

/** 施設写真を Storage へ複製し、{ key: 公開URL } を返す。 */
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

  // 回答が入っている案件の questions を消すと answers が CASCADE で消える。既定では止まる。
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

  // sessions.current_question_id が questions を参照しているため、先に外す（回答途中のセッションがあると delete が落ちる）。
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
