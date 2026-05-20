import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

loadDotEnv();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const projectId = "00000000-0000-4000-8000-000000000071";
const respondentLineUserId = "TEST_OVERSEAS_TRAVEL_USER";
const now = new Date().toISOString();
const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const probeTargets = [
  "Q2_REASON",
  "Q3_TRAVEL_CONTEXT",
  "Q4_MEMORY",
  "Q5_OTHER_DESTINATION",
  "Q6_BARRIER_REASON",
  "Q9_LOW_INTENT",
  "Q9_HIGH_INTENT",
  "Q11_IMAGE_REACTION",
  "Q14_FREE_COMMENT"
];

const images = {
  travel: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=900&q=80",
  city: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=600&q=80",
  beach: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
  heritage: "https://images.unsplash.com/photo-1528181304800-259b08848526?auto=format&fit=crop&w=600&q=80"
};

function probeMeta(questionGoal, requiredSlots) {
  return {
    research_goal: "海外旅行経験調査で、旅行経験・目的地・不安・意思決定条件を具体化する",
    question_goal: questionGoal,
    probe_goal: "短い回答、抽象的な回答、理由が薄い回答に対して、国や地域・旅行場面・不安・意思決定条件を1つずつ確認する",
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
  name: "海外旅行経験調査テスト（全回答形式・AI深堀り）",
  client_name: "Internal Test",
  objective: "海外旅行の経験、目的地、印象に残った体験、不安、次回旅行意向、画像反応を全回答形式で収集し、AI深堀りの発火確認に使う。",
  status: "active",
  reward_points: 10,
  research_mode: "interview",
  display_mode: "survey_question",
  primary_objectives: [
    "海外旅行経験テーマで全question_typeのLIFF表示と回答保存を確認する",
    "短い自由記述に対するAI深堀り設定を多めに確認する",
    "single_choice、multi_choice、numericの分岐を確認する"
  ],
  secondary_objectives: [
    "画像付き選択肢、画像アップロード、hidden項目の保存形式を確認する",
    "旅行先選びの理由、不安、再訪意向、予約時の重視点を具体化する"
  ],
  comparison_constraints: ["実予約データではなくテスト回答を前提とする", "特定旅行会社の評価ではなく一般的な旅行経験を対象にする"],
  prompt_rules: [
    "海外旅行経験調査の文脈から外れない",
    "深堀りは一度に一つの観点だけ尋ねる",
    "目的地、同行者、旅行目的、不安、費用、予約条件のいずれかを具体化する"
  ],
  probe_policy: {
    enabled: true,
    conditions: ["short_answer", "abstract_answer"],
    max_probes_per_answer: 3,
    max_probes_per_session: 10,
    require_question_probe_enabled: true,
    target_question_codes: probeTargets,
    blocked_question_codes: [
      "Q1_DESTINATION_TYPE",
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
    project_goal: "海外旅行経験調査で全回答形式とAI深堀りを検証する",
    user_understanding_goal: "海外旅行経験、目的地、旅行理由、不安、次回意向、予約条件を具体的に理解する",
    required_slots: [
      { key: "destination_type", label: "旅行先タイプ", required: true, examples: ["都市観光", "リゾート", "歴史文化"] },
      { key: "reason", label: "理由", required: true, examples: ["食事", "景色", "文化体験"] },
      { key: "travel_scene", label: "旅行場面", required: true, examples: ["家族旅行", "友人旅行", "一人旅"] },
      { key: "travel_barrier", label: "旅行障壁", required: false, examples: ["費用", "言語", "治安", "休みが取れない"] }
    ],
    optional_slots: [
      { key: "image_reaction", label: "旅行写真への反応", required: false },
      { key: "service_idea", label: "旅行サービスへの期待", required: false }
    ],
    question_categories: ["旅行経験", "目的地", "不安", "予約条件", "画像反応"],
    probe_policy: {
      default_max_probes: 3,
      force_probe_on_bad: true,
      strict_topic_lock: true,
      allow_followup_expansion: false
    },
    completion_rule: {
      required_slots_needed: ["destination_type", "reason", "travel_scene"],
      allow_finish_without_optional: true,
      min_required_slots_to_finish: 3
    },
    language: "ja",
    probe_guideline: "回答が短い場合は、どの国・地域で、誰と、何が良かった/不安だったのかを1つずつ聞く。"
  },
  created_at: now,
  updated_at: now
};

const questions = [
  question(
    "Q1_DESTINATION_TYPE",
    "海外旅行で一番興味がある旅行先タイプを1つ選んでください。",
    "single_choice",
    1,
    {
      options: [
        { value: "city", label: "都市観光" },
        { value: "resort", label: "ビーチ・リゾート" },
        { value: "heritage", label: "歴史・文化遺産" },
        { value: "nature", label: "自然・絶景" },
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
          { source: "answer", when: { equals: "resort" }, next: "Q3_TRAVEL_CONTEXT" },
          { source: "answer", when: { equals: "other" }, next: "Q5_OTHER_DESTINATION" }
        ]
      }
    }
  ),
  question(
    "Q2_REASON",
    "その旅行先タイプに興味がある理由を短く教えてください。",
    "free_text_short",
    2,
    {
      max_length: 180,
      placeholder: "例: 街歩きや現地の食事を楽しみながら、短期間でも充実感がありそうだから",
      helpText: "短い回答や「普通」などでAI深堀りを確認します。",
      meta: probeMeta("興味がある旅行先タイプの理由を取得する", ["destination_type", "reason"]),
      conversationControl: {
        coreInfoPrompt: "その旅行先タイプに興味がある理由を、食事・景色・文化・買い物・休息のどれに近いか含めて教えてください",
        answerExample: "街歩きや現地の食事を楽しみながら、短期間でも充実感がありそうだから",
        shortAnswerMinLength: 18,
        sufficientAnswerMinLength: 45
      }
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "旅行先タイプ、理由、具体的な国や地域が薄ければ確認する。"
    }
  ),
  question(
    "Q3_TRAVEL_CONTEXT",
    "海外旅行の経験や、行くとしたら誰とどんなタイミングで行きたいか教えてください。",
    "free_text_long",
    3,
    {
      placeholder: "例: 数年前に友人と台湾へ行きました。次は長期休みに家族でゆっくり行きたいです。",
      helpText: "free_text_long とAI深堀り確認用です。",
      meta: probeMeta("海外旅行経験と旅行場面を取得する", ["travel_experience", "travel_scene"]),
      conversationControl: {
        coreInfoPrompt: "海外旅行経験、同行者、行きたいタイミングを教えてください",
        answerExample: "数年前に友人と台湾へ行きました。次は長期休みに家族でゆっくり行きたいです。",
        shortAnswerMinLength: 18,
        sufficientAnswerMinLength: 60
      }
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "経験有無、同行者、時期、目的が抜けていれば確認する。"
    }
  ),
  question(
    "Q4_MEMORY",
    "海外旅行で印象に残っている体験や、行ってみたい理由があれば教えてください。",
    "free_text_long",
    4,
    {
      placeholder: "例: 現地の市場で食べた料理が印象的で、その土地の生活に触れられた感じがしました。",
      meta: probeMeta("印象に残る旅行体験や行きたい理由を取得する", ["memory_or_expectation", "reason"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "場所、体験、印象に残った理由を確認する。"
    }
  ),
  question(
    "Q5_OTHER_DESTINATION",
    "「その他」を選んだ方は、興味がある旅行先タイプと理由を教えてください。",
    "free_text_short",
    5,
    {
      max_length: 180,
      placeholder: "例: クルーズ旅行です。移動しながら複数の国を見られるのが魅力だからです。",
      meta: probeMeta("その他旅行先タイプと理由を取得する", ["destination_type", "reason"])
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "旅行先タイプだけなら理由を、理由だけならタイプを確認する。"
    }
  ),
  question(
    "Q6_MULTI",
    "海外旅行先を選ぶ時に重視する点をすべて選んでください。",
    "multi_choice",
    6,
    {
      min_select: 1,
      max_select: 5,
      options: [
        { value: "cost", label: "費用が手頃" },
        { value: "safety", label: "治安・安心感" },
        { value: "food", label: "食事が楽しめる" },
        { value: "language", label: "言語面の安心" },
        { value: "flight", label: "移動時間が短い" },
        { value: "culture", label: "文化体験ができる" }
      ],
      helpText: "multi_choice と includes 分岐確認用です。"
    },
    {
      answer_output_type: "array",
      branch_rule: {
        default_next: "Q7_MATRIX_SINGLE",
        branches: [{ source: "answer", when: { includes: "safety" }, next: "Q6_BARRIER_REASON" }]
      }
    }
  ),
  question(
    "Q6_BARRIER_REASON",
    "治安・安心感を重視すると答えた方は、どんな不安や条件が気になるか教えてください。",
    "free_text_short",
    7,
    {
      max_length: 180,
      placeholder: "例: 夜の移動や病気になった時の対応が不安なので、日本語サポートがあると安心です。",
      meta: probeMeta("旅行時の不安や安心条件を取得する", ["travel_barrier", "safe_condition"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "治安、医療、言語、移動、サポートのどれが不安か確認する。",
      branch_rule: { default_next: "Q7_MATRIX_SINGLE" }
    }
  ),
  question(
    "Q7_MATRIX_SINGLE",
    "旅行先タイプごとに、今後行きたい度合いに一番近いものを選んでください。",
    "matrix_single",
    8,
    {
      matrix_rows: [
        { value: "city", label: "都市観光" },
        { value: "resort", label: "リゾート" },
        { value: "heritage", label: "歴史・文化" },
        { value: "nature", label: "自然・絶景" }
      ],
      matrix_cols: [
        { value: "low", label: "行きたくない" },
        { value: "middle", label: "どちらともいえない" },
        { value: "high", label: "行きたい" }
      ],
      helpText: "matrix_single 確認用です。"
    },
    { answer_output_type: "object" }
  ),
  question(
    "Q8_MATRIX_MULTI",
    "旅行場面ごとに、重視する条件を選んでください。",
    "matrix_multi",
    9,
    {
      matrix_rows: [
        { value: "family", label: "家族旅行" },
        { value: "friends", label: "友人旅行" },
        { value: "solo", label: "一人旅" }
      ],
      matrix_cols: [
        { value: "cost", label: "費用" },
        { value: "safety", label: "安全" },
        { value: "schedule", label: "日程の組みやすさ" },
        { value: "local_experience", label: "現地体験" }
      ],
      helpText: "matrix_multi 確認用です。"
    },
    { answer_output_type: "object", branch_rule: { default_next: "Q10_NUMERIC" } }
  ),
  question(
    "Q10_NUMERIC",
    "今後1年以内に海外旅行へ行きたい気持ちは1〜5でどれくらいですか。",
    "numeric",
    10,
    {
      min: 1,
      max: 5,
      min_label: "行きたくない",
      max_label: "ぜひ行きたい",
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
    "海外旅行に行きたい気持ちが低い理由を教えてください。",
    "free_text_short",
    11,
    {
      max_length: 180,
      placeholder: "例: 費用が高く、長い休みも取りにくいので今は国内旅行を優先したいです。",
      meta: probeMeta("海外旅行意向が低い理由を取得する", ["travel_barrier", "reason"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "費用、時間、治安、言語、同行者のどれが障壁か確認する。",
      branch_rule: { default_next: "Q10_SD" }
    }
  ),
  question(
    "Q9_HIGH_INTENT",
    "海外旅行に行きたい気持ちが高い理由を教えてください。",
    "free_text_short",
    12,
    {
      max_length: 180,
      placeholder: "例: しばらく行けていないので、現地の食事や街歩きを楽しみたいです。",
      meta: probeMeta("海外旅行意向が高い理由を取得する", ["reason", "travel_scene"])
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
    "海外旅行の印象について、左が「不安」、右が「楽しみ」として選んでください。",
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
      max_label: "楽しみ",
      helpText: "sd 確認用です。"
    },
    { answer_output_type: "number" }
  ),
  question(
    "Q11_IMAGE_REACTION",
    "画像のような海外旅行イメージを見て、気になる旅行タイプを選んでください。",
    "text_with_image",
    14,
    {
      question_text_image: {
        mainUrl: images.travel,
        alt: "海外旅行のイメージ",
        caption: "画像付き設問と画像カード選択肢の確認用です。"
      },
      display_format: "card",
      grid_cols: 3,
      options: [
        { value: "city", label: "都市観光", title: "都市観光", description: "街歩き・買い物", imageUrl: images.city },
        { value: "beach", label: "ビーチ", title: "ビーチ", description: "休暇・リラックス", imageUrl: images.beach },
        { value: "heritage", label: "歴史文化", title: "歴史文化", description: "建築・食文化", imageUrl: images.heritage }
      ],
      meta: probeMeta("旅行画像への反応と選択理由を取得する", ["image_reaction", "reason"])
    },
    {
      answer_output_type: "object",
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "画像のどの要素が旅行意向につながったか確認する。"
    }
  ),
  question(
    "Q12_UPLOAD",
    "もし海外旅行の写真や行きたい場所のスクリーンショットがあればアップロードしてください。なければ任意のテスト画像で構いません。",
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
      options: [{ value: "overseas_travel_test", label: "海外旅行経験調査テスト" }],
      default_value: "overseas_travel_test",
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
        { value: "overseas_travel", label: "海外旅行" }
      ],
      default_values: ["all_types", "ai_probe", "overseas_travel"],
      helpText: "hidden_multi 保存確認用です。"
    },
    { required: false, answer_output_type: "array", is_hidden: false }
  ),
  question(
    "Q14_MATRIX_MIXED",
    "次の海外旅行条件について、当てはまるものを入力・選択してください。",
    "matrix_mixed",
    18,
    {
      matrix_rows: [
        { value: "budget", label: "予算感", answer_type: "single_choice" },
        { value: "schedule", label: "旅行日数", answer_type: "single_choice" },
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
    "最後に、海外旅行や旅行予約サービスに期待することを自由に教えてください。",
    "free_text_long",
    19,
    {
      placeholder: "例: 予算、治安、現地移動、日本語サポートがまとめて分かると予約しやすいです。",
      meta: probeMeta("自由コメントから期待や改善点を取得する", ["service_idea"])
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "期待、困りごと、具体的なサービス案のどれかを確認する。"
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
    display_name: "海外旅行経験調査テストユーザー",
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
