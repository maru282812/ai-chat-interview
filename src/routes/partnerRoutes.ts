import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { HttpError, asyncHandler } from "../lib/http";
import { RESERVED_QUESTION_CODES } from "../lib/partnerDemographics";
import {
  PARTNER_QUESTION_TYPES,
  collectDisallowedImageUrls,
  isAllowedImageUrl,
  isPartnerMatrixType,
  parseImageUrlAllowedHosts,
  partnerTypeRequiresOptions
} from "../lib/partnerQuestions";
import { partnerAuthMiddleware, requirePartner } from "../middleware/partnerAuth";
import { partnerLegalService } from "../services/partnerLegalService";
import { type PartnerQuestionInput, partnerSurveyService } from "../services/partnerSurveyService";
import { partnerSurveySetService } from "../services/partnerSurveySetService";
import type { QuestionOption } from "../types/domain";

/**
 * partnerRoutes.ts
 *
 * 会員ポータル（hibi-portal）向けパートナーAPI。仕様は docs/partner-api.md。
 * 認証は X-Partner-Key（partnerAuthMiddleware）。所有者スコープは X-Partner-Store-Id。
 *
 * エラー形式は既存の API ルート（mentalProxyRoutes / lib/http.ts errorHandler）に合わせて
 * `{ error: string }`。バリデーション失敗は 400、所有者違い・不在は 404。
 */

export const partnerRoutes = Router();

partnerRoutes.use(partnerAuthMiddleware);

// ------------------------------------------------------------------
// スキーマ
// ------------------------------------------------------------------

const surveyIdSchema = z.string().uuid();

const answerOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  allow_free_text: z.boolean().optional(),
  exclusive: z.boolean().optional(),
  /**
   * 選択肢に添える画像（任意・1枚）。商品・メニュー・内装の「どれが良いか」を
   * 写真で聞くための欄で、回答画面は既に画像付き選択肢を描ける
   * （`views/liff/survey.ejs` の `choice-img` / `QuestionOption.imageUrl`）。
   *
   * ⚠ 設問文画像と**同じ許可ホスト検証**を通す（下の superRefine）。
   *   回答画面に差し込まれる <img> の向き先なので、任意の外部URLを通すと
   *   トラッキング・回答者IPの収集・不適切画像の差し込みに使われる。
   */
  image_url: z.string().url().max(2000).nullable().optional()
});

/**
 * 設問文画像。**設問タイプは4種のまま。どの種別にも添えられる**。
 *
 * URL のホストは `PARTNER_IMAGE_URL_ALLOWED_HOSTS` の許可リストに限定する。
 * 回答画面に差し込まれる <img> の向き先なので、任意の外部URLを通すと
 * トラッキング・回答者IPの収集・不適切画像の差し込みに使われるため。
 * env 未設定なら画像URLは一切通らない（fail-closed）。
 */
const questionTextImageSchema = z.object({
  main_url: z.string().url().max(2000).nullable().optional(),
  additional_urls: z.array(z.string().url().max(2000)).max(4).optional(),
  caption: z.string().max(200).nullable().optional()
});

/**
 * 選択肢の持ち越し（carry-forward）。
 *
 * 参照は **sort_order**。question_code はサーバー採番（pq1, pq2…）なので、
 * パートナーは自分が送った sort_order でしか前問を指せない。
 * 参照先が同一リクエスト内に存在するか等の相関検証は questionListSchema 側で行う
 * （単問スキーマからは他の設問が見えないため）。
 */
const carryForwardSchema = z.object({
  from_sort_order: z.number().int().min(0).max(1000),
  mode: z.enum(["selected", "unselected"]).optional()
});

