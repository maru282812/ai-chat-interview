import type { Answer, Question, QuestionOption, UserProfile } from "../types/domain";
import {
  buildOptionIndex,
  countAnsweredAny,
  optionsForQuestion,
  selectedOptionValues
} from "./answerOptionMatch";
import { AGE_BAND_CODES, MARITAL_CODES, SEX_CODES, ageBand, computeAge } from "./rawdataExport";

/**
 * gtTable.ts
 *
 * GT集計表（Grand Total 表）の組み立て。純関数のみ。DB アクセスは呼び出し側の責務。
 *
 * ## GT表とは
 *
 * 1設問につき「n行（実数）」と「%行」の2段を持つ表。列は選択肢。
 * 行方向には総数のほかに属性（性別・年代・地域・職業・婚姻・子供）のブレークを並べる
 * ＝ 設問 × 属性のクロス集計。
 *
 * ```
 *          n     選択肢A  選択肢B  選択肢C
 *  総数   1000     372      351      147
 *   (%)  100.0%   37.2%    35.1%    14.7%
 *  男性    480     201      160       70
 *   (%)  100.0%   41.9%    33.3%    14.6%
 * ```
 *
 * ## 守っている約束（崩すと数字が信用されなくなる）
 *
 * 1. **%の分母は「その行の有効回答数 n」**。選択肢件数の合計ではない。
 *    複数選択では 1人が複数選ぶため合計 > n になり、合計を分母にすると 100% にならない。
 *
 * 2. **`qualitative_only` の設問には % を出さない**。
 *    既存方針 "Qualitative only. Do not use for ratio claims."（researchOpsService）を維持する。
 *    自由記述を比率で語らせないため、そもそも percent を null で返す。
 *
 * 3. **小N抑制**: n が {@link SMALL_N_THRESHOLD} 未満の行は % をマスクする（null）。
 *    顧客に見せる数字なので、母数が小さいセルの比率を出さない。
 *    件数（n）自体は出す（何人いるかは調査の進行判断に必要なため）。
 *
 * 4. **突合は {@link answerOptionMatch} に一本化**。
 *    GT表のセルの人数と、そのセルから抽出される回答者の人数は必ず一致させる。
 *
 * 5. **年齢は回答時点で数える**（`computeAge(birth_date, completed_at)`）。
 *    今日の年齢で数えると、過去の調査の集計が時間とともに変わってしまう。
 */

/** これ未満の n の行は % をマスクする。顧客公開を前提に厳しい側（10）を採る。 */
export const SMALL_N_THRESHOLD = 10;

/** 属性ブレークの軸。 */
export type BreakAxis = "total" | "sex" | "age_band" | "prefecture" | "occupation" | "marital" | "children";

/**
 * GT表の行の軸。
 *
 * "answer" は「別の設問の回答」をブレークにした行（パートナー調査は性年代を設問で聞くため）。
 */
export type GtRowAxis = BreakAxis | "answer";

/** GT表の1セル。 */
export interface GtCell {
  /** 該当件数（実数）。常に返す。 */
  count: number;
  /**
   * 構成比（0-100）。次のいずれかで null になる:
   * - 設問が qualitative_only（比率を出してはいけない設問）
   * - 行の n が SMALL_N_THRESHOLD 未満（小N抑制）
   * - 行の n が 0
   */
  percent: number | null;
}

/** GT表の1行（総数 or 属性ブレークの1カテゴリ）。 */
export interface GtRow {
  axis: GtRowAxis;
  /** 属性値のコード（総数行は null）。セル条件の再現に使う。 */
  code: string | null;
  /**
   * 回答ブレークの行を一意に指す `"<questionCode>:<value>"`（属性ブレーク・総数行は null）。
   * セルをクリックした際に「どのブレークのどの値か」を復元するために使う。
   */
  break_code?: string | null;
  label: string;
  /** この行の有効回答数。%の分母。 */
  n: number;
  /** 選択肢ごとのセル。列の並びは {@link GtQuestionTable.options} と一致する。 */
  cells: GtCell[];
  /** 小N抑制が効いてこの行の % を出していないか。 */
  suppressed: boolean;
}

/** 1設問ぶんのGT表。 */
export interface GtQuestionTable {
  question_id: string;
  question_code: string;
  question_text: string;
  question_type: string;
  /** 比率を出してよい設問か。false なら全セルの percent が null。 */
  ratio_allowed: boolean;
  /** 列（選択肢）。並び順は設問定義の順。 */
  options: { value: string; label: string }[];
  rows: GtRow[];
  /** 比率を出さない場合の理由（UIに出す注記）。 */
  notice: string | null;
}

