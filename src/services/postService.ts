import { logger } from "../lib/logger";
import { postRepository } from "../repositories/postRepository";
import type {
  Answer,
  MenuActionKey,
  PostSourceChannel,
  Project,
  Respondent,
  Session,
  UserPost,
  UserPostType
} from "../types/domain";
import { analysisService } from "./analysisService";

function resolveAnswerPostType(project: Project): UserPostType {
  return project.research_mode === "interview" ? "interview" : "survey";
}

function resolveMenuActionKey(input: {
  postType: UserPostType;
  questionRole?: string | null;
  menuActionKey?: string | null;
}): MenuActionKey | string {
  if (input.menuActionKey?.trim()) {
    return input.menuActionKey.trim();
  }

  if (input.questionRole === "free_comment" || input.postType === "free_comment") {
    return "free_comment";
  }

  switch (input.postType) {
    case "rant":
      return "rant";
    case "diary":
      return "diary";
    case "survey":
      return "survey";
    default:
      return "interview";
  }
}

export const postService = {
  async syncAnswerToPost(input: {
    answer: Answer;
    respondent: Respondent;
    session: Session;
    project: Project;
    questionCode?: string | null;
    questionRole?: string | null;
    overrideType?: UserPostType;
    sourceChannel?: PostSourceChannel;
    menuActionKey?: string | null;
    title?: string | null;
    contentOverride?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<UserPost | null> {
    const postType = input.overrideType ?? resolveAnswerPostType(input.project);
    const content = input.contentOverride ?? input.answer.answer_text;
    const quality = analysisService.scorePostQuality({ content });
    const metadata = {
      answer_role: input.answer.answer_role,
      question_id: input.answer.question_id,
      question_code: input.questionCode ?? null,
      question_role: input.questionRole ?? null,
      source_mode: input.project.research_mode,
      quality_flags: quality.flags,
      ...(input.metadata ?? {})
    };

    const existing = await postRepository.findByAnswerId(input.answer.id);
    if (existing) {
      return postRepository.update(existing.id, {
        menu_action_key: resolveMenuActionKey({
          postType,
          questionRole: input.questionRole,
          menuActionKey: input.menuActionKey
        }),
        title: input.title ?? null,
        content,
        quality_score: quality.score,
        quality_label: quality.label,
        metadata
      });
    }

    try {
      return await postRepository.create({
        user_id: input.respondent.line_user_id,
        respondent_id: input.respondent.id,
        type: postType,
        project_id: input.project.id,
        session_id: input.session.id,
        answer_id: input.answer.id,
        source_channel: input.sourceChannel ?? "line",
        source_mode: input.project.research_mode,
        menu_action_key: resolveMenuActionKey({
          postType,
          questionRole: input.questionRole,
          menuActionKey: input.menuActionKey
        }),
        title: input.title ?? null,
        content,
        quality_score: quality.score,
        quality_label: quality.label,
        metadata,
        posted_on: null
      });
    } catch (error) {
      const duplicate = await postRepository.findByAnswerId(input.answer.id);
      if (duplicate) {
        return duplicate;
      }

      logger.warn("user_post_write_failed", {
        answer_id: input.answer.id,
        user_id: input.respondent.line_user_id,
        session_id: input.session.id,
        project_id: input.project.id,
        post_type: postType,
        error_message: error instanceof Error ? error.message : String(error),
        created_at: new Date().toISOString()
      });
      return null;
    }
  },

  async createStandalonePost(input: {
    userId: string;
    respondentId?: string | null;
    projectId?: string | null;
    sessionId?: string | null;
    type: Extract<UserPostType, "rant" | "diary">;
    content: string;
    sourceMode?: Project["research_mode"] | null;
    sourceChannel?: PostSourceChannel;
    menuActionKey?: string | null;
    title?: string | null;
    metadata?: Record<string, unknown> | null;
    postedOn?: string | null;
  }): Promise<UserPost> {
    const quality = analysisService.scorePostQuality({ content: input.content });
    return postRepository.create({
      user_id: input.userId,
      respondent_id: input.respondentId ?? null,
      type: input.type,
      project_id: input.projectId ?? null,
      session_id: input.sessionId ?? null,
      answer_id: null,
      source_channel: input.sourceChannel ?? "line",
      source_mode: input.sourceMode ?? null,
      menu_action_key: resolveMenuActionKey({
        postType: input.type,
        menuActionKey: input.menuActionKey
      }),
      title: input.title ?? null,
      content: input.content,
      quality_score: quality.score,
      quality_label: quality.label,
      metadata: {
        quality_flags: quality.flags,
        ...(input.metadata ?? {})
      },
      posted_on: input.postedOn ?? null
    });
  }
};
