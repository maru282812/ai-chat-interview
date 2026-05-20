import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

loadDotEnv();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const projectId = "00000000-0000-4000-8000-0000000000e1";
const respondentLineUserId = "TEST_EC_DEMAND_USER";
const now = new Date().toISOString();
const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const probeTargets = [
  "Q2_CATEGORY_REASON",
  "Q3_PURCHASE_CONTEXT",
  "Q4_PAIN",
  "Q5_OTHER_CATEGORY",
  "Q6_DELIVERY_REASON",
  "Q9_LOW_INTENT",
  "Q9_HIGH_INTENT",
  "Q11_IMAGE_REACTION",
  "Q14_FREE_COMMENT"
];

const images = {
  commerce: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=80",
  fashion: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=600&q=80",
  grocery: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80",
  electronics: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=600&q=80"
};

function probeMeta(questionGoal, requiredSlots) {
  return {
    research_goal: "ECサイトの需要調査で、購入カテゴリ・利用場面・不満・購入意向を具体化する",
    question_goal: questionGoal,
    probe_goal: "短い回答、抽象的な回答、理由が薄い回答に対して、具体的な商品カテゴリ・利用場面・比較対象・障壁を1つずつ確認する",
    required_slots: requiredSlots,
    bad_answer_patterns: [
      { type: "exact", value: "特にない", note: "no_content" },
      { type: "contains", value: "普通", note: "abstract" },
      { type: "contains", value: "なんとなく", note: "abstract" },
      { type: "contains", value: "場合による", note: "abstract" }
    ],
    probe_config: {
      max_probes: 3,
      min_probes: 0,
      force_probe_on_bad: true,
      allow_followup_expansion: false,
      strict_topic_lock: true
    },
    completion_conditions: [{ type: "required_slots" }, { type: "no_bad_patterns" }],
    render_style: {
      mode: "interview_natural",
      connect_from_previous_answer: true,
      avoid_question_number: true,
      preserve_options: false
    }
  };
}

function question(code, text, type, order, config = {}, extra = {}) {
  return {
    project_id: projectId,
    question_code: code,
    question_text: text,
    question_role: extra.role ?? "main",
    question_type: type,
    is_required: extra.required ?? true,
    sort_order: order,
    branch_rule: extra.branch_rule ?? null,
    question_config: config,
    ai_probe_enabled: extra.ai_probe_enabled ?? false,
    probe_guideline: extra.probe_guideline ?? null,
    max_probe_count: extra.max_probe_count ?? null,
    render_strategy: "static",
    is_system: extra.is_system ?? false,
    is_hidden: extra.is_hidden ?? false,
    comment_top: extra.comment_top ?? null,
    comment_bottom: extra.comment_bottom ?? null,
    answer_output_type: extra.answer_output_type ?? "text",
    display_tags_raw: null,
    display_tags_parsed: null,
    visibility_conditions: null,
    page_group_id: null,
    answer_options_locked: extra.answer_options_locked ?? true,
    created_at: now,
    updated_at: now
  };
}

