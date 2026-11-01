/** 回答者・配布物に出す案件タイトルから、社内の管理番号（2026-C123-0001_）を外す。 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { respondentProjectTitle } from "../lib/projectManagement";

test("回答者向けタイトルがあればそれを出す", () => {
  assert.equal(respondentProjectTitle({ user_display_title: "お店アンケート", name: "2026-C12-0003_店舗調査" }), "お店アンケート");
});

test("回答者向けタイトルが空なら案件名から管理番号を外す", () => {
  assert.equal(respondentProjectTitle({ user_display_title: "", name: "2026-C12-0003_店舗調査" }), "店舗調査");
  assert.equal(respondentProjectTitle({ user_display_title: null, name: "2026-c1-12＿デモ体験" }), "デモ体験");
});

test("管理番号の形でない案件名はそのまま・外すと空になる名前は元のまま", () => {
  assert.equal(respondentProjectTitle({ name: "店舗調査 2026" }), "店舗調査 2026");
  assert.equal(respondentProjectTitle({ name: "2026-C12-0003_" }), "2026-C12-0003_");
});
