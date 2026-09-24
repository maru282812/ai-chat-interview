/**
 * seedRestaurantSurveyProjects.mjs
 *
 * 飲食店向け 店舗専用アンケート A / B / C の3案件を冪等投入する。
 * 美容室版（seedSalonSurveyProjects.mjs）・ネイル版（seedNailSurveyProjects.mjs）の
 * 構造を踏襲し、業種固有の「頻度・評価項目・設問文」を差し替えている。
 *
 *   A: 来店すぐアンケート （QR流入・着席〜料理待ち） entry_code=yotto-resto-a
 *   B: 食後アンケート     （会計前後）               entry_code=yotto-resto-b
 *   C: 本音アンケート     （後日・A-Q11基準）        entry_code=yotto-resto-c
 *
 * 【サロン版との違い（設計判断）】
 *
 * 1. A は「料理を待っている数分」に答えてもらう
 *    サロンの A は施術前の待ち時間に answers を取れるが、飲食は着席から配膳までが
 *    唯一の空き時間で、しかも短い。設問数をサロンの14問から11問に削り、
 *    重視項目の2段構え（A-Q9→A-Q10 の carry-forward）も1問に畳んだ。
 *    ⚠ ここを増やすと料理が来た瞬間に離脱して A の完了率が落ち、
 *      A で完了しないと B も C も紐づかない（サイクルごと消える）。
 *
 * 2. 評価項目（ASPECTS）の最大因子は「料理の味」
 *    サロンの finish（仕上がり）に相当する。加えて飲食固有として
 *    speed（提供の速さ）/ portion（量とのバランス）/ menu_variety（メニューの選択肢）/
 *    hygiene（清潔感）を入れ、サロン固有の施術系（skill / care / duration）は落とした。
 *
 * 3. 「担当者」ではなく「店」を評価する
 *    サロンは指名＝担当者との相性が離脱の主因だが、飲食はホール担当が毎回変わるため
 *    個人ではなく接客全体を見る。C-Q9 の離反理由も person_mismatch ではなく
 *    「接客が合わなかった」＋「席・座席環境」に置き換えた。
 *
 * 4. 来店頻度の幅がサロンより桁で広い（週2回〜半年に1回）
 *    サロンは物理的な再来店トリガー（髪が伸びる・爪がリフトする）で中心帯が
 *    決まるが、飲食にはそれが無い。日常利用（週数回）と特別利用（年数回）が
 *    同じ店に混在するため、刻みを週単位から半年まで広く取る。
 *    日数表は industry_templates 側（seedRestaurantIndustryTemplate.mjs）に持つ。
 *
 * 5. 「同行者」を A で聞く（飲食固有の最重要クロス軸）
 *    サロンには無い軸。一人客・家族連れ・接待で満足の条件がまったく違い、
 *    これが無いと B-Q2 の満足度が平均化して改善要望が読めなくなる。
 *    例: 「提供の速さ」の不満はランチ一人客に偏り、ディナー会食層には出ない。
 *
 * 6. アレルギー・苦手食材は A で聞いて即時開示する
 *    サロンの A-Q14（伝えたいこと）に相当するが、飲食では**提供前に届かないと
 *    事故になる**ため独立設問にし、timing=immediate で店舗へ開示する。
 *    ⚠ アレルギーは要配慮個人情報に近い扱いになる。自由記述ではなく選択式を主にし、
 *      画面の helpText と share_with_store.notice を必ず一致させること（利用規約 第9条3項）。
 *
 * すべて visibility_type=private_store なので「探す」一覧には出ない。
 *
 * 【回答UI】サロン版と同じく案件全体を casual にしている。詳細は
 * seedSalonSurveyProjects.mjs の冒頭コメントを参照。
 *
 * 【選択肢の持ち越し（carry-forward）】
 *   同一案件内 : B-Q3 ← B-Q2 / B-Q5 ← B-Q4
 *   別案件から : C-Q2, C-Q3 ← A-Q5（今日の利用シーン） ※Migration 092
 *   持ち越しは value 一致で絞るため、参照元と参照先の value を必ず揃えること。
 *
 * Usage:
 *   node scripts/seedRestaurantSurveyProjects.mjs
 *   node scripts/seedRestaurantSurveyProjects.mjs --cleanup
 *
 * ⚠ 再実行は questions を delete→insert する。answers は questions を参照するため
 *   本番で回答が入った後の再実行は厳禁（美容室版で事故例あり）。
 *
 * 事前に migration 092 の適用が必要: npm run db:migrate
 */

import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadDotEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const now = new Date().toISOString();

