/**
 * seedRetailSurveyProjects.mjs
 *
 * 小売店向け 店舗専用アンケート A / B / C の3案件を冪等投入する。
 * 美容室版（seedSalonSurveyProjects.mjs）・飲食版（seedRestaurantSurveyProjects.mjs）の
 * 構造を踏襲し、業種固有の「頻度・評価項目・設問文」を差し替えている。
 *
 *   A: 来店すぐアンケート （入店直後のQR）   entry_code=yotto-retail-a
 *   B: 購入後アンケート   （会計後）         entry_code=yotto-retail-b
 *   C: 本音アンケート     （後日・A-Q7基準）  entry_code=yotto-retail-c
 *
 * 【他業種との違い（設計判断）】
 *
 * 1. A は「入店直後の数分」で終わる長さに削る（9問）
 *    飲食は着席〜配膳の数分が空き時間になるが、小売は歩きながらの回答で
 *    手が空いておらず、待ち時間という概念そのものが無い。飲食の11問でも長い。
 *    重視項目の2段構え（サロンの A-Q9→A-Q10 の carry-forward）は畳んで1問にした。
 *    ⚠ ただし頻度設問（A-Q7）は削れない。これが C の送付日を決めているため、
 *      落とすと全員が undecided_days に倒れて離脱判定そのものが成立しない。
 *    ⚠ ここを増やすと買い物を始めた瞬間に離脱して A の完了率が落ち、
 *      A で完了しないと B も C も紐づかない（サイクルごと消える）。
 *
 * 2. 「買わずに出た人」を取りこぼさない
 *    小売固有の最重要論点。飲食・サロンは来店＝購入がほぼ確定だが、小売は
 *    入店しても買わない客が常に一定数いて、その理由こそ改善余地そのものである。
 *    B-Q1 を「購入したか」の分岐にし、未購入者には満足度マトリクスを出さず
 *    B-Q10〜Q12（買わなかった理由）へ振る。
 *    ⚠ 未購入者に「価格への納得感」を5段階で聞いても答えようがない。
 *      分岐せず全員にマトリクスを出すと、この層が neutral を量産して
 *      購入者の満足度を薄める（B-Q2 の平均が動かなくなる）。
 *
 * 3. 評価項目（ASPECTS）の最大因子は「品揃え」と「価格」
 *    サロンの finish（仕上がり）・飲食の taste（味）に相当するのが
 *    lineup（品揃え）。加えて小売固有として stock（在庫・欠品のなさ）/
 *    findability（見つけやすさ）/ checkout（レジの速さ）/ layout（売場の回りやすさ）
 *    を入れ、サロン固有の施術系（skill / care / duration）は落とした。
 *
 * 4. 「担当者」ではなく「声のかけられ方」を評価する
 *    サロンは指名＝担当者との相性が離脱の主因だが、小売は接客が
 *    「されるか・されないか」の一往復で終わる。過剰な声かけは不満要因にも
 *    なるため、満足度ではなく A-Q8 で希望を聞いて即時開示する（下記6）。
 *
 * 5. 来店頻度の幅が業種内で最も広い（週数回〜年1回）
 *    同じ「小売店」に日用品（週数回）とアパレル・家電（年数回）が混在する。
 *    日数表は industry_templates 側（seedRetailIndustryTemplate.mjs）に持つ。
 *    ⚠ 店舗の業態によって中心帯が変わる。日用品店に年単位の刻みを使うと
 *      離脱判定が鈍り、アパレル店に週単位を使うと全員が離脱に見える。
 *
 * 6. 声かけの希望は A で聞いて即時開示する
 *    サロンの A-Q12（会話量）に相当する。小売では「放っておいてほしい客に
 *    声をかける」が最大の不満要因で、しかも購入前に届かないと意味がない。
 *    選択式なので集計のみ・timing=immediate で店舗へ開示する。
 *    画面の helpText と share_with_store.notice を必ず一致させること（利用規約 第9条3項）。
 *
 * すべて visibility_type=private_store なので「探す」一覧には出ない。
 *
 * 【回答UI】サロン版と同じく案件全体を casual にしている。詳細は
 * seedSalonSurveyProjects.mjs の冒頭コメントを参照。
 *
 * 【選択肢の持ち越し（carry-forward）】
 *   同一案件内 : B-Q4 ← B-Q3 / B-Q6 ← B-Q5
 *   別案件から : C-Q2, C-Q3 ← A-Q5（今日の来店目的） ※Migration 092
 *   持ち越しは value 一致で絞るため、参照元と参照先の value を必ず揃えること。
 *
 * Usage:
 *   node scripts/seedRetailSurveyProjects.mjs
 *   node scripts/seedRetailSurveyProjects.mjs --cleanup
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

// 美容室（5a10c0xx…）・ネイル（4a11c0xx…）・飲食（ae54c0xx…）・鍼灸（ac00c0xx…）と
// 衝突しない別系列。
// ⚠ UUID は16進のみ。"retail" を字面で入れたくなるが r/t/i/l は hex ではないため
//   Postgres の uuid 型で弾かれる（5e11 = "sell" の見立て）。
const P_A = "5e11c001-0000-4000-8000-000000000001";
const P_B = "5e11c002-0000-4000-8000-000000000002";
const P_C = "5e11c003-0000-4000-8000-000000000003";

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
    objective: "どんなお客様が、何を求めて今日来店しているのかを把握する",
    reward_points: 5,
    estimated_minutes: 1,
    entry_code: "yotto-retail-a",
    completion_message: "ご協力ありがとうございました。続きはお買い物のあとにお答えください。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_B,
    name: `【${STORE_NAME}】B：購入後アンケート`,
    objective: "買えたか・買えなかったかと、その満足度を項目別に把握する（本調査のメイン）",
    reward_points: 5,
    estimated_minutes: 2,
    entry_code: "yotto-retail-b",
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
    entry_code: "yotto-retail-c",
    completion_message:
      "ご協力ありがとうございました。引き続きアンケートサイトHibiをどうぞよろしくお願いいたします。",
    // C-Q2 / C-Q3 の選択肢を A-Q5（来店目的）で絞るための宣言（Migration 092）
    carry_forward_sources: [{ namespace: "a", entry_code: "yotto-retail-a" }]
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
 * A-Q8 / A-Q9 の告知文。
 * 回答画面の helpText と share_with_store.notice を必ず同一にする。
 * 利用規約 第9条3項が「回答画面上であらかじめ明示したうえで」を開示条件に
 * しているため、画面に出した文言と根拠がズレると説明がつかなくなる。
 */
