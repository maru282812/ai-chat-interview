/**
 * 管理画面AIチャット Phase 2: 回答分析用ツール（Tier A = 読み取り専用）
 * docs/impl-admin-ai-chat.md
 *
 * 初回リリースは「回答を読み解く側」に全振りする。設問作成は既存のフロー生成AIがあり、
 * 弱いのは集まった回答の把握のため（2026-07-22 ユーザー確定）。
 *
 * 全ツール共通のルール:
 * - 既存 service / repository を経由し、ここで新しい SQL 経路を作らない。
 * - 一覧は必ずページング付き関数を使い、全件ロードしない（レビュー P0-1 / P0-2 の再発防止）。
 * - 総数は DB 側 count、値の取得は上限付き。打ち切った場合は返り値でそう明示する
 *   （AI が「打ち切った母集団の集計」を総数として語らないようにするため）。
 */

import { answerRepository } from "../../../repositories/answerRepository";
import { projectRepository } from "../../../repositories/projectRepository";
import { questionRepository } from "../../../repositories/questionRepository";
import { sessionRepository } from "../../../repositories/sessionRepository";
import { researchOpsService } from "../../researchOpsService";
import { type AdminChatTool, registerTool } from "../toolRegistry";

const SCREENS = ["sessions-index", "session-show", "respondent-show", "research-form"];

/**
 * ツール定義。登録はモジュール読み込みの副作用にせず registerAnswerTools() で明示的に行う
 * （テストでレジストリを空にしてから再登録できるようにするため）。
 */
const ANSWER_TOOLS: AdminChatTool[] = [];

const MAX_LIST_LIMIT = 50;
const MAX_TEXT_SAMPLES = 30;
const MAX_TEXT_SAMPLE_CHARS = 200;
/** 集計で読む回答の上限。総数は別途 count で取るのでこれで数字が嘘にはならない */
const AGGREGATE_SAMPLE_LIMIT = 2000;

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * ID は引数優先・無ければ画面の対象レコードにフォールバックする。
 * どちらも無いときは「次に何をすればよいか」を含むエラーにする。
 * 素っ気ないエラーだとモデルがそこで諦めて「取得できません」と答えて終わるため。
 */
function requireId(
  args: Record<string, unknown>,
  key: string,
  ctxEntityId: string | null,
  recovery: string
): string {
  const raw = args[key];
  const value = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : ctxEntityId;
  if (!value) {
    throw new Error(`${key} が指定されておらず、画面の対象IDもありません。${recovery}`);
  }
  return value;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

// ── 1. 案件概要 ────────────────────────────────────────────────────────

ANSWER_TOOLS.push({
  name: "get_project_overview",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "案件（プロジェクト）の概要・ステータス・設問一覧・セッション数を取得する。特定の案件について聞かれたときの起点。案件が特定できていない場合はこれではなく list_sessions を使う。",
  parameters: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description: "対象の案件ID。省略時は画面が対象にしている案件を使う",
      },
    },
  },
  execute: async (args, ctx) => {
    const projectId = requireId(
      args,
      "project_id",
      ctx.entityId,
      "案件を絞らずに全体を見るなら list_sessions を使ってください。"
    );
    const [project, questions, sessionCount] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId),
      sessionRepository.countByProject(projectId),
    ]);

    return {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        research_mode: (project as { research_mode?: string }).research_mode ?? null,
      },
      session_count: sessionCount,
      question_count: questions.length,
      questions: questions.map((q) => ({
        id: q.id,
        code: q.question_code,
        text: q.question_text,
        type: q.question_type,
        role: q.question_role,
        required: q.is_required,
        options: (q.question_config?.options ?? []).map((o) => o.label),
      })),
    };
  },
});

// ── 2. セッション一覧 ──────────────────────────────────────────────────

