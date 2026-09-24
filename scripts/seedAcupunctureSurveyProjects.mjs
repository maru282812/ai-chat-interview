/**
 * seedAcupunctureSurveyProjects.mjs
 *
 * 鍼灸院向け 店舗専用アンケート A / B / C の3案件を冪等投入する。
 * 美容室版（seedSalonSurveyProjects.mjs）・ネイル版・飲食版の構造を踏襲し、
 * 業種固有の「頻度・評価項目・設問文」を差し替えている。
 *
 *   A: 来院すぐアンケート （QR流入・施術前）   entry_code=yotto-acu-a
 *   B: 施術後アンケート   （施術直後）         entry_code=yotto-acu-b
 *   C: 本音アンケート     （後日・A-Q11基準）  entry_code=yotto-acu-c
 *
 * 【⚠ 広告規制 — この業種だけの最重要制約】
 *
 * あん摩マツサージ指圧師、はり師、きゆう師等に関する法律 第7条は、施術所が
 * 広告できる事項を**限定列挙**しており、効能・効果の広告を認めていない。
 * （柔道整復師法 第24条も同趣旨。医療広告ガイドラインの体系とは別建て）
 *
 * したがってこの調査は次の前提で設計している:
 *   1. 設問文で医療効果を断定しない。「治った」「改善した」ではなく
 *      **「らくになった実感」「続いた期間」**という主観の言い方で聞く
 *   2. 集計結果は**院内の改善判断のため**に使う。店頭掲示・SNS・チラシ等へ
 *      「◯%が改善」と転用すると広告規制に触れ得る
 *   3. 店舗開示は**集計のみ**（mode=aggregate）。個票の症状を院へ返さない
 *   4. 症状そのものは要配慮個人情報（病歴に準じる）に当たり得るため、
 *      A-Q5 は部位レベルに留め、傷病名を書かせる自由記述を置かない
 *
 * ⚠ ここを緩めるとき（例: 広告に使いたいと言われたとき）は必ず弁護士確認を挟む。
 *   運用側の判断で設問文だけ変えてよい話ではない。
 *
 * 【サロン・飲食との違い（設計判断）】
 *
 * 1. 「1回で終わらない」— 通院計画そのものが調査対象
 *    サロン/飲食は1回の来店で体験が完結するが、鍼灸は複数回の通院を前提に
 *    施術者が計画を提示する。**計画が伝わっているかどうか**が離脱の最大要因で、
 *    「効かなかったから来ない」より「次いつ来ればいいか分からないまま終わった」
 *    が実際には多い。A-Q13 / B-Q9 / C-Q8・Q9 がこの軸で繋がっている。
 *
 * 2. 評価項目（ASPECTS）に「説明」と「問診」を入れた
 *    体に鍼を刺す以上、納得感がそのまま満足度になる。サロンの finish に当たる
 *    relief（らくになった実感）と並んで explanation / interview が主要因子。
 *
 * 3. 「痛み・熱さへの配慮」を独立で聞く（B-Q8）
 *    初回離脱の実務的な主因。怖さ・痛さは満足度5段階には現れにくく
 *    （我慢した人も「やや満足」を選ぶ）、項目として分けないと拾えない。
 *
 * 4. C は「効果の持続期間」を聞く（この業種の核心）
 *    B の直後は誰でもらくになる。**それが何日もったか**が再来院を決めるので、
 *    C-Q2 に持続期間を置いた。ここがサロンの「もち」に相当する。
 *
 * 5. 来院頻度は「週1〜月1」に密度を寄せた
 *    急性期は週1〜2回、維持期は月1回という通い方が典型。飲食のような
 *    半年スパンは取らず、代わりに短期側の刻みを細かくしている。
 *
 * すべて visibility_type=private_store なので「探す」一覧には出ない。
 *
 * 【回答UI】サロン版と同じく案件全体を casual にしている。詳細は
 * seedSalonSurveyProjects.mjs の冒頭コメントを参照。
 *
 * 【選択肢の持ち越し（carry-forward）】
 *   同一案件内 : A-Q10 ← A-Q9 / B-Q3 ← B-Q2 / B-Q5 ← B-Q4
 *   別案件から : C-Q2, C-Q3 ← A-Q5（今日の主訴部位） ※Migration 092
 *   持ち越しは value 一致で絞るため、参照元と参照先の value を必ず揃えること。
 *
 * Usage:
 *   node scripts/seedAcupunctureSurveyProjects.mjs
 *   node scripts/seedAcupunctureSurveyProjects.mjs --cleanup
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

// 美容室（5a10c0xx…）・ネイル（4a11c0xx…）・飲食（ae54c0xx…）と衝突しない別系列。
// ⚠ UUID は16進のみ。"acu" を字面で入れたくなるが u は hex ではないため
//   Postgres の uuid 型で弾かれる（ac00 = "acu" の見立て）。
const P_A = "ac00c001-0000-4000-8000-000000000001";
const P_B = "ac00c002-0000-4000-8000-000000000002";
const P_C = "ac00c003-0000-4000-8000-000000000003";

/** 院名は案件ごとに差し替える想定（店舗追加時に storeProvisioningService が置換する）。 */
const STORE_NAME = "●●鍼灸院";

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
    name: `【${STORE_NAME}】A：来院すぐアンケート`,
    objective: "どんな方が、どんなお悩みで、何を期待して来院しているのかを把握する",
    reward_points: 5,
    estimated_minutes: 1,
    entry_code: "yotto-acu-a",
    completion_message: "ご協力ありがとうございました。続きは施術後にお答えください。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_B,
    name: `【${STORE_NAME}】B：施術後アンケート`,
    objective: "施術直後の満足度と、通院計画の伝わり方を項目別に把握する（本調査のメイン）",
    reward_points: 5,
    estimated_minutes: 2,
    entry_code: "yotto-acu-b",
    completion_message:
      "ご協力ありがとうございました。後日、最後のアンケートをお送りしますので、そちらもどうぞよろしくお願いいたします。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_C,
    name: `【${STORE_NAME}】C：本音アンケート`,
    objective: "時間経過後の実感の変化と、実際の再来院行動を把握する",
    reward_points: 10,
    estimated_minutes: 2,
    entry_code: "yotto-acu-c",
    // C-Q2 / C-Q3 の選択肢を A-Q5（主訴部位）で絞るための宣言（Migration 092）
    carry_forward_sources: [{ namespace: "a", entry_code: "yotto-acu-a" }]
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
 * A-Q12 / A-Q13 の告知文。
 * 回答画面の helpText と share_with_store.notice を必ず同一にする。
 * 利用規約 第9条3項が「回答画面上であらかじめ明示したうえで」を開示条件に
 * しているため、画面に出した文言と根拠がズレると説明がつかなくなる。
 */