const A_Q8_NOTICE = "この設問のみ、お買い物中にスタッフが確認いたします。ご希望はいつでも変えていただけます。";
const A_Q9_NOTICE = "この設問のみ、お買い物中にスタッフが確認いたします。";

/** [value, label] のペア配列から options を作る。 */
const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));

/** 5段階満足度（B-Q3 の列で使用。調査票どおり「とても満足」が先頭）。 */
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
 * 満足度の評価項目10件。A-Q6（重視項目）と B-Q3/B-Q4/B-Q5 で value を共有する。
 * ここを揃えておくことで carry-forward が value 一致で成立する。
 *
 * 小売固有として入れたもの:
 *   + lineup      品揃え（小売満足度の最大因子）
 *   + stock       在庫・欠品のなさ（品揃えとは別物。「置いてあるが売り切れ」を拾う）
 *   + findability 探しているものの見つけやすさ
 *   + layout      売場の回りやすさ
 *   + checkout    レジの速さ・待ち時間
 * サロン・飲食から落としたもの:
 *   - skill / care / duration  施術系＝小売に存在しない
 *   - taste / portion          飲食固有
 *   ※ staff（接客）は残すが、小売では「声のかけられ方」の希望を A-Q7 で別に聞く
 *     （過剰な声かけは満足度では拾えない。冒頭コメント4・6）
 */
