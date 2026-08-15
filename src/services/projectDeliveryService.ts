import { supabase } from "../config/supabase";
import { logger } from "../lib/logger";
import { env } from "../config/env";
import { projectRepository } from "../repositories/projectRepository";
import { deliveryTemplateRepository } from "../repositories/deliveryTemplateRepository";
import type { DeliveryTemplate } from "../repositories/deliveryTemplateRepository";
import { notificationTemplateRepository } from "../repositories/notificationTemplateRepository";
import { lineMessagingService } from "./lineMessagingService";

export interface DeliveryRunResult {
  template_id: string;
  template_name: string;
  projects_matched: number;
  target_user_count: number;
  success_count: number;
  fail_count: number;
  ran_at: string;
}

async function getNotifiableLineUserIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("line_user_id")
    .eq("is_blocked", false)
    .eq("notification_ok", true)
    .eq("is_notification_stopped", false);

  if (error) {
    logger.error("projectDelivery: failed to fetch notifiable users", { error });
    return [];
  }
  return ((data ?? []) as Array<{ line_user_id: string }>).map((r) => r.line_user_id);
}

export type SegmentConfigPlan =
  | { kind: "all" }
  | { kind: "segment"; segmentId: string };

/**
 * segment_config を「絞らない」「このセグメントで絞る」のどちらかに解釈する純関数。
 *
 * 解釈できない設定を黙って「絞らない」に倒すと、絞ったつもりの配信が
 * 全員配信になる。判断できない時点で必ず投げる（fail-closed）。
 *
 * 対応する形式:
 *   null | {} | {type:"all"}              → 絞らない
 *   {type:"attribute", segment_id:"..."}  → segments の条件で絞る
 *   それ以外（例 {type:"rank"}）          → 例外
 */
export function resolveSegmentConfigPlan(
  config: Record<string, unknown> | null | undefined,
  templateName = "(不明)"
): SegmentConfigPlan {
  if (!config) return { kind: "all" };

  const type = (config as { type?: unknown }).type;
  if (type == null || type === "all") return { kind: "all" };

  if (type !== "attribute") {
    throw new Error(
      `配信テンプレ「${templateName}」の segment_config.type="${String(type)}" は未対応です。` +
        `対象を絞れないため配信を中止しました（全員配信を避けるため）。`
    );
  }

  const segmentId = (config as { segment_id?: unknown }).segment_id;
  if (typeof segmentId !== "string" || segmentId.length === 0) {
    throw new Error(
      `配信テンプレ「${templateName}」の segment_config に segment_id がありません。` +
        `対象を絞れないため配信を中止しました。`
    );
  }

  return { kind: "segment", segmentId };
}

/**
 * 配信テンプレの segment_config を解決して、宛先をさらに絞る。
 *
 * このカラムは 042 で作られて以来ずっと「設定はできるが誰も読まない」状態だった。
 * 絞ったつもりの条件が黙って無視されると、特定層向けのつもりの配信が
 * 通知可ユーザー全員に飛ぶ（デイリー配信側で実際に起きていたのと同じ事故）。
 * 解釈できない設定は絞れないと明示して止める（fail-closed）。
 *
 * 対応する形式:
 *   null | {type:"all"}                     → 絞らない（全通知可ユーザー）
 *   {type:"attribute", segment_id:"..."}    → segments の条件で絞る
 * 未対応（例: {type:"rank", ...}）はエラーにして配信させない。
 */
async function applySegmentConfig(
  template: DeliveryTemplate,
  lineUserIds: string[]
): Promise<string[]> {
  const plan = resolveSegmentConfigPlan(template.segment_config, template.name);
  if (plan.kind === "all") return lineUserIds;

  // 件数プレビュー・キャンペーン配信・デイリー配信と同じ評価器を通す。
  // 別実装を作ると「プレビューと実配信の対象が食い違う」が再発する。
  const { evaluateConditionsIds, findUnsupportedSegmentFields } = await import(
    "../controllers/adminController"
  );
  const { segmentRepository } = await import("../repositories/segmentRepository");

  const segment = await segmentRepository.getById(plan.segmentId);
  const unsupported = findUnsupportedSegmentFields(segment.conditions);
  if (unsupported.length > 0) {
    throw new Error(
      `配信テンプレ「${template.name}」のセグメント条件に未対応の項目があります` +
        `（${unsupported.join(", ")}）。条件を修正するまで配信できません。`
    );
  }

  const matched = await evaluateConditionsIds(supabase, segment.conditions);
  // 通知可の母集団を必ず先に通し、そこへ積で絞る
  // （評価器は notification_ok / is_notification_stopped を見ないため）。
  return lineUserIds.filter((id) => matched.has(id));
}

