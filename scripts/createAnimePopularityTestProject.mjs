import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

loadDotEnv();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const projectId = "00000000-0000-4000-8000-0000000000a1";
const respondentLineUserId = "TEST_ANIME_USER";
const now = new Date().toISOString();
const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const probeTargets = [
  "Q2_REASON",
  "Q3_VIEWING_CONTEXT",
  "Q4_CHARACTER_MEMORY",
  "Q5_OTHER_GENRE",
  "Q6_STREAMING_REASON",
  "Q9_LOW_INTENT",
  "Q9_HIGH_INTENT",
  "Q11_IMAGE_REACTION",
  "Q14_FREE_COMMENT"
];

const images = {
  anime: "https://images.unsplash.com/photo-1612036782180-6f0b6cd846fe?auto=format&fit=crop&w=900&q=80",
  action: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=600&q=80",
  slice: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=600&q=80",
  fantasy: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=600&q=80"
};

function probeMeta(questionGoal, requiredSlots) {
  return {
    research_goal: "アニメ人気調査で、好きなジャンル・視聴場面・評価理由・継続視聴条件を具体化する",
    question_goal: questionGoal,
    probe_goal: "短い回答、抽象的な回答、理由が薄い回答に対して、作品例・視聴場面・魅力・不満を1つずつ確認する",
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
  name: "アニメ人気調査テスト（全回答形式・AI深堀り）",
  client_name: "Internal Test",
  objective: "好きなアニメジャンル、視聴頻度、魅力、不満、継続視聴意向、ビジュアル反応を全回答形式で収集し、AI深堀りの発火確認に使う。",
  status: "active",
  reward_points: 10,
  research_mode: "interview",
  display_mode: "survey_question",
  primary_objectives: [
    "アニメ人気調査テーマで全question_typeのLIFF表示と回答保存を確認する",
    "短い自由記述に対するAI深堀り設定を多めに確認する",
    "single_choice、multi_choice、numericの分岐を確認する"
  ],
  secondary_objectives: [
    "画像付き選択肢、画像アップロード、hidden項目の保存形式を確認する",
    "好きな理由、視聴場面、継続条件、改善要望を具体化する"
  ],
  comparison_constraints: ["特定作品の公式評価ではなくテスト回答を前提とする", "ネタバレを求めない"],
  prompt_rules: [
    "アニメ人気調査の文脈から外れない",
    "深堀りは一度に一つの観点だけ尋ねる",
    "ジャンル、作品例、キャラクター、世界観、視聴場面、不満のいずれかを具体化する"
  ],
  probe_policy: {
    enabled: true,
    conditions: ["short_answer", "abstract_answer"],
    max_probes_per_answer: 3,
    max_probes_per_session: 10,
    require_question_probe_enabled: true,
    target_question_codes: probeTargets,
    blocked_question_codes: [
      "Q1_GENRE",
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
    project_goal: "アニメ人気調査で全回答形式とAI深堀りを検証する",
    user_understanding_goal: "好きなジャンル、作品例、魅力、視聴場面、不満、継続条件を具体的に理解する",
    required_slots: [
      { key: "favorite_genre", label: "好きなジャンル", required: true, examples: ["バトル", "日常", "ファンタジー"] },
      { key: "reason", label: "好きな理由", required: true, examples: ["世界観", "キャラクター", "テンポ"] },
      { key: "viewing_scene", label: "視聴場面", required: true, examples: ["夜", "休日", "通勤中"] },
      { key: "viewing_barrier", label: "視聴障壁", required: false, examples: ["話数が多い", "配信サービス", "時間がない"] }
    ],
    optional_slots: [
      { key: "image_reaction", label: "ビジュアルへの反応", required: false },
      { key: "feature_idea", label: "配信・推薦への期待", required: false }
    ],
    question_categories: ["ジャンル嗜好", "視聴行動", "キャラクター", "継続意向", "ビジュアル反応"],
    probe_policy: {
      default_max_probes: 3,
      force_probe_on_bad: true,
      strict_topic_lock: true,
      allow_followup_expansion: false
    },
    completion_rule: {
      required_slots_needed: ["favorite_genre", "reason", "viewing_scene"],
      allow_finish_without_optional: true,
      min_required_slots_to_finish: 3
    },
    language: "ja",
    probe_guideline: "回答が短い場合は、どんな作品・キャラ・場面・魅力なのかを1つずつ聞く。"
  },
  created_at: now,
  updated_at: now
};

const questions = [
  question(
    "Q1_GENRE",
    "一番好きなアニメジャンルを1つ選んでください。",
    "single_choice",
    1,
    {
      options: [
        { value: "battle", label: "バトル・アクション" },
        { value: "slice_of_life", label: "日常・青春" },
        { value: "fantasy", label: "ファンタジー・異世界" },
        { value: "mystery", label: "ミステリー・サスペンス" },
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
          { source: "answer", when: { equals: "slice_of_life" }, next: "Q3_VIEWING_CONTEXT" },
          { source: "answer", when: { equals: "other" }, next: "Q5_OTHER_GENRE" }
        ]
      }
    }
  ),
  question(
    "Q2_REASON",
    "そのジャンルが好きな理由を短く教えてください。",
    "free_text_short",
    2,
    {
      max_length: 180,
      placeholder: "例: 迫力のある展開とキャラクターの成長が見ていて熱くなるから",
      helpText: "短い回答や「普通」などでAI深堀りを確認します。",
      meta: probeMeta("好きなジャンルの理由を取得する", ["favorite_genre", "reason"]),
      conversationControl: {
        coreInfoPrompt: "そのジャンルが好きな理由を、展開・キャラクター・世界観・感情移入のどれに近いか含めて教えてください",
        answerExample: "迫力のある展開とキャラクターの成長が見ていて熱くなるから",
        shortAnswerMinLength: 18,
        sufficientAnswerMinLength: 45
      }
    },
    { ai_probe_enabled: true, max_probe_count: 3, probe_guideline: "作品例、魅力、他ジャンルとの差が薄ければ確認する。" }
  ),
  question(
    "Q3_VIEWING_CONTEXT",
    "アニメを見る頻度や、どんなタイミングで見ることが多いか教えてください。",
    "free_text_long",
    3,
    {
      placeholder: "例: 平日の夜に1〜2話ずつ、休日はまとめて見ることが多いです。",
      helpText: "free_text_long とAI深堀り確認用です。",
      meta: probeMeta("視聴頻度と視聴タイミングを取得する", ["viewing_frequency", "viewing_scene"]),
      conversationControl: {
        coreInfoPrompt: "どのくらいの頻度で、どんな時間帯や気分の時に見ることが多いか教えてください",
        answerExample: "平日の夜に1〜2話ずつ、休日はまとめて見ることが多いです。",
        shortAnswerMinLength: 18,
        sufficientAnswerMinLength: 60
      }
    },
    { ai_probe_enabled: true, max_probe_count: 3, probe_guideline: "頻度、時間帯、視聴きっかけが抜けていれば確認する。" }
  ),
  question(
    "Q4_CHARACTER_MEMORY",
    "印象に残っているキャラクターやシーンがあれば教えてください。",
    "free_text_long",
    4,
    {
      placeholder: "例: 主人公が仲間を守る場面が印象的で、そこから作品に引き込まれました。",
      meta: probeMeta("印象に残るキャラクターやシーンを取得する", ["character_or_scene", "reason"])
    },
    { required: false, ai_probe_enabled: true, max_probe_count: 3, probe_guideline: "キャラ・シーン・印象に残った理由を確認する。" }
  ),
  question(
    "Q5_OTHER_GENRE",
    "「その他」を選んだ方は、好きなジャンル名と理由を教えてください。",
    "free_text_short",
    5,
    {
      max_length: 180,
      placeholder: "例: スポーツものです。チームで成長する過程が好きだからです。",
      meta: probeMeta("その他ジャンルの名称と理由を取得する", ["favorite_genre", "reason"])
    },
    { ai_probe_enabled: true, max_probe_count: 3, probe_guideline: "ジャンル名だけなら理由を、理由だけならジャンル名を確認する。" }
  ),
  question(
    "Q6_MULTI",
    "アニメを選ぶ時に重視する点をすべて選んでください。",
    "multi_choice",
    6,
    {
      min_select: 1,
      max_select: 5,
      options: [
        { value: "story", label: "ストーリー" },
        { value: "character", label: "キャラクター" },
        { value: "visual", label: "作画・映像" },
        { value: "music", label: "音楽・主題歌" },
        { value: "streaming", label: "配信で見やすい" },
        { value: "recommendation", label: "おすすめされている" }
      ],
      helpText: "multi_choice と includes 分岐確認用です。"
    },
    {
      answer_output_type: "array",
      branch_rule: {
        default_next: "Q7_MATRIX_SINGLE",
        branches: [{ source: "answer", when: { includes: "streaming" }, next: "Q6_STREAMING_REASON" }]
      }
    }
  ),
  question(
    "Q6_STREAMING_REASON",
    "配信で見やすいことを重視すると答えた方は、どんな配信条件だと見始めやすいか教えてください。",
    "free_text_short",
    7,
    {
      max_length: 180,
      placeholder: "例: 1話20分程度で、全話まとめて配信されていると見始めやすいです。",
      meta: probeMeta("重視する配信条件を取得する", ["streaming_condition", "reason"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "配信サービス、話数、更新頻度、視聴時間のどれが重要か確認する。",
      branch_rule: { default_next: "Q7_MATRIX_SINGLE" }
    }
  ),
  question(
    "Q7_MATRIX_SINGLE",
    "ジャンルごとに、今後見たい度合いに一番近いものを選んでください。",
    "matrix_single",
    8,
    {
      matrix_rows: [
        { value: "battle", label: "バトル" },
        { value: "slice_of_life", label: "日常" },
        { value: "fantasy", label: "ファンタジー" },
        { value: "mystery", label: "ミステリー" }
      ],
      matrix_cols: [
        { value: "low", label: "見たくない" },
        { value: "middle", label: "どちらともいえない" },
        { value: "high", label: "見たい" }
      ],
      helpText: "matrix_single 確認用です。"
    },
    { answer_output_type: "object" }
  ),
  question(
    "Q8_MATRIX_MULTI",
    "視聴場面ごとに、重視する要素を選んでください。",
    "matrix_multi",
    9,
    {
      matrix_rows: [
        { value: "weekday_night", label: "平日の夜" },
        { value: "weekend_binge", label: "休日にまとめ見" },
        { value: "commute", label: "移動中" }
      ],
      matrix_cols: [
        { value: "short_episode", label: "短い話数" },
        { value: "immersive_story", label: "没入感" },
        { value: "light_mood", label: "気軽さ" },
        { value: "cliffhanger", label: "続きが気になる展開" }
      ],
      helpText: "matrix_multi 確認用です。"
    },
    { answer_output_type: "object", branch_rule: { default_next: "Q10_NUMERIC" } }
  ),
  question(
    "Q10_NUMERIC",
    "新しいアニメ作品を見始めたい気持ちは1〜5でどれくらいですか。",
    "numeric",
    10,
    {
      min: 1,
      max: 5,
      min_label: "見始めたくない",
      max_label: "ぜひ見始めたい",
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
    "新しい作品を見始めたい気持ちが低い理由を教えてください。",
    "free_text_short",
    11,
    {
      max_length: 180,
      placeholder: "例: すでに見ている作品が多く、新しい作品に時間を使いにくいからです。",
      meta: probeMeta("新規視聴意向が低い理由を取得する", ["viewing_barrier", "reason"])
    },
    {
      required: false,
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "時間、話数、配信環境、興味の不足のどれが障壁か確認する。",
      branch_rule: { default_next: "Q10_SD" }
    }
  ),
  question(
    "Q9_HIGH_INTENT",
    "新しい作品を見始めたい気持ちが高い理由を教えてください。",
    "free_text_short",
    12,
    {
      max_length: 180,
      placeholder: "例: 話題作を早めに見て、SNSで感想を追いたいからです。",
      meta: probeMeta("新規視聴意向が高い理由を取得する", ["reason", "viewing_scene"])
    },
    { required: false, ai_probe_enabled: true, max_probe_count: 3, branch_rule: { default_next: "Q10_SD" } }
  ),
  question(
    "Q10_SD",
    "最近のアニメ作品の印象について、左が「難しい」、右が「入り込みやすい」として選んでください。",
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
      min_label: "難しい",
      max_label: "入り込みやすい",
      helpText: "sd 確認用です。"
    },
    { answer_output_type: "number" }
  ),
  question(
    "Q11_IMAGE_REACTION",
    "画像のようなアニメ風ビジュアルを見て、気になる方向性を選んでください。",
    "text_with_image",
    14,
    {
      question_text_image: {
        mainUrl: images.anime,
        alt: "アニメ風ビジュアル",
        caption: "画像付き設問と画像カード選択肢の確認用です。"
      },
      display_format: "card",
      grid_cols: 3,
      options: [
        { value: "action", label: "アクション", title: "アクション", description: "勢いのある展開", imageUrl: images.action },
        { value: "slice", label: "日常", title: "日常", description: "落ち着いて見られる", imageUrl: images.slice },
        { value: "fantasy", label: "ファンタジー", title: "ファンタジー", description: "世界観を楽しむ", imageUrl: images.fantasy }
      ],
      meta: probeMeta("ビジュアルへの反応と選択理由を取得する", ["image_reaction", "reason"])
    },
    {
      answer_output_type: "object",
      ai_probe_enabled: true,
      max_probe_count: 3,
      probe_guideline: "ビジュアルのどの要素が興味につながったか確認する。"
    }
  ),
  question(
    "Q12_UPLOAD",
    "もし好きなアニメ関連の画像や、視聴メモのスクリーンショットがあればアップロードしてください。なければ任意のテスト画像で構いません。",
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
      options: [{ value: "anime_popularity_test", label: "アニメ人気調査テスト" }],
      default_value: "anime_popularity_test",
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
        { value: "anime", label: "アニメ人気" }
      ],
      default_values: ["all_types", "ai_probe", "anime"],
      helpText: "hidden_multi 保存確認用です。"
    },
    { required: false, answer_output_type: "array", is_hidden: false }
  ),
  question(
    "Q14_MATRIX_MIXED",
    "次のアニメ視聴条件について、当てはまるものを入力・選択してください。",
    "matrix_mixed",
    18,
    {
      matrix_rows: [
        { value: "episode_length", label: "1話の長さ", answer_type: "single_choice" },
        { value: "season_length", label: "全体の話数", answer_type: "single_choice" },
        { value: "comment", label: "一言コメント", answer_type: "free_text_short" }
      ],
      matrix_cols: [
        { value: "short", label: "短め" },
        { value: "middle", label: "普通" },
        { value: "long", label: "長め" },
        { value: "important", label: "重要" },
        { value: "not_important", label: "重要でない" }
      ],
      helpText: "matrix_mixed 確認用です。"
    },
    { answer_output_type: "object" }
  ),
  question(
    "Q14_FREE_COMMENT",
    "最後に、アニメ作品や配信サービスに期待することを自由に教えてください。",
    "free_text_long",
    19,
    {
      placeholder: "例: 作品の雰囲気や話数が事前に分かると、見始めやすいです。",
      meta: probeMeta("自由コメントから期待や改善点を取得する", ["feature_idea"])
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
    display_name: "アニメ人気調査テストユーザー",
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
