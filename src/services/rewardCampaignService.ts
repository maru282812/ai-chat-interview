import {
  rewardCampaignRepository,
  type RewardCampaign,
  type RewardCampaignInput
} from "../repositories/rewardCampaignRepository";

export const rewardCampaignService = {
  list(): Promise<RewardCampaign[]> {
    return rewardCampaignRepository.list();
  },

  getById(id: string): Promise<RewardCampaign> {
    return rewardCampaignRepository.getById(id);
  },

  create(input: RewardCampaignInput): Promise<RewardCampaign> {
    return rewardCampaignRepository.create(input);
  },

  update(id: string, input: Partial<RewardCampaignInput>): Promise<RewardCampaign> {
    return rewardCampaignRepository.update(id, input);
  },

  delete(id: string): Promise<void> {
    return rewardCampaignRepository.delete(id);
  },

  toggleActive(id: string): Promise<RewardCampaign> {
    return rewardCampaignRepository.toggleActive(id);
  }
};
