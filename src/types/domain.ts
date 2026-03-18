export type UUID = string;

export type ProjectStatus = "draft" | "active" | "paused" | "archived";
export type RespondentStatus = "invited" | "active" | "completed" | "dropped";
export type SessionStatus = "pending" | "active" | "completed" | "abandoned";
export type SessionPhase = "question" | "ai_probe" | "completed";
export type SenderType = "user" | "system" | "assistant";
export type QuestionType =
  | "text"
  | "single_select"
  | "multi_select"
  | "yes_no"
  | "scale";
export type PointTransactionType =
  | "project_completion"
  | "first_bonus"
  | "continuity_bonus"
  | "project_bonus"
  | "manual_adjustment";

export interface Project {
  id: UUID;
  name: string;
  client_name: string | null;
  objective: string | null;
  status: ProjectStatus;
  reward_points: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionOption {
  value: string;
  label: string;
}

export interface BranchRuleCondition {
  operator: "equals" | "not_equals" | "includes" | "gte" | "lte";
  value: string | number | boolean;
}

export interface BranchRule {
  when: BranchRuleCondition;
  targetQuestionCode: string;
}

export interface QuestionConfig {
  options?: QuestionOption[];
  scaleMin?: number;
  scaleMax?: number;
  scaleLabels?: Record<string, string>;
  placeholder?: string;
  helpText?: string;
}

export interface Question {
  id: UUID;
  project_id: UUID;
  question_code: string;
  question_text: string;
  question_type: QuestionType;
  is_required: boolean;
  sort_order: number;
  branch_rule: BranchRule[] | null;
  question_config: QuestionConfig | null;
  ai_probe_enabled: boolean;
  created_at: string;
  updated_at: string;
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

export interface SessionState {
  pendingQuestionId?: UUID | null;
  pendingProbeQuestion?: string | null;
  pendingProbeSourceQuestionId?: UUID | null;
  answersSinceSummary?: number;
  aiProbeCount?: number;
  aiProbeCountCurrentAnswer?: number;
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
  normalized_answer: Record<string, unknown> | null;
  created_at: string;
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
  };
}
