import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

export interface UserConsentRecord {
  id: string;
  line_user_id: string;
  document_id: string;
  document_version_id: string;
  project_id: string | null;
  consented_at: string;
  consent_source: string;
  ip_address: string | null;
  user_agent: string | null;
  deleted_at: string | null;
  // JOIN用
  document?: { id: string; title: string; document_type: string } | null;
  document_version?: { id: string; version_no: string; content: string } | null;
}

export interface ConsentRecordCreateInput {
  line_user_id: string;
  document_id: string;
  document_version_id: string;
  project_id?: string | null;
  consent_source?: string;
  ip_address?: string | null;
  user_agent?: string | null;
}

export const userConsentRecordRepository = {
  // ユーザーの最新同意レコードを書類IDごとに取得
  async listLatestByUser(lineUserId: string): Promise<UserConsentRecord[]> {
    const { data, error } = await supabase
      .from("user_consent_records")
      .select(`
        *,
        document:documents(id, title, document_type),
        document_version:document_versions(id, version_no)
      `)
      .eq("line_user_id", lineUserId)
      .is("deleted_at", null)
      .order("consented_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as UserConsentRecord[];
  },

  // 特定書類・バージョンへの同意確認
  async findConsent(
    lineUserId: string,
    documentId: string,
    versionId: string,
    projectId?: string | null
  ): Promise<UserConsentRecord | null> {
    let query = supabase
      .from("user_consent_records")
      .select("*")
      .eq("line_user_id", lineUserId)
      .eq("document_id", documentId)
      .eq("document_version_id", versionId)
      .is("deleted_at", null);

    if (projectId) {
      query = query.eq("project_id", projectId);
    } else {
      query = query.is("project_id", null);
    }

    const { data, error } = await query.maybeSingle();
    throwIfError(error);
    return (data as UserConsentRecord | null) ?? null;
  },

  async create(input: ConsentRecordCreateInput): Promise<UserConsentRecord> {
    const { data, error } = await supabase
      .from("user_consent_records")
      .insert({
        line_user_id: input.line_user_id,
        document_id: input.document_id,
        document_version_id: input.document_version_id,
        project_id: input.project_id ?? null,
        consent_source: input.consent_source ?? "liff",
        ip_address: input.ip_address ?? null,
        user_agent: input.user_agent ?? null,
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as UserConsentRecord;
  },

  // 管理画面監査用: 書類別同意者一覧
  async listByDocument(
    documentId: string,
    versionId?: string,
    limit = 100,
    offset = 0
  ): Promise<{ records: UserConsentRecord[]; total: number }> {
    let query = supabase
      .from("user_consent_records")
      .select("*, document_version:document_versions(id, version_no)", { count: "exact" })
      .eq("document_id", documentId)
      .is("deleted_at", null);

    if (versionId) {
      query = query.eq("document_version_id", versionId);
    }

    const { data, error, count } = await query
      .order("consented_at", { ascending: false })
      .range(offset, offset + limit - 1);

    throwIfError(error);
    return {
      records: (data ?? []) as UserConsentRecord[],
      total: count ?? 0,
    };
  },

  // ユーザー別同意履歴（管理画面監査）
  async listByLineUserId(
    lineUserId: string,
    limit = 50
  ): Promise<UserConsentRecord[]> {
    const { data, error } = await supabase
      .from("user_consent_records")
      .select(`
        *,
        document:documents(id, title, document_type),
        document_version:document_versions(id, version_no)
      `)
      .eq("line_user_id", lineUserId)
      .is("deleted_at", null)
      .order("consented_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as UserConsentRecord[];
  },

  // 案件別同意履歴
  async listByProject(
    projectId: string,
    limit = 200
  ): Promise<UserConsentRecord[]> {
    const { data, error } = await supabase
      .from("user_consent_records")
      .select(`
        *,
        document:documents(id, title, document_type),
        document_version:document_versions(id, version_no)
      `)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("consented_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as UserConsentRecord[];
  },

  // 統計エクスポートの同意フィルタ用: 複数ユーザーの有効な同意レコードを一括取得 (§19)
  async listActiveByLineUserIds(lineUserIds: string[]): Promise<UserConsentRecord[]> {
    if (lineUserIds.length === 0) {
      return [];
    }
    const { data, error } = await supabase
      .from("user_consent_records")
      .select("*, document:documents(id, title, document_type)")
      .in("line_user_id", lineUserIds)
      .is("deleted_at", null);
    throwIfError(error);
    return (data ?? []) as UserConsentRecord[];
  },

  // CSV出力用: 全件取得（フィルタ可）
  async listForExport(filters: {
    documentId?: string;
    versionId?: string;
    projectId?: string;
    lineUserId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<UserConsentRecord[]> {
    let query = supabase
      .from("user_consent_records")
      .select(`
        *,
        document:documents(id, title, document_type),
        document_version:document_versions(id, version_no)
      `)
      .is("deleted_at", null)
      .order("consented_at", { ascending: false });

    if (filters.documentId) query = query.eq("document_id", filters.documentId);
    if (filters.versionId) query = query.eq("document_version_id", filters.versionId);
    if (filters.projectId) query = query.eq("project_id", filters.projectId);
    if (filters.lineUserId) query = query.eq("line_user_id", filters.lineUserId);
    if (filters.fromDate) query = query.gte("consented_at", filters.fromDate);
    if (filters.toDate) query = query.lte("consented_at", filters.toDate);

    const { data, error } = await query.limit(10000);
    throwIfError(error);
    return (data ?? []) as UserConsentRecord[];
  },
};
