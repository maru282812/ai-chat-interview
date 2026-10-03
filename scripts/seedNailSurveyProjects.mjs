/**
 * seedNailSurveyProjects.mjs
 *
 * ネイルサロン向け 店舗専用アンケート A / B / C の3案件を冪等投入する。
 * 美容室版（seedSalonSurveyProjects.mjs）の構造をそのまま踏襲し、業種固有の
 * 「頻度・評価項目・設問文」だけを差し替えている。
 *
 *   A: 来店すぐアンケート   （QR流入・施術前）  entry_code=yotto-nail-a
 *   B: 施術後アンケート     （施術直後）        entry_code=yotto-nail-b
 *   C: 本音アンケート       （後日・A-Q11基準） entry_code=yotto-nail-c
 *
 * 【美容室版との違い（設計判断）】
 *
 * 1. 来店頻度（A-Q11）の刻みが短い
 *    ネイルは「爪が伸びてリフトする」という物理的な再来店トリガーがあり 3〜4週が
 *    実質固定。美容室の 30/45/60 日刻みでは中心帯が粗すぎて離脱判定がぼやける。
 *    日数表は industry_templates 側（seedNailIndustryTemplate.mjs）に持つ。
 *
 * 2. 評価項目（ASPECTS）に「もちの良さ」を入れた
 *    ネイル満足度の最大因子。これが無いと B-Q4（改善要望）が実態を拾えない。
 *    逆に美容室固有の skill(カット技術)/trouble(髪の悩み)/home_styling は落とした。
 *
 * 3. 「店内の雰囲気・設備」は B-Q8 として独立させた（マトリクスに入れない）
 *    香り・BGM・照明は5段階満足度で聞いてもほぼ全員「やや満足」に寄り、
 *    durability のような分散のある項目と同じ土俵に並べると改善要望に出てこない。
 *    また matrix_single は 1行=1画面（survey.ejs）なので、行を足すと画面数が
 *    そのまま増える。そこで「満足したか」ではなく「気づかれたか」を
 *    multi_choice 1問で聞く。集塵機や半個室への投資が訴求できているかが分かる。
 *
 * 4. 人柄・相性は C（後日・匿名）で聞く
 *    「今日よかった」と「1か月後もまたあの人に頼みたい」は別物で、B では取れない。
 *    個人店ネイルの離脱理由は技術より相性だが、担当者に面と向かっては言えない。
 *    C-Q9 に相性の選択肢が無いと離脱理由が「価格」「距離」に流れ込んで真因が消える。
 *
 * 5. A-Q12（会話量）の選択肢を4段階にした
 *    ネイルは 2〜3時間の対面・至近距離で、会話量のミスマッチが美容室より効く。
 *
 * すべて visibility_type=private_store なので「探す」一覧には出ない。
 *
 * 【回答UI】美容室版と同じく案件全体を casual にしている。詳細は
 * seedSalonSurveyProjects.mjs の冒頭コメントを参照。
 *
 * 【選択肢の持ち越し（carry-forward）】
 *   同一案件内   : A-Q10 ← A-Q9 / B-Q3 ← B-Q2 / B-Q5 ← B-Q4
 *   別案件から   : C-Q2, C-Q3 ← A-Q5（今日のメニュー） ※Migration 092
 *   持ち越しは value 一致で絞るため、参照元と参照先の value を必ず揃えること。
 *
 * Usage:
 *   node scripts/seedNailSurveyProjects.mjs
 *   node scripts/seedNailSurveyProjects.mjs --cleanup
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

// 美容室版（5a10c0xx…）と衝突しない別系列。
// ⚠ UUID は16進のみ。"nail" を字面で入れたくなるが n/i/l は hex ではないため
//   Postgres の uuid 型で弾かれる（4a11 = "nail" の見立て）。
const P_A = "4a11c001-0000-4000-8000-000000000001";
const P_B = "4a11c002-0000-4000-8000-000000000002";
const P_C = "4a11c003-0000-4000-8000-000000000003";

/** 店舗名は案件ごとに差し替える想定（店舗追加時に storeProvisioningService が置換する）。 */
const STORE_NAME = "●●ネイルサロン";

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
    objective: "どんなお客様が、何を期待して今日来店しているのかを把握する",
    reward_points: 5,
    estimated_minutes: 1,
    entry_code: "yotto-nail-a",
    completion_message: "ご協力ありがとうございました。続きは施術後にお答えください。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_B,
    name: `【${STORE_NAME}】B：施術後アンケート`,
    objective: "施術直後の顧客満足度を項目別に把握する（本調査のメイン）",
    reward_points: 5,
    estimated_minutes: 2,
    entry_code: "yotto-nail-b",
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
    entry_code: "yotto-nail-c",
    completion_message:
      "ご協力ありがとうございました。引き続きアンケートサイトHibiをどうぞよろしくお願いいたします。",
    // C-Q2 / C-Q3 の選択肢を A-Q5（今日のメニュー）で絞るための宣言（Migration 092）
    carry_forward_sources: [{ namespace: "a", entry_code: "yotto-nail-a" }]
  }
];

