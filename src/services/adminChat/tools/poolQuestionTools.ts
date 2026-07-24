/**
 * 管理画面AIチャット Phase 4: ついでスワイプ設問（Tier B の下書き ＋ Tier C の公開）
 * docs/impl-admin-ai-chat.md
 *
 * この2本が Tier B / Tier C の境界の見本になっている:
 * - 下書きの作成・編集は戻せる（誰にも出ていない）＝ Tier B。
 * - status を active にした瞬間から実際に回答者へ出題される（listActiveCandidates が拾う）。
 *   出してしまったものは取り消せない＝ Tier C で、承認カードを人間が押したときだけ実行する。
 *
 * 管理画面の既存 CRUD は作成時の既定が active（＝作成即公開）だが、ここでは必ず draft で作る。
 */

import { poolQuestionRepository } from "../../../repositories/poolQuestionRepository";
import { type AdminChatTool, registerTool } from "../toolRegistry";

const SCREENS = ["sessions-index", "research-form"];

const POOL_TOOLS: AdminChatTool[] = [];

function parseChoices(raw: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return { label: item, value: item };
      const obj = (item ?? {}) as Record<string, unknown>;
      const label = typeof obj["label"] === "string" ? obj["label"] : null;
      if (!label) return null;
      const value = typeof obj["value"] === "string" && obj["value"] ? obj["value"] : label;
      return { label, value };
    })
    .filter((option): option is { label: string; value: string } => option !== null);
}

POOL_TOOLS.push({
  name: "create_pool_question",
  tier: "B",
  screenKeys: SCREENS,
  description:
    "ついでスワイプ（案件一覧に挟まる2択）の設問を下書きとして作成する。作成しただけでは回答者に出ない。出題を始めるには別途 publish_pool_question の承認が必要。",
  parameters: {
    type: "object",
    properties: {
      question_text: { type: "string", description: "設問文（短く・低ステークスに）" },
      choices: {
        type: "array",
        items: { type: "string" },
        description: "選択肢ラベル（2〜4個）",
      },
      topic_tag: { type: "string", description: "分類タグ（任意・回答者には出ない）" },
      reward_points: { type: "number", description: "報酬ポイント（既定 1）" },
    },
    required: ["question_text", "choices"],
  },
  execute: async (args) => {
    const questionText = String(args["question_text"] ?? "").trim();
    const choices = parseChoices(args["choices"]);
    if (!questionText) throw new Error("question_text が空です。");
    if (choices.length < 2 || choices.length > 4) {
      throw new Error("choices は2〜4個にしてください。");
    }

    const rewardRaw = Number(args["reward_points"]);
    const created = await poolQuestionRepository.create({
      question_text: questionText,
      // pool_questions の CHECK 制約は single_choice / scale のみ（migration 082）
      question_type: "single_choice",
      answer_options: choices,
      topic_tag: typeof args["topic_tag"] === "string" ? args["topic_tag"].trim() || null : null,
      client_id: null,
      attribute_key: null,
      // 管理画面の既定は active（作成即公開）だが、AI 経由では必ず下書きにする
      status: "draft",
      priority: 0,
      reward_points: Number.isFinite(rewardRaw) && rewardRaw > 0 ? Math.floor(rewardRaw) : 1,
      reask_after_days: null,
      starts_at: null,
      ends_at: null,
    } as never);

    return {
      created: { id: created.id, text: created.question_text, status: created.status },
      note: "下書きです。回答者にはまだ出ていません。",
    };
  },
});

POOL_TOOLS.push({
  name: "list_pool_questions",
  tier: "A",
  screenKeys: SCREENS,
  description: "ついでスワイプ設問の一覧を状態つきで取得する。公開前の下書きIDを調べるのに使う。",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", description: "draft / active / paused / archived で絞り込む" },
    },
  },
  execute: async (args) => {
    const status = typeof args["status"] === "string" ? args["status"].trim() : "";
    const rows = await poolQuestionRepository.listWithStats(
      (status ? { status } : {}) as never
    );
    const items = (rows as unknown as Array<Record<string, unknown>>).slice(0, 50).map((row) => ({
      id: row["id"],
      text: row["question_text"],
      status: row["status"],
      reward_points: row["reward_points"],
    }));
    return { returned: items.length, items };
  },
});

POOL_TOOLS.push({
  name: "publish_pool_question",
  tier: "C",
  screenKeys: SCREENS,
  description:
    "ついでスワイプ設問の出題を開始する（下書き→公開）。公開すると実際に回答者へ配信され取り消せないため、実行には管理者の承認が必要。",
  parameters: {
    type: "object",
    properties: {
      question_id: { type: "string", description: "公開する設問ID" },
    },
    required: ["question_id"],
  },
  /**
   * 承認カードに出す内容はここでサーバー側が実データから作る。
   * AI が「たぶんこの設問です」と申告した文言をそのまま人間に見せない。
   */
  prepare: async (args) => {
    const questionId = String(args["question_id"] ?? "").trim();
    if (!questionId) throw new Error("question_id が必要です。");

    const rows = await poolQuestionRepository.listWithStats({} as never);
    const target = (rows as unknown as Array<Record<string, unknown>>).find(
      (row) => row["id"] === questionId
    );
    if (!target) throw new Error("対象の設問が見つかりません。");

    const activeCount = await poolQuestionRepository.countActive();
    const choices = Array.isArray(target["answer_options"])
      ? (target["answer_options"] as Array<Record<string, unknown>>)
          .map((choice) => String(choice["label"] ?? ""))
          .filter(Boolean)
      : [];

    return {
      summary: `ついでスワイプ設問を公開: 「${String(target["question_text"] ?? "")}」`,
      impact: [
        `現在の状態: ${String(target["status"] ?? "不明")} → active（実出題開始）`,
        `選択肢: ${choices.join(" / ") || "（なし）"}`,
        `報酬: ${String(target["reward_points"] ?? "?")} pt`,
        `公開中の設問は現在 ${activeCount} 件 → ${activeCount + 1} 件になります`,
        "公開後は回答者に出題されます。出題済みの回答は取り消せません。",
      ],
      // targetCount は承認時 → 実行時の再計算突合に使われ、差分があると実行が中断される。
      // ここでの「影響対象」は公開する 1 設問そのものであって、他の公開中設問の数(activeCount)ではない。
      // activeCount を返すと、承認待ちの間に別のプール設問が公開/アーカイブされただけで
      // この設問の公開が誤って中断される（公開対象は何も変わっていないのに）。
      // 公開は常に「この 1 設問を active にする」だけで突合すべき件数が無いため null にする。
      // 公開中件数の変化は上の impact に情報として残す（突合対象からは外す）。
      targetCount: null,
    };
  },
  execute: async (args) => {
    const questionId = String(args["question_id"] ?? "").trim();
    if (!questionId) throw new Error("question_id が必要です。");
    await poolQuestionRepository.updateStatus(questionId, "active" as never);
    return { published: questionId };
  },
});

export function registerPoolQuestionTools(): void {
  for (const tool of POOL_TOOLS) {
    registerTool(tool);
  }
}
