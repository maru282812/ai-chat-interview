import { documentRepository } from "../repositories/documentRepository";
import { userConsentRecordRepository } from "../repositories/userConsentRecordRepository";
import type { Document } from "../repositories/documentRepository";

export interface ConsentStatus {
  document: Document;
  consented: boolean;
  consentedAt: string | null;
  consentedVersionId: string | null;
  consentedVersionNo: string | null;
  isLatestVersion: boolean;
}

export interface PendingConsent {
  document: Document;
  versionId: string;
  versionNo: string;
  content: string;
  isRequired: boolean;
}

export const consentService = {
  // ── グローバル同意チェック ────────────────────────────────────────────────

  // ユーザーがグローバル必須書類の最新版に全て同意済みか確認する。
  // 未同意の書類リストを返す（空配列 = 全て同意済み）。
  async getPendingGlobalConsents(lineUserId: string): Promise<PendingConsent[]> {
    const requiredDocs = await documentRepository.listGlobalRequired();
    if (requiredDocs.length === 0) return [];

    const existingConsents = await userConsentRecordRepository.listLatestByUser(lineUserId);
    const consentMap = new Map<string, string>(); // document_id -> consented version_id
    for (const record of existingConsents) {
      if (!record.project_id) {
        // グローバル同意のみ（最初のレコードが最新）
        if (!consentMap.has(record.document_id)) {
          consentMap.set(record.document_id, record.document_version_id);
        }
      }
    }

    const pending: PendingConsent[] = [];
    for (const doc of requiredDocs) {
      if (!doc.current_version_id || !doc.current_version) continue;
      const consentedVersionId = consentMap.get(doc.id);
      if (consentedVersionId !== doc.current_version_id) {
        pending.push({
          document: doc,
          versionId: doc.current_version.id,
          versionNo: doc.current_version.version_no,
          content: doc.current_version.content,
          isRequired: true,
        });
      }
    }
    return pending;
  },

  // ── 案件別同意チェック ────────────────────────────────────────────────────

  async getPendingProjectConsents(
    lineUserId: string,
    projectId: string
  ): Promise<PendingConsent[]> {
    const projectDocs = await documentRepository.listProjectDocuments(projectId);
    if (projectDocs.length === 0) return [];

    const existingConsents = await userConsentRecordRepository.listLatestByUser(lineUserId);
    // project_id が一致するもの + グローバル同意で代替できるものを確認
    const consentMap = new Map<string, string>(); // document_id -> version_id
    for (const record of existingConsents) {
      if (record.project_id === projectId || !record.project_id) {
        if (!consentMap.has(record.document_id)) {
          consentMap.set(record.document_id, record.document_version_id);
        }
      }
    }

    const pending: PendingConsent[] = [];
    for (const { document: doc, is_required } of projectDocs) {
      if (!doc.current_version_id || !doc.current_version) continue;
      const consentedVersionId = consentMap.get(doc.id);
      if (consentedVersionId !== doc.current_version_id) {
        pending.push({
          document: doc,
          versionId: doc.current_version.id,
          versionNo: doc.current_version.version_no,
          content: doc.current_version.content,
          isRequired: is_required,
        });
      }
    }
    return pending;
  },

  // ── 同意登録 ──────────────────────────────────────────────────────────────

  async recordConsent(
    lineUserId: string,
    documentId: string,
    versionId: string,
    options: {
      projectId?: string | null;
      source?: string;
      ipAddress?: string | null;
      userAgent?: string | null;
    } = {}
  ): Promise<void> {
    await userConsentRecordRepository.create({
      line_user_id: lineUserId,
      document_id: documentId,
      document_version_id: versionId,
      project_id: options.projectId ?? null,
      consent_source: options.source ?? "liff",
      ip_address: options.ipAddress ?? null,
      user_agent: options.userAgent ?? null,
    });
  },

  // 複数書類への一括同意登録
  async recordBatchConsents(
    lineUserId: string,
    items: Array<{ documentId: string; versionId: string; projectId?: string | null }>,
    options: { source?: string; ipAddress?: string | null; userAgent?: string | null } = {}
  ): Promise<void> {
    for (const item of items) {
      await userConsentRecordRepository.create({
        line_user_id: lineUserId,
        document_id: item.documentId,
        document_version_id: item.versionId,
        project_id: item.projectId ?? null,
        consent_source: options.source ?? "liff",
        ip_address: options.ipAddress ?? null,
        user_agent: options.userAgent ?? null,
      });
    }
  },

  // ── マイページ用: 同意状況サマリー ───────────────────────────────────────

  async getUserConsentStatuses(lineUserId: string): Promise<ConsentStatus[]> {
    const [allDocs, records] = await Promise.all([
      documentRepository.list(),
      userConsentRecordRepository.listLatestByUser(lineUserId),
    ]);

    // グローバル書類のみ（案件別は除外）
    const globalDocs = allDocs.filter((d) => d.is_required_global && d.is_active);

    const consentMap = new Map<string, { versionId: string; versionNo: string; consentedAt: string }>();
    for (const record of records) {
      if (!record.project_id && !consentMap.has(record.document_id)) {
        consentMap.set(record.document_id, {
          versionId: record.document_version_id,
          versionNo: (record.document_version as { version_no?: string } | null)?.version_no ?? "",
          consentedAt: record.consented_at,
        });
      }
    }

    return globalDocs.map((doc) => {
      const consent = consentMap.get(doc.id);
      const isLatest = consent?.versionId === doc.current_version_id;
      return {
        document: doc,
        consented: !!consent,
        consentedAt: consent?.consentedAt ?? null,
        consentedVersionId: consent?.versionId ?? null,
        consentedVersionNo: consent?.versionNo ?? null,
        isLatestVersion: isLatest,
      };
    });
  },

  // ── バージョン公開処理 ────────────────────────────────────────────────────

  async publishNewVersion(
    documentId: string,
    input: {
      versionNo: string;
      content: string;
      changeReason?: string;
      createdBy?: string;
    }
  ): Promise<void> {
    const doc = await documentRepository.getById(documentId);
    if (!doc) throw new Error("書類が見つかりません");

    const now = new Date().toISOString();

    // 現在のバージョンの終了日時を設定
    if (doc.current_version_id) {
      await documentRepository.closeVersion(doc.current_version_id, now);
    }

    // 新バージョンを作成
    const newVersion = await documentRepository.createVersion({
      document_id: documentId,
      version_no: input.versionNo,
      content: input.content,
      change_reason: input.changeReason,
      effective_from: now,
      created_by: input.createdBy ?? "admin",
    });

    // 書類のcurrent_version_idを更新
    await documentRepository.setCurrentVersion(documentId, newVersion.id);
  },
};
