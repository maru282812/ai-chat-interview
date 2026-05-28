import type { Project } from "../types/domain";

export function getProjectDisplayTitle(
  project: Pick<Project, "name" | "user_display_title">
): string {
  return project.user_display_title?.trim() || project.name;
}
