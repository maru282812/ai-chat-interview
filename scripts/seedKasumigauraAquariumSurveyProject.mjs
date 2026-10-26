/**
 * seedKasumigauraAquariumSurveyProject.mjs
 *
 * かすみがうら市水族館 来館者アンケート（1案件・18問）を冪等投入する。
 * 調査票: Box「調査票一覧.xlsx」シート「かすみがうら市水族館」（2026-10-20 取得）
 *
 *   管理用プロジェクト名(L1): 2026-C0001-0001_かすみがうら市水族館
 *   USER表示タイトル(E1):     かすみがうら市水族館アンケート
 *   クライアント(F1):          かすみがうら市水族館（企業コード C0001）
 *   管理年 2026 / 確定番号 1 / 用途 store / entry_code=kasumigaura-aquarium
 *   作成のみ（status=draft）。公開・配信はしない。
 *
 * 【調査票の記法 → この repo の設定への対応】
 *  - 選択肢番号(D列)は value の並び＝元の位置。表示順を変えても value は変わらない。
 *  - F列 `1`（全行同じ整数）＝対象選択肢のフルランダム（Q7・Q8・Q15）。
 *    固定 = anchored_values（調査票どおり末尾に置き、先頭には来ない）。
 *  - 排他 = exclusive / FA（選択肢行）= allow_free_text。
 *  - Q10「Q6=6-8いずれか」= Q6 で小学生以下・中学生・高校生のいずれかを選んだ人（OR）。
 *    H列「Q10はQ9で絞り込まない」→ optionSource は付けない。
 *  - Q9・Q10 H列「大きく表示：map.jpg」= 設問文の下に館内マップを横幅いっぱいで出す（question_text_image）。
 *  - Q12「Q11と同時表示」= display_tags_parsed.screenGroup。
 *  - Q13 SAMTX = matrix_single（ランダムなし）。matrix_list で 4 項目ずつページ分割。
 *  - Q15 画像提示 = aquarium_event.html の告知画像を各イベントに対応付け（目視で照合済み）。
 *    出前授業はページに画像が無いため文字のみ。
 *  - Q16・Q17「Q15の項目と同順」= option_randomization.follow_question = "Q15"。
 *  - 設問文の「※…」注記は comment_bottom に出す。
 *
 * Usage:
 *   node scripts/seedKasumigauraAquariumSurveyProject.mjs            # 投入（画像アップロード込み）
 *   node scripts/seedKasumigauraAquariumSurveyProject.mjs --cleanup  # 案件と子レコードを削除（クライアントは残す）
 *
 * ⚠ 再実行は questions を delete→insert する。回答が1件でも入っていたら止まる（--force で続行。回答は消える）。
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT_ID = "ac0a0001-0000-4000-8000-000000000001"; // ac0a = "aqua"
export const ENTRY_CODE = "kasumigaura-aquarium";
export const CLIENT = { name: "かすみがうら市水族館", company_code: "C0001" };
export const STORAGE_BUCKET = "question-images";
export const STORAGE_PREFIX = "kasumigaura-aquarium";
export const ASSET_DIR = path.join(process.cwd(), "scripts", "assets", "kasumigaura-aquarium");

const now = new Date().toISOString();

export const project = {
  id: PROJECT_ID,
  name: "2026-C0001-0001_かすみがうら市水族館",
  user_display_title: "かすみがうら市水族館アンケート",
  client_name: CLIENT.name,
  management_year: 2026,
  confirmed_number: 1,
  survey_purpose: "store",
  objective: "来館者の属性・同行者・認知経路・来館理由・良かった展示と、総合満足度・項目別満足度・改善要望・イベントの認知と参加意向を把握する",
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
    "ご協力ありがとうございました。いただいたご意見は、かすみがうら市水族館をより楽しんでいただくために活用いたします。",
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
const numbered = (labels) => labels.map((label, i) => ({ value: String(i + 1), label }));

/** 選択肢番号 n の「その他（）」= 自由記述つき。 */
const other = (n) => ({ value: String(n), label: "その他", allow_free_text: true });
/** 選択肢番号 n の排他選択肢。 */
const exclusive = (n, label) => ({ value: String(n), label, exclusive: true });

