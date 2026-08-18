/**
 * projectListFilter.ts
 *
 * 案件一覧の絞り込み（純関数・Migration 096）。
 *
 * 店舗展開を始めると案件は「店舗数 × A/B/C」で増える（30店舗＝90件）。
 * 一覧から目的の案件を探せなくなるため、業種・店舗・役割で絞れるようにする。
 *
 * ここを純関数にしているのは、絞り込み条件の取りこぼし（例: 未設定の案件が
 * どのフィルタでも出てこない）が起きても気づきにくいため。
 */

/** 一覧に出す案件の、絞り込みに使う属性だけを抜き出した形。 */
export interface FilterableProject {
  store_id?: string | null;
  industry_template_id?: string | null;
  template_step_role?: string | null;
  client_id?: string | null;
  name?: string | null;
  status?: string | null;
}

export interface ProjectListFilter {
  /** 業種テンプレID。"none" で「業種に属さない案件」 */
  industry: string | null;
  /** 店舗ID。"none" で「店舗に属さない案件」 */
  store: string | null;
  /** entry / followup / verify / template */
  role: string | null;
  /** 案件名の部分一致（大文字小文字を無視） */
  keyword: string | null;
  status: string | null;
}

export const EMPTY_FILTER: ProjectListFilter = {
  industry: null,
  store: null,
  role: null,
  keyword: null,
  status: null,
};

/** クエリ文字列から絞り込み条件を作る。空文字は「指定なし」として扱う。 */
export function parseProjectListFilter(query: Record<string, unknown>): ProjectListFilter {
  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
  };
  return {
    industry: str(query.industry),
    store: str(query.store),
    role: str(query.role),
    keyword: str(query.q),
    status: str(query.status),
  };
}

/** 絞り込みが1つでも指定されているか（画面で「解除」を出すかの判定に使う）。 */
export function hasActiveFilter(filter: ProjectListFilter): boolean {
  return Object.values(filter).some((v) => v !== null);
}

/**
 * 1件が条件に合うか。
 *
 * "none" は「その属性を持たない案件」を意味する。
 * 店舗展開前からある通常案件（store_id=null）を探せるようにするため、
 * 単に「一致しない」で捨てず明示的に拾えるようにしている。
 */
export function matchesProjectFilter(
  project: FilterableProject,
  filter: ProjectListFilter
): boolean {
  if (filter.industry) {
    const value = project.industry_template_id ?? null;
    if (filter.industry === "none" ? value !== null : value !== filter.industry) return false;
  }

  if (filter.store) {
    const value = project.store_id ?? null;
    if (filter.store === "none" ? value !== null : value !== filter.store) return false;
  }

  if (filter.role) {
    const value = project.template_step_role ?? null;
    if (filter.role === "none" ? value !== null : value !== filter.role) return false;
  }

  if (filter.status && (project.status ?? null) !== filter.status) return false;

  if (filter.keyword) {
    const name = (project.name ?? "").toLowerCase();
    if (!name.includes(filter.keyword.toLowerCase())) return false;
  }

  return true;
}

/** 一覧全体に適用する。row から案件を取り出す関数を渡す。 */
export function filterProjectRows<T>(
  rows: T[],
  filter: ProjectListFilter,
  pick: (row: T) => FilterableProject
): T[] {
  if (!hasActiveFilter(filter)) return rows;
  return rows.filter((row) => matchesProjectFilter(pick(row), filter));
}