// 美容室（5a10c0xx…）・ネイル（4a11c0xx…）と衝突しない別系列。
// ⚠ UUID は16進のみ。"resto" を字面で入れたくなるが r/s/t/o は hex ではないため
//   Postgres の uuid 型で弾かれる（ae54 = "eat" の見立て）。
const P_A = "ae54c001-0000-4000-8000-000000000001";
const P_B = "ae54c002-0000-4000-8000-000000000002";
const P_C = "ae54c003-0000-4000-8000-000000000003";

/** 店舗名は案件ごとに差し替える想定（店舗追加時に storeProvisioningService が置換する）。 */
const STORE_NAME = "●●店";

const common = {
  client_name: STORE_NAME,
  status: "published",
  visibility_type: "private_store",
  is_discoverable: false,
  apply_mode: "auto",
  delivery_enabled: false,
  research_mode: "survey",
  display_mode: "survey_question",
  answer_ui_preset: "casual",
  ai_prompt_mode: "custom",
  primary_objectives: [],
  secondary_objectives: [],
  comparison_constraints: [],
  prompt_rules: [],
  updated_at: now
};

const projects = [
  {
    ...common,
    id: P_A,
    name: `【${STORE_NAME}】A：来店すぐアンケート`,
    objective: "どんなお客様が、誰と、何を期待して今日来店しているのかを把握する",
    reward_points: 5,
    estimated_minutes: 1,
    entry_code: "yotto-resto-a",
    completion_message: "ご協力ありがとうございました。続きはお食事のあとにお答えください。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_B,
    name: `【${STORE_NAME}】B：食後アンケート`,
    objective: "食後の顧客満足度を項目別に把握する（本調査のメイン）",
    reward_points: 5,
    estimated_minutes: 2,
    entry_code: "yotto-resto-b",
    completion_message:
      "ご協力ありがとうございました。後日、最後のアンケートをお送りしますので、そちらもどうぞよろしくお願いいたします。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_C,
    name: `【${STORE_NAME}】C：本音アンケート`,
    objective: "時間経過後の満足度の変化と、実際の再来店行動を把握する",
    reward_points: 10,
    estimated_minutes: 2,
    entry_code: "yotto-resto-c",
    // C-Q2 / C-Q3 の選択肢を A-Q5（利用シーン）で絞るための宣言（Migration 092）
    carry_forward_sources: [{ namespace: "a", entry_code: "yotto-resto-a" }]
  }
];

// ------------------------------------------------------------------
// ヘルパ（サロン版と同一）
// ------------------------------------------------------------------

const q = (projectId, code, text, type, sortOrder, config, extra = {}) => ({
  project_id: projectId,
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

/**
 * A-Q10 / A-Q11 の告知文。
 * 回答画面の helpText と share_with_store.notice を必ず同一にする。
 * 利用規約 第9条3項が「回答画面上であらかじめ明示したうえで」を開示条件に
 * しているため、画面に出した文言と根拠がズレると説明がつかなくなる。
 */
const A_Q10_NOTICE = "この設問のみ、ご提供前にスタッフが確認いたします。";
const A_Q11_NOTICE = "この設問のみ、ご提供前にスタッフが確認いたします。";

/** [value, label] のペア配列から options を作る。 */
const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));

/** 5段階満足度（B-Q2 の列で使用。調査票どおり「とても満足」が先頭）。 */
const SAT5 = opts(
  ["very_satisfied", "とても満足した"],
  ["satisfied", "やや満足した"],
  ["neutral", "どちらともいえない"],
  ["dissatisfied", "あまり満足しなかった"],
  ["very_dissatisfied", "まったく満足しなかった"]
);

// ------------------------------------------------------------------
// 回答UI（設問単位の表示パターン上書き・answerPresentation.ts）
// ------------------------------------------------------------------

const SWIPE = { presentation: { pattern: "swipe_card" } };
const SLIDER = { presentation: { pattern: "big_slider" } };
const SORT_SWIPE = { presentation: { pattern: "sort_swipe" } };

/** スライダーは左端＝最低になるよう「悪い→良い」順に並べ替える。value の意味は不変。 */
const scale5 = (...pairs) => opts(...pairs.slice().reverse());

/**
 * 満足度の評価項目10件。A-Q9（重視項目）と B-Q2/B-Q3/B-Q4 で value を共有する。
 * ここを揃えておくことで carry-forward が value 一致で成立する。
 *
 * サロン版からの変更:
 *   + taste         料理の味（飲食満足度の最大因子。サロンの finish に相当）
 *   + speed         提供の速さ（ランチ一人客の離脱主因）
 *   + portion       量とのバランス
 *   + menu_variety  メニューの選択肢の多さ
 *   + hygiene       店内の清潔感（飲食は衛生が直接リピートに効く）
 *   - skill         「カットやカラー技術」＝サロン固有
 *   - care          「施術の丁寧さ」＝サロン固有
 *   - duration      「施術時間」＝サロン固有（飲食は speed で見る）
 *   - proposal      「自分に合った提案」＝サロン固有（飲食は menu_variety で見る）
 *   ※ atmosphere（店内の雰囲気）は評価項目ではなく B-Q8 で別途聞く（冒頭コメント参照）
 *
 * ⚠ 10件を超えると matrix_single は 1行=1画面なので B の画面数がそのまま増える。
 *   足すときは必ず何かを落とすこと。
 */
