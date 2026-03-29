import { logger } from "../lib/logger";
import {
  buildProjectAIStateFallback,
  normalizeProjectAIState,
  resolveProjectAIStateTemplateKey
} from "../lib/projectAiState";
import { projectRepository } from "../repositories/projectRepository";
import type { Project, ProjectAIState } from "../types/domain";
import { aiService } from "./aiService";

function buildNormalizedFallbackState(project: Project): ProjectAIState {
  return normalizeProjectAIState(buildProjectAIStateFallback({ project }), {
    fallbackTemplateKey: project.ai_state_template_key,
    fallbackProject: project
  });
}

export const projectAiStateService = {
  async ensureGenerated(projectId: string): Promise<Project> {
    const project = await projectRepository.getById(projectId);
    if (project.ai_state_json) {
      return project;
    }

    const templateKey = resolveProjectAIStateTemplateKey({
      templateKey: project.ai_state_template_key,
      researchMode: project.research_mode
    });

    try {
      const aiState = await aiService.generateProjectInitialState({ project });
      return projectRepository.update(project.id, {
        ai_state_json: normalizeProjectAIState(aiState, {
          fallbackTemplateKey: templateKey,
          fallbackProject: project
        }),
        ai_state_template_key: templateKey,
        ai_state_generated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.warn("Project AI state generation failed; fallback template will be stored", {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error)
      });

      return projectRepository.update(project.id, {
        ai_state_json: buildNormalizedFallbackState(project),
        ai_state_template_key: templateKey,
        ai_state_generated_at: new Date().toISOString()
      });
    }
  }
};

