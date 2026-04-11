import { supabase } from "../config/supabase";
import type { LineMenuAction, LineMenuAudienceRule } from "../types/domain";
import { throwIfError } from "./baseRepository";

export interface MenuAudienceContext {
  userId: string;
  currentRank?: string | null;
  totalPoints?: number;
  hasActiveAssignments?: boolean;
  featureFlags?: string[];
}

export interface MenuAudienceRuleEvaluation {
  passed: boolean;
  reason:
    | null
    | "min_total_points"
    | "max_total_points"
    | "require_active_assignments"
    | "feature_flags";
}

export function evaluateAudienceRule(
  rule: LineMenuAudienceRule | null | undefined,
  context: MenuAudienceContext
): MenuAudienceRuleEvaluation {
  if (!rule) {
    return { passed: true, reason: null };
  }

  if (
    typeof rule.min_total_points === "number" &&
    (context.totalPoints ?? 0) < rule.min_total_points
  ) {
    return { passed: false, reason: "min_total_points" };
  }

  if (
    typeof rule.max_total_points === "number" &&
    (context.totalPoints ?? 0) > rule.max_total_points
  ) {
    return { passed: false, reason: "max_total_points" };
  }

  if (
    typeof rule.require_active_assignments === "boolean" &&
    Boolean(context.hasActiveAssignments) !== rule.require_active_assignments
  ) {
    return { passed: false, reason: "require_active_assignments" };
  }

  if (Array.isArray(rule.feature_flags) && rule.feature_flags.length > 0) {
    const activeFlags = new Set(context.featureFlags ?? []);
    if (!rule.feature_flags.every((flag) => activeFlags.has(flag))) {
      return { passed: false, reason: "feature_flags" };
    }
  }

  return { passed: true, reason: null };
}

export const lineMenuActionRepository = {
  async listAll(): Promise<LineMenuAction[]> {
    const { data, error } = await supabase
      .from("line_menu_actions")
      .select("*")
      .order("sort_order", { ascending: true });
    throwIfError(error);
    return (data ?? []) as LineMenuAction[];
  },

  async listActive(): Promise<LineMenuAction[]> {
    const actions = await this.listAll();
    return actions.filter((action) => action.is_active);
  },

  async getByMenuKey(menuKey: string): Promise<LineMenuAction | null> {
    const { data, error } = await supabase
      .from("line_menu_actions")
      .select("*")
      .eq("menu_key", menuKey)
      .eq("is_active", true)
      .maybeSingle();
    throwIfError(error);
    return (data as LineMenuAction | null) ?? null;
  },

  async listActiveByAudience(context: MenuAudienceContext): Promise<LineMenuAction[]> {
    const actions = await this.listActive();
    return actions.filter((action) => evaluateAudienceRule(action.audience_rule, context).passed);
  }
};
