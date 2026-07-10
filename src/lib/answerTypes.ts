/**
 * answerTypes.ts
 *
 * 新設問形式（migration 075）のサーバー権威ロジック（spec-answer-ui-patterns §API/新型）。
 *   - pairwise / ranking_top_n / point_allocation / image_heatmap
 *   - ペア生成（決定的・seed付き）と回答ペイロードのバリデーションを純関数で提供する。
 *
 * 保存形式は既存 answers 経路に載る JSON（answer_text に JSON 文字列で格納）。
 * ここでは「構造の妥当性」だけを検証し、DB アクセス・HTTP は行わない。
 */

import type { QuestionConfig, QuestionType } from "../types/domain";

// ------------------------------------------------------------------
// 決定的 PRNG（mulberry32）と文字列シード
// ------------------------------------------------------------------

/** 文字列から 32bit の安定シードを作る（同一 question_code → 同一シード＝再現性）。 */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------
// pairwise: ペア生成
// ------------------------------------------------------------------

export interface PairwisePlan {
  pairs: Array<[string, string]>;
  seed: number;
}

/** rounds のデフォルト = ceil(nC2 * 0.6)、上限 nC2、下限 1（n>=2 のとき）。 */
export function defaultPairwiseRounds(n: number): number {
  const total = (n * (n - 1)) / 2;
  if (total <= 0) return 0;
  return Math.min(total, Math.max(1, Math.ceil(total * 0.6)));
}

/**
 * 選択肢 value 群から重複しないペアを rounds 回ぶん、決定的に生成する。
 * seed 未指定時は seedFromString(seedKey) を用いる（同一設問→同一ペア列＝再現性）。
 */
export function generatePairwisePairs(
  optionValues: string[],
  rounds?: number,
  seedKey = "pairwise",
): PairwisePlan {
  const seed = seedFromString(seedKey);
  const n = optionValues.length;
  const all: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      all.push([optionValues[i]!, optionValues[j]!]);
    }
  }
  // 決定的シャッフル（Fisher-Yates + mulberry32）
  const rng = mulberry32(seed);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = all[i]!;
    all[i] = all[j]!;
    all[j] = tmp;
  }
  const want = rounds && rounds > 0 ? Math.min(rounds, all.length) : defaultPairwiseRounds(n);
  return { pairs: all.slice(0, want), seed };
}

// ------------------------------------------------------------------
// バリデーション
// ------------------------------------------------------------------

export type ValidationResult = { ok: true } | { ok: false; error: string };

const ok: ValidationResult = { ok: true };
const fail = (error: string): ValidationResult => ({ ok: false, error });

