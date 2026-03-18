import { adminRepository } from "../repositories/adminRepository";
import { analysisRepository } from "../repositories/analysisRepository";
import { messageRepository } from "../repositories/messageRepository";
import { pointTransactionRepository } from "../repositories/pointTransactionRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { rankRepository } from "../repositories/rankRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { sessionRepository } from "../repositories/sessionRepository";

export const adminService = {
  async dashboard() {
    return adminRepository.getDashboardStats();
  },

  async respondentDetail(respondentId: string) {
    const respondent = await respondentRepository.getById(respondentId);
    const sessions = await sessionRepository.listByRespondent(respondentId);
    const latestSession = sessions[0] ?? null;
    const messages = latestSession ? await messageRepository.listBySession(latestSession.id) : [];
    const analysis = latestSession ? await analysisRepository.getBySession(latestSession.id) : null;
    const transactions = await pointTransactionRepository.listByRespondent(respondentId);

    return {
      respondent,
      sessions,
      latestSession,
      messages,
      analysis,
      transactions
    };
  },

  async listProjects() {
    return projectRepository.list();
  },

  async listQuestions(projectId: string) {
    return questionRepository.listByProject(projectId);
  },

  async listRespondents() {
    return respondentRepository.list();
  },

  async listRanks() {
    return rankRepository.list();
  }
};