ANSWER_TOOLS.push({
  name: "list_sessions",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "回答者の一覧（各人のセッション数・進捗つき）をページングで取得する。誰がどこまで回答したかの把握や、案件・セッションが特定できていないときの起点に使う。返る total_respondents は回答者の人数で、セッション件数ではない。1回で最大50人。",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "案件IDで絞り込む（省略可）" },
      status: { type: "string", description: "セッション状態で絞り込む（例: completed）" },
      q: { type: "string", description: "回答者名などのキーワード検索" },
      limit: { type: "number", description: "取得件数（1〜50・既定20）" },
      offset: { type: "number", description: "取得開始位置（既定0）" },
    },
  },
  execute: async (args) => {
    const limit = clampLimit(args["limit"], 20, MAX_LIST_LIMIT);
    const offsetRaw = Number(args["offset"]);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

    const page = await researchOpsService.listRespondentOverviewsPaged({
      projectId: typeof args["project_id"] === "string" ? args["project_id"] : undefined,
      status: typeof args["status"] === "string" ? args["status"] : undefined,
      q: typeof args["q"] === "string" ? args["q"] : undefined,
      limit,
      offset,
    });

    return {
      // フィールド名を曖昧にすると「回答者502人」を「セッション502件」と言い換えられてしまう。
      // 何の総数かを名前で確定させる。
      total_respondents: page.total,
      offset: page.offset,
      returned_respondents: page.items.length,
      note:
        page.total > page.offset + page.items.length
          ? "続きがあります。offset をずらして取得してください。total_respondents は回答者の人数であってセッション件数ではありません。"
          : "total_respondents は回答者の人数であってセッション件数ではありません。",
      items: page.items.map((item) => ({
        respondent_id: item.respondent.id,
        name: item.respondent.display_name ?? null,
        project: item.project.name,
        session_count: item.sessionCount,
        completed_session_count: item.completedSessionCount,
        latest_session_id: item.latestSession?.id ?? null,
        latest_session_status: item.latestSession?.status ?? null,
        last_activity_at: item.lastActivityAt,
      })),
    };
  },
});

// ── 3. セッション詳細 ─────────────────────────────────────────────────

ANSWER_TOOLS.push({
  name: "get_session_detail",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "1セッションの回答内容（設問ごとの回答・AI深掘りのやりとり・分析結果）を取得する。個別の回答を読み解くときに使う。",
  parameters: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "対象セッションID。省略時は画面が対象にしているIDを使う",
      },
    },
  },
  execute: async (args, ctx) => {
    const sessionId = requireId(
      args,
      "session_id",
      ctx.entityId,
      "list_sessions で対象セッションを探してから指定してください。"
    );
    const detail = await researchOpsService.getSessionDetail(sessionId);

    return {
      session: {
        id: detail.session.id,
        status: detail.session.status,
        started_at: detail.session.started_at,
        completed_at: detail.session.completed_at,
      },
      respondent: {
        id: detail.respondent.id,
        name: detail.respondent.display_name ?? null,
      },
      project: { id: detail.project.id, name: detail.project.name },
      answers: detail.answerGroups.map((group) => ({
        question_code: group.question.question_code,
        question_text: group.question.question_text,
        question_type: group.question.question_type,
        answer: group.primaryAnswer?.answer_text ?? null,
        free_text: group.primaryAnswer?.free_text_answer ?? null,
        probes: (group.probeAnswers ?? []).map((probe) => probe.answer_text),
      })),
      analysis: detail.analysis
        ? {
            summary: detail.analysis.summary,
            pain_points: detail.analysis.pain_points,
            insight_candidates: detail.analysis.insight_candidates,
          }
        : null,
      message_count: detail.messages.length,
    };
  },
});

// ── 4. 回答者詳細 ─────────────────────────────────────────────────────

ANSWER_TOOLS.push({
  name: "get_respondent_detail",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "回答者1人の情報（所属案件・セッション履歴・ポイント履歴）を取得する。特定の回答者について聞かれたときに使う。",
  parameters: {
    type: "object",
    properties: {
      respondent_id: {
        type: "string",
        description: "対象の回答者ID。省略時は画面が対象にしているIDを使う",
      },
    },
  },
  execute: async (args, ctx) => {
    const respondentId = requireId(
      args,
      "respondent_id",
      ctx.entityId,
      "list_sessions で対象の回答者を探してから指定してください。"
    );
    const detail = await researchOpsService.getRespondentDetail(respondentId);

    return {
      respondent: {
        id: detail.respondent.id,
        name: detail.respondent.display_name ?? null,
        status: detail.respondent.status ?? null,
      },
      project: detail.project ? { id: detail.project.id, name: detail.project.name } : null,
      sessions: detail.sessions.map((session) => ({
        id: session.id,
        status: session.status,
        started_at: session.started_at,
        completed_at: session.completed_at,
      })),
      point_transaction_count: detail.transactions.length,
    };
  },
});

