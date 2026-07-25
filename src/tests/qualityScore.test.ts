/**
 * qualityScore.test.ts
 *
 * 品質係数の本実装。判定ロジックと、単価比例の暴走を止める絶対キャップの契約を固定する。
 * 「ちゃんと答えれば満額（＋誠実ボーナス）／適当だと減る」が壊れていないことを守る。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_QUALITY_CONFIG,
  QUALITY_MAX,
  QUALITY_MIN,
  QUALITY_NEUTRAL,
  clampQuality,
  computeQualityBreakdown,
  computeQualityFactor,
  computeQualityWeightedAward,
  qualityWeightedPoints,
  resolveQualityConfig,
  type QualityScoringConfig,
} from "../lib/qualityScore";

/** 誠実ボーナスを切った素の設定（減点だけを見たいテスト用）。 */
const NO_BONUS: QualityScoringConfig = { ...DEFAULT_QUALITY_CONFIG, bonusHonest: 0 };

test("契約: clampQuality は [0, QUALITY_MAX] に収め、NaN は中立にフォールバック", () => {
  assert.equal(clampQuality(-0.5), QUALITY_MIN);
  assert.equal(clampQuality(99), QUALITY_MAX);
  assert.equal(clampQuality(0.42), 0.42);
  assert.equal(clampQuality(NaN), QUALITY_NEUTRAL);
});

test("シグナルが無ければ減点しない（計測漏れでユーザーが損をしない側に倒す）", () => {
  // 自由記述なし・時間未計測・選択1問だけ＝判定材料ゼロ
  assert.equal(computeQualityFactor({}, NO_BONUS), QUALITY_NEUTRAL);
  assert.equal(computeQualityFactor({ timeSec: null, text: null }, NO_BONUS), QUALITY_NEUTRAL);
});

test("速すぎる回答を検出する（設問数 × 最低秒数が基準）", () => {
  const answers = [
    { questionId: "q1", answerValue: "a" },
    { questionId: "q2", answerValue: "b" },
  ];
  // 最低 3秒/問 × 2問 = 6秒。2秒は速すぎ。
  const fast = computeQualityBreakdown({ answers, timeSec: 2 }, NO_BONUS);
  assert.ok(fast.reasons.includes("too_fast"));
  assert.ok(fast.factor < QUALITY_NEUTRAL);

  // 十分に時間をかけていれば減点しない
  const ok = computeQualityBreakdown({ answers, timeSec: 30 }, NO_BONUS);
  assert.ok(!ok.reasons.includes("too_fast"));
  assert.equal(ok.factor, QUALITY_NEUTRAL);
});

test("自由記述が短すぎる / 意味を成さない場合に減点する", () => {
  assert.ok(computeQualityBreakdown({ text: "あ" }, NO_BONUS).reasons.includes("too_short"));
  assert.ok(computeQualityBreakdown({ text: "ああああああああああ" }, NO_BONUS).reasons.includes("too_short"));
  assert.ok(computeQualityBreakdown({ text: "。。。。。。。。。。" }, NO_BONUS).reasons.includes("too_short"));

  // 中身のある回答は減点しない
  const good = computeQualityBreakdown(
    { text: "値段よりも使い心地を重視して選んでいます。" },
    NO_BONUS,
  );
  assert.deepEqual(good.reasons, []);
  assert.equal(good.factor, QUALITY_NEUTRAL);
});

test("選択肢コードは自由記述として誤判定しない", () => {
  // "opt_1" のような短い英数字コードは自由記述扱いしない＝短すぎ減点は出ない
  const r = computeQualityBreakdown(
    { answers: [{ questionId: "q1", answerValue: "opt_1" }] },
    NO_BONUS,
  );
  assert.ok(!r.reasons.includes("too_short"));
});

