/**
 * cycleRepository.ts
 *
 * 繰り返しアンケート（サイクル）の永続化担当 (Migration 093)。
 */

import { supabase } from "../config/supabase";
import type { CycleGroup, CycleGroupStep, CycleStepRole, SurveyCycle } from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export const cycleGroupRepository = {
  async getById(id: string): Promise<CycleGroup | null> {
    const { data, error } = await supabase
      .from("cycle_groups")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as CycleGroup | null) ?? null;
  },

  async list(): Promise<CycleGroup[]> {
    const { data, error } = await supabase
      .from("cycle_groups")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as CycleGroup[];
  },

  /**
   * 案件が属するサイクル定義とステップを引く。
   * 1案件は1グループにしか属せない（ux_cycle_group_steps_project）ので単一で返る。
   * サイクルに属さない案件（大多数）は null ＝ 呼び出し側は従来どおりの挙動。
   */
  async findByProjectId(
    projectId: string
  ): Promise<{ group: CycleGroup; step: CycleGroupStep } | null> {
    const { data, error } = await supabase
      .from("cycle_group_steps")
      .select("*, cycle_groups(*)")
      .eq("project_id", projectId)
      .maybeSingle();
    throwIfError(error);
    if (!data) return null;

    const row = data as CycleGroupStep & { cycle_groups: CycleGroup | null };
    const group = row.cycle_groups;
    if (!group) return null;

    const { cycle_groups: _omit, ...step } = row;
    return { group, step: step as CycleGroupStep };
  },

  /** 店舗のサイクル定義（Migration 096）。店舗ごとに最大1件。 */
  async findByStore(storeId: string): Promise<CycleGroup | null> {
    const { data, error } = await supabase
      .from("cycle_groups")
      .select("*")
      .eq("store_id", storeId)
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as CycleGroup | null) ?? null;
  },

  async listSteps(cycleGroupId: string): Promise<CycleGroupStep[]> {
    const { data, error } = await supabase
      .from("cycle_group_steps")
      .select("*")
      .eq("cycle_group_id", cycleGroupId)
      .order("step_order", { ascending: true });
    throwIfError(error);
    return (data ?? []) as CycleGroupStep[];
  },

  async create(input: {
    name: string;
    client_id?: string | null;
    entry_project_id: string;
    followup_project_id?: string | null;
    grace_days?: number;
    undecided_days?: number;
    restart_cooldown_days?: number;
    followup_b_delay_minutes?: number;
    frequency_question_code?: string;
    frequency_days_json?: Record<string, number> | null;
    store_id?: string | null;
    industry_template_id?: string | null;
  }): Promise<CycleGroup> {
    const { data, error } = await supabase
      .from("cycle_groups")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as CycleGroup | null, "CycleGroup insert returned no row");
  },

  /** 管理画面からの設定更新（Migration 095）。 */
  async update(
    id: string,
    input: Partial<
      Pick<
        CycleGroup,
        | "name"
        | "grace_days"
        | "undecided_days"
        | "restart_cooldown_days"
        | "followup_b_delay_minutes"
        | "frequency_question_code"
        | "frequency_days_json"
        | "is_enabled"
      >
    >
  ): Promise<CycleGroup> {
    const { data, error } = await supabase
      .from("cycle_groups")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as CycleGroup | null, "CycleGroup update returned no row");
  },

  async addStep(input: {
    cycle_group_id: string;
    project_id: string;
    step_order: number;
    step_role: CycleStepRole;
  }): Promise<CycleGroupStep> {
    const { data, error } = await supabase
      .from("cycle_group_steps")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as CycleGroupStep | null, "CycleGroupStep insert returned no row");
  },
};

export const surveyCycleRepository = {
  async getById(id: string): Promise<SurveyCycle | null> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as SurveyCycle | null) ?? null;
  },

  /**
   * この人の「開いている」サイクル（最新1件）。
   * 閉じたサイクルは対象外＝次の A が新しい周を開始する。
   */
  async findOpen(cycleGroupId: string, lineUserId: string): Promise<SurveyCycle | null> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .select("*")
      .eq("cycle_group_id", cycleGroupId)
      .eq("line_user_id", lineUserId)
      .is("closed_at", null)
      .order("cycle_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as SurveyCycle | null) ?? null;
  },

  /** 開閉を問わない最新サイクル（クールダウン判定に使う）。 */
  async findLatest(cycleGroupId: string, lineUserId: string): Promise<SurveyCycle | null> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .select("*")
      .eq("cycle_group_id", cycleGroupId)
      .eq("line_user_id", lineUserId)
      .order("cycle_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as SurveyCycle | null) ?? null;
  },

  /** グループ内の全サイクル（離脱ファネル集計用）。 */
  async listByGroup(cycleGroupId: string, limit = 5000): Promise<SurveyCycle[]> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .select("*")
      .eq("cycle_group_id", cycleGroupId)
      .order("cycle_no", { ascending: true })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as SurveyCycle[];
  },

  async listByUser(cycleGroupId: string, lineUserId: string): Promise<SurveyCycle[]> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .select("*")
      .eq("cycle_group_id", cycleGroupId)
      .eq("line_user_id", lineUserId)
      .order("cycle_no", { ascending: true });
    throwIfError(error);
    return (data ?? []) as SurveyCycle[];
  },

  async create(input: {
    cycle_group_id: string;
    line_user_id: string;
    cycle_no: number;
    started_at?: string;
  }): Promise<SurveyCycle> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as SurveyCycle | null, "SurveyCycle insert returned no row");
  },

  async update(
    id: string,
    input: Partial<
      Pick<
        SurveyCycle,
        | "frequency_code"
        | "expected_return_at"
        | "followup_sent_at"
        | "returned_at"
        | "followup_b_scheduled_at"
        | "followup_b_sent_at"
        | "closed_at"
        | "close_reason"
      >
    >
  ): Promise<SurveyCycle> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as SurveyCycle | null, "SurveyCycle update returned no row");
  },

  /**
   * C（離脱検証）の送付対象を引く。
   * 部分インデックス ix_survey_cycles_followup_due がそのまま効く条件で絞る。
   */
  async listFollowupDue(nowIso: string, limit = 200): Promise<SurveyCycle[]> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .select("*")
      .is("closed_at", null)
      .is("followup_sent_at", null)
      .is("returned_at", null)
      .not("expected_return_at", "is", null)
      .lte("expected_return_at", nowIso)
      .order("expected_return_at", { ascending: true })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as SurveyCycle[];
  },

  /**
   * B（来店後アンケート）の送信予定時刻を過ぎたサイクルを引く (Migration 094)。
   * 部分インデックス ix_survey_cycles_followup_b_due がそのまま効く条件で絞る。
   */
  async listFollowupBDue(nowIso: string, limit = 200): Promise<SurveyCycle[]> {
    const { data, error } = await supabase
      .from("survey_cycles")
      .select("*")
      .is("followup_b_sent_at", null)
      .is("closed_at", null)
      .not("followup_b_scheduled_at", "is", null)
      .lte("followup_b_scheduled_at", nowIso)
      .order("followup_b_scheduled_at", { ascending: true })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as SurveyCycle[];
  },
};