/** 回答者1人ぶんの入力。呼び出し側が answers と profile を突き合わせて渡す。 */
export interface GtRespondentInput {
  /** この回答者の、対象設問に対する primary 回答（無ければ null）。 */
  answer: Answer | null;
  /** 属性ブレーク用のプロフィール（未登録なら null）。 */
  profile: UserProfile | null;
  /** 年齢算出の基準日（回答完了日時）。null なら birth_date から今日で算出する。 */
  answeredAt: string | null;
}

function percentOf(count: number, n: number): number {
  if (n <= 0) {
    return 0;
  }
  return Math.round((count / n) * 1000) / 10;
}

/**
 * 比率を出してよい設問かを判定する。
 *
 * 選択肢が定義されていない設問（自由記述・画像アップロード等）は GT表の対象外。
 * researchOpsService の aggregation_type と同じ考え方だが、こちらは選択肢の有無で機械的に決める。
 */
export function isRatioAllowed(question: Question): boolean {
  return optionsForQuestion(question).length > 0;
}

/**
 * 属性値 → ブレークのカテゴリコード/ラベル。未登録は null（その行に計上しない）。
 *
 * ⚠ セル条件からの回答者抽出（cellInterviewService）も同じ関数を使う。
 *   GT表の行の作り方と抽出の絞り方が別実装になると、表の人数と抽出人数がズレる。
 */
export function breakCategoryOf(
  axis: BreakAxis,
  profile: UserProfile | null,
  answeredAt: string | null
): { code: string; label: string } | null {
  if (axis === "total") {
    return { code: "total", label: "総数" };
  }
  if (!profile) {
    return null;
  }

  switch (axis) {
    case "sex": {
      const gender = profile.gender;
      if (!gender) {
        return null;
      }
      const entry = SEX_CODES[gender];
      return entry ? { code: String(entry.code), label: entry.label } : null;
    }
    case "age_band": {
      const age = computeAge(profile.birth_date, answeredAt);
      const band = ageBand(age);
      if (band === null) {
        return null;
      }
      const entry = AGE_BAND_CODES.find((item) => item.code === band);
      return entry ? { code: String(entry.code), label: entry.label } : null;
    }
    case "prefecture": {
      const pref = profile.prefecture;
      return pref ? { code: pref, label: pref } : null;
    }
    case "occupation": {
      const job = profile.occupation;
      return job ? { code: job, label: job } : null;
    }
    case "marital": {
      const status = profile.marital_status;
      if (!status) {
        return null;
      }
      const entry = MARITAL_CODES[status];
      return entry ? { code: String(entry.code), label: entry.label } : null;
    }
    case "children": {
      if (profile.has_children === null || profile.has_children === undefined) {
        return null;
      }
      return profile.has_children
        ? { code: "1", label: "子供あり" }
        : { code: "0", label: "子供なし" };
    }
    default:
      return null;
  }
}

/**
 * 設問の回答そのものをブレーク軸にするGT表を組み立てる。
 *
 * 会員本体の調査は属性を `user_profiles` から取るが、パートナー（店舗）調査は
 * 性別・年代を**設問として**聞く（`__partner_gender__` / `__partner_age__`）。
 * その場合の属性列はプロフィールではなく回答から作るため、こちらを使う。
 *
 * @param question      集計する設問（列になる）
 * @param respondents   回答者ごとの「集計対象設問への回答」と「ブレーク設問への回答」
 * @param breaks        ブレーク軸。label は行見出しの接頭辞、options は行の並び順
 */
