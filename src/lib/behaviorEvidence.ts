/**
 * behaviorEvidence.ts
 *
 * P13「行動証拠による顧客発見」の純関数群。
 * docs/要件定義_AIフロー作成_行動証拠による顧客発見_2026-07-27.md
 *
 * ここに置くもの:
 * - 調査仮説シートの正規化・必須検証（§6.2）
 * - research_goal に埋め込む P13 役割タグの解析（§6.3-e）
 * - 回答から証拠の確度を判定するルール（§6.5）
 * - GO / PIVOT / STOP 判定基準との突き合わせ（§6.6）
 *
 * ここに置かないもの:
 * - DB アクセス・AI 呼び出し（サービス層の仕事）
 * - GO / PIVOT / STOP の確定判断。**システムは判定しない**（§3-2）。
 *   このモジュールが返すのは「基準ごとの充足状況」までで、結論は運営者が出す。
 */

import type { ResearchHypothesis } from "../types/domain";

// ────────────────────────────────────────────────
// 1. 調査仮説シート（§6.2）
// ────────────────────────────────────────────────

/** 必須5項目。失敗条件を先に書かせるのが P13 の核なので stop_condition を外さない */
export const REQUIRED_HYPOTHESIS_FIELDS = [
  "segment",
  "scene",
  "problem_hypothesis",
  "current_method",
  "stop_condition",
] as const;

export type RequiredHypothesisField = (typeof REQUIRED_HYPOTHESIS_FIELDS)[number];

export const HYPOTHESIS_FIELD_LABELS: Record<RequiredHypothesisField, string> = {
  segment: "対象者（セグメント）",
  scene: "調べる業務・場面",
  problem_hypothesis: "課題仮説",
  current_method: "現行手段の仮説",
  stop_condition: "失敗条件",
};

/** 1項目あたりの上限。プロンプトに丸ごと差し込むため、暴走した長文を弾く */
const MAX_FIELD_LENGTH = 500;

export interface HypothesisValidationResult {
  ok: boolean;
  /** 未入力・空白のみだった必須項目 */
  missing: RequiredHypothesisField[];
  /** 上限超過の項目 */
  tooLong: RequiredHypothesisField[];
  /** ok のときだけ入る正規化済みの値 */
  value: ResearchHypothesis | null;
  /** 画面表示用のエラーメッセージ（ok なら null） */
  message: string | null;
}

function readString(source: Record<string, unknown>, key: string): string {
  const raw = source[key];
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * 入力を正規化し、必須5項目を検証する。
 * 失敗条件を入力せずに生成へ進めることは差し戻し条件（§10）なので、ここで確実に止める。
 */
export function validateResearchHypothesis(raw: unknown): HypothesisValidationResult {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const values: Record<RequiredHypothesisField, string> = {
    segment: readString(source, "segment"),
    scene: readString(source, "scene"),
    problem_hypothesis: readString(source, "problem_hypothesis"),
    current_method: readString(source, "current_method"),
    stop_condition: readString(source, "stop_condition"),
  };

  const missing = REQUIRED_HYPOTHESIS_FIELDS.filter((field) => values[field] === "");
  const tooLong = REQUIRED_HYPOTHESIS_FIELDS.filter(
    (field) => values[field].length > MAX_FIELD_LENGTH
  );

  if (missing.length > 0 || tooLong.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `未入力の必須項目があります: ${missing.map((f) => HYPOTHESIS_FIELD_LABELS[f]).join("・")}`
      );
    }
    if (tooLong.length > 0) {
      parts.push(
        `${tooLong.map((f) => HYPOTHESIS_FIELD_LABELS[f]).join("・")} が長すぎます（各${MAX_FIELD_LENGTH}文字まで）`
      );
    }
    return { ok: false, missing, tooLong, value: null, message: parts.join("。") };
  }

  const buyerRaw = readString(source, "buyer_is_user");
  const buyerIsUser: ResearchHypothesis["buyer_is_user"] =
    buyerRaw === "same" || buyerRaw === "different" ? buyerRaw : null;

  return {
    ok: true,
    missing: [],
    tooLong: [],
    message: null,
    value: {
      segment: values.segment,
      scene: values.scene,
      problem_hypothesis: values.problem_hypothesis,
      current_method: values.current_method,
      stop_condition: values.stop_condition,
      buyer_is_user: buyerIsUser,
    },
  };
}

