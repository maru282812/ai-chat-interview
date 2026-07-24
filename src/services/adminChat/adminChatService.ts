/**
 * 管理画面AIチャットのエージェントループ（docs/impl-admin-ai-chat.md Phase 1）
 *
 * 1指示 = plan → ツール実行(複数) → 報告 のループを回す。
 *
 * 安全設計（v2 仕様の中核）:
 * - 実行可否のゲートはこの service 内で強制する。コントローラや system prompt には委ねない。
 *   Phase 1 で実行できるのは Tier A（読み取り）のみで、B/C は execute せず blocked を返す。
 * - ツールは toolRegistry のホワイトリストのみ。screenKey に紐づくものしか AI に見せない。
 * - 実行・拒否のすべてを admin_ai_actions に、会話全体を ai_logs に記録する。
 *   商用副作用の作法どおりレスポンス前に await するが、記録失敗で応答自体は落とさない。
 */

import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { BASE_PROMPT_TEMPLATES } from "../../prompts/basePromptTemplates";
import { adminAiActionRepository } from "../../repositories/adminAiActionRepository";
import { adminAiPendingActionRepository } from "../../repositories/adminAiPendingActionRepository";
import { aiLogRepository } from "../../repositories/aiLogRepository";
import { type AdminChatMessage, runAdminToolChat } from "../aiService";
import {
  type AdminChatTool,
  type ToolTier,
  getTool,
  toOpenAITools,
  toolsForScreen,
} from "./toolRegistry";

/**
 * AI がその場で実行してよい Tier。
 * A=読み取り / B=戻せる書き込み（未公開設問・キュー・下書き等）までは自動実行する。
 * C（不可逆・対外）はここに入れない。承認カード経由でのみ実行される。
 */
const ALLOWED_TIERS: ToolTier[] = ["A", "B"];

const MAX_SUMMARY_LENGTH = 500;
const MAX_TOOL_RESULT_CHARS = 12000;