const ASPECTS = [
  ["lineup", "品揃えの豊富さ"],
  ["stock", "欲しいものが在庫としてあるか（欠品のなさ）"],
  ["price", "価格への納得感"],
  ["quality", "商品の品質"],
  ["findability", "探しているものの見つけやすさ"],
  ["layout", "売場の回りやすさ・通路の広さ"],
  ["staff", "スタッフの接客・商品知識"],
  ["checkout", "レジの速さ・待ち時間"],
  ["cleanliness", "店内の清潔感"],
  ["display", "商品の見せ方・陳列のわかりやすさ"]
];

/** A-Q6 は「レジの速さ」を含まない（入店直後＝まだ会計していないため）。 */
const A_ASPECTS = ASPECTS.filter(([v]) => v !== "checkout");

const OTHER = ["other", "その他"];

/** 「特になし」は他と同時に選べない排他選択肢にする。 */
const exclusiveNone = { value: "none", label: "特になし", exclusive: true };

// ------------------------------------------------------------------
// A: 来店すぐアンケート（入店直後・8問）
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
        "アンケートはお買い物の前、お買い物のあと、再来店の有無確認の３つを予定しております。各１分程度の長さです。",
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
      ["few", "２〜３回目"],
      ["several", "４〜10回目"],
      ["regular", "11回目以上（よく利用している）"]
    ),
    helpText: "※回数を覚えていない場合は、おおよその回数を教えてください。"
  }),

  // A-Q5: C-Q2 / C-Q3 の選択肢を絞る基準（Migration 092）。
  // ⚠ ここの value を変えたら C の disableRules も必ず揃えること。
  q(P_A, "Q5", "今日はどんな目的で来店されましたか？（いくつでも）", "multi_choice", 5, {
    options: opts(
      ["specific_item", "買うものが決まっている（目的の商品がある）"],
      ["restock", "いつも使っているものを買い足しに"],
      ["browsing", "特に決めていない（見て回りたい）"],
      ["compare", "商品を見て比べたい・実物を確認したい"],
      ["gift", "贈り物・プレゼントを探している"],
      ["sale", "セール・キャンペーンが目的"],
      ["consult", "スタッフに相談したいことがある"],
      ["kill_time", "時間つぶし・立ち寄り"],
      OTHER
    )
  }),

  // A-Q6: 重視項目。飲食版と同じく2段構え（A-Q9→A-Q10）を1問に畳んでいる。
  // 入店直後に「いくつでも」→「特にひとつ」の2画面を挟むと離脱する（冒頭コメント1）。
  q(P_A, "Q6", "今日のお買い物で重視することは何ですか？（いくつでも）", "multi_choice", 6, {
    options: opts(...A_ASPECTS, OTHER)
  }),

  // A-Q7: 離脱判定の基準。industry_templates.frequency_question_code=Q7 と対応する。
  // ⚠ A を短くするために削ってよい設問ではない。これが無いと C の送付日が
  //   全員 undecided_days に落ち、離脱判定そのものが成立しない。
  // ⚠ ここの value を変えたら seedRetailIndustryTemplate.mjs の日数表も必ず揃えること。
  //   片方だけ直すと頻度が引けず、C の送付日が undecided 扱いに落ちる。
  // 刻みは週単位から年単位まで広く取る。小売は日用品（週数回）とアパレル・家電
  // （年数回）が同じテンプレートに乗るため（冒頭コメント5）。
  q(P_A, "Q7", "普段どのくらいの頻度でこのようなお店を利用しますか？（ひとつだけ）", "single_choice", 7, {
    options: opts(
      ["weekly_plus", "週に2回以上"],
      ["weekly", "週に1回くらい"],
      ["biweekly", "2週間に1回くらい"],
      ["monthly", "月に1回くらい"],
      ["quarterly", "2〜3か月に1回くらい"],
      ["half_year", "半年に1回くらい"],
      ["yearly", "年に1回くらい、またはそれ以下"],
      ["undecided", "特に決まっていない"]
    ),
    helpText: "この回答をもとに、後日のアンケート（C）をお送りする時期を決めます。"
  }),

  // A-Q8: 声かけの希望。小売では「放っておいてほしい客に声をかける」が最大の
  // 不満要因で、購入前に届かないと意味がない（冒頭コメント6）。
  q(
    P_A,
    "Q8",
    "今日はスタッフから声をかけてもよいですか？（ひとつだけ）",
    "single_choice",
    8,
    {
      options: opts(
        ["welcome", "ぜひ声をかけてほしい（相談したい）"],
        ["when_needed", "必要なときだけ声をかけてほしい"],
        ["only_if_asked", "こちらから聞くまでは声をかけないでほしい"],
        ["quiet", "ゆっくり自分のペースで見たい"]
      ),
      helpText: A_Q8_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。選択式なので集計のみ。
      // notice は helpText と同一にする。回答画面に出した文言そのものが
      // 開示の根拠になるため、ズレると規約上の説明がつかなくなる。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "aggregate",
          timing: "immediate",
          notice: A_Q8_NOTICE
        }
      }
    }
  ),

  q(
    P_A,
    "Q9",
    "今日探しているものや、スタッフに伝えたいことがあれば教えてください",
    "free_text_long",
    9,
    {
      placeholder: "例）〇〇を探しています。／サイズを見てほしいです。",
      helpText: A_Q9_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。買い物中に読めないと意味がないので原文・即時。
      // ⚠ 自由記述なので何が書かれるか制御できない。第三者の名前や要配慮情報が
      //   混入し得るため、運用側で内容を確認できる状態を保つこと。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "verbatim",
          timing: "immediate",
          notice: A_Q9_NOTICE
        }
      }
    },
    // お礼は projects.completion_message（送信完了画面）へ。comment_bottom は
    // 設問の下＝送信「前」に出てしまうため使わない (Migration 108)。
    { is_required: false }
  )
];

