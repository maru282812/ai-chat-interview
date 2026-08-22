/**
 * 管理画面AIチャット: 顧客発見（P13）の判定支援ツール（Tier A = 読み取り専用）
 * 要件 §6.6 / §12-B1（実装形態は管理画面AIチャットの分析ツールが第一候補）
 *
 * 全ツール共通のルール（answerTools と同じ）:
 * - 既存 service / repository を経由し、ここで新しい SQL 経路を作らない。
 * - 打ち切りが起きたら返り値でそう明示する。
 *
 * このツール固有の禁止事項:
 * - **GO / PIVOT / STOP を断定させない。** 返すのは基準ごとの充足状況と根拠だけで、
 *   結論は運営者が出す（§3-2）。description と返り値の instruction で AI 側にも明示する。
 */

import { behaviorEvidenceReportService } from "../../behaviorEvidenceReportService";
import { ALL_SCREENS, type AdminChatTool, registerTool } from "../toolRegistry";

/**
 * Phase 4: 全画面開放（Tier A = 読み取り専用）。
 * 対象レコードを持たない画面では ctx.entityId が null になるため、案件IDは requireProjectId() で
 * 「引数優先 → 画面の対象 → どちらも無ければ回復手順つきエラー」に倒す。
 */
const SCREENS = [ALL_SCREENS];

const BEHAVIOR_EVIDENCE_TOOLS: AdminChatTool[] = [];

function requireProjectId(args: Record<string, unknown>, ctxEntityId: string | null): string {
  const raw = args["project_id"];
  const value = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : ctxEntityId;
  if (!value) {
    throw new Error(
      "project_id が指定されておらず、画面の対象IDもありません。get_project_overview か list_sessions で対象の案件IDを確認してから指定してください。"
    );
  }
  return value;
}

BEHAVIOR_EVIDENCE_TOOLS.push({
  name: "get_customer_discovery_report",
  tier: "A",
  screenKeys: SCREENS,
  description:
    "顧客発見（行動証拠）モードで作った案件について、GO / PIVOT / STOP を判断するための材料を取得する。" +
    "判定基準ごとの充足状況・証拠の確度別人数・根拠となる回答の原文引用を返す。" +
    "「この案件は続けるべきか」「需要検証の結果をまとめて」と聞かれたときに使う。" +
    "このツールは判定結果を返さない。GO / PIVOT / STOP を決めるのは運営者であり、AIが断定してはいけない。",
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
    const projectId = requireProjectId(args, ctx.entityId);
    const report = await behaviorEvidenceReportService.buildReport(projectId);

    return {
      project: report.project,
      // 失敗条件は「この案件を STOP する条件」。突き合わせの基準そのものなので必ず返す
      hypothesis: report.hypothesis
        ? {
            segment: report.hypothesis.segment,
            scene: report.hypothesis.scene,
            problem_hypothesis: report.hypothesis.problem_hypothesis,
            current_method: report.hypothesis.current_method,
            stop_condition: report.hypothesis.stop_condition,
            buyer_is_user: report.hypothesis.buyer_is_user ?? null,
          }
        : null,
      coverage: {
        tagged_question_count: report.taggedQuestionCount,
        total_question_count: report.totalQuestionCount,
      },
      respondent_count: report.respondentCount,
      truncated: report.truncated,
      evidence_strength: {
        counts: report.strengthCounts,
        labels: report.strengthLabels,
        ceiling_note:
          "チャットインタビューでは実作業の観察・資料の確認ができないため、確度は「数値あり」が上限です。時間・金額はすべて回答者の記憶に基づく申告値です。",
      },
      criteria: report.judgement.criteria.map((criterion) => ({
        key: criterion.key,
        group: criterion.group,
        label: criterion.label,
        // met / unmet / unknown。unknown は「基準を満たさなかった」ではなく「まだ判断できない」
        status: criterion.status,
        detail: criterion.detail,
      })),
      summary: {
        go_met: report.judgement.goMet,
        go_total: report.judgement.goTotal,
        stop_hit: report.judgement.stopHit,
        pivot_hit: report.judgement.pivotHit,
        unknown_count: report.judgement.unknownCount,
        insufficient_sample: report.judgement.insufficientSample,
      },
      quotes: report.quotes,
      notes: report.notes,
      disclaimer: report.judgement.disclaimer,
      instruction:
        "回答するときは次を守ること。" +
        "(1) GO / PIVOT / STOP を断定しない。「基準充足 x/y、STOP該当 z」までを述べ、判断は運営者に委ねる。" +
        "(2) 数字だけを述べず、quotes の原文引用を根拠として添える。引用は要約せず原文のまま使う。" +
        "(3) status が unknown の基準は「満たしていない」と言い換えない。「まだ判断できない」と述べる。" +
        "(4) 時間・金額は申告値であり実測値ではないことを明示する。",
    };
  },
});

/** 顧客発見ツールをレジストリへ登録する。アプリ起動時に1回だけ呼ぶ */
export function registerBehaviorEvidenceTools(): void {
  for (const tool of BEHAVIOR_EVIDENCE_TOOLS) {
    registerTool(tool);
  }
}

/** テスト・画面判定用（登録せずに定義だけ見たい場合） */
export function behaviorEvidenceToolDefinitions(): AdminChatTool[] {
  return [...BEHAVIOR_EVIDENCE_TOOLS];
}