// ── 5. 設問別集計 ─────────────────────────────────────────────────────

ANSWER_TOOLS.push({
  name: "aggregate_answers",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "設問1問の回答を集計する。選択式は選択肢ごとの件数と割合、数値は平均・最小・最大、自由記述は件数と最新サンプルを返す。設問の傾向を聞かれたときに使う。",
  parameters: {
    type: "object",
    properties: {
      question_id: { type: "string", description: "集計対象の設問ID（必須）" },
    },
    required: ["question_id"],
  },
  execute: async (args) => {
    const questionId = typeof args["question_id"] === "string" ? args["question_id"].trim() : "";
    if (!questionId) {
      throw new Error("question_id が必要です。先に get_project_overview で設問IDを確認してください。");
    }

    const question = await questionRepository.getById(questionId);
    const { total, rows } = await answerRepository.sampleForAggregate(
      questionId,
      AGGREGATE_SAMPLE_LIMIT
    );

    const base = {
      question: {
        id: question.id,
        code: question.question_code,
        text: question.question_text,
        type: question.question_type,
      },
      total_answers: total,
      sampled: rows.length,
      // 打ち切りが起きたことを AI に必ず伝える（総数と集計母数の混同を防ぐ）
      note:
        rows.length < total
          ? `件数が多いため最新${rows.length}件を集計しました。total_answers（${total}件）とは母数が異なります。`
          : null,
    };

    const type = question.question_type;
    // question_type は migration 016 以前の旧値（text / scale / single_select / multi_select）が
    // 混在しうるため、集計の分岐では新旧の両方を見る。
    const NUMERIC_TYPES = new Set(["numeric", "scale"]);
    const TEXT_TYPES = new Set(["free_text_short", "free_text_long", "text"]);
    const MULTI_TYPES = new Set(["multi_choice", "multi_select", "matrix_multi", "hidden_multi"]);

    if (NUMERIC_TYPES.has(type)) {
      const values = rows
        .map((row) => Number(row.answer_text))
        .filter((value) => Number.isFinite(value));
      if (values.length === 0) {
        return { ...base, numeric: null, message: "数値として解釈できる回答がありません" };
      }
      const sum = values.reduce((acc, value) => acc + value, 0);
      return {
        ...base,
        numeric: {
          count: values.length,
          average: Math.round((sum / values.length) * 100) / 100,
          min: Math.min(...values),
          max: Math.max(...values),
        },
      };
    }

    if (TEXT_TYPES.has(type)) {
      return {
        ...base,
        samples: rows
          .slice(0, MAX_TEXT_SAMPLES)
          .map((row) => truncate(row.free_text_answer || row.answer_text, MAX_TEXT_SAMPLE_CHARS))
          .filter((text): text is string => Boolean(text)),
        samples_note: `最新${Math.min(rows.length, MAX_TEXT_SAMPLES)}件のみ表示（各${MAX_TEXT_SAMPLE_CHARS}字まで）`,
      };
    }

    // 選択式: 複数選択は保存文字列を区切りで割ってから数える
    const counts = new Map<string, number>();
    const isMulti = MULTI_TYPES.has(type);
    for (const row of rows) {
      const raw = (row.answer_text ?? "").trim();
      if (raw === "") continue;
      const values = isMulti
        ? raw.split(/[,、]\s*/).map((value) => value.trim()).filter(Boolean)
        : [raw];
      for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    const denominator = rows.length || 1;
    const breakdown = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / denominator) * 1000) / 10,
      }));

    return {
      ...base,
      percent_base: isMulti
        ? "回答者数に対する割合（複数選択のため合計は100%を超える）"
        : "回答者数に対する割合",
      breakdown,
      defined_options: (question.question_config?.options ?? []).map((option) => option.label),
    };
  },
});

/** 回答分析ツールをレジストリへ登録する。アプリ起動時に1回だけ呼ぶ */
export function registerAnswerTools(): void {
  for (const tool of ANSWER_TOOLS) {
    registerTool(tool);
  }
}

/** テスト・画面判定用（登録せずに定義だけ見たい場合） */
export function answerToolDefinitions(): AdminChatTool[] {
  return [...ANSWER_TOOLS];
}
