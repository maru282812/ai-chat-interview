import {
  EXPERIENCE_DEFAULTS_KEY,
  appSettingsRepository,
} from "../repositories/appSettingsRepository";
import { projectRepository } from "../repositories/projectRepository";
import {
  type AnswerUiPresetValue,
  type ExperienceValue,
  type ResolvedExperience,
  resolveDefaultAnswerUiPreset,
  resolveExperience,
} from "../lib/experienceConfig";

/**
 * 若年層体験パック（Phase 0）の体験設定サービス。
 *
 * サーバー権威: フラグの解決は必ずここ（＝純関数 resolveExperience）で行い、
 * LIFF へは解決済み値だけを渡す。クライアントに決定順を持たせない。
 *
 * キャッシュ: 全体既定を 60 秒だけプロセス内に保持する。Vercel サーバーレスなので
 * インスタンスをまたいで効かないベストエフォート（管理画面の保存直後は自分のインスタンスだけ
 * 即時反映され、他インスタンスは最大 60 秒遅れる。設定値の性質上これで問題ない）。
 */

const CACHE_TTL_MS = 60_000;

let cachedGlobalRaw: Record<string, unknown> | null = null;
let cachedAt = 0;

function isCacheFresh(): boolean {
  return cachedGlobalRaw !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

/** 保存直後に呼ぶ（管理画面の POST 後）。 */
function invalidateCache(): void {
  cachedGlobalRaw = null;
  cachedAt = 0;
}

/**
 * 全体既定の生値。読み取りに失敗したら例外を投げる（管理画面が空フォームで
 * 保存してしまうのを防ぐため、ここでは握りつぶさない）。
 */
async function loadGlobalRaw(): Promise<Record<string, unknown>> {
  if (isCacheFresh()) return cachedGlobalRaw as Record<string, unknown>;
  const raw = (await appSettingsRepository.get(EXPERIENCE_DEFAULTS_KEY)) ?? {};
  cachedGlobalRaw = raw;
  cachedAt = Date.now();
  return raw;
}

/**
 * LIFF 描画用: 読み取り失敗でページを落とさない。
 * 設定が引けないときはコード内デフォルトで描画する（機能が既定値に戻るだけで回答は続行できる）。
 */
async function loadGlobalRawSafe(): Promise<Record<string, unknown>> {
  try {
    return await loadGlobalRaw();
  } catch {
    return {};
  }
}

export const experienceService = {
  /** 全体既定だけを解決した値（プロジェクトに紐付かないページ: projects / mypage / daily-survey 等）。 */
  async getGlobal(): Promise<ResolvedExperience> {
    return resolveExperience({}, await loadGlobalRawSafe());
  },

  /** プロジェクト上書きまで解決した値。 */
  async getResolvedForProject(projectId: string): Promise<ResolvedExperience> {
    const [globalRaw, projectConfig] = await Promise.all([
      loadGlobalRawSafe(),
      projectRepository
        .getById(projectId)
        .then((p) => (p as { experience_config?: unknown }).experience_config ?? {})
        .catch(() => ({})),
    ]);
    return resolveExperience(projectConfig, globalRaw);
  },

  /**
   * 既に project 行を読み込み済みの呼び出し元（liffController.surveyPage 等）向け。
   * 追加クエリを発行しないので LIFF の描画パスではこちらを使う。
   */
  async resolveForProjectConfig(experienceConfig: unknown): Promise<ResolvedExperience> {
    return resolveExperience(experienceConfig ?? {}, await loadGlobalRawSafe());
  },

  /** 管理画面 GET 用。読み取り失敗は例外のまま投げる（空フォームで保存させない）。 */
  async getGlobalForAdmin(): Promise<ResolvedExperience> {
    return resolveExperience({}, await loadGlobalRaw());
  },

  /** 管理画面 POST 用。丸ごと置き換え＋キャッシュ破棄。 */
  async saveGlobal(values: Record<string, ExperienceValue>): Promise<void> {
    await appSettingsRepository.upsert(EXPERIENCE_DEFAULTS_KEY, values);
    invalidateCache();
  },

  /**
   * C-3: answer_ui_preset の全体既定。researchForm で「全体既定に従う」が選ばれたとき、
   * および新規プロジェクト作成時に**保存時点で実体化**するために使う
   * （projects.answer_ui_preset は not null default 'standard' のまま。実行時解決を増やさない）。
   */
  async getDefaultAnswerUiPreset(): Promise<AnswerUiPresetValue> {
    return resolveDefaultAnswerUiPreset(await loadGlobalRawSafe());
  },

  /** テスト・管理画面保存直後の明示破棄用。 */
  invalidateCache,
};
