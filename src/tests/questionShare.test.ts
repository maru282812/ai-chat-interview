/**
 * questionShare（店舗への申し送り開示判定）のユニットテスト。
 *
 * 利用規約 第9条3項（migration 102）の3つの限定が、コードで強制されていることを検証する:
 *   1. 既定は共有しない（オプトイン）
 *   2. notice（回答画面での事前明示）が無ければ共有しない
 *   3. 同意より前の回答は開示対象にしない（利用目的の追加は遡及しない）
 *
 * 純関数のみ・ネットワーク無し。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCoveredByConsent,
  isFreeTextQuestion,
  isShareVisibleNow,
  readShareConfig,
  resolveShareDecision,
  selectShareableQuestions
} from "../lib/questionShare";
import { stripStoreDisclosureOnCopy } from "../repositories/projectRepository";
import type { Question, QuestionType } from "../types/domain";

/** テスト用の最小 Question を作る。 */
function q(
  overrides: {
    code?: string;
    type?: QuestionType;
    share?: Record<string, unknown> | null;
  } = {}
): Question {
  const meta = overrides.share === null ? {} : { share_with_store: overrides.share };
  return {
    id: `id-${overrides.code ?? "Q1"}`,
    project_id: "p1",
    question_code: overrides.code ?? "Q1",
    question_text: "本文",
    question_role: "main",
    question_type: overrides.type ?? "free_text_long",
    is_required: false,
    sort_order: 1,
    question_config: { meta },
    ai_probe_enabled: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z"
  } as unknown as Question;
}

const NOTICE = "この設問のみ担当者が施術前に確認いたします。";

// ── 1. 既定は共有しない ────────────────────────────────────────────────────

test("S1: share_with_store 未設定なら共有しない（既定はオプトイン）", () => {
  const d = resolveShareDecision(q({ share: null }));
  assert.equal(d.shared, false);
  assert.equal(d.shared === false && d.reason, "not_enabled");
});

test("S2: enabled=false なら共有しない", () => {
  const d = resolveShareDecision(q({ share: { enabled: false, notice: NOTICE } }));
  assert.equal(d.shared, false);
  assert.equal(d.shared === false && d.reason, "not_enabled");
});

test("S3: enabled が真偽値でない値（'true' 文字列）でも共有しない", () => {
  const d = resolveShareDecision(q({ share: { enabled: "true", notice: NOTICE } }));
  assert.equal(d.shared, false);
});

// ── 2. notice が無ければ共有しない（規約 第9条3項の「あらかじめ明示」） ────

test("S4: enabled=true でも notice が無ければ共有しない", () => {
  const d = resolveShareDecision(q({ share: { enabled: true } }));
  assert.equal(d.shared, false);
  assert.equal(d.shared === false && d.reason, "missing_notice");
});

test("S5: notice が空白のみでも共有しない", () => {
  const d = resolveShareDecision(q({ share: { enabled: true, notice: "   " } }));
  assert.equal(d.shared, false);
  assert.equal(d.shared === false && d.reason, "missing_notice");
});

test("S6: enabled=true かつ notice ありなら共有可", () => {
  const d = resolveShareDecision(
    q({ share: { enabled: true, notice: NOTICE, mode: "verbatim", timing: "immediate" } })
  );
  assert.equal(d.shared, true);
  assert.equal(d.shared === true && d.mode, "verbatim");
  assert.equal(d.shared === true && d.timing, "immediate");
  assert.equal(d.shared === true && d.notice, NOTICE);
});

// ── 3. 既定値は安全側 ──────────────────────────────────────────────────────

test("S7: mode 未指定の既定は aggregate（原文を出さない側）", () => {
  const d = resolveShareDecision(q({ share: { enabled: true, notice: NOTICE } }));
  assert.equal(d.shared === true && d.mode, "aggregate");
});

test("S8: timing 未指定の既定は on_close（即時公開しない側）", () => {
  const d = resolveShareDecision(q({ share: { enabled: true, notice: NOTICE } }));
  assert.equal(d.shared === true && d.timing, "on_close");
});

test("S9: image_upload の原文開示は許さない", () => {
  const d = resolveShareDecision(
    q({ type: "image_upload", share: { enabled: true, notice: NOTICE, mode: "verbatim" } })
  );
  assert.equal(d.shared, false);
  assert.equal(d.shared === false && d.reason, "type_not_allowed");
});

// ── 4. timing による出し分け ───────────────────────────────────────────────