const A_Q12_NOTICE = "この設問のみ施術者が施術前に確認いたします。";
const A_Q13_NOTICE = "この設問のみ施術者が施術前に確認いたします。";

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
 * 満足度の評価項目10件。A-Q9/A-Q10（重視項目）と B-Q2/B-Q3/B-Q4 で value を共有する。
 * ここを揃えておくことで carry-forward が value 一致で成立する。
 *
 * ⚠ relief（らくになった実感）は**主観の実感**であって医療効果の評価ではない。
 *   設問文で「治った」「改善した」と書かないこと（冒頭の広告規制コメント参照）。
 *
 * サロン版からの変更:
 *   + relief        施術後のらくになった実感（この業種の最大因子）
 *   + explanation   施術内容・体の状態の説明
 *   + interview     問診でじっくり話を聞いてくれたか
 *   + plan          通院の見通しの示し方（何回くらい必要か）
 *   + gentleness    痛み・熱さへの配慮（B-Q8 でも別途詳しく聞く）
 *   - finish        「仕上がり」＝見た目の業種の言い方
 *   - design/durability/nail_care 等 ＝ネイル固有
 *   ※ atmosphere（院内の雰囲気）は評価項目ではなく B-Q8 で別途聞く
 *
 * ⚠ 10件を超えると matrix_single は 1行=1画面なので B の画面数がそのまま増える。
 */
const ASPECTS = [
  ["relief", "施術後のらくになった実感"],
  ["explanation", "体の状態や施術内容の説明"],
  ["interview", "問診（話をよく聞いてくれたか）"],
  ["plan", "通院の見通しの示し方"],
  ["gentleness", "痛み・熱さへの配慮"],
  ["skill", "施術の技術・的確さ"],
  ["talk", "スタッフの接客・話しやすさ"],
  ["hygiene", "院内の清潔感"],
  ["wait", "待ち時間"],
  ["price", "価格への納得感"]
];

