import { analysisRepository } from "../repositories/analysisRepository";
import { answerExtractionRepository } from "../repositories/answerExtractionRepository";
import { answerRepository } from "../repositories/answerRepository";
import { messageRepository } from "../repositories/messageRepository";
import { postRepository, type AdminPostFilters } from "../repositories/postRepository";
import { pointTransactionRepository } from "../repositories/pointTransactionRepository";
import { projectAnalysisRepository } from "../repositories/projectAnalysisRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import type { AdminPostAnalysisFilters } from "./adminService";
import type { AIAnalysisResult, Answer, AnswerExtraction, Project, Question, Session } from "../types/domain";

type RespondentWithRank = Awaited<ReturnType<typeof respondentRepository.getById>>;

export interface SessionAnswerGroup {
  question: Question;
  primaryAnswer: Answer | null;
  extraction: AnswerExtraction | null;
  probeAnswers: Answer[];
  hasAiProbe: boolean;
}

export interface RespondentSessionOverview {
  respondent: RespondentWithRank;
  project: Project;
  sessions: Session[];
  latestSession: Session | null;
  deliverySession: Session | null;
  sessionCount: number;
  completedSessionCount: number;
  lastActivityAt: string | null;
}

function isAiProbeAnswer(answer: Answer): boolean {
  return (
    answer.answer_role === "ai_probe" ||
    (answer.normalized_answer?.source as string | undefined) === "ai_probe"
  );
}

function sortSessionsByCompletion(sessions: Session[]): Session[] {
  return [...sessions].sort((left, right) => {
    const leftTime = left.completed_at ?? left.started_at;
    const rightTime = right.completed_at ?? right.started_at;
    return rightTime.localeCompare(leftTime);
  });
}

function selectDeliverySession(sessions: Session[]): Session | null {
  const completed = sortSessionsByCompletion(sessions.filter((session) => session.status === "completed"));
  return completed[0] ?? sessions[0] ?? null;
}

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function stringifyJson(value: unknown): string {
  return value === null || value === undefined ? "" : JSON.stringify(value);
}

function stringifyArray(value: unknown[] | null | undefined): string {
  return Array.isArray(value) ? value.map((item) => String(item)).join(" | ") : "";
}

function includesIgnoreCase(values: unknown[] | null | undefined, term: string): boolean {
  return Array.isArray(values) && values.some((value) => String(value).toLowerCase().includes(term));
}

function buildAnswerGroups(
  questions: Question[],
  answers: Answer[],
  extractionByAnswerId: Map<string, AnswerExtraction> = new Map()
): SessionAnswerGroup[] {
  const answersByQuestion = new Map<string, Answer[]>();

  for (const answer of answers) {
    const list = answersByQuestion.get(answer.question_id) ?? [];
    list.push(answer);
    answersByQuestion.set(answer.question_id, list);
  }

  return questions.map((question) => {
    const related = answersByQuestion.get(question.id) ?? [];
    const primaryAnswer = related.find((answer) => !isAiProbeAnswer(answer)) ?? null;
    const probeAnswers = related.filter((answer) => isAiProbeAnswer(answer));

    return {
      question,
      primaryAnswer,
      extraction: primaryAnswer ? extractionByAnswerId.get(primaryAnswer.id) ?? null : null,
      probeAnswers,
      hasAiProbe: probeAnswers.length > 0
    };
  });
}

function labelsForStructuredAnswer(answer: Answer): string[] {
  const normalized = answer.normalized_answer ?? {};

  if (Array.isArray(normalized.labels)) {
    return normalized.labels.map((value) => String(value));
  }

  if (typeof normalized.label === "string" && normalized.label.trim()) {
    return [normalized.label.trim()];
  }

  if (Array.isArray(normalized.values)) {
    return normalized.values.map((value) => String(value));
  }

  if (normalized.value !== undefined && normalized.value !== null) {
    return [String(normalized.value)];
  }

  return answer.answer_text ? [answer.answer_text] : [];
}