/** 仮説シートをプロンプトへ渡す形（未入力の任意項目は「未回答」と明示する） */
export function describeBuyerIsUser(value: ResearchHypothesis["buyer_is_user"]): string {
  if (value === "same") return "利用者と購入者は同一";
  if (value === "different") return "利用者と購入者は別（決裁者が存在する）";
  return "未回答";
}

// ────────────────────────────────────────────────
// 2. P13 役割タグ（§6.3-e）
// ────────────────────────────────────────────────

/**
 * research_goal 先頭の `[P13:xxx]` タグ。
 * レポート（§6.6）と P16 素材出力（§6.7）が設問の役割を機械的に拾うための唯一の手掛かり。
 */
export const P13_ROLES = [
  "recent_behavior",
  "economic_value/frequency",
  "economic_value/time_loss",
  "economic_value/money_loss",
  "economic_value/satisfaction",
  "decision_maker",
  "past_attempt",
  "commitment",
  "screening",
] as const;

export type P13Role = (typeof P13_ROLES)[number];

/** 経済価値4要素（§6.2 目的2）。この4つが揃わなければ受け入れ条件を満たさない */
export const ECONOMIC_VALUE_ROLES: P13Role[] = [
  "economic_value/frequency",
  "economic_value/time_loss",
  "economic_value/money_loss",
  "economic_value/satisfaction",
];

const P13_TAG_PATTERN = /\[P13:([a-z_]+(?:\/[a-z_]+)?)\]/i;

/** research_goal から P13 役割タグを取り出す。タグ無し・未知タグは null */
export function parseP13Role(researchGoal: string | null | undefined): P13Role | null {
  if (!researchGoal) return null;
  const matched = P13_TAG_PATTERN.exec(researchGoal);
  if (!matched || !matched[1]) return null;
  const role = matched[1].toLowerCase();
  return (P13_ROLES as readonly string[]).includes(role) ? (role as P13Role) : null;
}

/** タグを取り除いた本文（管理画面で goal を読みやすく表示するため） */
export function stripP13Role(researchGoal: string | null | undefined): string {
  if (!researchGoal) return "";
  return researchGoal.replace(P13_TAG_PATTERN, "").trim();
}

export interface FlowP13Coverage {
  /** 役割タグが付いている設問数 */
  tagged: number;
  total: number;
  /** 見つかった役割の集合 */
  roles: P13Role[];
  /** 経済価値4要素のうち欠けているもの */
  missingEconomicValue: P13Role[];
  /** 直近の1回を再現する設問があるか */
  hasRecentBehavior: boolean;
  /** 購入に近い行動の要求があるか */
  hasCommitment: boolean;
}

/**
 * 生成されたフローが P13 構造を満たしているかを数える（§9 受け入れ条件の機械チェック）。
 * 判定は返さない。何が欠けているかを示すだけ。
 */
export function summarizeFlowP13Coverage(
  questions: Array<{ research_goal?: string | null }>
): FlowP13Coverage {
  const roles = new Set<P13Role>();
  let tagged = 0;
  for (const question of questions) {
    const role = parseP13Role(question.research_goal);
    if (role) {
      tagged += 1;
      roles.add(role);
    }
  }
  return {
    tagged,
    total: questions.length,
    roles: [...roles],
    missingEconomicValue: ECONOMIC_VALUE_ROLES.filter((role) => !roles.has(role)),
    hasRecentBehavior: roles.has("recent_behavior"),
    hasCommitment: roles.has("commitment"),
  };
}

// ────────────────────────────────────────────────
// 3. 証拠の確度（§6.5）
// ────────────────────────────────────────────────

/**
 * 対面観察が無い以上 `numeric` が上限。これを「実際に見た」と同等に扱わないことが
 * 本機能の誠実さの条件（§3-5）。レポートには必ずこの上限を明記する。
 */
