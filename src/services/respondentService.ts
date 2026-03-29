import { env } from "../config/env";
import { rankRepository } from "../repositories/rankRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import type { Rank, Respondent } from "../types/domain";

function selectPrimaryRespondent(
  respondents: (Respondent & { current_rank?: Rank | null })[]
): (Respondent & { current_rank?: Rank | null }) | null {
  return (
    [...respondents].sort((left, right) => {
      if (right.total_points !== left.total_points) {
        return right.total_points - left.total_points;
      }
      return right.updated_at.localeCompare(left.updated_at);
    })[0] ?? null
  );
}

export const respondentService = {
  async ensureRespondent(lineUserId: string, displayName?: string | null): Promise<Respondent> {
    const existing = await respondentRepository.getByLineUserAndProject(lineUserId, env.DEFAULT_PROJECT_ID);
    if (existing) {
      if (displayName && existing.display_name !== displayName) {
        return respondentRepository.update(existing.id, { display_name: displayName });
      }
      return existing;
    }

    const created = await respondentRepository.create({
      line_user_id: lineUserId,
      display_name: displayName ?? null,
      project_id: env.DEFAULT_PROJECT_ID,
      status: "invited"
    });

    const ranks = await rankRepository.list();
    const initialRank = ranks[0];
    if (!initialRank) {
      return created;
    }

    return respondentRepository.update(created.id, { current_rank_id: initialRank.id });
  },

  async getRespondent(lineUserId: string): Promise<(Respondent & { current_rank?: Rank | null }) | null> {
    return respondentRepository.getByLineUserAndProject(lineUserId, env.DEFAULT_PROJECT_ID);
  },

  async listByLineUserId(
    lineUserId: string
  ): Promise<(Respondent & { current_rank?: Rank | null })[]> {
    return respondentRepository.listByLineUserId(lineUserId);
  },

  async getPrimaryRespondent(
    lineUserId: string
  ): Promise<(Respondent & { current_rank?: Rank | null }) | null> {
    const respondents = await respondentRepository.listByLineUserId(lineUserId);
    return selectPrimaryRespondent(respondents);
  },

  async ensureRespondentForProject(
    lineUserId: string,
    projectId: string,
    displayName?: string | null
  ): Promise<Respondent> {
    const existing = await respondentRepository.getByLineUserAndProject(lineUserId, projectId);
    const allRespondents = await respondentRepository.listByLineUserId(lineUserId);
    const primaryRespondent = selectPrimaryRespondent(allRespondents);

    if (existing) {
      const patch: Partial<
        Pick<Respondent, "display_name" | "total_points" | "current_rank_id">
      > = {};
      if (displayName && existing.display_name !== displayName) {
        patch.display_name = displayName;
      }
      if (
        primaryRespondent &&
        (existing.total_points !== primaryRespondent.total_points ||
          existing.current_rank_id !== primaryRespondent.current_rank_id)
      ) {
        patch.total_points = primaryRespondent.total_points;
        patch.current_rank_id = primaryRespondent.current_rank_id;
      }

      if (Object.keys(patch).length > 0) {
        return respondentRepository.update(existing.id, patch);
      }
      return existing;
    }

    const ranks = await rankRepository.list();
    const initialRank = primaryRespondent?.current_rank_id
      ? primaryRespondent.current_rank_id
      : (ranks[0]?.id ?? null);

    return respondentRepository.create({
      line_user_id: lineUserId,
      display_name: displayName ?? primaryRespondent?.display_name ?? null,
      project_id: projectId,
      status: "invited",
      total_points: primaryRespondent?.total_points ?? 0,
      current_rank_id: initialRank
    });
  }
};
