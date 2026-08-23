/**
 * 管理画面AIチャットのツール登録エントリ。
 *
 * 登録をモジュール読み込みの副作用にせず、この関数を1回呼ぶ形にしている
 * （どのツールが有効かが1箇所で読める・テストで登録内容を差し替えられる）。
 * 新しいツール群を足すときはここに1行足す。
 */

import { registerAnswerTools } from "./tools/answerTools";
import { registerBehaviorEvidenceTools } from "./tools/behaviorEvidenceTools";
import { registerDailyQueueTools } from "./tools/dailyQueueTools";
import { registerDeliveryTools } from "./tools/deliveryTools";
import { registerNavigationTools } from "./tools/navigationTools";
import { registerPoolQuestionTools } from "./tools/poolQuestionTools";
import { registerQuestionWriteTools } from "./tools/questionWriteTools";
import { registerSegmentTools } from "./tools/segmentTools";

let registered = false;

export function registerAdminChatTools(): void {
  if (registered) return;
  // Tier A: 道しるべ（全画面 "*"）。画面カタログを検索して候補カードのURLを組み立てる
  registerNavigationTools();
  // Tier A: 回答分析
  registerAnswerTools();
  // Tier A: 顧客発見（P13）の判定支援。判定はせず材料だけ返す
  registerBehaviorEvidenceTools();
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

/**
 * テスト用: 登録済みフラグを戻す（本番コードから呼ばない）。
 * `toolRegistry.__resetRegistryForTest()` でレジストリを空にしたあと、
 * 同じプロセスで本物のツール一式を再登録したいテストのために用意している。
 */
export function __resetRegisteredFlagForTest(): void {
  registered = false;
}