function labelsForComparableSlots(answer: Answer): string[] {
  const normalized = answer.normalized_answer ?? {};
  const extractionValue =
    normalized.extraction && typeof normalized.extraction === "object" && !Array.isArray(normalized.extraction)
      ? (normalized.extraction as Record<string, unknown>)
      : null;
  const extractionSummary =
    normalized.extracted_branch_payload && typeof normalized.extracted_branch_payload === "object"
      ? (normalized.extracted_branch_payload as Record<string, unknown>)
      : extractionValue && extractionValue.summary && typeof extractionValue.summary === "object"
        ? (extractionValue.summary as Record<string, unknown>)
        : null;

  if (extractionSummary) {
    return Object.entries(extractionSummary)
      .flatMap(([key, value]) => {
        if (Array.isArray(value)) {
          return value
            .map((item) => {
              if (item && typeof item === "object") {
                return `${key}:${JSON.stringify(item)}`;
              }
              return `${key}:${String(item)}`;
            })
            .filter(Boolean);
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return [`${key}:${String(value)}`];
        }
        return [];
      })
      .filter(Boolean);
  }

  const comparablePayload =
    normalized.comparable_payload && typeof normalized.comparable_payload === "object"
      ? (normalized.comparable_payload as Record<string, unknown>)
      : null;

  if (comparablePayload) {
    return Object.entries(comparablePayload)
      .flatMap(([key, value]) => {
        if (typeof value === "string" && value.trim()) {
          return [`${key}:${value.trim()}`];
        }
        if (Array.isArray(value)) {
          return value.map((item) => `${key}:${String(item).trim()}`).filter((item) => !item.endsWith(":"));
        }
        return [];
      })
      .filter(Boolean);
  }

  const extractedSlots = Array.isArray(normalized.extracted_slots)
    ? (normalized.extracted_slots as Array<Record<string, unknown>>)
    : [];

  return extractedSlots
    .map((slot) => {
      const key = String(slot.key ?? "").trim();
      const value = String(slot.value ?? "").trim();
      return key && value ? `${key}:${value}` : "";
    })
    .filter(Boolean);
}

function buildRespondentSummary(input: {
  respondent: RespondentWithRank;
  session: Session;
  groups: SessionAnswerGroup[];
  analysis: AIAnalysisResult | null;
}) {
  const fallbackSummary = input.groups
    .filter((group) => group.primaryAnswer)
    .slice(0, 2)
    .map((group) => `${group.question.question_code}: ${group.primaryAnswer?.answer_text}`)
    .join(" / ");

  return {
    respondent_id: input.respondent.id,
    respondent_name: input.respondent.display_name || input.respondent.line_user_id,
    line_user_id: input.respondent.line_user_id,
    session_id: input.session.id,
    session_status: input.session.status,
    completed_at: input.session.completed_at,
    summary: truncate(input.analysis?.summary || input.session.summary || fallbackSummary || "No summary", 140)
  };
}

async function loadProjectBase(projectId: string) {
  const [project, questions, respondents, sessions] = await Promise.all([
    projectRepository.getById(projectId),
    questionRepository.listByProject(projectId),
    respondentRepository.listByProject(projectId),
    sessionRepository.listByProject(projectId)
  ]);

  const sessionsByRespondent = new Map<string, Session[]>();
  for (const session of sessions) {
    const list = sessionsByRespondent.get(session.respondent_id) ?? [];
    list.push(session);
    sessionsByRespondent.set(session.respondent_id, list);
  }

  return {
    project,
    questions,
    respondents,
    sessionsByRespondent
  };
}