export function buildGtQuestionTableByAnswerBreaks(
  question: Question,
  respondents: Array<{
    answer: Answer | null;
    /** ブレーク軸のコード → その回答者の選択値（未回答は null）。 */
    breakValues: Record<string, string | null>;
  }>,
  breaks: Array<{ code: string; label: string; options: readonly { value: string; label: string }[] }>
): GtQuestionTable {
  const options = optionsForQuestion(question);
  const ratioAllowed = isRatioAllowed(question);
  const optionIndex = buildOptionIndex(options);

  const makeRow = (
    axisLabel: string,
    code: string | null,
    label: string,
    answers: Answer[]
  ): GtRow => {
    const n = countAnsweredAny(answers, options);
    const suppressed = n < SMALL_N_THRESHOLD;
    const counts = new Map<string, number>();
    for (const option of options) {
      counts.set(option.value, 0);
    }
    for (const answer of answers) {
      for (const value of selectedOptionValues(answer, optionIndex)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return {
      // 回答ブレークは属性軸の enum に載らないため、総数以外は "answer" として扱う。
      axis: code === null ? "total" : "answer",
      break_code: code,
      code,
      label: code === null ? label : `${axisLabel}: ${label}`,
      n,
      suppressed,
      cells: options.map((option) => {
        const count = counts.get(option.value) ?? 0;
        const percent = ratioAllowed && !suppressed && n > 0 ? percentOf(count, n) : null;
        return { count, percent };
      })
    };
  };

  const rows: GtRow[] = [
    makeRow("総数", null, "総数", respondents.flatMap((item) => (item.answer ? [item.answer] : [])))
  ];

  for (const axis of breaks) {
    for (const option of axis.options) {
      const answers = respondents
        .filter((item) => item.answer && item.breakValues[axis.code] === option.value)
        .map((item) => item.answer as Answer);
      // 該当者0の行は出さない（空行で表が伸びるだけなので）。
      if (answers.length === 0) {
        continue;
      }
      rows.push(makeRow(axis.label, `${axis.code}:${option.value}`, option.label, answers));
    }
  }

  return {
    question_id: question.id,
    question_code: question.question_code,
    question_text: question.question_text,
    question_type: question.question_type,
    ratio_allowed: ratioAllowed,
    options: options.map((option: QuestionOption) => ({ value: option.value, label: option.label })),
    rows,
    notice: ratioAllowed
      ? null
      : "この設問は選択肢を持たないため、比率は算出しません（自由記述は比率で語れません）。"
  };
}

/**
 * 1設問ぶんのGT表を組み立てる。
 *
 * @param question    対象設問
 * @param respondents 回答者ごとの (回答, プロフィール, 回答日時)
 * @param axes        並べる属性ブレーク。既定は総数のみ
 */
export function buildGtQuestionTable(
  question: Question,
  respondents: GtRespondentInput[],
  axes: BreakAxis[] = ["total"]
): GtQuestionTable {
  const options = optionsForQuestion(question);
  const ratioAllowed = isRatioAllowed(question);
  const optionIndex = buildOptionIndex(options);

  // 行ごとに「回答の配列」を集める。
  // 同一軸の中でカテゴリが複数出るので、軸 → カテゴリコード → 回答配列。
  const buckets = new Map<string, { axis: BreakAxis; code: string | null; label: string; answers: Answer[] }>();

  for (const axis of axes) {
    for (const item of respondents) {
      if (!item.answer) {
        continue;
      }
      const category = breakCategoryOf(axis, item.profile, item.answeredAt);
      if (!category) {
        continue;
      }
      const key = `${axis}:${category.code}`;
      const bucket = buckets.get(key) ?? {
        axis,
        code: axis === "total" ? null : category.code,
        label: category.label,
        answers: []
      };
      bucket.answers.push(item.answer);
      buckets.set(key, bucket);
    }
  }

  const rows: GtRow[] = [];
  for (const [, bucket] of buckets) {
    // n は「1つ以上の選択肢を選んだ回答」の数。%の分母。
    const n = countAnsweredAny(bucket.answers, options);
    const suppressed = n < SMALL_N_THRESHOLD;

    const counts = new Map<string, number>();
    for (const option of options) {
      counts.set(option.value, 0);
    }
    for (const answer of bucket.answers) {
      for (const value of selectedOptionValues(answer, optionIndex)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    rows.push({
      axis: bucket.axis,
      code: bucket.code,
      label: bucket.label,
      n,
      suppressed,
      cells: options.map((option) => {
        const count = counts.get(option.value) ?? 0;
        // 比率を出してよく、小Nでもなく、母数があるときだけ % を出す。
        const percent = ratioAllowed && !suppressed && n > 0 ? percentOf(count, n) : null;
        return { count, percent };
      })
    });
  }

  // 総数を先頭に、以降は軸の指定順・カテゴリのラベル順。
  const axisOrder = new Map<GtRowAxis, number>(axes.map((axis, index) => [axis, index]));
  rows.sort((left, right) => {
    if (left.axis !== right.axis) {
      return (axisOrder.get(left.axis) ?? 0) - (axisOrder.get(right.axis) ?? 0);
    }
    return left.label.localeCompare(right.label, "ja");
  });

  return {
    question_id: question.id,
    question_code: question.question_code,
    question_text: question.question_text,
    question_type: question.question_type,
    ratio_allowed: ratioAllowed,
    options: options.map((option: QuestionOption) => ({ value: option.value, label: option.label })),
    rows,
    notice: ratioAllowed
      ? null
      : "この設問は選択肢を持たないため、比率は算出しません（自由記述は比率で語れません）。"
  };
}