const questionSchema = z
  .object({
    question_text: z.string().min(1).max(2000),
    question_type: z.enum(PARTNER_QUESTION_TYPES),
    answer_options: z.array(answerOptionSchema).max(50).nullable().optional(),
    // マトリクス系の「列」。行は answer_options 側。
    matrix_cols: z.array(answerOptionSchema).max(30).nullable().optional(),
    // numeric: 範囲と単位。
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    unit: z.string().max(20).nullable().optional(),
    sort_order: z.number().int().min(0).max(1000),
    is_required: z.boolean().optional(),
    question_text_image: questionTextImageSchema.nullable().optional(),
    carry_forward: carryForwardSchema.nullable().optional()
  })
  .superRefine((value, ctx) => {
    const disallowed = collectDisallowedImageUrls(
      value.question_text_image ?? null,
      parseImageUrlAllowedHosts(env.PARTNER_IMAGE_URL_ALLOWED_HOSTS)
    );
    if (disallowed.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["question_text_image"],
        message:
          "image url must be https and its host must be listed in PARTNER_IMAGE_URL_ALLOWED_HOSTS"
      });
    }

    const options = value.answer_options ?? null;
    const cols = value.matrix_cols ?? null;

    /**
     * 選択肢画像も**設問文画像と同じ許可ホスト検証**を通す。
     * ここを抜くと、選択肢経由で任意の外部URLを回答画面へ差し込めてしまう
     * （設問文だけ守っても意味がない）。行・列の両方を見る。
     */
    const allowedHosts = parseImageUrlAllowedHosts(env.PARTNER_IMAGE_URL_ALLOWED_HOSTS);
    for (const [path, items] of [
      ["answer_options", options],
      ["matrix_cols", cols]
    ] as const) {
      if (!items) continue;
      const bad = items.filter(
        (item) => item.image_url && !isAllowedImageUrl(item.image_url, allowedHosts)
      );
      if (bad.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message:
            "option image url must be https and its host must be listed in PARTNER_IMAGE_URL_ALLOWED_HOSTS"
        });
      }
    }

    /** value の重複を弾く（同じ value が2つあると回答が一意に定まらない）。 */
    const assertUniqueValues = (
      items: { value: string }[],
      path: "answer_options" | "matrix_cols"
    ): void => {
      const values = new Set(items.map((item) => item.value));
      if (values.size !== items.length) {
        ctx.addIssue({ code: "custom", path: [path], message: `${path} must have unique values` });
      }
    };

    // ---- マトリクス系: 行(answer_options)と列(matrix_cols)の両方が要る ----
    //
    // ⚠ 下限は **1件**。運営の管理画面（adminController.ts:2393-2394）は行・列を
    //   1件でも保存できるため、ここで2件必須にすると、運営が作って店舗へ割り当てた
    //   案件を店舗が開いたとき、文言を1文字直しただけで 400 になり保存できなくなる。
    //   0件は回答画面で表にならないので弾く。
    if (isPartnerMatrixType(value.question_type)) {
      if (!options || options.length < 1) {
        ctx.addIssue({
          code: "custom",
          path: ["answer_options"],
          message: `question_type=${value.question_type} requires at least 1 answer_options (rows)`
        });
      } else {
        assertUniqueValues(options, "answer_options");
      }
      if (!cols || cols.length < 1) {
        ctx.addIssue({
          code: "custom",
          path: ["matrix_cols"],
          message: `question_type=${value.question_type} requires at least 1 matrix_cols (columns)`
        });
      } else {
        assertUniqueValues(cols, "matrix_cols");
      }
      return;
    }

    // ここから先はマトリクスではないので、列を送られても解釈できない。
    // 黙って捨てると「設定したのに反映されない」になるため 400 で返す。
    if (cols && cols.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["matrix_cols"],
        message: `question_type=${value.question_type} must not have matrix_cols`
      });
    }

    // ---- numeric: 範囲の整合 ----
    if (value.question_type === "numeric") {
      if (
        typeof value.min === "number" &&
        typeof value.max === "number" &&
        value.min > value.max
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["min"],
          message: "min must be less than or equal to max"
        });
      }
      if (options && options.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["answer_options"],
          message: "question_type=numeric must not have answer_options"
        });
      }
      return;
    }

    // ---- 選択肢が必要な種別（single/multi/scale/ranking）----
    if (partnerTypeRequiresOptions(value.question_type)) {
      if (!options || options.length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["answer_options"],
          message: `question_type=${value.question_type} requires at least 2 answer_options`
        });
        return;
      }
      assertUniqueValues(options, "answer_options");
      return;
    }

    // ---- 自由記述（free_text / free_text_short）----
    if (options && options.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["answer_options"],
        message: `question_type=${value.question_type} must not have answer_options`
      });
    }
  });

