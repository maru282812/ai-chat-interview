import { supabase } from "../config/supabase";
import { throwIfError } from "../repositories/baseRepository";
import { userAttributeRepository } from "../repositories/userAttributeRepository";
import { openai } from "../config/openai";
import { logger } from "../lib/logger";

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

    const prompt = `あなたはユーザーリサーチプラットフォームのAIです。
以下のユーザー属性が不足しています。各属性に対して、LINEデイリーアンケートで使える自然な日本語の設問文と選択肢を提案してください。

属性リスト:
${targets.map((t) => `- ${t.attr_key}（${t.label}）: 取得率 ${t.coverage_rate}%`).join("\n")}

JSON配列で返してください。各要素:
{
  "attr_key": "属性キー",
  "suggested_question": "設問文（〜ですか？ 形式）",
  "suggested_options": [{"label": "表示名", "value": "値"}],
  "reason": "この属性を優先すべき理由（1文）"
}`;

    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      const raw = res.choices[0]?.message?.content ?? "{}";
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
