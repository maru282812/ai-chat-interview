import { toCsv } from "../lib/csv";
import { analysisRepository } from "../repositories/analysisRepository";
import { answerRepository } from "../repositories/answerRepository";
import { messageRepository } from "../repositories/messageRepository";
import { pointTransactionRepository } from "../repositories/pointTransactionRepository";
import { rankRepository } from "../repositories/rankRepository";

export const csvService = {
  async answersCsv(): Promise<string> {
    return toCsv(await answerRepository.listAll());
  },

  async messagesCsv(): Promise<string> {
    return toCsv(await messageRepository.listAll());
  },

  async analysisCsv(): Promise<string> {
    return toCsv(await analysisRepository.listAll());
  },

  async pointsCsv(): Promise<string> {
    return toCsv(await pointTransactionRepository.listAll());
  },

  async ranksCsv(): Promise<string> {
    return toCsv(await rankRepository.listHistories());
  }
};
