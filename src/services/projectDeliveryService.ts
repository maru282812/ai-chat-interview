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

  const lineUserIds = await getNotifiableLineUserIds();
  result.target_user_count = lineUserIds.length;

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