// ------------------------------------------------------------------
// ヘルパ（美容室版と同一）
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
 * A-Q12 / A-Q14 の告知文。
 * 回答画面の helpText と share_with_store.notice を必ず同一にする。
 * 利用規約 第9条3項が「回答画面上であらかじめ明示したうえで」を開示条件に
 * しているため、画面に出した文言と根拠がズレると説明がつかなくなる。
 */
const A_Q12_NOTICE = "この設問のみ担当者が施術前に確認いたします。会話の量はいつでも変えていただけます。";
const A_Q14_NOTICE = "この設問のみ担当者が施術前に確認いたします。";

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
 * 満足度の評価項目11件。A-Q9/A-Q10（重視項目）と B-Q2/B-Q3/B-Q4 で value を共有する。
 * ここを揃えておくことで carry-forward が value 一致で成立する。
 *
 * 美容室版からの変更:
 *   + durability   もちの良さ（ネイル満足度の最大因子）
 *   + design       デザインの再現度
 *   + nail_care    甘皮・爪の整え方の丁寧さ
 *   - skill        「カットやカラー技術」＝美容室固有
 *   - trouble      「髪や頭皮の悩み解決」＝美容室固有
 *   - home_styling 「自宅での扱いやすさ」＝美容室固有
 *   ※ atmosphere（店内の雰囲気）は評価項目ではなく B-Q8 で別途聞く（冒頭コメント3）
 */
const ASPECTS = [
  ["durability", "もちの良さ（崩れにくさ）"],
  ["design", "デザインの再現度（イメージどおりか）"],
  ["finish", "仕上がり"],
  ["proposal", "自分に合った提案"],
  ["nail_care", "甘皮・爪の整え方の丁寧さ"],
  ["care", "施術の丁寧さ（オフやケアの仕方など）"],
  ["talk", "スタッフとの会話・接客"],
  ["comfort", "店内の居心地・清潔感"],
  ["duration", "施術時間"],
  ["wait", "待ち時間"],
  ["price", "価格への納得感"]
];

/** A-Q9/A-Q10 は「待ち時間」を含まない（施術前のため）。美容室版と同じ考え方。 */
const A_ASPECTS = ASPECTS.filter(([v]) => v !== "wait");

/** 雰囲気は評価項目ではないが「重視して来たか」「不満だったか」は聞く価値がある。 */
const ATMOSPHERE = ["atmosphere", "店内の雰囲気・落ち着けるか"];

const OTHER = ["other", "その他"];

/** 「特になし」は他と同時に選べない排他選択肢にする。 */
const exclusiveNone = { value: "none", label: "特になし", exclusive: true };