/**
 * 設問リスト。carry_forward の相関検証はここで行う（単問からは他の設問が見えない）。
 *
 * 落とす理由はすべて「回答画面で選択肢が0件になる」＝回答不能になるため。
 * 保存を許して実機で気づくより、400 で弾いて送信元に直させる。
 */
const questionListSchema = z
  .array(questionSchema)
  .min(1)
  .max(50)
  .superRefine((questions, ctx) => {
    const bySortOrder = new Map<number, (typeof questions)[number]>();
    for (const question of questions) {
      // sort_order の重複は許容仕様（サーバーが採番し直す）。
      // 重複があると参照先が一意に定まらないので、carry_forward からは参照させない。
      if (bySortOrder.has(question.sort_order)) {
        bySortOrder.set(question.sort_order, null as never);
        continue;
      }
      bySortOrder.set(question.sort_order, question);
    }

    questions.forEach((question, index) => {
      const carry = question.carry_forward;
      if (!carry) return;
      const path = [index, "carry_forward"] as (string | number)[];
      const fail = (message: string) => ctx.addIssue({ code: "custom", path, message });

      if (carry.from_sort_order === question.sort_order) {
        fail("carry_forward.from_sort_order must not reference itself");
        return;
      }
      const source = bySortOrder.get(carry.from_sort_order);
      if (source === undefined) {
        fail(`carry_forward.from_sort_order=${carry.from_sort_order} does not match any question`);
        return;
      }
      if (source === null) {
        fail(
          `carry_forward.from_sort_order=${carry.from_sort_order} is ambiguous (duplicated sort_order)`
        );
        return;
      }
      // 参照元は「選んだ値」が残る種別でなければならない。
      // free_text には選択肢が無く、scale は順序尺度なので絞り込みの意味がない。
      if (source.question_type !== "single_choice" && source.question_type !== "multi_choice") {
        fail(
          `carry_forward source must be single_choice or multi_choice (got ${source.question_type})`
        );
        return;
      }
      // 先に回答されていなければ絞り込めない。
      if (source.sort_order > question.sort_order) {
        fail("carry_forward source must come before this question");
        return;
      }
      // 持ち越しは value 一致で絞る。共通の value が無ければ必ず0件になる。
      const sourceValues = new Set((source.answer_options ?? []).map((option) => option.value));
      const shared = (question.answer_options ?? []).filter((option) =>
        sourceValues.has(option.value)
      );
      if (shared.length === 0) {
        fail(
          "carry_forward requires answer_options values shared with the source question (none matched)"
        );
      }
    });
  });

/** テストから参照する（HTTP を立てずに 400 判定を検証するため）。 */
export const partnerQuestionSchemaForTest = questionSchema;
/** carry_forward の相関検証は設問リスト単位なので、リストごと公開する。 */
export const partnerQuestionListSchemaForTest = questionListSchema;
export const partnerToQuestionInputForTest = toQuestionInput;
/** `base_version`（楽観ロック）の受け入れ規則をテストから検証するために公開する。 */
export const partnerUpdateSurveySchemaForTest = () => updateSurveySchema;

const createSurveySchema = z.object({
  title: z.string().min(1).max(200),
  package_id: z.string().min(1).max(100).nullable().optional(),
  questions: questionListSchema,
  store: z.object({
    name: z.string().min(1).max(200),
    industry: z.string().min(1).max(100).nullable().optional()
  })
});

const updateSurveySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    questions: questionListSchema.optional(),
    /**
     * 楽観ロック用の版（任意）。直前に受け取った `SurveyView.version` を送る。
     * サーバーの現在版と不一致なら 409。省略すれば従来どおり無条件更新（後方互換）。
     *
     * refine の条件には**含めない**。base_version だけを送って
     * title も questions も無い PUT は、これまでどおり 400 のままにする。
     */
    base_version: z.string().min(1).max(200).optional()
  })
  .refine((value) => value.title !== undefined || value.questions !== undefined, {
    message: "title or questions is required"
  });

