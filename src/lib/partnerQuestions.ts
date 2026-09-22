import type { Question, QuestionOption, QuestionTextImage, QuestionType } from "../types/domain";

/**
 * partnerQuestions.ts
 *
 * パートナーAPI（docs/partner-api.md）が扱う設問種別と、
 * ai-chat-interview の内部 question_type との対応。純関数のみ。
 *
 * パートナー側（ポータル B4 エディタ）が扱える設問形式:
 *   single_choice   単一選択（SA）
 *   multi_choice    複数選択（MA）
 *   scale           スケール（段階評価）
 *   matrix_single   マトリクス（行ごとに1つ選ぶ）
 *   matrix_multi    マトリクス（行ごとに複数選ぶ）
 *   sd              SD法（対になる言葉の間で評価する単一スケール）
 *   numeric         フリー数値（数値入力）
 *   free_text       自由記述（大）
 *
 * 内部 DB の question_type（types/domain.ts QuestionType）へここで写像する。
 *
 * ## 写像で注意が要るもの
 * - `scale` … 「順序尺度として扱う single_choice」として保存する
 *   （question_config.presentation.scale=true・migration 075 の既存表現に合わせる）。
 *   内部に "scale" という後方互換値もあるが、これは migration 016 以前のレガシー値で
 *   現行の回答UIが選択肢を描画しないため使わない。
 * - `sd` … 内部型も "sd"。**マトリクスではない**。回答UI（survey.ejs:1436）は
 *   `question_config.options` を目盛りとして1本のスケールで描画する。
 *   ⚠ 一度「マトリクスSD」として行×列で出そうとしたが、回答画面は行を目盛りとして
 *     描いてしまうため誤り。SD は単一スケールとして扱うこと。
 * - `free_text` → "free_text_long"。
 *   ⚠ 逆写像では内部 `free_text_short` も `free_text` に寄せる（**変更しないこと**）。
 *   別種別として返すと、既存アンケートの版文字列が変わって「誰も編集していないのに
 *   409」になる（版の材料に question_type が入るため・partnerSurveyVersion.ts:99）。
 *
 * ## 出していない種別と、その理由
 * - `ranking_top_n` … **回答UIが未実装**。`answerPresentation` は "podium" を返すが
 *   survey.ejs / answer-ui.ejs にその描画が無く、プレーンな textarea に落ちる。
 *   顧客に出すと「保存はできるが回答画面が壊れる」ので、描画を実装するまで出さない。
 * - `matrix_mixed` / `pairwise` / `point_allocation` / `image_heatmap` /
 *   `image_upload` / `text_with_image` / `hidden_*` … 運営専用。
 *
 * ## 行・列を持つ種別（マトリクス系）
 * 内部表現は「行 = question_config.options / 列 = question_config.matrix_cols」
 * （回答UI survey.ejs:1476 が `matrix_rows || options` を行として読む）。
 * パートナーAPI では行を `answer_options`・列を `matrix_cols` で受ける。
 */

export const PARTNER_QUESTION_TYPES = [
  "single_choice",
  "multi_choice",
  "scale",
  "matrix_single",
  "matrix_multi",
  "sd",
  "numeric",
  "free_text"
] as const;

export type PartnerQuestionType = (typeof PARTNER_QUESTION_TYPES)[number];

/**
 * 行と列を持つマトリクス系か。
 * ⚠ `sd` は**含めない**（単一スケールであってマトリクスではない）。
 */
export const PARTNER_MATRIX_TYPES = ["matrix_single", "matrix_multi"] as const;

export function isPartnerMatrixType(type: PartnerQuestionType): boolean {
  return (PARTNER_MATRIX_TYPES as readonly string[]).includes(type);
}

/**
 * 選択肢（answer_options）が必須の種別か。
 *
 * ⚠ マトリクス系も **true**。`answer_options` が「行」になるため
 *   （回答UIは行が無いと表を描けない）。列は `matrix_cols` で別に受ける。
 * 自由記述と数値だけが選択肢を持たない。
 */
export function partnerTypeRequiresOptions(type: PartnerQuestionType): boolean {
  return type !== "free_text" && type !== "numeric";
}

/** パートナー種別 → 内部 question_type。 */
export function toInternalQuestionType(type: PartnerQuestionType): QuestionType {
  switch (type) {
    case "multi_choice":
      return "multi_choice";
    case "free_text":
      return "free_text_long";
    case "numeric":
      return "numeric";
    case "matrix_single":
      return "matrix_single";
    case "matrix_multi":
      return "matrix_multi";
    case "sd":
      return "sd";
    // scale は「順序尺度として描画する single_choice」。内部型は single_choice のまま。
    case "scale":
    case "single_choice":
      return "single_choice";
  }
}

