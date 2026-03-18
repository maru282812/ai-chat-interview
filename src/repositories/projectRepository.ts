import { supabase } from "../config/supabase";
import type { Project, ProjectStatus } from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export const projectRepository = {
  async list(): Promise<Project[]> {
    const { data, error } = await supabase.from("projects").select("*").order("created_at", {
      ascending: false
    });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  async getById(id: string): Promise<Project> {
    const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return requireData(data as Project | null, "Project not found");
  },

  async create(input: {
    name: string;
    client_name?: string | null;
    objective?: string | null;
    status: ProjectStatus;
    reward_points: number;
  }): Promise<Project> {
    const { data, error } = await supabase.from("projects").insert(input).select("*").single();
    throwIfError(error);
    return data as Project;
  },

  async update(
    id: string,
    input: Partial<Pick<Project, "name" | "client_name" | "objective" | "status" | "reward_points">>
  ): Promise<Project> {
    const { data, error } = await supabase
      .from("projects")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Project;
  },

  async countByStatus(status: ProjectStatus): Promise<number> {
    const { count, error } = await supabase
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("status", status);
    throwIfError(error);
    return count ?? 0;
  }
};