test("ストレートライン（3問以上で全て同一選択）を検出する", () => {
  const straight = computeQualityBreakdown(
    {
      answers: [
        { questionId: "q1", answerValue: "a" },
        { questionId: "q2", answerValue: "a" },
        { questionId: "q3", answerValue: "a" },
      ],
    },
    NO_BONUS,
  );
  assert.ok(straight.reasons.includes("straightline"));

  // 2問だけなら偶然の一致がありうるので検出しない
  const twoOnly = computeQualityBreakdown(
    {
      answers: [
        { questionId: "q1", answerValue: "a" },
        { questionId: "q2", answerValue: "a" },
      ],
    },
    NO_BONUS,
  );
  assert.ok(!twoOnly.reasons.includes("straightline"));

  // ばらけていれば検出しない
  const varied = computeQualityBreakdown(
    {
      answers: [
        { questionId: "q1", answerValue: "a" },
        { questionId: "q2", answerValue: "b" },
        { questionId: "q3", answerValue: "a" },
      ],
    },
    NO_BONUS,
  );
  assert.ok(!varied.reasons.includes("straightline"));
});

test("整合性スコアが低いと減点し、素材が無ければ判定しない", () => {
  const bad = computeQualityBreakdown({ consistency: 0.1 }, NO_BONUS);
  assert.ok(bad.reasons.includes("inconsistent"));

  // consistency 未指定＝素材なし（新規ユーザー等）＝減点しない
  const none = computeQualityBreakdown({}, NO_BONUS);
  assert.ok(!none.reasons.includes("inconsistent"));
});

test("誠実ボーナス: 違反ゼロなら 1.0 を超える（構想どおり上振れする）", () => {
  const r = computeQualityBreakdown({ text: "毎朝ヨーグルトと一緒に食べています。" });
  assert.ok(r.reasons.includes("honest_bonus"));
  assert.ok(r.factor > QUALITY_NEUTRAL);

  // 違反が1つでもあればボーナスは付かない
  const withViolation = computeQualityBreakdown({ text: "あ" });
  assert.ok(!withViolation.reasons.includes("honest_bonus"));
});

test("誠実ボーナス: 整合性の素材があるのにスコアが低ければ付かない", () => {
  const r = computeQualityBreakdown({ text: "きちんと書いた回答です。", consistency: 0.5 });
  assert.ok(!r.reasons.includes("honest_bonus"));
  assert.equal(r.factor, QUALITY_NEUTRAL); // 減点閾値(0.4)は下回らないので中立
});

// --- 単価比例の暴走を止める絶対キャップ（この機能の要） ---

test("キャップ: 高単価案件が罰ゲーム化しない（500pt でも減点は上限まで）", () => {
  const answers = [
    { questionId: "q1", answerValue: "a" },
    { questionId: "q2", answerValue: "a" },
    { questionId: "q3", answerValue: "a" },
  ];
  // 速すぎ＋ストレートライン＝係数 0.5。乗算だけなら 500 → 250pt（-250pt の罰）。
  const r = computeQualityWeightedAward(500, { answers, timeSec: 1 });
  assert.ok(r.factor < QUALITY_NEUTRAL);
  assert.equal(r.points, 500 - DEFAULT_QUALITY_CONFIG.maxPenaltyPoints);
  assert.equal(r.isFullAmount, false);
});

test("キャップ: 高単価でもボーナスは上限まで（青天井にしない）", () => {
  const r = computeQualityWeightedAward(500, { text: "具体的に書いた誠実な回答です。" });
  assert.ok(r.factor > QUALITY_NEUTRAL);
  assert.equal(r.points, 500 + DEFAULT_QUALITY_CONFIG.maxBonusPoints);
  assert.equal(r.isFullAmount, true);
});

test("低単価（ついでスワイプ）は常に満額＝真値の素材を削らない", () => {
  const answers = [
    { questionId: "q1", answerValue: "a" },
    { questionId: "q2", answerValue: "a" },
    { questionId: "q3", answerValue: "a" },
  ];
  const r = computeQualityWeightedAward(1, { answers, timeSec: 0 });
  assert.equal(r.points, 1);
  assert.equal(r.isFullAmount, true);
  assert.deepEqual(r.reasons, []);
});