// ------------------------------------------------------------------
// A: 来店すぐアンケート
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
        "アンケートは施術前、施術後、再来有無確認の３つを予定しております。各１分程度の長さです。",
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

  q(P_A, "Q4", "このネイルサロンへの来店は何回目ですか？（ひとつだけ）", "single_choice", 4, {
    options: opts(
      ["first", "１回目（初めて）"],
      ["second", "２回目"],
      ["third", "３回目"],
      ["fourth_plus", "４回目以上"]
    ),
    helpText: "※回数を覚えていない場合は、おおよその回数を教えてください。"
  }),

  q(P_A, "Q5", "今日利用するメニューを教えてください。（いくつでも）", "multi_choice", 5, {
    options: opts(
      ["hand_gel", "ハンド（ジェルネイル）"],
      ["foot_gel", "フット（ジェルネイル）"],
      ["polish", "ポリッシュ（マニキュア）"],
      ["scalp", "スカルプ・長さ出し"],
      ["nail_art", "アート・ストーンなどのデザイン追加"],
      ["care_only", "ネイルケアのみ（甘皮処理・爪磨き）"],
      ["off_only", "オフのみ"],
      ["repair", "リペア・修理"],
      OTHER
    )
  }),

  // A-Q6: 初回(Q4=first)かどうかで設問文が変わる。文面違いの2問を表示条件で出し分ける。
  q(
    P_A,
    "Q6",
    "今回、このネイルサロンを知ったきっかけを教えてください。（いくつでも）",
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

  q(P_A, "Q8", "今回、ネイルサロンに来た一番の目的を教えてください（ひとつだけ）", "single_choice", 8, {
    options: opts(
      ["keep_style", "いつものネイルを付け替えたい（伸びてきたから）"],
      ["change_design", "デザイン・雰囲気を変えたい"],
      ["nail_trouble", "爪の悩み（割れ・二枚爪など）を解決したい"],
      ["event", "結婚式・旅行などの特別な予定に備えたい"],
      ["seasonal", "季節・流行のデザインを楽しみたい"],
      ["care", "爪をきれいに整えたい（ケア目的）"],
      ["relax", "リラックス・気分転換したい"],
      OTHER
    )
  }),

  q(P_A, "Q9", "今日、重視していることは何ですか？（いくつでも）", "multi_choice", 9, {
    // atmosphere は「雰囲気を重視して来た層」をフラグ化してクロス集計に使う。
    // 選択肢1つの追加なので画面は増えない（冒頭コメント3）。
    options: opts(...A_ASPECTS, ATMOSPHERE, OTHER)
  }),

  // A-Q10: A-Q9 で選んだものだけ表示（carry-forward）
  q(
    P_A,
    "Q10",
    "今日、特に重視していることは何ですか？（ひとつだけ）",
    "single_choice",
    10,
    { options: opts(...A_ASPECTS, ATMOSPHERE, OTHER) },
    {
      display_tags_parsed: { optionSource: { fromQuestion: "q9", mode: "selected" } }
    }
  ),

  // A-Q11: 離脱判定の基準。industry_templates.frequency_question_code=Q11 と対応する。
  // 刻みはネイルの実態（3〜4週が中心）に合わせてあり、美容室版とは value から異なる。
  // ⚠ ここの value を変えたら seedNailIndustryTemplate.mjs の日数表も必ず揃えること。
  //   片方だけ直すと頻度が引けず、C の送付日が undecided 扱いに落ちる。
  q(P_A, "Q11", "普段どのくらいの頻度でネイルサロンを利用しますか？（ひとつだけ）", "single_choice", 11, {
    options: opts(
      ["within_2w", "2〜3週間に1回"],
      ["about_3_4w", "3〜4週間に1回"],
      ["about_1m", "約1か月に1回"],
      ["about_1_5m", "約1か月半に1回"],
      ["about_2m", "約2か月に1回"],
      ["over_3m", "3か月以上に1回"],
      ["undecided", "特に決まっていない"]
    ),
    helpText: "この回答をもとに、後日のアンケート（C）をお送りする時期を決めます。"
  }),

  // A-Q12: 施術中の会話量の希望。ネイルは 2〜3時間の対面・至近距離なので
  // 美容室版の3択より粒度を上げて4択にしている（冒頭コメント5）。
  q(
    P_A,
    "Q12",
    "今日は施術中に話しかけてもよいですか？（ひとつだけ）",
    "single_choice",
    12,
    {
      options: opts(
        ["welcome", "ぜひ話しかけてほしい"],
        ["normal", "ふつうに会話したい"],
        ["when_needed", "必要なときだけ話しかけてほしい"],
        ["quiet", "静かに過ごしたい（スマホ・読書などしたい）"]
      ),
      helpText: A_Q12_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。選択式なので集計のみ。
      // notice は helpText と同一にする。回答画面に出した文言そのものが
      // 開示の根拠になるため、ズレると規約上の説明がつかなくなる。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "aggregate",
          timing: "immediate",
          notice: A_Q12_NOTICE
        }
      }
    }
  ),

  // A-Q13: 持ち込み画像の有無。デザイン不満が「伝達の失敗」か「技術」かを
  // 切り分けるための設問で、C-Q3（良くなかった点）と繋がる。
  q(P_A, "Q13", "今日のデザインについて、写真や画像を持参されましたか？（ひとつだけ）", "single_choice", 13, {
    options: opts(
      ["yes_image", "はい（Instagramや写真を見せた／見せる予定）"],
      ["yes_words", "いいえ、口頭で伝えた／伝える予定"],
      ["leave_it", "お任せする予定"],
      ["undecided", "まだ決めていない"]
    )
  }),

  q(
    P_A,
    "Q14",
    "今日の施術について、気になっていることやスタッフに伝えたいことはありますか？",
    "free_text_long",
    14,
    {
      placeholder: "例）自分に合ったデザインが知りたいです。／爪が割れやすいのが気になっています。",
      helpText: A_Q14_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。施術前に読めないと意味がないので原文・即時。
      // ⚠ 自由記述なので何が書かれるか制御できない。第三者の名前や要配慮情報が
      //   混入し得るため、運用側で内容を確認できる状態を保つこと。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "verbatim",
          timing: "immediate",
          notice: A_Q14_NOTICE
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
    ["booking_site", "ホットペッパービューティーなどの予約サイト"],
    ["web_ad", "Web広告・SNS広告"],
    ["flyer", "チラシ"],
    ["passing_by", "店前を通りかかった時に見かけた"],
    OTHER
  );
}

