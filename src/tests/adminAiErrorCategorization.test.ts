/**
 * describeOpenAIError（管理画面 生AI実行のエラー分類）のユニットテスト。
 *
 * 深掘りプレイグラウンド等で callRaw が投げる OpenAI エラーを、原因カテゴリが
 * 分かる日本語メッセージに整形できることを検証する（ネットワーク無し・純関数）。
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

import { describeOpenAIError } from "../services/aiService";

test("EC1: 401 は [認証]", () => {
  const m = describeOpenAIError({ status: 401, code: "invalid_api_key", message: "bad key" });
  assert.ok(m.startsWith("[認証]"), m);
  assert.ok(m.includes("OPENAI_API_KEY"));
});

test("EC2: model_not_found は [モデル]（status 400/404 どちらでも）", () => {
  const m400 = describeOpenAIError({ status: 400, code: "model_not_found", message: "no model" });
  const m404 = describeOpenAIError({ status: 404, code: null, message: "not found" });
  assert.ok(m400.startsWith("[モデル]"), m400);
  assert.ok(m404.startsWith("[モデル]"), m404);
  assert.ok(m400.includes("OPENAI_MODEL"));
});

test("EC3: 429 insufficient_quota は [API設定]、通常の 429 は [レート制限]", () => {
  const quota = describeOpenAIError({ status: 429, code: "insufficient_quota", message: "no quota" });
  const rate = describeOpenAIError({ status: 429, code: "rate_limit_exceeded", message: "slow down" });
  assert.ok(quota.startsWith("[API設定]"), quota);
  assert.ok(rate.startsWith("[レート制限]"), rate);
});

test("EC4: 400/422 は [API設定]、5xx は [サーバー]", () => {
  assert.ok(describeOpenAIError({ status: 400, message: "bad" }).startsWith("[API設定]"));
  assert.ok(describeOpenAIError({ status: 422, message: "unprocessable" }).startsWith("[API設定]"));
  assert.ok(describeOpenAIError({ status: 503, message: "down" }).startsWith("[サーバー]"));
});

test("EC5: status を持たない接続エラーは [ネットワーク]", () => {
  const conn = describeOpenAIError({ name: "APIConnectionError", message: "connect ECONNREFUSED" });
  const timeout = describeOpenAIError({ name: "APIConnectionTimeoutError", message: "request timed out" });
  assert.ok(conn.startsWith("[ネットワーク]"), conn);
  assert.ok(timeout.startsWith("[ネットワーク]"), timeout);
});

test("EC6: 元のエラー本文を保持する", () => {
  const m = describeOpenAIError({ status: 500, message: "internal boom" });
  assert.ok(m.includes("internal boom"));
});
