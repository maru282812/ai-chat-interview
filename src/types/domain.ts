export type UUID = string;

export type ProjectStatus = "draft" | "active" | "paused" | "archived";
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
 * QuestionType: 既存5種 + Phase1 拡張
 * DB 制約は 016_question_schema_redesign.sql 参照
 */
export type QuestionType =
  // 既存（後方互換）
  | "text"
  | "single_select"
  | "multi_select"
  | "yes_no"
  | "scale"
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

export interface ScreeningConfig {
  pass_message?: string | null;
  fail_message?: string | null;
  pass_action?: ScreeningPassAction;
}

export interface Project {
  id: UUID;
  name: string;
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
  created_at: string;
  updated_at: string;
}

export interface QuestionOption {
  value: string;
  label: string;
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

export interface QuestionConfig {
  options?: QuestionOption[];
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
  meta?: QuestionMeta;
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
}

export interface ProjectAssignment {
  id: UUID;
  user_id: string;
  project_id: UUID;
  respondent_id: UUID;
  assignment_type: ProjectAssignmentType;
  status: ProjectAssignmentStatus;
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

export interface UserProfile {
  id: UUID;
  line_user_id: string;
  nickname: string | null;
  birth_date: string | null;
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
  aiProbeCount?: number;
  aiProbeCountCurrentAnswer?: number;
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
  answer_role: AnswerRole;
  parent_answer_id: UUID | null;
  normalized_answer: Record<string, unknown> | null;
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
  session_id: UUID;
  purpose: string;
  prompt: string;
  response: string;
  token_usage: Record<string, unknown> | null;
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
  created_at: string;
  updated_at: string;
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
