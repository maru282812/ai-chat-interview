import { logger } from "../lib/logger";
import { rankService } from "./rankService";
import { pointService } from "./pointService";
import { userPointService } from "./userPointService";
import { lineMessagingService } from "./lineMessagingService";
import { respondentRepository } from "../repositories/respondentRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { pointTransactionRepository } from "../repositories/pointTransactionRepository";
import { projectRepository } from "../repositories/projectRepository";
import type { Session, Respondent, Project, LineTextMessage } from "../types/domain";
import type { UserPointTransactionType } from "../types/domain";

/**
 * グローバル必須書類にすべて同意済み（＝正式な Hibi 会員）かを安全に判定する。
 * 判定不能（例外）時は従来どおり付与するため true を返す（既存フローの退行を避ける）。
 */
async function isGlobalMemberSafe(lineUserId: string): Promise<boolean> {
  try {
    const { consentService } = await import("./consentService");
    const pending = await consentService.getPendingGlobalConsents(lineUserId);
    return pending.length === 0;
  } catch (err) {
    logger.warn("postComplete.memberCheck.failed", { lineUserId, error: String(err) });
    return true;
  }
}

interface PostCompleteParams {
  assignmentId: string;
  session: Session | null;
  respondent: Respondent;
  project: Project;
  lineUserId: string | null;
}

// 旧スキーマ PointTransactionType → 新スキーマ UserPointTransactionType へのマッピング
const TYPE_MAP: Record<string, UserPointTransactionType> = {
  project_completion: "project_completion",
  first_bonus:        "first_bonus",
  continuity_bonus:   "continuity_bonus",
  project_bonus:      "project_bonus",
  manual_adjustment:  "manual_adjustment",
};

/**
 * 正準台帳（user_points / point_histories）への付与失敗を必ず可視化する。
 * ここは allSettled で回しているため、ログを出さないと「レガシー台帳だけ増えて
 * マイページ残高が 0 のまま」という乖離が無言で起きる（実際に起きていた）。
 */
function logCanonicalAwardFailures(
  results: PromiseSettledResult<unknown>[],
  ctx: { lineUserId: string; sessionId: string; assignmentId?: string },
): void {
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length === 0) return;
  logger.error("postComplete.canonicalAward.failed", {
    ...ctx,
    failedCount: failures.length,
    totalCount: results.length,
    errors: failures.map((f) => String(f.reason)),
    hint: "user_points/point_histories への書込みが落ちている。レガシー台帳との乖離を確認すること。",
  });
}

/**
 * アンケート完了後の非同期後処理。
 * LIFF へのレスポンス返却後に呼び出す。
 * ポイント付与失敗時でも LINE 完了通知は必ず送信する。
 */
export async function runPostCompleteProcess({
  assignmentId,
  session,
  respondent,
  project,
  lineUserId,
}: PostCompleteParams): Promise<void> {
  let awardResult: Awaited<ReturnType<typeof pointService.awardCompletionPoints>> | null = null;
  let rankResult: Awaited<ReturnType<typeof rankService.syncRespondentRank>> | null = null;

  // 会員化前（グローバル必須書類に未同意）の回答者にはポイントを付与せず保留する。
  // 保留分は会員登録（consent 送信）時に awardDeferredCompletionsForMember でまとめて付与する。
  // 店舗専用アンケートのセルフ回答者（非会員）が主な対象。既存の会員フローは従来どおり即時付与。
  const isMember = session && lineUserId ? await isGlobalMemberSafe(lineUserId) : false;

  if (session && lineUserId && !isMember) {
    logger.info("postComplete.award.deferred", {
      assignmentId,
      lineUserId,
      reason: "not-yet-member; points will be granted at membership registration",
    });
  }

  if (session && lineUserId && isMember) {
    try {
      // 旧スキーマへの書き込み（respondents.total_points / ランク同期のために維持）
      awardResult = await pointService.awardCompletionPoints({
        respondent,
        sessionId: session.id,
        projectId: project.id,
        projectRewardPoints: project.reward_points,
        lineUserId,
      });

      rankResult = await rankService.syncRespondentRank(
        awardResult.updatedRespondent,
        "session_completed",
      );

      // 新スキーマへの書き込み（user_points / point_histories に統一）
      // idempotency_key = "session:{session_id}:{type}" で二重付与を防止
      const canonicalResults = await Promise.allSettled(
        awardResult.transactions.map((tx) => {
          const newType = TYPE_MAP[tx.transaction_type] ?? "manual_adjustment";
          return userPointService.awardPoints({
            lineUserId,
            transactionType:  newType,
            points:           tx.points,
            reason:           tx.reason,
            referenceType:    "session",
            referenceId:      session.id,
            idempotencyKey:   `session:${session.id}:${tx.transaction_type}`,
          });
        }),
      );
      // allSettled は失敗を握り潰すため、必ず個別にログへ出す。
      // 正準台帳だけが落ちるとレガシー台帳との乖離（マイページ残高 0）が無言で発生する。
      logCanonicalAwardFailures(canonicalResults, { lineUserId, sessionId: session.id, assignmentId });
    } catch (err) {
      logger.error("postComplete.award.failed", {
        assignmentId,
        respondentId: respondent.id,
        error: String(err),
      });
    }
  }

  if (!lineUserId) return;

  logger.info("postComplete.sendLine", { assignmentId, lineUserId });

  try {
    const messages: LineTextMessage[] = [];

    if (awardResult) {
      // 通知メッセージは新スキーマの残高を優先（なければ旧スキーマから）
      let displayTotal = awardResult.updatedRespondent.total_points;
      try {
        const newBalance = await userPointService.getBalance(lineUserId);
        displayTotal = newBalance.available_points;
      } catch {
        // 新スキーマ取得失敗時は旧スキーマの値を使用
      }

      const [currentRank, nextRank] = await Promise.all([
        rankResult?.newRank
          ? Promise.resolve(rankResult.newRank)
          : rankService.resolveRank(awardResult.updatedRespondent.total_points),
        rankService.getNextRank(awardResult.updatedRespondent.total_points),
      ]);

      const lines = [
        `獲得ポイント: ${awardResult.totalAwarded}pt`,
        `累計ポイント: ${displayTotal}pt`,
        `現在ランク: ${currentRank?.rank_name ?? "Bronze"}`,
        nextRank
          ? `次ランクまで: ${nextRank.min_points - awardResult.updatedRespondent.total_points}pt`
          : "次ランク: 最上位ランクです",
      ];
      if (rankResult?.changed && currentRank) {
        lines.push(`ランクアップ: ${currentRank.rank_name}`);
      }

      messages.push({ type: "text", text: lines.join("\n") });
    }

    messages.push({
      type: "text",
      text: "インタビューが完了しました。ご協力ありがとうございました。",
    });

    await lineMessagingService.push(lineUserId, messages);
  } catch (err) {
    logger.error("postComplete.sendLine.failed", {
      assignmentId,
      lineUserId,
      error: String(err),
    });
  }
}

