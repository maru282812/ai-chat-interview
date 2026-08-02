/**
 * 顧客発見（P13）判定支援ツールの登録テスト
 * 要件 §6.6 / §12-B1
 *
 * 確認項目:
 * 1. Tier A（読み取り専用）として登録され、レジストリの検証を通る
 * 2. 回答分析と同じ画面群に出る（案件・セッション画面から呼べる）
 * 3. AI に「GO を断定するな」という指示が description / instruction に載っている
 *    ＝ §10 差し戻し条件「システムが『GOです』と断定表現でレポートする」の防止
 */

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

import {
  behaviorEvidenceToolDefinitions,
  registerBehaviorEvidenceTools,
} from "../services/adminChat/tools/behaviorEvidenceTools";
import {
  __resetRegistryForTest,
  registerTool,
  toolsForScreen,
} from "../services/adminChat/toolRegistry";

const TOOL_NAME = "get_customer_discovery_report";

test("BET-1: レジストリ検証を通って登録できる（tier / screenKeys / parameters）", () => {
  __resetRegistryForTest();
  assert.doesNotThrow(() => registerBehaviorEvidenceTools());
  const tools = toolsForScreen("sessions-index");
  const target = tools.find((tool) => tool.name === TOOL_NAME);
  assert.ok(target, `${TOOL_NAME} が sessions-index に登録されていない`);
  assert.equal(target.tier, "A", "判定支援は読み取り専用でなければならない");
  // Tier A に prepare があるとレジストリが弾く（Tier C 専用）
  assert.equal(typeof target.prepare, "undefined");
  __resetRegistryForTest();
});

test("BET-2: 回答分析と同じ画面群から呼べる", () => {
  const [tool] = behaviorEvidenceToolDefinitions();
  assert.ok(tool);
  for (const screen of ["sessions-index", "session-show", "respondent-show", "research-form"]) {
    assert.ok(tool.screenKeys.includes(screen), `${screen} で使えない`);
  }
});

test("BET-3: description で AI に判定の断定を禁じている（§3-2 / §10）", () => {
  const [tool] = behaviorEvidenceToolDefinitions();
  assert.ok(tool);
  assert.match(tool.description, /断定してはいけない|判定結果を返さない/);
  assert.match(tool.description, /運営者/);
});

test("BET-4: 二重登録は名前重複で弾かれる（ゲートのすり抜け防止）", () => {
  __resetRegistryForTest();
  registerBehaviorEvidenceTools();
  const [tool] = behaviorEvidenceToolDefinitions();
  assert.ok(tool);
  assert.throws(() => registerTool(tool), /重複/);
  __resetRegistryForTest();
});
