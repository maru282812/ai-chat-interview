/**
 * 管理画面AIチャット Phase 4: デイリーアンケートのキュー積み（Tier B）
 * docs/impl-admin-ai-chat.md
 *
 * 「1問作ってキューに積むだけで上から順に自動配信」という運用に対して、
 * 「来週分を5本作って積んで」をチャットから片付けられるようにする。
 *
 * 積むところまでが Tier B。実配信（deliver）は Tier C 側に置き、ここでは触らない。
 */

import { dailySurveyService } from "../../dailySurveyService";
import { type AdminChatTool, registerTool } from "../toolRegistry";

const SCREENS = ["sessions-index", "research-form"];

const DAILY_TOOLS: AdminChatTool[] = [];

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

DAILY_TOOLS.push({
  name: "create_daily_survey",
  tier: "B",
  screenKeys: SCREENS,
  description:
    "デイリーアンケートを1件作成し、設問を1問付けて配信キューの末尾に積む。作成物は下書き扱いで、キューの順番が来たときに配信される。日付を指定したい場合は scheduled_date と slot を渡す。",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "アンケートのタイトル（管理用）" },
      question_text: { type: "string", description: "設問文" },
      question_type: {
        type: "string",
        description: "single_choice / multiple_choice / text（既定 single_choice）",
      },
      choices: {
        type: "array",
        items: { type: "string" },
        description: "選択肢ラベル配列（選択式のとき必須）",
      },
      reward_points: { type: "number", description: "報酬ポイント（既定 1）" },
      scheduled_date: { type: "string", description: "配信日を固定する場合 YYYY-MM-DD" },
      slot: { type: "string", description: "morning または night（scheduled_date 指定時のみ）" },
    },
    required: ["title", "question_text"],
  },
  execute: async (args) => {
    const title = String(args["title"] ?? "").trim();
    const questionText = String(args["question_text"] ?? "").trim();
    if (!title || !questionText) {
      throw new Error("title と question_text は必須です。");
    }

    const questionType = String(args["question_type"] ?? "single_choice").trim();
    const choices = parseChoices(args["choices"]);
    if (questionType !== "text" && choices.length < 2) {
      throw new Error("選択式の設問には choices（選択肢）が2つ以上必要です。");
    }

    const rewardPointsRaw = Number(args["reward_points"]);
    const rewardPoints =
      Number.isFinite(rewardPointsRaw) && rewardPointsRaw > 0 ? Math.floor(rewardPointsRaw) : 1;

    const survey = await dailySurveyService.create({
      title,
      reward_type: "fixed",
      reward_points: rewardPoints,
    } as never);

    await dailySurveyService.createQuestion({
      survey_id: survey.id,
      question_text: questionText,
      question_type: questionType as never,
      answer_options: choices,
    });

    const scheduledDate =
      typeof args["scheduled_date"] === "string" && args["scheduled_date"].trim()
        ? args["scheduled_date"].trim()
        : null;

    if (scheduledDate) {
      const slot = String(args["slot"] ?? "morning").trim();
      if (slot !== "morning" && slot !== "night") {
        throw new Error("slot は morning または night を指定してください。");
      }
      await dailySurveyService.assignToSlot(survey.id, scheduledDate, slot as never);
      return {
        created: { id: survey.id, title },
        placement: `${scheduledDate} の ${slot} 枠に固定しました`,
      };
    }

    await dailySurveyService.enqueue(survey.id);
    return {
      created: { id: survey.id, title },
      placement: "配信キューの末尾に積みました（上から順に自動配信されます）",
    };
  },
});

DAILY_TOOLS.push({
  name: "list_daily_queue",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "デイリーアンケートの配信予定（日付が決まっているもの・キューに積まれているもの）を取得する。積む前に重複や空き枠を確認するのに使う。",
  parameters: {
    type: "object",
    properties: {
      from_date: { type: "string", description: "開始日 YYYY-MM-DD（既定は今日）" },
      to_date: { type: "string", description: "終了日 YYYY-MM-DD（既定は14日後）" },
    },
  },
  execute: async (args) => {
    const today = new Date();
    const toIso = (date: Date) => date.toISOString().slice(0, 10);
    const fromDate =
      typeof args["from_date"] === "string" && args["from_date"].trim()
        ? args["from_date"].trim()
        : toIso(today);
    const toDate =
      typeof args["to_date"] === "string" && args["to_date"].trim()
        ? args["to_date"].trim()
        : toIso(new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000));

    const plan = await dailySurveyService.getPlanningData(fromDate, toDate);
    return { from: fromDate, to: toDate, plan };
  },
});

export function registerDailyQueueTools(): void {
  for (const tool of DAILY_TOOLS) {
    registerTool(tool);
  }
}
