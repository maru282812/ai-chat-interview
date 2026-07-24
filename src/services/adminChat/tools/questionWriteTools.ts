/**
 * 管理画面AIチャット Phase 4: 設問の書き込みツール（Tier B = 戻せる書き込み）
 * docs/impl-admin-ai-chat.md
 *
 * 【重要】既存コードは「設問の削除」にだけ回答済みガード（409）を持ち、**更新には無い**。
 * 人間の画面操作なら警告バナーを見て踏みとどまれるが、AI は無警告で書き換えてしまう。
 * ロウデータの列契約（wide/long/codebook は集計アプリ契約で凍結）を壊す経路なので、
 * このツール層では「回答が1件でも入った設問の本文・型・選択肢の変更」を拒否する。
 * 回答済み設問を直す必要があるときは管理画面で人間が判断する。
 */

import { answerRepository } from "../../../repositories/answerRepository";
import { projectRepository } from "../../../repositories/projectRepository";
import { questionRepository } from "../../../repositories/questionRepository";
import { type AdminChatTool, registerTool } from "../toolRegistry";

const SCREENS = ["research-form"];

const QUESTION_TOOLS: AdminChatTool[] = [];

/** 回答が入っている設問は内容を変えさせない（ロウデータ列契約の保護） */
async function assertNoAnswers(questionId: string, action: string): Promise<void> {
  const count = await answerRepository.countByQuestion(questionId);
  if (count > 0) {
    throw new Error(
      `この設問にはすでに ${count} 件の回答があるため、${action}はできません。` +
        "回答済み設問の変更は集計データの列定義を壊すため、管理画面で人が判断する必要があります。" +
        "新しい設問を追加する方法を案内してください。"
    );
  }
}

function requireProjectId(args: Record<string, unknown>, entityId: string | null): string {
  const raw = args["project_id"];
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : entityId;
  if (!value) {
    throw new Error("project_id が指定されておらず、画面の対象案件もありません。");
  }
  return value;
}

function parseOptions(raw: unknown): Array<{ label: string; value: string }> | null {
  if (!Array.isArray(raw)) return null;
  const options = raw
    .map((item) => {
      if (typeof item === "string") return { label: item, value: item };
      const obj = (item ?? {}) as Record<string, unknown>;
      const label = typeof obj["label"] === "string" ? obj["label"] : null;
      if (!label) return null;
      const value = typeof obj["value"] === "string" && obj["value"] ? obj["value"] : label;
      return { label, value };
    })
    .filter((option): option is { label: string; value: string } => option !== null);
  return options.length > 0 ? options : null;
}

QUESTION_TOOLS.push({
  name: "create_question",
  tier: "B",
  screenKeys: SCREENS,
  description:
    "案件に設問を1問追加する。question_type は single_choice / multi_choice / free_text_short / free_text_long / numeric のいずれか。選択式は options（ラベルの配列）が必須。追加位置は末尾。",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "対象案件ID。省略時は画面の案件" },
      question_text: { type: "string", description: "設問文" },
      question_type: { type: "string", description: "設問タイプ" },
      options: {
        type: "array",
        items: { type: "string" },
        description: "選択肢のラベル配列（選択式のとき必須）",
      },
      is_required: { type: "boolean", description: "必須回答か（既定 true）" },
    },
    required: ["question_text", "question_type"],
  },
  execute: async (args, ctx) => {
    const projectId = requireProjectId(args, ctx.entityId);
    const questionText = String(args["question_text"] ?? "").trim();
    const questionType = String(args["question_type"] ?? "").trim();
    if (!questionText) throw new Error("question_text が空です。");

    const CHOICE_TYPES = new Set(["single_choice", "multi_choice"]);
    const options = parseOptions(args["options"]);
    if (CHOICE_TYPES.has(questionType) && !options) {
      throw new Error("選択式の設問には options（選択肢ラベルの配列）が必要です。");
    }

    const existing = await questionRepository.listByProject(projectId);
    const sortOrder = await questionRepository.getNextSortOrder(projectId);
    // question_code は既存の最大採番+1（Q1, Q2, ... の連番）
    const maxCodeNumber = existing.reduce((max, question) => {
      const matched = /^Q(\d+)$/.exec(question.question_code ?? "");
      return matched ? Math.max(max, Number(matched[1])) : max;
    }, 0);

    const created = await questionRepository.create({
      project_id: projectId,
      question_code: `Q${maxCodeNumber + 1}`,
      question_text: questionText,
      question_role: "main",
      question_type: questionType as never,
      is_required: args["is_required"] !== false,
      sort_order: sortOrder,
      question_config: options ? { options } : null,
    } as never);

    return {
      created: { id: created.id, code: created.question_code, text: created.question_text },
      note: "未公開の下書きとして追加しました。回答者にはまだ出ていません。",
    };
  },
});

