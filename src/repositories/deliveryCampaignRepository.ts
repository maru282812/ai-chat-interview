import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";

export type CampaignStatus = "draft" | "scheduled" | "sent" | "cancelled";

export interface DeliveryCampaign {
  id: string;
  project_id: string | null;
  segment_id: string | null;
  name: string;
  status: CampaignStatus;
  delivery_channel: "liff" | "line";
  scheduled_at: string | null;
  sent_at: string | null;
  sent_count: number;
  opened_count: number;
  started_count: number;
  completed_count: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryCampaignWithProject extends DeliveryCampaign {
  project?: { id: string; name: string } | null;
  segment?: { id: string; name: string } | null;
}

export interface DeliveryCampaignCreateInput {
  project_id: string | null;
  segment_id?: string | null;
  name: string;
  delivery_channel?: "liff" | "line";
  scheduled_at?: string | null;
}

export const deliveryCampaignRepository = {
  async list(projectId?: string): Promise<DeliveryCampaignWithProject[]> {
    let query = supabase
      .from("delivery_campaigns")
      .select("*, project:projects(id,name), segment:segments(id,name)")
      .order("created_at", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    throwIfError(error);
    return (data ?? []) as DeliveryCampaignWithProject[];
  },

  async getById(id: string): Promise<DeliveryCampaignWithProject> {
    const { data, error } = await supabase
      .from("delivery_campaigns")
      .select("*, project:projects(id,name), segment:segments(id,name)")
      .eq("id", id)
      .single();
    throwIfError(error);
    return requireData(data as DeliveryCampaignWithProject | null, `Campaign not found: ${id}`);
  },

  async create(input: DeliveryCampaignCreateInput): Promise<DeliveryCampaign> {
    const { data, error } = await supabase
      .from("delivery_campaigns")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as DeliveryCampaign;
  },

  async update(id: string, input: Partial<DeliveryCampaign>): Promise<DeliveryCampaign> {
    const { data, error } = await supabase
      .from("delivery_campaigns")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as DeliveryCampaign;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("delivery_campaigns").delete().eq("id", id);
    throwIfError(error);
  }
};
