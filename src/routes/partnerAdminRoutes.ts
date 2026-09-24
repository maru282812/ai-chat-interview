import { Router } from "express";
import { z } from "zod";
import { HttpError, asyncHandler } from "../lib/http";
import { partnerAdminAuthMiddleware } from "../middleware/partnerAdminAuth";
import { partnerAssignmentService } from "../services/partnerAssignmentService";
import { partnerSurveySetService } from "../services/partnerSurveySetService";

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

// ------------------------------------------------------------------
// 閲覧専用の紐づけ（migration 103・§8.8〜8.10）
// 稼働中・回答ありの案件を、店舗に「見るだけ」で出すための別経路。
// assign / unassign とは触る列が違う（entry_code / visibility_type に触らない）。
// ------------------------------------------------------------------

/** 閲覧専用の紐づけ候補。**設問本文は含まない**。 */
partnerAdminRoutes.get(
  "/watchable-surveys",
  asyncHandler(async (_req, res) => {
    res.json(await partnerAssignmentService.listWatchable());
  })
);

/** 閲覧専用で店舗に紐づける。 */
partnerAdminRoutes.post(
  "/surveys/:id/watch",
  asyncHandler(async (req, res) => {
    const surveyId = parseSurveyId(req.params.id);
    const body = parseBody(assignSchema, req.body);
    res.json(await partnerAssignmentService.watchForStore(surveyId, body.store_id));
  })
);

/** 閲覧専用の紐づけを外す（冪等）。 */
partnerAdminRoutes.post(
  "/surveys/:id/unwatch",
  asyncHandler(async (req, res) => {
    const surveyId = parseSurveyId(req.params.id);
    res.json(await partnerAssignmentService.unwatchFromStore(surveyId));
  })
);

// ------------------------------------------------------------------
// セット（A/B/C のサイクル調査） — docs/partner-api.md §9
// ポータルのパッケージ編集（業種テンプレの選択・展示設問の取込）と、
// 相談経路で運営が先に作ったセットの店舗割り当てに使う。
// ------------------------------------------------------------------

/** セットID を UUID として検証する。非 UUID は 404。 */
function parseSetId(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? String(raw[0] ?? "") : (raw ?? "");
  const parsed = surveyIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(404, "survey set not found");
  }
  return parsed.data;
}

/** 業種テンプレ一覧＋展示用の平坦化設問（パッケージ編集の「原本から取り込む」）。 */
partnerAdminRoutes.get(
  "/industry-templates",
  asyncHandler(async (_req, res) => {
    res.json(await partnerSurveySetService.listIndustryTemplates());
  })
);

/** 会員店舗へ割り当てられるセットの候補。**設問本文は含まない**。 */
partnerAdminRoutes.get(
  "/assignable-survey-sets",
  asyncHandler(async (_req, res) => {
    res.json(await partnerSurveySetService.listAssignableSets());
  })
);

/** セットを会員店舗へ割り当てる。ガードを満たさないセットは 409。 */
partnerAdminRoutes.post(
  "/survey-sets/:id/assign",
  asyncHandler(async (req, res) => {
    const setId = parseSetId(req.params.id);
    const body = parseBody(assignSchema, req.body);
    res.json(await partnerSurveySetService.assignSetToStore(setId, body.store_id));
  })
);

/** セットの割り当てを取り消す（回答ありは 409・冪等）。 */
partnerAdminRoutes.post(
  "/survey-sets/:id/unassign",
  asyncHandler(async (req, res) => {
    const setId = parseSetId(req.params.id);
    res.json(await partnerSurveySetService.unassignSet(setId));
  })
);