async function executeTemplate(template: DeliveryTemplate): Promise<DeliveryRunResult> {
  const result: DeliveryRunResult = {
    template_id: template.id,
    template_name: template.name,
    projects_matched: 0,
    target_user_count: 0,
    success_count: 0,
    fail_count: 0,
    ran_at: new Date().toISOString(),
  };

  const projects = await projectRepository.listReadyForDelivery(
    template.target_types as string[],
    template.created_within_hours
  );

  if (projects.length === 0) {
    logger.info("projectDelivery: no projects matched", { templateId: template.id });
    await deliveryTemplateRepository.createLog({
      template_id: template.id,
      executed_at: result.ran_at,
      project_ids: [],
      target_user_count: 0,
      success_count: 0,
      fail_count: 0,
    });
    return result;
  }

  result.projects_matched = projects.length;

  const lineUserIds = await applySegmentConfig(template, await getNotifiableLineUserIds());
  result.target_user_count = lineUserIds.length;

  // 条件で全員が外れたなら送るものが無い。案件を配信済みに倒す前に抜ける
  // （ここで進むと1通も送らないまま delivery_enabled が false になる）。
  if (lineUserIds.length === 0) {
    logger.info("projectDelivery: no target users after segment filter", {
      templateId: template.id,
      projectsMatched: projects.length,
    });
    await deliveryTemplateRepository.createLog({
      template_id: template.id,
      executed_at: result.ran_at,
      project_ids: projects.map((p) => p.id),
      target_user_count: 0,
      success_count: 0,
      fail_count: 0,
    });
    return result;
  }

  let notificationTemplate = null;
  if (template.notification_template_id) {
    try {
      notificationTemplate = await notificationTemplateRepository.getById(template.notification_template_id);
    } catch {
      logger.warn("projectDelivery: notification template not found", {
        templateId: template.id,
        notificationTemplateId: template.notification_template_id,
      });
    }
  }

  const liffBaseUrl = env.APP_BASE_URL;
  const projectListUrl = `${liffBaseUrl}/liff/projects`;

  for (const project of projects) {
    const projectUrl = `${projectListUrl}/${project.id}`;
    const projectTitle = project.user_display_title ?? project.name;

    let bodyText: string;
    if (notificationTemplate) {
      bodyText = notificationTemplateRepository.renderBody(notificationTemplate, {
        projectName: projectTitle,
        projectUrl,
        rewardPoints: String(project.reward_points),
        estimatedMinutes: String((project as unknown as Record<string, unknown>).estimated_minutes ?? ""),
      });
    } else {
      bodyText = `【新着案件】${projectTitle}\n\n${projectUrl}`;
    }

    let projectSuccess = 0;
    let projectFail = 0;

    for (const lineUserId of lineUserIds) {
      try {
        await lineMessagingService.push(lineUserId, [{ type: "text", text: bodyText }]);
        projectSuccess++;
        result.success_count++;
      } catch (e) {
        logger.error("projectDelivery: push failed", {
          templateId: template.id,
          projectId: project.id,
          lineUserId,
          error: String(e),
        });
        projectFail++;
        result.fail_count++;
      }
    }

    logger.info("projectDelivery: project delivered", {
      templateId: template.id,
      projectId: project.id,
      sent: projectSuccess,
      failed: projectFail,
    });

    if (projectSuccess > 0) {
      try {
        await projectRepository.markAsDelivered(project.id);
      } catch (e) {
        logger.error("projectDelivery: markAsDelivered failed", {
          projectId: project.id,
          error: String(e),
        });
      }
    }
  }

  await deliveryTemplateRepository.createLog({
    template_id: template.id,
    executed_at: result.ran_at,
    project_ids: projects.map((p) => p.id),
    target_user_count: result.target_user_count,
    success_count: result.success_count,
    fail_count: result.fail_count,
  });

  logger.info("projectDelivery: template done", result);
  return result;
}

export const projectDeliveryService = {
  async runTemplate(templateId: string): Promise<DeliveryRunResult> {
    const template = await deliveryTemplateRepository.getById(templateId);
    return executeTemplate(template);
  },

  async runAllEnabled(): Promise<DeliveryRunResult[]> {
    const templates = await deliveryTemplateRepository.listEnabled();
    const results: DeliveryRunResult[] = [];
    for (const template of templates) {
      try {
        const result = await executeTemplate(template);
        results.push(result);
      } catch (e) {
        logger.error("projectDelivery: template execution error", {
          templateId: template.id,
          error: String(e),
        });
      }
    }
    return results;
  },
};
