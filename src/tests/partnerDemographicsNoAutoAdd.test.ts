/**
 * 性年代設問（__partner_gender__ / __partner_age__）を**自動付与しない**ことのテスト。
 *
 * ## 背景（実際に起きていた事故）
 * パートナー案件の作成・更新・公開・割り当ての4箇所で `ensureDemographicQuestions()`
 * を呼び、性別・年代の固定2問を必ず差し込んでいた。聞きたい属性は案件ごとに普通の
 * 設問として入れる運用になったため、自動付与すると「性別を教えてください」が2問並び、
 * **回答者に同じことを二度聞く**（実案件で発生）。commit 332834e で4箇所すべてを削除した。
 *
 * ## なぜこのテストが必要か
 * 332834e は本体から呼び出しを消したが、「もう自動付与しない」ことを assert する
 * テストが1件も無かった。さらにテスト側には当時のスキャフォールド（この関数の
 * 書き込みを無害化するスタブ）が残っている。つまり**自動付与が戻っても全スイート緑で
 * 素通りする**状態だった。削除は「消えたまま」を守らないと意味がないので、
 * 呼び出しの再導入をソースレベルで検出する。
 *
 * ## 方式
 * 挙動テスト（実際に案件を作って設問数を数える）は Supabase への書き込みが必要で、
 * 本番DBを叩くため取れない。ここでは**再導入されうる4箇所の本体ソースに
 * `ensureDemographicQuestions` の定義・呼び出しが無いこと**を検証する。
 * 予約コード自体（RESERVED_QUESTION_CODES）は廃止していない——運営が管理画面で
 * 入れた性年代設問を識別するために残る——ので、予約コードの存在は禁止しない。
 *
 * ファイル読み取りのみ・ネットワーク無し。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/** 332434e で呼び出しを削除した本体ファイル（再導入を見張る対象）。 */
const GUARDED_SOURCES = [
  "../services/partnerSurveyService.ts",
  "../services/partnerAssignmentService.ts"
];

function readSource(relative: string): string {
  return readFileSync(path.join(__dirname, relative), "utf8");
}

/** 行コメント・ブロックコメントを落とす（コメント中の言及で誤検知しないように）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

for (const relative of GUARDED_SOURCES) {
  test(`★${path.basename(relative)} は ensureDemographicQuestions を持たない（自動付与の再導入を禁止）`, () => {
    const code = stripComments(readSource(relative));
    assert.ok(
      !code.includes("ensureDemographicQuestions"),
      `${relative} に ensureDemographicQuestions が復活している。` +
        "性年代の固定2問を自動付与すると、案件が普通の設問として持つ性別・年代と二重になり、" +
        "回答者に同じことを二度聞くことになる（commit 332834e で廃止）。"
    );
  });
}

test("★性年代の固定2問を作成する経路が本体に存在しない", () => {
  // 関数名を変えて復活させられた場合の網。予約コードを **書き込む** 形
  // （question_code に固定値を入れて insert する）を本体から検出する。
  for (const relative of GUARDED_SOURCES) {
    const code = stripComments(readSource(relative));
    for (const reserved of ["__partner_gender__", "__partner_age__"]) {
      assert.ok(
        !code.includes(reserved),
        `${relative} が予約コード ${reserved} を直接扱っている。` +
          "固定2問の生成が別名で復活していないか確認する。"
      );
    }
  }
});

test("予約コードの定義自体は残っている（識別用なので廃止しない）", () => {
  // 自動付与はしないが、運営が管理画面で入れた性年代設問を
  // パートナー設問と識別する用途で予約コードは使い続ける。
  const lib = readSource("../lib/partnerDemographics.ts");
  assert.ok(
    lib.includes("RESERVED_QUESTION_CODES"),
    "RESERVED_QUESTION_CODES が消えている。識別用途で必要。"
  );
});
