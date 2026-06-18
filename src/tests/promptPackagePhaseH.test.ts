/**
 * Phase H: プロンプトパッケージ編集画面 UX改善（振る舞いを確認 / 差分 / 影響範囲）
 *
 * 1. previewPromptPackageBehavior: 方針 → AI生成 → 影響範囲・生成本文・差分 を返す（DB非依存）。
 *    - affected には採用された生成キーのみ、notAffected には生成対象外（usedPolicies 空）キー。
 * 2. 差分の before 基準: current_templates_json があればそれ、無ければ BASE 本文。
 * 3. 方針未入力は 400 / 採用不能応答は affected 空 + warnings。
 *
 * 純関数（normalize / buildGenerationMetaPrompt / parseGenerationResult）と diffLines は
 * PhaseF / 6-E のスイートで個別に検証済み。ここでは確認パネル用エンドポイントの組み立て
 * （影響範囲分類・差分基準）に焦点を当てる。
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

import { BASE_PROMPT_TEMPLATES, BUILDER_GENERATION_KEYS, type BasePromptKey } from "../prompts/basePromptTemplates";

/** BASE 本文をそのまま採用した（プレースホルダー完全一致）正常 JSON */
function baseEchoJson(keys: BasePromptKey[]): string {
  const obj: Record<string, string> = {};
  for (const k of keys) obj[k] = BASE_PROMPT_TEMPLATES[k].template;
  return JSON.stringify(obj);
}

interface PreviewBody {
  affected: Array<{ key: BasePromptKey; label: string; generated: string; diffRows: Array<{ type: string; text: string }> }>;
  notAffected: Array<{ key: BasePromptKey; label: string }>;
  generatedKeys: BasePromptKey[];
  warnings: string[];
}

async function callPreview(body: Record<string, string>): Promise<{ statusCode: number; captured: unknown }> {
  const { adminController } = await import("../controllers/adminController");
  let statusCode = 200;
  let captured: unknown = null;
  const res = {
    status(c: number) { statusCode = c; return res; },
    json(b: unknown) { captured = b; return res; },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await adminController.previewPromptPackageBehavior({ body } as any, res as any);
  return { statusCode, captured };
}

// ─── 1. 影響範囲分類・差分（current 未指定 → BASE 基準） ───────────────────────

test("H1: 採用キーは affected、生成対象外（usedPolicies 空）は notAffected。重複しない", async () => {
  const { aiService } = await import("../services/aiService");
  const originalCallRaw = aiService.callRaw;
  aiService.callRaw = async () => ({ content: baseEchoJson(BUILDER_GENERATION_KEYS), tokenUsage: null });
  try {
    const { statusCode, captured } = await callPreview({
      builder_spec_json: JSON.stringify({ behaviorPolicy: "質問攻めにしない" }),
    });
    assert.equal(statusCode, 200);
    const body = captured as PreviewBody;

    assert.equal(body.affected.length, 10, "10件すべて採用");
    for (const a of body.affected) {
      assert.ok(BUILDER_GENERATION_KEYS.includes(a.key), `${a.key} は生成対象キーのはず`);
      // current 未指定 → before=BASE、after=BASE のため差分は same 行のみ（added/removed なし）
      assert.ok(!a.diffRows.some((r) => r.type === "added" || r.type === "removed"), `${a.key} は差分なしのはず`);
    }
    // notAffected はすべて usedPolicies 空・生成対象外
    assert.ok(body.notAffected.length > 0);
    for (const n of body.notAffected) {
      assert.ok(!BUILDER_GENERATION_KEYS.includes(n.key), `${n.key} は notAffected に入らないはず`);
      assert.equal(BASE_PROMPT_TEMPLATES[n.key].usedPolicies.length, 0);
    }
  } finally {
    aiService.callRaw = originalCallRaw;
  }
});

// ─── 2. 差分の before 基準（current_templates_json） ─────────────────────────

test("H2: current_templates_json を渡すと差分はその本文を基準に計算される", async () => {
  const { aiService } = await import("../services/aiService");
  const originalCallRaw = aiService.callRaw;
  // 生成結果は BASE 本文（after）
  aiService.callRaw = async () => ({ content: baseEchoJson(["buildProbePrompt"]), tokenUsage: null });
  try {
    // before に BASE + 余分な1行 を渡す → 生成（after=BASE）で当該行が removed として現れる
    const customBefore = BASE_PROMPT_TEMPLATES.buildProbePrompt.template + "\nこの行は削除される予定";
    const { statusCode, captured } = await callPreview({
      builder_spec_json: JSON.stringify({ behaviorPolicy: "深掘りは最大2回" }),
      current_templates_json: JSON.stringify({ buildProbePrompt: customBefore }),
    });
    assert.equal(statusCode, 200);
    const body = captured as PreviewBody;
    const probe = body.affected.find((a) => a.key === "buildProbePrompt");
    assert.ok(probe, "buildProbePrompt が採用されているはず");
    assert.ok(
      probe!.diffRows.some((r) => r.type === "removed" && r.text.includes("この行は削除される予定")),
      "current 本文を基準に removed 行が出るはず",
    );
  } finally {
    aiService.callRaw = originalCallRaw;
  }
});

// ─── 3. バリデーション / 採用不能応答 ────────────────────────────────────────

test("H3: 方針未入力は 400", async () => {
  const { statusCode, captured } = await callPreview({ builder_spec_json: "{}" });
  assert.equal(statusCode, 400);
  assert.ok((captured as { error: string }).error);
});

test("H4: AIが採用不能な応答を返すと affected は空・warnings あり", async () => {
  const { aiService } = await import("../services/aiService");
  const originalCallRaw = aiService.callRaw;
  aiService.callRaw = async () => ({ content: "これはJSONではありません", tokenUsage: null });
  try {
    const { statusCode, captured } = await callPreview({
      builder_spec_json: JSON.stringify({ behaviorPolicy: "x" }),
    });
    assert.equal(statusCode, 200);
    const body = captured as PreviewBody;
    assert.equal(body.affected.length, 0);
    assert.ok(body.warnings.length > 0);
  } finally {
    aiService.callRaw = originalCallRaw;
  }
});

console.log("promptPackagePhaseH.test.ts: all tests defined");
