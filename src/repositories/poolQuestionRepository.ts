import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";

/**
 * ついでスワイプ（設問プール）の永続化層。
 * docs/spec-pool-swipe-questions.md。CRUD・候補取得・exposure 作成/更新・集計を担う。
 * 選定ロジック（何を出すか）は純関数 src/lib/poolQuestionSelection.ts。ここは DB だけ。
 */

export type PoolQuestionStatus = "draft" | "active" | "paused" | "archived";
export type PoolQuestionType = "single_choice" | "scale";
export type PoolExposureStatus = "served" | "answered" | "skipped";

export interface PoolChoice {
  value: string;
  label: string;
}

export interface PoolQuestion {
  id: string;
  question_text: string;
  question_type: PoolQuestionType;
  answer_options: PoolChoice[];
  topic_tag: string | null;
  client_id: string | null;
  attribute_key: string | null;
  status: PoolQuestionStatus;
  priority: number;
  reward_points: number;
  reask_after_days: number | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoolQuestionExposure {
  id: string;
  question_id: string;
  line_user_id: string;
  exposure_date: string;
  position: number;
  status: PoolExposureStatus;
  served_at: string;
  answered_at: string | null;
}

/** 一覧の在庫ボード用: 設問＋出題/回答/スキップ数＋企業名。 */
export interface PoolQuestionWithStats extends PoolQuestion {
  client_name: string | null;
  served_count: number;
  answered_count: number;
  skipped_count: number;
}

export interface PoolQuestionMutationInput {
  question_text: string;
  question_type: PoolQuestionType;
  answer_options: PoolChoice[];
  topic_tag: string | null;
  client_id: string | null;
  attribute_key: string | null;
  status: PoolQuestionStatus;
  priority: number;
  reward_points: number;
  reask_after_days: number | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by?: string | null;
}

function toRow(input: PoolQuestionMutationInput): Record<string, unknown> {
  return {
    question_text: input.question_text,
    question_type: input.question_type,
    answer_options: input.answer_options,
    topic_tag: input.topic_tag,
    client_id: input.client_id,
    attribute_key: input.attribute_key,
    status: input.status,
    priority: input.priority,
    reward_points: input.reward_points,
    reask_after_days: input.reask_after_days,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    ...(input.created_by !== undefined ? { created_by: input.created_by } : {}),
  };
}

export const poolQuestionRepository = {
  // ── 選定（LIFF）──────────────────────────────────────────

  /** 出題候補（status='active'）。掲載期間・除外は純関数側で判定する。 */
  async listActiveCandidates(): Promise<PoolQuestion[]> {
    const { data, error } = await supabase
      .from("pool_questions")
      .select("*")
      .eq("status", "active")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as PoolQuestion[];
  },

  /** 本人の exposure 全件（選定の履歴入力。id を含む＝再掲の exposure 特定に使う）。 */
  async listUserExposures(lineUserId: string): Promise<PoolQuestionExposure[]> {
    const { data, error } = await supabase
      .from("pool_question_exposures")
      .select("*")
      .eq("line_user_id", lineUserId);
    throwIfError(error);
    return (data ?? []) as PoolQuestionExposure[];
  },

  /** 本人の回答（reask 判定用に answered_at のみ・古いものも含む）。 */
  async listUserAnswerDates(lineUserId: string): Promise<Array<{ question_id: string; answered_at: string }>> {
    const { data, error } = await supabase
      .from("pool_question_answers")
      .select("question_id, answered_at")
      .eq("line_user_id", lineUserId);
    throwIfError(error);
    return (data ?? []) as Array<{ question_id: string; answered_at: string }>;
  },

  async getExposureById(id: string): Promise<PoolQuestionExposure | null> {
    const { data, error } = await supabase
      .from("pool_question_exposures")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as PoolQuestionExposure | null) ?? null;
  },

