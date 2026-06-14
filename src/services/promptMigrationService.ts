// ============================================================
// Phase G: custom モード整理のための移行レポート生成
//   - 既存 custom プロジェクトの一覧化と移行候補の提示
//   - package モードだがバージョン未設定（package未設定）の検出
//   - archived バージョン参照（実行時 fallback 動作）の検出
//   - orphan 参照（参照先が draft / 削除済み）の検出
//
// 本ファイルの中核 `buildPromptMigrationReport` は DB 非依存の純関数。
// データ取得は controller 側で行い、ここでは分類のみ担う（テスト容易性のため）。
// ============================================================

export interface MigrationProjectInput {
  id: string;
  name: string;
  status: string;
  ai_prompt_mode: string | null;
  ai_prompt_package_version_id: string | null;
  ai_prompt_policy_json: unknown;
  ai_prompt_templates_json: unknown;
}

export interface ReferencedVersionMeta {
  status: "draft" | "published" | "archived";
  version_no: number;
  package_id: string;
}

export interface BuildMigrationReportInput {
  projects: MigrationProjectInput[];
  /** package モードのプロジェクトが参照するバージョンのメタ情報（version_id → meta） */
  versionMetaById: Map<string, ReferencedVersionMeta>;
  /** 各パッケージの公開中バージョン番号（package_id → version_no）。fallback 先表示用 */
  publishedVersionNoByPackage: Map<string, number>;
}

export interface CustomProjectRow {
  id: string;
  name: string;
  status: string;
  /** ai_prompt_templates_json を直持ちしているか（専用パッケージ化の判断材料） */
  hasTemplates: boolean;
  /** ai_prompt_policy_json に有効な設定があるか */
  hasPolicy: boolean;
  /** 推奨移行アクション */
  suggestion: string;
}

export interface PackageUnsetRow {
  id: string;
  name: string;
  status: string;
}

export interface ArchivedRefRow {
  id: string;
  name: string;
  status: string;
  archivedVersionNo: number;
  hasFallback: boolean;
  fallbackVersionNo: number | null;
}

export interface OrphanRefRow {
  id: string;
  name: string;
  status: string;
  versionId: string;
  /** "missing"（参照先なし） | "draft"（未公開を参照） */
  reason: "missing" | "draft";
}

export interface PromptMigrationReport {
  customProjects: CustomProjectRow[];
  packageUnsetProjects: PackageUnsetRow[];
  archivedRefProjects: ArchivedRefRow[];
  orphanRefProjects: OrphanRefRow[];
  counts: {
    total: number;
    package: number;
    custom: number;
    packageUnset: number;
    archivedRef: number;
    orphanRef: number;
    /** 何らかの対応が必要なプロジェクト数（custom + packageUnset + archivedRef + orphanRef の重複なし合計） */
    needsAttention: number;
  };
}

/** policy_json が「実質的な設定を持つ」か判定（空オブジェクト・null は false） */
function hasMeaningfulPolicy(policy: unknown): boolean {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return false;
  return Object.keys(policy as Record<string, unknown>).length > 0;
}

/** templates_json が定義を持つか判定 */
function hasMeaningfulTemplates(templates: unknown): boolean {
  if (!templates || typeof templates !== "object" || Array.isArray(templates)) return false;
  return Object.keys(templates as Record<string, unknown>).length > 0;
}

function suggestForCustom(hasTemplates: boolean, hasPolicy: boolean): string {
  if (hasTemplates) {
    return "プロンプト本文を直持ち。専用パッケージを作成し本文を移送してから package へ切替推奨。";
  }
  if (hasPolicy) {
    return "方針(policy)のみ保有。標準パッケージ＋個別オーバーライドへ移行可能。";
  }
  return "個別設定なし。公開済みパッケージを割り当てるだけで移行可能。";
}