const project = {
  id: projectId,
  name: "ECサイト需要調査テスト（全回答形式・AI深堀り）",
  client_name: "Internal Test",
  objective: "ECサイトで購入したい商品カテゴリ、購入場面、不満、配送・価格条件、画面印象を全回答形式で収集し、AI深堀りの発火確認に使う。",
  status: "active",
  reward_points: 10,
  research_mode: "interview",
  display_mode: "survey_question",
  primary_objectives: [
    "EC需要調査テーマで全question_typeのLIFF表示と回答保存を確認する",
    "短い自由記述に対するAI深堀り設定を多めに確認する",
    "single_choice、multi_choice、numericの分岐を確認する"
  ],
  secondary_objectives: [
    "画像付き選択肢、画像アップロード、hidden項目の保存形式を確認する",
    "EC利用の不満、期待、購入意向を具体化する"
  ],
  comparison_constraints: ["実購買データではなくテスト回答を前提とする", "特定ECブランドの評価ではなく一般的な需要確認とする"],
  prompt_rules: [
    "ECサイト需要調査の文脈から外れない",
    "深堀りは一度に一つの観点だけ尋ねる",
    "商品カテゴリ、購入場面、比較対象、不満、購入条件のいずれかを具体化する"
  ],
  probe_policy: {
    enabled: true,
    conditions: ["short_answer", "abstract_answer"],
    max_probes_per_answer: 3,
    max_probes_per_session: 10,
    require_question_probe_enabled: true,
    target_question_codes: probeTargets,
    blocked_question_codes: [
      "Q1_CATEGORY",
      "Q6_MULTI",
      "Q7_MATRIX_SINGLE",
      "Q8_MATRIX_MULTI",
      "Q10_NUMERIC",
      "Q10_SD",
      "Q12_UPLOAD",
      "Q13_HIDDEN_SINGLE",
      "Q13_HIDDEN_MULTI",
      "Q14_MATRIX_MIXED"
    ],
    short_answer_min_length: 18,
    end_conditions: [
      "answer_sufficient",
      "max_probes_per_answer",
      "max_probes_per_session",
      "question_not_target",
      "question_blocked",
      "user_declined"
    ]
  },
  response_style: { channel: "line", tone: "natural_japanese", max_characters_per_message: 120, max_sentences: 2 },
  ai_state_template_key: "ux_research",
  ai_state_generated_at: now,
  ai_state_json: {
    version: "v1",
    template_key: "ux_research",
    project_goal: "ECサイト需要調査で全回答形式とAI深堀りを検証する",
    user_understanding_goal: "ECで買いたい商品、購入理由、不満、購入条件、画面反応を具体的に理解する",
    required_slots: [
      { key: "purchase_category", label: "購入カテゴリ", required: true, examples: ["日用品", "食品", "ファッション"] },
      { key: "reason", label: "理由", required: true, examples: ["安い", "比較しやすい", "配送が早い"] },
      { key: "usage_scene", label: "利用場面", required: true, examples: ["買い忘れ補充", "セール時", "重い商品の購入"] },
      { key: "purchase_barrier", label: "購入障壁", required: false, examples: ["送料", "返品不安", "到着日"] }
    ],
    optional_slots: [
      { key: "image_reaction", label: "画面画像への反応", required: false },
      { key: "feature_idea", label: "欲しい機能", required: false }
    ],
    question_categories: ["需要カテゴリ", "購入行動", "不満", "配送条件", "画面反応"],
    probe_policy: {
      default_max_probes: 3,
      force_probe_on_bad: true,
      strict_topic_lock: true,
      allow_followup_expansion: false
    },
    completion_rule: {
      required_slots_needed: ["purchase_category", "reason", "usage_scene"],
      allow_finish_without_optional: true,
      min_required_slots_to_finish: 3
    },
    language: "ja",
    probe_guideline: "回答が短い場合は、何を、いつ、なぜ、どの条件なら買うのかを1つずつ聞く。"
  },
  created_at: now,
  updated_at: now
};

