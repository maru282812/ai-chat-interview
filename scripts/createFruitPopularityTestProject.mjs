import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

loadDotEnv();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const projectId = "00000000-0000-4000-8000-0000000000f1";
const respondentLineUserId = "TEST_FRUIT_USER";
const now = new Date().toISOString();
const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const probeTargets = [
  "Q2_REASON",
  "Q3_PURCHASE",
  "Q4_MEMORY",
  "Q5_OTHER_REASON",
  "Q6_PRICE_REASON",
  "Q9_LOW",
  "Q9_HIGH",
  "Q11_IMAGE_REACTION",
  "Q14_FREE_COMMENT"
];

const images = {
  fruit: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=900&q=80",
  banana: "https://images.unsplash.com/photo-1603833665858-e61d17a86224?auto=format&fit=crop&w=600&q=80",
  apple: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=600&q=80",
  orange: "https://images.unsplash.com/photo-1582979512210-99b6a53386f9?auto=format&fit=crop&w=600&q=80"
};

function probeMeta(questionGoal, requiredSlots) {
  return {
    research_goal: "フルーツ人気調査で、回答理由・利用場面・購入障壁を具体化する",
    question_goal: questionGoal,
    probe_goal: "短い回答、抽象的な回答、理由が薄い回答に対して、具体的な場面・理由・比較対象を1つずつ確認する",
    required_slots: requiredSlots,
    bad_answer_patterns: [
      { type: "exact", value: "特にない", note: "no_content" },
      { type: "contains", value: "普通", note: "abstract" },
      { type: "contains", value: "なんとなく", note: "abstract" },
      { type: "contains", value: "その時による", note: "abstract" }
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
  name: "フルーツ人気調査テスト（全回答形式・AI深堀り）",
  client_name: "Internal Test",
  objective: "フルーツの好み、購入頻度、食べる場面、価格感度、画像反応を全回答形式で収集し、AI深堀りの発火確認に使う。",
  status: "active",
  reward_points: 10,
  research_mode: "interview",
  display_mode: "survey_question",
  primary_objectives: [
    "全question_typeのLIFF表示と回答保存を確認する",
    "短い自由記述に対するAI深堀り設定を確認する",
    "single_choice、multi_choice、numericの分岐を確認する"
  ],
  secondary_objectives: [
    "画像付き選択肢、画像アップロード、hidden項目の保存形式を確認する",
    "フルーツ嗜好の理由、購入場面、障壁を具体化する"
  ],
  comparison_constraints: ["年代や地域による比較は今回の対象外", "実購買データではなくテスト回答を前提とする"],
  prompt_rules: [
    "フルーツ人気調査の文脈から外れない",
    "深堀りは一度に一つの観点だけ尋ねる",
    "理由、場面、比較対象、購入障壁のいずれかを具体化する"
  ],
  probe_policy: {
    enabled: true,
    conditions: ["short_answer", "abstract_answer"],
    max_probes_per_answer: 3,
    max_probes_per_session: 10,
    require_question_probe_enabled: true,
    target_question_codes: probeTargets,
    blocked_question_codes: [
      "Q1_FAVORITE",
      "Q6_MULTI",
      "Q7_MATRIX_SINGLE",
      "Q8_MATRIX_MULTI",
      "Q10_NUMERIC",
      "Q10_SD",
      "Q12_UPLOAD",
      "Q13_HIDDEN_SINGLE",
      "Q13_HIDDEN_MULTI"
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
    project_goal: "フルーツ人気調査で全回答形式とAI深堀りを検証する",
    user_understanding_goal: "好きなフルーツ、選ぶ理由、購入場面、障壁、画像反応を具体的に理解する",
    required_slots: [
      { key: "favorite_fruit", label: "好きなフルーツ", required: true, examples: ["りんご", "バナナ", "みかん"] },
      { key: "reason", label: "好きな理由", required: true, examples: ["甘さ", "食べやすさ", "価格"] },
      { key: "usage_scene", label: "食べる場面", required: true, examples: ["朝食", "間食", "運動後"] },
      { key: "purchase_barrier", label: "購入障壁", required: false, examples: ["価格", "日持ち", "皮むき"] }
    ],
    optional_slots: [
      { key: "image_reaction", label: "画像への反応", required: false },
      { key: "new_product_idea", label: "新商品アイデア", required: false }
    ],
    question_categories: ["嗜好", "購入行動", "利用場面", "価格感度", "画像反応"],
    probe_policy: {
      default_max_probes: 3,
      force_probe_on_bad: true,
      strict_topic_lock: true,
      allow_followup_expansion: false
    },
    completion_rule: {
      required_slots_needed: ["favorite_fruit", "reason", "usage_scene"],
      allow_finish_without_optional: true,
      min_required_slots_to_finish: 3
    },
    language: "ja",
    probe_guideline: "回答が短い場合は、どの場面で、なぜ、他の果物と比べて何が違うのかを1つずつ聞く。"
  },
  created_at: now,
  updated_at: now
};

const questions = [
  question(
    "Q1_FAVORITE",
    "一番好きなフルーツを1つ選んでください。",
    "single_choice",
    1,
    {
      options: [
        { value: "apple", label: "りんご" },
        { value: "banana", label: "バナナ" },
        { value: "orange", label: "みかん・オレンジ" },
        { value: "grape", label: "ぶどう" },
        { value: "other", label: "その他" }
      ],
      helpText: "single_choice と分岐確認用です。"
    },
    {
      role: "screening",
      answer_output_type: "object",
      branch_rule: {
        default_next: "Q2_REASON",
        branches: [
          { source: "answer", when: { equals: "banana" }, next: "Q3_PURCHASE" },
          { source: "answer", when: { equals: "other" }, next: "Q5_OTHER_REASON" }
        ]
      }
    }
  ),
  question(
    "Q2_REASON",
    "そのフルーツが好きな理由を短く教えてください。",
    "free_text_short",
    2,
    {
      max_length: 160,
      placeholder: "例: 甘酸っぱくて朝食でもおやつでも食べやすいから",
      helpText: "短い回答や「普通」などでAI深堀りを確認します。",
      meta: probeMeta("好きな理由を取得する", ["reason"]),
      conversationControl: {
        coreInfoPrompt: "好きな理由を、味・食べやすさ・価格・思い出のどれに近いか含めて教えてください",
        answerExample: "甘酸っぱくて朝食でもおやつでも食べやすいから",
        shortAnswerMinLength: 18,
        sufficientAnswerMinLength: 45
      }
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "味、食感、食べる場面、他の果物との差を確認する。"
    }
  ),
  question(
    "Q3_PURCHASE",
    "フルーツを買う頻度や買う場所について教えてください。",
    "free_text_long",
    3,
    {
      placeholder: "例: 週2回スーパーで買います。朝食用にバナナ、週末に旬の果物を買います。",
      helpText: "free_text_long とAI深堀り確認用です。",
      meta: probeMeta("購入頻度と購入場所を取得する", ["purchase_frequency", "purchase_place"]),
      conversationControl: {
        coreInfoPrompt: "どのくらいの頻度で、どこで、誰のために買うことが多いか教えてください",
        answerExample: "週2回スーパーで買います。朝食用にバナナ、週末に旬の果物を買います。",
        shortAnswerMinLength: 18,
        sufficientAnswerMinLength: 60
      }
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "頻度、購入場所、購入目的が抜けていれば確認する。"
    }
  ),
  question(
    "Q4_MEMORY",
    "印象に残っているフルーツ体験や思い出があれば教えてください。",
    "free_text_long",
    4,
    {
      placeholder: "例: 旅行先で食べた桃がとても甘く、それ以来夏になると桃を買います。",
      meta: probeMeta("記憶に残る体験を取得する", ["memory_scene", "reason"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "場面、果物名、印象に残った理由を確認する。"
    }
  ),
  question(
    "Q5_OTHER_REASON",
    "「その他」を選んだ方は、好きなフルーツ名と理由を教えてください。",
    "free_text_short",
    5,
    {
      max_length: 180,
      placeholder: "例: 桃です。香りがよく、季節感があるからです。",
      meta: probeMeta("その他フルーツの名称と理由を取得する", ["favorite_fruit", "reason"])
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "フルーツ名だけなら理由を、理由だけなら名称を確認する。"
    }
  ),
  question(
    "Q6_MULTI",
    "フルーツを選ぶときに重視する点をすべて選んでください。",
    "multi_choice",
    6,
    {
      min_select: 1,
      max_select: 5,
      options: [
        { value: "taste", label: "味が好み" },
        { value: "price", label: "価格が手頃" },
        { value: "easy", label: "皮むき・準備が楽" },
        { value: "health", label: "健康によさそう" },
        { value: "seasonal", label: "旬・季節感" },
        { value: "storage", label: "日持ちする" }
      ],
      helpText: "multi_choice と includes 分岐確認用です。"
    },
    {
      answer_output_type: "array",
      branch_rule: {
        default_next: "Q7_MATRIX_SINGLE",
        branches: [{ source: "answer", when: { includes: "price" }, next: "Q6_PRICE_REASON" }]
      }
    }
  ),
  question(
    "Q6_PRICE_REASON",
    "価格を重視すると答えた方は、どの価格帯や量だと買いやすいか教えてください。",
    "free_text_short",
    7,
    {
      max_length: 180,
      placeholder: "例: 家族分を買うので、1パック500円以内だと買いやすいです。",
      meta: probeMeta("価格重視の理由と買いやすい条件を取得する", ["purchase_barrier", "acceptable_price"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "価格、量、頻度のどれが負担かを具体的に確認する。",
      branch_rule: { default_next: "Q7_MATRIX_SINGLE" }
    }
  ),
  question(
    "Q7_MATRIX_SINGLE",
    "場面ごとに一番食べたいフルーツを選んでください。",
    "matrix_single",
    8,
    {
      matrix_rows: [
        { value: "breakfast", label: "朝食" },
        { value: "snack", label: "おやつ" },
        { value: "after_dinner", label: "夕食後" }
      ],
      matrix_cols: [
        { value: "apple", label: "りんご" },
        { value: "banana", label: "バナナ" },
        { value: "orange", label: "みかん" },
        { value: "grape", label: "ぶどう" }
      ],
      helpText: "matrix_single 確認用です。"
    },
    { answer_output_type: "object" }
  ),
  question(
    "Q8_MATRIX_MULTI",
    "フルーツを買う場面ごとに、気にする点を選んでください。",
    "matrix_multi",
    9,
    {
      matrix_rows: [
        { value: "daily", label: "普段の買い物" },
        { value: "gift", label: "贈答・差し入れ" },
        { value: "event", label: "イベント・来客" }
      ],
      matrix_cols: [
        { value: "price", label: "価格" },
        { value: "freshness", label: "鮮度" },
        { value: "appearance", label: "見た目" },
        { value: "volume", label: "量" }
      ],
      helpText: "matrix_multi 確認用です。"
    },
    { answer_output_type: "object", branch_rule: { default_next: "Q10_NUMERIC" } }
  ),
  question(
    "Q9_LOW",
    "価格が気になる理由や、いくらくらいなら買いやすいか教えてください。",
    "free_text_short",
    11,
    {
      max_length: 180,
      placeholder: "例: 家族分を買うと高くなるので、1回500円以内だと買いやすいです。",
      meta: probeMeta("価格感度と許容価格を取得する", ["purchase_barrier", "acceptable_price"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "価格が高いと感じる具体的な金額や購入量を確認する。",
      branch_rule: { default_next: "Q10_SD" }
    }
  ),
  question(
    "Q9_HIGH",
    "購入意向が高い理由を教えてください。",
    "free_text_short",
    12,
    {
      max_length: 180,
      placeholder: "例: 健康のために毎朝食べたいので、少し高くても買います。",
      meta: probeMeta("購入意向が高い理由を取得する", ["reason", "usage_scene"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      branch_rule: { default_next: "Q10_SD" }
    }
  ),
  question(
    "Q10_NUMERIC",
    "今後1週間でフルーツを買いたい気持ちは1〜5でどれくらいですか。",
    "numeric",
    10,
    {
      min: 1,
      max: 5,
      min_label: "買いたくない",
      max_label: "とても買いたい",
      helpText: "numeric と gte/lte 分岐確認用です。"
    },
    {
      answer_output_type: "number",
      branch_rule: {
        default_next: "Q10_SD",
        branches: [
          { source: "answer", when: { lte: 2 }, next: "Q9_LOW" },
          { source: "answer", when: { gte: 4 }, next: "Q9_HIGH" }
        ]
      }
    }
  ),
  question(
    "Q10_SD",
    "フルーツ売り場の印象について、左が「地味」、右が「魅力的」として選んでください。",
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
      min_label: "地味",
      max_label: "魅力的",
      helpText: "sd 確認用です。"
    },
    { answer_output_type: "number" }
  ),
  question(
    "Q11_IMAGE_REACTION",
    "画像のようなフルーツ盛り合わせを見て、買いたいと思うものを選んでください。",
    "text_with_image",
    14,
    {
      question_text_image: {
        mainUrl: images.fruit,
        alt: "フルーツ盛り合わせ",
        caption: "画像付き設問と画像カード選択肢の確認用です。"
      },
      display_format: "card",
      grid_cols: 3,
      options: [
        { value: "banana", label: "バナナ中心", title: "バナナ中心", description: "朝食向き", imageUrl: images.banana },
        { value: "apple", label: "りんご中心", title: "りんご中心", description: "家族で分けやすい", imageUrl: images.apple },
        { value: "orange", label: "みかん中心", title: "みかん中心", description: "手軽に食べやすい", imageUrl: images.orange }
      ],
      meta: probeMeta("画像への反応と選択理由を取得する", ["image_reaction", "reason"])
    },
    {
      answer_output_type: "object",
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "画像のどの要素が購入意向につながったか確認する。"
    }
  ),
  question(
    "Q12_UPLOAD",
    "もし手元にフルーツや売り場の写真があればアップロードしてください。なければ任意のテスト画像で構いません。",
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
      options: [{ value: "fruit_test", label: "フルーツ調査テスト" }],
      default_value: "fruit_test",
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
        { value: "fruit", label: "フルーツ" }
      ],
      default_values: ["all_types", "ai_probe", "fruit"],
      helpText: "hidden_multi 保存確認用です。"
    },
    { required: false, answer_output_type: "array", is_hidden: false }
  ),
  question(
    "Q14_MATRIX_MIXED",
    "次の項目について、当てはまるものを入力・選択してください。",
    "matrix_mixed",
    18,
    {
      matrix_rows: [
        { value: "sweetness", label: "甘さの好み", answer_type: "single_choice" },
        { value: "freshness", label: "鮮度の重要度", answer_type: "single_choice" },
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
    "最後に、フルーツ売り場やフルーツ商品に期待することを自由に教えてください。",
    "free_text_long",
    19,
    {
      placeholder: "例: 少量パックや食べ頃表示があると買いやすいです。",
      meta: probeMeta("自由コメントから期待や改善点を取得する", ["expectation_or_idea"])
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "期待、困りごと、具体的な改善案のどれかを確認する。"
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
    display_name: "フルーツ調査テストユーザー",
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