// ------------------------------------------------------------------
// ヘルパー
// ------------------------------------------------------------------

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".");
    throw new HttpError(400, path ? `${path}: ${first?.message}` : (first?.message ?? "invalid request body"));
  }
  return parsed.data;
}

/**
 * :id を UUID として検証する。非 UUID は 404（存在しない ID として扱う）。
 * Express の params は配列になり得るため adminController.routeParam と同じ形で正規化する。
 */
function parseSurveyId(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? String(raw[0] ?? "") : (raw ?? "");
  const parsed = surveyIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(404, "survey not found");
  }
  return parsed.data;
}

/**
 * 検証済みの設問ボディ → サービス層の入力。
 * POST / PUT で同じ写像を使う（片方だけ画像を落とす事故を防ぐ）。
 */
/**
 * 選択肢のパートナー表現 → 内部表現。
 *
 * ⚠ **API は snake_case（`image_url`）、内部の `QuestionOption` は camelCase（`imageUrl`）**。
 *   回答画面（`views/liff/survey.ejs`）が読むのは `imageUrl` なので、
 *   ここで詰め替えないと**画像を送っても選択肢に出ない**（無言で消える）。
 *   `image_url` が無い・null のときは `imageUrl` を**付けない**
 *   （`undefined` を入れると既存の画像を消す挙動と紛らわしいため）。
 */
function toOptionInputs(
  options: z.infer<typeof answerOptionSchema>[] | null | undefined
): QuestionOption[] | null {
  if (!options) return null;
  return options.map((option) => {
    const { image_url: imageUrl, ...rest } = option;
    return imageUrl ? { ...rest, imageUrl } : rest;
  });
}

function toQuestionInput(question: z.infer<typeof questionSchema>): PartnerQuestionInput {
  const image = question.question_text_image;
  return {
    question_text: question.question_text,
    question_type: question.question_type,
    answer_options: toOptionInputs(question.answer_options),
    matrix_cols: toOptionInputs(question.matrix_cols),
    min: question.min ?? null,
    max: question.max ?? null,
    unit: question.unit ?? null,
    sort_order: question.sort_order,
    is_required: question.is_required,
    question_text_image: image
      ? {
          main_url: image.main_url ?? null,
          additional_urls: image.additional_urls ?? [],
          caption: image.caption ?? null
        }
      : null,
    carry_forward: question.carry_forward ?? null
  };
}

/**
 * パートナーが予約 question_code（性年代設問）を横取りしないことを保証する。
 * question_code はサーバーが採番するため通常は届かないが、将来の入力拡張への防御。
 */
function assertNoReservedQuestionText(questions: { question_text: string }[]): void {
  for (const question of questions) {
    if (RESERVED_QUESTION_CODES.includes(question.question_text.trim())) {
      throw new HttpError(400, "question_text must not be a reserved code");
    }
  }
}

// ------------------------------------------------------------------
// ルート
// ------------------------------------------------------------------

// `GET /packages`（業種別パッケージ一覧）は削除した。
// パッケージマスタ（設問テンプレ・消費チケット枚数・画像）は会員ポータル hibi 側の
// packages テーブルへ移管され、ポータルは自 DB を読むのでこの API を呼ばなくなった
// （ハードコード `partnerPackages.ts` と hibi `aci-mock.ts` の写しという二重管理の解消）。
// `package_id` はここでは検証せず不透明な文字列として projects.objective に保持するだけなので、
// マスタが hibi 側に移っても draft 作成・取得の挙動は変わらない。

/** draft 作成。 */
partnerRoutes.post(
  "/surveys",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const body = parseBody(createSurveySchema, req.body);
    assertNoReservedQuestionText(body.questions);

    const survey = await partnerSurveyService.createSurvey({
      partnerStoreId: partner.storeId,
      title: body.title,
      packageId: body.package_id ?? null,
      questions: body.questions.map(toQuestionInput),
      store: {
        name: body.store.name,
        industry: body.store.industry ?? null
      }
    });

    res.status(201).json(survey);
  })
);

