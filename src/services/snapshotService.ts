import { buildSnapshotDefinition, codebookFromSnapshot, snapshotHash } from "../lib/statExport";
import { questionRepository } from "../repositories/questionRepository";
import { questionnaireSnapshotRepository } from "../repositories/questionnaireSnapshotRepository";
import { projectRepository } from "../repositories/projectRepository";
import { deriveCodebook } from "../lib/codebook";
import type { VariableDefinition } from "../lib/codebook";
import type { QuestionnaireSnapshot } from "../types/domain";

/**
 * snapshotService（統計エクスポート §1/§14）
 *
 * 公開/送付時点の調査票定義を凍結保存する。内容ハッシュが同じなら版を増やさず再利用し、
 * 変わっていれば version をインクリメントして新版を作る。
 */
export const snapshotService = {
  /** 現在の設問構成からスナップショットを作成（同一内容なら既存版を返す）。 */
  async createOrReuse(projectId: string, waveCode?: string | null): Promise<QuestionnaireSnapshot> {
    const [project, questions] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId)
    ]);
    const definition = buildSnapshotDefinition(project, questions);
    const hash = snapshotHash(definition);

    const existing = await questionnaireSnapshotRepository.getByHash(projectId, hash);
    if (existing) {
      return existing;
    }

    const latest = await questionnaireSnapshotRepository.getLatest(projectId);
    return questionnaireSnapshotRepository.create({
      project_id: projectId,
      version: (latest?.version ?? 0) + 1,
      wave_code: waveCode ?? null,
      snapshot_hash: hash,
      definition_json: definition
    });
  },

  list(projectId: string): Promise<QuestionnaireSnapshot[]> {
    return questionnaireSnapshotRepository.listByProject(projectId);
  },

  getActive(projectId: string): Promise<QuestionnaireSnapshot | null> {
    return questionnaireSnapshotRepository.getActive(projectId);
  },

  /**
   * エクスポート用の変数定義(codebook)を解決する。
   * 有効なスナップショットがあればそれを基準にし（回答時点の定義・列順を維持・§2/§13）、
   * 無ければ現在の設問から導出する（既存プロジェクト後方互換・§12）。
   */
  async resolveCodebook(projectId: string, questions?: Parameters<typeof deriveCodebook>[0]): Promise<VariableDefinition[]> {
    const active = await questionnaireSnapshotRepository.getActive(projectId);
    const fromSnapshot = active ? codebookFromSnapshot(active.definition_json) : null;
    if (fromSnapshot && fromSnapshot.length > 0) {
      return fromSnapshot;
    }
    const liveQuestions = questions ?? (await questionRepository.listByProject(projectId));
    return deriveCodebook(liveQuestions);
  }
};