const ASPECTS = [
  ["taste", "料理の味"],
  ["speed", "提供の速さ"],
  ["portion", "量とのバランス"],
  ["menu_variety", "メニューの選択肢の多さ"],
  ["service", "スタッフの接客"],
  ["hygiene", "店内の清潔感"],
  ["comfort", "席の座り心地・広さ"],
  ["drink", "ドリンクの内容"],
  ["wait", "待ち時間（入店・会計）"],
  ["price", "価格への納得感"]
];

/** A-Q9 は「待ち時間（会計）」を含まない（食事前のため）。サロン版と同じ考え方。 */
const A_ASPECTS = ASPECTS.filter(([v]) => v !== "wait");

/** 雰囲気は評価項目ではないが「重視して来たか」「不満だったか」は聞く価値がある。 */
const ATMOSPHERE = ["atmosphere", "店内の雰囲気・居心地"];

const OTHER = ["other", "その他"];

/** 「特になし」は他と同時に選べない排他選択肢にする。 */
const exclusiveNone = { value: "none", label: "特になし", exclusive: true };

// ------------------------------------------------------------------
// A: 来店すぐアンケート（着席〜配膳の数分で完了させる）
// ------------------------------------------------------------------

const questionsA = [
  q(
    P_A,
    "Q1",
    "アンケートにご協力いただきありがとうございます。こちらにご協力していただけますか。（ひとつだけ）",
    "single_choice",
    1,
    // 最初の1タッチで「スワイプで答えるアンケート」だと体験させる（設問文60字以内＝降格しない）
    { options: opts(["yes", "はい"], ["no", "いいえ"]), ...SWIPE },
    {
      comment_top:
        `こちらのアンケートは${STORE_NAME}の満足度を調べるためにYOTTOが${STORE_NAME}の委託を受けて実施しております。\n` +
        "アンケートはご来店時、お食事のあと、再来店の有無確認の３つを予定しております。各１分程度の長さです。",
      // 「いいえ」は以降の設問に進ませない（お礼で終了）。
      branch_rule: {
        branches: [{ when: { equals: "no" }, next: null }],
        default_next: null
      }
    }
  ),

  q(P_A, "Q2", "性別を教えてください。（ひとつだけ）", "single_choice", 2, {
    options: opts(["male", "男性"], ["female", "女性"], ["other", "その他"])
  }),

  q(P_A, "Q3", "あなたの年齢を教えてください", "numeric", 3, {
    min: 10,
    max: 100,
    unit: "歳",
    placeholder: "例: 35"
  }),

  q(P_A, "Q4", "このお店への来店は何回目ですか？（ひとつだけ）", "single_choice", 4, {
    options: opts(
      ["first", "１回目（初めて）"],
      ["second", "２回目"],
      ["third", "３回目"],
      ["fourth_plus", "４回目以上"]
    ),
    helpText: "※回数を覚えていない場合は、おおよその回数を教えてください。"
  }),

  // A-Q5: 利用シーン。飲食の最重要クロス軸（冒頭コメント5）。
  // C-Q2 / C-Q3 の選択肢の出し分け（disableRules）もこの value を参照する。
  q(P_A, "Q5", "今日はどのようなご利用ですか？（ひとつだけ）", "single_choice", 5, {
    options: opts(
      ["solo", "ひとりで"],
      ["couple", "夫婦・パートナーと"],
      ["family_kids", "家族で（お子さま連れ）"],
      ["family", "家族で（大人のみ）"],
      ["friends", "友人・知人と"],
      ["work_lunch", "仕事の同僚と（ランチ・食事）"],
      ["business", "接待・会食"],
      ["party", "宴会・歓送迎会などの集まり"],
      ["takeout", "テイクアウト・持ち帰り"],
      OTHER
    )
  }),

  // A-Q6: 初回(Q4=first)かどうかで設問文が変わる。文面違いの2問を表示条件で出し分ける。
  q(
    P_A,
    "Q6",
    "今回、このお店を知ったきっかけを教えてください。（いくつでも）",
    "multi_choice",
    6,
    { options: knownFromOptions() },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q4=first" }] }
  ),
  q(
    P_A,
    "Q7",
    "最初にこのお店を知ったきっかけを教えてください。（いくつでも）",
    "multi_choice",
    7,
    { options: knownFromOptions() },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q4!=first" }] }
  ),

  q(P_A, "Q8", "今日、このお店に来た一番の目的を教えてください（ひとつだけ）", "single_choice", 8, {
    options: opts(
      ["favorite_dish", "お目当ての料理を食べたい"],
      ["quick_meal", "手早く食事を済ませたい"],
      ["relax", "ゆっくり過ごしたい・くつろぎたい"],
      ["talk", "同席の人とゆっくり話したい"],
      ["celebrate", "記念日・お祝いで利用したい"],
      ["drink", "お酒を楽しみたい"],
      ["new_place", "新しいお店を開拓したい"],
      ["near_by", "近かった・通りかかった"],
      OTHER
    )
  }),

  // A-Q9: 重視項目。サロン版は A-Q9→A-Q10 の2段構えだが、飲食の A は
  // 配膳までの数分で終わらせる必要があるため1問に畳んだ（冒頭コメント1）。
  q(P_A, "Q9", "今日、重視していることは何ですか？（いくつでも）", "multi_choice", 9, {
    // atmosphere は「雰囲気を重視して来た層」をフラグ化してクロス集計に使う。
    options: opts(...A_ASPECTS, ATMOSPHERE, OTHER)
  }),

  // A-Q10: アレルギー・苦手食材。提供前に届かないと事故になるため即時開示（冒頭コメント6）。
  // ⚠ 自由記述にせず選択式＋任意の補足にしている。要配慮情報に近い扱いのため、
  //   何が書かれるか制御できない形にしない。
  q(
    P_A,
    "Q10",
    "アレルギーや苦手な食材はありますか？（いくつでも）",
    "multi_choice",
    10,
    {
      options: [
        ...opts(
          ["egg", "卵"],
          ["milk", "乳"],
          ["wheat", "小麦"],
          ["buckwheat", "そば"],
          ["peanut", "落花生（ピーナッツ）"],
          ["shrimp_crab", "えび・かに"],
          ["nuts", "くるみ・カシューナッツなど木の実"],
          ["fish", "魚介類"],
          ["meat", "特定の肉類"],
          ["spicy", "辛いものが苦手"],
          ["raw", "生もの（刺身・生卵など）が苦手"],
          OTHER
        ),
        exclusiveNone
      ],
      helpText: A_Q10_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。選択式なので集計のみ。
      // notice は helpText と同一にする。回答画面に出した文言そのものが
      // 開示の根拠になるため、ズレると規約上の説明がつかなくなる。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "aggregate",
          timing: "immediate",
          notice: A_Q10_NOTICE
        }
      }
    },
    {
      // 「特になし」を押させる負担を避ける。未回答＝申告なしとして扱う。
      is_required: false
    }
  ),

  // A-Q11: 離脱判定の基準。industry_templates.frequency_question_code=Q11 と対応する。
  // ⚠ ここの value を変えたら seedRestaurantIndustryTemplate.mjs の日数表も必ず揃えること。
  //   片方だけ直すと頻度が引けず、C の送付日が undecided 扱いに落ちる。
  // 刻みは飲食の実態（日常利用の週数回〜特別利用の半年に1回）に合わせて
  // サロンより広く取っている（冒頭コメント4）。
  q(P_A, "Q11", "普段どのくらいの頻度で外食をしますか？（ひとつだけ）", "single_choice", 11, {
    options: opts(
      ["weekly_plus", "週に2回以上"],
      ["weekly", "週に1回くらい"],
      ["biweekly", "2週間に1回くらい"],
      ["monthly", "月に1回くらい"],
      ["quarterly", "2〜3か月に1回くらい"],
      ["rarely", "半年に1回くらい、またはそれ以下"],
      ["undecided", "特に決まっていない"]
    ),
    helpText: "この回答をもとに、後日のアンケート（C）をお送りする時期を決めます。"
  }),

  q(
    P_A,
    "Q12",
    "今日のお食事について、気になっていることやスタッフに伝えたいことはありますか？",
    "free_text_long",
    12,
    {
      placeholder: "例）おすすめを教えてほしいです。／子ども用の取り皿をお願いしたいです。",
      helpText: A_Q11_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。提供前に読めないと意味がないので原文・即時。
      // ⚠ 自由記述なので何が書かれるか制御できない。第三者の名前や要配慮情報が
      //   混入し得るため、運用側で内容を確認できる状態を保つこと。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "verbatim",
          timing: "immediate",
          notice: A_Q11_NOTICE
        }
      }
    },
    // お礼は projects.completion_message（送信完了画面）へ。comment_bottom は
    // 設問の下＝送信「前」に出てしまうため使わない (Migration 108)。
    { is_required: false }
  )
];

