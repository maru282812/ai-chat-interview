import {
  dailyQuestionPriorityRepository,
  type DailyQuestionPriority,
  type DailyQuestionPriorityInput
} from "../repositories/dailyQuestionPriorityRepository";

export const dailyQuestionPriorityService = {
  list(): Promise<DailyQuestionPriority[]> {
    return dailyQuestionPriorityRepository.list();
  },

  listActive(): Promise<DailyQuestionPriority[]> {
    return dailyQuestionPriorityRepository.listActive();
  },

  getById(id: string): Promise<DailyQuestionPriority> {
    return dailyQuestionPriorityRepository.getById(id);
  },

  create(input: DailyQuestionPriorityInput): Promise<DailyQuestionPriority> {
    return dailyQuestionPriorityRepository.create(input);
  },

  update(id: string, input: Partial<DailyQuestionPriorityInput>): Promise<DailyQuestionPriority> {
    return dailyQuestionPriorityRepository.update(id, input);
  },

  delete(id: string): Promise<void> {
    return dailyQuestionPriorityRepository.delete(id);
  },

  toggleActive(id: string): Promise<DailyQuestionPriority> {
    return dailyQuestionPriorityRepository.toggleActive(id);
  }
};
