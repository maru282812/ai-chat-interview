/**
 * seedLodgingSurveyProjects.mjs
 *
 * 宿泊（ホテル・旅館）向け 店舗専用アンケート A / B / C の3案件を冪等投入する。
 * 美容室版（seedSalonSurveyProjects.mjs）・飲食版（seedRestaurantSurveyProjects.mjs）の
 * 構造を踏襲し、業種固有の「頻度・評価項目・設問文」を差し替えている。
 *
 *   A: チェックイン時アンケート （客室のQR）       entry_code=yotto-lodging-a
 *   B: ご滞在後アンケート       （翌日チェックアウト帯） entry_code=yotto-lodging-b
 *   C: 本音アンケート           （後日・A-Q9基準）  entry_code=yotto-lodging-c
 *
 * 【この業種は A/B/C サイクルの前提が2つ崩れる。その対処が本ファイルの主眼】
 *
 * 1. B は「120分後」ではなく「翌日」に届ける
 *    他業種の B は施術後・食後・会計後＝Aの2時間後で成立するが、宿泊は滞在が
 *    1〜3日にまたがる。Aの2時間後は「到着して部屋に入った直後」で、
 *    大浴場・朝食・寝具といった宿泊体験の中核をまだ何も経験していない。
 *    そのため followup_b_delay_minutes を 1440分（24時間）にし、
 *    B の受信をチェックアウト帯に合わせる（seedLodgingIndustryTemplate.mjs）。
 *    ⚠ 1泊を既定としている。2泊以上の客には B が滞在中の中日に届くが、
 *      「滞在中に届く」ほうが「チェックアウト後に届く」より回答率が高いため
 *      この誤差は許容する。逆に delay を長く取ると1泊客に届かなくなる。
 *    ⚠ B-Q1 で実際の泊数を聞いており、集計時に1泊客と多泊客を分けられる。
 *
 * 2. C は「再訪したか」では測れない。再訪意向＋推奨意向で測る
 *    宿泊は再訪率が構造的に低い。旅行先が毎回変わるため、満足した客でも
 *    次の1か月に再訪しないのが普通である。他業種と同じ「再来店したか」で
 *    離脱を判定すると、満足度と無関係な地理的偶然（その地方に用事があるか）を
 *    測ってしまい、ほぼ全員が「離脱」に分類される。
 *    そこで C の主軸を「また泊まりたいか（再訪意向）」と
 *    「人に薦めたか／薦めるか（推奨意向）」に置き換える。
 *    ⚠ 推奨意向は宿泊業で実際に売上と相関する指標。「薦めなかった」は
 *      「泊まらなかった」より強い不満のシグナルになる。
 *    ⚠ C-Q5 で他の宿泊施設の利用有無（＝旅行そのものをしたか）を先に聞く。
 *      これが無いと「再訪しなかった」が「旅行しなかった」なのか
 *      「別の宿を選んだ」なのか区別できず、離反分析が成立しない。
 *
 * 【その他の設計判断】
 *
 * 3. 評価項目（ASPECTS）の最大因子は「清潔感」と「寝具・睡眠」
 *    宿泊の満足度・クチコミで最上位に来るのが清潔感、次に睡眠の質。
 *    加えて宿泊固有として bath（風呂・大浴場）/ meal（食事）/ soundproof（静けさ）/
 *    amenity（アメニティ）を入れ、サロン固有の施術系は落とした。
 *    ⚠ soundproof（静けさ）を入れているのは、これが「言われないと気づかないが
 *      不満としては致命的」な項目のため。満足度マトリクスに置かないと拾えない。
 *
 * 4. 食事は「提供の有無」で分岐する
 *    素泊まりの客に食事の満足度を聞いても答えようがない。A-Q5（予約プラン）で
 *    食事の有無を取り、B-Q8（食事の詳細）と C-Q2/C-Q3 の食事関連選択肢を
 *    disableRules / visibility_conditions で落とす。
 *
 * 5. 同行者を A で聞く（宿泊固有の最重要クロス軸）
 *    一人旅・カップル・家族・出張で満足の条件がまったく違う。
 *    例: 「静けさ」の不満は一人旅・カップルに偏り、子連れには出ない。
 *    逆に「子ども向け設備」の不満は家族連れにしか出ない。
 *    これが無いと B-Q3 の満足度が平均化して改善要望が読めなくなる。
 *
 * 6. 要望・アレルギーは A で聞いて即時開示する
 *    サロンの A-Q14（伝えたいこと）に相当するが、宿泊では客室準備・食事の
 *    手配に間に合わないと意味がないため独立設問にし、timing=immediate で開示する。
 *    ⚠ アレルギーは要配慮個人情報に近い扱いになる。設問文で「食事の手配に使う」
 *      目的を明示し、画面の helpText と share_with_store.notice を必ず一致させること
 *      （利用規約 第9条3項）。
 *
 * すべて visibility_type=private_store なので「探す」一覧には出ない。
 *
 * 【回答UI】サロン版と同じく案件全体を casual にしている。詳細は
 * seedSalonSurveyProjects.mjs の冒頭コメントを参照。
 *
 * 【選択肢の持ち越し（carry-forward）】
 *   同一案件内 : B-Q4 ← B-Q3 / B-Q6 ← B-Q5
 *   別案件から : C-Q2, C-Q3 ← A-Q5（予約プラン） ※Migration 092
 *   持ち越しは value 一致で絞るため、参照元と参照先の value を必ず揃えること。
 *
 * Usage:
 *   node scripts/seedLodgingSurveyProjects.mjs
 *   node scripts/seedLodgingSurveyProjects.mjs --cleanup
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
// 小売（5e11c0xx…）・フィットネス（f17ec0xx…）と衝突しない別系列。
// ⚠ UUID は16進のみ。"lodging" を字面で入れたくなるが l/o/g/i/n は hex ではないため
//   Postgres の uuid 型で弾かれる（b0ed = "bed" の見立て）。
const P_A = "b0edc001-0000-4000-8000-000000000001";
const P_B = "b0edc002-0000-4000-8000-000000000002";
const P_C = "b0edc003-0000-4000-8000-000000000003";

/** 施設名は案件ごとに差し替える想定（店舗追加時に storeProvisioningService が置換する）。 */
const STORE_NAME = "●●ホテル";

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
    name: `【${STORE_NAME}】A：チェックイン時アンケート`,
    objective: "どんなお客様が、誰と、何を期待して今回ご宿泊されているのかを把握する",
    reward_points: 5,
    estimated_minutes: 1,
    entry_code: "yotto-lodging-a",
    completion_message:
      "ご協力ありがとうございました。続きはご滞在の終わりごろにお答えください。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_B,
    name: `【${STORE_NAME}】B：ご滞在後アンケート`,
    objective: "ご滞在全体の満足度を項目別に把握する（本調査のメイン）",
    reward_points: 5,
    estimated_minutes: 2,
    entry_code: "yotto-lodging-b",
    completion_message:
      "ご協力ありがとうございました。後日、最後のアンケートをお送りしますので、そちらもどうぞよろしくお願いいたします。",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_C,
    name: `【${STORE_NAME}】C：本音アンケート`,
    objective: "時間経過後の満足度の変化と、再訪意向・推奨意向を把握する",
    reward_points: 10,
    estimated_minutes: 2,
    entry_code: "yotto-lodging-c",
    completion_message:
      "ご協力ありがとうございました。引き続きアンケートサイトHibiをどうぞよろしくお願いいたします。",
    // C-Q2 / C-Q3 の選択肢を A-Q5（予約プラン）で絞るための宣言（Migration 092）
    carry_forward_sources: [{ namespace: "a", entry_code: "yotto-lodging-a" }]
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
const A_Q7_NOTICE = "この設問のみ、ご滞在中のご案内のためスタッフが確認いたします。";
const A_Q8_NOTICE =
  "この設問のみ、客室のご準備やお食事の手配のためスタッフが確認いたします。";

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
 * 満足度の評価項目11件。A-Q6（重視項目）と B-Q3/B-Q4/B-Q5 で value を共有する。
 * ここを揃えておくことで carry-forward が value 一致で成立する。
 *
 * 宿泊固有として入れたもの:
 *   + cleanliness 清潔感（宿泊の満足度・クチコミで最上位）
 *   + bedding     寝具・睡眠の質（清潔感に次ぐ因子）
 *   + soundproof  静けさ・遮音（言われないと気づかないが不満としては致命的）
 *   + bath        風呂・大浴場
 *   + meal        食事（素泊まりには出さない。冒頭コメント4）
 *   + amenity     アメニティ・備品
 *   + room_size   客室の広さ・設備
 * サロン・飲食から落としたもの:
 *   - skill / finish / care  施術系＝宿泊に存在しない
 *   - lineup / stock         小売固有
 */
