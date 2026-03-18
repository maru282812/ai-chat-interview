import { projectRepository } from "./projectRepository";
import { respondentRepository } from "./respondentRepository";
import { sessionRepository } from "./sessionRepository";

export const adminRepository = {
  async getDashboardStats() {
    const [activeProjects, activeSessions, completedSessions, totalRespondents] = await Promise.all([
      projectRepository.countByStatus("active"),
      sessionRepository.countByStatus("active"),
      sessionRepository.countByStatus("completed"),
      respondentRepository.countAll()
    ]);

    return {
      activeProjects,
      activeSessions,
      completedSessions,
      totalRespondents
    };
  }
};