QUESTION_TOOLS.push({
  name: "update_question",
  tier: "B",
  screenKeys: SCREENS,
  description:
    "既存の設問の文言・選択肢・必須フラグを修正する。回答がすでに入っている設問は変更できない（その場合はエラーを返す）。",
  parameters: {
    type: "object",
    properties: {
      question_id: { type: "string", description: "対象設問ID" },
      question_text: { type: "string", description: "新しい設問文" },
      options: { type: "array", items: { type: "string" }, description: "新しい選択肢ラベル配列" },
      is_required: { type: "boolean", description: "必須回答か" },
    },
    required: ["question_id"],
  },
  execute: async (args) => {
    const questionId = String(args["question_id"] ?? "").trim();
    if (!questionId) throw new Error("question_id が必要です。");
    await assertNoAnswers(questionId, "設問内容の変更");

    const patch: Record<string, unknown> = {};
    if (typeof args["question_text"] === "string" && args["question_text"].trim()) {
      patch["question_text"] = args["question_text"].trim();
    }
    const options = parseOptions(args["options"]);
    if (options) {
      const current = await questionRepository.getById(questionId);
      patch["question_config"] = { ...(current.question_config ?? {}), options };
    }
    if (typeof args["is_required"] === "boolean") {
      patch["is_required"] = args["is_required"];
    }
    if (Object.keys(patch).length === 0) {
      throw new Error("変更内容が指定されていません。");
    }

    const updated = await questionRepository.update(questionId, patch as never);
    return { updated: { id: updated.id, code: updated.question_code, text: updated.question_text } };
  },
});

QUESTION_TOOLS.push({
  name: "reorder_questions",
  tier: "B",
  screenKeys: SCREENS,
  description:
    "案件内の設問の並び順を変更する。question_ids に希望する順序で設問IDを並べて渡す（渡さなかった設問は後ろに残る）。",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "対象案件ID。省略時は画面の案件" },
      question_ids: {
        type: "array",
        items: { type: "string" },
        description: "並べたい順の設問ID配列",
      },
    },
    required: ["question_ids"],
  },
  execute: async (args, ctx) => {
    const projectId = requireProjectId(args, ctx.entityId);
    const ids = Array.isArray(args["question_ids"])
      ? (args["question_ids"] as unknown[]).map(String)
      : [];
    if (ids.length === 0) throw new Error("question_ids が空です。");

    const questions = await questionRepository.listByProject(projectId);
    const known = new Set(questions.map((question) => question.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`この案件に存在しない設問IDが含まれています: ${unknown.join(", ")}`);
    }

    let order = 0;
    for (const id of ids) {
      order += 10;
      await questionRepository.update(id, { sort_order: order } as never);
    }
    // 指定されなかった設問は後ろへ寄せる（既存の相対順は保つ）
    for (const question of questions) {
      if (ids.includes(question.id)) continue;
      order += 10;
      await questionRepository.update(question.id, { sort_order: order } as never);
    }

    return { reordered: ids.length, total: questions.length };
  },
});

QUESTION_TOOLS.push({
  name: "get_project_questions",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "案件の設問一覧を、ID・並び順・回答件数つきで取得する。設問を修正・並べ替えする前に対象IDを確認するために使う。",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "対象案件ID。省略時は画面の案件" },
    },
  },
  execute: async (args, ctx) => {
    const projectId = requireProjectId(args, ctx.entityId);
    const [project, questions] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId),
    ]);
    const withCounts = await Promise.all(
      questions.map(async (question) => ({
        id: question.id,
        code: question.question_code,
        text: question.question_text,
        type: question.question_type,
        sort_order: question.sort_order,
        answer_count: await answerRepository.countByQuestion(question.id),
      }))
    );
    return {
      project: { id: project.id, name: project.name, status: project.status },
      questions: withCounts,
      note: "answer_count が 1 以上の設問は内容を変更できません（集計の列定義を壊すため）。",
    };
  },
});

export function registerQuestionWriteTools(): void {
  for (const tool of QUESTION_TOOLS) {
    registerTool(tool);
  }
}