/** A-Q6 / A-Q7 共通の「知ったきっかけ」選択肢。 */
function knownFromOptions() {
  return opts(
    ["google_map", "Googleマップ"],
    ["web_search", "Google・Yahoo!などのネット検索"],
    ["referral", "家族・友人・知人からの紹介"],
    ["instagram", "Instagram"],
    ["other_sns", "TikTokなどその他のSNS"],
    ["gourmet_site", "食べログ・ぐるなびなどのグルメサイト"],
    ["delivery_app", "出前館・Uber Eatsなどのアプリ"],
    ["web_ad", "Web広告・SNS広告"],
    ["flyer", "チラシ・ポスティング"],
    ["passing_by", "店前を通りかかった時に見かけた"],
    OTHER
  );
}

// ------------------------------------------------------------------
// B: 食後アンケート
// ------------------------------------------------------------------

const questionsB = [
  q(
    P_B,
    "Q1",
    "本日のご利用について、総合的にどのくらい満足しましたか？（ひとつだけ）",
    "single_choice",
    1,
    { options: scale5(...SAT5.map((o) => [o.value, o.label])), ...SLIDER },
    {
      comment_top:
        "本日のご来店ありがとうございました。1〜2分程度のお客様の満足度確認アンケートにご協力ください。\n" +
        "このアンケートの回答は、個人を特定されない形で集計・分析いたしますので、正直な感想・意見をご自由にお書きください。\n" +
        "良いところ、改善してほしいところがあれば、遠慮なくお答えください。"
    }
  ),

  // B-Q2: 項目×5段階のマトリクス（SAMTX）。
  // ⚠ matrix_single は 1行=1画面で出る（survey.ejs）。ここに雰囲気・設備の行を
  //   足すと画面数がそのまま増えるうえ、BGM や照明は5段階で聞いても分散が出ない。
  //   雰囲気は B-Q8 で「気づかれたか」として聞く。
  q(
    P_B,
    "Q2",
    "以下について、それぞれ満足度を教えてください（それぞれひとつだけ）",
    "matrix_single",
    2,
    {
      matrix_rows: ASPECTS.map(([value, label]) => ({ value, label })),
      matrix_cols: SAT5
    },
    { answer_output_type: "object" }
  ),

  // B-Q3: matrix の回答は object 形式のため、選択肢 value 一致で絞る carry-forward が
  //       そのままでは効かない。全項目を出し「特になし」を用意して運用でカバーする。
  q(P_B, "Q3", "今日、特に満足したものを教えてください（ひとつだけ）", "single_choice", 3, {
    options: [...opts(...ASPECTS, OTHER), exclusiveNone]
  }),

  q(
    P_B,
    "Q4",
    "反対に「もっとこうだったら良かった」と思うものはありますか？（いくつでも）",
    "multi_choice",
    4,
    {
      // 不満側には雰囲気も置く（B-Q8 はポジ側＝「気づかれたか」専用のため）
      options: [...opts(...ASPECTS, ATMOSPHERE, OTHER), exclusiveNone]
    }
  ),

  // B-Q5: B-Q4 で「特になし」なら出さない
  q(
    P_B,
    "Q5",
    "「もっとこうだったら良かった」と思うことについて具体的に教えてください。",
    "free_text_long",
    5,
    {
      placeholder: "例）味について、提供の速さについて、料金について、接客についてなど",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q4 includes none" }]
    }
  ),

  q(P_B, "Q6", "来店前に期待していた内容と比べて、今日の体験はいかがでしたか？（ひとつだけ）", "single_choice", 6, {
    options: scale5(
      ["far_above", "期待を大きく上回った"],
      ["above", "期待を少し上回った"],
      ["as_expected", "期待通りだった"],
      ["below", "期待を少し下回った"],
      ["far_below", "期待を大きく下回った"]
    ),
    ...SLIDER
  }),

  q(P_B, "Q7", "次回もこのお店を利用したいと思いますか？（ひとつだけ）", "single_choice", 7, {
    options: scale5(
      ["definitely", "とても利用したい"],
      ["probably", "やや利用したい"],
      ["undecided", "どちらともいえない・未定"],
      ["probably_not", "あまり利用したくない"],
      ["definitely_not", "まったく利用したくない"]
    ),
    ...SLIDER
  }),

  // B-Q8: 店内の空間・設備。満足度5段階ではなく「気づかれたか」を聞く。
  // BGM・照明・席間隔は満足度では動かない（ほぼ全員が「やや満足」に寄る）が、
  // 気づかれた／気づかれなかったは店側の投資判断に直結する
  // （個室や分煙に投資したのに誰も挙げない＝訴求できていない）。
  q(P_B, "Q8", "お店の空間で、心地よかったものはありますか？（いくつでも）", "multi_choice", 8, {
    options: [
      ...opts(
        ["bgm", "BGM・音の大きさ"],
        ["lighting", "照明の明るさ・色味"],
        ["seat_space", "席の間隔・広さ"],
        ["private_room", "個室・半個室があること"],
        ["cleanliness", "テーブルや床の清潔さ"],
        ["restroom", "お手洗いのきれいさ"],
        ["smoking", "分煙・禁煙の環境"],
        ["kids_friendly", "お子さま連れへの配慮（椅子・食器など）"],
        ["temperature", "空調の快適さ"],
        ["interior", "内装・インテリアの雰囲気"],
        OTHER
      ),
      exclusiveNone
    ],
    helpText: "気づいたもの・心地よかったものを選んでください。"
  }),

  q(
    P_B,
    "Q9",
    "今日のお食事について、何か伝えたいことがあれば教えてください",
    "free_text_long",
    9,
    { helpText: "どんなことでも構いません。ご自由にお書きください。" },
    { is_required: false }
  ),

  q(
    P_B,
    "Q10",
    "こちらのサービスにご参加をしていただけますでしょうか。（ひとつだけ）",
    "single_choice",
    10,
    // Hibi への転換点。ここまでのスワイプ体験の延長で「ポイ活も同じ操作」と伝える
    { options: opts(["yes", "はい"], ["no", "いいえ"]), ...SWIPE },
    {
      comment_top:
        "アンケート調査を行っているYOTTOではこのお店の満足度アンケートのほかにも、簡単なアンケート（ポイ活）を行っております。\n" +
        "アンケートにご回答いただければ換金可能なポイントをお送りしております。（１pt＝1円）初回換金目安：約１週間程度"
    }
  )
];

