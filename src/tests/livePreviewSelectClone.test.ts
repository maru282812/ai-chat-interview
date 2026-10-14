/**
 * livePreviewSelectClone.test.ts
 *
 * 「回答形式を切り替えても右のライブプレビューが変わらない」の回帰テスト。
 *
 * 背景（実際に起きていたこと）:
 *   ライブプレビューは編集フォームを cloneNode して iframe へ POST する。
 *   cloneNode は input/textarea の入力値は運ぶが、select の「いま選ばれている値」は
 *   運ばず、初期の selected 属性に戻る。そのため回答形式（question_type）などの
 *   プルダウンを変えても、保存するまでプレビューは保存済みの値で描かれていた。
 *
 * formV3.ejs はブラウザ専用の配線なので、ソース上で「複製後に select の値を写す」ことを固定する。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const formV3Src = fs
  .readFileSync(path.join(process.cwd(), "src/views/admin/questions/formV3.ejs"), "utf8")
  .replace(/\r\n/g, "\n");

function renderLivePreviewBody(): string {
  const start = formV3Src.indexOf("function renderLivePreview()");
  assert.ok(start >= 0, "renderLivePreview が見つかりません");
  const end = formV3Src.indexOf("function scheduleLivePreview(", start);
  assert.ok(end > start, "scheduleLivePreview が見つかりません");
  return formV3Src.slice(start, end);
}

test("ライブプレビューは複製したフォームへ select の現在値を写してから送る", () => {
  const body = renderLivePreviewBody();
  const cloneAt = body.indexOf("liveForm.cloneNode(true)");
  const copyAt = body.indexOf("ghost.querySelectorAll('select')");
  const submitAt = body.indexOf("ghost.submit()");
  assert.ok(cloneAt >= 0, "フォームの複製が見つかりません");
  assert.ok(copyAt > cloneAt, "複製後に select の値を写していません（回答形式の切替がプレビューに出なくなる）");
  assert.ok(submitAt > copyAt, "select の値を写す前に送信しています");
  assert.match(body, /opt\.selected\s*=/, "option の selected を現在値で設定していません");
});
