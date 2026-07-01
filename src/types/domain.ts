export type UUID = string;

export type ProjectStatus = "draft" | "ready" | "published" | "paused" | "closed" | "archived";
export type DeliveryType =
  | "new_project"   // 新着案件
  | "interview"     // インタビュー
  | "survey"        // アンケート
  | "daily_survey"  // デイリーアンケート
  | "high_point"    // 高ポイント案件
  | "urgent";       // 緊急募集
export type ResearchMode = "survey_interview" | "interview";
export type RespondentStatus = "invited" | "active" | "completed" | "dropped";
export type SessionStatus = "pending" | "active" | "completed" | "abandoned";
export type SessionPhase = "question" | "ai_probe" | "free_comment" | "completed";
export type SenderType = "user" | "system" | "assistant";
export type ProjectAssignmentType = "manual" | "rule_based";
export type ProjectAssignmentStatus =
  | "pending"
  | "assigned"
  | "sent"
  | "opened"
  | "started"
  | "completed"
  | "expired"
  | "cancelled";
export type ScreeningResult = "passed" | "failed";
export type ScreeningPassAction = "survey" | "interview" | "manual_hold";
export type ScreeningConditionType = "profile" | "question";
export type ScreeningOperator = "equals" | "not_equals" | "in" | "not_in" | "gte" | "lte" | "between";
export type ScreeningJudgement = "pass" | "fail";
export type MaritalStatus = "single" | "married" | "divorced" | "widowed";

/** プロジェクト単位の表示モード (016_question_schema_redesign) */
export type DisplayMode = "survey_page" | "survey_question" | "interview_chat";

export type QuestionRole =
  | "screening"
  | "main"
  | "probe_trigger"
  | "attribute"
  | "comparison_core"
  | "free_comment";

/**
 * QuestionType: Phase1 拡張型
 * DB 制約は 016_question_schema_redesign.sql 参照
 * 後方互換型は同ファイルで "後方互換" として許容しておく（DBがまだ受け入れる値）
 */
export type QuestionType =
  // 後方互換（migration 016以前のデータ用。DB CHECK制約で引き続き許容）
  | "text"
  | "scale"
  | "single_select"
  | "multi_select"
  | "yes_no"
  // 選択系
  | "single_choice"
  | "multi_choice"
  // マトリクス系
  | "matrix_single"
  | "matrix_multi"
  | "matrix_mixed"
  // テキスト系
  | "free_text_short"
  | "free_text_long"
  // 数値
  | "numeric"
  // 画像
  | "image_upload"
  // 隠し項目
  | "hidden_single"
  | "hidden_multi"
  // 画像付きテキスト
  | "text_with_image"
  // SD法
  | "sd";
export type AnswerRole = "primary" | "ai_probe";
export type ExtractionMode = "none" | "single_object" | "multi_object";
export type ExtractionTarget = "post_answer" | "post_session";
export type ExtractionStatus = "pending" | "completed" | "partial" | "failed" | "skipped";
export type ExtractionMethod = "rule_based" | "ai_assisted";
export type QuestionBranchSource = "answer" | "extracted";
export type UserPostType = "survey" | "interview" | "free_comment" | "rant" | "diary";
export type PostSourceChannel = "line" | "liff" | "admin" | "system";
export type PostQualityLabel = "low" | "medium" | "high";
export type PostSentiment = "positive" | "neutral" | "negative" | "mixed";
export type PostActionability = "high" | "medium" | "low";
export type PostInsightType = "issue" | "request" | "complaint" | "praise" | "other";
export type MenuActionKey =
  | "survey"
  | "interview"
  | "free_comment"
  | "rant"
  | "diary"
  | "personality";
export type LineMenuActionType =
  | "start_project_list"
  | "resume_project"
  | "open_post_mode"
  | "open_liff"
  | "show_mypage"
  | "show_personality";
export type PointTransactionType =
  | "project_completion"
  | "first_bonus"
  | "continuity_bonus"
  | "project_bonus"
  | "manual_adjustment";
export type ProbeCondition = "short_answer" | "abstract_answer";
export type StructuredProbeType = "missing_slot" | "concretize" | "clarify";
export type AnswerAnalysisAction = "ask_next" | "probe" | "skip" | "finish";
export type QuestionProbePriority = "missing" | "bad_pattern" | "low_specificity";
export type QuestionProbeStopCondition =
  | "sufficient_slots"
  | "high_quality"
  | "no_new_information"
  | "repetition_risk";
export type ProjectAIStateTemplateKey =
  | "product_feedback"
  | "ux_research"
  | "emotion_value"
  | "pain_request"
  | "diary_rant";
