/**
 * seedSalonSurveyProjects.mjs
 *
 * 美容室向け 店舗専用アンケート A / B / C の3案件を冪等投入する。
 * 出典: 「YOTTO（美容室）調査票(美容室)」
 *
 *   A: 来店すぐアンケート   （QR流入・施術前）  entry_code=yotto-salon-a
 *   B: 施術後アンケート     （施術直後）        entry_code=yotto-salon-b
 *   C: 本音アンケート       （後日・A-Q10基準） entry_code=yotto-salon-c
 *
 * すべて visibility_type=private_store なので「探す」一覧には出ない。
 *
 * 【選択肢の持ち越し（carry-forward）】
 *   同一案件内   : A-Q9 ← A-Q8 / B-Q3 ← B-Q2 / B-Q5 ← B-Q4
 *   別案件から   : C-Q2, C-Q3 ← A-Q5（今日のメニュー） ※Migration 092
 *   持ち越しは value 一致で絞るため、参照元と参照先の value を必ず揃えること。
 *
 * Usage:
 *   node scripts/seedSalonSurveyProjects.mjs
 *   node scripts/seedSalonSurveyProjects.mjs --cleanup
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

const P_A = "5a10c001-0000-4000-8000-000000000001";
const P_B = "5a10c002-0000-4000-8000-000000000002";
const P_C = "5a10c003-0000-4000-8000-000000000003";

/** 店舗名は案件ごとに差し替える想定（調査票の「●●美容室」）。 */
const STORE_NAME = "●●美容室";

const common = {
  client_name: STORE_NAME,
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
    entry_code: "yotto-salon-a",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_B,
    name: `【${STORE_NAME}】B：施術後アンケート`,
    objective: "施術直後の顧客満足度を項目別に把握する（本調査のメイン）",
    reward_points: 5,
    estimated_minutes: 2,
    entry_code: "yotto-salon-b",
    carry_forward_sources: null
  },
  {
    ...common,
    id: P_C,
    name: `【${STORE_NAME}】C：本音アンケート`,
    objective: "時間経過後の満足度の変化と、実際の再来店行動を把握する",
    reward_points: 10,
    estimated_minutes: 2,
    entry_code: "yotto-salon-c",
    // C-Q2 / C-Q3 の選択肢を A-Q5（今日のメニュー）で絞るための宣言（Migration 092）
    carry_forward_sources: [{ namespace: "a", entry_code: "yotto-salon-a" }]
  }
];

// ------------------------------------------------------------------
// ヘルパ
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

/** [value, label] のペア配列から options を作る。 */
const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));

/** 5段階満足度（B-Q1 / B-Q2 の列 / C-Q1 で共通）。 */
const SAT5 = opts(
  ["very_satisfied", "とても満足した"],
  ["satisfied", "やや満足した"],
  ["neutral", "どちらともいえない"],
  ["dissatisfied", "あまり満足しなかった"],
  ["very_dissatisfied", "まったく満足しなかった"]
);

/**
 * 満足度の評価項目11件。A-Q8/A-Q9（重視項目）と B-Q2/B-Q3/B-Q4 で value を共有する。
 * ここを揃えておくことで carry-forward が value 一致で成立する。
 */
const ASPECTS = [
  ["finish", "仕上がり"],
  ["proposal", "自分に合った提案"],
  ["talk", "スタッフとの会話・接客"],
  ["comfort", "店内の居心地・清潔感"],
  ["skill", "施術技術（カットやカラー技術）"],
  ["care", "施術の丁寧さ（ハサミやシャンプーの仕方など）"],
  ["duration", "施術時間"],
  ["wait", "待ち時間"],
  ["price", "価格への納得感"],
  ["trouble", "髪や頭皮の悩み解決"],
  ["home_styling", "自宅での扱いやすさ（家でもセットできそうか）"]
];

/** A-Q8/A-Q9 は「待ち時間」を含まない（施術前のため）。調査票どおり。 */
const A_ASPECTS = ASPECTS.filter(([v]) => v !== "wait");

