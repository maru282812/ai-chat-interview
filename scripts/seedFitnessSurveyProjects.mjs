/**
 * seedFitnessSurveyProjects.mjs
 *
 * フィットネス（ジム・スタジオ）向け 店舗専用アンケート A / B / C の3案件を冪等投入する。
 * 美容室版（seedSalonSurveyProjects.mjs）・飲食版（seedRestaurantSurveyProjects.mjs）の
 * 構造を踏襲し、業種固有の「頻度・評価項目・設問文」を差し替えている。
 *
 *   A: 来館すぐアンケート （受付・着替え前のQR） entry_code=yotto-fitness-a
 *   B: 運動後アンケート   （トレーニング直後）   entry_code=yotto-fitness-b
 *   C: 本音アンケート     （後日・A-Q9基準）     entry_code=yotto-fitness-c
 *
 * 【他業種との違い（設計判断）】
 *
 * 1. 「1回の満足」ではなく「続けられるか」を測る業種
 *    サロン・飲食・小売は1回の体験で満足が決まるが、フィットネスは
 *    「今日のトレーニングは満足」でも退会する（＝続かない）。逆に
 *    「今日はしんどかった」でも継続する。1回の満足度と継続意向が相関しない。
 *    そのため B-Q9 に「次回いつ来る予定か」を置き、C では「継続できたか」＝
 *    実際の来館頻度の変化を主軸にする（冒頭コメント5）。
 *    ⚠ ここを他業種と同じ「再来店したか」の二値にすると、会員制ゆえ
 *      ほぼ全員が「来た」になり離脱が一切検出できない。
 *
 * 2. 評価項目（ASPECTS）の最大因子は「設備の空き」と「清潔感」
 *    サロンの finish（仕上がり）・小売の lineup（品揃え）に相当するのが
 *    equipment_availability（使いたいマシンが空いているか）。フィットネスの
 *    退会理由で最上位に来る「混雑」を、感覚ではなく項目として取る。
 *    加えて cleanliness（清潔感）/ locker（更衣室・シャワー）/ crowding（混雑）を入れ、
 *    サロン固有の施術系（skill / finish / care）は落とした。
 *
 * 3. 「担当者」ではなくスタッフ全体＋トレーナーを分けて見る
 *    パーソナル利用とフリー利用が同じ施設に混在し、パーソナルは担当者との相性が
 *    継続を決めるがフリー利用者にはトレーナーとの接点がほぼ無い。
 *    A-Q5（今日の利用内容）でパーソナル利用を取り、C-Q2/C-Q3 の
 *    トレーナー関連選択肢は disableRules でフリー利用者から落とす。
 *
 * 4. 身体情報・既往症は取らない
 *    ⚠ 重要。体重・体脂肪率・既往症・服薬は個人情報保護法上の要配慮個人情報
 *      （病歴）に該当しうるうえ、取得すれば利用目的の縛りと安全管理義務が乗る。
 *      満足度調査に必要な情報ではないため設問として置かない。
 *      A-Q8（伝えたいこと）は自由記述なので体調が書かれうるが、これは
 *      「本人が自発的に書いたもの」であり、設問として体系的に収集するのとは
 *      扱いが違う。それでも運用側で内容を確認できる状態を保つこと。
 *    ⚠ 「今日の目的」は目標（痩せたい等）ではなく行動（何をするか）で聞く。
 *      ダイエット目的を体系収集すると健康情報の取得に近づく。
 *
 * 5. 来館頻度の刻みは「週あたり」で取る
 *    サロン・ネイルは「〇週間に1回」だがフィットネスは「週〇回」が生活単位。
 *    しかも継続の判定に使うため、A（入会時点の想定頻度）と C（実際の頻度）を
 *    同じ刻みで聞いて差分を見る。
 *    日数表は industry_templates 側（seedFitnessIndustryTemplate.mjs）に持つ。
 *
 * 6. 声かけ・トレーニング中の干渉の希望を A で聞いて即時開示する
 *    サロンの A-Q12（会話量）に相当する。フィットネスでは「集中したい人に
 *    話しかける」「フォームを直されたくない人に指導する」が不満要因になり、
 *    しかもトレーニング前に届かないと意味がない。
 *    選択式なので集計のみ・timing=immediate で店舗へ開示する。
 *    画面の helpText と share_with_store.notice を必ず一致させること（利用規約 第9条3項）。
 *
 * すべて visibility_type=private_store なので「探す」一覧には出ない。
 *
 * 【回答UI】サロン版と同じく案件全体を casual にしている。詳細は
 * seedSalonSurveyProjects.mjs の冒頭コメントを参照。
 *
 * 【選択肢の持ち越し（carry-forward）】
 *   同一案件内 : B-Q3 ← B-Q2 / B-Q5 ← B-Q4
 *   別案件から : C-Q2, C-Q3 ← A-Q5（今日の利用内容） ※Migration 092
 *   持ち越しは value 一致で絞るため、参照元と参照先の value を必ず揃えること。
 *
 * Usage:
 *   node scripts/seedFitnessSurveyProjects.mjs
 *   node scripts/seedFitnessSurveyProjects.mjs --cleanup
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

// 美容室（5a10c0xx…）・ネイル（4a11c0xx…）・飲食（ae54c0xx…）・鍼灸（ac00c0xx…）・
// 小売（5e11c0xx…）と衝突しない別系列。
// ⚠ UUID は16進のみ。"fitness" を字面で入れたくなるが t/n/s は hex ではないため
//   Postgres の uuid 型で弾かれる（f17e = "fit" の見立て）。
const P_A = "f17ec001-0000-4000-8000-000000000001";
const P_B = "f17ec002-0000-4000-8000-000000000002";
const P_C = "f17ec003-0000-4000-8000-000000000003";

/** 店舗名は案件ごとに差し替える想定（店舗追加時に storeProvisioningService が置換する）。 */
const STORE_NAME = "●●ジム";

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
    name: `【${STORE_NAME}】A：来館すぐアンケート`,
    objective: "どんな会員が、何をしに今日来館しているのかを把握する",
    reward_points: 5,
    estimated_minutes: 1,
    entry_code: "yotto-fitness-a",
    completion_message: "ご協力ありがとうございました。続きは運動のあとにお答えください。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_B,
    name: `【${STORE_NAME}】B：運動後アンケート`,
    objective: "トレーニング直後の満足度を項目別に把握する（本調査のメイン）",
    reward_points: 5,
    estimated_minutes: 2,
    entry_code: "yotto-fitness-b",
    completion_message:
      "ご協力ありがとうございました。後日、最後のアンケートをお送りしますので、そちらもどうぞよろしくお願いいたします。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_C,
    name: `【${STORE_NAME}】C：本音アンケート`,
    objective: "時間経過後に「続けられているか」と、継続・退会の理由を把握する",
    reward_points: 10,
    estimated_minutes: 2,
    entry_code: "yotto-fitness-c",
    completion_message:
      "ご協力ありがとうございました。引き続きアンケートサイトHibiをどうぞよろしくお願いいたします。",
    // C-Q2 / C-Q3 の選択肢を A-Q5（今日の利用内容）で絞るための宣言（Migration 092）
    carry_forward_sources: [{ namespace: "a", entry_code: "yotto-fitness-a" }]
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
 * A-Q7 / A-Q8 の告知文。
 * 回答画面の helpText と share_with_store.notice を必ず同一にする。
 * 利用規約 第9条3項が「回答画面上であらかじめ明示したうえで」を開示条件に
 * しているため、画面に出した文言と根拠がズレると説明がつかなくなる。
 */
