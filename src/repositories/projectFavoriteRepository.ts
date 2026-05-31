import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

interface ProjectFavorite {
  id: string;
  line_user_id: string;
  project_id: string;
  created_at: string;
}

export const projectFavoriteRepository = {
  async listByUser(lineUserId: string): Promise<ProjectFavorite[]> {
    const { data, error } = await supabase
      .from("project_favorites")
      .select("*")
      .eq("line_user_id", lineUserId)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectFavorite[];
  },

  async isFavorited(lineUserId: string, projectId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("project_favorites")
      .select("id")
      .eq("line_user_id", lineUserId)
      .eq("project_id", projectId)
      .maybeSingle();
    throwIfError(error);
    return data !== null;
  },

  async getFavoritedProjectIds(lineUserId: string): Promise<Set<string>> {
    const { data, error } = await supabase
      .from("project_favorites")
      .select("project_id")
      .eq("line_user_id", lineUserId);
    throwIfError(error);
    return new Set(((data ?? []) as { project_id: string }[]).map(r => r.project_id));
  },

  async add(lineUserId: string, projectId: string): Promise<void> {
    const { error } = await supabase
      .from("project_favorites")
      .insert({ line_user_id: lineUserId, project_id: projectId });
    // 重複エラー（23505）は無視する
    if (error && error.code !== "23505") throwIfError(error);
  },

  async remove(lineUserId: string, projectId: string): Promise<void> {
    const { error } = await supabase
      .from("project_favorites")
      .delete()
      .eq("line_user_id", lineUserId)
      .eq("project_id", projectId);
    throwIfError(error);
  },

  async toggle(lineUserId: string, projectId: string): Promise<{ saved: boolean }> {
    const already = await this.isFavorited(lineUserId, projectId);
    if (already) {
      await this.remove(lineUserId, projectId);
      return { saved: false };
    }
    await this.add(lineUserId, projectId);
    return { saved: true };
  }
};