export const researchOpsService = {
  async listRespondentOverviews(projectId?: string): Promise<RespondentSessionOverview[]> {
    const [projects, respondents, sessions] = await Promise.all([
      projectRepository.list(),
      projectId ? respondentRepository.listByProject(projectId) : respondentRepository.list(),
      projectId ? sessionRepository.listByProject(projectId) : sessionRepository.listAll()
    ]);

    const projectMap = new Map(projects.map((project) => [project.id, project]));
    const sessionsByRespondent = new Map<string, Session[]>();

    for (const session of sessions) {
      const list = sessionsByRespondent.get(session.respondent_id) ?? [];
      list.push(session);
      sessionsByRespondent.set(session.respondent_id, list);
    }

    return respondents
      .map((respondent) => {
        const project = projectMap.get(respondent.project_id);
        const respondentSessions = sessionsByRespondent.get(respondent.id) ?? [];
        const latestSession = respondentSessions[0] ?? null;

        return project
          ? {
              respondent,
              project,
              sessions: respondentSessions,
              latestSession,
              deliverySession: selectDeliverySession(respondentSessions),
              sessionCount: respondentSessions.length,
              completedSessionCount: respondentSessions.filter(
                (session) => session.status === "completed"
              ).length,
              lastActivityAt: latestSession?.last_activity_at ?? null
            }
          : null;
      })
      .filter((item): item is RespondentSessionOverview => Boolean(item));
  },

  async getRespondentDetail(respondentId: string) {
    const respondent = await respondentRepository.getById(respondentId);
    const [project, sessions, transactions] = await Promise.all([
      projectRepository.getById(respondent.project_id),
      sessionRepository.listByRespondent(respondentId),
      pointTransactionRepository.listByRespondent(respondentId)
    ]);

    return {
      respondent,
      project,
      sessions,
      latestSession: sessions[0] ?? null,
      deliverySession: selectDeliverySession(sessions),
      transactions
    };
  },

  async getSessionDetail(sessionId: string) {
    const session = await sessionRepository.getById(sessionId);
    const [respondent, project, questions, answers, messages, analysis] = await Promise.all([
      respondentRepository.getById(session.respondent_id),
      projectRepository.getById(session.project_id),
      questionRepository.listByProject(session.project_id),
      answerRepository.listBySession(session.id),
      messageRepository.listBySession(session.id),
      analysisRepository.getBySession(session.id)
    ]);
    const extractionByAnswerId = new Map(
      (await answerExtractionRepository.listByAnswerIds(answers.map((answer) => answer.id))).map((extraction) => [
        extraction.source_answer_id,
        extraction
      ])
    );

    return {
      respondent,
      project,
      session,
      answerGroups: buildAnswerGroups(questions, answers, extractionByAnswerId),
      messages,
      analysis
    };
  },

  async buildProjectDeliveryRows(
    projectId: string,
    columnKey: "question_code" | "question_order" = "question_code"
  ): Promise<Record<string, string | number | boolean | null>[]> {
    const { project, questions, respondents, sessionsByRespondent } = await loadProjectBase(projectId);

    const selectedSessions = respondents
      .map((respondent) => ({
        respondent,
        session: selectDeliverySession(sessionsByRespondent.get(respondent.id) ?? [])
      }))
      .filter((item): item is { respondent: RespondentWithRank; session: Session } => Boolean(item.session));

    const answers = await answerRepository.listBySessions(selectedSessions.map((item) => item.session.id));
    const extractionByAnswerId = new Map(
      (await answerExtractionRepository.listByAnswerIds(answers.map((answer) => answer.id))).map((extraction) => [
        extraction.source_answer_id,
        extraction
      ])
    );
    const answersBySession = new Map<string, Answer[]>();

    for (const answer of answers) {
      const list = answersBySession.get(answer.session_id) ?? [];
      list.push(answer);
      answersBySession.set(answer.session_id, list);
    }

    return selectedSessions.map(({ respondent, session }) => {
      const groups = buildAnswerGroups(questions, answersBySession.get(session.id) ?? [], extractionByAnswerId);
      const row: Record<string, string | number | boolean | null> = {
        project_id: project.id,
        project_name: project.name,
        client_name: project.client_name,
        project_status: project.status,
        project_objective: project.objective,
        research_mode: project.research_mode,
        primary_objectives: (project.primary_objectives || []).join(" | "),
        secondary_objectives: (project.secondary_objectives || []).join(" | "),
        respondent_id: respondent.id,
        line_user_id: respondent.line_user_id,
        display_name: respondent.display_name,
        respondent_status: respondent.status,
        session_id: session.id,
        session_status: session.status,
        session_phase: session.current_phase,
        respondent_created_at: respondent.created_at,
        session_started_at: session.started_at,
        session_completed_at: session.completed_at,
        session_last_activity_at: session.last_activity_at
      };

      for (const group of groups) {
        const keyBase =
          columnKey === "question_code"
            ? group.question.question_code
            : `q${String(group.question.sort_order).padStart(2, "0")}`;

        row[`${keyBase}_answer_text`] = group.primaryAnswer?.answer_text ?? null;
        row[`${keyBase}_normalized_answer`] = stringifyJson(group.primaryAnswer?.normalized_answer ?? null);
        row[`${keyBase}_extracted_json`] = stringifyJson(group.extraction?.extracted_json ?? null);
        row[`${keyBase}_extraction_status`] = group.extraction?.extraction_status ?? null;
        row[`${keyBase}_extraction_method`] = group.extraction?.extraction_method ?? null;
        row[`${keyBase}_ai_probe`] = group.hasAiProbe;
      }

      return row;
    });
  },

  async buildProjectAnalysisDataset(projectId: string) {
    const { project, questions, respondents, sessionsByRespondent } = await loadProjectBase(projectId);

    const selectedSessions = respondents
      .map((respondent) => ({
        respondent,
        session: selectDeliverySession(sessionsByRespondent.get(respondent.id) ?? [])
      }))
      .filter((item): item is { respondent: RespondentWithRank; session: Session } => Boolean(item.session));

    const [answers, analyses, latestReport] = await Promise.all([
      answerRepository.listBySessions(selectedSessions.map((item) => item.session.id)),
      analysisRepository.listAll(),
      projectAnalysisRepository.getLatestByProject(projectId)
    ]);
    const extractionByAnswerId = new Map(
      (await answerExtractionRepository.listByAnswerIds(answers.map((answer) => answer.id))).map((extraction) => [
        extraction.source_answer_id,
        extraction
      ])
    );

    const answersBySession = new Map<string, Answer[]>();
    for (const answer of answers) {
      const list = answersBySession.get(answer.session_id) ?? [];
      list.push(answer);
      answersBySession.set(answer.session_id, list);
    }

    const groupsBySession = new Map<string, SessionAnswerGroup[]>();
    for (const { session } of selectedSessions) {
      groupsBySession.set(
        session.id,
        buildAnswerGroups(questions, answersBySession.get(session.id) ?? [], extractionByAnswerId)
      );
    }

    const analysisBySession = new Map(
      analyses
        .filter((analysis) => selectedSessions.some((item) => item.session.id === analysis.session_id))
        .map((analysis) => [analysis.session_id, analysis] as const)
    );

    const respondentSummaries = selectedSessions.map(({ respondent, session }) =>
      buildRespondentSummary({
        respondent,
        session,
        groups: groupsBySession.get(session.id) ?? [],
        analysis: analysisBySession.get(session.id) ?? null
      })
    );

    const comparisonUnits = questions.map((question) => {
      const primaryAnswers = selectedSessions
        .map(({ session }) =>
          (groupsBySession.get(session.id) ?? []).find((group) => group.question.id === question.id)?.primaryAnswer ??
          null
        )
        .filter((answer): answer is Answer => Boolean(answer));

      if (question.question_type === "text") {
        const comparableLabels = primaryAnswers.flatMap((answer) => labelsForComparableSlots(answer));
        if (comparableLabels.length > 0) {
          const counts = new Map<string, number>();
          for (const label of comparableLabels) {
            counts.set(label, (counts.get(label) ?? 0) + 1);
          }

          return {
            question_id: question.id,
            question_code: question.question_code,
            question_order: question.sort_order,
            question_text: question.question_text,
            question_role: question.question_role,
            question_type: question.question_type,
            aggregation_type: "structured_slots" as const,
            response_count: primaryAnswers.length,
            values: [...counts.entries()]
              .map(([label, count]) => ({ label, count }))
              .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
              .slice(0, 12),
            note: "Comparable by extracted slot values."
          };
        }

        return {
          question_id: question.id,
          question_code: question.question_code,
          question_order: question.sort_order,
          question_text: question.question_text,
          question_role: question.question_role,
          question_type: question.question_type,
          aggregation_type: "qualitative_only" as const,
          response_count: primaryAnswers.length,
          values: [],
          note: "Qualitative only. Do not use for ratio claims."
        };
      }

      const counts = new Map<string, number>();
      for (const answer of primaryAnswers) {
        for (const label of labelsForStructuredAnswer(answer)) {
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
      }

      return {
        question_id: question.id,
        question_code: question.question_code,
        question_order: question.sort_order,
        question_text: question.question_text,
        question_role: question.question_role,
        question_type: question.question_type,
        aggregation_type: "structured" as const,
        response_count: primaryAnswers.length,
        values: [...counts.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
          .slice(0, 10),
        note: "Structured and comparable."
      };
    });

    const nonComparableQuestions = comparisonUnits.filter(
      (unit) => unit.aggregation_type === "qualitative_only"
    );

    return {
      project,
      questions,
      respondent_count: selectedSessions.length,
      completed_session_count: selectedSessions.filter(({ session }) => session.status === "completed").length,
      respondentSummaries,
      comparisonUnits,
      nonComparableQuestions,
      freeAnswerPolicy: {
        policy:
          "Free-text answers are summarized qualitatively around repeated themes and objective relevance. Do not let unusual single quotes dominate.",
        target_question_codes: nonComparableQuestions.map((unit) => unit.question_code)
      },
      latestReport
    };
  },

  async buildUserPostExportRows(filters: AdminPostFilters) {
    const rows = await postRepository.listAdmin({
      ...filters,
      limit: filters.limit ?? 5000
    });

    return rows.map((row) => ({
      post_id: row.post.id,
      created_at: row.post.created_at,
      posted_on: row.post.posted_on,
      type: row.post.type,
      user_id: row.post.user_id,
      respondent_id: row.post.respondent_id,
      respondent_name: row.respondentDisplayName,
      respondent_line_user_id: row.respondentLineUserId,
      project_id: row.post.project_id,
      project_name: row.projectName,
      session_id: row.post.session_id,
      answer_id: row.post.answer_id,
      source_channel: row.post.source_channel,
      source_mode: row.post.source_mode,
      menu_action_key: row.post.menu_action_key,
      quality_score: row.post.quality_score,
      quality_label: row.post.quality_label,
      title: row.post.title,
      content: row.post.content,
      metadata_json: stringifyJson(row.post.metadata),
      analysis_status: row.analysis_status,
      analysis_summary: row.analysis?.summary ?? "",
      sentiment: row.analysis?.sentiment ?? "",
      insight_type: row.analysis?.insight_type ?? "",
      specificity: row.analysis?.specificity ?? "",
      novelty: row.analysis?.novelty ?? "",
      actionability: row.analysis?.actionability ?? "",
      tags: stringifyArray(row.analysis?.tags),
      keywords: stringifyArray(row.analysis?.keywords),
      analyzed_at: row.analysis?.analyzed_at ?? ""
    }));
  },

  async buildPostAnalysisExportRows(filters: AdminPostAnalysisFilters) {
    const rows = await postRepository.listAdmin({
      ...filters,
      analysisStatus: "analyzed",
      limit: filters.limit ?? 5000
    });

    return rows
      .filter((row) => {
        if (!row.analysis) {
          return false;
        }
        if (filters.sentiment && row.analysis.sentiment !== filters.sentiment) {
          return false;
        }
        if (filters.actionability && row.analysis.actionability !== filters.actionability) {
          return false;
        }
        if (filters.insightType && row.analysis.insight_type !== filters.insightType) {
          return false;
        }
        if (filters.tag?.trim() && !includesIgnoreCase(row.analysis.tags, filters.tag.trim().toLowerCase())) {
          return false;
        }
        if (
          filters.keyword?.trim() &&
          !includesIgnoreCase(row.analysis.keywords, filters.keyword.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      })
      .filter((row) => row.analysis)
      .map((row) => ({
        analysis_status: row.analysis_status,
        analyzed_at: row.analysis?.analyzed_at ?? "",
        post_id: row.post.id,
        type: row.post.type,
        user_id: row.post.user_id,
        respondent_name: row.respondentDisplayName,
        respondent_line_user_id: row.respondentLineUserId,
        project_name: row.projectName,
        quality_score: row.post.quality_score,
        quality_label: row.post.quality_label,
        original_text: row.post.content,
        summary: row.analysis?.summary ?? "",
        sentiment: row.analysis?.sentiment ?? "",
        sentiment_score: row.analysis?.sentiment_score ?? "",
        insight_type: row.analysis?.insight_type ?? "",
        specificity: row.analysis?.specificity ?? "",
        novelty: row.analysis?.novelty ?? "",
        actionability: row.analysis?.actionability ?? "",
        tags: stringifyArray(row.analysis?.tags),
        keywords: stringifyArray(row.analysis?.keywords),
        personality_signals: stringifyArray(row.analysis?.personality_signals),
        behavior_signals: stringifyArray(row.analysis?.behavior_signals),
        raw_json: stringifyJson(row.analysis?.raw_json ?? null)
      }));
  }
};