/**
 * 会員登録（グローバル必須書類への同意）完了時に、会員化前に完了して
 * ポイントが保留されていたアンケートの完了ポイントをまとめて付与する。
 *
 * べき等性: 「その session に project_completion の point_transaction が無い」ことを
 * 保留の目印にする（DB追加なし）。既に付与済みの session はスキップするため、
 * 何度呼んでも二重付与しない。新スキーマ(user_points)は idempotencyKey でも二重防止。
 */
export async function awardDeferredCompletionsForMember(lineUserId: string): Promise<void> {
  const respondents = await respondentRepository.listByLineUserId(lineUserId);
  if (respondents.length === 0) return;

  let grandTotal = 0;

  for (const respondent of respondents) {
    const sessions = await sessionRepository.listByRespondent(respondent.id);
    const completed = sessions.filter((s) => s.status === "completed");
    if (completed.length === 0) continue;

    const txns = await pointTransactionRepository.listByRespondent(respondent.id);
    const awardedSessionIds = new Set(
      txns
        .filter((t) => t.transaction_type === "project_completion" && t.session_id)
        .map((t) => t.session_id as string),
    );

    for (const session of completed) {
      if (awardedSessionIds.has(session.id)) continue;

      try {
        const project = await projectRepository.getById(session.project_id);
        // total_points を最新化してから付与（同一 respondent で複数 session を回す場合の取りこぼし防止）
        const fresh = await respondentRepository.getById(respondent.id);

        const awardResult = await pointService.awardCompletionPoints({
          respondent: fresh,
          sessionId: session.id,
          projectId: project.id,
          projectRewardPoints: project.reward_points,
          lineUserId,
        });

        await rankService.syncRespondentRank(awardResult.updatedRespondent, "session_completed");

        const canonicalResults = await Promise.allSettled(
          awardResult.transactions.map((tx) => {
            const newType = TYPE_MAP[tx.transaction_type] ?? "manual_adjustment";
            return userPointService.awardPoints({
              lineUserId,
              transactionType: newType,
              points: tx.points,
              reason: tx.reason,
              referenceType: "session",
              referenceId: session.id,
              idempotencyKey: `session:${session.id}:${tx.transaction_type}`,
            });
          }),
        );
        logCanonicalAwardFailures(canonicalResults, { lineUserId, sessionId: session.id });

        grandTotal += awardResult.totalAwarded;
        logger.info("postComplete.deferredAward.granted", {
          lineUserId,
          sessionId: session.id,
          projectId: project.id,
          awarded: awardResult.totalAwarded,
        });
      } catch (err) {
        logger.error("postComplete.deferredAward.failed", {
          lineUserId,
          sessionId: session.id,
          error: String(err),
        });
      }
    }
  }

  if (grandTotal <= 0) return;

  // 会員化に伴う保留ポイント付与の通知（失敗は無視）
  try {
    let displayTotal: number | null = null;
    try {
      displayTotal = (await userPointService.getBalance(lineUserId)).available_points;
    } catch {
      // 残高取得失敗時は累計を省略
    }
    const lines = [
      "会員登録ありがとうございます。",
      `保留していた回答の獲得ポイント: ${grandTotal}pt を付与しました。`,
    ];
    if (displayTotal !== null) lines.push(`累計ポイント: ${displayTotal}pt`);
    await lineMessagingService.push(lineUserId, [{ type: "text", text: lines.join("\n") }]);
  } catch (err) {
    logger.warn("postComplete.deferredAward.notifyFailed", { lineUserId, error: String(err) });
  }
}
