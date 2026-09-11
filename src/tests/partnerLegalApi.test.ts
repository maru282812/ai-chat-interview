/**
 * 会員利用規約（店舗向け）の配信 API（docs/partner-api.md §5.8）のテスト。
 *
 * 実 DB には触らない。documentRepository を差し替えて express を立てて叩く。
 * env は import 前に注入する必要があるため動的 require。
 */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

const PARTNER_STORE_KEY = "partner-store-key-for-test-0123456789";
const STORE_ID = "33333333-3333-4333-8333-333333333333";

process.env.PARTNER_API_KEY = PARTNER_STORE_KEY;
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.LINE_CHANNEL_SECRET ??= "test-secret";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ??= "00000000-0000-4000-8000-000000000000";
process.env.ADMIN_PASSWORD_HASH ??= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ??= "test-admin-session-secret-000000000000";

const express = require("express") as typeof import("express");
const httpLib = require("../lib/http") as typeof import("../lib/http");
const documentRepositoryModule =
  require("../repositories/documentRepository") as typeof import("../repositories/documentRepository");
const partnerRoutesModule = require("../routes/partnerRoutes") as typeof import("../routes/partnerRoutes");
const partnerLegalServiceModule =
  require("../services/partnerLegalService") as typeof import("../services/partnerLegalService");

const { documentRepository } = documentRepositoryModule;
const { PORTAL_STORE_TERMS_DOCUMENT_ID } = partnerLegalServiceModule;

const app = express();
app.use(express.json());
app.use("/api/partner", partnerRoutesModule.partnerRoutes);
app.use(httpLib.errorHandler);
const server = app.listen(0);
after(() => server.close());

function baseUrl(): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function call(options: { key?: string | null; storeId?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (options.key !== null) headers["x-partner-key"] = options.key ?? PARTNER_STORE_KEY;
  if (options.storeId !== null) headers["x-partner-store-id"] = options.storeId ?? STORE_ID;
  const response = await fetch(`${baseUrl()}/api/partner/legal/store-terms`, { headers });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body, raw };
}

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): () => void {
  const original = target[key];
  target[key] = value;
  return () => {
    target[key] = original;
  };
}

const DOC = {
  id: PORTAL_STORE_TERMS_DOCUMENT_ID,
  document_type: "terms_of_service",
  usage_category: "b2b_contract" as const,
  title: "会員利用規約（店舗向け・アンケでYOTTO）",
  description: null,
  current_version_id: "d1100000-0000-0000-0000-000000000002",
  is_active: true,
  is_required_global: false,
  created_at: "2026-09-11T00:00:00.000Z",
  updated_at: "2026-09-11T00:00:00.000Z"
};

const V1 = {
  id: "d1100000-0000-0000-0000-000000000001",
  document_id: PORTAL_STORE_TERMS_DOCUMENT_ID,
  version_no: "1.0-draft",
  content: "# 旧版",
  change_reason: "初版",
  effective_from: "2026-09-11T00:00:00.000Z",
  effective_to: "2026-10-01T00:00:00.000Z",
  created_at: "2026-09-11T00:00:00.000Z",
  created_by: "migration"
};

const V2 = {
  ...V1,
  id: "d1100000-0000-0000-0000-000000000002",
  version_no: "1.1",
  content: "# アンケでYOTTO 会員利用規約（店舗向け）\n\n## 第8条\n申し送りの目的外利用禁止",
  change_reason: "弁護士確認済み",
  effective_from: "2026-10-01T00:00:00.000Z",
  effective_to: null
};

test("鍵が無ければ 401、店舗IDヘッダが無ければ 400（他のエンドポイントと同じ）", async () => {
  const noKey = await call({ key: null });
  assert.equal(noKey.status, 401);
  const noStore = await call({ storeId: null });
  assert.equal(noStore.status, 400);
});

test("現在版の本文・版番号・施行日・版履歴（本文なし・新しい順）を返す", async () => {
  const restores = [
    stub(documentRepository, "getById", async () => DOC),
    stub(documentRepository, "getVersion", async (id: string) => (id === V2.id ? V2 : V1)),
    stub(documentRepository, "listVersions", async () => [V1, V2])
  ];
  try {
    const result = await call();
    assert.equal(result.status, 200, result.raw);
    assert.equal(result.body.document_id, PORTAL_STORE_TERMS_DOCUMENT_ID);
    assert.equal(result.body.version_no, "1.1");
    assert.equal(result.body.effective_from, V2.effective_from);
    assert.equal(String(result.body.content).includes("第8条"), true);
    const versions = result.body.versions as Array<Record<string, unknown>>;
    assert.deepEqual(
      versions.map((v) => v.version_no),
      ["1.1", "1.0-draft"]
    );
    assert.equal("content" in (versions[0] ?? {}), false);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

test("文書が無効化されている / 版が無いときは 404", async () => {
  const inactive = [stub(documentRepository, "getById", async () => ({ ...DOC, is_active: false }))];
  try {
    const result = await call();
    assert.equal(result.status, 404);
    assert.equal(result.body.error, "store terms not found");
  } finally {
    for (const restore of inactive.reverse()) restore();
  }

  const noVersion = [
    stub(documentRepository, "getById", async () => ({ ...DOC, current_version_id: null }))
  ];
  try {
    const result = await call();
    assert.equal(result.status, 404);
  } finally {
    for (const restore of noVersion.reverse()) restore();
  }
});