const OTHER = ["other", "その他（）"];
const NONE = ["none", "特になし"];

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
    { options: opts(["yes", "はい"], ["no", "いいえ"]) },
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

  q(
    P_A,
    "Q4",
    "この美容室への来店は何回目ですか？（ひとつだけ）",
    "single_choice",
    4,
    {
      options: opts(
        ["first", "１回目（初めて）"],
        ["second", "２回目"],
        ["third", "３回目"],
        ["fourth_plus", "４回目以上"]
      ),
      helpText: "※回数を覚えていない場合は、おおよその回数を教えてください。"
    }
  ),

  q(P_A, "Q5", "今日利用するメニューを教えてください。（いくつでも）", "multi_choice", 5, {
    options: opts(
      ["cut", "カット"],
      ["color", "カラー"],
      ["perm", "パーマ"],
      ["straight", "縮毛矯正・ストレート"],
      ["treatment", "トリートメント"],
      ["headspa", "ヘッドスパ"],
      OTHER
    )
  }),

  // A-Q6: 初回(Q4=first)かどうかで設問文が変わる。文面違いの2問を表示条件で出し分ける。
  q(
    P_A,
    "Q6",
    "今回、この美容室を知ったきっかけを教えてください。（いくつでも）",
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

  q(P_A, "Q8", "今回、美容室に来た一番の目的を教えてください（ひとつだけ）", "single_choice", 8, {
    options: opts(
      ["keep_style", "いつもの髪型に整えたい（髪の毛が伸びたから）"],
      ["change_style", "髪型・雰囲気を変えたい"],
      ["solve_trouble", "髪の悩みを解決したい"],
      ["color_gray", "カラー・白髪などを整えたい"],
      ["event", "結婚式・旅行などの特別な予定に備えたい"],
      ["relax", "リラックス・気分転換したい"],
      OTHER
    )
  }),

  q(P_A, "Q9", "今日、重視していることは何ですか？（いくつでも）", "multi_choice", 9, {
    options: opts(...A_ASPECTS, OTHER)
  }),

  // A-Q10: A-Q9 で選んだものだけ表示（carry-forward）
  q(
    P_A,
    "Q10",
    "今日、特に重視していることは何ですか？（ひとつだけ）",
    "single_choice",
    10,
    { options: opts(...A_ASPECTS, OTHER) },
    {
      display_tags_parsed: { optionSource: { fromQuestion: "q9", mode: "selected" } }
    }
  ),

  q(P_A, "Q11", "普段どのくらいの頻度で美容室（理容室）を利用しますか？（ひとつだけ）", "single_choice", 11, {
    options: opts(
      ["within_3w", "3週間以内"],
      ["about_1m", "約1か月"],
      ["about_1_5m", "約1か月半"],
      ["about_2m", "約2か月"],
      ["about_3m", "約3か月"],
      ["over_4m", "4か月以上"],
      ["undecided", "特に決まっていない"]
    ),
    helpText: "この回答をもとに、後日のアンケート（C）をお送りする時期を決めます。"
  }),

  q(
    P_A,
    "Q12",
    "今日の施術について、気になっていることやスタッフに伝えたいことはありますか？",
    "free_text_long",
    12,
    {
      placeholder: "例）話すのが苦手なので施術中は会話は少なめでお願いします。／自分に合った髪型が知りたいです。",
      helpText: "この設問のみ担当者が施術前に確認いたします。"
    },
    {
      is_required: false,
      comment_bottom:
        "ご協力ありがとうございました。続きは施術後にお答えください。"
    }
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
    ["booking_site", "ホットペッパービューティーなどの美容室予約サイト"],
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
    { options: SAT5 },
    {
      comment_top:
        "本日のご来店ありがとうございました。1〜2分程度のお客様の満足度確認アンケートにご協力ください。\n" +
        "このアンケートの回答は、個人を特定されない形で集計・分析いたしますので、正直な感想・意見をご自由にお書きください。\n" +
        "良いところ、改善してほしいところがあれば、遠慮なくお答えください。"
    }
  ),

  // B-Q2: 項目×5段階のマトリクス（SAMTX）
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

  // B-Q3: B-Q2 で「とても満足」「やや満足」だった項目のみ表示。
  // NOTE: matrix の回答は object 形式のため、選択肢 value 一致で絞る carry-forward が
  //       そのままでは効かない。ここでは全項目を出し「特になし」を用意して運用でカバーする。
  //       （matrix 由来の持ち越しはエンジン未対応 — 下の「既知の制約」を参照）
  q(P_B, "Q3", "今日、特に満足したものを教えてください（ひとつだけ）", "single_choice", 3, {
    options: [...opts(...ASPECTS, OTHER), exclusiveNone]
  }),

  q(
    P_B,
    "Q4",
    "反対に「もっとこうだったら良かった」と思うものはありますか？（いくつでも）",
    "multi_choice",
    4,
    { options: [...opts(...ASPECTS, OTHER), exclusiveNone] }
  ),

  // B-Q5: B-Q4 で「特になし」なら出さない
  q(
    P_B,
    "Q5",
    "「もっとこうだったら良かった」と思うことについて具体的に教えてください。",
    "free_text_long",
    5,
    {
      placeholder: "例）髪型・カラーについて、料金について、接客についてなど",
      helpText: "どんなことでも構いません。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [{ type: "pipe_expression", expression: "not q4 includes none" }]
    }
  ),

  q(P_B, "Q6", "来店前に期待していた内容と比べて、今日の体験はいかがでしたか？（ひとつだけ）", "single_choice", 6, {
    options: opts(
      ["far_above", "期待を大きく上回った"],
      ["above", "期待を少し上回った"],
      ["as_expected", "期待通りだった"],
      ["below", "期待を少し下回った"],
      ["far_below", "期待を大きく下回った"]
    )
  }),

  q(P_B, "Q7", "次回もこの美容室を利用したいと思いますか？（ひとつだけ）", "single_choice", 7, {
    options: opts(
      ["definitely", "とても利用したい"],
      ["probably", "やや利用したい"],
      ["undecided", "どちらともいえない・未定"],
      ["probably_not", "あまり利用したくない"],
      ["definitely_not", "まったく利用したくない"]
    )
  }),

  q(
    P_B,
    "Q8",
    "今日のサービスについて、何か伝えたいことがあれば教えてください",
    "free_text_long",
    8,
    { helpText: "どんなことでも構いません。ご自由にお書きください。" },
    { is_required: false }
  ),

  q(
    P_B,
    "Q9",
    "こちらのサービスにご参加をしていただけますでしょうか。（ひとつだけ）",
    "single_choice",
    9,
    { options: opts(["yes", "はい"], ["no", "いいえ"]) },
    {
      comment_top:
        "アンケート調査を行っているYOTTOではこの美容室の満足度アンケートのほかにも、簡単なアンケート（ポイ活）を行っております。\n" +
        "アンケートにご回答いただければ換金可能なポイントをお送りしております。（１pt＝1円）初回換金目安：約１週間程度"
    }
  )
];