export type ProbeEndCondition =
  | "answer_sufficient"
  | "max_probes_per_answer"
  | "max_probes_per_session"
  | "question_not_target"
  | "question_blocked"
  | "user_declined";

export interface ProjectProbePolicy {
  enabled?: boolean;
  conditions?: ProbeCondition[];
  max_probes_per_answer?: number;
  max_probes_per_session?: number;
  require_question_probe_enabled?: boolean;
  target_question_codes?: string[];
  blocked_question_codes?: string[];
  short_answer_min_length?: number;
  end_conditions?: ProbeEndCondition[];
}

export interface ProjectResponseStyle {
  channel?: "line";
  tone?: string;
  max_characters_per_message?: number;
  max_sentences?: number;
}

export interface ProjectAISlot {
  key: string;
  label: string;
  required?: boolean;
  description?: string;
  examples?: string[];
}

export interface ProjectAIProbePolicy {
  default_max_probes?: number;
  force_probe_on_bad?: boolean;
  strict_topic_lock?: boolean;
  allow_followup_expansion?: boolean;
}

export interface ProjectAICompletionRule {
  required_slots_needed?: string[];
  allow_finish_without_optional?: boolean;
  min_required_slots_to_finish?: number;
}

export interface ProjectAITopicControl {
  forbidden_topic_shift?: boolean;
  topic_lock_note?: string;
}

export interface ProjectAIState {
  version?: string;
  template_key?: ProjectAIStateTemplateKey | string | null;
  project_goal?: string;
  user_understanding_goal?: string;
  required_slots?: ProjectAISlot[];
  optional_slots?: ProjectAISlot[];
  question_categories?: string[];
  probe_policy?: ProjectAIProbePolicy;
  completion_rule?: ProjectAICompletionRule;
  topic_control?: ProjectAITopicControl;
  language?: string;
  probe_guideline?: string;
}

export interface AIPromptPolicy {
  researchType?: string;
  audience?: string;
  probeStyle?: string;
  noneAnswerPolicy?: string;
  ambiguousAnswerRule?: string;
  freeAnswerPolicy?: string;
  restrictions?: string[];
  priority?: string;
}

export interface AIPromptTemplateEntry {
  enabled?: boolean;
  template?: string;
}

export type AIPromptTemplateMap = {
  [promptKey: string]: AIPromptTemplateEntry;
}

/**
 * プロンプトビルダー方針 (Migration 062 / Phase F)。
 * パッケージ Version に保持する「AIの振る舞い方針」。Version 作成/編集時の
 * テンプレート AI 生成の入力 兼 再編集用ソース。実行時には参照しない。
 */
export interface PromptBuilderSpec {
  /**
   * 振る舞い方針（自由記述・主役）。このパッケージが何を目的に・どう振る舞うかを散文で記す。
   * Version 編集画面の最上部に常時表示し、テンプレート AI 生成の主入力になる。
   */
  behaviorPolicy?: string;
  /** 用途プリセット（粗い識別ラベル。例: インタビュー / Website Hunter / カスタム） */
  usagePreset?: string;
  /** 深掘り強度（粗い。例: 最小限 / 標準 / 積極的 / 徹底深掘り） */
  probeIntensity?: string;
  /** 出力品質方針（粗い。例: 速度優先 / バランス / 精度優先） */
  outputQuality?: string;
  purpose?: string;
  goal?: string;
  targetUser?: string;
  aiPersona?: string;
  questionStyle?: string;
  probePolicy?: string;
  completionCondition?: string;
  ambiguousAnswer?: string;
  noneAnswer?: string;
  outputFormatNote?: string;
  prohibitions?: string[];
}

/**
 * プロジェクト個別オーバーライド (Migration 057 / Phase 6-B)。
 * package モード時にパッケージ設定へ部分的に上書きする。
 * 初期実装では policy のみ対応（テンプレート本文の上書きはパッケージ中心管理を崩すため未対応）。
 */
export interface AIPromptOverrides {
  policy?: AIPromptPolicy;
}

export interface ScreeningConfig {
  enabled?: boolean;
  pass_message?: string | null;
  fail_message?: string | null;
  pass_action?: ScreeningPassAction;
}

export interface ScreeningCondition {
  id: UUID;
  project_id: UUID;
  condition_type: ScreeningConditionType;
  /** profile 条件: フィールド名 (age/gender/prefecture 等), question 条件: question_code */
  target_key: string;
  operator: ScreeningOperator;
  /** 比較値。単値 | 配列 | [min, max] */
  value_json: unknown;
  priority: number;
  created_at: string;
}