/**
 * 内部 question_type + question_config → パートナー種別。
 * 内部で扱える種別のうちパートナーが表現できないもの（マトリクス等）は null。
 * null の設問は、パートナー向けの GET レスポンスから除外する。
 */
export function toPartnerQuestionType(question: Question): PartnerQuestionType | null {
  if (question.question_config?.presentation?.scale === true) {
    return "scale";
  }
  switch (question.question_type) {
    case "single_choice":
    case "single_select":
      return "single_choice";
    case "multi_choice":
    case "multi_select":
      return "multi_choice";
    case "matrix_single":
      return "matrix_single";
    case "matrix_multi":
      return "matrix_multi";
    case "sd":
      return "sd";
    case "numeric":
      return "numeric";
    // ⚠ free_text_short も "free_text" に寄せる（変更前からの挙動）。
    //   別種別にすると既存アンケートの版が変わって偽の 409 になる。
    case "free_text_long":
    case "free_text_short":
    case "text":
      return "free_text";
    default:
      // ranking_top_n（回答UI未実装）/ matrix_mixed / pairwise /
      // point_allocation / image_heatmap / image_upload / text_with_image /
      // hidden_* はパートナーに出さない。
      // null の設問はパートナー向け GET から除外される（表示できないものを
      // 黙って別種別に化けさせない）。
      return null;
  }
}

/**
 * パートナーAPI が受け渡す設問文画像。
 * API は snake_case で統一する（内部 domain 型 QuestionTextImage は camelCase なので
 * この層で相互変換する）。**どの種別にも画像を添えられる**。
 */
export interface PartnerQuestionTextImage {
  main_url: string | null;
  additional_urls: string[];
  caption: string | null;
}

/** 内部 QuestionTextImage（camelCase）→ パートナー表現（snake_case）。 */
export function toPartnerQuestionTextImage(
  image: QuestionTextImage | null | undefined
): PartnerQuestionTextImage | null {
  if (!image) {
    return null;
  }
  return {
    main_url: image.mainUrl ?? null,
    additional_urls: Array.isArray(image.additionalUrls) ? image.additionalUrls : [],
    caption: image.caption ?? null
  };
}

/**
 * 選択肢の持ち越し（carry-forward）。
 *
 * 「前の設問で選んだものだけを、この設問の選択肢にする」指定。
 * 例: pq5「重視していることは？（いくつでも）」→ pq6「特に重視しているものは？（ひとつだけ）」
 *
 * **参照は sort_order で行う**。question_code はサーバーが採番する（pq1, pq2…）ため、
 * パートナー側は自分が送った sort_order でしか前問を指せない。
 * サーバーが採番時に sort_order → question_code を解決して保存する。
 *
 * mode:
 *   selected   参照元で選んだ選択肢だけを残す（既定）
 *   unselected 参照元で選ばなかった選択肢だけを残す
 */
export interface PartnerCarryForward {
  /** 参照元設問の sort_order（同じリクエスト内に存在すること）。 */
  from_sort_order: number;
  mode?: "selected" | "unselected";
}

/**
 * 参照元の解決結果を内部表現（display_tags_parsed.optionSource）に写す。
 *
 * fromQuestion は小文字の question_code。questionEngine 側が
 * ctx.answers を小文字キーで引くため、ここで必ず小文字にそろえる。
 */
export function buildCarryForwardTags(
  carry: PartnerCarryForward | null | undefined,
  fromQuestionCode: string
): Question["display_tags_parsed"] | null {
  if (!carry) return null;
  return {
    optionSource: {
      fromQuestion: fromQuestionCode.toLowerCase(),
      mode: carry.mode ?? "selected"
    }
  };
}

/**
 * 内部 display_tags_parsed → パートナー表現（sort_order 参照）に戻す。
 *
 * GET レスポンス用。question_code → sort_order の対応表を受け取る。
 * 対応が取れない（参照先が消えている等）場合は null を返す＝壊れた参照は返さない。
 */
export function toPartnerCarryForward(
  parsed: Question["display_tags_parsed"] | null | undefined,
  sortOrderByQuestionCode: Map<string, number>
): PartnerCarryForward | null {
  const source = parsed?.optionSource;
  if (!source) return null;
  const from = sortOrderByQuestionCode.get(source.fromQuestion.toLowerCase());
  if (from === undefined) return null;
  return { from_sort_order: from, mode: source.mode };
}

