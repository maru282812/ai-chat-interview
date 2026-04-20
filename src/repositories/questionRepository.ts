import { supabase } from "../config/supabase";
import type { Question } from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export const FREE_COMMENT_QUESTION_CODE = "__free_comment__";

interface ListByProjectOptions {
  includeHidden?: boolean;
}

interface CreateQuestionInput {
  project_id: string;
  question_code: string;
  question_text: string;
  question_role: Question["question_role"];
  question_type: Question["question_type"];
  is_required: boolean;
  sort_order: number;
  branch_rule?: Question["branch_rule"];
  question_config?: Question["question_config"];
  ai_probe_enabled?: boolean;
  probe_guideline?: string | null;
  max_probe_count?: number | null;
  render_strategy?: Question["render_strategy"];
  is_system?: boolean;
  is_hidden?: boolean;
  // Phase 1 追加
  comment_top?: string | null;
  comment_bottom?: string | null;
  answer_output_type?: string | null;
  display_tags_raw?: string | null;
  display_tags_parsed?: Question["display_tags_parsed"];
  visibility_conditions?: Question["visibility_conditions"];
  page_group_id?: string | null;
}

function buildFreeCommentQuestionConfig(): Question["question_config"] {
  return {
    placeholder: "\u81ea\u7531\u306b\u66f8\u3044\u3066\u304f\u3060\u3055\u3044",
    meta: {
      research_goal: "Collect only optional supplemental comments at the end of the session.",
      question_goal: "Accept any remaining project-relevant comment without forcing structure.",
      probe_goal: "Do not probe by default.",
      expected_slots: [],
      required_slots: [],
      skippable_if_slots_present: [],
      can_prefill_future_slots: false,
      skip_forbidden_on_bad_answer: false,
      bad_answer_patterns: [],
      probe_config: {
        max_probes: 0,
        min_probes: 0,
        force_probe_on_bad: false,
        probe_priority: ["missing", "bad_pattern", "low_specificity"],
        stop_conditions: ["sufficient_slots", "high_quality"],
        allow_followup_expansion: false,
        strict_topic_lock: true
      },
      completion_conditions: [],
      render_style: {
        mode: "free_comment",
        connect_from_previous_answer: true,
        avoid_question_number: true,
        preserve_options: false
      }
    }
  };
}

