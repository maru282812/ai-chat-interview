import { logger } from "../lib/logger";
import { env } from "../config/env";
import { userPointService } from "./userPointService";
import { pointExchangeRepository } from "../repositories/pointExchangeRepository";
import { pointExchangeAuditLogRepository } from "../repositories/pointExchangeAuditLogRepository";
import { notificationTemplateRepository } from "../repositories/notificationTemplateRepository";
import { lineMessagingService } from "./lineMessagingService";
import { getMypageLiffId } from "./liffService";
import type { PointExchangeRequest } from "../types/domain";

/** 1交換単位 */
export const EXCHANGE_UNIT_POINTS = 500;
/** 1交換単位の円相当額 */
export const EXCHANGE_UNIT_JPY = 500;

export class ExchangeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INSUFFICIENT_POINTS"
      | "NOT_MULTIPLE_OF_UNIT"
      | "ALREADY_PENDING"
      | "REQUEST_NOT_FOUND"
      | "CANCEL_NOT_ALLOWED"
      | "POINT_DEDUCTION_FAILED",
  ) {
    super(message);
    this.name = "ExchangeError";
  }
}

export const pointExchangeService = {
  /**
   * 交換申請を作成する。
   *
   * 処理順序（障害時の整合性を保つために順序が重要）:
   *   1. available_points が requestedPoints 以上か確認
   *   2. 申請中レコードが既にないか確認
   *   3. point_exchange_requests に INSERT（ユニーク制約で二重申請を DB レベルでも防止）
   *   4. point_histories に exchange_request (負値) を INSERT
   *      → トリガーが available_points -= points / pending_points += points を実行
   *   5. step4 失敗時は point_exchange_requests を canceled にロールバック
   */
  async requestExchange(
    lineUserId: string,
    requestedPoints: number,
  ): Promise<PointExchangeRequest> {
    if (requestedPoints <= 0 || requestedPoints % EXCHANGE_UNIT_POINTS !== 0) {
      throw new ExchangeError(
        `交換ポイントは ${EXCHANGE_UNIT_POINTS}pt の倍数で指定してください`,
        "NOT_MULTIPLE_OF_UNIT",
      );
    }

    // 1. 残高確認
    const balance = await userPointService.getBalance(lineUserId);
    if (balance.available_points < requestedPoints) {
      throw new ExchangeError(
        `保有ポイントが不足しています（保有: ${balance.available_points}pt / 必要: ${requestedPoints}pt）`,
        "INSUFFICIENT_POINTS",
      );
    }

    // 2. 申請中チェック（DB ユニーク制約の前に明示的なエラーを返す）
    const existing = await pointExchangeRepository.getPendingByUser(lineUserId);
    if (existing) {
      throw new ExchangeError(
        "既に申請中の交換があります。承認または完了後に再申請してください。",
        "ALREADY_PENDING",
      );
    }

    // 3. 申請レコード作成
    const giftAmountJpy = (requestedPoints / EXCHANGE_UNIT_POINTS) * EXCHANGE_UNIT_JPY;
    const request = await pointExchangeRepository.create({
      lineUserId,
      requestedPoints,
      giftAmountJpy,
    });

    // 4. ポイント仮押さえ（available → pending）
    //    point_histories に exchange_request (負値) を INSERT することで
    //    DB トリガーが user_points を自動更新する
    try {
      await userPointService.awardPoints({
        lineUserId,
        transactionType: "exchange_request",
        points:          -requestedPoints,
        reason:          `ギフト交換申請（${requestedPoints}pt）`,
        referenceType:   "exchange_request",
        referenceId:     request.id,
        idempotencyKey:  `exchange:${request.id}:request`,
      });
    } catch (err) {
      // 4 が失敗した場合は申請レコードをキャンセルして整合性を保つ
      logger.error("pointExchange.deduction.failed", {
        requestId: request.id,
        lineUserId,
        error: String(err),
      });
      try {
        await pointExchangeRepository.cancel(request.id, lineUserId);
      } catch (cancelErr) {
        logger.error("pointExchange.rollback.failed", {
          requestId: request.id,
          error: String(cancelErr),
        });
      }
      throw new ExchangeError(
        "ポイントの仮押さえに失敗しました。時間をおいて再度お試しください。",
        "POINT_DEDUCTION_FAILED",
      );
    }

    logger.info("pointExchange.requested", {
      requestId:       request.id,
      lineUserId,
      requestedPoints,
      giftAmountJpy,
    });

    return request;
  },

  /**
   * ユーザーが申請をキャンセルする。
   *
   * 処理順序:
   *   1. 申請レコードを canceled に更新（pending のみ対象）
   *   2. point_histories に exchange_cancel (正値) を INSERT
   *      → トリガーが pending_points -= points / available_points += points を実行
   */
  async cancelExchange(
    requestId: string,
    lineUserId: string,
  ): Promise<PointExchangeRequest> {
    const request = await pointExchangeRepository.getById(requestId);
    if (!request || request.line_user_id !== lineUserId) {
      throw new ExchangeError("交換申請が見つかりません", "REQUEST_NOT_FOUND");
    }
    if (request.status !== "pending") {
      throw new ExchangeError(
        `この申請はキャンセルできません（現在のステータス: ${request.status}）`,
        "CANCEL_NOT_ALLOWED",
      );
    }

    // 1. ステータスを canceled に変更
    const canceled = await pointExchangeRepository.cancel(requestId, lineUserId);

    // 2. ポイント返還（pending → available）
    try {
      await userPointService.awardPoints({
        lineUserId,
        transactionType: "exchange_cancel",
        points:          request.requested_points,
        reason:          `ギフト交換申請キャンセル（${request.requested_points}pt 返還）`,
        referenceType:   "exchange_request",
        referenceId:     requestId,
        idempotencyKey:  `exchange:${requestId}:cancel`,
      });
    } catch (err) {
      // キャンセル自体は成功しているが返還に失敗: 警告ログを残して続行
      // 管理者が手動調整できるようにログに残す
      logger.error("pointExchange.cancel.refund.failed", {
        requestId,
        lineUserId,
        requestedPoints: request.requested_points,
        error: String(err),
      });
    }

    logger.info("pointExchange.canceled", {
      requestId,
      lineUserId,
      requestedPoints: request.requested_points,
    });

    return canceled;
  },

  /**
   * 承認済み通知を LINE Push で送信する。
   * 失敗しても申請フローは継続し、エラーを notification_error に記録する。
   */
  async sendApprovedNotification(requestId: string): Promise<void> {
    const request = await pointExchangeRepository.getById(requestId);
    if (!request) return;

    const template = await notificationTemplateRepository.getDefault("exchange_approved");
    if (!template) {
      logger.warn("exchange.notify.approved.no_template", { requestId });
      return;
    }

    const body = notificationTemplateRepository.renderBody(template, {
      points:     String(request.requested_points),
      amount_jpy: String(request.gift_amount_jpy),
    });

    try {
      await lineMessagingService.push(request.line_user_id, [{ type: "text", text: body }]);
      await pointExchangeRepository.markNotificationSent(requestId);
      void pointExchangeAuditLogRepository.create({ requestId, action: "notify_sent", detail: { category: "exchange_approved" } });
      logger.info("exchange.notify.approved.sent", { requestId });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await pointExchangeRepository.markNotificationFailed(requestId, reason);
      void pointExchangeAuditLogRepository.create({ requestId, action: "notify_failed", detail: { category: "exchange_approved", reason } });
      logger.error("exchange.notify.approved.failed", { requestId, reason });
    }
  },

  /**
   * 送付済み通知を LINE Push で送信する（ギフトURLはマイページで確認させる）。
   * 失敗しても申請フローは継続し、エラーを notification_error に記録する。
   */
  async sendFulfilledNotification(requestId: string): Promise<void> {
    const request = await pointExchangeRepository.getById(requestId);
    if (!request) return;

    const template = await notificationTemplateRepository.getDefault("exchange_fulfilled");
    if (!template) {
      logger.warn("exchange.notify.fulfilled.no_template", { requestId });
      return;
    }

    const liffId   = getMypageLiffId();
    const mypageUrl = liffId
      ? `https://liff.line.me/${liffId}`
      : `${env.APP_BASE_URL}/liff/mypage`;

    const body = notificationTemplateRepository.renderBody(template, {
      points:      String(request.requested_points),
      amount_jpy:  String(request.gift_amount_jpy),
      mypage_url:  mypageUrl,
    });

    try {
      await lineMessagingService.push(request.line_user_id, [{ type: "text", text: body }]);
      await pointExchangeRepository.markNotificationSent(requestId);
      void pointExchangeAuditLogRepository.create({ requestId, action: "notify_sent", detail: { category: "exchange_fulfilled" } });
      logger.info("exchange.notify.fulfilled.sent", { requestId });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await pointExchangeRepository.markNotificationFailed(requestId, reason);
      void pointExchangeAuditLogRepository.create({ requestId, action: "notify_failed", detail: { category: "exchange_fulfilled", reason } });
      logger.error("exchange.notify.fulfilled.failed", { requestId, reason });
    }
  },

  /**
   * 管理者が申請を却下する（ポイント返還込み）。
   * 呼び出し元: adminController
   */
  async rejectExchange(
    requestId: string,
    adminId: string,
    reason: string,
  ): Promise<PointExchangeRequest> {
    const request = await pointExchangeRepository.getById(requestId);
    if (!request) {
      throw new ExchangeError("交換申請が見つかりません", "REQUEST_NOT_FOUND");
    }
    if (!["pending", "approved"].includes(request.status)) {
      throw new ExchangeError(
        `却下できないステータスです（現在: ${request.status}）`,
        "CANCEL_NOT_ALLOWED",
      );
    }

    const rejected = await pointExchangeRepository.reject(requestId, adminId, reason);

    // ポイント返還（pending → available）
    try {
      await userPointService.awardPoints({
        lineUserId:      request.line_user_id,
        transactionType: "exchange_refund",
        points:          request.requested_points,
        reason:          `ギフト交換申請却下（${request.requested_points}pt 返還）`,
        referenceType:   "exchange_request",
        referenceId:     requestId,
        idempotencyKey:  `exchange:${requestId}:refund`,
      });
    } catch (err) {
      logger.error("pointExchange.reject.refund.failed", {
        requestId,
        adminId,
        requestedPoints: request.requested_points,
        error: String(err),
      });
    }

    logger.info("pointExchange.rejected", { requestId, adminId, reason });
    return rejected;
  },
};
