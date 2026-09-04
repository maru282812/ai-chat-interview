import crypto from "node:crypto";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import {
  INVITE_REWARDS,
  INVITE_EXPIRY_DAYS,
  PAIR_EXPIRY_DAYS,
  addDays,
  canIssueInvite,
  validateInviteAcceptance,
  computePairMatches,
  orderForReveal,
  isPairComplete,
  isInviteHeavy,
  idempotencyKeys,
  type InviteAcceptError,
  type PairMatchResult,
} from "../lib/missionInvite";
import {
  missionInviteRepository,
  surveyPairRepository,
  type MissionInvite,
  type PairQuestion,
  type SurveyPair,
} from "../repositories/missionInviteRepository";
import { respondentService } from "./respondentService";
import { userPointService } from "./userPointService";
import { lineMessagingService } from "./lineMessagingService";

/**
 * ミッション Phase 1: 招待とペアアンケート。
 * 仕様: docs/spec-mission-phase1-invite-pair.md
 *
 * 商用副作用（ポイント付与・LINE通知）はレスポンス前に await する
 * （Vercel/Workers サーバーレス前提。投げっぱなし禁止の既定方針）。
 * ただし通知の失敗は付与を巻き戻さない — 付与が正で通知は従。
 */

function newToken(): string {
  // 推測不能・URLセーフ。連番や短い文字列は総当たりされる（R-6）
  return crypto.randomBytes(24).toString("base64url");
}

async function notify(userId: string, text: string): Promise<void> {
  try {
    await lineMessagingService.push(userId, [{ type: "text", text }]);
  } catch (error) {
    logger.warn("missionInvite: LINE通知に失敗（付与は成立済み）", { userId, error: String(error) });
  }
}

export interface InviteLandingView {
  status: "ok" | InviteAcceptError;
  inviterName: string | null;
  rewardOnRegister: number;
}