const questions = [
  question(
    "Q1_CATEGORY",
    "ECサイトで今後もっと買いたい商品カテゴリを1つ選んでください。",
    "single_choice",
    1,
    {
      options: [
        { value: "daily_goods", label: "日用品・消耗品" },
        { value: "food", label: "食品・飲料" },
        { value: "fashion", label: "ファッション" },
        { value: "electronics", label: "家電・ガジェット" },
        { value: "other", label: "その他" }
      ],
      helpText: "single_choice と分岐確認用です。"
    },
    {
      role: "screening",
      answer_output_type: "object",
      branch_rule: {
        default_next: "Q2_CATEGORY_REASON",
        branches: [
          { source: "answer", when: { equals: "food" }, next: "Q3_PURCHASE_CONTEXT" },
          { source: "answer", when: { equals: "other" }, next: "Q5_OTHER_CATEGORY" }
        ]
      }
    }
  ),
  question(
    "Q2_CATEGORY_REASON",
    "そのカテゴリをECで買いたい理由を短く教えてください。",
    "free_text_short",
    2,
    {
      max_length: 180,
      placeholder: "例: 店舗で探す手間が減り、価格比較もしやすいから",
      helpText: "短い回答や「普通」などでAI深堀りを確認します。",
      meta: probeMeta("ECで買いたいカテゴリの理由を取得する", ["purchase_category", "reason"]),
      conversationControl: {
        coreInfoPrompt: "そのカテゴリをECで買いたい理由を、価格・品揃え・配送・比較のどれに近いか含めて教えてください",
        answerExample: "店舗で探す手間が減り、価格比較もしやすいから",
        shortAnswerMinLength: 18,
        sufficientAnswerMinLength: 45
      }
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "カテゴリ名、理由、店舗購入との違いが薄ければ確認する。"
    }
  ),
  question(
    "Q3_PURCHASE_CONTEXT",
    "ECサイトを使う頻度や、どんなタイミングで買うことが多いか教えてください。",
    "free_text_long",
    3,
    {
      placeholder: "例: 月2回ほど、日用品の在庫が切れそうな時やセール時にまとめ買いします。",
      helpText: "free_text_long とAI深堀り確認用です。",
      meta: probeMeta("EC利用頻度と購入タイミングを取得する", ["purchase_frequency", "usage_scene"]),
      conversationControl: {
        coreInfoPrompt: "どのくらいの頻度で、どんなきっかけやタイミングで買うことが多いか教えてください",
        answerExample: "月2回ほど、日用品の在庫が切れそうな時やセール時にまとめ買いします。",
        shortAnswerMinLength: 18,
        sufficientAnswerMinLength: 60
      }
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "頻度、タイミング、購入きっかけが抜けていれば確認する。"
    }
  ),
  question(
    "Q4_PAIN",
    "ECサイトで買う時に不便・不安に感じることがあれば教えてください。",
    "free_text_long",
    4,
    {
      placeholder: "例: サイズ感が分かりにくく、返品手続きも面倒に感じます。",
      meta: probeMeta("EC購入時の不満や不安を取得する", ["purchase_barrier", "reason"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "不満の対象、困る場面、購入をやめる条件を確認する。"
    }
  ),
  question(
    "Q5_OTHER_CATEGORY",
    "「その他」を選んだ方は、買いたいカテゴリ名と理由を教えてください。",
    "free_text_short",
    5,
    {
      max_length: 180,
      placeholder: "例: ペット用品です。重いものを家まで届けてほしいからです。",
      meta: probeMeta("その他カテゴリの名称と理由を取得する", ["purchase_category", "reason"])
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "カテゴリ名だけなら理由を、理由だけならカテゴリ名を確認する。"
    }
  ),
  question(
    "Q6_MULTI",
    "ECサイトを選ぶ時に重視する点をすべて選んでください。",
    "multi_choice",
    6,
    {
      min_select: 1,
      max_select: 5,
      options: [
        { value: "price", label: "価格が安い" },
        { value: "delivery", label: "配送が早い・正確" },
        { value: "reviews", label: "レビューが信頼できる" },
        { value: "return", label: "返品しやすい" },
        { value: "search", label: "商品を探しやすい" },
        { value: "points", label: "ポイントが貯まる" }
      ],
      helpText: "multi_choice と includes 分岐確認用です。"
    },
    {
      answer_output_type: "array",
      branch_rule: {
        default_next: "Q7_MATRIX_SINGLE",
        branches: [{ source: "answer", when: { includes: "delivery" }, next: "Q6_DELIVERY_REASON" }]
      }
    }
  ),
  question(
    "Q6_DELIVERY_REASON",
    "配送を重視すると答えた方は、どんな配送条件なら利用したくなるか教えてください。",
    "free_text_short",
    7,
    {
      max_length: 180,
      placeholder: "例: 日用品は翌日、食品は時間指定できると安心して買いやすいです。",
      meta: probeMeta("重視する配送条件を取得する", ["delivery_condition", "reason"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "配送速度、日時指定、送料、受け取り方法のどれが重要か確認する。",
      branch_rule: { default_next: "Q7_MATRIX_SINGLE" }
    }
  ),
  question(
    "Q7_MATRIX_SINGLE",
    "商品カテゴリごとに、ECで買いたい度合いに一番近いものを選んでください。",
    "matrix_single",
    8,
    {
      matrix_rows: [
        { value: "daily_goods", label: "日用品" },
        { value: "food", label: "食品・飲料" },
        { value: "fashion", label: "ファッション" },
        { value: "electronics", label: "家電・ガジェット" }
      ],
      matrix_cols: [
        { value: "low", label: "買いたくない" },
        { value: "middle", label: "どちらともいえない" },
        { value: "high", label: "買いたい" }
      ],
      helpText: "matrix_single 確認用です。"
    },
    { answer_output_type: "object" }
  ),
  question(
    "Q8_MATRIX_MULTI",
    "購入場面ごとに、ECサイトに期待する機能を選んでください。",
    "matrix_multi",
    9,
    {
      matrix_rows: [
        { value: "repeat", label: "いつもの商品を買う時" },
        { value: "compare", label: "複数商品を比較する時" },
        { value: "gift", label: "ギフトを買う時" }
      ],
      matrix_cols: [
        { value: "recommend", label: "おすすめ" },
        { value: "price_alert", label: "価格通知" },
        { value: "delivery_filter", label: "配送条件フィルタ" },
        { value: "review_summary", label: "レビュー要約" }
      ],
      helpText: "matrix_multi 確認用です。"
    },
    { answer_output_type: "object", branch_rule: { default_next: "Q10_NUMERIC" } }
  ),
  question(
    "Q10_NUMERIC",
    "新しいECサイトがあった場合、利用してみたい気持ちは1〜5でどれくらいですか。",
    "numeric",
    10,
    {
      min: 1,
      max: 5,
      min_label: "使いたくない",
      max_label: "ぜひ使いたい",
      helpText: "numeric と gte/lte 分岐確認用です。"
    },
    {
      answer_output_type: "number",
      branch_rule: {
        default_next: "Q10_SD",
        branches: [
          { source: "answer", when: { lte: 2 }, next: "Q9_LOW_INTENT" },
          { source: "answer", when: { gte: 4 }, next: "Q9_HIGH_INTENT" }
        ]
      }
    }
  ),
  question(
    "Q9_LOW_INTENT",
    "利用意向が低い理由を教えてください。",
    "free_text_short",
    11,
    {
      max_length: 180,
      placeholder: "例: 既存サイトで十分で、新しいサイトに個人情報を登録するのが面倒だからです。",
      meta: probeMeta("利用意向が低い理由を取得する", ["purchase_barrier", "reason"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "既存サービスとの差、登録負担、信頼不安、価格のどれが障壁か確認する。",
      branch_rule: { default_next: "Q10_SD" }
    }
  ),
  question(
    "Q9_HIGH_INTENT",
    "利用意向が高い理由を教えてください。",
    "free_text_short",
    12,
    {
      max_length: 180,
      placeholder: "例: 日用品を安く早く届けてもらえるなら、今使っているサイトと比較したいです。",
      meta: probeMeta("利用意向が高い理由を取得する", ["reason", "usage_scene"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      branch_rule: { default_next: "Q10_SD" }
    }
  ),
  question(
    "Q10_SD",
    "ECサイトの印象について、左が「不安」、右が「信頼できる」として選んでください。",
    "sd",
    13,
    {
      options: [
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
        { value: "5", label: "5" }
      ],
      min_label: "不安",
      max_label: "信頼できる",
      helpText: "sd 確認用です。"
    },
    { answer_output_type: "number" }
  ),
  question(
    "Q11_IMAGE_REACTION",
    "画像のようなECサイト画面を見て、使ってみたいと思うカテゴリを選んでください。",
    "text_with_image",
    14,
    {
      question_text_image: {
        mainUrl: images.commerce,
        alt: "ECサイト画面のイメージ",
        caption: "画像付き設問と画像カード選択肢の確認用です。"
      },
      display_format: "card",
      grid_cols: 3,
      options: [
        { value: "fashion", label: "ファッション", title: "ファッション", description: "比較しながら探したい", imageUrl: images.fashion },
        { value: "grocery", label: "食品・日用品", title: "食品・日用品", description: "まとめ買い向き", imageUrl: images.grocery },
        { value: "electronics", label: "家電・ガジェット", title: "家電・ガジェット", description: "レビュー比較向き", imageUrl: images.electronics }
      ],
      meta: probeMeta("画面への反応と選択理由を取得する", ["image_reaction", "reason"])
    },
    {
      answer_output_type: "object",
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "画面のどの要素が利用意向につながったか確認する。"
    }
  ),
  question(
    "Q12_UPLOAD",
    "もし普段使っているEC画面や商品ページのスクリーンショットがあればアップロードしてください。なければ任意のテスト画像で構いません。",
    "image_upload",
    15,
    {
      image_upload_config: {
        max_count: 2,
        allowed_types: ["image/jpeg", "image/png", "image/webp"],
        max_size_mb: 10,
        instructions: "画像アップロードと補足テキスト保存の確認用です。",
        text_input_mode: "optional"
      },
      helpText: "image_upload 確認用です。respondent-uploads bucket が必要です。"
    },
    { required: false, answer_output_type: "object" }
  ),
  question(
    "Q13_HIDDEN_SINGLE",
    "hidden_single テスト項目です。",
    "hidden_single",
    16,
    {
      options: [{ value: "ec_demand_test", label: "EC需要調査テスト" }],
      default_value: "ec_demand_test",
      helpText: "hidden_single 保存確認用です。"
    },
    { required: false, answer_output_type: "text", is_hidden: false }
  ),
  question(
    "Q13_HIDDEN_MULTI",
    "hidden_multi テスト項目です。",
    "hidden_multi",
    17,
    {
      options: [
        { value: "all_types", label: "全回答形式" },
        { value: "ai_probe", label: "AI深堀り" },
        { value: "ec", label: "EC需要" }
      ],
      default_values: ["all_types", "ai_probe", "ec"],
      helpText: "hidden_multi 保存確認用です。"
    },
    { required: false, answer_output_type: "array", is_hidden: false }
  ),
  question(
    "Q14_MATRIX_MIXED",
    "次のECサイト条件について、当てはまるものを入力・選択してください。",
    "matrix_mixed",
    18,
    {
      matrix_rows: [
        { value: "delivery_speed", label: "配送速度の希望", answer_type: "single_choice" },
        { value: "return_policy", label: "返品しやすさ", answer_type: "single_choice" },
        { value: "comment", label: "一言コメント", answer_type: "free_text_short" }
      ],
      matrix_cols: [
        { value: "low", label: "低め" },
        { value: "middle", label: "普通" },
        { value: "high", label: "高め" },
        { value: "important", label: "重要" },
        { value: "not_important", label: "重要でない" }
      ],
      helpText: "matrix_mixed 確認用です。"
    },
    { answer_output_type: "object" }
  ),
  question(
    "Q14_FREE_COMMENT",
    "最後に、ECサイトに期待することや、欲しい機能を自由に教えてください。",
    "free_text_long",
    19,
    {
      placeholder: "例: レビュー要約、配送日の比較、返品条件の分かりやすい表示があると使いやすいです。",
      meta: probeMeta("自由コメントから期待や改善点を取得する", ["feature_idea"])
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "期待、困りごと、具体的な機能案のどれかを確認する。"
    }
  )
];

async function removeExisting() {
  for (const table of ["point_transactions", "project_assignments", "project_analysis_reports", "respondents", "questions"]) {
    const { error } = await supabase.from(table).delete().eq("project_id", projectId);
    if (error) throw new Error(`${table} delete failed: ${error.message}`);
  }
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw new Error(`projects delete failed: ${error.message}`);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  await removeExisting();

  const { error: projectError } = await supabase.from("projects").insert(project);
  if (projectError) throw new Error(`project insert failed: ${projectError.message}`);

  const { error: questionsError } = await supabase.from("questions").insert(questions);
  if (questionsError) throw new Error(`questions insert failed: ${questionsError.message}`);

  const respondentId = crypto.randomUUID();
  const { error: respondentError } = await supabase.from("respondents").insert({
    id: respondentId,
    line_user_id: respondentLineUserId,
    display_name: "EC需要調査テストユーザー",
    project_id: projectId,
    status: "invited",
    total_points: 0,
    created_at: now,
    updated_at: now
  });
  if (respondentError) throw new Error(`respondent insert failed: ${respondentError.message}`);

  const assignmentId = crypto.randomUUID();
  const { error: assignmentError } = await supabase.from("project_assignments").insert({
    id: assignmentId,
    project_id: projectId,
    respondent_id: respondentId,
    user_id: respondentLineUserId,
    assignment_type: "manual",
    status: "assigned",
    delivery_channel: "liff",
    assigned_at: now,
    deadline,
    delivery_log: [],
    created_at: now,
    updated_at: now
  });
  if (assignmentError) throw new Error(`assignment insert failed: ${assignmentError.message}`);

  const { data: insertedQuestions, error: verifyError } = await supabase
    .from("questions")
    .select("question_code,question_type,ai_probe_enabled,sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (verifyError) throw new Error(`verify failed: ${verifyError.message}`);

  console.log(
    JSON.stringify(
      {
        projectId,
        projectName: project.name,
        assignmentId,
        respondentLineUserId,
        surveyPath: `/liff/survey/${assignmentId}`,
        questionCount: insertedQuestions.length,
        types: insertedQuestions.map((item) => item.question_type),
        aiProbeQuestionCodes: insertedQuestions.filter((item) => item.ai_probe_enabled).map((item) => item.question_code)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
