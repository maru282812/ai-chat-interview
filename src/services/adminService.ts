import type {
  PostActionability,
  PostInsightType,
  PostSentiment,
  PostSourceChannel,
  UserPostType
} from "../types/domain";
import { describeBranchRule } from "../lib/questionDesign";
import { adminRepository } from "../repositories/adminRepository";
import {
  postRepository,
  type AdminPostDetail,
  type AdminPostFilters,
  type AdminPostRow
} from "../repositories/postRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { rankRepository } from "../repositories/rankRepository";
import { personalityService } from "./personalityService";
import { assignmentService } from "./assignmentService";
import { researchOpsService } from "./researchOpsService";

export interface AdminPostAnalysisFilters extends AdminPostFilters {
  sentiment?: PostSentiment | null;
  actionability?: PostActionability | null;
  insightType?: PostInsightType | null;
  tag?: string | null;
  keyword?: string | null;
}

export interface AdminTagSummaryRow {
  tag: string;
  count: number;
}

export interface ProjectPackageInfo {
  /** Phase C: 一覧からパッケージ詳細へ遷移するためのID（package 中心導線） */
  packageId: string;
  packageName: string;
  packageSlug: string;
  versionNo: number;
  versionStatus: string;
  isFallback: boolean;
  fallbackVersionNo?: number;
}

export interface AdminProjectListRow {
  project: Awaited<ReturnType<typeof projectRepository.getById>>;
  questionCount: number;
  branchCount: number;
  hasBranches: boolean;
  packageInfo: ProjectPackageInfo | null;
}

export interface AdminQuestionListRow {
  question: Awaited<ReturnType<typeof questionRepository.getById>>;
  hasBranches: boolean;
  branchCount: number;
  defaultNext: string | null;
  nextSummary: string | null;
}

function arrayContainsValue(values: unknown[] | null | undefined, term: string): boolean {
  return Array.isArray(values) && values.some((value) => String(value).toLowerCase().includes(term));
}