const A_Q7_NOTICE =
  "この設問のみスタッフが確認いたします。ご希望はいつでも変えていただけます。";
const A_Q8_NOTICE = "この設問のみスタッフが確認いたします。";

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
 * 来館頻度の選択肢。A-Q9（入会時点の想定・実績）と C-Q5（実際の頻度）で共有する。
 * 同じ刻みで2回聞いて差分を取ることで「続けられているか」を測る（冒頭コメント5）。
 *
 * ⚠ value は seedFitnessIndustryTemplate.mjs の日数表キーと1対1で揃えること。
 *   片方だけ変えると頻度が引けず、C の送付日が undecided_days に落ちる。
 * ⚠ C-Q5 側には「行かなくなった」を足す（A には存在しない状態）。
 *   これを日数表に入れてはいけない（頻度ではなく結果なので送付日計算に使わない）。
 */
const FREQUENCY = [
  ["four_plus", "週に4回以上"],
  ["three", "週に3回くらい"],
  ["twice", "週に2回くらい"],
  ["once", "週に1回くらい"],
  ["biweekly", "2週間に1回くらい"],
  ["monthly", "月に1回くらい、またはそれ以下"]
];

/**
 * 満足度の評価項目10件。A-Q6（重視項目）と B-Q2/B-Q3/B-Q4 で value を共有する。
 * ここを揃えておくことで carry-forward が value 一致で成立する。
 *
 * フィットネス固有として入れたもの:
 *   + equipment_availability 使いたいマシンが空いているか（退会理由の最上位＝混雑）
 *   + equipment_variety      マシン・器具の種類
 *   + locker                 更衣室・シャワーの使いやすさ
 *   + cleanliness            清潔感（フィットネスでは汗・臭いが直結する）
 *   + trainer                トレーナーの指導・アドバイス
 * サロン・飲食から落としたもの:
 *   - skill / finish / care  施術系＝フィットネスに存在しない
 *   - taste / lineup         飲食・小売固有
 */