/**
 * 種別ごとの追加設定。マトリクスの列・ランキングの順位数・数値の範囲。
 * 選択肢（options）と画像は別引数なのでここには入れない。
 */
export interface PartnerQuestionExtras {
  /** マトリクス系の列（内部 question_config.matrix_cols）。 */
  matrix_cols?: QuestionOption[] | null;
  /** numeric: 入力できる最小値・最大値・単位。 */
  min?: number | null;
  max?: number | null;
  unit?: string | null;
}

/**
 * 内部 question_config を、パートナー種別と選択肢から組み立てる。
 *
 * image は任意。**渡されたときだけ** question_text_image を入れる
 * （既存の呼び出し＝性年代の固定2問は無改修のまま画像が付かない）。
 * extras も任意なので、**既存の2引数・3引数の呼び出しは無改修で動く**。
 *
 * ⚠ マトリクス系は「行 = options / 列 = matrix_cols」。行は options 引数で渡すこと
 *   （内部表現に合わせてあるので、行と列を取り違えると回答UIが崩れる）。
 */
export function buildPartnerQuestionConfig(
  type: PartnerQuestionType,
  options: QuestionOption[] | null,
  image?: PartnerQuestionTextImage | null,
  extras?: PartnerQuestionExtras | null
): Question["question_config"] {
  const config: NonNullable<Question["question_config"]> = {};
  if (options && options.length > 0) {
    config.options = options;
  }
  if (type === "scale") {
    // 順序尺度として描画させる（migration 075 の presentation 上書き）。
    config.presentation = { scale: true };
  }
  if (isPartnerMatrixType(type) && extras?.matrix_cols && extras.matrix_cols.length > 0) {
    config.matrix_cols = extras.matrix_cols;
  }
  if (type === "numeric") {
    if (typeof extras?.min === "number") config.min = extras.min;
    if (typeof extras?.max === "number") config.max = extras.max;
    if (extras?.unit) config.unit = extras.unit;
  }
  if (image) {
    config.question_text_image = {
      mainUrl: image.main_url ?? null,
      additionalUrls: Array.isArray(image.additional_urls) ? image.additional_urls : [],
      caption: image.caption ?? null
    };
  }
  return config;
}

/**
 * `PARTNER_IMAGE_URL_ALLOWED_HOSTS`（カンマ区切り）を正規化する。
 * 空要素は捨て、小文字にそろえる。未設定・空文字なら空配列。
 */
export function parseImageUrlAllowedHosts(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/**
 * 設問文画像URLが受け入れ可能か。
 *
 * - 許可リストが空（env 未設定）なら **常に false**（fail-closed）。
 *   画像URLを一切受け付けないことで、設定漏れが「何でも通る」状態にならないようにする。
 * - `https:` 以外（`http:` / `data:` / `javascript:` 等）は false。
 * - ホストは許可リストと完全一致（サブドメインの自動許可はしない）。
 */
export function isAllowedImageUrl(rawUrl: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  return allowedHosts.includes(parsed.hostname.toLowerCase());
}

/**
 * 画像フィールドに含まれる URL のうち、受け入れられないものを列挙する。
 * 空配列なら受け入れ可。パートナーAPI の zod 検証（400 判定）が使う。
 */
export function collectDisallowedImageUrls(
  image: {
    main_url?: string | null;
    additional_urls?: string[] | null;
    caption?: string | null;
  } | null,
  allowedHosts: string[]
): string[] {
  if (!image) {
    return [];
  }
  const urls = [image.main_url, ...(image.additional_urls ?? [])].filter(
    (url): url is string => typeof url === "string" && url.length > 0
  );
  return urls.filter((url) => !isAllowedImageUrl(url, allowedHosts));
}

/** パートナー向けレスポンス用の設問表現。 */
export interface PartnerQuestionView {
  question_code: string;
  question_text: string;
  question_type: PartnerQuestionType;
  /** 選択肢。マトリクス系ではここが「行」。 */
  answer_options: QuestionOption[] | null;
  /** マトリクス系の「列」。それ以外は null。 */
  matrix_cols: QuestionOption[] | null;
  /** numeric の範囲と単位。それ以外は null。 */
  min: number | null;
  max: number | null;
  unit: string | null;
  sort_order: number;
  is_required: boolean;
  /** 性年代設問など、パートナーが編集できない固定設問か。 */
  is_fixed: boolean;
  /** 設問文に添えた画像。無ければ null。 */
  question_text_image: PartnerQuestionTextImage | null;
  /** 選択肢の持ち越し設定。無ければ null。参照は sort_order。 */
  carry_forward: PartnerCarryForward | null;
}
