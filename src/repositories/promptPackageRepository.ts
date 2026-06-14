import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";
import type { AIPromptPolicy, AIPromptTemplateMap } from "../types/domain";

export interface PromptPackage {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category?: string | null;
  created_at: string;
  updated_at: string;
  // JOIN で結合
  published_version?: PromptPackageVersion | null;
  versions_count?: number;
  /** プロジェクト編集画面の2段選択用: 選択可能（published / archived）なバージョン一覧（version_no 降順） */
  selectable_versions?: PromptPackageVersionSummary[];
  /** このパッケージ（任意バージョン）を package モードで利用中のプロジェクト数 */
  using_projects_count?: number;
}

export interface PromptPackageVersionSummary {
  id: string;
  version_no: number;
  status: "draft" | "published" | "archived";
  change_note: string | null;
  updated_at: string;
}

export interface PromptPackageVersion {
  id: string;
  package_id: string;
  version_no: number;
  status: "draft" | "published" | "archived";
  policy_json: AIPromptPolicy | null;
  templates_json: AIPromptTemplateMap | null;
  change_note: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptPackageCreateInput {
  slug: string;
  name: string;
  description?: string | null;
  category?: string | null;
}

export interface PromptPackageUpdateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
}

export interface PromptPackageVersionCreateInput {
  package_id: string;
  policy_json?: AIPromptPolicy | null;
  templates_json?: AIPromptTemplateMap | null;
  change_note?: string | null;
}

export interface PromptPackageVersionUpdateInput {
  policy_json?: AIPromptPolicy | null;
  templates_json?: AIPromptTemplateMap | null;
  change_note?: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  ai_prompt_mode: string;
  ai_prompt_package_version_id: string | null;
}

export interface ArchivedVersionUsage {
  project: ProjectSummary;
  archivedVersionNo: number | null;
  fallbackVersionId: string | null;
  fallbackVersionNo: number | null;
}