export function buildPromptMigrationReport(input: BuildMigrationReportInput): PromptMigrationReport {
  const { projects, versionMetaById, publishedVersionNoByPackage } = input;

  const customProjects: CustomProjectRow[] = [];
  const packageUnsetProjects: PackageUnsetRow[] = [];
  const archivedRefProjects: ArchivedRefRow[] = [];
  const orphanRefProjects: OrphanRefRow[] = [];

  let packageCount = 0;

  for (const p of projects) {
    const mode = p.ai_prompt_mode === "package" ? "package" : "custom";

    if (mode === "custom") {
      const hasTemplates = hasMeaningfulTemplates(p.ai_prompt_templates_json);
      const hasPolicy = hasMeaningfulPolicy(p.ai_prompt_policy_json);
      customProjects.push({
        id: p.id,
        name: p.name,
        status: p.status,
        hasTemplates,
        hasPolicy,
        suggestion: suggestForCustom(hasTemplates, hasPolicy),
      });
      continue;
    }

    // ── package モード ──
    packageCount += 1;
    const versionId = p.ai_prompt_package_version_id;
    if (!versionId) {
      packageUnsetProjects.push({ id: p.id, name: p.name, status: p.status });
      continue;
    }

    const meta = versionMetaById.get(versionId);
    if (!meta) {
      orphanRefProjects.push({
        id: p.id,
        name: p.name,
        status: p.status,
        versionId,
        reason: "missing",
      });
      continue;
    }

    if (meta.status === "draft") {
      orphanRefProjects.push({
        id: p.id,
        name: p.name,
        status: p.status,
        versionId,
        reason: "draft",
      });
      continue;
    }

    if (meta.status === "archived") {
      const fallbackNo = publishedVersionNoByPackage.get(meta.package_id) ?? null;
      archivedRefProjects.push({
        id: p.id,
        name: p.name,
        status: p.status,
        archivedVersionNo: meta.version_no,
        hasFallback: fallbackNo !== null,
        fallbackVersionNo: fallbackNo,
      });
      continue;
    }
    // published は健全な状態（対応不要）
  }

  // needsAttention: 対応が必要なプロジェクトの重複なし件数
  const attentionIds = new Set<string>();
  for (const r of customProjects) attentionIds.add(r.id);
  for (const r of packageUnsetProjects) attentionIds.add(r.id);
  for (const r of archivedRefProjects) attentionIds.add(r.id);
  for (const r of orphanRefProjects) attentionIds.add(r.id);

  return {
    customProjects,
    packageUnsetProjects,
    archivedRefProjects,
    orphanRefProjects,
    counts: {
      total: projects.length,
      package: packageCount,
      custom: customProjects.length,
      packageUnset: packageUnsetProjects.length,
      archivedRef: archivedRefProjects.length,
      orphanRef: orphanRefProjects.length,
      needsAttention: attentionIds.size,
    },
  };
}

// ============================================================
// Phase D: custom → package 実データ移行（実行系）
//
// 設計方針（安全性最優先・both 計画書の段階移行に準拠）:
//   - **per-project 専用パッケージ生成**: custom 各プロジェクトの policy/templates を
//     そのまま「移行用パッケージ＋公開 v1」へ書き出し、プロジェクトを package へ張替え、
//     project 側の policy/templates/overrides を null 化する。設定の取り違え・集約による
//     プロンプト変化を避けるため、集約ではなく1対1で移送する（挙動完全保存）。
//   - **dry-run 既定**: 実行前に必ずプランを提示。`buildMigrationPlan` は純関数で完全テスト可能。
//   - **per-item 隔離**: 1件の失敗が他へ波及しない。書込み順序（package→version→publish→repoint→log）
//     により、失敗時はプロジェクトが repoint されず custom のまま＝本番挙動を維持（可逆）。
//   - **legacy コードパス・列 DROP はこのフェーズでは行わない**（実データ移行の棚卸し・後方互換
//     期間後の別パス。aiService の `?? project.*` fallback・researchForm 残骸・列は温存）。
// ============================================================

/** 移行用パッケージの slug を projectId から決定的に生成する（プロジェクトごとに一意） */
export function buildMigrationSlug(projectId: string): string {
  const short = projectId.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8).toLowerCase();
  return `migrated-${short || "project"}`;
}

export interface MigrationPlanItem {
  projectId: string;
  projectName: string;
  status: string;
  hasPolicy: boolean;
  hasTemplates: boolean;
  /** create_package = 専用パッケージを作成して移送 / skip = 個別設定が無く自動移送対象外 */
  action: "create_package" | "skip";
  skipReason?: string;
  proposedSlug: string;
  proposedPackageName: string;
  policyJson: Record<string, unknown> | null;
  templatesJson: Record<string, unknown> | null;
}

export interface MigrationPlan {
  items: MigrationPlanItem[];
  counts: { total: number; toMigrate: number; skipped: number };
}

/**
 * custom プロジェクト群から移行プランを構築する（純関数・DB非依存）。
 * - package モードのプロジェクトは対象外
 * - policy も templates も無い custom は skip（移送するものが無いため手動割当に委ねる）
 */