export type EvidenceStrength = "statement_only" | "concrete_recall" | "numeric";

export const EVIDENCE_STRENGTH_LABELS: Record<EvidenceStrength, string> = {
  statement_only: "発言のみ",
  concrete_recall: "具体的再現",
  numeric: "数値あり",
};

/** 重み付け（§6.6 の採点で「行動と損失が確認できた問題」を優先するため） */
export const EVIDENCE_STRENGTH_WEIGHTS: Record<EvidenceStrength, number> = {
  statement_only: 0.3,
  concrete_recall: 0.7,
  numeric: 1,
};

/** 時間・金額・回数など、具体値が語られたことを示す表現 */
const NUMERIC_PATTERN =
  /(\d|[０-９]|一|二|三|四|五|六|七|八|九|十|百|千|万)\s*(円|万円|分|時間|時間半|日|週間|か月|ヶ月|カ月|月|年|回|人|件|%|％)/;

/** 「いつ」を特定できたことを示す表現。一般論との切り分けに使う */
const RECALL_PATTERN =
  /(昨日|一昨日|今朝|今週|先週|先々週|今月|先月|先々月|昨年|去年|一昨年|直近|この前|こないだ|先日|今年に入って|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*年|月曜|火曜|水曜|木曜|金曜|土曜|日曜)/;

/** 一般化された語り。これしか無ければ行動の証拠にならない */
const GENERALIZATION_PATTERN =
  /(いつも|普段|たいてい|だいたい|基本的に|毎回|一般的に|傾向として|ことが多い|ように思います|かなと思います)/;

/** 願望・意見。P13 では証拠として数えない */
const OPINION_PATTERN =
  /(あったら|あれば|欲しい|ほしい|といいな|いいと思|便利そう|使ってみたい|興味がある|必要だと思)/;

export interface EvidenceClassificationInput {
  /** 本設問の回答（自由記述含む） */
  answerText: string | null | undefined;
  /** AI深掘りで得られた追加の発言。ここに具体値が出ることが多い */
  probeTexts?: Array<string | null | undefined>;
}

export interface EvidenceClassification {
  strength: EvidenceStrength;
  /** 判定の根拠（レポートに出す。数字だけ出さないための材料） */
  signals: {
    hasNumeric: boolean;
    hasRecall: boolean;
    hasGeneralization: boolean;
    hasOpinionOnly: boolean;
  };
}

/**
 * 回答テキストから確度を分類する（MVP のルールベース）。
 *
 * 意図的に控えめに倒してある: 迷ったら弱い方（statement_only）に落とす。
 * 確度を高く見積もる誤りは「行動証拠が取れている」という誤った安心を生み、
 * この機能自体の検証（§8 Phase 2）を無意味にするため。
 */
export function classifyEvidenceStrength(
  input: EvidenceClassificationInput
): EvidenceClassification {
  const texts = [input.answerText, ...(input.probeTexts ?? [])]
    .map((text) => (typeof text === "string" ? text.trim() : ""))
    .filter((text) => text !== "");
  const joined = texts.join("\n");

  const signals = {
    hasNumeric: NUMERIC_PATTERN.test(joined),
    hasRecall: RECALL_PATTERN.test(joined),
    hasGeneralization: GENERALIZATION_PATTERN.test(joined),
    hasOpinionOnly: OPINION_PATTERN.test(joined),
  };

  if (joined === "") {
    return { strength: "statement_only", signals };
  }

  // 数値があっても「いつのことか」が無ければ一般論の平均値の可能性が高い。
  // 具体的再現とセットで初めて numeric とみなす。
  if (signals.hasNumeric && signals.hasRecall) {
    return { strength: "numeric", signals };
  }
  if (signals.hasRecall) {
    return { strength: "concrete_recall", signals };
  }
  return { strength: "statement_only", signals };
}

// ────────────────────────────────────────────────
// 4. GO / PIVOT / STOP 基準との突き合わせ（§6.6）
// ────────────────────────────────────────────────

export type CriterionStatus = "met" | "unmet" | "unknown";

