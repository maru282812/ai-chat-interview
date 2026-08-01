import { Router } from "express";
import { z } from "zod";
import { HttpError, asyncHandler } from "../lib/http";
import { partnerAdminAuthMiddleware } from "../middleware/partnerAdminAuth";
import { partnerAssignmentService } from "../services/partnerAssignmentService";

/**
 * partnerAdminRoutes.ts
 *
 * 運営専用API（/api/partner-admin/*）。仕様は docs/partner-api.md §8。
 *
 * ポータルの運営画面（/ops）が、ACI 管理画面で作った案件を店舗に割り当てるために使う。
 * 認証は X-Partner-Admin-Key（partnerAdminAuthMiddleware）。
 * **店舗スコープを持たない**ので X-Partner-Store-Id は要求しない
 * （未割り当て案件が対象＝所有者がまだ居ないため）。
 *
 * `/api/partner/*`（店舗向け）とはルータ・ミドルウェア・鍵をすべて分けている。
 * エラー形式は既存と同じ `{ error: string }`。
 */

export const partnerAdminRoutes = Router();

partnerAdminRoutes.use(partnerAdminAuthMiddleware);

// ------------------------------------------------------------------
// スキーマ
// ------------------------------------------------------------------

const surveyIdSchema = z.string().uuid();

/** 割り当て先の店舗。ポータル側 stores.id（UUID）。 */
const assignSchema = z.object({
  store_id: z.string().uuid()
});

// ------------------------------------------------------------------
// ヘルパー（partnerRoutes と同じ作法）
// ------------------------------------------------------------------

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".");
    throw new HttpError(
      400,
      path ? `${path}: ${first?.message}` : (first?.message ?? "invalid request body")
    );
  }
  return parsed.data;
}

/** :id を UUID として検証する。非 UUID は 404（存在しない ID として扱う）。 */
function parseSurveyId(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? String(raw[0] ?? "") : (raw ?? "");
  const parsed = surveyIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(404, "survey not found");
  }
  return parsed.data;
}

/** テストから参照する（HTTP を立てずに 400 判定を検証するため）。 */
export const partnerAdminAssignSchemaForTest = assignSchema;

// ------------------------------------------------------------------
// ルート
// ------------------------------------------------------------------

/** 割り当て候補の一覧。**設問本文は含まない**。 */
partnerAdminRoutes.get(
  "/assignable-surveys",
  asyncHandler(async (_req, res) => {
    res.json(await partnerAssignmentService.listAssignable());
  })
);

/** 割り当て済み案件の一覧（ポータル側との整合性チェック用）。 */
partnerAdminRoutes.get(
  "/assigned-surveys",
  asyncHandler(async (_req, res) => {
    res.json(await partnerAssignmentService.listAssigned());
  })
);

/** 割り当て前プレビュー（設問込み）。 */
partnerAdminRoutes.get(
  "/surveys/:id",
  asyncHandler(async (req, res) => {
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerAssignmentService.previewSurvey(surveyId));
  })
);

/** 店舗へ割り当てる。ガードを満たさない案件は 409。 */
partnerAdminRoutes.post(
  "/surveys/:id/assign",
  asyncHandler(async (req, res) => {
    const surveyId = parseSurveyId(req.params.id);
    const body = parseBody(assignSchema, req.body);
    res.json(await partnerAssignmentService.assignToStore(surveyId, body.store_id));
  })
);

/** 割り当てを取り消す（ポータル側の書き込み失敗時の巻き戻しにも使う）。 */
partnerAdminRoutes.post(
  "/surveys/:id/unassign",
  asyncHandler(async (req, res) => {
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerAssignmentService.unassignFromStore(surveyId));
  })
);