// ------------------------------------------------------------------
// C: 本音アンケート
// ------------------------------------------------------------------

const questionsC = [
  q(
    P_C,
    "Q1",
    "前回のご来店から時間が経ちましたが、いま振り返ってどう感じていますか？（ひとつだけ）",
    "single_choice",
    1,
    {
      options: scale5(
        ["very_satisfied", "とても満足している"],
        ["satisfied", "やや満足している"],
        ["neutral", "どちらともいえない"],
        ["dissatisfied", "あまり満足していない"],
        ["very_dissatisfied", "まったく満足していない"]
      ),
      ...SLIDER
    },
    {
      comment_top:
        `アンケートにお答えいただきありがとうございます。こちらは、先日ご利用いただいた${STORE_NAME}の満足度アンケートの最後のアンケートです。最後までどうぞよろしくお願いいたします。\n` +
        "このアンケートの回答は、個人を特定されない形で集計・分析いたしますので、正直な感想・意見をご自由にお書きください。\n" +
        "良いところ、改善してほしいところがあれば、遠慮なくお答えください。"
    }
  ),

  // C-Q2: 時間が経ってから残っている「良かった点」。
  // ⚠ B の直後の高揚（できたての料理・その場の接客）が消えたあとに何が残るかが
  //   再来店の実質的な決定要因。B-Q3（特に満足したもの）と一致しないことに意味がある。
  q(
    P_C,
    "Q2",
    "あらためて振り返って、よかった点はありましたか？（いくつでも）",
    "multi_choice",
    2,
    {
      options: [
        ...opts(
          ["taste_memorable", "料理の味が記憶に残っている"],
          ["want_again", "また食べたい料理があった"],
          ["good_value", "値段の割に満足度が高かった"],
          ["comfortable", "居心地がよくて長居できた"],
          ["staff_kind", "スタッフの対応が気持ちよかった"],
          ["good_for_talk", "落ち着いて話ができた"],
          ["recommended_it", "家族や友人に勧めた・話題にした"],
          ["kids_ok", "子ども連れでも気兼ねなく過ごせた"],
          ["business_ok", "仕事の相手を連れて行ってよい店だと思えた"],
          OTHER
        ),
        exclusiveNone
      ],
      helpText: "前回ご利用いただいた内容に関するものだけ表示しています。",
      // 「本音」は1項目ずつ◯✕で判定させたほうが取りこぼしが少ない（後日回答＝急いでいない）。
      // 排他の「特になし」はデッキから自動で外れ、全部✕＝特になし相当になる。
      ...SORT_SWIPE
    },
    {
      // A-Q5 で該当シーンを選んでいない人には出さない（Migration 092）
      display_tags_parsed: { disableRules: sceneDisableRulesPositive() }
    }
  ),

  q(
    P_C,
    "Q3",
    "あらためて振り返って、あまり良くなかったところはありましたか？（いくつでも）",
    "multi_choice",
    3,
    {
      options: [
        ...opts(
          ["taste_faded", "思い返すと味はそれほどでもなかった"],
          ["too_expensive", "あとから考えると割高だった"],
          ["too_slow", "料理が出てくるのが遅かった"],
          ["small_portion", "量が物足りなかった"],
          ["staff_cold", "スタッフの対応が気になった"],
          ["noisy", "店内がうるさくて落ち着かなかった"],
          ["cramped", "席が狭かった・隣が近かった"],
          ["unclean", "清潔さが気になった"],
          ["kids_hard", "子ども連れには使いにくかった"],
          ["business_hard", "仕事の相手を連れて行くには向かなかった"],
          OTHER
        ),
        exclusiveNone
      ]
      // C-Q2 と連続で1枚ずつ振り分けさせると操作量が多すぎるため、後半のこちらは
      // chip_select（casual の複数選択の既定）で受ける。ネガ側の取りこぼしより
      // 全体の完走を優先する判断（サロン版と同じ）。
    },
    {
      display_tags_parsed: { disableRules: sceneDisableRulesNegative() }
    }
  ),

  // C-Q4: C-Q3 で「特になし」ならスキップ
  q(
    P_C,
    "Q4",
    "あまり良くないとお答えいただいた内容を具体的にお答えください。",
    "free_text_long",
    4,
    {
      placeholder: "例）味について、提供の速さについて、料金について、接客について",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q3 includes none" }]
    }
  ),

  q(
    P_C,
    "Q5",
    "前回のご来店以降、外食をしましたか？（ひとつだけ）",
    "single_choice",
    5,
    {
      options: opts(["yes", "はい（この店／別の店）"], ["no", "いいえ"]),
      helpText: "※どちらのお店かは問いません。",
      ...SWIPE
    }
  ),

  // C-Q6: C-Q5=yes のときだけ
  q(
    P_C,
    "Q6",
    "前回のご来店以降、どちらのお店を利用しましたか。（ひとつだけ）",
    "single_choice",
    6,
    {
      options: opts(
        ["same", `この${STORE_NAME}を再度利用した`],
        ["other", "別のお店を利用した"],
        ["both", `この${STORE_NAME}と別のお店の両方を利用した`],
        ["home", "外食はせず自炊・中食（惣菜など）で済ませた"]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=yes" }] }
  ),

  // C-Q7: C-Q5=no のときだけ
  q(
    P_C,
    "Q7",
    "あなたは次にどちらのお店を利用する予定ですか？（ひとつだけ）",
    "single_choice",
    7,
    {
      options: opts(
        ["same", "このお店を再度利用する予定"],
        ["other", "別のお店を利用する予定"],
        ["home", "しばらく外食を控える予定"],
        ["undecided", "検討中・考えていない"]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=no" }] }
  ),

  // C-Q8: リピート要因（Q6=same/both もしくは Q7=same）
  // ⚠ 飲食は「味」だけでは再来店を説明できない。距離・価格・使い勝手（席・予約）が
  //   同じ比重で効くため、味以外の選択肢を厚めに置く。
  q(
    P_C,
    "Q8",
    "またこのお店を利用した（したいと思う）理由を教えてください（いくつでも）",
    "multi_choice",
    8,
    {
      options: opts(
        ["taste", "料理がおいしい"],
        ["specific_dish", "決まって食べたい料理がある"],
        ["value", "価格に納得できる"],
        ["speed", "提供が早い"],
        ["service", "スタッフの接客が良い"],
        ["atmosphere", "お店の雰囲気・居心地が良い"],
        ["seat", "席が快適・落ち着ける"],
        ["access", "通いやすい（場所・アクセス）"],
        ["easy_booking", "予約が取りやすい・待たずに入れる"],
        ["with_kids", "子ども連れでも利用しやすい"],
        ["for_business", "人を連れて行くのに使える"],
        ["habit", "なんとなくいつも利用している"],
        ["too_much_effort", "他のお店を探すのが面倒だった"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        { type: "pipe_expression", expression: "q6=same or q6=both or q7=same" }
      ]
    }
  ),

  // C-Q9: 離反要因（Q6=other/both もしくは Q7=other）
  // ⚠ 「飽きた」「気分で別の店」が無いと離脱理由が全部「価格」に流れ込んで真因が消える。
  //   飲食の離脱は不満ではなく**選択肢の多さ**で起きることが多く、
  //   これを分離できないと「値下げ」という誤った打ち手に誘導してしまう。
  q(
    P_C,
    "Q9",
    "別のお店を利用した（する予定の）理由を教えてください（いくつでも）",
    "multi_choice",
    9,
    {
      options: opts(
        ["taste_unsatisfied", "料理の味に満足できなかった"],
        ["price", "価格への納得感がなかった"],
        ["too_slow", "料理が出てくるのが遅かった"],
        ["bad_service", "接客が合わなかった"],
        ["seat_uncomfortable", "席が落ち着かなかった（狭い・騒がしい）"],
        ["unclean", "清潔さが気になった"],
        ["menu_bored", "同じメニューに飽きた・目新しさがない"],
        ["mood", "その日の気分で別のお店にした"],
        ["access", "場所・アクセスが良くなかった"],
        ["no_slot", "行きたいタイミングで予約が取れなかった／混んでいた"],
        ["closed", "営業時間・定休日が合わなかった"],
        ["try_other", "他の店を試してみたかった"],
        ["recommended", "家族・友人に勧められた"],
        ["coupon", "別のお店でクーポン・キャンペーンがあったから"],
        ["moved", "引っ越し等で物理的に行けなくなったから"],
        ["no_reason", "特に理由はなく、たまたま別のお店を利用した"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        { type: "pipe_expression", expression: "q6=other or q6=both or q7=other" }
      ]
    }
  ),

  // C-Q10: 別店利用 or 未定 or 外食控えの人にだけ改善期待を聞く
  q(
    P_C,
    "Q10",
    "今後、このお店に期待することがあれば教えてください",
    "free_text_long",
    10,
    {
      placeholder: "例）メニューについて、料金について、提供の速さについて、接客について",
      helpText:
        "今後、どんなところが改善すればこのお店を再度利用すると思いますか。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression: "q6=other or q6=both or q7=other or q7=undecided or q7=home"
        }
      ]
      // お礼は projects.completion_message（送信完了画面）へ移した (Migration 108)。
    }
  )
];

/**
 * A-Q5（利用シーン）で選ばれていないシーンに紐づく選択肢を落とす（C-Q2 用）。
 * disableRules の condition は pipe 式。`a:q5` は Migration 092 の名前空間付き参照。
 *
 * ⚠ A-Q5 は single_choice なので `includes` ではなく等号で比較する
 *   （複数選択の A-Q5 を持つネイル版とはここが違う）。
 */
function sceneDisableRulesPositive() {
  return [
    // 子ども連れでなかった人に「子ども連れでも過ごせた」は意味をなさない
    { targetChoice: "kids_ok", condition: "a:q5!=family_kids" },
    // 接待・会食でなかった人に「仕事の相手を連れて行ける」は判断材料が無い
    { targetChoice: "business_ok", condition: "a:q5!=business" },
    // ひとり客に「落ち着いて話ができた」は成立しない
    { targetChoice: "good_for_talk", condition: "a:q5=solo" },
    // テイクアウトは店内体験が無いので居心地・接客の記憶を聞かない
    { targetChoice: "comfortable", condition: "a:q5=takeout" }
  ];
}

/** C-Q3 用（ネガ側）。 */
function sceneDisableRulesNegative() {
  return [
    { targetChoice: "kids_hard", condition: "a:q5!=family_kids" },
    { targetChoice: "business_hard", condition: "a:q5!=business" },
    { targetChoice: "cramped", condition: "a:q5=takeout" },
    { targetChoice: "noisy", condition: "a:q5=takeout" }
  ];
}

const questions = [...questionsA, ...questionsB, ...questionsC];

// ------------------------------------------------------------------
// 投入 / 後片付け
// ------------------------------------------------------------------

const IDS = [P_A, P_B, P_C];

/** 案件に紐づく子レコードを、参照の深い順に消す。 */
async function cleanup() {
  const { data: sessions } = await supabase.from("sessions").select("id").in("project_id", IDS);
  const sessionIds = (sessions ?? []).map((s) => s.id);
  if (sessionIds.length > 0) {
    await supabase.from("answers").delete().in("session_id", sessionIds);
    await supabase.from("conversation_logs").delete().in("session_id", sessionIds);
  }
  for (const table of [
    "sessions",
    "project_assignments",
    "project_applications",
    "project_favorites",
    "questions"
  ]) {
    const { error } = await supabase.from(table).delete().in("project_id", IDS);
    if (error) console.warn(`cleanup ${table}: ${error.message}`);
  }
  const { error } = await supabase.from("projects").delete().in("id", IDS);
  if (error) throw new Error(`projects delete failed: ${error.message}`);
  console.log("cleanup done");
}

async function main() {
  if (process.argv.includes("--cleanup")) {
    await cleanup();
    return;
  }

  const { error: pErr } = await supabase.from("projects").upsert(projects, { onConflict: "id" });
  if (pErr) throw new Error(`projects upsert failed: ${pErr.message}`);
  console.log(`projects upserted: ${projects.length}`);

  const { error: dErr } = await supabase.from("questions").delete().in("project_id", IDS);
  if (dErr) throw new Error(`questions delete failed: ${dErr.message}`);

  const { error: qErr } = await supabase.from("questions").insert(questions);
  if (qErr) throw new Error(`questions insert failed: ${qErr.message}`);
  console.log(
    `questions inserted: ${questions.length} ` +
      `(A=${questionsA.length} / B=${questionsB.length} / C=${questionsC.length})`
  );

  const liffId = process.env.LINE_LIFF_ID_SURVEY ?? "<LINE_LIFF_ID_SURVEY>";
  console.log("\n--- entry URL ---");
  for (const p of projects) {
    console.log(`${p.name}\n  https://liff.line.me/${liffId}?entry_code=${p.entry_code}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
