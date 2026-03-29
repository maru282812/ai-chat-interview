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

function matchesAudienceRule(
  rule: LineMenuAudienceRule | null | undefined,
  context: MenuAudienceContext
): boolean {
  if (!rule) {
    return true;
  }

  if (
    typeof rule.min_total_points === "number" &&
    (context.totalPoints ?? 0) < rule.min_total_points
  ) {
    return false;
  }

  if (
    typeof rule.max_total_points === "number" &&
    (context.totalPoints ?? 0) > rule.max_total_points
  ) {
    return false;
  }

  if (
    typeof rule.require_active_assignments === "boolean" &&
    Boolean(context.hasActiveAssignments) !== rule.require_active_assignments
  ) {
    return false;
  }

  if (Array.isArray(rule.feature_flags) && rule.feature_flags.length > 0) {
    const activeFlags = new Set(context.featureFlags ?? []);
    if (!rule.feature_flags.every((flag) => activeFlags.has(flag))) {
      return false;
    }
  }

  return true;
}

export const lineMenuActionRepository = {
  async listActive(): Promise<LineMenuAction[]> {
    const { data, error } = await supabase
      .from("line_menu_actions")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    throwIfError(error);
    return (data ?? []) as LineMenuAction[];
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
    return actions.filter((action) => matchesAudienceRule(action.audience_rule, context));
  }
};