export const promptPackageRepository = {
  async list(): Promise<PromptPackage[]> {
    const { data, error } = await supabase
      .from("prompt_packages")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    const packages = (data ?? []) as PromptPackage[];

    // 公開中バージョンを各パッケージに付与
    if (packages.length === 0) return packages;
    const packageIds = packages.map((p) => p.id);
    const { data: versions, error: vErr } = await supabase
      .from("prompt_package_versions")
      .select("*")
      .in("package_id", packageIds)
      .order("version_no", { ascending: false });
    throwIfError(vErr);

    const versionMap = new Map<string, PromptPackageVersion[]>();
    for (const v of (versions ?? []) as PromptPackageVersion[]) {
      const list = versionMap.get(v.package_id) ?? [];
      list.push(v);
      versionMap.set(v.package_id, list);
    }

    // 利用プロジェクト数（package モードのプロジェクトをバージョン経由で集計）
    const versionToPackage = new Map<string, string>();
    for (const v of (versions ?? []) as PromptPackageVersion[]) {
      versionToPackage.set(v.id, v.package_id);
    }
    const usageCounts = new Map<string, number>();
    if (versionToPackage.size > 0) {
      const { data: usingProjects, error: upErr } = await supabase
        .from("projects")
        .select("ai_prompt_package_version_id")
        .eq("ai_prompt_mode", "package")
        .in("ai_prompt_package_version_id", [...versionToPackage.keys()]);
      throwIfError(upErr);
      for (const p of (usingProjects ?? []) as { ai_prompt_package_version_id: string | null }[]) {
        const pkgId = p.ai_prompt_package_version_id ? versionToPackage.get(p.ai_prompt_package_version_id) : undefined;
        if (pkgId) usageCounts.set(pkgId, (usageCounts.get(pkgId) ?? 0) + 1);
      }
    }

    return packages.map((p) => {
      const vs = versionMap.get(p.id) ?? [];
      return {
        ...p,
        published_version: vs.find((v) => v.status === "published") ?? null,
        versions_count: vs.length,
        // draft は適用不可のため選択肢から除外（resolvePackageVersionIdFromRequest の検証と整合）
        selectable_versions: vs
          .filter((v) => v.status !== "draft")
          .map((v) => ({ id: v.id, version_no: v.version_no, status: v.status, change_note: v.change_note, updated_at: v.updated_at })),
        using_projects_count: usageCounts.get(p.id) ?? 0,
      };
    });
  },

  /** 既存パッケージの slug を全件返す（slug 連番採番の衝突判定に使う軽量クエリ）。 */
  async listSlugs(): Promise<string[]> {
    const { data, error } = await supabase.from("prompt_packages").select("slug");
    throwIfError(error);
    return ((data ?? []) as { slug: string }[]).map((r) => r.slug);
  },

  async getById(id: string): Promise<PromptPackage | null> {
    const { data, error } = await supabase
      .from("prompt_packages")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as PromptPackage | null) ?? null;
  },

  async create(input: PromptPackageCreateInput): Promise<PromptPackage> {
    const { data, error } = await supabase
      .from("prompt_packages")
      .insert({
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as PromptPackage;
  },

  async update(id: string, input: PromptPackageUpdateInput): Promise<void> {
    const { error } = await supabase
      .from("prompt_packages")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id);
    throwIfError(error);
  },

  async clone(sourceId: string, newSlug: string, newName: string): Promise<PromptPackage> {
    // 複製元パッケージの最新バージョン（published 優先 → draft の最新）を取得
    const { data: srcVersions, error: svErr } = await supabase
      .from("prompt_package_versions")
      .select("*")
      .eq("package_id", sourceId)
      .order("version_no", { ascending: false });
    throwIfError(svErr);

    const src = (srcVersions ?? []) as PromptPackageVersion[];
    const baseVersion = src.find((v) => v.status === "published") ?? src[0] ?? null;

    // 新パッケージ作成
    const newPkg = await this.create({ slug: newSlug, name: newName });

    // 設定を引き継いだ draft バージョン v1 を作成
    if (baseVersion) {
      await this.createVersion({
        package_id: newPkg.id,
        policy_json: baseVersion.policy_json,
        templates_json: baseVersion.templates_json,
        change_note: `「${newName}」への複製（元: v${baseVersion.version_no}）`,
      });
    }

    return newPkg;
  },

  // ── バージョン操作 ─────────────────────────────────────

  async listVersions(packageId: string): Promise<PromptPackageVersion[]> {
    const { data, error } = await supabase
      .from("prompt_package_versions")
      .select("*")
      .eq("package_id", packageId)
      .order("version_no", { ascending: false });
    throwIfError(error);
    return (data ?? []) as PromptPackageVersion[];
  },

  async getVersionById(versionId: string): Promise<PromptPackageVersion | null> {
    const { data, error } = await supabase
      .from("prompt_package_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    throwIfError(error);
    return (data as PromptPackageVersion | null) ?? null;
  },

  async createVersion(input: PromptPackageVersionCreateInput): Promise<PromptPackageVersion> {
    // 採番: 同一パッケージの MAX(version_no) + 1
    const { data: maxRow } = await supabase
      .from("prompt_package_versions")
      .select("version_no")
      .eq("package_id", input.package_id)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextNo = maxRow ? (maxRow as { version_no: number }).version_no + 1 : 1;

    const { data, error } = await supabase
      .from("prompt_package_versions")
      .insert({
        package_id: input.package_id,
        version_no: nextNo,
        status: "draft",
        policy_json: input.policy_json ?? null,
        templates_json: input.templates_json ?? null,
        change_note: input.change_note ?? null,
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as PromptPackageVersion;
  },

  async updateVersion(versionId: string, input: PromptPackageVersionUpdateInput): Promise<void> {
    const { error } = await supabase
      .from("prompt_package_versions")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", versionId)
      .eq("status", "draft"); // draft のみ更新可
    throwIfError(error);
  },

  async publishVersion(versionId: string): Promise<void> {
    // 対象バージョンのパッケージIDを取得
    const { data: target, error: tErr } = await supabase
      .from("prompt_package_versions")
      .select("package_id")
      .eq("id", versionId)
      .single();
    throwIfError(tErr);
    const packageId = (target as { package_id: string }).package_id;

    // 同一パッケージの既存 published → archived
    const { error: archErr } = await supabase
      .from("prompt_package_versions")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("package_id", packageId)
      .eq("status", "published");
    throwIfError(archErr);

    // 対象を published に
    const { error } = await supabase
      .from("prompt_package_versions")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", versionId);
    throwIfError(error);
  },

  async archiveVersion(versionId: string): Promise<void> {
    const { error } = await supabase
      .from("prompt_package_versions")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", versionId);
    throwIfError(error);
  },

  // ── Phase 4: 逆引き・状態確認 ──────────────────────────────────────

  /** 特定パッケージ（任意バージョン）を使用中のプロジェクト一覧 */
  async getProjectsUsingPackage(packageId: string): Promise<ProjectSummary[]> {
    // 対象パッケージの全バージョン ID を取得
    const { data: versions, error: vErr } = await supabase
      .from("prompt_package_versions")
      .select("id")
      .eq("package_id", packageId);
    throwIfError(vErr);
    const versionIds = (versions ?? []).map((v: { id: string }) => v.id);
    if (versionIds.length === 0) return [];

    const { data, error } = await supabase
      .from("projects")
      .select("id, name, status, ai_prompt_mode, ai_prompt_package_version_id")
      .eq("ai_prompt_mode", "package")
      .in("ai_prompt_package_version_id", versionIds);
    throwIfError(error);
    return (data ?? []) as ProjectSummary[];
  },

  /** 特定バージョンを使用中のプロジェクト一覧 */
  async getProjectsUsingVersion(versionId: string): Promise<ProjectSummary[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, status, ai_prompt_mode, ai_prompt_package_version_id")
      .eq("ai_prompt_mode", "package")
      .eq("ai_prompt_package_version_id", versionId);
    throwIfError(error);
    return (data ?? []) as ProjectSummary[];
  },

  /** パッケージの公開中バージョンを取得 */
  async getPublishedVersionByPackageId(packageId: string): Promise<PromptPackageVersion | null> {
    const { data, error } = await supabase
      .from("prompt_package_versions")
      .select("*")
      .eq("package_id", packageId)
      .eq("status", "published")
      .maybeSingle();
    throwIfError(error);
    return (data as PromptPackageVersion | null) ?? null;
  },

  /** archived バージョンを使用中のプロジェクトと、fallback 先バージョン情報を返す */
  async getProjectsWithArchivedVersion(): Promise<ArchivedVersionUsage[]> {
    // archived バージョン一覧
    const { data: archivedVersions, error: avErr } = await supabase
      .from("prompt_package_versions")
      .select("id, package_id, version_no")
      .eq("status", "archived");
    throwIfError(avErr);
    if (!archivedVersions || archivedVersions.length === 0) return [];

    const archivedIds = (archivedVersions as { id: string; package_id: string; version_no: number }[]).map((v) => v.id);

    // archived バージョンを使用中のプロジェクト
    const { data: projects, error: pErr } = await supabase
      .from("projects")
      .select("id, name, status, ai_prompt_mode, ai_prompt_package_version_id")
      .eq("ai_prompt_mode", "package")
      .in("ai_prompt_package_version_id", archivedIds);
    throwIfError(pErr);
    if (!projects || projects.length === 0) return [];

    // 各プロジェクトに対して archived バージョン情報と fallback 先を付与
    const packageIds = [...new Set((archivedVersions as { package_id: string }[]).map((v) => v.package_id))];
    const { data: publishedVersions, error: pvErr } = await supabase
      .from("prompt_package_versions")
      .select("id, package_id, version_no")
      .in("package_id", packageIds)
      .eq("status", "published");
    throwIfError(pvErr);

    const publishedMap = new Map<string, { id: string; version_no: number }>();
    for (const pv of (publishedVersions ?? []) as { id: string; package_id: string; version_no: number }[]) {
      publishedMap.set(pv.package_id, { id: pv.id, version_no: pv.version_no });
    }

    const archivedMap = new Map<string, { package_id: string; version_no: number }>();
    for (const av of archivedVersions as { id: string; package_id: string; version_no: number }[]) {
      archivedMap.set(av.id, { package_id: av.package_id, version_no: av.version_no });
    }

    return (projects as ProjectSummary[]).map((p) => {
      const archivedInfo = archivedMap.get(p.ai_prompt_package_version_id ?? "");
      const fallback = archivedInfo ? publishedMap.get(archivedInfo.package_id) ?? null : null;
      return {
        project: p,
        archivedVersionNo: archivedInfo?.version_no ?? null,
        fallbackVersionId: fallback?.id ?? null,
        fallbackVersionNo: fallback?.version_no ?? null,
      };
    });
  },
};