export interface Project {
  id: UUID;
  name: string;
  /** USERに表示するタイトル。未設定時は name にフォールバックする */
  user_display_title?: string | null;
  /** コンセプト・ローテーション方式（L1・migration 070）: off|latin|full */
  concept_rotation_mode?: import("../lib/latinSquare").ConceptRotationMode;
  /** 設問順ランダマイズの簡単トグル（パターン1・migration 071）。ブロック不要。 */
  randomize_question_order?: boolean;
  client_name: string | null;
  objective: string | null;
  status: ProjectStatus;
  reward_points: number;
  research_mode: ResearchMode;
  /** 表示モード: survey_page | survey_question | interview_chat */
  display_mode: DisplayMode;
  primary_objectives: string[];
  secondary_objectives: string[];
  comparison_constraints: string[];
  prompt_rules: string[];
  probe_policy: ProjectProbePolicy | null;
  response_style: ProjectResponseStyle | null;
  ai_state_json: ProjectAIState | null;
  ai_state_template_key: string | null;
  ai_state_generated_at: string | null;
  screening_config: ScreeningConfig | null;
  screening_last_question_order: number | null;
  /** AIプロンプト方針設定 */
  ai_prompt_policy_json: AIPromptPolicy | null;
  /** ベースプロンプトテンプレート上書き設定 */
  ai_prompt_templates_json: AIPromptTemplateMap | null;
  /** プロンプト設定方式: custom=個別設定 / package=パッケージ適用 (Migration 054) */
  ai_prompt_mode: 'custom' | 'package';
  /** パッケージモード時に参照するバージョンID (Migration 054) */
  ai_prompt_package_version_id: UUID | null;
  /** パッケージモード時の個別オーバーライド（policy のみ）(Migration 057) */
  ai_prompt_overrides_json?: AIPromptOverrides | null;
  /** 配信可能フラグ。true の場合のみ自動配信テンプレートの対象になる */
  delivery_enabled: boolean;
  /** 配信分類。配信テンプレートの target_types 条件に使用 */
  delivery_type: DeliveryType | null;
  /** 最後に自動配信が完了した日時 */
  delivered_at: string | null;
  /** 公開区分: public=通常案件(探すに表示) / private_store=店舗専用(entry_code流入のみ) (Migration 064) */
  visibility_type: 'public' | 'private_store';
  /** 店舗流入キー。private_store 案件で専用URL/QR の判定に使う (Migration 064) */
  entry_code: string | null;
  /** 企業/店舗マスタへの参照（任意） (Migration 064) */
  client_id: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionOption {
  value: string;
  label: string;
  /** 「その他」等で自由記述欄を出すか（記述あり/なし・L3）。 */
  allow_free_text?: boolean;
  imageUrl?: string;
  /** 複数画像（画像付きマトリクス行や画像カード複数画像対応） */
  imageUrls?: string[];
  /** カード表示時のタイトル（labelと別に設定する場合） */
  title?: string;
  /** 補足説明（マトリクス行・カード選択肢） */
  description?: string;
  /** スクリーニング通過対象フラグ（is_screening_question=true の設問のみ有効） */
  isScreeningPass?: boolean;
}

export interface ImageUploadConfig {
  max_count?: number;
  allowed_types?: string[];
  max_size_mb?: number;
  instructions?: string;
  /** テキスト補足入力モード: optional=任意, required=必須, hidden=非表示(デフォルト) */
  text_input_mode?: 'optional' | 'required' | 'hidden';
}

export interface QuestionTextImage {
  mainUrl: string | null;
  additionalUrls: string[];
  caption: string | null;
}

export interface LegacyBranchRuleCondition {
  operator: "equals" | "not_equals" | "includes" | "gte" | "lte";
  value: string | number | boolean;
}

export interface LegacyBranchRule {
  when: LegacyBranchRuleCondition;
  targetQuestionCode: string;
}

export interface QuestionBranchCondition {
  equals?: string | number | boolean;
  includes?: string | number | boolean;
  any_of?: Array<string | number | boolean>;
  gte?: number;
  lte?: number;
}

export interface QuestionBranchRoute {
  source?: QuestionBranchSource;
  field?: string | null;
  when: QuestionBranchCondition;
  next: string;
}

export interface QuestionBranchRule {
  default_next?: string | null;
  branches?: QuestionBranchRoute[];
  merge_question_code?: string | null;
}

export interface QuestionExtractionFieldOption {
  value: string;
  label?: string;
  aliases?: string[];
}

export interface QuestionExtractionField {
  key: string;
  label?: string;
  description?: string;
  type?: "string" | "number" | "enum" | "boolean";
  required?: boolean;
  aliases?: string[];
  options?: QuestionExtractionFieldOption[];
  summary_key?: string;
}

export interface QuestionExtractionSchema {
  version?: string;
  entity_name?: string;
  entity_label?: string;
  array_field?: string;
  fields?: QuestionExtractionField[];
}

export interface QuestionExtractionConfig {
  mode?: ExtractionMode;
  schema?: QuestionExtractionSchema | null;
  target?: ExtractionTarget;
  extracted_branch_enabled?: boolean;
}

/** 選択肢グループ（果物/服/動物 のような群）。 */
export interface OptionGroup {
  label?: string;
  /** この群に属する選択肢 value */
  values: string[];
}

/** 選択肢ランダム化設定（L3）。 */
export interface OptionRandomizationConfig {
  /** 選択肢順をランダム化するか */
  enabled?: boolean;
  /** 固定する選択肢 value（「その他」「特になし」等のアンカー）。元の位置を保持する。 */
  anchored_values?: string[];
  /** 選択肢グループ（定義があれば群単位で扱う） */
  groups?: OptionGroup[];
  /** 群の順序もランダム化するか */
  randomize_groups?: boolean;
}

export interface QuestionConfig {
  options?: QuestionOption[];
  matrix_cols?: QuestionOption[];
  placeholder?: string;
  max_length?: number;
  example_answer?: string;
  min_select?: number;
  max_select?: number;
  yes_label?: string;
  no_label?: string;
  min?: number;
  max?: number;
  min_label?: string;
  max_label?: string;
  scaleMin?: number;
  scaleMax?: number;
  scaleLabels?: Record<string, string>;
  helpText?: string;
  /** 選択肢表示形式: list=従来リスト, card=画像カードグリッド */
  display_format?: "list" | "card";
  /** カード表示時のグリッド列数 (デフォルト: 2) */
  grid_cols?: number;
  /** マトリクス列見出し表示モード */
  matrix_header_mode?: "normal" | "vertical" | "rotated";
  /** image_upload 設問の設定 */
  image_upload_config?: ImageUploadConfig;
  /** 設問文に付ける画像パッケージ */
  question_text_image?: QuestionTextImage;
  meta?: QuestionMeta;
  /** 選択肢ランダム化設定（L3・選択肢順/グループ/アンカー固定）。 */
  option_randomization?: OptionRandomizationConfig;
  extraction?: QuestionExtractionConfig | null;
  conversationControl?: {
    probeIntent?: string;
    probeType?: string;
    coreInfoPrompt?: string;
    answerExample?: string;
    shortAnswerMinLength?: number;
    sufficientAnswerMinLength?: number;
  };
}

export interface QuestionExpectedSlot {
  key: string;
  label?: string;
  description?: string;
  required?: boolean;
  examples?: string[];
}

export interface QuestionBadAnswerPattern {
  type: "contains" | "exact" | "regex" | "max_length";
  value: string | number;
  note?: string;
}

export interface QuestionProbeConfig {
  max_probes?: number;
  min_probes?: number;
  force_probe_on_bad?: boolean;
  probe_priority?: QuestionProbePriority[];
  stop_conditions?: QuestionProbeStopCondition[];
  allow_followup_expansion?: boolean;
  strict_topic_lock?: boolean;
}

export interface QuestionCompletionCondition {
  type: "min_length" | "required_slots" | "any_slot_filled" | "no_bad_patterns";
  value?: number;
}

export interface QuestionRenderStyle {
  mode?: "default" | "interview_natural" | "free_comment";
  lead_in?: string;
  connect_from_previous_answer?: boolean;
  avoid_question_number?: boolean;
  preserve_options?: boolean;
}

export interface QuestionMeta {
  research_goal?: string;
  question_goal?: string;
  probe_goal?: string;
  expected_slots?: QuestionExpectedSlot[];
  required_slots?: string[];
  skippable_if_slots_present?: string[];
  can_prefill_future_slots?: boolean;
  skip_forbidden_on_bad_answer?: boolean;
  bad_answer_patterns?: QuestionBadAnswerPattern[];
  probe_config?: QuestionProbeConfig;
  completion_conditions?: QuestionCompletionCondition[];
  render_style?: QuestionRenderStyle;
  /** 統計エクスポート用クリーニングメタの上書き (codebook.ts CleaningOverride)。任意。 */
  cleaning?: Record<string, unknown>;
  /** 明示的な設問間依存（surveyValidation 用）。任意。 */
  dependencies?: Array<Record<string, unknown>>;
}

export interface Question {
  id: UUID;
  project_id: UUID;
  question_code: string;
  question_text: string;
  /** コメント（設問文の上） */
  comment_top: string | null;
  /** コメント（設問文の下・選択肢の上） */
  comment_bottom: string | null;
  question_role: QuestionRole;
  question_type: QuestionType;
  is_required: boolean;
  sort_order: number;
  /** 回答出力タイプ: text | number | boolean | array | object | none */
  answer_output_type: string | null;
  /** PDFタグ仕様に基づく生タグ文字列（互換用） */
  display_tags_raw: string | null;
  /** タグ構造化データ（canonical）。tagParser が生成。こちらを優先して使う。 */
  display_tags_parsed: import("./questionSchema").DisplayTagsParsed | null;
  /** 設問単位の表示条件 (<pipe> の表示制御用途) */
  visibility_conditions: import("./questionSchema").VisibilityCondition[] | null;
  /** survey_page モード用ページグループ */
  page_group_id: UUID | null;
  branch_rule: QuestionBranchRule | LegacyBranchRule[] | null;
  question_config: QuestionConfig | null;
  ai_probe_enabled: boolean;
  probe_guideline?: string | null;
  max_probe_count?: number | null;
  render_strategy?: "static" | "dynamic" | null;
  /** 回答選択肢固定フラグ。true の場合 AI 候補による自動上書きを行わない (017) */
  answer_options_locked: boolean;
  /** スクリーニング設問フラグ (030) */
  is_screening_question: boolean;
  is_system: boolean;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuestionPageGroup {
  id: UUID;
  project_id: UUID;
  page_number: number;
  title: string | null;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** このページ(ブロック)自体をページ間ランダム化の対象にするか（§3・migration 069）。 */
  is_randomizable?: boolean;
  /** ページ(ブロック)内の設問順をランダム化するか（§3）。 */
  randomize_within?: boolean;
  /** ページ(ブロック)内の設問順を固定する（randomize_within より優先・§3）。 */
  fix_within?: boolean;
}

export interface PendingNextQuestionCache {
  sessionId: string;
  nextQuestionId: string;
  nextQuestionVersion: string;
  flowSignature: string;
  collectedFieldSignature: string;
  renderStrategy: "static" | "dynamic";
  renderKey: string;
  questionText?: string;
  createdAt: string;
}

export interface Rank {
  id: UUID;
  rank_code: string;
  rank_name: string;
  min_points: number;
  sort_order: number;
  badge_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface Respondent {
  id: UUID;
  line_user_id: string;
  display_name: string | null;
  project_id: UUID;
  status: RespondentStatus;
  total_points: number;
  current_rank_id: UUID | null;
  created_at: string;
  updated_at: string;
  current_rank?: Rank | null;
  /** テスト回答フラグ（統計エクスポート §17・migration 067）。既定 false。 */
  is_test?: boolean;
}

/** コンセプト（統計エクスポート §3 L1・migration 070）。同一アンケートを複数コンセプト分回答させる単位。 */
export interface ProjectConcept {
  id: UUID;
  project_id: UUID;
  concept_code: string;
  title: string | null;
  description: string | null;
  master_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** 調査票スナップショット（統計エクスポート §1/§14・migration 068）。 */
export interface QuestionnaireSnapshot {
  id: UUID;
  project_id: UUID;
  version: number;
  wave_code: string | null;
  snapshot_hash: string;
  definition_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface ProjectAssignment {
  id: UUID;
  user_id: string;
  project_id: UUID;
  respondent_id: UUID;
  assignment_type: ProjectAssignmentType;
  status: ProjectAssignmentStatus;
  delivery_channel: "liff" | "line";
  filter_snapshot: Record<string, unknown> | null;
  assigned_at: string;
  deadline: string | null;
  due_at?: string | null;
  sent_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  expired_at: string | null;
  reminder_sent_at: string | null;
  last_delivery_error: string | null;
  delivery_log: Record<string, unknown>[] | null;
  screening_result: ScreeningResult | null;
  screening_result_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Gender = "male" | "female" | "other" | "prefer_not_to_say";

export interface UserProfile {
  id: UUID;
  line_user_id: string;
  nickname: string | null;
  birth_date: string | null;
  gender: Gender | null;
  prefecture: string | null;
  address_detail: string | null;
  address_registered_at: string | null;
  address_declined: boolean;
  occupation: string | null;
  occupation_updated_at: string | null;
  industry: string | null;
  marital_status: MaritalStatus | null;
  has_children: boolean | null;
  children_ages: number[];
  household_composition: string[];
  // Phase2-A 追加カラム
  profile_completed: boolean;
  profile_completed_at: string | null;
  notification_ok: boolean;
  is_blocked: boolean;
  is_notification_stopped: boolean;
  fraud_flag: boolean;
  quality_score: number | null;
  ai_eval_score: number | null;
  ai_tags: string[];
  ai_persona_summary: string | null;
  last_login_at: string | null;
  visibility_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SessionState {
  phase?: SessionPhase | null;
  currentQuestionIndex?: number | null;
  pendingQuestionId?: UUID | null;
  pendingProbeQuestion?: string | null;
  pendingProbeSourceQuestionId?: UUID | null;
  pendingProbeSourceAnswerId?: UUID | null;
  pendingProbeReason?: string | null;
  pendingProbeType?: StructuredProbeType | null;
  pendingProbeMissingSlots?: string[] | null;
  pendingFreeComment?: boolean;
  freeCommentPromptShown?: boolean;
  freeCommentProbeAsked?: boolean;
  pendingFreeCommentPrompt?: string | null;
  pendingFreeCommentSourceAnswerId?: UUID | null;
  pendingFreeCommentSourceText?: string | null;
  pendingFreeCommentReason?: "no_content" | "abstract" | StructuredProbeType | null;
  pendingFreeCommentProbeType?: StructuredProbeType | null;
  pendingFreeCommentMissingSlots?: string[] | null;
  finalQuestionCompletedAt?: string | null;
  answersSinceSummary?: number;
  /** マイページ確認済みタイムスタンプ。survey ページの無限リダイレクト防止に使用 */
  mypage_confirmed_at?: string | null;
  /** スクリーニング判定結果 */
  screening_result?: ScreeningJudgement | null;
  /** 落ちた条件の説明文リスト */
  screening_failed_conditions?: string[];
  /** スクリーニング判定実行日時 */
  screening_judged_at?: string | null;
  aiProbeCount?: number;
  aiProbeCountCurrentAnswer?: number;
  aiProbeCountPerQuestion?: Record<string, number>;
  lastQuestionText?: string | null;
  lastQuestionEmbedding?: string[] | null;
  lastProbeType?: StructuredProbeType | null;
  pendingNextQuestionText?: string | null;
  pendingNextQuestionCache?: PendingNextQuestionCache | null;
}

export interface AnswerAnalysisResult {
  action: AnswerAnalysisAction;
  question: string | null;
  reason: string;
  collected_slots: Record<string, string | null>;
  is_sufficient: boolean;
  missing_slots: string[];
  probe_type: StructuredProbeType | null;
  confidence: number;
}

export interface StructuredAnswerSlotValue {
  key: string;
  value: string | null;
  confidence?: number | null;
  evidence?: string | null;
}

export interface StructuredAnswerCompletion {
  is_complete: boolean;
  missing_slots: string[];
  reasons: string[];
  quality_score: number;
}

export interface StructuredAnswerPayload {
  value?: string;
  source?: string;
  reason?: string | null;
  probe_type?: StructuredProbeType | null;
  render_style?: QuestionRenderStyle["mode"] | null;
  structured_summary?: string | null;
  extracted_slots?: StructuredAnswerSlotValue[];
  completion?: StructuredAnswerCompletion | null;
  bad_pattern_matches?: string[];
  comparable_payload?: Record<string, string | string[] | null>;
  extraction?: NormalizedExtractionResult | null;
  extracted_branch_payload?: Record<string, unknown> | null;
  metadata_version?: string;
  [key: string]: unknown;
}

export interface ExtractedEntityRecord {
  index: number;
  fields: Record<string, string | number | boolean | null>;
}

export interface NormalizedExtractionResult {
  mode: ExtractionMode;
  status: ExtractionStatus;
  method: ExtractionMethod;
  target: ExtractionTarget;
  schema_version?: string | null;
  summary: Record<string, unknown>;
  entities: ExtractedEntityRecord[];
  missing_fields?: string[];
  needs_ai_assist?: boolean;
  extracted_at?: string | null;
}

export interface Session {
  id: UUID;
  respondent_id: UUID;
  project_id: UUID;
  current_question_id: UUID | null;
  current_phase: SessionPhase;
  status: SessionStatus;
  summary: string | null;
  state_json: SessionState | null;
  started_at: string;
  completed_at: string | null;
  last_activity_at: string;
  /** ランダム化シード（再現性・§22・migration 069）。 */
  randomization_seed?: string | null;
  /** 実表示順 { question_id: position }（§3・migration 069）。 */
  display_order_json?: Record<string, number> | null;
  /** 回答時点の調査票スナップショット（§1・migration 068）。 */
  snapshot_id?: string | null;
  /** 割り当てられたコンセプト提示順（L1・migration 070）。 */
  concept_order_json?: string[] | null;
}

export interface Message {
  id: UUID;
  session_id: UUID;
  sender_type: SenderType;
  message_text: string;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

export interface Answer {
  id: UUID;
  session_id: UUID;
  question_id: UUID;
  answer_text: string;
  free_text_answer: string | null;
  answer_role: AnswerRole;
  parent_answer_id: UUID | null;
  normalized_answer: Record<string, unknown> | null;
  /** どのコンセプトに対する回答か（L1・migration 070）。単一コンセプトなら null。 */
  concept_code?: string | null;
  created_at: string;
}

export interface AnswerExtraction {
  id: UUID;
  source_answer_id: UUID;
  project_id: UUID;
  question_id: UUID;
  extraction_status: ExtractionStatus;
  extraction_method: ExtractionMethod;
  extracted_json: NormalizedExtractionResult | null;
  extracted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIAnalysisResult {
  id: UUID;
  session_id: UUID;
  summary: string | null;
  usage_scene: string | null;
  motive: string | null;
  pain_points: string | null;
  alternatives: string | null;
  insight_candidates: string | null;
  raw_json: Record<string, unknown> | null;
  created_at: string;
}

export interface AILog {
  id: UUID;
  /** セッション外実行（プロジェクト分析・投稿分析・ペルソナタグ等）は null (Migration 059) */
  session_id: UUID | null;
  purpose: string;
  prompt: string;
  response: string;
  token_usage: Record<string, unknown> | null;
  // Phase 3: プロンプト追跡フィールド
  prompt_key: string | null;
  template_key: string | null;
  template_mode: string | null;
  policy_snapshot: Record<string, unknown> | null;
  rendered_prompt: string | null;
  // Phase 3 (プロンプトパッケージ): パッケージ追跡フィールド (Migration 054)
  package_id: UUID | null;
  package_version_id: UUID | null;
  package_slug: string | null;
  package_version_no: number | null;
  // Phase A (プロンプト管理主体変更): 実行時解決状態スナップショット (Migration 061)
  resolution_json: Record<string, unknown> | null;
  created_at: string;
}

export interface UserPost {
  id: UUID;
  user_id: string;
  respondent_id: UUID | null;
  type: UserPostType;
  project_id: UUID | null;
  session_id: UUID | null;
  answer_id: UUID | null;
  source_channel: PostSourceChannel;
  source_mode: ResearchMode | null;
  menu_action_key: MenuActionKey | string | null;
  title: string | null;
  content: string;
  quality_score: number;
  quality_label: PostQualityLabel;
  metadata: Record<string, unknown> | null;
  posted_on: string | null;
  // 感情・構造化入力（migration 026 以降）
  emotion_tags: string[];
  mood_score: number | null;
  good_thing: string | null;
  bad_thing: string | null;
  selected_prompt_id: UUID | null;
  selected_one_line_id: UUID | null;
  // AI予備フィールド（初期は非表示、feature_flags で段階解禁）
  ai_summary: string | null;
  ai_feedback: string | null;
  ai_sentiment_score: number | null;
  ai_stress_score: number | null;
  ai_detected_topics: unknown[];
  ai_enabled: boolean;
  ai_visible_to_user: boolean;
  // 本音投稿AI一言返信（migration 027）
  ai_reply_text: string | null;
  ai_reply_generated_at: string | null;
  ai_reply_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface RantTag {
  id: UUID;
  code: string;
  label: string;
  emoji: string;
  category: string | null;
  sort_order: number;
  is_active: boolean;
  post_count: number;
}

export interface PostAnalysis {
  id: UUID;
  post_id: UUID;
  analysis_version: string;
  summary: string | null;
  tags: unknown[];
  sentiment: PostSentiment;
  sentiment_score: number | null;
  keywords: unknown[];
  mentioned_brands: unknown[];
  pii_flags: unknown[];
  actionability: PostActionability;
  personality_signals: unknown[];
  behavior_signals: unknown[];
  insight_type: PostInsightType;
  specificity: number;
  novelty: number;
  raw_json: Record<string, unknown> | null;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPersonalityProfile {
  id: UUID;
  user_id: string;
  respondent_id: UUID | null;
  latest_post_id: UUID | null;
  summary: string | null;
  traits: unknown[];
  segments: unknown[];
  confidence: number | null;
  evidence_post_ids: unknown[];
  raw_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface LineMenuAudienceRule {
  min_total_points?: number;
  max_total_points?: number;
  require_active_assignments?: boolean;
  feature_flags?: string[];
}

export interface LineMenuAction {
  id: UUID;
  menu_key: string;
  label: string;
  action_type: LineMenuActionType;
  action_payload: Record<string, unknown> | null;
  liff_path: string | null;
  icon_key: string | null;
  sort_order: number;
  is_active: boolean;
  audience_rule: LineMenuAudienceRule | null;
  created_at: string;
  updated_at: string;
}

export interface LiffEntrypoint {
  id: UUID;
  entry_key: string;
  title: string;
  path: string;
  entry_type: "rant" | "diary" | "mypage" | "personality" | "survey_support";
  settings_json: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectAnalysisReport {
  id: UUID;
  project_id: UUID;
  respondent_count: number;
  completed_session_count: number;
  report_json: Record<string, unknown>;
  created_at: string;
}

export interface PointTransaction {
  id: UUID;
  respondent_id: UUID;
  session_id: UUID | null;
  project_id: UUID | null;
  transaction_type: PointTransactionType;
  points: number;
  reason: string;
  created_at: string;
}

export interface RewardRule {
  id: UUID;
  rule_code: string;
  rule_name: string;
  rule_type: "global" | "project";
  project_id: UUID | null;
  points: number;
  is_active: boolean;
  config_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface RespondentRankHistory {
  id: UUID;
  respondent_id: UUID;
  previous_rank_id: UUID | null;
  new_rank_id: UUID;
  reason: string;
  created_at: string;
}

export interface AdminDashboardStats {
  activeProjects: number;
  activeSessions: number;
  completedSessions: number;
  totalRespondents: number;
}

export interface ParsedAnswer {
  answerText: string;
  normalizedAnswer: Record<string, unknown>;
}

export interface ConversationResult {
  replyMessages: LineMessage[];
  sessionCompleted: boolean;
}

export interface FlexContainer {
  type: "bubble" | "carousel";
  [key: string]: unknown;
}

export interface LineTextMessage {
  type: "text";
  text: string;
}

export interface LineFlexMessage {
  type: "flex";
  altText: string;
  contents: FlexContainer;
}

export type LineMessage = LineTextMessage | LineFlexMessage;

export interface LineEventSource {
  userId?: string;
  type: string;
}

export interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  mode?: string;
  timestamp: number;
  source: LineEventSource;
  message?: {
    id: string;
    type: string;
    text?: string;
    [key: string]: unknown;
  };
}

// ── user_points / user_ranks / badges / streaks ────────────────────

export type UserPointTransactionType =
  | "daily_survey"
  | "interview_complete"
  | "project_completion"
  | "streak_bonus"
  | "birthday_bonus"
  | "campaign_bonus"
  | "attribute_update"
  | "first_bonus"
  | "continuity_bonus"
  | "project_bonus"
  | "manual_adjustment"
  | "redemption"
  | "exchange_request"
  | "exchange_cancel"
  | "exchange_refund";

export interface UserPoints {
  line_user_id: string;
  total_points: number;
  available_points: number;
  pending_points: number;
  lifetime_points: number;
  updated_at: string;
}

export interface PointHistory {
  id: UUID;
  line_user_id: string;
  transaction_type: UserPointTransactionType;
  points: number;
  reason: string;
  reference_type: string | null;
  reference_id: UUID | null;
  idempotency_key: string | null;
  created_at: string;
}

// ── point_exchange_requests ────────────────────────────────────

export type PointExchangeStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "canceled";

export interface PointExchangeRequest {
  id: UUID;
  line_user_id: string;
  requested_points: number;
  gift_amount_jpy: number;
  status: PointExchangeStatus;
  gift_provider: string | null;
  gift_code: string | null;
  gift_url: string | null;
  provider_request_id: string | null;
  provider_status: string | null;
  expires_at: string | null;
  admin_memo: string | null;
  handled_by: string | null;
  failed_reason: string | null;
  notification_sent: boolean;
  notification_sent_at: string | null;
  notification_error: string | null;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  fulfilled_at: string | null;
  canceled_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRank {
  line_user_id: string;
  rank_id: UUID;
  updated_at: string;
}

export interface UserBadge {
  id: UUID;
  badge_code: string;
  badge_name: string;
  description: string | null;
  icon_emoji: string;
  condition_type: string;
  condition_value: Record<string, unknown>;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface UserBadgeAward {
  id: UUID;
  line_user_id: string;
  badge_code: string;
  awarded_at: string;
}

export interface UserStreak {
  line_user_id: string;
  current_streak: number;
  longest_streak: number;
  last_answered_date: string | null;
  total_answer_days: number;
  streak_updated_at: string;
}

export interface UserPointSummary {
  line_user_id: string;
  display_name: string | null;
  total_points: number;
  available_points: number;
  pending_points: number;
  lifetime_points: number;
  rank_code: string | null;
  rank_name: string | null;
  rank_badge: string | null;
  current_streak: number;
  longest_streak: number;
  total_answer_days: number;
  last_answered_date: string | null;
  points_updated_at: string | null;
}
