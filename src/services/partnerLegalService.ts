import { HttpError } from "../lib/http";
import { documentRepository } from "../repositories/documentRepository";

/**
 * partnerLegalService.ts
 *
 * 会員ポータル（hibi-portal）向けの法務文書を配信する（docs/partner-api.md §5.8）。
 *
 * 本文の正は ACI の documents / document_versions（migration 105 で投入）。
 * 運営は ACI 管理画面「書類」で新版を作るだけでよく、hibi は毎回ここから現在版を取る。
 * 同意の記録は hibi 側（legal_consents）で行うので、ACI は本文と版を返すだけ。
 *
 * 版番号の規約（hibi 側の判定と対になる）:
 *   X.Y[-suffix]。メジャー X が上がると店舗の再同意、マイナー Y は告知のみ。
 *   -draft は弁護士確認前。
 */

/** 会員利用規約（店舗向け）の固定 document id（migration 105）。 */
export const PORTAL_STORE_TERMS_DOCUMENT_ID = "d1000000-0000-0000-0000-000000000001";

export interface PartnerLegalDocumentView {
  document_id: string;
  title: string;
  version_no: string;
  /** Markdown 本文 */
  content: string;
  change_reason: string | null;
  /** 施行日時（ISO） */
  effective_from: string;
  /** 直近の版履歴（新しい順・本文は含めない） */
  versions: Array<{ version_no: string; effective_from: string; change_reason: string | null }>;
}

export const partnerLegalService = {
  /** 会員利用規約（店舗向け）の現在版。無効化されている・版が無い場合は 404。 */
  async getStoreTerms(): Promise<PartnerLegalDocumentView> {
    const doc = await documentRepository.getById(PORTAL_STORE_TERMS_DOCUMENT_ID);
    if (!doc || !doc.is_active || !doc.current_version_id) {
      throw new HttpError(404, "store terms not found");
    }
    const current = await documentRepository.getVersion(doc.current_version_id);
    if (!current) {
      throw new HttpError(404, "store terms not found");
    }
    const versions = await documentRepository.listVersions(doc.id);
    return {
      document_id: doc.id,
      title: doc.title,
      version_no: current.version_no,
      content: current.content,
      change_reason: current.change_reason,
      effective_from: current.effective_from,
      versions: versions
        .slice()
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
        .slice(0, 20)
        .map((version) => ({
          version_no: version.version_no,
          effective_from: version.effective_from,
          change_reason: version.change_reason
        }))
    };
  }
};
