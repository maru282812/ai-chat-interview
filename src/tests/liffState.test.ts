import assert from "node:assert/strict";
import { test } from "node:test";
import { liffStatePath, parseLiffStateQuery } from "../lib/liffState";

test("liff.state: QR 形式（?entry_code=x）からクエリを読む", () => {
  assert.equal(parseLiffStateQuery("?entry_code=st-abc").get("entry_code"), "st-abc");
});

test("liff.state: パス付き（/store?entry_code=x&liff_handoff=1）からクエリを読む", () => {
  const params = parseLiffStateQuery("/store?entry_code=st-abc&liff_handoff=1");
  assert.equal(params.get("entry_code"), "st-abc");
  assert.equal(params.get("liff_handoff"), "1");
});

test("liff.state: パスのみ・空・非文字列はクエリ無し", () => {
  assert.equal(parseLiffStateQuery("/projects/abc").toString(), "");
  assert.equal(parseLiffStateQuery("").toString(), "");
  assert.equal(parseLiffStateQuery(["?entry_code=x"]).toString(), "");
});

test("liff.state: ? 無しのクエリ文字列も読む（従来互換）", () => {
  assert.equal(parseLiffStateQuery("assignment_id=a1").get("assignment_id"), "a1");
});

test("liffStatePath: パス付き liff.state を /liff 配下のパス＋クエリにする", () => {
  assert.equal(liffStatePath("/projects/8997cce6-5908-4c47-a23a-e41a52a36bf7?liff_ctx=2010174167-GoscTkxr"),
    "/projects/8997cce6-5908-4c47-a23a-e41a52a36bf7?liff_ctx=2010174167-GoscTkxr");
  assert.equal(liffStatePath("/projects"), "/projects");
});

test("liffStatePath: パス無し・ルートのみ・不正な形は null", () => {
  assert.equal(liffStatePath("?entry_code=x"), null);
  assert.equal(liffStatePath("/"), null);
  assert.equal(liffStatePath("//evil.example.com/x"), null);
  assert.equal(liffStatePath("/projects/../admin"), null);
  assert.equal(liffStatePath("/a\\b"), null);
  assert.equal(liffStatePath(undefined), null);
});
