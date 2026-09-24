/**
 * missionStage.ts — ステージ判定ルール（純関数・Migration 098）
 *
 * 進捗の数え方（重要な設計判断）:
 *   回答数は既存の全回答経路に配線を足さず、**正準台帳 point_histories を数える**。
 *   台帳は awardPoints の一本道で書かれるので、ここを読む限り数え漏れも二重計上もない。
 *   既存機能への影響がゼロで済む。
 *
 * 判定はサーバー権威（R-4）。クライアントの進捗表示は信じない。
 */

import { PER_PERSON_CAP } from "./missionInvite";

/** 台帳のうち「回答した」とみなす transaction_type。 */
export const ANSWER_TRANSACTION_TYPES = Object.freeze([
  "daily_survey",
  "pool_question",
  "project_completion",
  "interview_complete",
] as const);

export interface MissionStageDef {
  stage_no: number;
  need_answers: number;
  need_invites: number;
  reward_points: number;
  is_masked: boolean;
}

export interface StageView {
  stageNo: number;
  needAnswers: number;
  needInvites: number;
  /** 未達かつマスク時は null（クライアントに額を渡さない＝??? 表示） */
  rewardPoints: number | null;
  state: "done" | "current" | "locked";
}

/**
 * 段の達成判定。条件は 回答数 OR 招待数（D-13）。
 * 招待だけを条件にすると「人脈があるほど上がる」になり、身内がいない人が詰む。
 */
export function isStageMet(stage: MissionStageDef, answers: number, invites: number): boolean {
  return answers >= stage.need_answers || invites >= stage.need_invites;
}

/** いま付与すべき段（達成済みかつ未受領）を昇順で返す。飛び級達成でも全段ぶん払う。 */
export function stagesToAward(
  stages: readonly MissionStageDef[],
  answers: number,
  invites: number,
  awardedStageNos: readonly number[]
): MissionStageDef[] {
  const got = new Set(awardedStageNos);
  return [...stages]
    .sort((a, b) => a.stage_no - b.stage_no)
    .filter((s) => !got.has(s.stage_no) && isStageMet(s, answers, invites));
}

/**
 * 画面用のステージビュー。
 * ⚠ マスクされた未達段の reward_points は **null にしてサーバーから出さない**。
 *   クライアントで隠すだけだとレスポンスに額が残り「???」の意味がなくなる。
 */
export function buildStageViews(
  stages: readonly MissionStageDef[],
  answers: number,
  invites: number,
  awardedStageNos: readonly number[]
): StageView[] {
  const got = new Set(awardedStageNos);
  const sorted = [...stages].sort((a, b) => a.stage_no - b.stage_no);
  let currentAssigned = false;
  return sorted.map((s) => {
    let state: StageView["state"];
    if (got.has(s.stage_no) || isStageMet(s, answers, invites)) {
      state = "done";
    } else if (!currentAssigned) {
      state = "current";
      currentAssigned = true;
    } else {
      state = "locked";
    }
    const revealed = state === "done" || !s.is_masked;
    return {
      stageNo: s.stage_no,
      needAnswers: s.need_answers,
      needInvites: s.need_invites,
      rewardPoints: revealed ? s.reward_points : null,
      state,
    };
  });
}

/** 現在段への残り。ゲージの「あと◯回」。goal gradient のため 0 始まりにしない。 */
export function remainingForStage(
  stage: MissionStageDef,
  answers: number,
  invites: number
): { answersLeft: number; invitesLeft: number } {
  return {
    answersLeft: Math.max(0, stage.need_answers - answers),
    invitesLeft: Math.max(0, stage.need_invites - invites),
  };
}

/**
 * ステージ定義のバリデーション（管理画面の保存時）。
 * - 報酬は上限 2,000pt（D-19。DB の CHECK と二重）
 * - 段が上がるほど条件は厳しく、報酬は下がらない
 * - 1段目のマスクは不可（何が起きるか分からないと最初の一歩が出ない）
 */
export function validateStages(stages: readonly MissionStageDef[]): string[] {
  const errors: string[] = [];
  const sorted = [...stages].sort((a, b) => a.stage_no - b.stage_no);
  if (sorted.length === 0) errors.push("ステージが1つもありません。");
  for (const s of sorted) {
    if (s.reward_points > PER_PERSON_CAP) {
      errors.push(`段${s.stage_no}: 報酬は上限 ${PER_PERSON_CAP}pt までです（景表法対応）。`);
    }
    if (s.reward_points <= 0) errors.push(`段${s.stage_no}: 報酬が0以下です。`);
    if (s.need_answers <= 0 || s.need_invites <= 0) {
      errors.push(`段${s.stage_no}: 条件は1以上にしてください。`);
    }
  }
  if (sorted[0]?.is_masked) {
    errors.push("1段目は「??? で隠す」にできません（最初の一歩が出なくなります）。");
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) continue;
    if (cur.need_answers <= prev.need_answers || cur.need_invites <= prev.need_invites) {
      errors.push(`段${cur.stage_no}: 条件は前の段より大きくしてください。`);
    }
  }
  return errors;
}
