import { supabase } from "../config/supabase";
import type { DailySlot } from "../lib/dailyQueue";
import { requireData, throwIfError } from "./baseRepository";

export type DailySurveyStatus =
  | "draft"
  | "queued"
  | "scheduled"
  | "active"
  | "paused"
  | "completed";

export interface DailySurvey {
  id: string;
  title: string;
  description: string | null;
  status: DailySurveyStatus;
  reward_type: "fixed" | "random";
  reward_points: number;
  reward_min_points: number;
  reward_max_points: number;
  target_segment_id: string | null;
  /** @deprecated migration 079 以降 cron は参照しない。日付固定は scheduled_date + slot。 */
  scheduled_at: string | null;
  expires_at: string | null;
  notification_template_id: string | null;
  /** キュー内の並び順（status='queued' のときのみ入る）。 */
  queue_position: number | null;
  /** 日付固定された配信日（JST・YYYY-MM-DD）。 */
  scheduled_date: string | null;
  /** 日付固定された枠。 */
  slot: DailySlot | null;
  /** 回答UIプリセット（デイリーは既定 casual＝タップ/スワイプ系）。 */
  answer_ui_preset: "casual" | "standard" | "formal";
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

export interface DailySurveyWithQuestionCount extends DailySurvey {
  question_count: number;
}

/** `daily_survey_questions(count)` を同梱した select の結果を平す。 */
function withQuestionCount(rows: unknown): DailySurveyWithQuestionCount[] {
  return ((rows ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    const count = (r.daily_survey_questions as Array<{ count: number }> | null)?.[0]?.count ?? 0;
    return { ...(r as unknown as DailySurvey), question_count: Number(count) };
  });
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
  queue_position?: number | null;
  scheduled_date?: string | null;
  slot?: DailySlot | null;
  answer_ui_preset?: DailySurvey["answer_ui_preset"];
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

  // ── キュー / 日付スロット（migration 079）─────────────────────────

  /** キュー（status='queued'）を並び順で返す。 */
  async listQueued(): Promise<DailySurveyWithQuestionCount[]> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .select("*, daily_survey_questions(count)")
      .eq("status", "queued")
      .order("queue_position", { ascending: true, nullsFirst: false });
    throwIfError(error);
    return withQuestionCount(data);
  },