export function buildMigrationPlan(projects: MigrationProjectInput[]): MigrationPlan {
  const items: MigrationPlanItem[] = [];
  for (const p of projects) {
    const mode = p.ai_prompt_mode === "package" ? "package" : "custom";
    if (mode !== "custom") continue;

    const hasPolicy = hasMeaningfulPolicy(p.ai_prompt_policy_json);
    const hasTemplates = hasMeaningfulTemplates(p.ai_prompt_templates_json);
    const base = {
      projectId: p.id,
      projectName: p.name,
      status: p.status,
      hasPolicy,
      hasTemplates,
      proposedSlug: buildMigrationSlug(p.id),
      proposedPackageName: `${p.name}（移行設定）`,
    };

    if (!hasPolicy && !hasTemplates) {
      items.push({
        ...base,
        action: "skip",
        skipReason: "個別設定なし。公開済みパッケージを手動割当してください。",
        policyJson: null,
        templatesJson: null,
      });
      continue;
    }

    items.push({
      ...base,
      action: "create_package",
      policyJson: hasPolicy ? (p.ai_prompt_policy_json as Record<string, unknown>) : null,
      templatesJson: hasTemplates ? (p.ai_prompt_templates_json as Record<string, unknown>) : null,
    });
  }

  const toMigrate = items.filter((i) => i.action === "create_package").length;
  return {
    items,
    counts: { total: items.length, toMigrate, skipped: items.length - toMigrate },
  };
}

/** executeMigrationPlan が書込みに使う依存（テスト時にモック注入する） */
export interface MigrationExecutorDeps {
  createPackage(input: { slug: string; name: string; description?: string | null }): Promise<{ id: string }>;
  createVersion(input: {
    package_id: string;
    policy_json: Record<string, unknown> | null;
    templates_json: Record<string, unknown> | null;
    change_note?: string | null;
  }): Promise<{ id: string; version_no: number }>;
  publishVersion(versionId: string): Promise<void>;
  /** プロジェクトを package へ張替え、project 側 policy/templates/overrides を null 化する */
  repointProject(projectId: string, versionId: string): Promise<void>;
  recordChangeLog(input: {
    projectId: string;
    oldVersionId: string | null;
    newVersionId: string;
    oldMode: string | null;
    newMode: "package";
    changeReason: string;
    changedBy: string | null;
  }): Promise<void>;
}

export interface MigrationItemResult {
  projectId: string;
  projectName: string;
  /** migrated=実移行済 / planned=dry-run予定 / skipped=対象外 / failed=失敗（custom維持） */
  outcome: "migrated" | "planned" | "skipped" | "failed";
  packageId?: string;
  versionId?: string;
  versionNo?: number;
  message?: string;
}

export interface MigrationExecutionResult {
  dryRun: boolean;
  results: MigrationItemResult[];
  counts: { migrated: number; planned: number; skipped: number; failed: number };
  changedBy: string | null;
}

/**
 * 移行プランを実行する。dryRun=true ならプラン提示のみ（書込みなし）。
 * 各 create_package アイテムは package→version→publish→repoint→log の順で処理し、
 * 失敗時はそのアイテムのみ failed として記録し他へ波及させない（プロジェクトは custom 維持）。
 */
export async function executeMigrationPlan(
  plan: MigrationPlan,
  deps: MigrationExecutorDeps,
  options: { dryRun: boolean; changedBy: string | null }
): Promise<MigrationExecutionResult> {
  const results: MigrationItemResult[] = [];

  for (const item of plan.items) {
    if (item.action === "skip") {
      results.push({
        projectId: item.projectId,
        projectName: item.projectName,
        outcome: "skipped",
        message: item.skipReason,
      });
      continue;
    }

    if (options.dryRun) {
      results.push({
        projectId: item.projectId,
        projectName: item.projectName,
        outcome: "planned",
        message: `package「${item.proposedSlug}」を作成し v1 を公開・適用、project 個別設定を null 化`,
      });
      continue;
    }

    try {
      const pkg = await deps.createPackage({
        slug: item.proposedSlug,
        name: item.proposedPackageName,
        description: "custom モードからの自動移行",
      });
      const ver = await deps.createVersion({
        package_id: pkg.id,
        policy_json: item.policyJson,
        templates_json: item.templatesJson,
        change_note: "custom 設定からの移行 v1",
      });
      await deps.publishVersion(ver.id);
      await deps.repointProject(item.projectId, ver.id);
      await deps.recordChangeLog({
        projectId: item.projectId,
        oldVersionId: null,
        newVersionId: ver.id,
        oldMode: "custom",
        newMode: "package",
        changeReason: "custom→package 自動移行（Phase D）",
        changedBy: options.changedBy,
      });
      results.push({
        projectId: item.projectId,
        projectName: item.projectName,
        outcome: "migrated",
        packageId: pkg.id,
        versionId: ver.id,
        versionNo: ver.version_no,
      });
    } catch (e) {
      results.push({
        projectId: item.projectId,
        projectName: item.projectName,
        outcome: "failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    dryRun: options.dryRun,
    results,
    counts: {
      migrated: results.filter((r) => r.outcome === "migrated").length,
      planned: results.filter((r) => r.outcome === "planned").length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
      failed: results.filter((r) => r.outcome === "failed").length,
    },
    changedBy: options.changedBy,
  };
}