const ASPECTS = [
  ["cleanliness", "客室・館内の清潔感"],
  ["bedding", "寝具・眠りやすさ"],
  ["soundproof", "静けさ（音・遮音）"],
  ["room_size", "客室の広さ・設備"],
  ["bath", "お風呂・大浴場"],
  ["meal", "お食事"],
  ["staff", "スタッフの接客・対応"],
  ["amenity", "アメニティ・備品の充実"],
  ["facility", "館内施設の充実（ラウンジ・売店など）"],
  ["access", "立地・アクセス"],
  ["price", "料金への納得感"]
];

/** 食事を含まないプランの客には食事の行を出さない（冒頭コメント4）。 */
const MEAL_PLANS = ["breakfast", "half_board", "full_board"];

/**
 * A-Q6（重視項目）は「お食事」を含む。予約前に食事を重視して選んだかは
 * 素泊まり客にも意味がある設問なので落とさない。
 */
const A_ASPECTS = ASPECTS;

const OTHER = ["other", "その他"];

/** 「特になし」は他と同時に選べない排他選択肢にする。 */
const exclusiveNone = { value: "none", label: "特になし", exclusive: true };

// ------------------------------------------------------------------
// A: チェックイン時アンケート
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
        "アンケートはご到着時、ご滞在後、その後のご感想の３つを予定しております。各１分程度の長さです。",
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

  q(P_A, "Q4", "この施設へのご宿泊は何回目ですか？（ひとつだけ）", "single_choice", 4, {
    options: opts(
      ["first", "１回目（初めて）"],
      ["second", "２回目"],
      ["few", "３〜５回目"],
      ["many", "６回目以上"]
    ),
    helpText: "※回数を覚えていない場合は、おおよその回数を教えてください。"
  }),

  // A-Q5: C-Q2 / C-Q3 の選択肢と B-Q6 の表示を絞る基準（Migration 092）。
  // ⚠ ここの value を変えたら C の disableRules と B-Q6 の表示条件も必ず揃えること。
  q(P_A, "Q5", "今回のご予約プランを教えてください。（ひとつだけ）", "single_choice", 5, {
    options: opts(
      ["room_only", "素泊まり（食事なし）"],
      ["breakfast", "朝食付き"],
      ["half_board", "朝食・夕食付き"],
      ["full_board", "3食付き・その他食事込み"],
      ["unknown", "わからない"]
    )
  }),

  // A-Q6: 重視項目。宿泊は予約時点で比較検討しているため、
  // 「何を見て選んだか」が他業種より明確に答えられる。
  q(P_A, "Q6", "今回この施設を選ぶうえで重視したことは何ですか？（いくつでも）", "multi_choice", 6, {
    options: opts(...A_ASPECTS, OTHER)
  }),

  // A-Q7: 同行者。宿泊固有の最重要クロス軸（冒頭コメント5）。
  // 客室の案内（静かな階・添い寝の寝具など）に使うため即時開示する。
  q(
    P_A,
    "Q7",
    "今回は誰とご宿泊ですか？（ひとつだけ）",
    "single_choice",
    7,
    {
      options: opts(
        ["alone", "ひとり"],
        ["couple", "夫婦・カップル"],
        ["family_kids", "家族（子どもあり）"],
        ["family_adults", "家族（大人のみ）"],
        ["friends", "友人・知人"],
        ["business", "仕事・出張（同僚含む）"],
        ["group", "団体・グループ"]
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

  // A-Q8: 要望・アレルギー。客室準備・食事手配に間に合わないと意味がない（冒頭コメント6）。
  q(
    P_A,
    "Q8",
    "ご滞在について、ご要望や苦手な食材・アレルギーがあれば教えてください",
    "free_text_long",
    8,
    {
      placeholder: "例）静かな部屋を希望します。／えびが食べられません。",
      helpText: A_Q8_NOTICE,
      // 店舗へ開示する（利用規約 第9条3項）。手配前に読めないと意味がないので原文・即時。
      // ⚠ アレルギー・体調は要配慮個人情報に近い扱いになる。設問文で用途
      //   （客室準備・食事手配）を明示しており、helpText と notice を一致させている。
      //   自由記述なので第三者の名前等も混入し得るため、運用側で内容を確認できる
      //   状態を保つこと。
      meta: {
        share_with_store: {
          enabled: true,
          mode: "verbatim",
          timing: "immediate",
          notice: A_Q8_NOTICE
        }
      }
    },
    // お礼は projects.completion_message（送信完了画面）へ。comment_bottom は
    // 設問の下＝送信「前」に出てしまうため使わない (Migration 108)。
    { is_required: false }
  ),

  // A-Q9: 離脱判定の基準。industry_templates.frequency_question_code=Q9 と対応する。
  // ⚠ ここの value を変えたら seedLodgingIndustryTemplate.mjs の日数表も必ず揃えること。
  //   片方だけ直すと頻度が引けず、C の送付日が undecided 扱いに落ちる。
  // ⚠ 宿泊は「この施設の利用頻度」ではなく「旅行・宿泊そのものの頻度」を聞く。
  //   施設単位で聞くと初回客が全員 undecided に倒れて送付日が決まらない。
  q(P_A, "Q9", "普段どのくらいの頻度で宿泊を伴う旅行・出張をされますか？（ひとつだけ）", "single_choice", 9, {
    options: opts(
      ["monthly_plus", "月に1回以上"],
      ["bimonthly", "2〜3か月に1回くらい"],
      ["half_year", "半年に1回くらい"],
      ["yearly", "年に1回くらい"],
      ["rarely", "数年に1回、またはそれ以下"],
      ["undecided", "特に決まっていない"]
    ),
    helpText: "この回答をもとに、後日のアンケート（C）をお送りする時期を決めます。"
  })
];

// ------------------------------------------------------------------
// B: ご滞在後アンケート（翌日チェックアウト帯に届く。冒頭コメント1）
// ------------------------------------------------------------------

const questionsB = [
  // B-Q1: 実際の泊数。B が「翌日」固定で届く設計のため、2泊以上の客には
  // 滞在中の中日に届く。集計時に1泊客と多泊客を分けるために必ず取る（冒頭コメント1）。
  q(
    P_B,
    "Q1",
    "今回は何泊のご予定ですか？（ひとつだけ）",
    "single_choice",
    1,
    {
      options: opts(
        ["one", "1泊"],
        ["two", "2泊"],
        ["three_plus", "3泊以上"]
      ),
      ...SWIPE
    },
    {
      comment_top:
        "ご滞在いただきありがとうございました。1〜2分程度のお客様の満足度確認アンケートにご協力ください。\n" +
        "このアンケートの回答は、個人を特定されない形で集計・分析いたしますので、正直な感想・意見をご自由にお書きください。\n" +
        "良いところ、改善してほしいところがあれば、遠慮なくお答えください。"
    }
  ),

  q(P_B, "Q2", "今回のご滞在について、総合的にどのくらい満足しましたか？（ひとつだけ）", "single_choice", 2, {
    options: scale5(...SAT5.map((o) => [o.value, o.label])),
    ...SLIDER
  }),

  // B-Q3: 項目×5段階のマトリクス（SAMTX）。
  // ⚠ matrix_single は 1行=1画面で出る（survey.ejs）。行を足すと画面数がそのまま増える。
  //   館内環境（香り・BGM・照明）はここに入れず B-Q7 で「気づかれたか」として聞く。
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
    { answer_output_type: "object" }
  ),

  // B-Q4: matrix の回答は object 形式のため、選択肢 value 一致で絞る carry-forward が
  //       そのままでは効かない。全項目を出し「特になし」を用意して運用でカバーする。
  q(P_B, "Q4", "今回、特に満足したものを教えてください（ひとつだけ）", "single_choice", 4, {
    options: [...opts(...ASPECTS, OTHER), exclusiveNone]
  }),

  q(
    P_B,
    "Q5",
    "反対に「もっとこうだったら良かった」と思うものはありますか？（いくつでも）",
    "multi_choice",
    5,
    {
      options: [...opts(...ASPECTS, ["atmosphere", "館内の雰囲気・居心地"], OTHER), exclusiveNone]
    }
  ),

  // B-Q6: B-Q5 で「特になし」なら出さない
  q(
    P_B,
    "Q6",
    "「もっとこうだったら良かった」と思うことについて具体的に教えてください。",
    "free_text_long",
    6,
    {
      placeholder: "例）客室について、お風呂について、お食事について、料金についてなど",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q5 includes none" }]
    }
  ),

  // B-Q7: 館内の環境。満足度5段階ではなく「気づかれたか」を聞く。
  // 香り・BGM・照明は満足度では動かない（ほぼ全員が「やや満足」に寄る）が、
  // 気づかれた／気づかれなかったは施設側の投資判断に直結する。
  q(P_B, "Q7", "館内や客室で、心地よかったものはありますか？（いくつでも）", "multi_choice", 7, {
    options: [
      ...opts(
        ["scent", "香り"],
        ["bgm", "BGM・館内の静けさ"],
        ["lighting", "照明の明るさ・色味"],
        ["temperature", "空調の快適さ"],
        ["pillow", "枕・マットレスの心地よさ"],
        ["bath_quality", "お風呂の広さ・お湯の質"],
        ["view", "客室や館内からの眺め"],
        ["amenity_quality", "アメニティの質"],
        ["lounge", "ラウンジ・共用スペース"],
        ["interior", "内装・インテリアの雰囲気"],
        OTHER
      ),
      exclusiveNone
    ],
    helpText: "気づいたもの・心地よかったものを選んでください。"
  }),

  // B-Q8: 食事の詳細。素泊まり・不明の客には出さない（冒頭コメント4）。
  // ⚠ 素泊まり客に食事の満足度を聞くと答えようがなく、neutral が量産されて
  //   食事の評価が実態より平均に寄る。
  q(
    P_B,
    "Q8",
    "お食事について、特に良かった点・気になった点はありますか？（いくつでも）",
    "multi_choice",
    8,
    {
      options: [
        ...opts(
          ["taste_good", "料理がおいしかった"],
          ["volume_good", "量がちょうどよかった"],
          ["local_food", "地元の食材・名物が楽しめた"],
          ["variety_good", "品数・種類が豊富だった"],
          ["service_good", "提供のタイミングが良かった"],
          ["taste_bad", "味が期待と違った"],
          ["volume_bad", "量が合わなかった"],
          ["variety_bad", "品数・種類が少なかった"],
          ["wait_bad", "提供までの待ち時間が長かった"],
          ["crowded_bad", "会場が混雑していた"],
          OTHER
        ),
        exclusiveNone
      ]
    },
    {
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression: "a:q5=breakfast or a:q5=half_board or a:q5=full_board"
        }
      ]
    }
  ),

  q(
    P_B,
    "Q9",
    "ご予約時に期待していた内容と比べて、今回のご滞在はいかがでしたか？（ひとつだけ）",
    "single_choice",
    9,
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

  // B-Q10: 再訪意向。宿泊では「また泊まりたい」と「実際に泊まる」が
  // 乖離するため、意向そのものを指標として押さえる（冒頭コメント2）。
  q(P_B, "Q10", "また機会があれば、この施設に宿泊したいと思いますか？（ひとつだけ）", "single_choice", 10, {
    options: scale5(
      ["definitely", "とても宿泊したい"],
      ["probably", "やや宿泊したい"],
      ["undecided", "どちらともいえない・未定"],
      ["probably_not", "あまり宿泊したくない"],
      ["definitely_not", "まったく宿泊したくない"]
    ),
    ...SLIDER
  }),

  // B-Q11: 推奨意向。宿泊業で実際に売上と相関する指標（冒頭コメント2）。
  q(P_B, "Q11", "この施設を家族や友人に薦めたいと思いますか？（ひとつだけ）", "single_choice", 11, {
    options: scale5(
      ["definitely", "とても薦めたい"],
      ["probably", "やや薦めたい"],
      ["undecided", "どちらともいえない"],
      ["probably_not", "あまり薦めたくない"],
      ["definitely_not", "まったく薦めたくない"]
    ),
    ...SLIDER
  }),

  q(
    P_B,
    "Q12",
    "今回のご滞在について、何か伝えたいことがあれば教えてください",
    "free_text_long",
    12,
    { helpText: "どんなことでも構いません。ご自由にお書きください。" },
    { is_required: false }
  ),

  q(
    P_B,
    "Q13",
    "こちらのサービスにご参加をしていただけますでしょうか。（ひとつだけ）",
    "single_choice",
    13,
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
// ⚠ 宿泊の C は他業種と主軸が違う。「再訪したか」ではなく
//   「また泊まりたいか（再訪意向）」と「人に薦めたか（推奨意向）」で測る。
//   宿泊は再訪率が構造的に低く、行動で測ると地理的偶然を測ってしまう（冒頭コメント2）。
// ------------------------------------------------------------------

const questionsC = [
  q(
    P_C,
    "Q1",
    "ご滞在から時間が経ちましたが、今あらためて振り返ってどう感じていますか？（ひとつだけ）",
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

  // C-Q2: 時間が経っても覚えている良かった点。
  // 宿泊固有＝「チェックアウト時の高揚」が抜けた後に何が残るかが、
  // 推奨意向（人に話すかどうか）の実体になる。
  q(
    P_C,
    "Q2",
    "時間が経っても印象に残っている、よかった点はありますか？（いくつでも）",
    "multi_choice",
    2,
    {
      options: [
        ...opts(
          ["slept_well", "よく眠れた"],
          ["clean_impression", "清潔で気持ちよく過ごせた"],
          ["bath_memory", "お風呂が印象に残っている"],
          ["meal_memory", "食事が印象に残っている"],
          ["staff_memory", "スタッフの対応が印象に残っている"],
          ["view_memory", "眺め・景色が印象に残っている"],
          ["quiet_memory", "静かでゆっくり休めた"],
          ["value_for_money", "料金に対して満足度が高かった"],
          ["good_reputation", "同行者や周囲の反応が良かった"],
          OTHER
        ),
        exclusiveNone
      ],
      helpText: "前回のご滞在内容に関するものだけ表示しています。",
      // 「本音」は1項目ずつ◯✕で判定させたほうが取りこぼしが少ない（後日回答＝急いでいない）。
      // 排他の「特になし」はデッキから自動で外れ、全部✕＝特になし相当になる。
      ...SORT_SWIPE
    },
    {
      // A-Q5 で食事なしのプランだった人には食事の選択肢を出さない（Migration 092）
      display_tags_parsed: { disableRules: planDisableRulesPositive() }
    }
  ),

  q(
    P_C,
    "Q3",
    "反対に、時間が経ってから気になった点はありますか？（いくつでも）",
    "multi_choice",
    3,
    {
      options: [
        ...opts(
          ["could_not_sleep", "よく眠れなかった"],
          ["cleanliness_issue", "清潔さが気になった"],
          ["noise_issue", "音・騒音が気になった"],
          ["bath_issue", "お風呂が期待と違った"],
          ["meal_issue", "食事が期待と違った"],
          ["staff_issue", "スタッフの対応が気になった"],
          ["room_issue", "客室の広さ・設備が物足りなかった"],
          ["facility_issue", "館内設備が物足りなかった"],
          ["overpriced", "料金に見合わなかった"],
          ["photo_gap", "予約サイトの写真・説明と違った"],
          OTHER
        ),
        exclusiveNone
      ]
      // C-Q2 と連続で1枚ずつ振り分けさせると操作量が多すぎるため、後半のこちらは
      // chip_select（casual の複数選択の既定）で受ける。ネガ側の取りこぼしより
      // 全体の完走を優先する判断（サロン版と同じ）。
    },
    {
      display_tags_parsed: { disableRules: planDisableRulesNegative() }
    }
  ),

  // C-Q4: C-Q3 で「特になし」ならスキップ
  q(
    P_C,
    "Q4",
    "気になったとお答えいただいた内容を具体的にお答えください。",
    "free_text_long",
    4,
    {
      placeholder: "例）客室について、お風呂について、お食事について、料金について",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q3 includes none" }]
    }
  ),

  // C-Q5: 旅行そのものをしたか。これが無いと「再訪しなかった」が
  // 「旅行しなかった」なのか「別の宿を選んだ」なのか区別できない（冒頭コメント2）。
  q(
    P_C,
    "Q5",
    "前回のご滞在以降、宿泊を伴う旅行・出張をされましたか？（ひとつだけ）",
    "single_choice",
    5,
    {
      options: opts(["yes", "はい"], ["no", "いいえ"]),
      helpText: "※宿泊先はどこでも構いません。",
      ...SWIPE
    }
  ),

  // C-Q6: C-Q5=yes のときだけ。行動データとしては取るが、
  // 離脱判定の主軸には使わない（宿泊は旅行先が毎回変わるのが普通のため）。
  q(
    P_C,
    "Q6",
    "その際、どちらにご宿泊されましたか。（ひとつだけ）",
    "single_choice",
    6,
    {
      options: opts(
        ["same", `この${STORE_NAME}に再度宿泊した`],
        ["other_area", "別の地域の宿泊施設に泊まった"],
        ["same_area_other", "同じ地域の別の宿泊施設に泊まった"],
        ["both", `この${STORE_NAME}と別の施設の両方に泊まった`]
      ),
      helpText: "※旅行先が変わるのは自然なことですので、ありのままお答えください。"
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=yes" }] }
  ),

  // C-Q7: 再訪意向。宿泊の C の主軸その1（冒頭コメント2）。
  // B-Q10 と同じ選択肢にして、時間経過による意向の変化を見る。
  q(P_C, "Q7", "またこの施設に宿泊したいと思いますか？（ひとつだけ）", "single_choice", 7, {
    options: scale5(
      ["definitely", "とても宿泊したい"],
      ["probably", "やや宿泊したい"],
      ["undecided", "どちらともいえない・未定"],
      ["probably_not", "あまり宿泊したくない"],
      ["definitely_not", "まったく宿泊したくない"]
    ),
    ...SLIDER
  }),

  // C-Q8: 推奨意向の実績。宿泊の C の主軸その2（冒頭コメント2）。
  // ⚠ B-Q11 は「薦めたいか（意向）」だが、こちらは「実際に話したか（行動）」。
  //   宿泊業で最も売上に効くのがこの口コミ行動である。
  q(P_C, "Q8", "この施設のことを、家族や友人に話しましたか？（ひとつだけ）", "single_choice", 8, {
    options: opts(
      ["recommended", "良い施設として薦めた"],
      ["mentioned", "話題にはしたが、薦めるほどではなかった"],
      ["negative", "良くなかった点を話した"],
      ["not_yet", "まだ話していないが、機会があれば薦めたい"],
      ["no", "特に話していない"]
    )
  }),

  // C-Q9: 再訪意向が低い／薦めない人にだけ理由を聞く。
  // ⚠ ここが実質の離反理由データ。行動（再訪したか）ではなく意向で絞るのが
  //   宿泊版の要点（冒頭コメント2）。
  q(
    P_C,
    "Q9",
    "またこの施設に宿泊したいとは思わない理由を教えてください（いくつでも）",
    "multi_choice",
    9,
    {
      options: opts(
        ["unsatisfied_room", "客室に満足できなかった"],
        ["unsatisfied_clean", "清潔さに満足できなかった"],
        ["could_not_sleep", "よく眠れなかった"],
        ["noise", "音・騒音が気になった"],
        ["unsatisfied_bath", "お風呂に満足できなかった"],
        ["unsatisfied_meal", "食事に満足できなかった"],
        ["bad_service", "スタッフの対応が合わなかった"],
        ["overpriced", "料金に見合わなかった"],
        ["photo_gap", "予約サイトの写真・説明と違った"],
        ["access", "立地・アクセスが良くなかった"],
        ["want_new_place", "旅行では毎回違う場所に行きたい"],
        ["no_plan_to_visit", "その地域に行く予定がない"],
        ["found_better", "他に良い施設を見つけた"],
        OTHER
      ),
      // 「その地域に行く予定がない」は不満ではないので、集計時に必ず分離すること。
      // ⚠ これを不満として数えると宿泊の離反理由が実態より悪く出る。
      helpText: "※不満ではなく「旅行先が変わるから」という理由でも構いません。"
    },
    {
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression:
            "q7=undecided or q7=probably_not or q7=definitely_not or q8=negative"
        }
      ]
    }
  ),

  // C-Q10: リピート意向が高い人にだけ理由を聞く。
  q(
    P_C,
    "Q10",
    "またこの施設に宿泊したいと思う理由を教えてください（いくつでも）",
    "multi_choice",
    10,
    {
      options: opts(
        ["slept_well", "よく眠れた"],
        ["cleanliness", "清潔で気持ちよく過ごせた"],
        ["bath", "お風呂が良かった"],
        ["meal", "食事が良かった"],
        ["staff", "スタッフの対応が良かった"],
        ["quiet", "静かでゆっくり休めた"],
        ["room", "客室が快適だった"],
        ["view", "眺め・景色が良かった"],
        ["facility", "館内施設が充実していた"],
        ["access", "立地・アクセスが良い"],
        ["price", "料金に納得できる"],
        ["trust", "安心して泊まれる（いつも同じ水準）"],
        ["revisit_area", "その地域にまた行く予定がある"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        { type: "pipe_expression", expression: "q7=definitely or q7=probably" }
      ]
    }
  ),

  // C-Q11: 改善期待。再訪意向が低い人にだけ聞く。
  q(
    P_C,
    "Q11",
    "今後、この施設に期待することがあれば教えてください",
    "free_text_long",
    11,
    {
      placeholder: "例）客室について、お風呂について、お食事について、料金について",
      helpText:
        "今後、どんなところが改善すればまた宿泊したいと思いますか。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression: "q7=undecided or q7=probably_not or q7=definitely_not"
        }
      ]
      // お礼は projects.completion_message（送信完了画面）へ移した (Migration 108)。
    }
  )
];

/**
 * A-Q5（予約プラン）で食事がないプランだった人から食事関連の選択肢を落とす（C-Q2 用）。
 * disableRules の condition は pipe 式。`a:q5` は Migration 092 の名前空間付き参照。
 *
 * ⚠ A-Q5 は single_choice なので `includes` ではなく `=` で比較する。
 *   食事ありは breakfast / half_board / full_board の3つ（MEAL_PLANS）。
 */
function planDisableRulesPositive() {
  return [
    {
      targetChoice: "meal_memory",
      condition: mealPlanAbsentCondition()
    }
  ];
}

/** C-Q3 用（ネガ側）。 */
function planDisableRulesNegative() {
  return [
    {
      targetChoice: "meal_issue",
      condition: mealPlanAbsentCondition()
    }
  ];
}

/** 「食事付きプランのいずれでもない」＝食事の設問を出さない条件。 */
function mealPlanAbsentCondition() {
  return MEAL_PLANS.map((plan) => `a:q5!=${plan}`).join(" and ");
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
