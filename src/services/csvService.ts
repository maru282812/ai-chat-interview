import type { AdminPostAnalysisFilters } from "./adminService";
import type { AdminPostFilters } from "../repositories/postRepository";
import { toCsv } from "../lib/csv";
import { analysisRepository } from "../repositories/analysisRepository";
import { answerExtractionRepository } from "../repositories/answerExtractionRepository";
import { answerRepository } from "../repositories/answerRepository";
import { messageRepository } from "../repositories/messageRepository";
import { pointTransactionRepository } from "../repositories/pointTransactionRepository";
import { rankRepository } from "../repositories/rankRepository";
import { assignmentService } from "./assignmentService";
import { researchOpsService } from "./researchOpsService";

export const csvService = {
  async answersCsv(): Promise<string> {
    const answers = await answerRepository.listAll();
    const extractionByAnswerId = new Map(
      (await answerExtractionRepository.listByAnswerIds(answers.map((answer) => answer.id))).map((extraction) => [
        extraction.source_answer_id,
        extraction
      ])
    );

    return toCsv(
      answers.map((answer) => {
        const extraction = extractionByAnswerId.get(answer.id) ?? null;
        return {
          ...answer,
          extracted_json: extraction?.extracted_json ? JSON.stringify(extraction.extracted_json) : "",
          extraction_status: extraction?.extraction_status ?? "",
          extraction_method: extraction?.extraction_method ?? "",
          extracted_at: extraction?.extracted_at ?? ""
        };
      })
    );
  },

  async messagesCsv(): Promise<string> {
    return toCsv(await messageRepository.listAll());
  },

  async analysisCsv(): Promise<string> {
    return toCsv(await analysisRepository.listAll());
  },

  async pointsCsv(): Promise<string> {
    return toCsv(await pointTransactionRepository.listAll());
  },

  async ranksCsv(): Promise<string> {
    return toCsv(await rankRepository.listHistories());
  },

  async projectRespondentsCsv(
    projectId: string,
    columnKey: "question_code" | "question_order" = "question_code"
  ): Promise<string> {
    return toCsv(await researchOpsService.buildProjectDeliveryRows(projectId, columnKey));
  },

  async projectAssignmentsCsv(projectId: string): Promise<string> {
    return toCsv(await assignmentService.exportAssignments(projectId));
  },

  async unansweredAssignmentsCsv(projectId: string): Promise<string> {
    return toCsv(await assignmentService.exportUnanswered(projectId));
  },

  async expiredAssignmentsCsv(projectId: string): Promise<string> {
    return toCsv(await assignmentService.exportExpired(projectId));
  },

  async userPostsCsv(filters: AdminPostFilters): Promise<string> {
    const rows = await researchOpsService.buildUserPostExportRows(filters);
    return toCsv(rows);
  },

  async postAnalysisCsv(filters: AdminPostAnalysisFilters): Promise<string> {
    const rows = await researchOpsService.buildPostAnalysisExportRows(filters);
    return toCsv(rows);
  }
};
