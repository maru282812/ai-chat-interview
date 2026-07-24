/**
 * 管理画面AIチャット Phase 4: セグメント作成・キャンペーン下書き（Tier B）
 * docs/impl-admin-ai-chat.md
 *
 * ここで作れるのは「誰に出すか」の条件と配信の下書きまで。**実配信は含まない**。
 * 実配信（executeCampaign）は現状コントローラのHTTPハンドラの中に手続きが埋まっており、
 * ツールから安全に呼ぶには切り出しが要る。中途半端に配線するとチャットから
 * LINE 送信が走る経路ができてしまうため、この周回では意図的に対象外にしている。
 *
 * 件数の評価は adminController の evaluateConditionsCount をそのまま使う。
 * プレビューと実配信が別ロジックだったために「20代女性向けのつもりが全会員配信」に
 * なりうるという既存の穴（P0-3）を、チャット経由でも再現しないための共有。
 */

import { supabase } from "../../../config/supabase";
import {
  evaluateConditionsCount,
  findUnsupportedSegmentFields,
} from "../../../controllers/adminController";
import { deliveryCampaignRepository } from "../../../repositories/deliveryCampaignRepository";
import { segmentRepository } from "../../../repositories/segmentRepository";
import { type AdminChatTool, registerTool } from "../toolRegistry";

const SCREENS = ["sessions-index", "research-form"];

const SEGMENT_TOOLS: AdminChatTool[] = [];

/**
 * 保存形式は {operator, groups:[{operator, conditions:[{field, op, value}]}]}。
 * 型定義（SegmentCreateInput）は旧形式のままなので、実データに合わせて組み立てる。
 */
function buildConditions(raw: unknown): { operator: "AND" | "OR"; groups: unknown[] } {
  const input = (raw ?? {}) as Record<string, unknown>;
  const conditions = Array.isArray(input["conditions"]) ? input["conditions"] : [];
  if (conditions.length === 0) {
    throw new Error("conditions が空です。少なくとも1つの条件が必要です。");
  }
  const operator = String(input["operator"] ?? "AND").toUpperCase() === "OR" ? "OR" : "AND";
  return {
    operator,
    groups: [{ operator, conditions }],
  };
}

SEGMENT_TOOLS.push({
  name: "preview_segment_count",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "条件に一致する会員が何人いるかを、保存せずに数える。セグメントを作る前の当たり確認に使う。conditions は [{field, op, value}] の配列（field 例: gender, prefecture, age, total_points）。",
  parameters: {
    type: "object",
    properties: {
      operator: { type: "string", description: "AND または OR（既定 AND）" },
      conditions: {
        type: "array",
        description: "条件の配列。各要素は {field, op, value}",
        items: { type: "object" },
      },
    },
    required: ["conditions"],
  },
  execute: async (args) => {
    const conditions = buildConditions(args);
    const unsupported = findUnsupportedSegmentFields(conditions);
    if (unsupported.length > 0) {
      throw new Error(
        `評価できない項目が含まれています: ${unsupported.join(", ")}。この条件では正しい人数を出せません。`
      );
    }
    const count = await evaluateConditionsCount(supabase, conditions);
    return { matched_members: count, conditions };
  },
});

SEGMENT_TOOLS.push({
  name: "create_segment",
  tier: "B",
  screenKeys: SCREENS,
  description:
    "配信対象を絞るセグメントを作成する。作成しただけでは何も配信されない。条件が評価できない項目を含む場合は作成せずエラーを返す。",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "セグメント名" },
      description: { type: "string", description: "説明（任意）" },
      operator: { type: "string", description: "AND または OR（既定 AND）" },
      conditions: {
        type: "array",
        description: "条件の配列。各要素は {field, op, value}",
        items: { type: "object" },
      },
    },
    required: ["name", "conditions"],
  },
  execute: async (args) => {
    const name = String(args["name"] ?? "").trim();
    if (!name) throw new Error("name が必要です。");

    const conditions = buildConditions(args);
    const unsupported = findUnsupportedSegmentFields(conditions);
    if (unsupported.length > 0) {
      throw new Error(
        `評価できない項目が含まれています: ${unsupported.join(", ")}。` +
          "このまま保存すると配信時に条件が無視され、意図より広い相手に届く恐れがあるため作成しません。"
      );
    }

    const count = await evaluateConditionsCount(supabase, conditions);
    const created = await segmentRepository.create({
      name,
      description:
        typeof args["description"] === "string" ? args["description"].trim() || undefined : undefined,
      conditions: conditions as never,
    });
    await segmentRepository.updateEstimatedCount(created.id, count);

    return {
      created: { id: created.id, name: created.name },
      matched_members: count,
      note: "セグメントを作成しました。配信は行っていません。",
    };
  },
});

SEGMENT_TOOLS.push({
  name: "draft_campaign",
  tier: "B",
  screenKeys: SCREENS,
  description:
    "配信キャンペーンを下書きとして作成する。下書きなので送信はされない。実際の配信は管理画面の配信オペレーションから人が実行する。",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "キャンペーン名" },
      project_id: { type: "string", description: "配信する案件ID" },
      segment_id: { type: "string", description: "対象セグメントID（省略時は全会員が対象）" },
    },
    required: ["name", "project_id"],
  },
  execute: async (args) => {
    const name = String(args["name"] ?? "").trim();
    const projectId = String(args["project_id"] ?? "").trim();
    if (!name || !projectId) throw new Error("name と project_id は必須です。");

    const segmentId =
      typeof args["segment_id"] === "string" && args["segment_id"].trim()
        ? args["segment_id"].trim()
        : undefined;

    const created = await deliveryCampaignRepository.create({
      name,
      project_id: projectId,
      segment_id: segmentId,
    });

    return {
      created: { id: created.id, name, status: created.status },
      note: segmentId
        ? "下書きを作成しました。送信はされていません。"
        : "セグメント未指定のため、実行すると全会員が対象になります。下書きのため送信はされていません。",
    };
  },
});

export function registerSegmentTools(): void {
  for (const tool of SEGMENT_TOOLS) {
    registerTool(tool);
  }
}
