import { rankRepository } from "../repositories/rankRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import type { Rank, Respondent } from "../types/domain";

export const rankService = {
  async listRanks(): Promise<Rank[]> {
    return rankRepository.list();
  },

  async resolveRank(totalPoints: number): Promise<Rank | null> {
    const ranks = await rankRepository.list();
    const eligible = ranks.filter((rank) => totalPoints >= rank.min_points);
    return eligible.at(-1) ?? ranks[0] ?? null;
  },

  async getNextRank(totalPoints: number): Promise<Rank | null> {
    const ranks = await rankRepository.list();
    return ranks.find((rank) => rank.min_points > totalPoints) ?? null;
  },

  async syncRespondentRank(respondent: Respondent, reason: string): Promise<{
    updatedRespondent: Respondent;
    previousRankId: string | null;
    newRank: Rank | null;
    changed: boolean;
  }> {
    const newRank = await this.resolveRank(respondent.total_points);
    const previousRankId = respondent.current_rank_id;

    if (!newRank || newRank.id === previousRankId) {
      return {
        updatedRespondent: respondent,
        previousRankId,
        newRank,
        changed: false
      };
    }

    const updatedRespondent = await respondentRepository.update(respondent.id, {
      current_rank_id: newRank.id
    });

    await rankRepository.createHistory({
      respondent_id: respondent.id,
      previous_rank_id: previousRankId,
      new_rank_id: newRank.id,
      reason
    });

    return {
      updatedRespondent,
      previousRankId,
      newRank,
      changed: true
    };
  }
};