// ------------------------------------------------------------------
// B: 購入後アンケート
//
// ⚠ B-Q1 で購入者／未購入者に分岐する（冒頭コメント2）。
//   購入者   : Q2〜Q9（満足度マトリクスあり）
//   未購入者 : Q10〜Q12（買わなかった理由）
//   両方     : Q13（自由記述）・Q14（Hibi 転換）
// ------------------------------------------------------------------

const questionsB = [
  // B-Q1: 小売の分岐点。ここが無いと未購入者が満足度を neutral で埋めて
  // 購入者の満足度を薄める（冒頭コメント2）。
  q(
    P_B,
    "Q1",
    "本日は商品をご購入されましたか？（ひとつだけ）",
    "single_choice",
    1,
    {
      options: opts(
        ["bought_all", "探していたものを買えた"],
        ["bought_partly", "一部だけ買えた（買えなかったものもある）"],
        ["bought_other", "探していたものとは別のものを買った"],
        ["not_bought", "何も買わなかった"]
      ),
      ...SWIPE
    },
    {
      comment_top:
        "本日のご来店ありがとうございました。1〜2分程度のお客様の満足度確認アンケートにご協力ください。\n" +
        "このアンケートの回答は、個人を特定されない形で集計・分析いたしますので、正直な感想・意見をご自由にお書きください。\n" +
        "良いところ、改善してほしいところがあれば、遠慮なくお答えください。"
    }
  ),

  q(P_B, "Q2", "本日のご利用について、総合的にどのくらい満足しましたか？（ひとつだけ）", "single_choice", 2, {
    options: scale5(...SAT5.map((o) => [o.value, o.label])),
    ...SLIDER
  }),

  // B-Q3: 項目×5段階のマトリクス（SAMTX）。
  // ⚠ matrix_single は 1行=1画面で出る（survey.ejs）。行を足すと画面数がそのまま増える。
  //   店内環境（BGM・照明・空調）はここに入れず B-Q7 で「気づかれたか」として聞く。
  // ⚠ 未購入者には出さない。価格や品質を5段階で聞いても答えようがない。
  q(
    P_B,
    "Q3",
    "以下について、それぞれ満足度を教えてください（それぞれひとつだけ）",
    "matrix_single",
    3,
    {
      matrix_rows: ASPECTS.map(([value, label]) => ({ value, label })),
      matrix_cols: SAT5
    },
    {
      answer_output_type: "object",
      visibility_conditions: [{ type: "pipe_expression", expression: "q1!=not_bought" }]
    }
  ),

  // B-Q4: matrix の回答は object 形式のため、選択肢 value 一致で絞る carry-forward が
  //       そのままでは効かない。全項目を出し「特になし」を用意して運用でカバーする。
  q(
    P_B,
    "Q4",
    "今日、特に満足したものを教えてください（ひとつだけ）",
    "single_choice",
    4,
    { options: [...opts(...ASPECTS, OTHER), exclusiveNone] },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q1!=not_bought" }] }
  ),

  q(
    P_B,
    "Q5",
    "反対に「もっとこうだったら良かった」と思うものはありますか？（いくつでも）",
    "multi_choice",
    5,
    { options: [...opts(...ASPECTS, ["atmosphere", "店内の雰囲気・居心地"], OTHER), exclusiveNone] },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q1!=not_bought" }] }
  ),

  // B-Q6: B-Q5 で「特になし」なら出さない
  q(
    P_B,
    "Q6",
    "「もっとこうだったら良かった」と思うことについて具体的に教えてください。",
    "free_text_long",
    6,
    {
      placeholder: "例）品揃えについて、価格について、売場について、接客についてなど",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        { type: "pipe_expression", expression: "q1!=not_bought and not q5 includes none" }
      ]
    }
  ),

  // B-Q7: 店内の環境。満足度5段階ではなく「気づかれたか」を聞く。
  // BGM・照明・空調は満足度では動かない（ほぼ全員が「やや満足」に寄る）が、
  // 気づかれた／気づかれなかったは店側の投資判断に直結する。
  // ⚠ 未購入者にも出す。買わずに出た人が「居心地は良かった」のか
  //   「居心地が悪くて出た」のかは、未購入理由の解釈に直接効く。
  q(P_B, "Q7", "お店の空間で、心地よかったものはありますか？（いくつでも）", "multi_choice", 7, {
    options: [
      ...opts(
        ["bgm", "BGM・音の大きさ"],
        ["lighting", "照明の明るさ・色味"],
        ["temperature", "空調の快適さ"],
        ["scent", "店内の香り"],
        ["aisle", "通路の広さ・歩きやすさ"],
        ["signage", "案内表示・POPのわかりやすさ"],
        ["cleanliness", "清潔感（床・棚・試着室など）"],
        ["fitting", "試着室・試用スペースの使いやすさ"],
        ["rest", "休憩スペース・椅子"],
        ["interior", "内装・インテリアの雰囲気"],
        OTHER
      ),
      exclusiveNone
    ],
    helpText: "気づいたもの・心地よかったものを選んでください。"
  }),

  q(
    P_B,
    "Q8",
    "来店前に期待していた内容と比べて、今日のお買い物はいかがでしたか？（ひとつだけ）",
    "single_choice",
    8,
    {
      options: scale5(
        ["far_above", "期待を大きく上回った"],
        ["above", "期待を少し上回った"],
        ["as_expected", "期待通りだった"],
        ["below", "期待を少し下回った"],
        ["far_below", "期待を大きく下回った"]
      ),
      ...SLIDER
    }
  ),

  q(P_B, "Q9", "次回もこのお店を利用したいと思いますか？（ひとつだけ）", "single_choice", 9, {
    options: scale5(
      ["definitely", "とても利用したい"],
      ["probably", "やや利用したい"],
      ["undecided", "どちらともいえない・未定"],
      ["probably_not", "あまり利用したくない"],
      ["definitely_not", "まったく利用したくない"]
    ),
    ...SLIDER
  }),

  // ------------------------------------------------------------------
  // 未購入・一部購入者への設問（冒頭コメント2）
  // 「買えなかった」は小売で最も改善余地の大きい情報。ここを取らないと
  // 「満足度は高いのに売上が上がらない」店の理由が永久に分からない。
  // ------------------------------------------------------------------

  q(
    P_B,
    "Q10",
    "買わなかった（買えなかった）理由を教えてください（いくつでも）",
    "multi_choice",
    10,
    {
      options: opts(
        ["out_of_stock", "欲しいものが売り切れ・欠品していた"],
        ["not_carried", "欲しいものが置いていなかった"],
        ["no_size", "サイズ・色・種類が合わなかった"],
        ["too_expensive", "価格が高かった"],
        ["not_convinced", "品質・内容に納得できなかった"],
        ["could_not_find", "どこにあるか分からなかった"],
        ["no_help", "聞きたかったがスタッフに声をかけられなかった"],
        ["too_pushy", "接客がしつこく感じた"],
        ["checkout_queue", "レジが混んでいた"],
        ["just_looking", "もともと見るだけのつもりだった"],
        ["compare_first", "他店・ネットと比べてから決めたい"],
        ["no_time", "時間がなかった"],
        OTHER
      ),
      // 1項目ずつ◯✕で判定させたほうが取りこぼしが少ない。
      ...SORT_SWIPE
    },
    {
      visibility_conditions: [
        { type: "pipe_expression", expression: "q1=not_bought or q1=bought_partly" }
      ]
    }
  ),

  // B-Q11: 買えなかったものの具体名。品揃え・発注の改善に直結する唯一の生データ。
  q(
    P_B,
    "Q11",
    "買えなかったもの・探していたものがあれば教えてください",
    "free_text_long",
    11,
    {
      placeholder: "例）〇〇のMサイズ／〇〇というメーカーの商品",
      helpText: "商品名やジャンルだけでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        { type: "pipe_expression", expression: "q1=not_bought or q1=bought_partly" }
      ]
    }
  ),

  // B-Q12: 未購入者の代替行動。「買わなかった」の先が他店かネットかで打つ手が変わる。
  q(
    P_B,
    "Q12",
    "買えなかったものは、このあとどうする予定ですか？（ひとつだけ）",
    "single_choice",
    12,
    {
      options: opts(
        ["other_store", "別のお店で買う"],
        ["online", "ネット通販で買う"],
        ["come_again", "またこのお店に来て買う"],
        ["give_up", "買うのをやめる"],
        ["undecided", "決めていない"]
      )
    },
    {
      visibility_conditions: [
        { type: "pipe_expression", expression: "q1=not_bought or q1=bought_partly" }
      ]
    }
  ),

  q(
    P_B,
    "Q13",
    "今日のお買い物について、何か伝えたいことがあれば教えてください",
    "free_text_long",
    13,
    { helpText: "どんなことでも構いません。ご自由にお書きください。" },
    { is_required: false }
  ),

  q(
    P_B,
    "Q14",
    "こちらのサービスにご参加をしていただけますでしょうか。（ひとつだけ）",
    "single_choice",
    14,
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
    "前回のお買い物から時間が経ちましたが、購入した商品についてどう感じていますか？（ひとつだけ）",
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

  // C-Q2: 使ってみてよかった点。小売固有＝「買った瞬間の満足」と
  // 「使ってみた満足」がズレる業種なので、ここが本命の設問になる。
  q(
    P_C,
    "Q2",
    "実際に使ってみて、よかった点はありましたか？（いくつでも）",
    "multi_choice",
    2,
    {
      options: [
        ...opts(
          ["as_expected", "思っていたとおりのものだった"],
          ["good_quality", "品質が良かった・長く使えそう"],
          ["good_value", "価格以上の価値があった"],
          ["useful", "生活の中で役に立った・使う頻度が高い"],
          ["good_reputation", "家族や周囲から評判が良かった"],
          ["good_advice", "スタッフの提案・アドバイスが役に立った"],
          ["gift_liked", "贈った相手に喜ばれた"],
          ["better_than_online", "実物を見て買ってよかった"],
          OTHER
        ),
        exclusiveNone
      ],
      helpText: "前回のご来店内容に関するものだけ表示しています。",
      // 「本音」は1項目ずつ◯✕で判定させたほうが取りこぼしが少ない（後日回答＝急いでいない）。
      // 排他の「特になし」はデッキから自動で外れ、全部✕＝特になし相当になる。
      ...SORT_SWIPE
    },
    {
      // A-Q5 で該当する来店目的を選んでいない人には出さない（Migration 092）
      display_tags_parsed: { disableRules: purposeDisableRulesPositive() }
    }
  ),

  q(
    P_C,
    "Q3",
    "実際に使ってみて、あまり良くなかったところはありましたか？（いくつでも）",
    "multi_choice",
    3,
    {
      options: [
        ...opts(
          ["not_as_expected", "思っていたものと違った"],
          ["poor_quality", "品質が期待より低かった"],
          ["broke_early", "すぐに壊れた・傷んだ"],
          ["overpriced", "価格に見合わなかった"],
          ["not_used", "結局あまり使わなかった"],
          ["wrong_size", "サイズ・色が合わなかった"],
          ["cheaper_elsewhere", "後で他店・ネットの方が安いと知った"],
          ["bad_advice", "スタッフの提案が合っていなかった"],
          ["gift_disliked", "贈った相手の反応が良くなかった"],
          OTHER
        ),
        exclusiveNone
      ]
      // C-Q2 と連続で1枚ずつ振り分けさせると操作量が多すぎるため、後半のこちらは
      // chip_select（casual の複数選択の既定）で受ける。ネガ側の取りこぼしより
      // 全体の完走を優先する判断（サロン版と同じ）。
    },
    {
      display_tags_parsed: { disableRules: purposeDisableRulesNegative() }
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
      placeholder: "例）品質について、価格について、サイズについて、接客について",
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
    "前回の来店以降、同じような商品をどこかで購入しましたか？（ひとつだけ）",
    "single_choice",
    5,
    {
      options: opts(["yes", "はい（この店／別の店／ネット）"], ["no", "いいえ"]),
      helpText: "※どこで購入されたかは問いません。",
      ...SWIPE
    }
  ),

  // C-Q6: C-Q5=yes のときだけ。
  // ⚠ 小売は他業種と違い「ネット通販」が最大の競合になる。実店舗の選択肢しか
  //   用意しないと離脱先が見えず、改善の打ち手が店内改善に偏る。
  q(
    P_C,
    "Q6",
    "前回の来店以降、どちらで購入しましたか。（ひとつだけ）",
    "single_choice",
    6,
    {
      options: opts(
        ["same", `この${STORE_NAME}で再度購入した`],
        ["other_store", "別の実店舗で購入した"],
        ["online", "ネット通販で購入した"],
        ["both", `この${STORE_NAME}と他（別の店・ネット）の両方で購入した`]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=yes" }] }
  ),

  // C-Q7: C-Q5=no のときだけ
  q(
    P_C,
    "Q7",
    "今後、同じような商品はどちらで購入する予定ですか？（ひとつだけ）",
    "single_choice",
    7,
    {
      options: opts(
        ["same", "このお店で購入する予定"],
        ["other_store", "別の実店舗で購入する予定"],
        ["online", "ネット通販で購入する予定"],
        ["undecided", "検討中・考えていない"]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=no" }] }
  ),

  // C-Q8: リピート要因（Q6=same/both もしくは Q7=same）
  q(
    P_C,
    "Q8",
    "またこのお店を利用した（したいと思う）理由を教えてください（いくつでも）",
    "multi_choice",
    8,
    {
      options: opts(
        ["lineup", "品揃えが良い"],
        ["stock", "欲しいものがいつも置いてある"],
        ["price", "価格に納得できる"],
        ["quality", "商品の品質が良い"],
        ["staff", "スタッフの接客・商品知識が良い"],
        ["no_pressure", "声をかけられず、自分のペースで見られる"],
        ["findability", "欲しいものが見つけやすい"],
        ["checkout", "レジが早い・待たない"],
        ["atmosphere", "お店の雰囲気・居心地が良い"],
        ["access", "通いやすい（場所・アクセス）"],
        ["see_in_person", "実物を見て買えるのが良い"],
        ["point_card", "ポイント・会員特典がある"],
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

  // C-Q9: 離反要因（Q6=other_store/online/both もしくは Q7=other_store/online）
  // ⚠ ネット通販に流れた理由（price_online / convenience_online）が無いと、
  //   離脱理由が全部「価格」「距離」に流れ込んで真因が消える。
  q(
    P_C,
    "Q9",
    "別のお店・ネットで購入した（する予定の）理由を教えてください（いくつでも）",
    "multi_choice",
    9,
    {
      options: opts(
        ["out_of_stock", "欲しいものが在庫としてなかった"],
        ["not_carried", "欲しいものを置いていなかった"],
        ["price_online", "他店・ネットの方が安かった"],
        ["convenience_online", "ネットの方が手間がかからない（届く・24時間）"],
        ["more_lineup", "他店の方が品揃えが良かった"],
        ["unsatisfied_quality", "前回買ったものの品質に満足できなかった"],
        ["bad_service", "接客が合わなかった"],
        ["too_pushy", "接客がしつこく感じた"],
        ["hard_to_find", "売場が分かりにくかった"],
        ["checkout_queue", "レジが混んでいた"],
        ["access", "場所・アクセスが良くなかった"],
        ["hours", "営業時間が合わなかった"],
        ["try_other", "他店を試してみたかった"],
        ["recommended", "家族・友人に勧められた"],
        ["coupon", "別の店でクーポン・セールがあったから"],
        ["moved", "引っ越し等で物理的に行けなくなったから"],
        ["no_reason", "特に理由はなく、たまたま別のお店を利用した"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression: "q6=other_store or q6=online or q6=both or q7=other_store or q7=online"
        }
      ]
    }
  ),

  // C-Q10: 別店・ネット利用 or 未定の人にだけ改善期待を聞く
  q(
    P_C,
    "Q10",
    "今後、このお店に期待することがあれば教えてください",
    "free_text_long",
    10,
    {
      placeholder: "例）品揃えについて、価格について、売場について、接客について",
      helpText:
        "今後、どんなところが改善すればこのお店を再度利用すると思いますか。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression:
            "q6=other_store or q6=online or q6=both or q7=other_store or q7=online or q7=undecided"
        }
      ]
      // お礼は projects.completion_message（送信完了画面）へ移した (Migration 108)。
    }
  )
];

/**
 * A-Q5（来店目的）で選ばれていない目的に紐づく選択肢を落とす（C-Q2 用）。
 * disableRules の condition は pipe 式。`a:q5` は Migration 092 の名前空間付き参照。
 */
function purposeDisableRulesPositive() {
  return [
    // 贈り物目的でなければ「贈った相手に喜ばれた」は意味をなさない
    { targetChoice: "gift_liked", condition: "not a:q5 includes gift" },
    // スタッフに相談していない人に提案の評価は聞けない
    { targetChoice: "good_advice", condition: "not a:q5 includes consult" },
    // 実物確認が目的でなければ「実物を見て買ってよかった」は響かない
    { targetChoice: "better_than_online", condition: "not a:q5 includes compare" }
  ];
}

/** C-Q3 用（ネガ側）。 */
function purposeDisableRulesNegative() {
  return [
    { targetChoice: "gift_disliked", condition: "not a:q5 includes gift" },
    { targetChoice: "bad_advice", condition: "not a:q5 includes consult" }
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
