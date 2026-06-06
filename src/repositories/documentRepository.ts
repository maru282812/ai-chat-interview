import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

export interface Document {
  id: string;
  document_type: string;
  title: string;
  description: string | null;
  current_version_id: string | null;
  is_active: boolean;
  is_required_global: boolean;
  created_at: string;
  updated_at: string;
  // JOINで結合する場合
  current_version?: DocumentVersion | null;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_no: string;
  content: string;
  change_reason: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  created_by: string;
}

export interface DocumentCreateInput {
  document_type: string;
  title: string;
  description?: string;
  is_active?: boolean;
  is_required_global?: boolean;
}

export interface DocumentVersionCreateInput {
  document_id: string;
  version_no: string;
  content: string;
  change_reason?: string;
  effective_from?: string;
  created_by?: string;
}

export const documentRepository = {
  async list(): Promise<Document[]> {
    const { data, error } = await supabase
      .from("documents")
      .select(`
        *,
        current_version:document_versions!fk_documents_current_version(
          id, version_no, effective_from, created_at, created_by
        )
      `)
      .order("document_type")
      .order("title");
    throwIfError(error);
    return (data ?? []) as Document[];
  },

  async getById(id: string): Promise<Document | null> {
    const { data, error } = await supabase
      .from("documents")
      .select(`
        *,
        current_version:document_versions!fk_documents_current_version(*)
      `)
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as Document | null) ?? null;
  },

  async listGlobalRequired(): Promise<Document[]> {
    const { data, error } = await supabase
      .from("documents")
      .select(`
        *,
        current_version:document_versions!fk_documents_current_version(*)
      `)
      .eq("is_active", true)
      .eq("is_required_global", true)
      .order("document_type");
    throwIfError(error);
    return (data ?? []) as Document[];
  },

  async create(input: DocumentCreateInput): Promise<Document> {
    const { data, error } = await supabase
      .from("documents")
      .insert({
        document_type: input.document_type,
        title: input.title,
        description: input.description ?? null,
        is_active: input.is_active ?? true,
        is_required_global: input.is_required_global ?? false,
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as Document;
  },

  async update(id: string, input: Partial<DocumentCreateInput>): Promise<void> {
    const { error } = await supabase
      .from("documents")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id);
    throwIfError(error);
  },

  async setCurrentVersion(documentId: string, versionId: string): Promise<void> {
    const { error } = await supabase
      .from("documents")
      .update({ current_version_id: versionId, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    throwIfError(error);
  },

  // ── バージョン操作 ──────────────────────────────────────────────────────

  async listVersions(documentId: string): Promise<DocumentVersion[]> {
    const { data, error } = await supabase
      .from("document_versions")
      .select("*")
      .eq("document_id", documentId)
      .order("effective_from", { ascending: false });
    throwIfError(error);
    return (data ?? []) as DocumentVersion[];
  },

  async getVersion(versionId: string): Promise<DocumentVersion | null> {
    const { data, error } = await supabase
      .from("document_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    throwIfError(error);
    return (data as DocumentVersion | null) ?? null;
  },

  async createVersion(input: DocumentVersionCreateInput): Promise<DocumentVersion> {
    const { data, error } = await supabase
      .from("document_versions")
      .insert({
        document_id: input.document_id,
        version_no: input.version_no,
        content: input.content,
        change_reason: input.change_reason ?? null,
        effective_from: input.effective_from ?? new Date().toISOString(),
        created_by: input.created_by ?? "admin",
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as DocumentVersion;
  },

  async closeVersion(versionId: string, effectiveTo: string): Promise<void> {
    const { error } = await supabase
      .from("document_versions")
      .update({ effective_to: effectiveTo })
      .eq("id", versionId);
    throwIfError(error);
  },

  // ── 案件×書類 関連 ──────────────────────────────────────────────────────

  async listProjectDocuments(projectId: string): Promise<Array<{
    document_id: string;
    is_required: boolean;
    sort_order: number;
    document: Document;
  }>> {
    const { data, error } = await supabase
      .from("project_document_requirements")
      .select(`
        document_id, is_required, sort_order,
        document:documents(
          *,
          current_version:document_versions!fk_documents_current_version(*)
        )
      `)
      .eq("project_id", projectId)
      .order("sort_order");
    throwIfError(error);
    return (data ?? []) as unknown as Array<{
      document_id: string;
      is_required: boolean;
      sort_order: number;
      document: Document;
    }>;
  },

  async upsertProjectDocument(
    projectId: string,
    documentId: string,
    isRequired: boolean,
    sortOrder: number
  ): Promise<void> {
    const { error } = await supabase
      .from("project_document_requirements")
      .upsert(
        { project_id: projectId, document_id: documentId, is_required: isRequired, sort_order: sortOrder },
        { onConflict: "project_id,document_id" }
      );
    throwIfError(error);
  },

  async removeProjectDocument(projectId: string, documentId: string): Promise<void> {
    const { error } = await supabase
      .from("project_document_requirements")
      .delete()
      .eq("project_id", projectId)
      .eq("document_id", documentId);
    throwIfError(error);
  },
};