// ------------------------------------------------------------------
// C: 本音アンケート
// ------------------------------------------------------------------

/**
 * C-Q2 / C-Q3 の選択肢。A-Q5（メニュー）の value を持つものは、
 * A で選ばれたメニューのときだけ出す（disableRules で条件付き除外）。
 * 常時表示のものは条件なし。
 */
const questionsC = [
  q(
    P_C,
    "Q1",
    "前回の施術から時間が経ちましたが、現在の仕上がりについてどう感じていますか？（ひとつだけ）",
    "single_choice",
    1,
    {
      options: opts(
        ["very_satisfied", "とても満足している"],
        ["satisfied", "やや満足している"],
        ["neutral", "どちらともいえない"],
        ["dissatisfied", "あまり満足していない"],
        ["very_dissatisfied", "まったく満足していない"]
      )
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
          ["home_styling_good", "自宅でセットしやすかった"],
          ["style_lasted", "髪型が長持ちした"],
          ["color_lasted", "ヘアカラーの色が長持ちした"],
          ["perm_lasted", "パーマが長持ちした"],
          ["color_liked", "ヘアカラーの色の感じが気に入った"],
          ["perm_liked", "パーマの感じが気に入った"],
          ["good_reputation", "周囲から評判が良かった"],
          ["style_liked", "髪型が気に入った"],
          OTHER
        ),
        exclusiveNone
      ],
      helpText: "前回ご利用いただいたメニューに関するものだけ表示しています。"
    },
    {
      // A-Q5 でカラー/パーマを選んでいない人には該当選択肢を出さない（Migration 092）
      display_tags_parsed: { disableRules: colorPermDisableRules() }
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
          ["home_styling_bad", "自宅でセットしにくかった"],
          ["style_degraded", "時間が経つにつれてイメージした髪型にセットできなくなった"],
          ["color_faded", "ヘアカラーの色がすぐ落ちてしまった"],
          ["perm_faded", "パーマがすぐ落ちてしまった"],
          ["color_disliked", "ヘアカラーの色があまり好きではなかった"],
          ["perm_disliked", "パーマの感じがあまり好きではなかった"],
          ["bad_reputation", "周囲からの評判が良くなかった"],
          ["style_disliked", "髪型が気に入らなくなった"],
          ["damage", "髪のダメージが気になった"],
          OTHER
        ),
        exclusiveNone
      ]
    },
    {
      display_tags_parsed: { disableRules: colorPermDisableRulesNegative() }
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
      placeholder: "例）髪型・カラーについて、料金について、接客について",
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
    "前回の来店以降、美容室を利用しましたか？（ひとつだけ）",
    "single_choice",
    5,
    {
      options: opts(["yes", "はい（この店／別の店）"], ["no", "いいえ"]),
      helpText: "※どこの美容室かは問いません。"
    }
  ),

  // C-Q6: C-Q5=yes のときだけ
  q(
    P_C,
    "Q6",
    "前回の来店以降、どちらの美容室を利用しましたか。（ひとつだけ）",
    "single_choice",
    6,
    {
      options: opts(
        ["same", `この${STORE_NAME}を再度利用した`],
        ["other", "別の美容室を利用した"],
        ["both", `この${STORE_NAME}と別の美容室の両方を利用した`]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=yes" }] }
  ),

  // C-Q7: C-Q5=no のときだけ
  q(
    P_C,
    "Q7",
    "あなたはどちらの美容室を利用する予定ですか？（ひとつだけ）",
    "single_choice",
    7,
    {
      options: opts(
        ["same", "この美容室を再度利用する予定"],
        ["other", "別の美容室を利用する予定"],
        ["undecided", "検討中・考えていない"]
      )
    },
    { visibility_conditions: [{ type: "pipe_expression", expression: "q5=no" }] }
  ),

  // C-Q8: リピート要因（Q6=same/both もしくは Q7=same）
  q(
    P_C,
    "Q8",
    "またこの美容室を利用した（したいと思う）理由を教えてください（いくつでも）",
    "multi_choice",
    8,
    {
      options: opts(
        ["good_finish", "仕上がりが良かった"],
        ["easy_home_styling", "自宅でセットしやすかった"],
        ["good_proposal", "自分に合った提案をしてくれる"],
        ["skill", "施術技術（カットやカラー技術）"],
        ["care", "施術の丁寧さ（ハサミやシャンプーの仕方など）"],
        ["understands_me", "自分のことを理解してくれている"],
        ["good_talk", "スタッフの会話・接客が良い"],
        ["comfort", "居心地が良い"],
        ["access", "通いやすい（場所・アクセス）"],
        ["price", "価格への納得感"],
        ["easy_booking", "予約が取りやすい"],
        ["habit", "なんとなくいつも利用している"],
        ["too_much_effort", "他の美容室を探すのが面倒だった"],
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
  q(
    P_C,
    "Q9",
    "別の美容室を利用した（する予定の）理由を教えてください（いくつでも）",
    "multi_choice",
    9,
    {
      options: opts(
        ["unsatisfied_finish", "前回の仕上がりに満足できなかった"],
        ["hard_home_styling", "自宅で扱いにくかった"],
        ["bad_service", "接客が合わなかった"],
        ["bad_proposal", "自分への提案内容が合わなかった"],
        ["price", "価格への納得感がなかった"],
        ["low_skill", "技術力が低かった"],
        ["access", "場所・アクセスが良くなかった"],
        ["try_other", "他店を試してみたかった"],
        ["recommended", "家族・友人に勧められた"],
        ["coupon", "別の美容室でクーポン・キャンペーンがあったから"],
        ["moved", "引っ越し等で物理的に行けなくなったから"],
        ["no_slot", "美容室に行きたいタイミングで予約が取れなかったから"],
        ["no_reason", "特に理由はなく、たまたま別の美容室を利用した"],
        OTHER
      )
    },
    {
      visibility_conditions: [
        { type: "pipe_expression", expression: "q6=other or q6=both or q7=other" }
      ]
    }
  ),

  // C-Q10: 別店利用 or 未定の人にだけ改善期待を聞く
  q(
    P_C,
    "Q10",
    "今後、この美容室に期待することがあれば教えてください",
    "free_text_long",
    10,
    {
      placeholder: "例）髪型・カラーについて、料金について、接客について",
      helpText: "今後、どんなところが改善すればこの美容室を再度利用すると思いますか。ご自由にお書きください。"
    },
    {
      is_required: false,
      visibility_conditions: [
        {
          type: "pipe_expression",
          expression: "q6=other or q6=both or q7=other or q7=undecided"
        }
      ],
      comment_bottom:
        "ご協力ありがとうございました。引き続き美容室ぐるとアンケートサイトHibiをどうぞよろしくお願いいたします。"
    }
  )
];

/**
 * A-Q5（メニュー）で選ばれていないメニューに紐づく選択肢を落とす（C-Q2 用）。
 * disableRules の condition は pipe 式。`a:q5` は Migration 092 の名前空間付き参照。
 */
function colorPermDisableRules() {
  return [
    { targetChoice: "color_lasted", condition: "not a:q5 includes color" },
    { targetChoice: "color_liked", condition: "not a:q5 includes color" },
    { targetChoice: "perm_lasted", condition: "not a:q5 includes perm" },
    { targetChoice: "perm_liked", condition: "not a:q5 includes perm" }
  ];
}

/** C-Q3 用（ネガ側）。 */
function colorPermDisableRulesNegative() {
  return [
    { targetChoice: "color_faded", condition: "not a:q5 includes color" },
    { targetChoice: "color_disliked", condition: "not a:q5 includes color" },
    { targetChoice: "perm_faded", condition: "not a:q5 includes perm" },
    { targetChoice: "perm_disliked", condition: "not a:q5 includes perm" }
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