/** A-Q9/A-Q10 は「待ち時間」を含まない（施術前のため）。サロン版と同じ考え方。 */
const A_ASPECTS = ASPECTS.filter(([v]) => v !== "wait");

/** 雰囲気は評価項目ではないが「重視して来たか」「不満だったか」は聞く価値がある。 */
const ATMOSPHERE = ["atmosphere", "院内の雰囲気・落ち着けるか"];

const OTHER = ["other", "その他"];

/** 「特になし」は他と同時に選べない排他選択肢にする。 */
const exclusiveNone = { value: "none", label: "特になし", exclusive: true };

// ------------------------------------------------------------------
// A: 来院すぐアンケート
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
        "アンケートは施術前、施術後、その後のご様子の確認の３つを予定しております。各１分程度の長さです。",
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
    placeholder: "例: 45"
  }),

  q(P_A, "Q4", "この鍼灸院への来院は何回目ですか？（ひとつだけ）", "single_choice", 4, {
    options: opts(
      ["first", "１回目（初めて）"],
      ["second", "２回目"],
      ["third_fifth", "３〜５回目"],
      ["sixth_plus", "６回目以上"]
    ),
    helpText: "※回数を覚えていない場合は、おおよその回数を教えてください。"
  }),

  // A-Q5: 今日いちばん気になっている部位。
  // ⚠ 症状は要配慮個人情報（病歴に準じる）に当たり得るため**部位レベルに留める**。
  //   傷病名を書かせる自由記述は置かない（冒頭の広告規制・個人情報コメント参照）。
  // C-Q2 / C-Q3 の選択肢の出し分け（disableRules）もこの value を参照する。
  q(P_A, "Q5", "今日いちばん気になっているところはどこですか？（いくつでも）", "multi_choice", 5, {
    options: opts(
      ["neck_shoulder", "首・肩のこり"],
      ["back", "腰・背中"],
      ["limbs", "手足の痛み・しびれ"],
      ["head", "頭の重さ"],
      ["fatigue", "全身のだるさ・疲れ"],
      ["sleep", "眠りの浅さ"],
      ["stomach", "胃腸の調子"],
      ["cold", "冷え・むくみ"],
      ["women", "女性特有のお悩み"],
      ["beauty", "美容目的（お顔・肌など）"],
      ["maintenance", "特に不調はなく、体のメンテナンス"],
      OTHER
    )
  }),

  // A-Q6: 初回(Q4=first)かどうかで設問文が変わる。文面違いの2問を表示条件で出し分ける。
  q(
    P_A,
    "Q6",
    "今回、この鍼灸院を知ったきっかけを教えてください。（いくつでも）",
    "multi_choice",
    6,
    { options: knownFromOptions() },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q4=first" }] }
  ),
  q(
    P_A,
    "Q7",
    "最初にこの鍼灸院を知ったきっかけを教えてください。（いくつでも）",
    "multi_choice",
    7,
    { options: knownFromOptions() },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q4!=first" }] }
  ),

  q(P_A, "Q8", "今回、鍼灸院に来た一番の目的を教えてください（ひとつだけ）", "single_choice", 8, {
    options: opts(
      ["acute_pain", "つらい痛みをなんとかしたい"],
      ["chronic", "長く続いている不調とつきあいたい"],
      ["maintenance", "調子を崩さないよう定期的に整えたい"],
      ["relax", "リラックス・気分転換したい"],
      ["sports", "スポーツ・運動のコンディションを整えたい"],
      ["beauty", "美容目的"],
      ["after_hospital", "病院にかかったが、別の方法も試したい"],
      ["recommended", "人に勧められたので試してみたい"],
      OTHER
    )
  }),

  q(P_A, "Q9", "今日、重視していることは何ですか？（いくつでも）", "multi_choice", 9, {
    // atmosphere は「雰囲気を重視して来た層」をフラグ化してクロス集計に使う。
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
  // ⚠ ここの value を変えたら seedAcupunctureIndustryTemplate.mjs の日数表も必ず揃えること。
  //   片方だけ直すと頻度が引けず、C の送付日が undecided 扱いに落ちる。
  // 刻みは鍼灸の実態（急性期は週1〜2回・維持期は月1回）に合わせて短期側を細かく取る。
  q(P_A, "Q11", "どのくらいの間隔で通おうとお考えですか？（ひとつだけ）", "single_choice", 11, {
    options: opts(
      ["twice_week", "週に2回以上"],
      ["weekly", "週に1回くらい"],
      ["biweekly", "2週間に1回くらい"],
      ["monthly", "月に1回くらい"],
      ["bimonthly", "2〜3か月に1回くらい"],
      ["as_needed", "つらいときだけ"],
      ["undecided", "まだ決めていない"]
    ),
    helpText: "この回答をもとに、後日のアンケート（C）をお送りする時期を決めます。"
  }),

  // A-Q12: 鍼の経験と不安。施術前に施術者が読んで当日の進め方を決めるための申し送り。
  // 初回離脱の実務的な主因（怖さ・痛さ）を事前に拾う。
  q(
    P_A,
    "Q12",
    "鍼はこれまでに受けたことがありますか？（ひとつだけ）",
    "single_choice",
    12,
    {
      options: opts(
        ["none_anxious", "初めてで、少し不安がある"],
        ["none_ok", "初めてだが、特に不安はない"],
        ["few", "数回受けたことがある"],
        ["many", "何度も受けている"]
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

  q(
    P_A,
    "Q13",
    "今日の施術について、気になっていることや施術者に伝えたいことはありますか？",
    "free_text_long",
    13,
    {
      placeholder: "例）強い刺激が苦手です。／今日は特に右肩がつらいです。",
      helpText: A_Q13_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。施術前に読めないと意味がないので原文・即時。
      // ⚠ 自由記述なので何が書かれるか制御できない。症状・通院歴など要配慮情報が
      //   混入し得るため、運用側で内容を確認できる状態を保つこと。
      //   ここに書かれた内容を広告・宣伝に転用しないこと（冒頭コメント参照）。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "verbatim",
          timing: "immediate",
          notice: A_Q13_NOTICE
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
    ["doctor_referral", "医療機関からの紹介"],
    ["instagram", "Instagram"],
    ["other_sns", "TikTokなどその他のSNS"],
    ["booking_site", "EPARKなどの予約サイト"],
    ["web_ad", "Web広告・SNS広告"],
    ["flyer", "チラシ"],
    ["passing_by", "院の前を通りかかった時に見かけた"],
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
        "本日のご来院ありがとうございました。1〜2分程度のお客様の満足度確認アンケートにご協力ください。\n" +
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
      placeholder: "例）説明について、刺激の強さについて、料金について、待ち時間についてなど",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q4 includes none" }]
    }
  ),

  q(P_B, "Q6", "来院前に期待していた内容と比べて、今日の体験はいかがでしたか？（ひとつだけ）", "single_choice", 6, {
    options: scale5(
      ["far_above", "期待を大きく上回った"],
      ["above", "期待を少し上回った"],
      ["as_expected", "期待通りだった"],
      ["below", "期待を少し下回った"],
      ["far_below", "期待を大きく下回った"]
    ),
    ...SLIDER
  }),

  q(P_B, "Q7", "次回もこの鍼灸院を利用したいと思いますか？（ひとつだけ）", "single_choice", 7, {
    options: scale5(
      ["definitely", "とても利用したい"],
      ["probably", "やや利用したい"],
      ["undecided", "どちらともいえない・未定"],
      ["probably_not", "あまり利用したくない"],
      ["definitely_not", "まったく利用したくない"]
    ),
    ...SLIDER
  }),

  // B-Q8: 施術中の体感。満足度5段階ではなく「気になったか」を聞く。
  // ⚠ 怖さ・痛さ・熱さは満足度には現れない（我慢した人も「やや満足」を選ぶ）。
  //   初回離脱の実務的な主因なので項目として分けないと拾えない（冒頭コメント3）。
  q(P_B, "Q8", "施術中、気になったことはありましたか？（いくつでも）", "multi_choice", 8, {
    options: [
      ...opts(
        ["needle_pain", "鍼の痛み"],
        ["moxa_heat", "お灸の熱さ"],
        ["too_strong", "刺激が強すぎた"],
        ["too_weak", "刺激が物足りなかった"],
        ["posture", "同じ姿勢がつらかった"],
        ["cold_room", "室温・肌寒さ"],
        ["exposure", "着替え・肌の露出が気になった"],
        ["duration", "施術時間の長さ"],
        ["privacy", "他の患者さんの声や気配が気になった"],
        OTHER
      ),
      exclusiveNone
    ],
    helpText: "次回の施術に活かします。気になったものがあれば選んでください。"
  }),

  // B-Q9: 通院計画が伝わったか。この業種の離脱の核心（冒頭コメント1）。
  // 「効かなかったから来ない」より「次いつ来ればいいか分からないまま終わった」が多い。
  // C-Q8 / C-Q9 とこの設問がクロスして初めて離脱が説明できる。
  q(P_B, "Q9", "次回いつ頃来ればよいか、見通しは伝わりましたか？（ひとつだけ）", "single_choice", 9, {
    options: opts(
      ["clear_booked", "伝わった（次回の予約も取った）"],
      ["clear_not_booked", "伝わったが、予約はまだ取っていない"],
      ["vague", "なんとなく聞いたが、はっきりとは分からない"],
      ["none", "特に説明はなかった"]
    ),
    ...SWIPE
  }),

  q(
    P_B,
    "Q10",
    "今日の施術について、何か伝えたいことがあれば教えてください",
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
        "アンケート調査を行っているYOTTOではこの鍼灸院の満足度アンケートのほかにも、簡単なアンケート（ポイ活）を行っております。\n" +
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
    "前回の施術から時間が経ちましたが、今のお体の調子はいかがですか？（ひとつだけ）",
    "single_choice",
    1,
    {
      // ⚠ 医療効果の断定を避け、主観の実感として聞く（冒頭の広告規制コメント参照）。
      options: scale5(
        ["much_better", "とてもらくになったと感じる"],
        ["better", "ややらくになったと感じる"],
        ["same", "あまり変わらない"],
        ["worse", "やや戻ってきた"],
        ["much_worse", "元に戻ってしまった"]
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

  // C-Q2: らくになった状態が何日続いたか。この業種の核心（冒頭コメント4）。
  // B の直後は誰でもらくになる。**持続期間**が再来院を決めるので独立設問にする。
  // サロンの「もち」に相当する。
  q(P_C, "Q2", "施術後、らくな状態はどのくらい続きましたか？（ひとつだけ）", "single_choice", 2, {
    options: opts(
      ["not_felt", "特に変化を感じなかった"],
      ["same_day", "その日のうちだけ"],
      ["few_days", "2〜3日ほど"],
      ["about_week", "1週間ほど"],
      ["few_weeks", "2〜3週間ほど"],
      ["still", "今も続いている"]
    ),
    helpText: "感じたままをお答えください。"
  }),

  // C-Q3: 時間が経ってから残っている「良かった点」。
  // A-Q5（主訴部位）で該当しない選択肢は出さない（Migration 092）。
  q(
    P_C,
    "Q3",
    "あらためて振り返って、よかった点はありましたか？（いくつでも）",
    "multi_choice",
    3,
    {
      options: [
        ...opts(
          ["pain_eased", "つらかったところがらくになった"],
          ["moves_better", "体が動かしやすくなった"],
          ["sleep_better", "眠りの質が変わったと感じる"],
          ["less_tired", "疲れにくくなったと感じる"],
          ["warm", "冷えやむくみが気にならなくなった"],
          ["mind_light", "気分が軽くなった"],
          ["understood_body", "自分の体の状態が分かった"],
          ["self_care", "家でできるケアを教えてもらえた"],
          ["reassured", "相談できる場所ができて安心した"],
          OTHER
        ),
        exclusiveNone
      ],
      helpText: "前回お答えいただいたお悩みに関するものだけ表示しています。",
      // 「本音」は1項目ずつ◯✕で判定させたほうが取りこぼしが少ない（後日回答＝急いでいない）。
      // 排他の「特になし」はデッキから自動で外れ、全部✕＝特になし相当になる。
      ...SORT_SWIPE
    },
    {
      display_tags_parsed: { disableRules: symptomDisableRulesPositive() }
    }
  ),

  q(
    P_C,
    "Q4",
    "あらためて振り返って、あまり良くなかったところはありましたか？（いくつでも）",
    "multi_choice",
    4,
    {
      options: [
        ...opts(
          ["no_change", "思ったほど変化を感じなかった"],
          ["back_soon", "すぐに元に戻ってしまった"],
          ["soreness", "施術のあとにだるさ・もみ返しのような感じがあった"],
          ["bruise", "内出血や跡が残った"],
          ["expensive_for_result", "実感に対して費用が高いと感じた"],
          ["plan_unclear", "どのくらい通えばよいのか分からなかった"],
          ["hard_to_book", "通い続けるのが時間的に難しかった"],
          OTHER
        ),
        exclusiveNone
      ]
      // C-Q3 と連続で1枚ずつ振り分けさせると操作量が多すぎるため、後半のこちらは
      // chip_select（casual の複数選択の既定）で受ける。ネガ側の取りこぼしより
      // 全体の完走を優先する判断（サロン版と同じ）。
    },
    {
      display_tags_parsed: { disableRules: symptomDisableRulesNegative() }
    }
  ),

  // C-Q5: C-Q4 で「特になし」ならスキップ
  q(
    P_C,
    "Q5",
    "あまり良くないとお答えいただいた内容を具体的にお答えください。",
    "free_text_long",
    5,
    {
      placeholder: "例）実感について、費用について、通いやすさについて、説明について",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q4 includes none" }]
    }
  ),

  q(
    P_C,
    "Q6",
    "前回の来院以降、鍼灸院や治療院を利用しましたか？（ひとつだけ）",
    "single_choice",
    6,
    {
      options: opts(["yes", "はい（この院／別の院）"], ["no", "いいえ"]),
      helpText: "※どちらの院かは問いません。",
      ...SWIPE
    }
  ),

  // C-Q7: C-Q6=yes のときだけ
  q(
    P_C,
    "Q7",
    "前回の来院以降、どちらを利用しましたか。（ひとつだけ）",
    "single_choice",
    7,
    {
      options: opts(
        ["same", `この${STORE_NAME}を再度利用した`],
        ["other", "別の鍼灸院・治療院を利用した"],
        ["both", `この${STORE_NAME}と別の院の両方を利用した`],
        ["hospital", "病院・整形外科などを受診した"]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q6=yes" }] }
  ),

  // C-Q8: C-Q6=no のときだけ
  q(
    P_C,
    "Q8",
    "あなたは今後どうされる予定ですか？（ひとつだけ）",
    "single_choice",
    8,
    {
      options: opts(
        ["same", "この鍼灸院を再度利用する予定"],
        ["other", "別の鍼灸院・治療院を利用する予定"],
        ["hospital", "病院・整形外科などを受診する予定"],
        ["self_care", "しばらく様子を見る・自分でケアする"],
        ["undecided", "検討中・考えていない"]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q6=no" }] }
  ),

  // C-Q9: リピート要因（Q7=same/both もしくは Q8=same）
  // ⚠ 鍼灸の継続理由は効果実感だけではない。「体のことを相談できる相手」という
  //   関係性の価値が実際には大きく、これを拾えないと「実感が薄い＝離脱」という
  //   短絡した読みになる。
  q(
    P_C,
    "Q9",
    "またこの鍼灸院を利用した（したいと思う）理由を教えてください（いくつでも）",
    "multi_choice",
    9,
    {
      options: opts(
        ["felt_relief", "施術後にらくになる実感がある"],
        ["lasting", "らくな状態が長く続く"],
        ["good_explanation", "体の状態を分かりやすく説明してくれる"],
        ["listens", "話をよく聞いてくれる"],
        ["trust_person", "施術者を信頼できる・相談しやすい"],
        ["clear_plan", "通う見通しを示してくれる"],
        ["gentle", "痛みや熱さに配慮してくれる"],
        ["no_pressure", "回数券や物販の勧誘がない"],
        ["atmosphere", "院の雰囲気・居心地が良い"],
        ["access", "通いやすい（場所・アクセス）"],
        ["price", "価格への納得感"],
        ["easy_booking", "予約が取りやすい"],
        ["habit", "体のメンテナンスとして習慣にしている"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        { type: "pipe_expression", expression: "q7=same or q7=both or q8=same" }
      ]
    }
  ),

  // C-Q10: 離反要因（Q7=other/both もしくは Q8=other/hospital/self_care）
  // ⚠ 「回数券や物販をすすめられた」が無いと離脱理由が「価格」に流れ込む。
  //   鍼灸の離脱は金額そのものより**押し売り感**で起きることが多く、
  //   これを分離できないと「値下げ」という誤った打ち手に誘導される。
  // ⚠ 「通い続ける時間がない」も分けること。これは院の質の問題ではないので
  //   一緒にすると改善の打ち手を見誤る。
  q(
    P_C,
    "Q10",
    "別の院を利用した（する予定の）理由を教えてください（いくつでも）",
    "multi_choice",
    10,
    {
      options: opts(
        ["no_effect", "思ったほど実感がなかった"],
        ["short_lasting", "らくな状態が長続きしなかった"],
        ["pushy_sales", "回数券や物販をすすめられた"],
        ["price", "価格への納得感がなかった"],
        ["no_explanation", "説明が分かりにくかった"],
        ["plan_unclear", "どのくらい通えばよいのか分からなかった"],
        ["painful", "痛み・熱さがつらかった"],
        ["person_mismatch", "施術者との相性が合わなかった"],
        ["atmosphere_mismatch", "院の雰囲気が合わなかった"],
        ["no_time", "通い続ける時間が取れなかった"],
        ["access", "場所・アクセスが良くなかった"],
        ["no_slot", "行きたいタイミングで予約が取れなかった"],
        ["recovered", "調子が良くなったので通う必要がなくなった"],
        ["try_other", "他の方法・他院を試してみたかった"],
        ["moved", "引っ越し等で物理的に行けなくなったから"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression: "q7=other or q7=both or q8=other or q8=hospital or q8=self_care"
        }
      ]
    }
  ),

  // C-Q11: 別院利用 or 未定 or 様子見の人にだけ改善期待を聞く
  q(
    P_C,
    "Q11",
    "今後、この鍼灸院に期待することがあれば教えてください",
    "free_text_long",
    11,
    {
      placeholder: "例）説明について、費用について、予約の取りやすさについて、施術について",
      helpText:
        "今後、どんなところが改善すればこの鍼灸院を再度利用すると思いますか。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression:
            "q7=other or q7=both or q8=other or q8=hospital or q8=self_care or q8=undecided"
        }
      ]
      // お礼は projects.completion_message（送信完了画面）へ移した (Migration 108)。
    }
  )
];

/**
 * A-Q5（主訴部位）で選ばれていない部位に紐づく選択肢を落とす（C-Q3 用）。
 * disableRules の condition は pipe 式。`a:q5` は Migration 092 の名前空間付き参照。
 *
 * ⚠ A-Q5 は multi_choice なので `includes` で比較する（飲食の A-Q5 は単一選択で等号）。
 */
function symptomDisableRulesPositive() {
  return [
    // 眠りの悩みを挙げていない人に「眠りの質が変わった」は判断材料が無い
    { targetChoice: "sleep_better", condition: "not a:q5 includes sleep" },
    // 冷え・むくみを挙げていない人に「冷えが気にならなくなった」は意味をなさない
    { targetChoice: "warm", condition: "not a:q5 includes cold" },
    // 疲れ・だるさを挙げていない人に「疲れにくくなった」は聞かない
    { targetChoice: "less_tired", condition: "not a:q5 includes fatigue" },
    // 痛みの主訴（首肩・腰背・手足）が無ければ「つらかったところがらくに」は出さない
    {
      targetChoice: "pain_eased",
      condition:
        "not a:q5 includes neck_shoulder and not a:q5 includes back and not a:q5 includes limbs"
    }
  ];
}

/** C-Q4 用（ネガ側）。 */
function symptomDisableRulesNegative() {
  return [
    // メンテナンス目的だけの人に「すぐ元に戻った」は前提が合わない
    {
      targetChoice: "back_soon",
      condition:
        "not a:q5 includes neck_shoulder and not a:q5 includes back and not a:q5 includes limbs"
    }
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
