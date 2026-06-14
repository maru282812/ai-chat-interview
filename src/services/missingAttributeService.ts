import { supabase } from "../config/supabase";
import { throwIfError } from "../repositories/baseRepository";
import { userAttributeRepository } from "../repositories/userAttributeRepository";
import { logger } from "../lib/logger";
import { runAdminToolPrompt } from "./aiService";
import { buildMissingAttributeSuggestionsPrompt } from "../prompts/adminPrompts";

export interface AttributeCoverage {
  attr_key: string;
  label: string;
  category: string;
  total_users: number;
  filled_users: number;
  coverage_rate: number;
  priority_score: number;
}

export interface MissingAttributeSuggestion {
  attr_key: string;
  label: string;
  coverage_rate: number;
  suggested_question: string;
  suggested_options: Array<{ label: string; value: string }>;
  reason: string;
}

export const missingAttributeService = {
  async computeCoverage(): Promise<AttributeCoverage[]> {
    const [definitions, userCountRes, attrCountRes] = await Promise.all([
      userAttributeRepository.listDefinitions(),
      supabase
        .from("user_profiles")
        .select("line_user_id", { count: "exact", head: true })
        .eq("is_blocked", false),
      supabase.from("user_attributes").select("attr_key")
    ]);

    throwIfError(userCountRes.error);
    throwIfError(attrCountRes.error);

    const totalUsers = userCountRes.count ?? 0;
    const attrRows = (attrCountRes.data ?? []) as Array<{ attr_key: string }>;

    const filledByKey: Record<string, number> = {};
    for (const r of attrRows) {
      filledByKey[r.attr_key] = (filledByKey[r.attr_key] ?? 0) + 1;
    }

    return definitions
      .filter((d) => d.category !== "ai_inferred")
      .map((d) => {
        const filled = filledByKey[d.attr_key] ?? 0;
        const rate = totalUsers > 0 ? filled / totalUsers : 0;
        // 低カバレッジほど高スコア、カテゴリ basic を優先
        const categoryBonus = d.category === "basic" ? 20 : d.category === "lifestyle" ? 10 : 5;
        const priorityScore = Math.round((1 - rate) * 100 + categoryBonus);
        return {
          attr_key: d.attr_key,
          label: d.label,
          category: d.category,
          total_users: totalUsers,
          filled_users: filled,
          coverage_rate: Math.round(rate * 1000) / 10,
          priority_score: priorityScore
        };
      })
      .sort((a, b) => b.priority_score - a.priority_score);
  },

  async suggestQuestions(
    topN = 5
  ): Promise<MissingAttributeSuggestion[]> {
    const coverage = await this.computeCoverage();
    const targets = coverage.slice(0, topN);

    if (targets.length === 0) return [];

    const attributeList = targets
      .map((t) => `- ${t.attr_key}（${t.label}）: 取得率 ${t.coverage_rate}%`)
      .join("\n");

    const built = buildMissingAttributeSuggestionsPrompt({ attributeList });

    try {
      const raw = await runAdminToolPrompt({
        purpose: "missing_attribute_suggestions",
        systemPrompt: built.systemPrompt,
        userPrompt: built.userPrompt,
        maxTokens: 1500,
        temperature: 0.3,
        promptKey: built.promptKey,
        templateMode: built.templateMode,
        renderedPrompt: built.renderedPrompt,
      });
      const parsed = JSON.parse(raw) as { suggestions?: unknown[] } | unknown[];
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed as { suggestions?: unknown[] }).suggestions ?? [];

      return (items as Array<{
        attr_key: string;
        suggested_question: string;
        suggested_options: Array<{ label: string; value: string }>;
        reason: string;
      }>).map((item) => {
        const target = targets.find((t) => t.attr_key === item.attr_key);
        return {
          attr_key: item.attr_key,
          label: target?.label ?? item.attr_key,
          coverage_rate: target?.coverage_rate ?? 0,
          suggested_question: item.suggested_question,
          suggested_options: item.suggested_options ?? [],
          reason: item.reason
        };
      });
    } catch (err) {
      logger.error(`missingAttributeService.suggestQuestions error: ${String(err)}`);
      // AI失敗時はカバレッジデータだけ返す
      return targets.map((t) => ({
        attr_key: t.attr_key,
        label: t.label,
        coverage_rate: t.coverage_rate,
        suggested_question: `あなたの${t.label}を教えてください`,
        suggested_options: [],
        reason: `取得率${t.coverage_rate}%で不足しています`
      }));
    }
  }
};