// ------------------------------------------------------------------
// B: 施術後アンケート
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
  //   足すと画面数がそのまま増えるうえ、香りやBGMは5段階で聞いても分散が出ない。
  //   雰囲気は B-Q8 で「気づかれたか」として聞く（冒頭コメント3）。
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
      options: [...opts(...ASPECTS, ["atmosphere", "店内の雰囲気・居心地"], OTHER), exclusiveNone]
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
      placeholder: "例）デザインについて、もちについて、料金について、接客についてなど",
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

  q(P_B, "Q7", "次回もこのネイルサロンを利用したいと思いますか？（ひとつだけ）", "single_choice", 7, {
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
  // 香り・BGM・照明は満足度では動かない（ほぼ全員が「やや満足」に寄る）が、
  // 気づかれた／気づかれなかったは店側の投資判断に直結する
  // （集塵機を入れたのに誰も挙げない＝訴求できていない）。
  // 個人店が多い業種なので、ここが再来店理由の実質的な差別化要素になる。
  q(P_B, "Q8", "お店の空間で、心地よかったものはありますか？（いくつでも）", "multi_choice", 8, {
    options: [
      ...opts(
        ["scent", "香り・アロマ"],
        ["bgm", "BGM・音の静かさ"],
        ["lighting", "照明の明るさ・色味"],
        ["chair", "椅子やクッションの座り心地"],
        ["hand_rest", "ハンドレスト・アーム置きの楽さ"],
        ["hygiene", "衛生面（器具の消毒・使い捨て）"],
        ["equipment", "機材の充実（集塵機・ダストクリーナーなど）"],
        ["privacy", "プライベート感（半個室・他のお客と離れている）"],
        ["drink", "ドリンクやお菓子"],
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
    "今日のサービスについて、何か伝えたいことがあれば教えてください",
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
        "アンケート調査を行っているYOTTOではこのネイルサロンの満足度アンケートのほかにも、簡単なアンケート（ポイ活）を行っております。\n" +
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
    "前回の施術から時間が経ちましたが、現在の仕上がりについてどう感じていますか？（ひとつだけ）",
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

  q(
    P_C,
    "Q2",
    "実際に生活してみて、よかった点はありましたか？（いくつでも）",
    "multi_choice",
    2,
    {
      options: [
        ...opts(
          ["lasted_long", "想像していたより長くもった"],
          ["no_lift", "浮き（リフト）が出にくかった"],
          ["no_chip", "欠け・割れが起きなかった"],
          ["design_liked", "デザインが気に入った"],
          ["good_reputation", "周囲から評判が良かった"],
          ["daily_comfort", "家事や仕事の邪魔にならなかった"],
          ["nail_healthy", "自爪の状態が良くなった・傷まなかった"],
          ["foot_comfort", "靴を履いても痛くならなかった"],
          OTHER
        ),
        exclusiveNone
      ],
      helpText: "前回ご利用いただいたメニューに関するものだけ表示しています。",
      // 「本音」は1項目ずつ◯✕で判定させたほうが取りこぼしが少ない（後日回答＝急いでいない）。
      // 排他の「特になし」はデッキから自動で外れ、全部✕＝特になし相当になる。
      ...SORT_SWIPE
    },
    {
      // A-Q5 で該当メニューを選んでいない人には出さない（Migration 092）
      display_tags_parsed: { disableRules: menuDisableRulesPositive() }
    }
  ),

  q(
    P_C,
    "Q3",
    "実際に生活して、あまり良くなかったところはありましたか？（いくつでも）",
    "multi_choice",
    3,
    {
      options: [
        ...opts(
          ["lifted_early", "早い段階で浮いて（リフトして）きた"],
          ["chipped", "欠けた・割れた"],
          ["peeled", "剥がれてしまった"],
          ["design_disliked", "デザインが思っていたものと違った"],
          ["design_faded", "時間が経つと見た目が気になってきた"],
          ["bad_reputation", "周囲からの評判が良くなかった"],
          ["daily_hindrance", "家事や仕事の邪魔になった"],
          ["nail_damage", "自爪のダメージが気になった"],
          ["too_thick", "長さや厚みが合わなかった"],
          ["foot_pain", "靴を履くと痛かった"],
          OTHER
        ),
        exclusiveNone
      ]
      // C-Q2 と連続で1枚ずつ振り分けさせると操作量が多すぎるため、後半のこちらは
      // chip_select（casual の複数選択の既定）で受ける。ネガ側の取りこぼしより
      // 全体の完走を優先する判断（美容室版と同じ）。
    },
    {
      display_tags_parsed: { disableRules: menuDisableRulesNegative() }
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
      placeholder: "例）もちについて、デザインについて、料金について、接客について",
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
    "前回の来店以降、ネイルサロンを利用しましたか？（ひとつだけ）",
    "single_choice",
    5,
    {
      options: opts(["yes", "はい（この店／別の店）"], ["no", "いいえ"]),
      helpText: "※どこのネイルサロンかは問いません。",
      ...SWIPE
    }
  ),

  // C-Q6: C-Q5=yes のときだけ
  q(
    P_C,
    "Q6",
    "前回の来店以降、どちらのネイルサロンを利用しましたか。（ひとつだけ）",
    "single_choice",
    6,
    {
      options: opts(
        ["same", `この${STORE_NAME}を再度利用した`],
        ["other", "別のネイルサロンを利用した"],
        ["both", `この${STORE_NAME}と別のネイルサロンの両方を利用した`],
        ["self", "セルフネイルをした"]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=yes" }] }
  ),

  // C-Q7: C-Q5=no のときだけ
  q(
    P_C,
    "Q7",
    "あなたはどちらのネイルサロンを利用する予定ですか？（ひとつだけ）",
    "single_choice",
    7,
    {
      options: opts(
        ["same", "このネイルサロンを再度利用する予定"],
        ["other", "別のネイルサロンを利用する予定"],
        ["self", "しばらくセルフネイル・ネイルをお休みする予定"],
        ["undecided", "検討中・考えていない"]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=no" }] }
  ),

  // C-Q8: リピート要因（Q6=same/both もしくは Q7=same）
  // 個人店ネイルの継続理由は技術より「担当者との相性」に寄る。B では聞けない
  // （目の前の担当者に言えない）ため、後日・匿名のこの経路でしか取れない。
  q(
    P_C,
    "Q8",
    "またこのネイルサロンを利用した（したいと思う）理由を教えてください（いくつでも）",
    "multi_choice",
    8,
    {
      options: opts(
        ["durability", "もちが良かった"],
        ["good_finish", "仕上がりが良かった"],
        ["design_reproduction", "イメージどおりのデザインにしてくれる"],
        ["good_proposal", "自分に合った提案をしてくれる"],
        ["nail_care", "爪のケアが丁寧"],
        ["nailist_person", "担当者の人柄・話しやすさ"],
        ["understands_me", "自分のことを理解してくれている"],
        ["no_pressure", "勧誘がない・気をつかわなくてよい"],
        ["atmosphere", "お店の雰囲気・居心地が良い"],
        ["access", "通いやすい（場所・アクセス）"],
        ["price", "価格への納得感"],
        ["easy_booking", "予約が取りやすい"],
        ["habit", "なんとなくいつも利用している"],
        ["too_much_effort", "他のネイルサロンを探すのが面倒だった"],
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
  // ⚠ 相性の選択肢（person_mismatch / atmosphere_mismatch）が無いと、
  //   離脱理由が全部「価格」「距離」に流れ込んで真因が消える。
  q(
    P_C,
    "Q9",
    "別のネイルサロンを利用した（する予定の）理由を教えてください（いくつでも）",
    "multi_choice",
    9,
    {
      options: opts(
        ["poor_durability", "もちが良くなかった"],
        ["unsatisfied_finish", "前回の仕上がりに満足できなかった"],
        ["design_mismatch", "イメージどおりのデザインにならなかった"],
        ["nail_damage", "自爪へのダメージが気になった"],
        ["person_mismatch", "担当者との相性が合わなかった"],
        ["atmosphere_mismatch", "お店の雰囲気が合わなかった"],
        ["bad_service", "接客が合わなかった"],
        ["price", "価格への納得感がなかった"],
        ["low_skill", "技術力が低かった"],
        ["too_long", "施術時間が長すぎた"],
        ["access", "場所・アクセスが良くなかった"],
        ["try_other", "他店を試してみたかった"],
        ["recommended", "家族・友人に勧められた"],
        ["coupon", "別のネイルサロンでクーポン・キャンペーンがあったから"],
        ["moved", "引っ越し等で物理的に行けなくなったから"],
        ["no_slot", "行きたいタイミングで予約が取れなかったから"],
        ["no_reason", "特に理由はなく、たまたま別のネイルサロンを利用した"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        { type: "pipe_expression", expression: "q6=other or q6=both or q7=other" }
      ]
    }
  ),

  // C-Q10: 別店利用 or 未定 or セルフ移行の人にだけ改善期待を聞く
  q(
    P_C,
    "Q10",
    "今後、このネイルサロンに期待することがあれば教えてください",
    "free_text_long",
    10,
    {
      placeholder: "例）デザインについて、もちについて、料金について、接客について",
      helpText:
        "今後、どんなところが改善すればこのネイルサロンを再度利用すると思いますか。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression: "q6=other or q6=both or q7=other or q7=undecided or q7=self"
        }
      ]
      // お礼は projects.completion_message（送信完了画面）へ移した (Migration 108)。
    }
  )
];

/**
 * A-Q5（メニュー）で選ばれていないメニューに紐づく選択肢を落とす（C-Q2 用）。
 * disableRules の condition は pipe 式。`a:q5` は Migration 092 の名前空間付き参照。
 */
function menuDisableRulesPositive() {
  return [
    // フット未施術なら「靴を履いても痛くならなかった」は意味をなさない
    { targetChoice: "foot_comfort", condition: "not a:q5 includes foot_gel" },
    // デザインを伴わないメニュー（ケアのみ・オフのみ）ならデザイン評価は出さない
    {
      targetChoice: "design_liked",
      condition:
        "not a:q5 includes hand_gel and not a:q5 includes foot_gel and not a:q5 includes polish and not a:q5 includes scalp and not a:q5 includes nail_art"
    }
  ];
}

/** C-Q3 用（ネガ側）。 */
function menuDisableRulesNegative() {
  return [
    { targetChoice: "foot_pain", condition: "not a:q5 includes foot_gel" },
    {
      targetChoice: "design_disliked",
      condition:
        "not a:q5 includes hand_gel and not a:q5 includes foot_gel and not a:q5 includes polish and not a:q5 includes scalp and not a:q5 includes nail_art"
    },
    // 長さ・厚みの不満はスカルプ／長さ出しをしたときだけ意味がある
    { targetChoice: "too_thick", condition: "not a:q5 includes scalp" }
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