export const missionInviteService = {
  /** 招待リンクの発行。上限（10件/人）を超えたら 409。 */
  async issueInvite(inviterId: string): Promise<MissionInvite> {
    const active = await missionInviteRepository.countActiveByInviter(inviterId);
    if (!canIssueInvite(active)) {
      throw new HttpError(409, "招待できる人数の上限に達しています。");
    }
    return missionInviteRepository.create({
      token: newToken(),
      inviter_id: inviterId,
      expires_at: addDays(new Date(), INVITE_EXPIRY_DAYS).toISOString(),
    });
  },

  /**
   * 招待ランディングの表示情報。**未ログインで呼ばれる**。
   * トークンの有効性以外の情報を漏らさない（不正トークンと期限切れを区別して返さない）。
   */
  async getLandingView(token: string): Promise<InviteLandingView> {
    const invite = await missionInviteRepository.getByToken(token);
    if (!invite) {
      return { status: "expired", inviterName: null, rewardOnRegister: INVITE_REWARDS.inviteeOnRegister };
    }
    const error = validateInviteAcceptance(invite, "__anonymous__", false);
    const inviter = await respondentService.getPrimaryRespondent(invite.inviter_id);
    return {
      status: error ?? "ok",
      inviterName: inviter?.display_name ?? null,
      rewardOnRegister: INVITE_REWARDS.inviteeOnRegister,
    };
  },

  /**
   * 招待の受諾（会員登録の検知）。
   * 検証 → 条件付きUPDATE（同時受諾の排他）→ ペア作成 → 付与 → 通知 の順。
   */
  async acceptInvite(input: {
    token: string;
    userId: string;
    displayName: string | null;
    ua: string | null;
    ip: string | null;
  }): Promise<{ pairId: string }> {
    const invite = await missionInviteRepository.getByToken(input.token);
    if (!invite) throw new HttpError(404, "この招待は使えません。");

    const existing = await respondentService.getPrimaryRespondent(input.userId);
    const error = validateInviteAcceptance(invite, input.userId, Boolean(existing));

    if (error === "already_member") {
      // A4: 既存会員は招待報酬なし。ただしペア回答は成立させる
      const updated = await missionInviteRepository.markRegistered({
        id: invite.id, invitee_id: input.userId, signup_ua: input.ua, signup_ip: input.ip,
      });
      if (!updated) throw new HttpError(409, "この招待はすでに使われています。");
      const pair = await surveyPairRepository.createForInvite({
        invite_id: invite.id, user_a: invite.inviter_id, user_b: input.userId,
        expires_at: addDays(new Date(), PAIR_EXPIRY_DAYS).toISOString(),
      });
      return { pairId: pair.id };
    }
    if (error === "self_invite") throw new HttpError(409, "自分の招待リンクは使えません。");
    if (error === "already_used") throw new HttpError(409, "この招待はすでに使われています。");
    if (error === "expired" || error === "revoked") {
      throw new HttpError(410, "この招待は期限切れです。招待した方に新しいリンクを送ってもらってください。");
    }

    // 会員化（プロフィール行の確保は awardPoints 内の ensureUserProfileRow が行う）
    await respondentService.ensureRespondent(input.userId, input.displayName);

    const updated = await missionInviteRepository.markRegistered({
      id: invite.id, invitee_id: input.userId, signup_ua: input.ua, signup_ip: input.ip,
    });
    if (!updated) throw new HttpError(409, "この招待はすでに使われています。");

    const pair = await surveyPairRepository.createForInvite({
      invite_id: invite.id, user_a: invite.inviter_id, user_b: input.userId,
      expires_at: addDays(new Date(), PAIR_EXPIRY_DAYS).toISOString(),
    });

    // 付与（冪等キーで二重付与を防ぐ。23505 は awardPoints 側でハンドリング済み）
    await userPointService.awardPoints({
      lineUserId: input.userId,
      transactionType: "campaign_bonus",
      points: INVITE_REWARDS.inviteeOnRegister,
      reason: "招待から登録",
      referenceType: "campaign",
      referenceId: invite.id,
      idempotencyKey: idempotencyKeys.inviteeRegister(invite.id),
    });
    await userPointService.awardPoints({
      lineUserId: invite.inviter_id,
      transactionType: "campaign_bonus",
      points: INVITE_REWARDS.inviterOnRegister,
      reason: "友だちが登録",
      referenceType: "campaign",
      referenceId: invite.id,
      idempotencyKey: idempotencyKeys.inviterRegister(invite.id),
    });

    await notify(
      invite.inviter_id,
      `招待した方が登録しました！ ${INVITE_REWARDS.inviterOnRegister}pt を受け取りました。` +
        `ふたりでペアアンケートに答えると、さらに ${INVITE_REWARDS.inviterOnPairComplete}pt もらえます。`
    );

    return { pairId: pair.id };
  },

  /** ペアの当事者検証。当事者以外は 404（存在も漏らさない）。 */
  async getPairForUser(pairId: string, userId: string): Promise<SurveyPair> {
    const pair = await surveyPairRepository.getById(pairId);
    if (!pair || (pair.user_a !== userId && pair.user_b !== userId)) {
      throw new HttpError(404, "ページが見つかりません。");
    }
    return pair;
  },

  /** ペア回答画面のデータ。相手については「答えたかどうか」しか返さない。 */
  async getPairData(pairId: string, userId: string): Promise<{
    questions: PairQuestion[];
    myAnswers: Record<string, string>;
    partnerName: string | null;
    partnerDone: boolean;
    completed: boolean;
    expired: boolean;
  }> {
    const pair = await this.getPairForUser(pairId, userId);
    const partnerId = pair.user_a === userId ? pair.user_b : pair.user_a;
    const [questions, answers, partner] = await Promise.all([
      surveyPairRepository.listActiveQuestions(),
      surveyPairRepository.listAnswers(pairId),
      respondentService.getPrimaryRespondent(partnerId),
    ]);
    const myAnswers: Record<string, string> = {};
    let partnerCount = 0;
    for (const a of answers) {
      if (a.line_user_id === userId) myAnswers[a.question_id] = a.choice_code;
      else if (a.line_user_id === partnerId) partnerCount += 1;
    }
    return {
      questions,
      myAnswers,
      partnerName: partner?.display_name ?? null,
      partnerDone: partnerCount >= questions.length && questions.length > 0,
      completed: Boolean(pair.completed_at),
      expired: !pair.completed_at && new Date(pair.expires_at).getTime() < Date.now(),
    };
  },

  /** 回答の保存。全問そろったら完了処理（本命報酬の付与）まで行う。 */
  async submitAnswer(input: {
    pairId: string;
    userId: string;
    questionId: string;
    choiceCode: string;
  }): Promise<{ completed: boolean }> {
    const pair = await this.getPairForUser(input.pairId, input.userId);
    if (pair.completed_at) throw new HttpError(409, "この答え合わせは終わっています。");
    if (new Date(pair.expires_at).getTime() < Date.now()) {
      throw new HttpError(410, "このペアは期限切れです。");
    }

    const questions = await surveyPairRepository.listActiveQuestions();
    const question = questions.find((q) => q.id === input.questionId);
    if (!question) throw new HttpError(400, "設問が見つかりません。");
    if (!question.choices.some((c) => c.code === input.choiceCode)) {
      throw new HttpError(400, "選択肢が不正です。");
    }

    await surveyPairRepository.upsertAnswer({
      pair_id: input.pairId,
      line_user_id: input.userId,
      question_id: input.questionId,
      choice_code: input.choiceCode,
    });

    const answers = await surveyPairRepository.listAnswers(input.pairId);
    const questionIds = questions.map((q) => q.id);
    if (!isPairComplete(questionIds, answers, pair.user_a, pair.user_b)) {
      return { completed: false };
    }

    // 完了処理。markCompleted は条件付きUPDATEなので、同時完了でも1回しか通らない
    const completedPair = await surveyPairRepository.markCompleted(input.pairId);
    if (completedPair) {
      await missionInviteRepository.markAnswered(pair.invite_id);
      await userPointService.awardPoints({
        lineUserId: pair.user_a, // 本命は招待者へ（A7 / D-9）
        transactionType: "campaign_bonus",
        points: INVITE_REWARDS.inviterOnPairComplete,
        reason: "ペアアンケート完了",
        referenceType: "campaign",
        referenceId: pair.id,
        idempotencyKey: idempotencyKeys.inviterPairComplete(pair.id),
      });
      await notify(pair.user_a, "ペアアンケートがそろいました！ 答え合わせが開いています。");
      await notify(pair.user_b, "ペアアンケートがそろいました！ 答え合わせが開いています。");
    }
    return { completed: true };
  },

  /**
   * 答え合わせ。両者完了時のみ。一致→不一致の順。
   * ⚠ 相手の選択コードはレスポンスに**含まれない**（computePairMatches が構造で保証。D-10）。
   */
  async getResult(pairId: string, userId: string): Promise<{
    partnerName: string | null;
    results: Array<PairMatchResult & { questionText: string; myChoiceLabel: string | null }>;
    matchedCount: number;
    total: number;
  }> {
    const pair = await this.getPairForUser(pairId, userId);
    if (!pair.completed_at) throw new HttpError(409, "相手の回答を待っています。");
    const partnerId = pair.user_a === userId ? pair.user_b : pair.user_a;

    const [questions, answers, partner] = await Promise.all([
      surveyPairRepository.listActiveQuestions(),
      surveyPairRepository.listAnswers(pairId),
      respondentService.getPrimaryRespondent(partnerId),
    ]);
    const matches = orderForReveal(
      computePairMatches(questions.map((q) => q.id), answers, userId, partnerId)
    );
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const results = matches.map((m) => {
      const q = qMap.get(m.questionId);
      const label = q?.choices.find((c) => c.code === m.myChoice)?.label ?? null;
      return { ...m, questionText: q?.question_text ?? "", myChoiceLabel: label };
    });
    return {
      partnerName: partner?.display_name ?? null,
      results,
      matchedCount: results.filter((r) => r.matched).length,
      total: results.length,
    };
  },

  /** 管理画面: 招待実績（招待偏重フラグつき）。 */
  async listForAdmin(): Promise<Array<MissionInvite & { flagged: boolean }>> {
    const invites = await missionInviteRepository.listRecent();
    const byInviter = new Map<string, number>();
    for (const inv of invites) {
      if (inv.status === "registered" || inv.status === "answered") {
        byInviter.set(inv.inviter_id, (byInviter.get(inv.inviter_id) ?? 0) + 1);
      }
    }
    // 回答数の取得は重いので Phase 1 では招待数だけで簡易判定し、
    // 精密な判定（回答数との比較）は Phase 2 の進捗テーブル導入後に行う
    return invites.map((inv) => ({
      ...inv,
      flagged: isInviteHeavy(0, byInviter.get(inv.inviter_id) ?? 0) && (byInviter.get(inv.inviter_id) ?? 0) >= 5,
    }));
  },

  async revokeInvite(id: string): Promise<void> {
    await missionInviteRepository.revoke(id);
  },
};
