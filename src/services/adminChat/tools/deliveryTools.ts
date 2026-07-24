/**
 * 管理画面AIチャット Phase 4+: LINE配信キャンペーンの実行（Tier C）
 * docs/impl-admin-ai-chat.md
 *
 * これは回答者へ実際に LINE push が飛ぶ、取り消せない対外操作。必ず承認カード経由でのみ実行する。
 * prepare() と execute() は adminController の resolveCampaignTargets / deliverCampaign を
 * 共有する＝承認カードに出す人数と実配信対象が同じ評価器を通る（P0-3 の再発防止）。
 *
 * 依存の向き: このツール → adminController（関数参照）。adminController はツールを import
 * しないため循環しない（segmentTools が evaluateConditionsCount を import しているのと同じ）。
 */

import {
  deliverCampaign,
  resolveCampaignTargets,
} from "../../../controllers/adminController";
import { deliveryCampaignRepository } from "../../../repositories/deliveryCampaignRepository";
import { type AdminChatTool, registerTool } from "../toolRegistry";

const SCREENS = ["sessions-index", "research-form"];

const DELIVERY_TOOLS: AdminChatTool[] = [];

DELIVERY_TOOLS.push({
  name: "list_campaigns",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "配信キャンペーンの一覧を状態つきで取得する。配信を実行する前に対象のキャンペーンIDと状態（draft/scheduled/sent）を確認するのに使う。",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "案件IDで絞り込む（省略可）" },
    },
  },
  execute: async (args) => {
    const projectId = typeof args["project_id"] === "string" ? args["project_id"].trim() : "";
    const rows = await deliveryCampaignRepository.list(projectId || undefined);
    const items = (rows as unknown as Array<Record<string, unknown>>).slice(0, 50).map((row) => ({
      id: row["id"],
      name: row["name"],
      status: row["status"],
      delivery_channel: row["delivery_channel"],
      project: (row["project"] as Record<string, unknown> | null)?.["name"] ?? null,
      segment: (row["segment"] as Record<string, unknown> | null)?.["name"] ?? null,
      sent_count: row["sent_count"] ?? null,
    }));
    return {
      returned: items.length,
      items,
      note: "draft と scheduled はどちらも send_campaign でそのまま配信できます（事前のステータス変更は不要）。sent と cancelled だけは配信できません。",
    };
  },
});

DELIVERY_TOOLS.push({
  name: "send_campaign",
  tier: "C",
  screenKeys: SCREENS,
  description:
    "配信キャンペーンを実行し、対象の会員へLINEで案件を配信する。draft でも scheduled でも実行できる（送信済み・キャンセル済みを除く）。事前にステータス変更は不要。実際に送信され取り消せないため、実行には管理者の承認が必要。まず list_campaigns で対象のキャンペーンIDを確認すること。",
  parameters: {
    type: "object",
    properties: {
      campaign_id: { type: "string", description: "実行するキャンペーンID（必須）" },
    },
    required: ["campaign_id"],
  },
  /** 承認カードの人数は resolveCampaignTargets が実データから算出する（AI の申告値ではない） */
  prepare: async (args) => {
    const campaignId = String(args["campaign_id"] ?? "").trim();
    if (!campaignId) throw new Error("campaign_id が必要です。");

    const resolved = await resolveCampaignTargets({ campaignId });
    const count = resolved.targetLineUserIds.length;
    const channelLabel = resolved.campaign.delivery_channel === "line" ? "LINEメッセージ" : "LIFF案内";

    return {
      summary: `キャンペーン「${resolved.campaign.name}」を配信（${channelLabel}）`,
      impact: [
        resolved.isAllMembers
          ? "対象: セグメント未指定のためプロフィール登録済みの全会員"
          : "対象: 指定セグメントに一致する会員",
        `配信人数: ${count} 名`,
        `配信チャネル: ${resolved.campaign.delivery_channel}`,
        "実行すると即座に LINE push が送信され、取り消せません。",
      ],
      targetCount: count,
    };
  },
  execute: async (args) => {
    const campaignId = String(args["campaign_id"] ?? "").trim();
    if (!campaignId) throw new Error("campaign_id が必要です。");
    // 承認直前に approvePendingAction が prepare を再計算し件数一致を確認済み。
    // ここでも新鮮に解決してから配信する（解決と実行の間の乖離を最小化する）。
    const resolved = await resolveCampaignTargets({ campaignId });
    const result = await deliverCampaign(resolved);
    return { sent_count: result.sentCount, failed_count: result.failedCount };
  },
});

export function registerDeliveryTools(): void {
  for (const tool of DELIVERY_TOOLS) {
    registerTool(tool);
  }
}
