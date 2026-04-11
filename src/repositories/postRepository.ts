import { supabase } from "../config/supabase";
import { logger } from "../lib/logger";
import type {
  PostAnalysis,
  PostInsightType,
  PostSourceChannel,
  Project,
  ResearchMode,
  UserPost,
  UserPostType
} from "../types/domain";
import { throwIfError } from "./baseRepository";
import { postAnalysisRepository } from "./postAnalysisRepository";

export type AdminPostTypeFilter = Extract<UserPostType, "free_comment" | "rant" | "diary">;
export type AnalysisStatus = "analyzed" | "pending";

export interface AdminPostFilters {
  type?: AdminPostTypeFilter | null;
  search?: string | null;
  projectId?: string | null;
  userId?: string | null;
  sourceChannel?: PostSourceChannel | null;
  analysisStatus?: AnalysisStatus | null;
  qualityScoreMin?: number | null;
  qualityScoreMax?: number | null;
  sentiment?: PostAnalysis["sentiment"] | null;
  insightType?: PostInsightType | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
}

export interface AdminPostRow {
  post: UserPost;
  projectName: string | null;
  respondentDisplayName: string | null;
  respondentLineUserId: string | null;
  analysis: PostAnalysis | null;
  analysis_status: AnalysisStatus;
}

export interface AdminPostDetail {
  post: UserPost;
  project: Pick<Project, "id" | "name" | "research_mode"> | null;
  respondent: {
    id: string;
    display_name: string | null;
    line_user_id: string;
  } | null;
  analysis: PostAnalysis | null;
  analysis_status: AnalysisStatus;
}

interface CreatePostInput {
  user_id: string;
  respondent_id?: string | null;
  type: UserPostType;
  project_id?: string | null;
  session_id?: string | null;
  answer_id?: string | null;
  source_channel?: UserPost["source_channel"];
  source_mode?: ResearchMode | null;
  menu_action_key?: string | null;
  title?: string | null;
  content: string;
  quality_score?: number;
  quality_label?: UserPost["quality_label"];
  metadata?: Record<string, unknown> | null;
  posted_on?: string | null;
}

function isMissingColumnError(error: { message?: string } | null | undefined, column: string): boolean {
  if (!error?.message) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes(column.toLowerCase()) && (message.includes("column") || message.includes("schema cache"));
}

function omitUnsupportedQualityLabel<T extends { quality_label?: unknown }>(payload: T): Omit<T, "quality_label"> {
  const { quality_label: _qualityLabel, ...rest } = payload;
  return rest;
}

function normalizeUserPost(row: UserPost | null): UserPost | null {
  if (!row) {
    return null;
  }

  return {
    ...row,
    quality_score: typeof row.quality_score === "number" ? row.quality_score : 0,
    quality_label: row.quality_label ?? "low"
  };
}

function normalizeUserPosts(rows: UserPost[] | null | undefined): UserPost[] {
  return (rows ?? []).map((row) => normalizeUserPost(row as UserPost)).filter((row): row is UserPost => Boolean(row));
}

function startOfDayIso(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function endOfDayIso(value: string): string {
  return new Date(`${value}T23:59:59.999Z`).toISOString();
}

function matchesSearchTerm(value: string | null | undefined, normalizedTerm: string): boolean {
  return typeof value === "string" && value.toLowerCase().includes(normalizedTerm);
}

function clampLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? 200, 5000));
}

function comparePosts(left: UserPost, right: UserPost): number {
  const qualityDelta = (right.quality_score ?? 0) - (left.quality_score ?? 0);
  if (qualityDelta !== 0) {
    return qualityDelta;
  }

  return right.created_at.localeCompare(left.created_at);
}