/**
 * 会員利用規約（店舗向け）の現在版（§5.8・migration 105）。
 * 店舗スコープの検証は不要（全店舗に同じ文書）だが、鍵と店舗IDヘッダは他と同じく必須。
 */
partnerRoutes.get(
  "/legal/store-terms",
  asyncHandler(async (req, res) => {
    requirePartner(req);
    res.json(await partnerLegalService.getStoreTerms());
  })
);

/** 1件取得（ポータルの編集画面の再読込用）。 */
partnerRoutes.get(
  "/surveys/:id",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerSurveyService.getSurvey(partner.storeId, surveyId));
  })
);

/** draft 更新。 */
partnerRoutes.put(
  "/surveys/:id",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const surveyId = parseSurveyId(req.params.id);
    const body = parseBody(updateSurveySchema, req.body);
    if (body.questions) {
      assertNoReservedQuestionText(body.questions);
    }

    const survey = await partnerSurveyService.updateSurvey({
      partnerStoreId: partner.storeId,
      surveyId,
      title: body.title,
      questions: body.questions?.map(toQuestionInput),
      baseVersion: body.base_version
    });

    res.json(survey);
  })
);

/** 公開＋回答URL返却。 */
partnerRoutes.post(
  "/surveys/:id/publish",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerSurveyService.publishSurvey(partner.storeId, surveyId));
  })
);

/** 回答件数＋性年代集計。 */
partnerRoutes.get(
  "/surveys/:id/stats",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerSurveyService.getStats(partner.storeId, surveyId));
  })
);

/**
 * 店舗への申し送り設問の結果（利用規約 第9条3項に基づく開示）。
 *
 * 共有フラグが立った設問だけを返す。回答者の識別子は返さない。
 * 判定はすべて service 側（getResults）で行う。
 */
partnerRoutes.get(
  "/surveys/:id/results",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerSurveyService.getResults(partner.storeId, surveyId));
  })
);

// ------------------------------------------------------------------
// セット（A/B/C のサイクル調査） — docs/partner-api.md §9
// 単発アンケート（/surveys）と違い、設問は運営の原本から複製され店舗は編集できない。
// 公開はここの publish（＝ポータルの QR 発行）だけが入口。
// ------------------------------------------------------------------

const createSetSchema = z.object({
  industry_template_id: z.string().uuid(),
  package_id: z.string().min(1).max(100).nullable().optional(),
  store: z.object({
    name: z.string().min(1).max(200),
    member_no: z.string().min(1).max(50).nullable().optional()
  })
});

/** テストから参照する（HTTP を立てずに 400 判定を検証するため）。 */
export const partnerCreateSetSchemaForTest = createSetSchema;

/** :id を UUID として検証する。非 UUID は 404。 */
function parseSetId(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? String(raw[0] ?? "") : (raw ?? "");
  const parsed = surveyIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(404, "survey set not found");
  }
  return parsed.data;
}

/** セット作成（draft）。同じ店舗の再注文は既存セットを冪等に返す。 */
partnerRoutes.post(
  "/survey-sets",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const body = parseBody(createSetSchema, req.body);

    const set = await partnerSurveySetService.createSet({
      partnerStoreId: partner.storeId,
      industryTemplateId: body.industry_template_id,
      storeName: body.store.name,
      memberNo: body.store.member_no ?? null,
      packageId: body.package_id ?? null
    });

    res.status(201).json(set);
  })
);

/** 1件取得（ポータルの閲覧専用エディタ・回答状況用）。 */
partnerRoutes.get(
  "/survey-sets/:id",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const setId = parseSetId(req.params.id);
    res.json(await partnerSurveySetService.getSet(partner.storeId, setId));
  })
);

/** セット全体を公開して A の回答URLを返す（冪等）。 */
partnerRoutes.post(
  "/survey-sets/:id/publish",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const setId = parseSetId(req.params.id);
    res.json(await partnerSurveySetService.publishSet(partner.storeId, setId));
  })
);

/** 締め切り。 */
partnerRoutes.post(
  "/surveys/:id/close",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerSurveyService.closeSurvey(partner.storeId, surveyId));
  })
);