/** F列が全行同じ整数 → そのグループ内をフルランダム。固定は末尾（調査票の位置）に置く。 */
function fullRandom(items, fixed) {
  return {
    options: [...items, ...fixed],
    option_randomization: {
      enabled: true,
      randomize_groups: true,
      groups: [{ label: "1", values: items.map((o) => o.value) }],
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

/** Q9・Q10 の館内の展示・体験（選択肢番号 1〜10）。 */
const SPOTS = [
  "餌のガチャガチャ",
  "１０円運試し（グラスに入れるゲーム）",
  "タッチプール",
  "円柱水槽",
  "大水槽",
  "外来生物ゾーン",
  "在来生物ゾーン",
  "出島水槽",
  "外のリクガメ",
  "外のコイがいる池"
];

/** Q13 の行・Q14 の選択肢（選択肢番号 1〜12）。 */
const ASPECTS = [
  "ホームページの見やすさ",
  "駐車場の案内",
  "展示している生き物の種類",
  "展示している生き物の数",
  "遊び・体験の種類の豊富さ",
  "生き物とふれあえる時間",
  "体験・サービスの待ち時間",
  "スタッフの説明・対応",
  "館内の清潔さ",
  "館内のニオイへの対策",
  "館内案内・イベント情報の分かりやすさ",
  "料金設定"
];

/** Q15〜Q17 のイベント（選択肢番号 1〜11）。[label, imageKey] 文言は調査票のまま。 */
const EVENTS = [
  ["移動水族館", "202607_1"],
  ["ビオトーププロジェクト　生き物見っけ隊", "202607_2"],
  ["オオサンショウウオの計測会", "202607_3"],
  ["ウーパールーパー飼育教室", "202607_4"],
  ["リクガメさんの計測会plusエサあげ体験", "202607_5"],
  ["コチョウザメのタッチプールPlusエサあげ体験", "202607_6"],
  ["飼育員体験ガチャ", "202607_7"],
  ["ふれあい動物園", "202607_8"],
  ["シール作り体験～手作りシールを作ろう～", "202607_9"],
  ["ビオトーププロジェクト　水槽展示体験～採集から水槽づくりやってみませんか？～", "suiso_1"],
  ["出前授業", null]
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
 * @param imageUrlByKey { map: "https://…/map.jpg", "202607_1": "…", … }（テストでは任意の文字列でよい）
 */
export function buildQuestions(imageUrlByKey = {}) {
  const mapImage = imageUrlByKey.map ? { question_text_image: { mainUrl: imageUrlByKey.map, alt: "館内マップ" } } : {};
  const eventOptions = () =>
    EVENTS.map(([label, key], i) => {
      const o = { value: String(i + 1), label };
      if (key && imageUrlByKey[key]) o.imageUrl = imageUrlByKey[key];
      return o;
    });
  const eventFixed = [other(12), exclusive(13, "特になし")];

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
      "「かすみがうら市水族館」に来館したのはいつですか。",
      "date",
      4,
      { date_max_offset: 0 },
      { comment_bottom: "※本日来館した場合は本日の日付を選択してください。" }
    ),

    q("Q5", "「かすみがうら市水族館」に来館したのは、今回で何回目ですか（ひとつだけ）", "single_choice", 5, {
      options: numbered(["１回目（初めて）", "２回目", "３回目", "４回目以上"])
    }),

    q(
      "Q6",
      "誰と一緒に来館されましたか（いくつでも）",
      "multi_choice",
      6,
      {
        options: [
          exclusive(1, "ひとりで"),
          ...numbered([
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
          ]).map((o) => ({
            value: String(Number(o.value) + 1),
            label: o.label,
            // 「その他」始まりのラベルは画面側が自動で記述欄を付けるため止める（調査票にFA指定なし）
            ...(o.label === "その他の家族・親族" ? { allow_free_text: false } : {})
          })),
          other(13)
        ]
      },
      { comment_bottom: "※お子さまの区分には、お孫さま・同行者のお子さまも含みます。" }
    ),

    q(
      "Q7",
      "「かすみがうら市水族館」を知ったきっかけを教えてください（いくつでも）",
      "multi_choice",
      7,
      fullRandom(
        numbered([
          "Googleマップ",
          "Google・Yahoo!などのネット検索",
          "家族・友人・知人からの紹介",
          "Instagram",
          "YouTube",
          "TikTokなどその他のSNS",
          "観光・お出かけ情報サイト",
          "Web広告・SNS広告",
          "チラシ",
          "当館の前を通りかかった時に見かけた"
        ]),
        [other(11), exclusive(12, "覚えていない・分からない")]
      )
    ),

    q(
      "Q8",
      "今回、「かすみがうら市水族館」に来館することを決めた理由を教えてください。（いくつでも）",
      "multi_choice",
      8,
      fullRandom(
        numbered([
          "魚が好きだったから",
          "霞ヶ浦の魚が気になったから",
          "公園が近くにあったから",
          "歴史博物館の近くだったから",
          "子供が行きたいと言ったから",
          "お目当ての生き物が見たかったから",
          "家族や友人などに勧められたから",
          "料金が安かったから",
          "イベントが楽しみだったから",
          "有名な施設だったから"
        ]),
        [other(11)]
      )
    ),

    q(
      "Q9",
      "今回、あなた自身が観覧や体験をして、特に良かったものを最大３つまでお選びください（３つまで）",
      "multi_choice",
      9,
      { options: [...numbered(SPOTS), other(11), exclusive(12, "特になし")], max_select: 3, ...mapImage }
    ),

    // お子さま（Q6 の 6〜8 のいずれか）と来館した人。Q9 では絞らない。
    q(
      "Q10",
      "ご一緒のお子さまが、特に楽しそうにしていたものを最大３つまでお選びください。（３つまで）",
      "multi_choice",
      10,
      {
        options: [
          ...numbered(SPOTS),
          other(11),
          exclusive(12, "特になし"),
          exclusive(13, "分からない・判断できない")
        ],
        max_select: 3,
        ...mapImage
      },
      {
        visibility_conditions: [{ type: "pipe_expression", expression: WITH_CHILD }],
        comment_bottom: "※複数のお子さまがいる場合は、お子さま全体についてお答えください。\n※お孫さま・同行者のお子さまも含みます"
      }
    ),

    // Q11 と Q12 は同じ画面に出す。
    q("Q11", "今回の総合的な満足度を教えてください。（ひとつだけ）", "single_choice", 11, { options: SATISFACTION }, {
      display_tags_parsed: { screenGroup: { groupId: "overall" } }
    }),

    q(
      "Q12",
      "その理由について具体的にお聞かせください。印象に残ったイベントや体験、生き物について、どんなところが良かった・気になったのかを詳しくお聞かせください。",
      "free_text_long",
      12,
      { placeholder: "ご自由にご記入ください" },
      { display_tags_parsed: { screenGroup: { groupId: "overall" } } }
    ),

    // SAMTX: 行＝評価項目（ランダムなし）・列＝5段階＋利用していない・分からない
    q(
      "Q13",
      "以下の項目について、今回の満足度を教えてください。（それぞれひとつだけ）",
      "matrix_single",
      13,
      {
        matrix_rows: numbered(ASPECTS),
        matrix_cols: [...SATISFACTION, { value: "6", label: "利用していない・分からない" }],
        presentation: { pattern: "matrix_list" },
        matrix_page_size: 4
      },
      { comment_bottom: "利用・体験していない場合や判断できない場合は、「利用していない・分からない」をお選びください。" }
    ),

    q("Q14", "特に改善してほしいと感じたものを教えてください（いくつでも）", "multi_choice", 14, {
      options: [...numbered(ASPECTS), other(13), exclusive(14, "特になし")]
    }),

    q(
      "Q15",
      "「かすみがうら市水族館」では以下のイベントを実施しています。知っているものをすべてお選びください（いくつでも）",
      "multi_choice",
      15,
      { ...fullRandom(eventOptions(), eventFixed), ...CARD }
    ),

    // Q16・Q17 は Q15 で表示された順にそろえる（その他 / 特になしは末尾固定）。
    // Q16 は Q15 で知っていると答えたイベントだけ＋常に「特になし」（2026-10-20 ユーザー指示）。
    //   Q15 の「その他」は記述文で保存され value が一致しないため持ち越せない → Q16 には出さない。
    //   Q15 でイベントを1つも選んでいない人（特になし / その他のみ）には Q16 を出さない。
    q(
      "Q16",
      "その中で、参加したことがあるものをすべて教えてください（いくつでも）",
      "multi_choice",
      16,
      {
        options: [...eventOptions(), eventFixed[1]],
        option_randomization: { enabled: true, follow_question: "Q15", anchored_values: [eventFixed[1].value] },
        ...CARD
      },
      {
        visibility_conditions: [{ type: "pipe_expression", expression: EVENTS.map((_, i) => `q15 includes ${i + 1}`).join(" or ") }],
        display_tags_parsed: { optionSource: { fromQuestion: "q15", mode: "selected", alwaysInclude: [eventFixed[1].value] } }
      }
    ),

    // Q17 は全イベント（Q15 では絞らない）。
    q("Q17", "その中で、参加してみたいと思ったものをすべて教えてください（いくつでも）", "multi_choice", 17, {
      options: [...eventOptions(), ...eventFixed],
      option_randomization: { enabled: true, follow_question: "Q15", anchored_values: eventFixed.map((o) => o.value) },
      ...CARD
    }),

    q(
      "Q18",
      "最後に、何かご要望や意見など、伝えたいことがあればなんでもお書きください",
      "free_text_long",
      18,
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