export type CriterionGroup = "go" | "stop" | "pivot";

export interface CriterionResult {
  key: string;
  group: CriterionGroup;
  label: string;
  status: CriterionStatus;
  /** 判定の根拠となった数値・事実。「7/7」だけを出さないための材料（§6.6） */
  detail: string;
}

export interface JudgementInput {
  /** 同一セグメントで回答が完了した人数 */
  respondentCount: number;
  /** 確度別の人数（重複しない。1人につき最も高い確度で数える） */
  strengthCounts: Record<EvidenceStrength, number>;
  /** 経済価値: 時間損失を数値で答えた人数 */
  timeLossReportedCount: number;
  /** 経済価値: 金銭損失・現行支出を数値で答えた人数 */
  moneyLossReportedCount: number;
  /** 現行手段に「満足」と答えた人数 */
  satisfiedWithCurrentCount: number;
  /** 「次にいつ起きるか」を答えられた人数 */
  nextOccurrenceKnownCount: number;
  /** 購入に近い行動を承諾した人数（追加ヒアリング / 資料提供 / 決裁者紹介のいずれか） */
  commitmentCount: number;
  /** 経済価値4要素の設問がフローに揃っているか */
  economicValueComplete: boolean;
}

/** GO 系の基準に使う人数の下限（P13 運用基準: 同一セグメント5〜10人） */
export const MIN_SEGMENT_RESPONDENTS = 5;

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function fmtRatio(part: number, whole: number): string {
  if (whole <= 0) return "回答なし";
  return `${part}/${whole}人（${Math.round(ratio(part, whole) * 100)}%）`;
}

/**
 * 判定基準ごとの充足状況を返す。
 *
 * **GO / PIVOT / STOP そのものは返さない。** 返すのは基準ごとの met / unmet / unknown と、
 * その根拠だけ。結論は運営者が出す（§3-2・§10「システムが『GOです』と断定表現でレポートする」は差し戻し）。
 *
 * 母数が足りないときに unmet ではなく unknown を返すのが重要。
 * 「まだ分からない」を「基準を満たさなかった」と混同すると、
 * 3人しか聞いていない段階で STOP 判断に誘導してしまう。
 */
