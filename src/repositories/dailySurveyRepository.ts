import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";

export interface DailySurvey {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "scheduled" | "active" | "paused" | "completed";
  reward_type: "fixed" | "random";
  reward_points: number;
  reward_min_points: number;
  reward_max_points: number;
  target_segment_id: string | null;
  scheduled_at: string | null;
  expires_at: string | null;
  notification_template_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailySurveyQuestion {
  id: string;
  survey_id: string;
  question_text: string;
  question_type: "single_choice" | "multiple_choice" | "text" | "scale";
  answer_options: Array<{ label: string; value: string }>;
  attribute_key: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface DailySurveyDelivery {
  id: string;
  survey_id: string;
  line_user_id: string;
  status: "pending" | "sent" | "opened" | "answered" | "expired" | "failed";
  points_awarded: number | null;
  sent_at: string | null;
  opened_at: string | null;
  answered_at: string | null;
  expired_at: string | null;
  created_at: string;
}

export interface DailySurveyWithStats extends DailySurvey {
  question_count: number;
  delivery_count: number;
  answered_count: number;
  answer_rate: number;
}

export interface DailySurveyCreateInput {
  title: string;
  description?: string | null;
  status?: DailySurvey["status"];
  reward_type?: DailySurvey["reward_type"];
  reward_points?: number;
  reward_min_points?: number;
  reward_max_points?: number;
  target_segment_id?: string | null;
  scheduled_at?: string | null;
  expires_at?: string | null;
  notification_template_id?: string | null;
  created_by?: string | null;
}

export interface DailySurveyQuestionCreateInput {
  survey_id: string;
  question_text: string;
  question_type?: DailySurveyQuestion["question_type"];
  answer_options?: Array<{ label: string; value: string }>;
  attribute_key?: string | null;
  sort_order?: number;
}

export const dailySurveyRepository = {
  async list(): Promise<DailySurveyWithStats[]> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .select(`
        *,
        daily_survey_questions(count),
        daily_survey_deliveries(count)
      `)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return ((data ?? []) as unknown[]).map((row: unknown) => {
      const r = row as Record<string, unknown>;
      const qCount = (r.daily_survey_questions as Array<{ count: number }> | null)?.[0]?.count ?? 0;
      const dCount = (r.daily_survey_deliveries as Array<{ count: number }> | null)?.[0]?.count ?? 0;
      return {
        ...(r as unknown as DailySurvey),
        question_count: Number(qCount),
        delivery_count: Number(dCount),
        answered_count: 0,
        answer_rate: 0
      };
    });
  },

  async getById(id: string): Promise<DailySurvey> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .select("*")
      .eq("id", id)
      .single();
    throwIfError(error);
    return requireData(data as DailySurvey | null, `DailySurvey not found: ${id}`);
  },

  async create(input: DailySurveyCreateInput): Promise<DailySurvey> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as DailySurvey;
  },

  async update(id: string, input: Partial<DailySurveyCreateInput>): Promise<DailySurvey> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as DailySurvey | null, `DailySurvey not found: ${id}`);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("daily_surveys").delete().eq("id", id);
    throwIfError(error);
  },

  async updateStatus(id: string, status: DailySurvey["status"]): Promise<void> {
    const { error } = await supabase
      .from("daily_surveys")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    throwIfError(error);
  },

  // ── questions ──────────────────────────────────────────────────

  async listQuestions(surveyId: string): Promise<DailySurveyQuestion[]> {
    const { data, error } = await supabase
      .from("daily_survey_questions")
      .select("*")
      .eq("survey_id", surveyId)
      .eq("is_active", true)
      .order("sort_order");
    throwIfError(error);
    return (data ?? []) as DailySurveyQuestion[];
  },

  async createQuestion(input: DailySurveyQuestionCreateInput): Promise<DailySurveyQuestion> {
    const { data, error } = await supabase
      .from("daily_survey_questions")
      .insert({
        ...input,
        answer_options: input.answer_options ?? []
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as DailySurveyQuestion;
  },

  async updateQuestion(
    questionId: string,
    input: Partial<Omit<DailySurveyQuestionCreateInput, "survey_id">>
  ): Promise<DailySurveyQuestion> {
    const { data, error } = await supabase
      .from("daily_survey_questions")
      .update(input)
      .eq("id", questionId)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as DailySurveyQuestion | null, `Question not found: ${questionId}`);
  },

  async deleteQuestion(questionId: string): Promise<void> {
    const { error } = await supabase
      .from("daily_survey_questions")
      .delete()
      .eq("id", questionId);
    throwIfError(error);
  },

  // ── deliveries ─────────────────────────────────────────────────

  async getDeliveryStats(surveyId: string): Promise<{
    total: number;
    sent: number;
    answered: number;
    expired: number;
    failed: number;
  }> {
    const { data, error } = await supabase
      .from("daily_survey_deliveries")
      .select("status")
      .eq("survey_id", surveyId);
    throwIfError(error);
    const rows = (data ?? []) as Array<{ status: string }>;
    return {
      total: rows.length,
      sent: rows.filter((r) => ["sent", "opened", "answered"].includes(r.status)).length,
      answered: rows.filter((r) => r.status === "answered").length,
      expired: rows.filter((r) => r.status === "expired").length,
      failed: rows.filter((r) => r.status === "failed").length
    };
  },

  async listDeliveries(surveyId: string): Promise<DailySurveyDelivery[]> {
    const { data, error } = await supabase
      .from("daily_survey_deliveries")
      .select("*")
      .eq("survey_id", surveyId)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as DailySurveyDelivery[];
  },

  async upsertDelivery(input: {
    survey_id: string;
    line_user_id: string;
    status?: DailySurveyDelivery["status"];
  }): Promise<DailySurveyDelivery> {
    const { data, error } = await supabase
      .from("daily_survey_deliveries")
      .upsert(
        {
          survey_id: input.survey_id,
          line_user_id: input.line_user_id,
          status: input.status ?? "pending"
        },
        { onConflict: "survey_id,line_user_id" }
      )
      .select("*")
      .single();
    throwIfError(error);
    return data as DailySurveyDelivery;
  },

  async markDeliveryStatus(
    deliveryId: string,
    status: DailySurveyDelivery["status"],
    extra?: {
      sent_at?: string;
      points_awarded?: number;
      error_message?: string;
    }
  ): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (extra?.sent_at) update.sent_at = extra.sent_at;
    if (extra?.points_awarded !== undefined) update.points_awarded = extra.points_awarded;
    const { error } = await supabase
      .from("daily_survey_deliveries")
      .update(update)
      .eq("id", deliveryId);
    throwIfError(error);
  }
};
