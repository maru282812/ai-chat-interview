import { type ConceptRotationMode, assignConceptOrder } from "../lib/latinSquare";
import { projectConceptRepository } from "../repositories/projectConceptRepository";
import type { ProjectConcept } from "../types/domain";

/**
 * conceptService（L1 コンセプト・ローテーション）
 *
 * 複数コンセプトの管理と、回答者ごとの提示順（ラテン方格/全順列）の解決を行う。
 * 実際の「全コンセプトを順に回答させる」配信フローは別途ランタイム結線が必要（下流）。
 */
export const conceptService = {
  list(projectId: string): Promise<ProjectConcept[]> {
    return projectConceptRepository.listByProject(projectId);
  },

  /** アクティブなコンセプトコードをマスター順で返す。 */
  async activeConceptCodes(projectId: string): Promise<string[]> {
    const concepts = await projectConceptRepository.listByProject(projectId);
    return concepts.filter((concept) => concept.is_active).map((concept) => concept.concept_code);
  },

  /**
   * 回答者の提示順を解決する。
   * @param respondentIndex 回答者の通し番号（0始まり・安定値）
   */
  async resolveOrder(input: {
    projectId: string;
    respondentIndex: number;
    mode: ConceptRotationMode;
  }): Promise<string[]> {
    const codes = await this.activeConceptCodes(input.projectId);
    return assignConceptOrder(codes, input.respondentIndex, input.mode);
  }
};
