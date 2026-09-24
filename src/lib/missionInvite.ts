/**
 * missionInvite.ts — 招待・ペアの判定ルール（純関数・Migration 097）
 *
 * DB を触らないロジックだけをここに集める。理由:
 *   - 招待はポイント（現金同等物）が直接動くため、判定を取り違えると回収できない
 *   - 実DB・実LLMなしでテストできる状態を保つ（cycleRules.ts と同じ思想）
 *
 * 法的前提（requirements/legal-premium-act.md / docs/plan-mission-phases.md）:
 *   - 全報酬に 1人あたり上限 2,000pt を適用（2026-09-04 決定・PER_PERSON_CAP）
 *   - 「ポイントを消費して抽選に参加」は賭博構造なので**この機能群に存在してはならない**
 */

/** 仮に懸賞と評価されても限度額を超えないための絶対上限（100円×20倍）。 */
export const PER_PERSON_CAP = 2000;

/** 報酬の内訳（A7）。総原資 300pt/件。本命は相手の回答完了後（D-9）。 */
export const INVITE_REWARDS = Object.freeze({
  /** 被招待者: 会員登録の時点で即時 */
  inviteeOnRegister: 100,
  /** 招待者: 登録の合図。少額を即時 */
  inviterOnRegister: 50,
  /** 招待者: 本命。被招待者がペア回答を完了してから */
  inviterOnPairComplete: 150,
});

/** 1人あたりの招待上限（A3）。業者流入を抑えつつ普通の人が困らない線。 */
export const MAX_INVITES_PER_USER = 10;

/** 招待リンクの有効日数。 */
export const INVITE_EXPIRY_DAYS = 30;

/** ペアの成立期限（A2）。pool question の cooldown と同じ14日。 */
export const PAIR_EXPIRY_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

export type InviteAcceptError =
  | "self_invite"
  | "already_used"
  | "expired"
  | "revoked"
  | "already_member";

export interface InviteForAcceptance {
  inviter_id: string;
  invitee_id: string | null;
  status: string;
  expires_at: string;
}

/**
 * 招待を受諾できるか判定する。
 *
 * - 自己招待（line_user_id 一致）は必ず弾く
 * - 使用済み・失効・取消済みは弾く
 * - 既存会員（isExistingMember=true）は招待報酬の対象外（A4）。
 *   ここでは "already_member" を返し、呼び出し側でペア成立だけを許す。
 */
export function validateInviteAcceptance(
  invite: InviteForAcceptance,
  acceptorId: string,
  isExistingMember: boolean,
  now: Date = new Date()
): InviteAcceptError | null {
  if (acceptorId === invite.inviter_id) return "self_invite";
  if (invite.status === "revoked") return "revoked";
  if (invite.status !== "issued" || invite.invitee_id) return "already_used";
  if (new Date(invite.expires_at).getTime() < now.getTime()) return "expired";
  if (isExistingMember) return "already_member";
  return null;
}

/** 招待の発行可否。上限（A3）を超えたら発行できない。 */
export function canIssueInvite(activeInviteCount: number): boolean {
  return activeInviteCount < MAX_INVITES_PER_USER;
}

export interface PairQuestionChoice {
  code: string;
  label: string;
}

export interface PairAnswerRow {
  line_user_id: string;
  question_id: string;
  choice_code: string;
}

export interface PairMatchResult {
  questionId: string;
  matched: boolean;
  /** 本人の選択コード。相手のコードは**結果に含めない**（D-10） */
  myChoice: string | null;
}

/**
 * 答え合わせの判定。
 *
 * ⚠ 戻り値に相手の選択肢を**含めない**のがこの関数の存在理由。
 *   規約 v2.0 第10条4項(1)（回答原文の第三者提供禁止）はペア相手にも適用される。
 *   「一致したか」という判定だけが相手に渡ってよい情報。
 *   API レスポンスの組み立てを各所で行うと漏れるので、ここで一元的に絞る。
 */
export function computePairMatches(
  questionIds: readonly string[],
  answers: readonly PairAnswerRow[],
  viewerId: string,
  partnerId: string
): PairMatchResult[] {
  const mine = new Map<string, string>();
  const theirs = new Map<string, string>();
  for (const a of answers) {
    if (a.line_user_id === viewerId) mine.set(a.question_id, a.choice_code);
    else if (a.line_user_id === partnerId) theirs.set(a.question_id, a.choice_code);
  }
  return questionIds.map((questionId) => {
    const my = mine.get(questionId) ?? null;
    const their = theirs.get(questionId) ?? null;
    return {
      questionId,
      matched: my !== null && their !== null && my === their,
      myChoice: my,
    };
  });
}

/**
 * 一致→不一致の順に並べ替える（U-4 の「驚きの設計」）。
 * 「2人とも同じを選んだ」を先に積んでから違いを出す。
 */
export function orderForReveal(results: readonly PairMatchResult[]): PairMatchResult[] {
  return [...results].sort((a, b) => Number(b.matched) - Number(a.matched));
}

/** 両者が全問回答したか。 */
export function isPairComplete(
  questionIds: readonly string[],
  answers: readonly PairAnswerRow[],
  userA: string,
  userB: string
): boolean {
  const count = new Map<string, Set<string>>();
  for (const a of answers) {
    if (a.line_user_id !== userA && a.line_user_id !== userB) continue;
    const set = count.get(a.line_user_id) ?? new Set<string>();
    set.add(a.question_id);
    count.set(a.line_user_id, set);
  }
  const need = new Set(questionIds);
  const done = (id: string) => {
    const set = count.get(id);
    if (!set) return false;
    for (const q of need) if (!set.has(q)) return false;
    return true;
  };
  return done(userA) && done(userB);
}

/**
 * 招待偏重の検出（管理画面の「要確認」判定）。
 * 招待数に対し本人の回答数が極端に少ないのは自作自演の典型。
 */
export function isInviteHeavy(answerCount: number, inviteCount: number): boolean {
  if (inviteCount < 3) return false; // 少数では判定しない（誤検知を避ける）
  return answerCount < inviteCount;
}

/** 付与の冪等キー。二重付与は awardPoints 側の 23505 ハンドリングで防ぐ。 */
export const idempotencyKeys = Object.freeze({
  inviteeRegister: (inviteId: string) => `invite:${inviteId}:invitee-register`,
  inviterRegister: (inviteId: string) => `invite:${inviteId}:inviter-register`,
  inviterPairComplete: (pairId: string) => `pair:${pairId}:inviter-complete`,
});
