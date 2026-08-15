/**
 * crossProjectAnswerService.ts
 *
 * 別案件の回答を carry-forward で参照するための読み込み担当 (Migration 092)。
 *
 * 店舗アンケートの A（施術前）/ B（施術後）/ C（後日）のように、
 * 同一 respondent が複数案件を時間差で回答する構成で、
 * 「C の選択肢を A の回答で絞る」を成立させる。
 *
 * 責務:
 *   - projects.carry_forward_sources の宣言を解決し、参照先案件の primary 回答を集める。
 *
 * 責務外:
 *   - AnswerContext の組み立て（surveyFlowService.buildAnswerContext が行う）
 *   - 選択肢の絞り込みそのもの（questionEngine.applyCarryForward が行う）
 *
 * 設計上の約束:
 *   - 参照先が未回答・不在でも例外にしない。ctx にキーが載らない＝
 *     applyCarryForward が「まだ絞られていない状態」として扱う（mode=selected なら空）。
 *     回答導線を別案件の欠損で壊さないことを優先する。
 */

import { answerRepository } from "../repositories/answerRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { logger } from "../lib/logger";
import type { CarryForwardSource, Project } from "../types/domain";
import type { CrossProjectAnswers } from "./surveyFlowService";

/**
 * 案件の carry_forward_sources 宣言を解決し、同一 respondent の別案件回答を返す。
 * 宣言が無ければ空配列（＝呼び出し側は従来どおりの挙動）。
 */
export async function loadCrossProjectAnswers(
  project: Pick<Project, "carry_forward_sources">,
  respondentId: string | null
): Promise<CrossProjectAnswers[]> {
  const sources = project.carry_forward_sources ?? [];
  if (sources.length === 0 || !respondentId) return [];

  const settled = await Promise.allSettled(
    sources.map((src) => loadOneSource(src, respondentId))
  );

  const loaded: CrossProjectAnswers[] = [];
  for (const [i, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      if (result.value) loaded.push(result.value);
      continue;
    }
    // 参照先の読み込み失敗で本編の回答を止めない（絞り込みが効かないだけに留める）。
    logger.warn("crossProjectAnswers.loadFailed", {
      namespace: sources[i]?.namespace,
      entryCode: sources[i]?.entry_code,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }
  return loaded;
}

/** 参照先1件分。未回答・案件不在なら null。 */
async function loadOneSource(
  source: CarryForwardSource,
  respondentId: string
): Promise<CrossProjectAnswers | null> {
  const sourceProject = await projectRepository.findAnyByEntryCode(source.entry_code);
  if (!sourceProject) return null;

  const sessions = await sessionRepository.listByRespondent(respondentId);
  const sessionIds = sessions
    .filter((s) => s.project_id === sourceProject.id)
    .map((s) => s.id);
  if (sessionIds.length === 0) return null;

  const [questions, answers] = await Promise.all([
    questionRepository.listByProject(sourceProject.id),
    answerRepository.listBySessions(sessionIds),
  ]);

  return { namespace: source.namespace, questions, answers };
}