const ASPECTS = [
  ["equipment_availability", "使いたいマシンや器具が空いているか"],
  ["equipment_variety", "マシン・器具の種類の豊富さ"],
  ["cleanliness", "館内の清潔感（マシン・床・タオルなど）"],
  ["locker", "更衣室・シャワーの使いやすさ"],
  ["trainer", "トレーナーの指導・アドバイス"],
  ["staff", "スタッフの接客・対応"],
  ["program", "レッスン・プログラムの内容"],
  ["hours", "営業時間の使いやすさ"],
  ["space", "館内の広さ・混雑のなさ"],
  ["price", "料金への納得感"]
];

/** A-Q6 は「マシンの空き」を含む（来館時点で最も気にする項目なので落とさない）。 */
const A_ASPECTS = ASPECTS;

const OTHER = ["other", "その他"];

/** 「特になし」は他と同時に選べない排他選択肢にする。 */
const exclusiveNone = { value: "none", label: "特になし", exclusive: true };

// ------------------------------------------------------------------
// A: 来館すぐアンケート
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
        "アンケートは運動の前、運動のあと、その後の継続状況の確認の３つを予定しております。各１分程度の長さです。",
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

  // A-Q4: 会員歴。フィットネスは「入会3か月の壁」があり、継続率は在籍期間で
  // まったく違う。1回の来館回数ではなく在籍期間で聞く（サロンの来店回数に相当）。
  q(P_A, "Q4", "この施設をご利用になってどのくらいですか？（ひとつだけ）", "single_choice", 4, {
    options: opts(
      ["trial", "今日が初めて（体験・見学）"],
      ["under_1m", "1か月未満"],
      ["under_3m", "1〜3か月"],
      ["under_1y", "3か月〜1年"],
      ["over_1y", "1年以上"]
    )
  }),

  // A-Q5: C-Q2 / C-Q3 の選択肢を絞る基準（Migration 092）。
  // ⚠ ここの value を変えたら C の disableRules も必ず揃えること。
  // ⚠ 目標（痩せたい等）ではなく行動（何をするか）で聞く。ダイエット目的を
  //   体系収集すると健康情報の取得に近づく（冒頭コメント4）。
  q(P_A, "Q5", "今日は何をする予定ですか？（いくつでも）", "multi_choice", 5, {
    options: opts(
      ["machine", "マシントレーニング"],
      ["free_weight", "フリーウェイト（ダンベル・バーベル）"],
      ["cardio", "ランニング・バイクなどの有酸素運動"],
      ["studio", "スタジオレッスンに参加"],
      ["personal", "パーソナルトレーニング（トレーナーの指導あり）"],
      ["pool", "プール・水中運動"],
      ["stretch", "ストレッチ・体をほぐす"],
      ["sauna", "サウナ・お風呂だけ利用"],
      OTHER
    )
  }),

  q(P_A, "Q6", "この施設を選ぶうえで重視していることは何ですか？（いくつでも）", "multi_choice", 6, {
    options: opts(...A_ASPECTS, OTHER)
  }),

  // A-Q7: トレーニング中の干渉の希望。フィットネスでは「集中したい人に話しかける」
  // 「フォームを直されたくない人に指導する」が不満要因で、しかも運動前に
  // 届かないと意味がない（冒頭コメント6）。
  q(
    P_A,
    "Q7",
    "今日はスタッフから声をかけてもよいですか？（ひとつだけ）",
    "single_choice",
    7,
    {
      options: opts(
        ["welcome", "ぜひ声をかけてほしい（教えてほしい）"],
        ["form_check", "フォームが崩れているときだけ教えてほしい"],
        ["only_if_asked", "こちらから聞くまでは声をかけないでほしい"],
        ["quiet", "ひとりで集中したい"]
      ),
      helpText: A_Q7_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。選択式なので集計のみ。
      // notice は helpText と同一にする。回答画面に出した文言そのものが
      // 開示の根拠になるため、ズレると規約上の説明がつかなくなる。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "aggregate",
          timing: "immediate",
          notice: A_Q7_NOTICE
        }
      }
    }
  ),

  q(
    P_A,
    "Q8",
    "今日のトレーニングについて、スタッフに伝えたいことはありますか？",
    "free_text_long",
    8,
    {
      placeholder: "例）新しいマシンの使い方を教えてほしいです。／今日は軽めにしたいです。",
      helpText: A_Q8_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。運動前に読めないと意味がないので原文・即時。
      // ⚠ 自由記述なので何が書かれるか制御できない。体調や既往症など要配慮情報が
      //   混入し得るため、運用側で内容を確認できる状態を保つこと（冒頭コメント4）。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "verbatim",
          timing: "immediate",
          notice: A_Q8_NOTICE
        }
      }
    },
    { is_required: false }
  ),

  // A-Q9: 離脱判定の基準。industry_templates.frequency_question_code=Q9 と対応する。
  // ⚠ C-Q5 と同じ刻みで聞くこと。差分が「続けられているか」の主指標になる
  //   （冒頭コメント1・5）。
  // ⚠ ここの value を変えたら seedFitnessIndustryTemplate.mjs の日数表も必ず揃えること。
  //   片方だけ直すと頻度が引けず、C の送付日が undecided 扱いに落ちる。
  q(P_A, "Q9", "普段どのくらいの頻度でこの施設を利用していますか？（ひとつだけ）", "single_choice", 9, {
    options: opts(...FREQUENCY, ["undecided", "特に決まっていない"]),
    helpText: "この回答をもとに、後日のアンケート（C）をお送りする時期を決めます。"
  }),

  // お礼は projects.completion_message（送信完了画面）へ。comment_bottom は
  // 設問の下＝送信「前」に出てしまうため使わない (Migration 108)。
  q(
    P_A,
    "Q10",
    "今日のご利用は、いつもと比べてどのような日ですか？（ひとつだけ）",
    "single_choice",
    10,
    {
      // 「今日が特別な日か」を押さえないと、B の満足度が「今日だけの事情」で
      // 上下したのか施設の実力なのか切り分けられない。
      options: opts(
        ["usual", "いつもと同じ"],
        ["after_gap", "しばらく来られていなかった（久しぶり）"],
        ["busy_time", "いつもより混んでいる時間に来た"],
        ["quiet_time", "いつもより空いている時間に来た"],
        ["first_time", "今日が初めて"]
      )
    }
  )
];