export const questionRepository = {
  async listByProject(projectId: string, options: ListByProjectOptions = {}): Promise<Question[]> {
    let query = supabase
      .from("questions")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true });
    if (!options.includeHidden) {
      query = query.eq("is_hidden", false);
    }
    const { data, error } = await query;
    throwIfError(error);
    return (data ?? []) as Question[];
  },

  async getById(id: string): Promise<Question> {
    const { data, error } = await supabase.from("questions").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return requireData(data as Question | null, "Question not found");
  },

  async getByProjectAndCode(projectId: string, questionCode: string): Promise<Question | null> {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("project_id", projectId)
      .eq("question_code", questionCode)
      .maybeSingle();
    throwIfError(error);
    return (data as Question | null) ?? null;
  },

  async getFirstByProject(projectId: string): Promise<Question | null> {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_hidden", false)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as Question | null) ?? null;
  },

  async getNextBySortOrder(projectId: string, currentSortOrder: number): Promise<Question | null> {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_hidden", false)
      .gt("sort_order", currentSortOrder)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as Question | null) ?? null;
  },

  async getNextSortOrder(projectId: string): Promise<number> {
    const questions = await this.listByProject(projectId, { includeHidden: true });
    return questions.reduce((max, question) => Math.max(max, question.sort_order), 0) + 1;
  },

  async create(input: CreateQuestionInput): Promise<Question> {
    const payload: Record<string, unknown> = {
      ...input,
      ai_probe_enabled: input.ai_probe_enabled ?? false,
      is_system: input.is_system ?? false,
      is_hidden: input.is_hidden ?? false
    };
    // Phase 1 フィールドは null/undefined の場合はペイロードから除外する
    // 016_question_schema_redesign.sql 未適用の DB でも動作するため
    const PHASE1_FIELDS = [
      "comment_top", "comment_bottom", "answer_output_type",
      "display_tags_raw", "display_tags_parsed", "visibility_conditions", "page_group_id"
    ] as const;
    for (const f of PHASE1_FIELDS) {
      if (payload[f] == null) delete payload[f];
    }
    const { data, error } = await supabase.from("questions").insert(payload).select("*").single();
    throwIfError(error);
    return data as Question;
  },

  async update(
    id: string,
    input: Partial<
      Pick<
        Question,
        | "question_code"
        | "question_text"
        | "question_role"
        | "question_type"
        | "is_required"
        | "sort_order"
        | "branch_rule"
        | "question_config"
        | "ai_probe_enabled"
        | "probe_guideline"
        | "max_probe_count"
        | "render_strategy"
        | "is_system"
        | "is_hidden"
        // Phase 1 追加
        | "comment_top"
        | "comment_bottom"
        | "answer_output_type"
        | "display_tags_raw"
        | "display_tags_parsed"
        | "visibility_conditions"
        | "page_group_id"
      >
    >
  ): Promise<Question> {
    const payload: Record<string, unknown> = { ...input };
    // Phase 1 フィールドは null/undefined の場合はペイロードから除外する
    // 016_question_schema_redesign.sql 未適用の DB でも動作するため
    const PHASE1_FIELDS = [
      "comment_top", "comment_bottom", "answer_output_type",
      "display_tags_raw", "display_tags_parsed", "visibility_conditions", "page_group_id"
    ] as const;
    for (const f of PHASE1_FIELDS) {
      if (payload[f] == null) delete payload[f];
    }
    const { data, error } = await supabase
      .from("questions")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Question;
  },

  async getSystemFreeCommentQuestion(projectId: string): Promise<Question | null> {
    return this.getByProjectAndCode(projectId, FREE_COMMENT_QUESTION_CODE);
  },

  async ensureSystemFreeCommentQuestion(projectId: string): Promise<Question> {
    const existing = await this.getSystemFreeCommentQuestion(projectId);
    if (existing) {
      if (!existing.is_system || !existing.is_hidden || existing.question_role !== "free_comment") {
        return this.update(existing.id, {
          question_role: "free_comment",
          is_system: true,
          is_hidden: true,
          is_required: true,
          question_type: "text",
          ai_probe_enabled: false,
          question_text: "\u6700\u5f8c\u306b\u3001\u3053\u3053\u307e\u3067\u3067\u8a71\u3057\u304d\u308c\u306a\u304b\u3063\u305f\u3053\u3068\u304c\u3042\u308c\u3070\u81ea\u7531\u306b\u6559\u3048\u3066\u304f\u3060\u3055\u3044\u3002",
          question_config: buildFreeCommentQuestionConfig()
        });
      }
      return existing;
    }

    const questions = await this.listByProject(projectId, { includeHidden: true });
    const maxSortOrder = questions.reduce((max, question) => Math.max(max, question.sort_order), 0);
    return this.create({
      project_id: projectId,
      question_code: FREE_COMMENT_QUESTION_CODE,
      question_text: "\u6700\u5f8c\u306b\u3001\u3053\u3053\u307e\u3067\u3067\u8a71\u3057\u304d\u308c\u306a\u304b\u3063\u305f\u3053\u3068\u304c\u3042\u308c\u3070\u81ea\u7531\u306b\u6559\u3048\u3066\u304f\u3060\u3055\u3044\u3002",
      question_role: "free_comment",
      question_type: "text",
      is_required: true,
      sort_order: maxSortOrder + 1,
      branch_rule: null,
      question_config: buildFreeCommentQuestionConfig(),
      ai_probe_enabled: false,
      is_system: true,
      is_hidden: true
    });
  }
};
