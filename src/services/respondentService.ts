import { env } from "../config/env";
import { rankRepository } from "../repositories/rankRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import type { Rank, Respondent } from "../types/domain";

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
  }
};