// ------------------------------------------------------------------
// B: 運動後アンケート
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
        "本日のご利用ありがとうございました。1〜2分程度のお客様の満足度確認アンケートにご協力ください。\n" +
        "このアンケートの回答は、個人を特定されない形で集計・分析いたしますので、正直な感想・意見をご自由にお書きください。\n" +
        "良いところ、改善してほしいところがあれば、遠慮なくお答えください。"
    }
  ),

  // B-Q2: 項目×5段階のマトリクス（SAMTX）。
  // ⚠ matrix_single は 1行=1画面で出る（survey.ejs）。行を足すと画面数がそのまま増える。
  //   館内環境（BGM・照明・空調・臭い）はここに入れず B-Q7 で「気づかれたか」として聞く。
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
      options: [...opts(...ASPECTS, ["atmosphere", "館内の雰囲気・居心地"], OTHER), exclusiveNone]
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
      placeholder: "例）マシンの空き状況について、更衣室について、料金について、指導についてなど",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q4 includes none" }]
    }
  ),

  // B-Q6: 混雑の実測。ASPECTS の equipment_availability を5段階で聞くだけでは
  // 「何が待たされたか」が分からず、設備投資の判断材料にならない。
  q(P_B, "Q6", "今日、待ったり使えなかったものはありますか？（いくつでも）", "multi_choice", 6, {
    options: [
      ...opts(
        ["machine", "使いたいマシン"],
        ["free_weight", "フリーウェイト・ラック"],
        ["cardio", "ランニングマシン・バイク"],
        ["studio", "スタジオレッスン（定員・予約）"],
        ["locker", "ロッカー"],
        ["shower", "シャワー"],
        ["powder", "洗面・パウダールーム"],
        ["sauna", "サウナ・お風呂"],
        ["parking", "駐車場・駐輪場"],
        OTHER
      ),
      exclusiveNone
    ],
    helpText: "待ち時間が発生したもの、混雑で使えなかったものを選んでください。"
  }),

  // B-Q7: 館内の環境。満足度5段階ではなく「気づかれたか」を聞く。
  // BGM・照明・空調は満足度では動かない（ほぼ全員が「やや満足」に寄る）が、
  // 気づかれた／気づかれなかったは店側の投資判断に直結する。
  q(P_B, "Q7", "館内の環境で、心地よかったものはありますか？（いくつでも）", "multi_choice", 7, {
    options: [
      ...opts(
        ["bgm", "BGM・音の大きさ"],
        ["lighting", "照明の明るさ・色味"],
        ["temperature", "空調の快適さ"],
        ["air", "空気のこもりのなさ・臭いのなさ"],
        ["towel", "タオル・備品の清潔さ"],
        ["amenity", "アメニティの充実（シャンプー・ドライヤーなど）"],
        ["water", "給水機・ドリンクの用意"],
        ["mirror", "鏡・フォーム確認のしやすさ"],
        ["rest", "休憩スペース・椅子"],
        ["interior", "内装・雰囲気"],
        OTHER
      ),
      exclusiveNone
    ],
    helpText: "気づいたもの・心地よかったものを選んでください。"
  }),

  q(
    P_B,
    "Q8",
    "来館前に思っていた内容と比べて、今日のトレーニングはいかがでしたか？（ひとつだけ）",
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

  // B-Q9: 継続意向を「気持ち」ではなく「次回の予定」で聞く（冒頭コメント1）。
  // 「また来たい」は全員が肯定するため差がつかないが、「次はいつ来るか」は
  // 実際の継続率とよく相関し、しかも C での実績と突き合わせられる。
  q(P_B, "Q9", "次にこの施設に来る予定はいつごろですか？（ひとつだけ）", "single_choice", 9, {
    options: opts(
      ["tomorrow", "明日・明後日"],
      ["this_week", "今週のうちに"],
      ["next_week", "来週"],
      ["this_month", "今月のうちに"],
      ["undecided", "まだ決めていない"],
      ["no_plan", "しばらく来る予定はない"]
    ),
    ...SLIDER
  }),

  q(
    P_B,
    "Q10",
    "今日のご利用について、何か伝えたいことがあれば教えてください",
    "free_text_long",
    10,
    { helpText: "どんなことでも構いません。ご自由にお書きください。" },
    { is_required: false }
  ),

  q(
    P_B,
    "Q11",
    "こちらのサービスにご参加をしていただけますでしょうか。（ひとつだけ）",
    "single_choice",
    11,
    // Hibi への転換点。ここまでのスワイプ体験の延長で「ポイ活も同じ操作」と伝える
    { options: opts(["yes", "はい"], ["no", "いいえ"]), ...SWIPE },
    {
      comment_top:
        "アンケート調査を行っているYOTTOではこの施設の満足度アンケートのほかにも、簡単なアンケート（ポイ活）を行っております。\n" +
        "アンケートにご回答いただければ換金可能なポイントをお送りしております。（１pt＝1円）初回換金目安：約１週間程度"
    }
  )
];