test("S10: timing=on_close は公開中には出さない", () => {
  const d = resolveShareDecision(
    q({ share: { enabled: true, notice: NOTICE, timing: "on_close" } })
  );
  assert.equal(isShareVisibleNow(d, "published"), false);
  assert.equal(isShareVisibleNow(d, "closed"), true);
});

test("S11: timing=immediate は公開中から出す", () => {
  const d = resolveShareDecision(
    q({ share: { enabled: true, notice: NOTICE, timing: "immediate" } })
  );
  assert.equal(isShareVisibleNow(d, "published"), true);
});

// ── 5. ホワイトリスト選抜 ─────────────────────────────────────────────────

test("S12: 共有対象の設問だけを選び出す（他は必ず落ちる）", () => {
  const questions = [
    q({ code: "Q1", share: null }),
    q({ code: "Q2", share: { enabled: true } }), // notice 無し
    q({
      code: "Q12",
      type: "single_choice",
      share: { enabled: true, notice: NOTICE, mode: "aggregate", timing: "immediate" }
    }),
    q({
      code: "Q13",
      share: { enabled: true, notice: NOTICE, mode: "verbatim", timing: "immediate" }
    })
  ];
  const selected = selectShareableQuestions(questions, "published");
  assert.deepEqual(
    selected.map((s) => s.question.question_code),
    ["Q12", "Q13"]
  );
});

test("S13: 空配列でも落ちない", () => {
  assert.deepEqual(selectShareableQuestions([], "published"), []);
});

// ── 6. 同意の遡及禁止 ─────────────────────────────────────────────────────

test("S14: 同意より前の回答は開示対象にしない（利用目的の追加は遡及しない）", () => {
  const consented = "2026-09-09T00:00:00.000Z";
  assert.equal(isCoveredByConsent(consented, "2026-09-10T00:00:00.000Z"), true);
  assert.equal(isCoveredByConsent(consented, "2026-09-08T00:00:00.000Z"), false);
});

test("S15: 未同意なら開示対象にしない", () => {
  assert.equal(isCoveredByConsent(null, "2026-09-10T00:00:00.000Z"), false);
  assert.equal(isCoveredByConsent(undefined, "2026-09-10T00:00:00.000Z"), false);
});

test("S16: 日時が壊れていたら開示対象にしない（fail-closed）", () => {
  assert.equal(isCoveredByConsent("not-a-date", "2026-09-10T00:00:00.000Z"), false);
  assert.equal(isCoveredByConsent("2026-09-09T00:00:00.000Z", "not-a-date"), false);
});

// ── 7. 壊れた設定に耐える ─────────────────────────────────────────────────

test("S17: share_with_store が配列/文字列でも落ちず、共有しない", () => {
  assert.equal(readShareConfig(q({ share: [] as unknown as Record<string, unknown> })), null);
  assert.equal(
    readShareConfig(q({ share: "yes" as unknown as Record<string, unknown> })),
    null
  );
  assert.equal(resolveShareDecision(q({ share: [] as unknown as Record<string, unknown> })).shared, false);
});

test("S18: 自由記述型の判定（レビュー要否の振り分けに使う）", () => {
  assert.equal(isFreeTextQuestion("free_text_long"), true);
  assert.equal(isFreeTextQuestion("free_text_short"), true);
  assert.equal(isFreeTextQuestion("single_choice"), false);
});

// ── 8. 案件複製で開示フラグが伝播しないこと（事故防止の要） ────────────────

test("S19: 複製すると share_with_store は落ちる（他の meta は残る）", () => {
  const config = {
    options: [{ value: "a", label: "A" }],
    meta: {
      question_goal: "残るべき値",
      metric_code: "satisfaction",
      share_with_store: { enabled: true, notice: NOTICE, mode: "verbatim" }
    }
  } as unknown as Question["question_config"];

  const copied = stripStoreDisclosureOnCopy(config);

  assert.equal(copied?.meta?.share_with_store, undefined, "開示フラグは複製先に残ってはいけない");
  assert.equal(copied?.meta?.question_goal, "残るべき値");
  assert.equal(copied?.meta?.metric_code, "satisfaction");
  // 元オブジェクトを壊していないこと（複製元の設定は維持される）
  assert.ok(config?.meta?.share_with_store, "複製元の設定まで消してはいけない");
});

test("S20: meta が無い/null でも複製で落ちない", () => {
  assert.equal(stripStoreDisclosureOnCopy(null), null);
  const noMeta = { options: [] } as unknown as Question["question_config"];
  assert.deepEqual(stripStoreDisclosureOnCopy(noMeta), { options: [] });
});
