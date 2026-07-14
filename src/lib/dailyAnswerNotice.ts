/**
 * dailyAnswerNotice.ts
 *
 * デイリーアンケートに回答したときに LINE へ出す「ポイント付いたよ」文面（純関数）。
 *
 * 回答経路は2つある:
 *   - トーク内の選択肢ボタン（postback）… reply で返す
 *   - LIFF（案件一覧の今日の1問カード / 回答ページ）… push で送る
 * 文面がバラつくと「付いたのか分からない」が残るので、両経路でこのビルダーを使う。
 */

import type { LineMessage } from "../types/domain";

export interface DailyAnswerNoticeInput {
  /** このアンケートで付いた通常ポイント。 */
  pointsAwarded: number;
  /** 連続回答ボーナス（0 なら出さない）。 */
  streakBonusAwarded: number;
  /** 現在の連続回答日数。 */
  currentStreak: number;
  /** ランクが上がったか。 */
  rankChanged: boolean;
  /** 上がった先のランク名。 */
  newRankName: string | null;
  /** 付与後の交換可能残高。 */
  availablePoints: number;
  /** 次のランク名（最上位なら null）。 */
  nextRankName: string | null;
  /** 次のランクまで必要なポイント（最上位なら null）。 */
  pointsToNext: number | null;
}

/** 通知本文（テキスト）。UI から呼びやすいよう行の配列で返す。 */
export function buildDailyAnswerNoticeLines(input: DailyAnswerNoticeInput): string[] {
  const total = input.pointsAwarded + input.streakBonusAwarded;

  const lines: string[] = [
    "✅ 回答ありがとうございます",
    `獲得ポイント: +${total}pt`,
  ];

  // 内訳はボーナスが乗ったときだけ出す（普段は1行で読み切れるようにする）。
  if (input.streakBonusAwarded > 0) {
    lines.push(`（回答 +${input.pointsAwarded}pt / 連続ボーナス +${input.streakBonusAwarded}pt）`);
  }

  lines.push(`現在のポイント: ${input.availablePoints}pt`);

  if (input.currentStreak > 1) {
    lines.push(`🔥 ${input.currentStreak}日連続で回答中`);
  }

  if (input.rankChanged && input.newRankName) {
    lines.push(`🎉 ランクが ${input.newRankName} になりました`);
  } else if (input.nextRankName && input.pointsToNext !== null) {
    lines.push(`次のランク「${input.nextRankName}」まで あと ${input.pointsToNext}pt`);
  }

  return lines;
}

export function buildDailyAnswerNoticeMessages(input: DailyAnswerNoticeInput): LineMessage[] {
  return [{ type: "text", text: buildDailyAnswerNoticeLines(input).join("\n") }];
}