export function evaluateJudgementCriteria(input: JudgementInput): CriterionResult[] {
  const total = input.respondentCount;
  const enough = total >= MIN_SEGMENT_RESPONDENTS;
  const concrete =
    input.strengthCounts.concrete_recall + input.strengthCounts.numeric;
  const results: CriterionResult[] = [];

  // ── GO 系 ─────────────────────────────────────
  results.push({
    key: "sample_size",
    group: "go",
    label: `同一セグメントで${MIN_SEGMENT_RESPONDENTS}〜10人に聞けたか`,
    status: enough ? "met" : "unmet",
    detail: `回答完了 ${total}人（基準: ${MIN_SEGMENT_RESPONDENTS}人以上）`,
  });

  results.push({
    key: "concrete_example",
    group: "go",
    label: "直近の具体例が確認できたか",
    status: !enough ? "unknown" : ratio(concrete, total) >= 0.5 ? "met" : "unmet",
    detail: `具体的再現以上 ${fmtRatio(concrete, total)}（うち数値あり ${input.strengthCounts.numeric}人）`,
  });

  results.push({
    key: "currently_spending",
    group: "go",
    label: "現在、時間・人手・金を使って対処しているか",
    status: !enough
      ? "unknown"
      : ratio(input.timeLossReportedCount + input.moneyLossReportedCount, total * 2) >= 0.5
        ? "met"
        : "unmet",
    detail: `時間損失を数値で回答 ${fmtRatio(input.timeLossReportedCount, total)} / 金銭・支出を数値で回答 ${fmtRatio(input.moneyLossReportedCount, total)}`,
  });

  results.push({
    key: "next_occurrence",
    group: "go",
    label: "次に問題が起きる時期が分かるか",
    status: !enough
      ? "unknown"
      : ratio(input.nextOccurrenceKnownCount, total) >= 0.5
        ? "met"
        : "unmet",
    detail: `次回時期を答えられた ${fmtRatio(input.nextOccurrenceKnownCount, total)}`,
  });

  results.push({
    key: "commitment",
    group: "go",
    label: "購入に近い行動（追加ヒアリング・資料提供・決裁者紹介）を獲得できたか",
    status: input.commitmentCount > 0 ? "met" : enough ? "unmet" : "unknown",
    detail: `承諾 ${fmtRatio(input.commitmentCount, total)}`,
  });

  // ── STOP 系（met = STOP 該当。「該当してしまっている」ことを意味する） ──
  results.push({
    key: "stop_no_behavior",
    group: "stop",
    label: "課題が具体的行動として確認できない（発言のみに留まる）",
    status: !enough
      ? "unknown"
      : ratio(input.strengthCounts.statement_only, total) > 0.5
        ? "met"
        : "unmet",
    detail: `発言のみ ${fmtRatio(input.strengthCounts.statement_only, total)}`,
  });

  results.push({
    key: "stop_no_loss",
    group: "stop",
    label: "損失が確認できない（時間も金銭も出てこない）",
    status: !enough
      ? "unknown"
      : input.timeLossReportedCount === 0 && input.moneyLossReportedCount === 0
        ? "met"
        : "unmet",
    detail: `時間損失の回答 ${input.timeLossReportedCount}人 / 金銭損失の回答 ${input.moneyLossReportedCount}人`,
  });

  results.push({
    key: "stop_no_free_cooperation",
    group: "stop",
    label: "無料でもテスト協力が得られない",
    status: !enough ? "unknown" : input.commitmentCount === 0 ? "met" : "unmet",
    detail: `協力承諾 ${fmtRatio(input.commitmentCount, total)}`,
  });

  // ── PIVOT 系（met = PIVOT 検討の材料あり） ──
  results.push({
    key: "pivot_satisfied",
    group: "pivot",
    label: "現行手段に満足している（乗り換え動機が薄い）",
    status: !enough
      ? "unknown"
      : ratio(input.satisfiedWithCurrentCount, total) >= 0.5
        ? "met"
        : "unmet",
    detail: `現行手段に満足 ${fmtRatio(input.satisfiedWithCurrentCount, total)}`,
  });

  results.push({
    key: "pivot_measurement_gap",
    group: "pivot",
    label: "経済価値4要素が設問として揃っていない（設計側の不足）",
    status: input.economicValueComplete ? "unmet" : "met",
    detail: input.economicValueComplete
      ? "頻度・時間損失・金銭損失・満足度の4設問すべてがフローに存在する"
      : "経済価値の設問が欠けているため、損失の大きさを判断できない",
  });

  return results;
}

export interface JudgementSummary {
  criteria: CriterionResult[];
  goMet: number;
  goTotal: number;
  stopHit: number;
  pivotHit: number;
  unknownCount: number;
  /** 母数不足で判断を保留すべき状態か */
  insufficientSample: boolean;
  /** レポート末尾に必ず載せる但し書き（§3-5 / §6.5） */
  disclaimer: string;
}

export function summarizeJudgement(input: JudgementInput): JudgementSummary {
  const criteria = evaluateJudgementCriteria(input);
  const go = criteria.filter((c) => c.group === "go");

  return {
    criteria,
    goMet: go.filter((c) => c.status === "met").length,
    goTotal: go.length,
    stopHit: criteria.filter((c) => c.group === "stop" && c.status === "met").length,
    pivotHit: criteria.filter((c) => c.group === "pivot" && c.status === "met").length,
    unknownCount: criteria.filter((c) => c.status === "unknown").length,
    insufficientSample: input.respondentCount < MIN_SEGMENT_RESPONDENTS,
    disclaimer:
      "これは判定材料であって判定結果ではありません。GO / PIVOT / STOP は運営者が決めてください。" +
      "また、チャットインタビューでは実作業の観察・資料の確認ができないため、確度は「数値あり」が上限です。" +
      "時間・金額はすべて回答者の記憶に基づく申告値であり、実測値ではありません。",
  };
}
