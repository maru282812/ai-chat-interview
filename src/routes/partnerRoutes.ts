import { Router } from "express";
import { z } from "zod";
import { HttpError, asyncHandler } from "../lib/http";
import {
  AGE_OPTIONS,
  GENDER_OPTIONS,
  RESERVED_QUESTION_CODES
} from "../lib/partnerDemographics";
import { PARTNER_PACKAGES } from "../lib/partnerPackages";
import { PARTNER_QUESTION_TYPES, partnerTypeRequiresOptions } from "../lib/partnerQuestions";
import { partnerAuthMiddleware, requirePartner } from "../middleware/partnerAuth";
import { partnerSurveyService } from "../services/partnerSurveyService";

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
  exclusive: z.boolean().optional()
});

const questionSchema = z
  .object({
    question_text: z.string().min(1).max(2000),
    question_type: z.enum(PARTNER_QUESTION_TYPES),
    answer_options: z.array(answerOptionSchema).max(50).nullable().optional(),
    sort_order: z.number().int().min(0).max(1000),
    is_required: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    const options = value.answer_options ?? null;
    if (partnerTypeRequiresOptions(value.question_type)) {
      if (!options || options.length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["answer_options"],
          message: `question_type=${value.question_type} requires at least 2 answer_options`
        });
        return;
      }
      const values = new Set(options.map((option) => option.value));
      if (values.size !== options.length) {
        ctx.addIssue({
          code: "custom",
          path: ["answer_options"],
          message: "answer_options must have unique values"
        });
      }
      return;
    }
    if (options && options.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["answer_options"],
        message: "question_type=free_text must not have answer_options"
      });
    }
  });

const questionListSchema = z.array(questionSchema).min(1).max(50);

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
    questions: questionListSchema.optional()
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

/** 業種別パッケージ一覧（設問テンプレ・消費チケット枚数マスタ）。 */
partnerRoutes.get(
  "/packages",
  asyncHandler(async (_req, res) => {
    res.json({
      packages: PARTNER_PACKAGES,
      // 性年代設問はサーバーが自動付与する固定設問。ポータルは編集不可の行として描画する。
      fixed_demographic_questions: {
        gender: { options: GENDER_OPTIONS },
        age: { options: AGE_OPTIONS }
      }
    });
  })
);

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
      questions: body.questions.map((question) => ({
        question_text: question.question_text,
        question_type: question.question_type,
        answer_options: question.answer_options ?? null,
        sort_order: question.sort_order,
        is_required: question.is_required
      })),
      store: {
        name: body.store.name,
        industry: body.store.industry ?? null
      }
    });

    res.status(201).json(survey);
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
      questions: body.questions?.map((question) => ({
        question_text: question.question_text,
        question_type: question.question_type,
        answer_options: question.answer_options ?? null,
        sort_order: question.sort_order,
        is_required: question.is_required
      }))
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

/** 締め切り。 */
partnerRoutes.post(
  "/surveys/:id/close",
  asyncHandler(async (req, res) => {
    const partner = requirePartner(req);
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerSurveyService.closeSurvey(partner.storeId, surveyId));
  })
);
