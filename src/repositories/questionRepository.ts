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
  is_system?: boolean;
  is_hidden?: boolean;
}

function buildFreeCommentQuestionConfig(): Question["question_config"] {
  return {
    placeholder: "\u81ea\u7531\u306b\u66f8\u3044\u3066\u304f\u3060\u3055\u3044",
    meta: {
      research_goal: "Collect comparable background information from the final free comment.",
      question_goal: "Capture what was left unsaid in a comparable structure.",
      probe_goal: "Turn a shallow free comment into concrete context and reasons.",
      expected_slots: [
        { key: "usage_scene", label: "usage_scene", description: "when, where, in what situation", required: true },
        { key: "reason", label: "reason", description: "why the respondent feels that way", required: true },
        { key: "pain_point", label: "pain_point", description: "problem, frustration, or hassle", required: false },
        { key: "alternative", label: "alternative", description: "alternative means or comparison target", required: false },
        { key: "desired_state", label: "desired_state", description: "ideal outcome", required: false }
      ],
      required_slots: ["usage_scene", "reason"],
      skippable_if_slots_present: [],
      can_prefill_future_slots: true,
      skip_forbidden_on_bad_answer: true,
      bad_answer_patterns: [
        { type: "exact", value: "\u7279\u306b\u306a\u3057", note: "no_content" },
        { type: "exact", value: "\u7279\u306b\u306a\u3044", note: "no_content" },
        { type: "exact", value: "\u306a\u3044", note: "no_content" },
        { type: "exact", value: "\u308f\u304b\u3089\u306a\u3044", note: "no_content" },
        { type: "exact", value: "\u601d\u3044\u3064\u304b\u306a\u3044", note: "no_content" },
        { type: "exact", value: "\u899a\u3048\u3066\u3044\u306a\u3044", note: "no_content" },
        { type: "contains", value: "\u306a\u3093\u3068\u306a\u304f", note: "abstract" },
        { type: "contains", value: "\u666e\u901a", note: "abstract" },
        { type: "contains", value: "\u3044\u308d\u3044\u308d", note: "abstract" },
        { type: "max_length", value: 14, note: "low_specificity" }
      ],
      probe_config: {
        max_probes: 1,
        min_probes: 0,
        force_probe_on_bad: true,
        probe_priority: ["missing", "bad_pattern", "low_specificity"],
        stop_conditions: ["sufficient_slots", "high_quality"],
        allow_followup_expansion: true,
        strict_topic_lock: true
      },
      completion_conditions: [
        { type: "min_length", value: 18 },
        { type: "required_slots" },
        { type: "no_bad_patterns" }
      ],
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

  async create(input: CreateQuestionInput): Promise<Question> {
    const payload = {
      ...input,
      ai_probe_enabled: input.ai_probe_enabled ?? false,
      is_system: input.is_system ?? false,
      is_hidden: input.is_hidden ?? false
    };
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
        | "is_system"
        | "is_hidden"
      >
    >
  ): Promise<Question> {
    const { data, error } = await supabase
      .from("questions")
      .update(input)
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