test("中単価（デイリー）は係数がそのまま効く", () => {
  const answers = [
    { questionId: "q1", answerValue: "a" },
    { questionId: "q2", answerValue: "a" },
    { questionId: "q3", answerValue: "a" },
  ];
  // 15pt・速すぎ(-0.3)＋ストレートライン(-0.2)＝係数≒0.5 → 減点はキャップ(30pt)に当たらず係数がそのまま効く
  const r = computeQualityWeightedAward(15, { answers, timeSec: 1 });
  assert.equal(r.points, Math.round(15 * r.factor));
  assert.ok(r.points < 15 && r.points > 0);
  assert.equal(r.isFullAmount, false);
});

test("契約: 付与ポイントは負にならず整数、enabled=false なら常に満額", () => {
  assert.equal(qualityWeightedPoints(-10, {}), 0);
  assert.equal(Number.isInteger(qualityWeightedPoints(14.6, {})), true);

  const off: QualityScoringConfig = { ...DEFAULT_QUALITY_CONFIG, enabled: false };
  const r = computeQualityWeightedAward(500, { text: "あ", timeSec: 0 }, off);
  assert.equal(r.points, 500);
  assert.equal(r.factor, QUALITY_NEUTRAL);
});

test("契約: 減点が重なっても 0pt を下回らず、floor は 0 で止まる", () => {
  const harsh: QualityScoringConfig = {
    ...DEFAULT_QUALITY_CONFIG,
    maxPenaltyPoints: 1000,
    minBaseForPenalty: 0,
  };
  const answers = [
    { questionId: "q1", answerValue: "a" },
    { questionId: "q2", answerValue: "a" },
    { questionId: "q3", answerValue: "a" },
  ];
  const r = computeQualityWeightedAward(10, { answers, timeSec: 0, text: "あ", consistency: 0 }, harsh);
  assert.ok(r.points >= 0);
});

// --- 設定の解決（管理画面の誤入力で付与が壊れないこと） ---

test("resolveQualityConfig: 未設定はコード既定にフォールバックする", () => {
  assert.deepEqual(resolveQualityConfig({}), DEFAULT_QUALITY_CONFIG);
  assert.deepEqual(resolveQualityConfig(null), DEFAULT_QUALITY_CONFIG);
  assert.deepEqual(resolveQualityConfig("こわれた値"), DEFAULT_QUALITY_CONFIG);
});

test("resolveQualityConfig: 範囲外は丸め、型不一致は既定に落とす", () => {
  const r = resolveQualityConfig({
    minSecondsPerQuestion: -5,          // 下限 0 へ
    penaltyTooFast: 99,                 // 上限 1 へ
    bonusHonest: 5,                     // QUALITY_MAX-1 へ
    minTextLength: "８",                // 型不一致＝既定
    enabled: "yes",                     // 型不一致＝既定(true)
    detectStraightlining: false,        // 正しい bool は通す
    unknownKey: 123,                    // 未知キーは無視
  });
  assert.equal(r.minSecondsPerQuestion, 0);
  assert.equal(r.penaltyTooFast, 1);
  assert.equal(r.bonusHonest, QUALITY_MAX - 1);
  assert.equal(r.minTextLength, DEFAULT_QUALITY_CONFIG.minTextLength);
  assert.equal(r.enabled, DEFAULT_QUALITY_CONFIG.enabled);
  assert.equal(r.detectStraightlining, false);
  assert.equal("unknownKey" in r, false);
});

test("resolveQualityConfig: 保存→再解決で値が変わらない（往復安定）", () => {
  const saved = resolveQualityConfig({ minSecondsPerQuestion: 5, maxPenaltyPoints: 50 });
  assert.deepEqual(resolveQualityConfig(saved as unknown), saved);
});
