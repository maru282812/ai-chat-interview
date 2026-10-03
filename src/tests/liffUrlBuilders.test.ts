/**
 * LINE に貼る URL は必ず liffService のヘルパーで組み立てる、という約束のテスト。
 *
 * ## 背景（何度も起きている事故）
 * 店舗QR・サイクルB/C配信の URL を `APP_BASE_URL` から直に組み立てると、
 * LINE 内ブラウザ → サイト → LINE ログイン → サイト … の**無限ループ**になる。
 * 対策として PR#37 で URL 生成を liffService に一元化し、
 * 「LIFF ID があるなら `https://liff.line.me/<id>` の恒久URLを返す」形にそろえた。
 *
 * ## なぜこのテストが必要か
 * liffService.ts は 10 本以上の URL ビルダーを export しており、LINE 向け URL の
 * 単一の関所になっている。にもかかわらず **テストが1件も無かった**（src/tests 配下で
 * liffService を import しているファイルはゼロ）。恒久URL以外を返すようになっても
 * 誰も気付かないまま、ループ事故が再発しうる状態だった。
 *
 * ## 方式
 * ビルダーは env の LIFF ID を見るだけの純関数なので、`env` を差し替えて
 * 「ID あり → liff.line.me」「ID なし → 絶対URLへフォールバック」の両方を検証する。
 * ネットワーク・DB は使わない。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { env } from "../config/env";
import {
  buildDailySurveyLiffUrl,
  buildMypageLiffUrl,
  buildProjectDetailLiffUrl,
  buildProjectsListLiffUrl,
  buildStoreEntryLiffUrl
} from "../services/liffService";

type MutableEnv = {
  LINE_LIFF_ID_SURVEY?: string;
  LINE_LIFF_ID_MYPAGE?: string;
  LINE_LIFF_ID?: string;
};

const SURVEY_ID = "1234567890-abcdefgh";
const MYPAGE_ID = "1234567890-mypageid";

/** env を退避して差し替え、コールバック後に必ず戻す。 */
function withLiffEnv(patch: MutableEnv, run: () => void): void {
  const target = env as unknown as MutableEnv;
  const saved = {
    LINE_LIFF_ID_SURVEY: target.LINE_LIFF_ID_SURVEY,
    LINE_LIFF_ID_MYPAGE: target.LINE_LIFF_ID_MYPAGE,
    LINE_LIFF_ID: target.LINE_LIFF_ID
  };
  target.LINE_LIFF_ID_SURVEY = patch.LINE_LIFF_ID_SURVEY;
  target.LINE_LIFF_ID_MYPAGE = patch.LINE_LIFF_ID_MYPAGE;
  target.LINE_LIFF_ID = patch.LINE_LIFF_ID;
  try {
    run();
  } finally {
    target.LINE_LIFF_ID_SURVEY = saved.LINE_LIFF_ID_SURVEY;
    target.LINE_LIFF_ID_MYPAGE = saved.LINE_LIFF_ID_MYPAGE;
    target.LINE_LIFF_ID = saved.LINE_LIFF_ID;
  }
}

test("★店舗QRのURLは liff.line.me 恒久URLになる（無限ループ対策の核）", () => {
  withLiffEnv({ LINE_LIFF_ID_SURVEY: SURVEY_ID }, () => {
    const url = buildStoreEntryLiffUrl("chk2608-abc");
    assert.ok(
      url.startsWith(`https://liff.line.me/${SURVEY_ID}`),
      `liff.line.me の恒久URLでない: ${url}。APP_BASE_URL 直組みに戻すと LINE⇄サイトの無限ループが再発する。`
    );
    // entry_code はクエリで運ぶ（ルートが /liff/store へ 302 する）
    assert.equal(new URL(url).searchParams.get("entry_code"), "chk2608-abc");
  });
});

test("★LIFF ID 未設定なら絶対URLにフォールバックする（黙って壊れない）", () => {
  withLiffEnv({}, () => {
    const url = buildStoreEntryLiffUrl("chk2608-abc");
    assert.ok(!url.includes("liff.line.me"), `ID 未設定なのに LIFF URL を返している: ${url}`);
    assert.ok(url.includes("/liff/store"), `フォールバック先が /liff/store でない: ${url}`);
    assert.equal(new URL(url).searchParams.get("entry_code"), "chk2608-abc");
  });
});

test("案件詳細・案件一覧のURLも恒久URL＋パスで組む", () => {
  withLiffEnv({ LINE_LIFF_ID_SURVEY: SURVEY_ID }, () => {
    const detail = buildProjectDetailLiffUrl("p-1");
    assert.equal(detail, `https://liff.line.me/${SURVEY_ID}/projects/p-1`);
    const list = buildProjectsListLiffUrl();
    assert.equal(list, `https://liff.line.me/${SURVEY_ID}/projects`);
  });
});

test("デイリーアンケートは survey_id をクエリで運ぶ", () => {
  withLiffEnv({ LINE_LIFF_ID_SURVEY: SURVEY_ID }, () => {
    const url = buildDailySurveyLiffUrl("s-9");
    assert.ok(url.startsWith(`https://liff.line.me/${SURVEY_ID}`), url);
    assert.equal(new URL(url).searchParams.get("survey_id"), "s-9");
  });
});

test("マイページは専用LIFFの素URL（パスを付けない）", () => {
  // mypage LIFF は endpoint 自体が /liff/mypage を指すため、パスを足すと二重になる。
  withLiffEnv({ LINE_LIFF_ID_MYPAGE: MYPAGE_ID }, () => {
    assert.equal(buildMypageLiffUrl(), `https://liff.line.me/${MYPAGE_ID}`);
  });
});

test("専用IDが無ければ汎用 LINE_LIFF_ID にフォールバックする", () => {
  withLiffEnv({ LINE_LIFF_ID: "9999999999-generic" }, () => {
    const url = buildProjectsListLiffUrl();
    assert.equal(url, "https://liff.line.me/9999999999-generic/projects");
  });
});
