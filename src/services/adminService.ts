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

export interface AdminProjectListRow {
  project: Awaited<ReturnType<typeof projectRepository.getById>>;
  questionCount: number;
  branchCount: number;
  hasBranches: boolean;
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

  async listProjects() {
    const projects = await projectRepository.list();
    const rows = await Promise.all(
      projects.map(async (project) => {
        const questions = await questionRepository.listByProject(project.id);
        const branchCount = questions.reduce((total, question) => {
          return total + describeBranchRule(question.branch_rule).branchCount;
        }, 0);

        return {
          project,
          questionCount: questions.length,
          branchCount,
          hasBranches: branchCount > 0
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