  async createExposure(input: {
    question_id: string;
    line_user_id: string;
    exposure_date: string;
    position: number;
  }): Promise<PoolQuestionExposure> {
    const { data, error } = await supabase
      .from("pool_question_exposures")
      .insert({
        question_id: input.question_id,
        line_user_id: input.line_user_id,
        exposure_date: input.exposure_date,
        position: input.position,
        status: "served",
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as PoolQuestionExposure;
  },

  async markExposureStatus(
    id: string,
    status: PoolExposureStatus,
    answeredAt?: string,
  ): Promise<void> {
    const patch: Record<string, unknown> = { status };
    if (answeredAt) patch.answered_at = answeredAt;
    const { error } = await supabase.from("pool_question_exposures").update(patch).eq("id", id);
    throwIfError(error);
  },

  async insertAnswer(input: {
    exposure_id: string;
    question_id: string;
    line_user_id: string;
    answer_value: unknown;
    answer_ms: number | null;
    topic_tag: string | null;
    client_id: string | null;
  }): Promise<void> {
    const { error } = await supabase.from("pool_question_answers").insert({
      exposure_id: input.exposure_id,
      question_id: input.question_id,
      line_user_id: input.line_user_id,
      answer_value: input.answer_value,
      answer_ms: input.answer_ms,
      topic_tag: input.topic_tag,
      client_id: input.client_id,
    });
    throwIfError(error);
  },

  // ── 管理（admin）────────────────────────────────────────

  async getById(id: string): Promise<PoolQuestion> {
    const { data, error } = await supabase
      .from("pool_questions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return requireData(data as PoolQuestion | null, `PoolQuestion not found: ${id}`);
  },

  async create(input: PoolQuestionMutationInput): Promise<PoolQuestion> {
    const { data, error } = await supabase
      .from("pool_questions")
      .insert(toRow(input))
      .select("*")
      .single();
    throwIfError(error);
    return data as PoolQuestion;
  },

  /** まとめて追加。行ごとの検証は呼び出し側で済ませ、ここは一括 INSERT（部分作成しない）。 */
  async createMany(inputs: PoolQuestionMutationInput[]): Promise<PoolQuestion[]> {
    const { data, error } = await supabase
      .from("pool_questions")
      .insert(inputs.map(toRow))
      .select("*");
    throwIfError(error);
    return (data ?? []) as PoolQuestion[];
  },

  async update(id: string, input: PoolQuestionMutationInput): Promise<PoolQuestion> {
    const { data, error } = await supabase
      .from("pool_questions")
      .update({ ...toRow(input), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as PoolQuestion | null, `PoolQuestion not found: ${id}`);
  },

  async updateStatus(id: string, status: PoolQuestionStatus): Promise<void> {
    const { error } = await supabase
      .from("pool_questions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    throwIfError(error);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("pool_questions").delete().eq("id", id);
    throwIfError(error);
  },

  /** active な設問数（在庫サマリ・警告表示に使う）。 */
  async countActive(): Promise<number> {
    const { count, error } = await supabase
      .from("pool_questions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    throwIfError(error);
    return count ?? 0;
  },

  /** ある設問に回答が1件でも付いているか（編集ロック・削除ブロックの判定）。 */
  async hasAnswers(questionId: string): Promise<boolean> {
    const { count, error } = await supabase
      .from("pool_question_answers")
      .select("id", { count: "exact", head: true })
      .eq("question_id", questionId);
    throwIfError(error);
    return (count ?? 0) > 0;
  },

  /**
   * 在庫ボード用の一覧。設問＋企業名＋exposure の status 別 count。
   * フィルタ: status（配列）／topic_tag／client_id。
   */
  async listWithStats(filter: {
    statuses?: PoolQuestionStatus[];
    topicTag?: string | null;
    clientId?: string | null;
  }): Promise<PoolQuestionWithStats[]> {
    let query = supabase
      .from("pool_questions")
      .select("*, clients(name)")
      .order("created_at", { ascending: false });
    if (filter.statuses && filter.statuses.length > 0) query = query.in("status", filter.statuses);
    if (filter.topicTag) query = query.eq("topic_tag", filter.topicTag);
    if (filter.clientId) query = query.eq("client_id", filter.clientId);

    const { data, error } = await query;
    throwIfError(error);
    const rows = (data ?? []) as Array<PoolQuestion & { clients: { name: string } | null }>;
    if (rows.length === 0) return [];

    // exposure の status 別 count を対象設問ぶんだけ取得して JS で集計する。
    const ids = rows.map((r) => r.id);
    const { data: exposureRows, error: expErr } = await supabase
      .from("pool_question_exposures")
      .select("question_id, status")
      .in("question_id", ids);
    throwIfError(expErr);

    const counts = new Map<string, { served: number; answered: number; skipped: number }>();
    for (const e of (exposureRows ?? []) as Array<{ question_id: string; status: PoolExposureStatus }>) {
      const c = counts.get(e.question_id) ?? { served: 0, answered: 0, skipped: 0 };
      c[e.status] += 1;
      counts.set(e.question_id, c);
    }

    return rows.map((r) => {
      const c = counts.get(r.id) ?? { served: 0, answered: 0, skipped: 0 };
      const { clients, ...rest } = r;
      return {
        ...(rest as PoolQuestion),
        client_name: clients?.name ?? null,
        served_count: c.served + c.answered + c.skipped, // 出題数＝全 exposure
        answered_count: c.answered,
        skipped_count: c.skipped,
      };
    });
  },

  /** 既存トピックタグ（datalist サジェスト用・非空の distinct）。 */
  async listTopicTags(): Promise<string[]> {
    const { data, error } = await supabase
      .from("pool_questions")
      .select("topic_tag")
      .not("topic_tag", "is", null);
    throwIfError(error);
    const tags = new Set<string>();
    for (const r of (data ?? []) as Array<{ topic_tag: string | null }>) {
      if (r.topic_tag) tags.add(r.topic_tag);
    }
    return [...tags].sort();
  },
};
