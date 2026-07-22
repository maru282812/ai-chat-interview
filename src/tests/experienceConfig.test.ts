/**
 * experienceConfig.test.ts
 *
 * 若年層体験パック Phase 0 の体験設定解決（純関数）のテスト。
 * docs/spec-young-experience-pack.md「全体アーキテクチャ: 体験設定（Phase 0）」の
 * 決定順（プロジェクト上書き > 全体既定 > コード既定）と、未知キー無視・型不一致の破棄・
 * global 専用キーのプロジェクト上書き不可を検証する。DB は触らない。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ANONYMITY_NOTE_TEXT,
  EXPERIENCE_KEYS,
  EXPERIENCE_KEY_LIST,
  PROJECT_SCOPED_KEYS,
  coerceExperienceValue,
  isExperienceKey,
  resolveDefaultAnswerUiPreset,
  resolveExperience,
  sanitizeExperienceConfig,
} from "../lib/experienceConfig";

// ------------------------------------------------------------------
// コード内デフォルト
// ------------------------------------------------------------------

test("コード既定: 何も設定が無ければ EXPERIENCE_KEYS の default がそのまま返る", () => {
  const r = resolveExperience(null, null);
  for (const key of EXPERIENCE_KEY_LIST) {
    assert.equal(r[key], EXPERIENCE_KEYS[key].default, `key=${key}`);
  }
});

test("コード既定: 仕様書のフラグ一覧の既定値と一致する", () => {
  const r = resolveExperience({}, {});
  assert.equal(r.probe_skip_button, true);
  assert.equal(r.anonymity_note, true);
  assert.equal(r.anonymity_note_text, DEFAULT_ANONYMITY_NOTE_TEXT);
  assert.equal(r.completion_reward_display, true);
  assert.equal(r.rank_celebration_on_complete, true);
  assert.equal(r.probe_chat_persona, false);
  assert.equal(r.persona_name, "ヒビ");
  assert.equal(r.persona_icon, "🌱");
  assert.equal(r.writing_helper_chips, false);
  assert.equal(r.chat_progress, true);
  assert.equal(r.time_remaining, true);
  assert.equal(r.answer_distribution, false);
  assert.equal(r.voice_input, false);
  assert.equal(r.default_answer_ui_preset, "standard");
  assert.equal(r.haptics, true);
  assert.equal(r.quality_micro_feedback, false);
  assert.equal(r.survey_resume, true);
  assert.equal(r.referral_enabled, false);
  assert.equal(r.referral_bonus_points, 100);
  assert.equal(r.referral_bonus_points_invitee, 50);
  assert.equal(r.share_card_enabled, false);
  assert.equal(r.streak_freeze_enabled, false);
  assert.equal(r.streak_reminder_enabled, false);
  assert.equal(r.badge_toast, true);
  assert.equal(r.onboarding_swipe, false);
});

// ------------------------------------------------------------------
// 決定順: プロジェクト上書き > 全体既定 > コード既定
// ------------------------------------------------------------------

test("決定順: 全体既定がコード既定を上書きする", () => {
  const r = resolveExperience({}, { probe_skip_button: false, writing_helper_chips: true });
  assert.equal(r.probe_skip_button, false);
  assert.equal(r.writing_helper_chips, true);
  // 触っていないキーはコード既定のまま
  assert.equal(r.chat_progress, true);
});

test("決定順: プロジェクト上書きが全体既定に勝つ", () => {
  const r = resolveExperience({ probe_skip_button: true }, { probe_skip_button: false });
  assert.equal(r.probe_skip_button, true);
});

test("決定順: プロジェクトにキーが無ければ全体既定に従う（継承＝キーを書かない）", () => {
  const r = resolveExperience({}, { anonymity_note: false });
  assert.equal(r.anonymity_note, false);
});

test("決定順: 文字列キーも 上書き > 全体既定 > コード既定 の順で解決される", () => {
  assert.equal(resolveExperience({}, {}).anonymity_note_text, DEFAULT_ANONYMITY_NOTE_TEXT);
  assert.equal(
    resolveExperience({}, { anonymity_note_text: "全体の文言" }).anonymity_note_text,
    "全体の文言",
  );
  assert.equal(
    resolveExperience({ anonymity_note_text: "案件の文言" }, { anonymity_note_text: "全体の文言" })
      .anonymity_note_text,
    "案件の文言",
  );
});

test("決定順: 3 層が同時に効いても互いに干渉しない", () => {
  const r = resolveExperience(
    { chat_progress: false },
    { time_remaining: false, badge_toast: false },
  );
  assert.equal(r.chat_progress, false); // プロジェクト上書き
  assert.equal(r.time_remaining, false); // 全体既定
  assert.equal(r.badge_toast, false); // 全体既定（global 専用）
  assert.equal(r.probe_skip_button, true); // コード既定
});

// ------------------------------------------------------------------
// 未知キーの無視
// ------------------------------------------------------------------

test("未知キー: 全体既定・プロジェクト上書きのどちらにあっても結果に現れない", () => {
  const r = resolveExperience(
    { totally_unknown: true, __proto__mischief: 1 },
    { another_unknown: "x" },
  );
  assert.equal("totally_unknown" in r, false);
  assert.equal("another_unknown" in r, false);
  assert.deepEqual(Object.keys(r).sort(), [...EXPERIENCE_KEY_LIST].sort());
});

test("未知キー: 既知キーの解決を壊さない", () => {
  const r = resolveExperience({ unknown_a: 1 }, { unknown_b: 2, haptics: false });
  assert.equal(r.haptics, false);
});

test("isExperienceKey: 既知キーだけ true", () => {
  assert.equal(isExperienceKey("haptics"), true);
  assert.equal(isExperienceKey("nope"), false);
  assert.equal(isExperienceKey("toString"), false);
});

// ------------------------------------------------------------------
// 型不一致は捨てて次の層へ落ちる
// ------------------------------------------------------------------

test("型不一致: bool キーに文字列が入っていたら捨ててコード既定へ落ちる", () => {
  const r = resolveExperience({}, { probe_skip_button: "false", haptics: 0 });
  assert.equal(r.probe_skip_button, true);
  assert.equal(r.haptics, true);
});

test("型不一致: プロジェクト側が不正なら全体既定が残る（コード既定まで落ちない）", () => {
  const r = resolveExperience({ probe_skip_button: "yes" }, { probe_skip_button: false });
  assert.equal(r.probe_skip_button, false);
});

test("型不一致: string キーの空文字・空白のみは未設定扱い（継承）", () => {
  assert.equal(
    resolveExperience({ anonymity_note_text: "" }, { anonymity_note_text: "全体の文言" })
      .anonymity_note_text,
    "全体の文言",
  );
  assert.equal(
    resolveExperience({ anonymity_note_text: "   " }, {}).anonymity_note_text,
    DEFAULT_ANONYMITY_NOTE_TEXT,
  );
});

test("型不一致: string キーは前後の空白がトリムされる", () => {
  assert.equal(resolveExperience({}, { persona_name: "  ヒビ子  " }).persona_name, "ヒビ子");
});

test("型不一致: int キーは整数の number 以外を捨てる", () => {
  assert.equal(resolveExperience({}, { referral_bonus_points: "200" }).referral_bonus_points, 100);
  assert.equal(resolveExperience({}, { referral_bonus_points: 1.5 }).referral_bonus_points, 100);
  assert.equal(resolveExperience({}, { referral_bonus_points: Number.NaN }).referral_bonus_points, 100);
  assert.equal(resolveExperience({}, { referral_bonus_points: 200 }).referral_bonus_points, 200);
  assert.equal(resolveExperience({}, { referral_bonus_points: 0 }).referral_bonus_points, 0);
});

test("型不一致: enum キーは定義外の値を捨てる", () => {
  assert.equal(
    resolveExperience({}, { default_answer_ui_preset: "fancy" }).default_answer_ui_preset,
    "standard",
  );
  assert.equal(
    resolveExperience({}, { default_answer_ui_preset: "casual" }).default_answer_ui_preset,
    "casual",
  );
});

test("型不一致: 設定そのものが object でない場合はコード既定に落ちる", () => {
  for (const bad of [null, undefined, 42, "x", [1, 2, 3], true]) {
    const r = resolveExperience(bad, bad);
    assert.equal(r.probe_skip_button, true, `input=${String(bad)}`);
    assert.equal(r.referral_bonus_points, 100, `input=${String(bad)}`);
  }
});

// ------------------------------------------------------------------
// global 専用キーはプロジェクト上書き不可
// ------------------------------------------------------------------

test("scope: global 専用キーはプロジェクト上書きが効かない", () => {
  const globalOnly = EXPERIENCE_KEY_LIST.filter((k) => EXPERIENCE_KEYS[k].scope === "global");
  assert.ok(globalOnly.length > 0);
  assert.ok(globalOnly.includes("haptics"));
  assert.ok(globalOnly.includes("default_answer_ui_preset"));
  assert.ok(globalOnly.includes("referral_enabled"));

  // haptics: 全体既定 true のまま、プロジェクトが false を書いても無視される
  const r = resolveExperience({ haptics: false, onboarding_swipe: true }, {});
  assert.equal(r.haptics, true);
  assert.equal(r.onboarding_swipe, false);
});

test("scope: global 専用キーでもプロジェクトが同じ値を書いた場合に全体既定が勝つ", () => {
  const r = resolveExperience({ badge_toast: true }, { badge_toast: false });
  assert.equal(r.badge_toast, false);
});

test("scope: PROJECT_SCOPED_KEYS は project スコープのキーだけを列挙する", () => {
  for (const k of PROJECT_SCOPED_KEYS) {
    assert.equal(EXPERIENCE_KEYS[k].scope, "project", `key=${k}`);
  }
  assert.ok(PROJECT_SCOPED_KEYS.includes("probe_skip_button"));
  assert.ok(PROJECT_SCOPED_KEYS.includes("anonymity_note_text"));
  assert.equal(PROJECT_SCOPED_KEYS.includes("haptics" as never), false);
});

// ------------------------------------------------------------------
// 保存前サニタイズ
// ------------------------------------------------------------------

test("sanitize: 未知キー・型不一致を落とす", () => {
  const out = sanitizeExperienceConfig({
    probe_skip_button: false,
    unknown_key: true,
    referral_bonus_points: "300",
    persona_name: "ヒビ",
  });
  assert.deepEqual(out, { probe_skip_button: false, persona_name: "ヒビ" });
});

test("sanitize: scope='project' は global 専用キーを落とす", () => {
  const out = sanitizeExperienceConfig(
    { probe_skip_button: true, haptics: false, referral_enabled: true },
    "project",
  );
  assert.deepEqual(out, { probe_skip_button: true });
});

test("sanitize: 空の入力は空オブジェクト（＝全て継承）", () => {
  assert.deepEqual(sanitizeExperienceConfig({}, "project"), {});
  assert.deepEqual(sanitizeExperienceConfig(null, "project"), {});
});

test("sanitize 済みの値は resolveExperience でそのまま効く（往復）", () => {
  const saved = sanitizeExperienceConfig({ anonymity_note: false, haptics: false }, "project");
  const r = resolveExperience(saved, {});
  assert.equal(r.anonymity_note, false);
  assert.equal(r.haptics, true); // project スコープ外なので保存されていない
});

// ------------------------------------------------------------------
// coerce 単体 / C-3 実体化ヘルパ
// ------------------------------------------------------------------

test("coerceExperienceValue: 受理できない値は null", () => {
  assert.equal(coerceExperienceValue("haptics", true), true);
  assert.equal(coerceExperienceValue("haptics", "true"), null);
  assert.equal(coerceExperienceValue("persona_name", ""), null);
  assert.equal(coerceExperienceValue("referral_bonus_points", 10), 10);
  assert.equal(coerceExperienceValue("default_answer_ui_preset", "formal"), "formal");
  assert.equal(coerceExperienceValue("default_answer_ui_preset", "FORMAL"), null);
});

test("resolveDefaultAnswerUiPreset: 全体既定を answer_ui_preset の値として取り出す", () => {
  assert.equal(resolveDefaultAnswerUiPreset(null), "standard");
  assert.equal(resolveDefaultAnswerUiPreset({ default_answer_ui_preset: "casual" }), "casual");
  assert.equal(resolveDefaultAnswerUiPreset({ default_answer_ui_preset: "bogus" }), "standard");
});