export interface AdminChatRequest {
  screenKey: string;
  entityId: string | null;
  /** クライアント保持の会話履歴（role: "user" | "assistant" の平文のみ） */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AdminChatToolTrace {
  name: string;
  tier: ToolTier | null;
  status: "ok" | "error" | "blocked" | "pending_approval";
  summary: string;
}

/**
 * 承認カード1枚分。**id（承認トークン）はブラウザにだけ返し、AI には渡さない。**
 * AI 側のツール結果には「承認待ちにした」という事実だけを返す。
 */
export interface AdminChatPendingAction {
  id: string;
  toolName: string;
  summary: string;
  impact: string[];
  targetCount: number | null;
  expiresAt: string;
}

export interface AdminChatResponse {
  reply: string;
  toolTrace: AdminChatToolTrace[];
  /** ループ上限・タイムアウトで打ち切った場合 true */
  truncated: boolean;
  /** 人間の承認待ちになった Tier C 操作 */
  pendingActions: AdminChatPendingAction[];
}

function trim(value: string, max = MAX_SUMMARY_LENGTH): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/**
 * 共通ルールは版管理対象の BASE テンプレ（adminChatCommon）から取り、
 * 画面ごとに変わる部分（対象レコードID・使えるツール一覧）だけを実行時に足す。
 */
function buildSystemPrompt(tools: AdminChatTool[], entityId: string | null): string {
  const common = BASE_PROMPT_TEMPLATES.adminChatCommon?.template ?? "";
  const toolLines = tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  return [
    common,
    "",
    entityId
      ? `現在の画面が対象にしているレコードID: ${entityId}`
      : "現在の画面は特定のレコードに紐づいていません。",
    "",
    "利用可能なツール:",
    toolLines || "（この画面で使えるツールはありません）",
  ].join("\n");
}

/** ツール結果を AI に返す文字列へ。長すぎる場合はトリムして明示する */
function serializeToolResult(result: unknown): string {
  let text: string;
  try {
    text = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    text = String(result);
  }
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(結果が大きいため切り詰めました。条件を絞って再取得してください)`;
  }
  return text;
}

/** AI 呼び出しの差し替え口（テスト用。本番は runAdminToolChat をそのまま使う） */
export type ModelCaller = typeof runAdminToolChat;

export const adminChatService = {
  async runChat(
    request: AdminChatRequest,
    overrides?: { callModel?: ModelCaller }
  ): Promise<AdminChatResponse> {
    const callModel = overrides?.callModel ?? runAdminToolChat;
    const tools = toolsForScreen(request.screenKey);
    if (tools.length === 0) {
      throw new Error(`未登録の画面です: ${request.screenKey}`);
    }

    const instruction = trim(
      [...request.messages].reverse().find((m) => m.role === "user")?.content ?? ""
    );
    const openAiTools = toOpenAITools(tools);
    const messages: AdminChatMessage[] = [
      { role: "system", content: buildSystemPrompt(tools, request.entityId) },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const toolTrace: AdminChatToolTrace[] = [];
    const pendingActions: AdminChatPendingAction[] = [];
    const auditRecords: Parameters<typeof adminAiActionRepository.create>[0][] = [];
    const deadline = Date.now() + env.ADMIN_CHAT_TIMEOUT_MS;
    let truncated = false;
    let reply = "";
    let lastTokenUsage: Record<string, unknown> | null = null;

    for (let round = 0; round < env.ADMIN_CHAT_MAX_TOOL_ROUNDS; round += 1) {
      if (Date.now() > deadline) {
        truncated = true;
        break;
      }

      const result = await callModel({ messages, tools: openAiTools });
      lastTokenUsage = result.tokenUsage ?? lastTokenUsage;

      if (result.toolCalls.length === 0) {
        reply = result.content ?? "";
        break;
      }

      messages.push(result.message);

      for (const call of result.toolCalls) {
        const tool = getTool(call.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.argumentsJson) as Record<string, unknown>;
        } catch {
          args = {};
        }

        let status: AdminChatToolTrace["status"];
        let summary: string;
        let toolContent: string;

        if (!tool || !tool.screenKeys.includes(request.screenKey)) {
          // レジストリ外・別画面のツールを名指しされた場合（モデルの幻覚）
          status = "blocked";
          summary = "この画面では使えないツールです";
          toolContent = `エラー: ${summary}`;
        } else if (tool.tier === "C") {
          // Tier ゲートの本体: 不可逆・対外の操作は AI に実行させない。
          // prepare() でサーバー側が影響を計算し、承認カードを作って人間に渡す。
          try {
            const preparation = await tool.prepare?.(args, {
              entityId: request.entityId,
              screenKey: request.screenKey,
            });
            if (!preparation) {
              throw new Error("prepare が未実装です");
            }
            const pending = await adminAiPendingActionRepository.create({
              screen_key: request.screenKey,
              entity_id: request.entityId,
              instruction,
              tool_name: tool.name,
              tool_args_json: args,
              summary: preparation.summary,
              impact_json: preparation.impact,
              target_count: preparation.targetCount,
            });
            pendingActions.push({
              id: pending.id,
              toolName: tool.name,
              summary: preparation.summary,
              impact: preparation.impact,
              targetCount: preparation.targetCount,
              expiresAt: pending.expires_at,
            });
            status = "pending_approval";
            summary = `承認待ち: ${preparation.summary}`;
            // AI には承認トークン（pending.id）を渡さない。渡すと AI の出力経由で
            // 承認を偽装できる余地が生まれるため、事実だけを返す。
            toolContent =
              "この操作は実行していません。管理者の承認が必要なため、確認カードを画面に表示しました。" +
              "承認されると実行されます。あなたからは実行できないので、内容を1文で説明して確認を促してください。";
          } catch (error) {
            status = "error";
            summary = error instanceof Error ? error.message : String(error);
            toolContent = `エラー: ${trim(summary, 300)}`;
          }
        } else if (!ALLOWED_TIERS.includes(tool.tier)) {
          status = "blocked";
          summary = `Tier ${tool.tier} のため実行を拒否しました`;
          toolContent =
            "エラー: この操作は現在チャットから実行できません。管理画面の該当機能を案内してください。";
        } else {
          try {
            const output = await tool.execute(args, {
              entityId: request.entityId,
              screenKey: request.screenKey,
            });
            status = "ok";
            toolContent = serializeToolResult(output);
            summary = trim(toolContent, 200);
          } catch (error) {
            status = "error";
            summary = error instanceof Error ? error.message : String(error);
            toolContent = `エラー: ${trim(summary, 300)}`;
          }
        }

        toolTrace.push({ name: call.name, tier: tool?.tier ?? null, status, summary });
        auditRecords.push({
          screen_key: request.screenKey,
          entity_id: request.entityId,
          instruction,
          tool_name: call.name,
          tool_args_json: args,
          tier: tool?.tier ?? "C",
          // 承認待ちは「実行していない」ので blocked として記録する（実行の記録は承認時に別途残る）
          result_status: status === "pending_approval" ? "blocked" : status,
          result_summary: trim(summary),
        });

        messages.push({ role: "tool", tool_call_id: call.id, content: toolContent });
      }

      // 最終ラウンドでツール実行だけで終わった場合は打ち切り扱い
      if (round === env.ADMIN_CHAT_MAX_TOOL_ROUNDS - 1) {
        truncated = true;
      }
    }

    if (truncated && reply === "") {
      reply =
        "処理の途中で上限に達したため、ここまでの結果でお答えします。取得できた内容をもとに、条件を絞って再度お尋ねください。";
    }
    if (reply === "") {
      reply = "回答を生成できませんでした。もう一度お試しください。";
    }

    // 監査・ログはレスポンス前に await（投げっぱなし禁止）。失敗しても応答は返す。
    for (const record of auditRecords) {
      try {
        await adminAiActionRepository.create(record);
      } catch (error) {
        logger.warn("adminChatService: admin_ai_actions write failed", {
          tool: record.tool_name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    try {
      await aiLogRepository.create({
        session_id: null,
        purpose: `admin_chat:${request.screenKey}`,
        prompt: instruction,
        response: reply,
        token_usage: lastTokenUsage,
        prompt_key: "adminChatCommon",
        template_key: null,
        template_mode: "legacy",
        policy_snapshot: null,
        rendered_prompt: null,
        package_id: null,
        package_version_id: null,
        package_slug: null,
        package_version_no: null,
      });
    } catch (error) {
      logger.warn("adminChatService: ai_logs write failed", {
        screenKey: request.screenKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { reply, toolTrace, truncated, pendingActions };
  },

  /**
   * 承認カードのクリックで Tier C を実行する唯一の経路。
   *
   * - 承認トークン（pendingId）はブラウザにしか渡っていない＝AI 出力からは到達できない。
   * - **実行直前に prepare() を再計算し、対象件数が承認時と変わっていたら中断する。**
   *   プレビューと実行が別ロジックだったために「20代女性のつもりが全会員配信」になりうる、
   *   という既存の事故パターン（P0-3）をこの層で塞ぐ。
   * - consume() は consumed_at が null の行だけを更新するため、二度押しは実行に進めない。
   */
  async approvePendingAction(pendingId: string): Promise<{ ok: boolean; message: string }> {
    const pending = await adminAiPendingActionRepository.getById(pendingId);
    if (!pending) {
      return { ok: false, message: "この承認カードは見つかりませんでした。" };
    }
    if (pending.consumed_at) {
      return { ok: false, message: "この操作はすでに実行済みです。" };
    }
    if (new Date(pending.expires_at).getTime() < Date.now()) {
      return { ok: false, message: "承認の有効期限が切れています。もう一度チャットで依頼してください。" };
    }

    const tool = getTool(pending.tool_name);
    if (!tool || tool.tier !== "C" || typeof tool.prepare !== "function") {
      return { ok: false, message: "この操作は現在実行できません（ツール未登録）。" };
    }

    const ctx = { entityId: pending.entity_id, screenKey: pending.screen_key };
    const recomputed = await tool.prepare(pending.tool_args_json, ctx);
    if (
      recomputed.targetCount !== null &&
      pending.target_count !== null &&
      recomputed.targetCount !== pending.target_count
    ) {
      const message =
        `対象件数が承認時（${pending.target_count}件）から現在（${recomputed.targetCount}件）に変わったため中断しました。` +
        "もう一度確認してから実行してください。";
      await adminAiActionRepository.create({
        screen_key: pending.screen_key,
        entity_id: pending.entity_id,
        instruction: pending.instruction,
        tool_name: pending.tool_name,
        tool_args_json: pending.tool_args_json,
        tier: "C",
        approved: true,
        result_status: "blocked",
        result_summary: trim(message),
      });
      return { ok: false, message };
    }

    // 実行前にトークンを使い切る。ここで false なら他のリクエストが先に実行している。
    const consumed = await adminAiPendingActionRepository.consume(pendingId, "executing");
    if (!consumed) {
      return { ok: false, message: "この操作はすでに実行済みです。" };
    }

    try {
      const output = await tool.execute(pending.tool_args_json, ctx);
      const summary = trim(serializeToolResult(output), 200);
      await adminAiActionRepository.create({
        screen_key: pending.screen_key,
        entity_id: pending.entity_id,
        instruction: pending.instruction,
        tool_name: pending.tool_name,
        tool_args_json: pending.tool_args_json,
        tier: "C",
        approved: true,
        result_status: "ok",
        result_summary: summary,
      });
      return { ok: true, message: `実行しました: ${recomputed.summary}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await adminAiActionRepository.create({
        screen_key: pending.screen_key,
        entity_id: pending.entity_id,
        instruction: pending.instruction,
        tool_name: pending.tool_name,
        tool_args_json: pending.tool_args_json,
        tier: "C",
        approved: true,
        result_status: "error",
        result_summary: trim(message),
      });
      logger.warn("adminChatService: Tier C 実行に失敗", { tool: pending.tool_name, error: message });
      return { ok: false, message: `実行に失敗しました: ${trim(message, 200)}` };
    }
  },
};
