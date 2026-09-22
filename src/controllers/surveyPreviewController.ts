import type { Request, Response } from "express";
import { env } from "../config/env";
import { resolveAnswerPresentation } from "../lib/answerPresentation";
import { HttpError } from "../lib/http";
import { secureEquals } from "../lib/secureCompare";
import { applyAutoFreeText } from "../lib/otherOption";
import { projectRepository } from "../repositories/projectRepository";
import { questionPageGroupRepository } from "../repositories/questionPageGroupRepository";
import { questionRepository } from "../repositories/questionRepository";

/**
 * surveyPreviewController.ts
 *
 * 会員ポータル（hibi-portal）の作成画面に、**本物の回答画面をそのまま**出すための
 * 読み取り専用プレビュー。
 *
 * ## なぜ実画面を出すのか
 * ポータル側で回答画面を「模して」描くと、`applyAutoFreeText`（「その他」の入力欄）や
 * `resolveAnswerPresentation`（回答UIプリセットによる描画パターン）を通らないため、
 * **本番と違う見た目**になる。過去に同じ理由で作り直しになった経緯があるので、
 * 最初から実テンプレート（`liff/survey`）を描く。
 *
 * ## 安全側の制約（ここを緩めない）
 * - **GET のみ・DB へ一切書かない**。session / respondent / assignment を作らない
 *   （作ると回答数に混ざる・チケット消費の前提が崩れる）。
 * - **`X-Partner-Key` と所有者スコープ（`partner_store_id` 一致）を必ず検証**する。
 *   他店舗の調査票を覗けてはいけない。不一致・不在はどちらも 404（存在を漏らさない）。
 * - `status` は問わない（draft を見せるのが目的）。
 * - `previewMode=true` をテンプレートへ渡し、**送信系の導線を出さない**。
 */

/** プレビューは iframe 埋め込み前提。埋め込み元をポータルに限定する。 */
function resolveFrameAncestors(): string {
  const configured = (env.PARTNER_PREVIEW_FRAME_ANCESTORS ?? "").trim();
  // 未設定なら自己オリジンのみ＝実質どこにも埋め込めない（fail-closed）。
  return configured.length > 0 ? configured : "'self'";
}

export const surveyPreviewController = {
  /**
   * `GET /api/partner/surveys/:id/preview`
   *
   * 認証は他のパートナーAPIと同じ2ヘッダ。ただし **iframe から直接読む**ため、
   * ヘッダを付けられない。よってクエリ `?key=...&store_id=...` も受ける。
   * 値の比較は定数時間（`secureEquals`）で行う。
   */
  async preview(req: Request, res: Response): Promise<void> {
    const expected = env.PARTNER_API_KEY;
    if (!expected) {
      throw new HttpError(503, "partner API is not configured");
    }

    const presentedKey = String(
      req.header("x-partner-key") ?? (req.query.key as string | undefined) ?? ""
    );
    if (!presentedKey || !secureEquals(presentedKey, expected)) {
      throw new HttpError(401, "unauthorized");
    }

    const storeId = String(
      req.header("x-partner-store-id") ?? (req.query.store_id as string | undefined) ?? ""
    );
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) {
      throw new HttpError(400, "invalid store id");
    }

    const surveyId = String(req.params.id ?? "");
    // 所有者スコープ付きで引く。他店舗・不在はどちらも 404。
    const project = await projectRepository.getPartnerProject(surveyId, storeId);
    if (!project) {
      throw new HttpError(404, "survey not found");
    }

    const [questions, pageGroups] = await Promise.all([
      questionRepository.listByProject(project.id, { includeHidden: false }),
      questionPageGroupRepository.listByProject(project.id)
    ]);

    // 本番の回答画面と同じ前処理を通す（ここを省くと見た目がズレる）。
    const answerUiPreset = project.answer_ui_preset ?? "standard";
    const questionsForClient = questions.map((q) => {
      const question_config = q.question_config
        ? { ...q.question_config, options: applyAutoFreeText(q.question_config.options) }
        : q.question_config;
      return {
        ...q,
        question_config,
        presentation: resolveAnswerPresentation(
          {
            question_type: q.question_type,
            question_text: q.question_text,
            question_config
          },
          answerUiPreset
        )
      };
    });

    // iframe 埋め込みを許すのはポータルだけ。
    res.setHeader("Content-Security-Policy", `frame-ancestors ${resolveFrameAncestors()}`);
    // プレビューは常に最新を見せる（下書きを編集しながら見るため）。
    res.setHeader("Cache-Control", "no-store");

    res.render("liff/survey", {
      title: project.user_display_title || project.name,
      project,
      projectData: {
        id: project.id,
        name: project.user_display_title || project.name,
        display_mode: project.display_mode ?? "survey_question"
      },
      questions: questionsForClient,
      answerUiPreset,
      pageGroups,
      // session / assignment は作らない。テンプレートは null を許容する。
      sessionId: null,
      assignmentId: null,
      displayMode: project.display_mode ?? "survey_question",
      surveyPhase: "main",
      screeningFailMessage: "",
      completionMessage: project.completion_message?.trim() || null,
      liffId: env.LINE_LIFF_ID ?? "",
      liffAuthAvailable: false,
      authRequired: false,
      skipAllowed: true,
      isStoreSurvey: project.visibility_type === "private_store",
      experience: null,
      projectsUrl: "/liff/projects",
      consentUrl: null,
      /** ★プレビュー専用。送信・完了の導線を出さないための旗。 */
      previewMode: true
    });
  }
};
