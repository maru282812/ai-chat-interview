/**
 * 管理画面AIチャットのツール登録エントリ。
 *
 * 登録をモジュール読み込みの副作用にせず、この関数を1回呼ぶ形にしている
 * （どのツールが有効かが1箇所で読める・テストで登録内容を差し替えられる）。
 * 新しいツール群を足すときはここに1行足す。
 */

import { registerAnswerTools } from "./tools/answerTools";
import { registerDailyQueueTools } from "./tools/dailyQueueTools";
import { registerDeliveryTools } from "./tools/deliveryTools";
import { registerPoolQuestionTools } from "./tools/poolQuestionTools";
import { registerQuestionWriteTools } from "./tools/questionWriteTools";
import { registerSegmentTools } from "./tools/segmentTools";

let registered = false;

export function registerAdminChatTools(): void {
  if (registered) return;
  // Tier A: 回答分析
  registerAnswerTools();
  // Tier B: 設問の下書き編集 / デイリーのキュー積み / セグメント・キャンペーン下書き
  registerQuestionWriteTools();
  registerDailyQueueTools();
  registerSegmentTools();
  // Tier B + Tier C（公開は承認カード経由）
  registerPoolQuestionTools();
  // Tier A（一覧）+ Tier C（LINE実配信は承認カード経由）
  registerDeliveryTools();
  registered = true;
}