export const adminService = {
  summarizeTags(rows: AdminPostRow[], limit = 10): AdminTagSummaryRow[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of row.analysis?.tags ?? []) {
        const normalized = String(tag).trim();
        if (!normalized) {
          continue;
        }
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
      .slice(0, limit);
  },

  async dashboard() {
    return adminRepository.getDashboardStats();
  },

  async respondentDetail(respondentId: string) {
    return researchOpsService.getRespondentDetail(respondentId);
  },

  async listProjects(): Promise<AdminProjectListRow[]> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const projects = await projectRepository.list();

    // パッケージモードのプロジェクトに必要なバージョン・パッケージ情報を一括取得
    const packageModeProjects = projects.filter(
      (p) => p.ai_prompt_mode === "package" && p.ai_prompt_package_version_id
    );
    let versionMap = new Map<string, import("../repositories/promptPackageRepository").PromptPackageVersion>();
    let packageMap = new Map<string, import("../repositories/promptPackageRepository").PromptPackage>();
    let publishedVersionByPackage = new Map<string, import("../repositories/promptPackageRepository").PromptPackageVersion>();

    if (packageModeProjects.length > 0) {
      const versionIds = [...new Set(
        packageModeProjects.map((p) => p.ai_prompt_package_version_id as string)
      )];
      // 必要なバージョンを個別フェッチ（件数が少ないため並列）
      const versionResults = await Promise.all(
        versionIds.map((vid) => promptPackageRepository.getVersionById(vid).catch(() => null))
      );
      for (const v of versionResults) {
        if (v) versionMap.set(v.id, v);
      }

      // 必要なパッケージを取得
      const packageIds = [...new Set(
        Array.from(versionMap.values()).map((v) => v.package_id)
      )];
      const packageResults = await Promise.all(
        packageIds.map((pid) => promptPackageRepository.getById(pid).catch(() => null))
      );
      for (const pkg of packageResults) {
        if (pkg) packageMap.set(pkg.id, pkg);
      }

      // archived バージョンについて fallback 先（published）を取得
      const archivedPackageIds = Array.from(versionMap.values())
        .filter((v) => v.status === "archived")
        .map((v) => v.package_id);
      const uniqueArchivedPkgIds = [...new Set(archivedPackageIds)];
      const publishedResults = await Promise.all(
        uniqueArchivedPkgIds.map((pid) =>
          promptPackageRepository.getPublishedVersionByPackageId(pid).catch(() => null)
        )
      );
      uniqueArchivedPkgIds.forEach((pid, i) => {
        const pv = publishedResults[i];
        if (pv) publishedVersionByPackage.set(pid, pv);
      });
    }

    const rows = await Promise.all(
      projects.map(async (project) => {
        const questions = await questionRepository.listByProject(project.id);
        const branchCount = questions.reduce((total, question) => {
          return total + describeBranchRule(question.branch_rule).branchCount;
        }, 0);

        let packageInfo: ProjectPackageInfo | null = null;
        if (project.ai_prompt_mode === "package" && project.ai_prompt_package_version_id) {
          const version = versionMap.get(project.ai_prompt_package_version_id);
          if (version) {
            const pkg = packageMap.get(version.package_id);
            if (version.status === "archived") {
              const fallback = publishedVersionByPackage.get(version.package_id);
              packageInfo = {
                packageId: version.package_id,
                packageName: pkg?.name ?? version.package_id,
                packageSlug: pkg?.slug ?? "",
                versionNo: version.version_no,
                versionStatus: version.status,
                isFallback: !!fallback,
                fallbackVersionNo: fallback?.version_no,
              };
            } else {
              packageInfo = {
                packageId: version.package_id,
                packageName: pkg?.name ?? version.package_id,
                packageSlug: pkg?.slug ?? "",
                versionNo: version.version_no,
                versionStatus: version.status,
                isFallback: false,
              };
            }
          }
        }

        return {
          project,
          questionCount: questions.length,
          branchCount,
          hasBranches: branchCount > 0,
          packageInfo,
        };
      })
    );

    return rows;
  },

  async listQuestions(projectId: string) {
    const questions = await questionRepository.listByProject(projectId);

    return questions.map((question, index) => {
      const branchState = describeBranchRule(question.branch_rule);
      const fallbackNext = questions[index + 1]?.question_code ?? null;
      const nextSummary = branchState.hasBranches
        ? [
            branchState.defaultNext ? `default: ${branchState.defaultNext}` : null,
            `branches: ${branchState.branchCount}`
          ]
            .filter((item): item is string => Boolean(item))
            .join(" / ")
        : branchState.defaultNext ?? fallbackNext;

      return {
        question,
        hasBranches: branchState.hasBranches,
        branchCount: branchState.branchCount,
        defaultNext: branchState.defaultNext,
        nextSummary: nextSummary || fallbackNext
      };
    });
  },

  async listRespondents() {
    return researchOpsService.listRespondentOverviews();
  },

  async listProjectRespondents(projectId: string) {
    const [project, respondents] = await Promise.all([
      projectRepository.getById(projectId),
      researchOpsService.listRespondentOverviews(projectId)
    ]);

    return {
      project,
      respondents
    };
  },

  async sessionDetail(sessionId: string) {
    return researchOpsService.getSessionDetail(sessionId);
  },

  async projectAnalysis(projectId: string) {
    const dataset = await researchOpsService.buildProjectAnalysisDataset(projectId);
    return {
      project: dataset.project,
      dataset,
      latestReport: dataset.latestReport
    };
  },

  async projectDelivery(projectId: string) {
    return assignmentService.getProjectDeliveryOverview(projectId);
  },

  async listRanks() {
    return rankRepository.list();
  },

  async listPosts(filters: AdminPostFilters): Promise<AdminPostRow[]> {
    return postRepository.listAdmin(filters);
  },

  async getPostDetail(postId: string): Promise<AdminPostDetail | null> {
    return postRepository.getAdminDetail(postId);
  },

  async listPostAnalysis(filters: AdminPostAnalysisFilters): Promise<AdminPostRow[]> {
    const normalizedTag = filters.tag?.trim().toLowerCase() ?? "";
    const normalizedKeyword = filters.keyword?.trim().toLowerCase() ?? "";
    const rows = await postRepository.listAdmin({
      ...filters,
      analysisStatus: "analyzed"
    });

    return rows.filter((row) => {
      if (!row.analysis) {
        return false;
      }
      if (filters.sentiment && row.analysis.sentiment !== filters.sentiment) {
        return false;
      }
      if (filters.actionability && row.analysis.actionability !== filters.actionability) {
        return false;
      }
      if (filters.insightType && row.analysis.insight_type !== filters.insightType) {
        return false;
      }
      if (normalizedTag && !arrayContainsValue(row.analysis.tags, normalizedTag)) {
        return false;
      }
      if (normalizedKeyword && !arrayContainsValue(row.analysis.keywords, normalizedKeyword)) {
        return false;
      }
      return true;
    });
  },

  async getPersonalityPreview(userId: string) {
    return personalityService.getPreview(userId);
  }
};