export const postRepository = {
  async create(input: CreatePostInput): Promise<UserPost> {
    const { data, error } = await supabase.from("user_posts").insert(input).select("*").single();
    if (isMissingColumnError(error, "quality_label")) {
      logger.warn("user_posts.quality_label_column_missing", { operation: "create" });
      const retry = await supabase
        .from("user_posts")
        .insert(omitUnsupportedQualityLabel(input))
        .select("*")
        .single();
      throwIfError(retry.error);
      return normalizeUserPost(retry.data as UserPost | null) as UserPost;
    }
    throwIfError(error);
    return normalizeUserPost(data as UserPost | null) as UserPost;
  },

  async update(
    id: string,
    input: Partial<
      Pick<
        UserPost,
        "title" | "content" | "metadata" | "posted_on" | "menu_action_key" | "quality_score" | "quality_label"
      >
    >
  ): Promise<UserPost> {
    const { data, error } = await supabase
      .from("user_posts")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (isMissingColumnError(error, "quality_label")) {
      logger.warn("user_posts.quality_label_column_missing", { operation: "update", postId: id });
      const retry = await supabase
        .from("user_posts")
        .update(omitUnsupportedQualityLabel(input))
        .eq("id", id)
        .select("*")
        .single();
      throwIfError(retry.error);
      return normalizeUserPost(retry.data as UserPost | null) as UserPost;
    }
    throwIfError(error);
    return normalizeUserPost(data as UserPost | null) as UserPost;
  },

  async getById(id: string): Promise<UserPost | null> {
    const { data, error } = await supabase.from("user_posts").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return normalizeUserPost((data as UserPost | null) ?? null);
  },

  async findByAnswerId(answerId: string): Promise<UserPost | null> {
    const { data, error } = await supabase
      .from("user_posts")
      .select("*")
      .eq("answer_id", answerId)
      .maybeSingle();
    throwIfError(error);
    return normalizeUserPost((data as UserPost | null) ?? null);
  },

  async listByUserId(userId: string): Promise<UserPost[]> {
    const { data, error } = await supabase
      .from("user_posts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return normalizeUserPosts((data ?? []) as UserPost[]);
  },

  async listBySessionId(sessionId: string): Promise<UserPost[]> {
    const { data, error } = await supabase
      .from("user_posts")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return normalizeUserPosts((data ?? []) as UserPost[]);
  },

  async listByUserIdAndTypes(userId: string, types: UserPostType[], limit = 20): Promise<UserPost[]> {
    let query = supabase
      .from("user_posts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (types.length > 0) {
      query = query.in("type", types);
    }

    const { data, error } = await query;
    throwIfError(error);
    return normalizeUserPosts((data ?? []) as UserPost[]);
  },

  async listAdmin(filters: AdminPostFilters = {}): Promise<AdminPostRow[]> {
    const limit = clampLimit(filters.limit);
    let query = supabase
      .from("user_posts")
      .select("*")
      .in("type", ["free_comment", "rant", "diary"])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (filters.type) {
      query = query.eq("type", filters.type);
    }
    if (filters.projectId) {
      query = query.eq("project_id", filters.projectId);
    }
    if (filters.userId) {
      query = query.eq("user_id", filters.userId);
    }
    if (filters.sourceChannel) {
      query = query.eq("source_channel", filters.sourceChannel);
    }
    if (typeof filters.qualityScoreMin === "number") {
      query = query.gte("quality_score", filters.qualityScoreMin);
    }
    if (typeof filters.qualityScoreMax === "number") {
      query = query.lte("quality_score", filters.qualityScoreMax);
    }
    if (filters.dateFrom) {
      query = query.gte("created_at", startOfDayIso(filters.dateFrom));
    }
    if (filters.dateTo) {
      query = query.lte("created_at", endOfDayIso(filters.dateTo));
    }

    const { data, error } = await query;
    throwIfError(error);
    const posts = normalizeUserPosts((data ?? []) as UserPost[]);
    const analyses = await postAnalysisRepository.listByPostIds(posts.map((post) => post.id));
    const analysisByPostId = new Map(analyses.map((analysis) => [analysis.post_id, analysis] as const));

    const respondentIds = [...new Set(posts.map((post) => post.respondent_id).filter(Boolean))] as string[];
    const projectIds = [...new Set(posts.map((post) => post.project_id).filter(Boolean))] as string[];

    const [respondentRows, projectRows] = await Promise.all([
      respondentIds.length === 0
        ? Promise.resolve([])
        : supabase
            .from("respondents")
            .select("id, display_name, line_user_id")
            .in("id", respondentIds)
            .then(({ data: responseData, error: responseError }) => {
              throwIfError(responseError);
              return responseData ?? [];
            }),
      projectIds.length === 0
        ? Promise.resolve([])
        : supabase
            .from("projects")
            .select("id, name, research_mode")
            .in("id", projectIds)
            .then(({ data: responseData, error: responseError }) => {
              throwIfError(responseError);
              return responseData ?? [];
            })
    ]);

    const respondentById = new Map(
      respondentRows.map((row) => [
        String(row.id),
        {
          id: String(row.id),
          display_name: typeof row.display_name === "string" ? row.display_name : null,
          line_user_id: String(row.line_user_id ?? "")
        }
      ])
    );
    const projectById = new Map(
      projectRows.map((row) => [
        String(row.id),
        {
          id: String(row.id),
          name: typeof row.name === "string" ? row.name : null,
          research_mode: typeof row.research_mode === "string" ? row.research_mode : null
        }
      ])
    );

    const normalizedSearch = filters.search?.trim().toLowerCase() ?? "";
    const rows = posts
      .map((post) => {
        const analysis = analysisByPostId.get(post.id) ?? null;
        const respondent = post.respondent_id ? respondentById.get(post.respondent_id) ?? null : null;
        const project = post.project_id ? projectById.get(post.project_id) ?? null : null;
        return {
          post,
          projectName: project?.name ?? null,
          respondentDisplayName: respondent?.display_name ?? null,
          respondentLineUserId: respondent?.line_user_id ?? post.user_id,
          analysis,
          analysis_status: analysis ? "analyzed" : "pending"
        } satisfies AdminPostRow;
      })
      .filter((row) => {
        if (!normalizedSearch) {
          return true;
        }

        return (
          matchesSearchTerm(row.post.id, normalizedSearch) ||
          matchesSearchTerm(row.post.content, normalizedSearch) ||
          matchesSearchTerm(row.post.title, normalizedSearch) ||
          matchesSearchTerm(row.analysis?.summary ?? null, normalizedSearch) ||
          matchesSearchTerm(row.respondentDisplayName, normalizedSearch) ||
          matchesSearchTerm(row.respondentLineUserId, normalizedSearch) ||
          matchesSearchTerm(row.projectName, normalizedSearch)
        );
      });

    const filteredRows = rows
      .filter((row) => {
        if (filters.analysisStatus && row.analysis_status !== filters.analysisStatus) {
          return false;
        }
        if (filters.sentiment && row.analysis?.sentiment !== filters.sentiment) {
          return false;
        }
        if (filters.insightType && row.analysis?.insight_type !== filters.insightType) {
          return false;
        }
        return true;
      })
      .sort((left, right) => comparePosts(left.post, right.post));

    return filteredRows;
  },

  async getAdminDetail(postId: string): Promise<AdminPostDetail | null> {
    const post = await this.getById(postId);
    if (!post) {
      return null;
    }

    const [analysis, respondentResult, projectResult] = await Promise.all([
      postAnalysisRepository.getByPostId(post.id),
      post.respondent_id
        ? supabase
            .from("respondents")
            .select("id, display_name, line_user_id")
            .eq("id", post.respondent_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      post.project_id
        ? supabase
            .from("projects")
            .select("id, name, research_mode")
            .eq("id", post.project_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);

    throwIfError(respondentResult.error);
    throwIfError(projectResult.error);

    return {
      post,
      analysis,
      analysis_status: analysis ? "analyzed" : "pending",
      respondent: respondentResult.data
        ? {
            id: String(respondentResult.data.id),
            display_name:
              typeof respondentResult.data.display_name === "string"
                ? respondentResult.data.display_name
                : null,
            line_user_id: String(respondentResult.data.line_user_id ?? "")
          }
        : null,
      project: projectResult.data
        ? {
            id: String(projectResult.data.id),
            name: String(projectResult.data.name ?? ""),
            research_mode: projectResult.data.research_mode as Project["research_mode"]
          }
        : null
    };
  }
};