// ------------------------------------------------------------------
// C: 本音アンケート
//
// フィットネスの C は他業種と主軸が違う。「再来店したか」ではなく
// 「続けられているか」＝来館頻度が A-Q9 から落ちていないかを見る（冒頭コメント1）。
// ------------------------------------------------------------------

const questionsC = [
  q(
    P_C,
    "Q1",
    "前回のご利用から時間が経ちましたが、今この施設の利用についてどう感じていますか？（ひとつだけ）",
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

  // C-Q2: 続けてみてよかった点。フィットネス固有＝「1回の満足」ではなく
  // 「継続して得られたもの」を聞く。ここが継続要因の本命データになる。
  q(
    P_C,
    "Q2",
    "続けてみて、よかったと感じたことはありましたか？（いくつでも）",
    "multi_choice",
    2,
    {
      options: [
        ...opts(
          ["habit", "運動する習慣がついた"],
          ["body_change", "体の変化を感じた"],
          ["condition", "体調・睡眠が良くなった"],
          ["refresh", "気分転換・ストレス解消になった"],
          ["easy_to_go", "通いやすく、無理なく続けられた"],
          ["trainer_support", "トレーナーの指導が役に立った"],
          ["program_fun", "レッスン・プログラムが楽しかった"],
          ["community", "同じ時間帯の人やスタッフとの関わりが心地よかった"],
          ["sauna_relax", "サウナ・お風呂でリラックスできた"],
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
      // A-Q5 で該当する利用内容を選んでいない人には出さない（Migration 092）
      display_tags_parsed: { disableRules: usageDisableRulesPositive() }
    }
  ),

  q(
    P_C,
    "Q3",
    "反対に、続けるうえで負担に感じたことはありましたか？（いくつでも）",
    "multi_choice",
    3,
    {
      options: [
        ...opts(
          ["too_crowded", "混んでいて思うように使えなかった"],
          ["no_time", "時間が取れなかった"],
          ["too_far", "通うのが負担だった（距離・時間）"],
          ["no_result", "変化を感じられなかった"],
          ["no_motivation", "やる気が続かなかった"],
          ["dont_know_how", "何をすればよいか分からなかった"],
          ["too_expensive", "料金の負担が大きかった"],
          ["locker_crowded", "更衣室・シャワーが混んでいた"],
          ["trainer_mismatch", "トレーナーの指導が合わなかった"],
          ["program_mismatch", "レッスンの内容・時間帯が合わなかった"],
          ["atmosphere_mismatch", "館内の雰囲気が合わなかった"],
          ["body_pain", "体に負担を感じた"],
          OTHER
        ),
        exclusiveNone
      ]
      // C-Q2 と連続で1枚ずつ振り分けさせると操作量が多すぎるため、後半のこちらは
      // chip_select（casual の複数選択の既定）で受ける。ネガ側の取りこぼしより
      // 全体の完走を優先する判断（サロン版と同じ）。
    },
    {
      display_tags_parsed: { disableRules: usageDisableRulesNegative() }
    }
  ),

  // C-Q4: C-Q3 で「特になし」ならスキップ
  q(
    P_C,
    "Q4",
    "負担に感じたとお答えいただいた内容を具体的にお答えください。",
    "free_text_long",
    4,
    {
      placeholder: "例）混雑について、料金について、指導について、通いやすさについて",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q3 includes none" }]
    }
  ),

  // C-Q5: 継続判定の主軸。A-Q9 と同じ刻みで聞いて差分を取る（冒頭コメント1・5）。
  // ⚠ ここを「利用したか」の二値にすると、会員制ゆえほぼ全員が「した」になり
  //   離脱が一切検出できない。頻度の低下こそが離脱の前兆である。
  q(
    P_C,
    "Q5",
    "最近は、どのくらいの頻度でこの施設を利用していますか？（ひとつだけ）",
    "single_choice",
    5,
    {
      options: opts(...FREQUENCY, ["stopped", "行かなくなった・退会した"]),
      helpText: "※前回お答えいただいた頻度と比べるために伺っています。"
    }
  ),

  // C-Q6: 頻度が落ちた／行かなくなった人にだけ理由を聞く。
  // ⚠ ここが実質の退会理由データ。B では絶対に取れない（施設内で「辞めます」とは書かない）。
  q(
    P_C,
    "Q6",
    "利用の頻度が減った（行かなくなった）理由を教えてください（いくつでも）",
    "multi_choice",
    6,
    {
      options: opts(
        ["too_crowded", "混んでいて思うように使えない"],
        ["no_time", "仕事や生活が忙しくなった"],
        ["too_far", "通うのが負担になった"],
        ["no_result", "続けても変化を感じられなかった"],
        ["no_motivation", "やる気が続かなかった"],
        ["dont_know_how", "何をすればよいか分からなくなった"],
        ["too_expensive", "料金の負担が大きい"],
        ["facility_issue", "設備・清潔さに不満があった"],
        ["trainer_mismatch", "トレーナー・スタッフとの相性が合わなかった"],
        ["atmosphere_mismatch", "館内の雰囲気が合わなかった"],
        ["other_gym", "別のジム・運動に移った"],
        ["home_workout", "自宅での運動に切り替えた"],
        ["injury", "体調・けがのため"],
        ["moved", "引っ越し等で通えなくなった"],
        OTHER
      ),
      ...SORT_SWIPE
    },
    {
      // 頻度が「行かなくなった」または月1以下＝実質の離脱層
      visibility_conditions: [
        { type: "pipe_expression", expression: "q5=stopped or q5=monthly or q5=biweekly" }
      ]
    }
  ),

  // C-Q7: 継続できている人にだけ理由を聞く。
  q(
    P_C,
    "Q7",
    "続けられている理由を教えてください（いくつでも）",
    "multi_choice",
    7,
    {
      options: opts(
        ["habit", "習慣になった"],
        ["body_change", "体の変化を感じる"],
        ["condition", "体調が良くなった"],
        ["refresh", "気分転換になる"],
        ["access", "通いやすい（場所・営業時間）"],
        ["equipment_availability", "使いたいマシンが待たずに使える"],
        ["clean", "館内がきれいで気持ちよく使える"],
        ["trainer", "トレーナーの指導が良い"],
        ["program", "レッスン・プログラムが良い"],
        ["staff", "スタッフの対応が良い"],
        ["atmosphere", "館内の雰囲気・居心地が良い"],
        ["price", "料金に納得している"],
        ["community", "知り合い・仲間ができた"],
        ["sunk_cost", "会費を払っているので行かないと損だから"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression: "q5=four_plus or q5=three or q5=twice or q5=once"
        }
      ]
    }
  ),

  // C-Q8: 改善期待。離脱層・頻度低下層にだけ聞く。
  q(
    P_C,
    "Q8",
    "今後、この施設に期待することがあれば教えてください",
    "free_text_long",
    8,
    {
      placeholder: "例）混雑について、料金について、設備について、指導について",
      helpText:
        "今後、どんなところが改善すればもっと通いたいと思いますか。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        { type: "pipe_expression", expression: "q5=stopped or q5=monthly or q5=biweekly" }
      ]
      // お礼は projects.completion_message（送信完了画面）へ移した (Migration 108)。
    }
  )
];

/**
 * A-Q5（今日の利用内容）で選ばれていない内容に紐づく選択肢を落とす（C-Q2 用）。
 * disableRules の condition は pipe 式。`a:q5` は Migration 092 の名前空間付き参照。
 */
function usageDisableRulesPositive() {
  return [
    // パーソナル利用でなければトレーナーの指導は評価できない（冒頭コメント3）
    { targetChoice: "trainer_support", condition: "not a:q5 includes personal" },
    // スタジオレッスンに出ていない人にプログラムの感想は聞けない
    { targetChoice: "program_fun", condition: "not a:q5 includes studio" },
    // サウナ・風呂を使っていない人に「リラックスできた」は出さない
    { targetChoice: "sauna_relax", condition: "not a:q5 includes sauna" }
  ];
}

/** C-Q3 用（ネガ側）。 */
function usageDisableRulesNegative() {
  return [
    { targetChoice: "trainer_mismatch", condition: "not a:q5 includes personal" },
    { targetChoice: "program_mismatch", condition: "not a:q5 includes studio" }
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
