import type { Question, QuestionOption, QuestionTextImage, QuestionType } from "../types/domain";

/**
 * partnerQuestions.ts
 *
 * パートナーAPI（docs/partner-api.md）が扱う設問4種と、
 * ai-chat-interview の内部 question_type との対応。純関数のみ。
 *
 * パートナー側（ポータル B4 エディタ）は 4 種類しか扱わない:
 *   single_choice  単一選択
 *   multi_choice   複数選択
 *   free_text      自由記述
 *   scale          スケール（段階評価）
 *
 * 内部 DB の question_type（types/domain.ts QuestionType）は種類が多いので、
 * ここで 1 対 1 に写像する。scale は「順序尺度として扱う single_choice」として保存する
 * （question_config.presentation.scale=true・migration 075 の既存表現に合わせる）。
 * 内部に "scale" という後方互換値もあるが、これは migration 016 以前のレガシー値で
 * 現行の回答UIが選択肢を描画しないため使わない。
 */

export const PARTNER_QUESTION_TYPES = [
  "single_choice",
  "multi_choice",
  "free_text",
  "scale"
] as const;

export type PartnerQuestionType = (typeof PARTNER_QUESTION_TYPES)[number];

/** 選択肢が必須の種別か。 */
export function partnerTypeRequiresOptions(type: PartnerQuestionType): boolean {
  return type !== "free_text";
}

/** パートナー種別 → 内部 question_type。 */
export function toInternalQuestionType(type: PartnerQuestionType): QuestionType {
  switch (type) {
    case "multi_choice":
      return "multi_choice";
    case "free_text":
      return "free_text_long";
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
    case "free_text_long":
    case "free_text_short":
    case "text":
      return "free_text";
    default:
      return null;
  }
}

/**
 * パートナーAPI が受け渡す設問文画像。
 * API は snake_case で統一する（内部 domain 型 QuestionTextImage は camelCase なので
 * この層で相互変換する）。設問タイプは4種のまま。**どの種別にも画像を添えられる**。
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
 * 内部 question_config を、パートナー種別と選択肢から組み立てる。
 *
 * image は任意。**渡されたときだけ** question_text_image を入れる
 * （既存の呼び出し＝性年代の固定2問は無改修のまま画像が付かない）。
 */
export function buildPartnerQuestionConfig(
  type: PartnerQuestionType,
  options: QuestionOption[] | null,
  image?: PartnerQuestionTextImage | null
): Question["question_config"] {
  const config: NonNullable<Question["question_config"]> = {};
  if (options && options.length > 0) {
    config.options = options;
  }
  if (type === "scale") {
    // 順序尺度として描画させる（migration 075 の presentation 上書き）。
    config.presentation = { scale: true };
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
  answer_options: QuestionOption[] | null;
  sort_order: number;
  is_required: boolean;
  /** 性年代設問など、パートナーが編集できない固定設問か。 */
  is_fixed: boolean;
  /** 設問文に添えた画像。無ければ null。 */
  question_text_image: PartnerQuestionTextImage | null;
}