  /** 日付固定されたアンケートを期間で返す（カレンダー表示用）。 */
  async listScheduledBetween(
    fromDate: string,
    toDate: string
  ): Promise<DailySurveyWithQuestionCount[]> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .select("*, daily_survey_questions(count)")
      .gte("scheduled_date", fromDate)
      .lte("scheduled_date", toDate)
      .order("scheduled_date", { ascending: true });
    throwIfError(error);
    return withQuestionCount(data);
  },

  /** その日のその枠に固定されたアンケート（無ければ null）。 */
  async getByDateSlot(date: string, slot: DailySlot): Promise<DailySurvey | null> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .select("*")
      .eq("scheduled_date", date)
      .eq("slot", slot)
      .maybeSingle();
    throwIfError(error);
    return (data as DailySurvey | null) ?? null;
  },

  /** 日付固定されておらずキューにも居ないもの（下書き・停止中・完了）。 */
  async listUnplanned(): Promise<DailySurveyWithQuestionCount[]> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .select("*, daily_survey_questions(count)")
      .is("scheduled_date", null)
      .neq("status", "queued")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return withQuestionCount(data);
  },

  /** キュー末尾の次の位置。 */
  async nextQueuePosition(): Promise<number> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .select("queue_position")
      .eq("status", "queued")
      .order("queue_position", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    const last = (data as { queue_position: number | null } | null)?.queue_position ?? 0;
    return last + 10;
  },

  /** キューへ積む（日付固定は外す）。 */
  async enqueue(id: string, position: number): Promise<void> {
    const { error } = await supabase
      .from("daily_surveys")
      .update({
        status: "queued",
        queue_position: position,
        scheduled_date: null,
        slot: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    throwIfError(error);
  },

  /** 日付×枠に固定する（キューからは抜ける）。 */
  async assignToSlot(id: string, date: string, slot: DailySlot, expiresAt: string | null): Promise<void> {
    const update: Record<string, unknown> = {
      status: "scheduled",
      scheduled_date: date,
      slot,
      queue_position: null,
      updated_at: new Date().toISOString(),
    };
    if (expiresAt) update.expires_at = expiresAt;
    const { error } = await supabase.from("daily_surveys").update(update).eq("id", id);
    throwIfError(error);
  },

  /** 配信開始（当日の枠を active にする）。 */
  async markActive(id: string, date: string, slot: DailySlot, expiresAt: string | null): Promise<void> {
    const update: Record<string, unknown> = {
      status: "active",
      scheduled_date: date,
      slot,
      queue_position: null,
      updated_at: new Date().toISOString(),
    };
    if (expiresAt) update.expires_at = expiresAt;
    const { error } = await supabase.from("daily_surveys").update(update).eq("id", id);
    throwIfError(error);
  },

  /** キューの並びを一括保存する。 */
  async saveQueueOrder(positions: Array<{ id: string; queue_position: number }>): Promise<void> {
    for (const p of positions) {
      const { error } = await supabase
        .from("daily_surveys")
        .update({ queue_position: p.queue_position, updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .eq("status", "queued");
      throwIfError(error);
    }
  },

  /** 回答期限を過ぎた active を completed に落とす（active が居座って再配信されるのを防ぐ）。 */
  async completeExpired(nowIso: string): Promise<number> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .update({ status: "completed", updated_at: nowIso })
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lt("expires_at", nowIso)
      .select("id");
    throwIfError(error);
    return ((data ?? []) as unknown[]).length;
  },

  /** その日に配信中のアンケート（LIFF の「今日の1問」用）。 */
  async listActiveOnDate(date: string): Promise<DailySurvey[]> {
    const { data, error } = await supabase
      .from("daily_surveys")
      .select("*")
      .eq("status", "active")
      .eq("scheduled_date", date)
      .order("slot", { ascending: true });
    throwIfError(error);
    return (data ?? []) as DailySurvey[];
  },

  /** すでに delivery レコードを持つユーザー（＝送信済み or 回答済み）。再 push を避けるために使う。 */
  async listDeliveredUserIds(surveyId: string): Promise<Set<string>> {
    const { data, error } = await supabase
      .from("daily_survey_deliveries")
      .select("line_user_id")
      .eq("survey_id", surveyId);
    throwIfError(error);
    return new Set(((data ?? []) as Array<{ line_user_id: string }>).map((r) => r.line_user_id));
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
  },

  // ── analytics ──────────────────────────────────────────────

  async getAnswerDistribution(surveyId: string): Promise<Array<{
    question_id: string;
    question_text: string;
    question_type: DailySurveyQuestion["question_type"];
    answer_options: Array<{ label: string; value: string }>;
    distribution: Record<string, number>;
    total_answers: number;
  }>> {
    const [questionsRes, answersRes] = await Promise.all([
      supabase
        .from("daily_survey_questions")
        .select("id, question_text, question_type, answer_options")
        .eq("survey_id", surveyId)
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("daily_survey_answers")
        .select("question_id, answer_value")
        .eq("survey_id", surveyId)
    ]);
    throwIfError(questionsRes.error);
    throwIfError(answersRes.error);

    const questions = (questionsRes.data ?? []) as Array<{
      id: string;
      question_text: string;
      question_type: DailySurveyQuestion["question_type"];
      answer_options: Array<{ label: string; value: string }>;
    }>;
    const answers = (answersRes.data ?? []) as Array<{ question_id: string; answer_value: unknown }>;

    return questions.map((q) => {
      const qAnswers = answers.filter((a) => a.question_id === q.id);
      const distribution: Record<string, number> = {};
      for (const a of qAnswers) {
        const val = a.answer_value;
        const keys = Array.isArray(val) ? (val as string[]) : [String(val ?? "")];
        for (const k of keys) {
          distribution[k] = (distribution[k] ?? 0) + 1;
        }
      }
      return {
        question_id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        answer_options: q.answer_options ?? [],
        distribution,
        total_answers: qAnswers.length
      };
    });
  },

  async getDeliveryTimeline(surveyId: string): Promise<Array<{
    date: string;
    sent: number;
    answered: number;
  }>> {
    const { data, error } = await supabase
      .from("daily_survey_deliveries")
      .select("status, sent_at, answered_at")
      .eq("survey_id", surveyId);
    throwIfError(error);

    const rows = (data ?? []) as Array<{
      status: string;
      sent_at: string | null;
      answered_at: string | null;
    }>;

    const byDate: Record<string, { sent: number; answered: number }> = {};
    for (const r of rows) {
      if (r.sent_at) {
        const d = r.sent_at.slice(0, 10);
        if (!byDate[d]) byDate[d] = { sent: 0, answered: 0 };
        byDate[d].sent++;
      }
      if (r.answered_at) {
        const d = r.answered_at.slice(0, 10);
        if (!byDate[d]) byDate[d] = { sent: 0, answered: 0 };
        byDate[d].answered++;
      }
    }

    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));
  },

  async getNotificationLogs(surveyId: string, limit = 100): Promise<Array<{
    id: string;
    line_user_id: string;
    status: string;
    error_message: string | null;
    sent_at: string | null;
    created_at: string;
  }>> {
    const { data, error } = await supabase
      .from("notification_logs")
      .select("id, line_user_id, status, error_message, sent_at, created_at")
      .eq("category", "daily_survey")
      .contains("variables_used", { survey_id: surveyId })
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as Array<{
      id: string;
      line_user_id: string;
      status: string;
      error_message: string | null;
      sent_at: string | null;
      created_at: string;
    }>;
  }
};
