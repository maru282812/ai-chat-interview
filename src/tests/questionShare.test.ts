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
  resolveDisclosureNotice,
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

test("★S4: 原文開示(verbatim)は notice が無ければ共有しない（規約 第9条5項）", () => {
  const d = resolveShareDecision(
    q({ type: "free_text_long", share: { enabled: true, mode: "verbatim" } })
  );
  assert.equal(d.shared, false);
  assert.equal(d.shared === false && d.reason, "missing_notice");
});

test("★S5: 原文開示は notice が空白のみでも共有しない", () => {
  const d = resolveShareDecision(
    q({ type: "free_text_long", share: { enabled: true, mode: "verbatim", notice: "   " } })
  );
  assert.equal(d.shared, false);
  assert.equal(d.shared === false && d.reason, "missing_notice");
});

test("S4b: 件数集計(aggregate)は notice が無くても共有できる（規約 第9条4項）", () => {
  // 4項は「統計化又は匿名加工したうえで」の提供なので事前明示を要さない。
  // ここを notice 必須にしていたせいで、店舗が締め切っても集計が1つも開かなかった。
  const d = resolveShareDecision(q({ share: { enabled: true } }));
  assert.equal(d.shared, true);
  assert.equal(d.shared && d.mode, "aggregate");
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

test("S13b: timing を落とさずに返す（店舗側の画面振り分けに使う）", () => {
  // 明示設定の immediate（＝申し送り）と、設定なし選択式の既定 on_close（＝締切後の集計）。
  // 両者を店舗側で分けられるよう、timing がそのまま出てくる必要がある。
  const questions = [
    q({
      code: "Q20",
      share: { enabled: true, notice: NOTICE, mode: "verbatim", timing: "immediate" }
    }),
    q({ code: "Q21", type: "single_choice", share: null })
  ];
  const selected = selectShareableQuestions(questions, "closed");
  assert.deepEqual(
    selected.map((s) => [s.question.question_code, s.timing]),
    [
      ["Q20", "immediate"],
      ["Q21", "on_close"]
    ]
  );
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

/**
 * 回答画面への告知（規約 第9条5項「回答画面上であらかじめ明示」）。
 *
 * ここが落ちるときは、**原文が店舗に出るのに回答者へ告知していない状態**に
 * なっている可能性がある。文言を変えるにしても、以下の性質は維持すること。
 */
test("開示しない設問には告知を出さない", () => {
  assert.equal(resolveDisclosureNotice(q({ share: null })), null);
  assert.equal(resolveDisclosureNotice(q({ share: { enabled: false, notice: NOTICE } })), null);
});

test("原文開示で notice が無ければ、開示もされず告知も出ない", () => {
  const question = q({ type: "free_text_long", share: { enabled: true, mode: "verbatim", notice: "  " } });
  assert.equal(resolveShareDecision(question).shared, false);
  assert.equal(resolveDisclosureNotice(question), null);
});

test("★開示する設問には必ず告知が出る（条文の要求）", () => {
  const d = resolveDisclosureNotice(q({ share: { enabled: true, notice: NOTICE } }));
  assert.ok(d, "開示するのに告知が無いのは規約 第9条5項を満たさない");
  assert.ok(d.label.length > 0, "固定文言が空だと『店舗に開示される旨』を伝えられない");
  assert.equal(d.notice, NOTICE, "設問ごとの補足はそのまま渡すこと");
});

test("★固定文言だけで『店舗に伝わる』と『名前は伝わらない』が言えている", () => {
  // notice を運営が書き損ねても、法的に要る部分は固定側で担保する設計
  for (const mode of ["aggregate", "verbatim"] as const) {
    const d = resolveDisclosureNotice(q({ share: { enabled: true, mode, notice: NOTICE } }));
    assert.ok(d);
    assert.ok(d.label.includes("お店に伝わります"), `${mode}: 開示される旨が必要`);
    assert.ok(d.label.includes("お名前は伝わりません"), `${mode}: 直接識別子を出さない旨`);
  }
});

test("原文開示は『そのまま伝わる』と明示する（件数集計より強く言う）", () => {
  const vb = resolveDisclosureNotice(
    q({ type: "free_text_long", share: { enabled: true, mode: "verbatim", notice: NOTICE } })
  );
  assert.ok(vb?.verbatim, "verbatim フラグが立つこと");
  assert.ok(vb.label.includes("そのまま"), "書いた内容がそのまま読まれることを省略しない");

  const agg = resolveDisclosureNotice(q({ share: { enabled: true, mode: "aggregate", notice: NOTICE } }));
  assert.equal(agg?.verbatim, false);
});

test("告知の判定は開示の判定と必ず一致する", () => {
  // ここがずれると「告知なしで開示」か「開示しないのに告知」のどちらかが起きる
  const cases = [
    { share: null },
    { share: { enabled: false, notice: NOTICE } },
    { share: { enabled: true, notice: "" } },
    { share: { enabled: true, notice: NOTICE } },
    { share: { enabled: true, mode: "verbatim" as const, notice: NOTICE } },
  ];
  for (const c of cases) {
    const question = q(c);
    const shared = resolveShareDecision(question).shared;
    const notice = resolveDisclosureNotice(question) !== null;
    assert.equal(notice, shared, `判定が食い違っている: ${JSON.stringify(c)}`);
  }
});

/**
 * 設定が無い設問の既定（規約 第9条4項の範囲だけを自動で開く）。
 *
 * ここが緩むと**運営が何も設定していない設問の回答が店舗に出る**。
 * 特に自由記述は、集計と称しても実質的に原文の列挙になるので既定では絶対に出さない。
 */
test("★既定: 選択式は件数集計として締切後に開く（4項・告知不要）", () => {
  const d = resolveShareDecision(q({ type: "single_choice", share: null }));
  assert.equal(d.shared, true, "設定が無くても選択式の件数は出せる（4項）");
  assert.equal(d.shared && d.mode, "aggregate");
  assert.equal(d.shared && d.timing, "on_close", "回収中は出さない（締めてから開く）");
});

test("★既定: 自由記述は開示しない（実質的に原文の列挙になるため）", () => {
  for (const type of ["text", "free_text_short", "free_text_long", "text_with_image"] as const) {
    const d = resolveShareDecision(q({ type, share: null }));
    assert.equal(d.shared, false, `${type} が既定で開示されている`);
  }
});

test("★既定: image_upload は開示しない", () => {
  assert.equal(resolveShareDecision(q({ type: "image_upload", share: null })).shared, false);
});

test("★enabled=false は既定より優先される（運営が切ったものは出さない）", () => {
  const d = resolveShareDecision(q({ type: "single_choice", share: { enabled: false } }));
  assert.equal(d.shared, false);
  assert.equal(d.shared === false && d.reason, "not_enabled");
});

test("既定で開いた集計には告知を出さない（本当に伝えたい告知を埋もれさせない）", () => {
  const question = q({ type: "single_choice", share: null });
  assert.equal(resolveShareDecision(question).shared, true, "開示はする");
  assert.equal(resolveDisclosureNotice(question), null, "が、告知は出さない（4項なので不要）");
});

test("運営が明示的に設定した集計には告知を出す", () => {
  const question = q({ share: { enabled: true, notice: NOTICE } });
  assert.ok(resolveDisclosureNotice(question), "設定した＝伝える意図があるので出す");
});