function optionValueSet(config: QuestionConfig | null): Set<string> {
  return new Set((config?.options ?? []).map((o) => String(o.value)));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** pairwise: { duels: [{left,right,winner}] }。winner は left/right のいずれか・code は実在。 */
export function validatePairwise(
  value: unknown,
  config: QuestionConfig | null,
  expectedRounds?: number,
): ValidationResult {
  if (!isPlainObject(value) || !Array.isArray(value.duels)) {
    return fail("pairwise: duels 配列が必要です。");
  }
  const codes = optionValueSet(config);
  if (typeof expectedRounds === "number" && value.duels.length !== expectedRounds) {
    return fail(`pairwise: 対戦数が想定(${expectedRounds})と一致しません。`);
  }
  for (const d of value.duels) {
    if (!isPlainObject(d)) return fail("pairwise: duel の形式が不正です。");
    const left = String(d.left ?? "");
    const right = String(d.right ?? "");
    const winner = String(d.winner ?? "");
    if (!codes.has(left) || !codes.has(right)) return fail("pairwise: 実在しない選択肢が含まれます。");
    if (left === right) return fail("pairwise: 同一選択肢同士の対戦は不正です。");
    if (winner !== left && winner !== right) return fail("pairwise: winner は left/right のいずれかである必要があります。");
  }
  return ok;
}

/** ranking_top_n: { ranked: string[] }。長さ===top_n・重複なし・実在 code。 */
export function validateRankingTopN(
  value: unknown,
  config: QuestionConfig | null,
  topN: number,
): ValidationResult {
  if (!isPlainObject(value) || !Array.isArray(value.ranked)) {
    return fail("ranking_top_n: ranked 配列が必要です。");
  }
  const ranked = value.ranked.map((v) => String(v));
  if (ranked.length !== topN) return fail(`ranking_top_n: ${topN} 件を順位付けしてください。`);
  if (new Set(ranked).size !== ranked.length) return fail("ranking_top_n: 同じ選択肢が重複しています。");
  const codes = optionValueSet(config);
  if (!ranked.every((c) => codes.has(c))) return fail("ranking_top_n: 実在しない選択肢が含まれます。");
  return ok;
}

/** point_allocation: { allocations: Record<code, number> }。全 key 実在・0以上の整数・合計===total。 */
export function validatePointAllocation(
  value: unknown,
  config: QuestionConfig | null,
  total: number,
): ValidationResult {
  if (!isPlainObject(value) || !isPlainObject(value.allocations)) {
    return fail("point_allocation: allocations が必要です。");
  }
  const codes = optionValueSet(config);
  let sum = 0;
  for (const [key, raw] of Object.entries(value.allocations)) {
    if (!codes.has(key)) return fail("point_allocation: 実在しない選択肢が含まれます。");
    if (!isInteger(raw) || raw < 0) return fail("point_allocation: 配分は0以上の整数で指定してください。");
    sum += raw;
  }
  if (sum !== total) return fail(`point_allocation: 配分の合計が ${total} になっていません（現在 ${sum}）。`);
  return ok;
}

/** image_heatmap: { taps: [{x,y}] }。x,y は 0〜1・件数は 1〜max_taps。 */
export function validateImageHeatmap(value: unknown, maxTaps: number): ValidationResult {
  if (!isPlainObject(value) || !Array.isArray(value.taps)) {
    return fail("image_heatmap: taps 配列が必要です。");
  }
  if (value.taps.length < 1) return fail("image_heatmap: 1点以上タップしてください。");
  if (value.taps.length > maxTaps) return fail(`image_heatmap: タップは最大 ${maxTaps} 点までです。`);
  for (const t of value.taps) {
    if (!isPlainObject(t)) return fail("image_heatmap: tap の形式が不正です。");
    const x = t.x;
    const y = t.y;
    if (typeof x !== "number" || typeof y !== "number") return fail("image_heatmap: 座標は数値で指定してください。");
    if (x < 0 || x > 1 || y < 0 || y > 1) return fail("image_heatmap: 座標は 0〜1 の相対値で指定してください。");
  }
  return ok;
}

/** 新設問形式の一覧。 */
export const NEW_ANSWER_TYPES: QuestionType[] = [
  "pairwise",
  "ranking_top_n",
  "point_allocation",
  "image_heatmap",
];

export function isNewAnswerType(t: QuestionType): boolean {
  return NEW_ANSWER_TYPES.includes(t);
}

/**
 * 新設問形式の回答（構造化 JSON）をまとめて検証する。
 * 既存型は対象外（呼び出し側で isNewAnswerType により分岐する想定）。
 */
export function validateNewTypeAnswer(
  questionType: QuestionType,
  config: QuestionConfig | null,
  value: unknown,
  opts?: { expectedRounds?: number },
): ValidationResult {
  switch (questionType) {
    case "pairwise":
      return validatePairwise(value, config, opts?.expectedRounds);
    case "ranking_top_n":
      return validateRankingTopN(value, config, config?.ranking?.top_n ?? 3);
    case "point_allocation":
      return validatePointAllocation(value, config, config?.allocation?.total ?? 100);
    case "image_heatmap":
      return validateImageHeatmap(value, config?.heatmap?.max_taps ?? 1);
    default:
      return ok;
  }
}
