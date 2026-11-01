import { HttpError } from './http';

export interface ProjectManagementFields {
  management_year?: number | null;
  confirmed_number?: number | null;
  survey_purpose?: 'monitor' | 'store' | null;
}

/** Missing fields preserve older callers; an explicit blank clears a field. */
export function parseProjectManagement(body: Record<string, unknown>): ProjectManagementFields {
  const result: ProjectManagementFields = {};
  for (const key of ['management_year', 'confirmed_number'] as const) {
    if (!(key in body)) continue;
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (!value) { result[key] = null; continue; }
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1 || n > 2147483647 ||
        (key === 'management_year' && (n < 1900 || n > 9999))) {
      throw new HttpError(400, key === 'management_year' ? '管理年は1900〜9999で入力してください' : '確定番号は1以上の整数で入力してください');
    }
    result[key] = n;
  }
  if ('survey_purpose' in body) {
    const purpose = body.survey_purpose;
    if (purpose !== '' && purpose !== 'monitor' && purpose !== 'store') {
      throw new HttpError(400, '案件用途を選択してください');
    }
    result.survey_purpose = purpose || null;
  }
  return result;
}

/** Read-only legacy search support; never silently rewrite stored names. */
export function managementIdentity(project: { name?: string | null; management_year?: number | null; confirmed_number?: number | null; company_code?: string | null }) {
  const match = /^(\d{4})-(C\d+)-(\d+)[_＿]/i.exec(project.name ?? '');
  return {
    year: project.management_year ?? (match ? Number(match[1]) : null),
    number: project.confirmed_number ?? (match ? Number(match[3]) : null),
    code: project.company_code ?? match?.[2] ?? null,
  };
}

/** 案件名の先頭に付く管理番号（例: 2026-C123-0001_）。社内向けなので回答者には見せない。 */
const MANAGEMENT_PREFIX_RE = /^\d{4}-C\d+-\d+[_＿]\s*/i;

/**
 * 回答者・配布物（回答画面・チラシ・LINE通知）に出す案件タイトル。
 * 回答者向けタイトル（user_display_title）を優先し、無ければ案件名から管理番号を外して出す。
 */
export function respondentProjectTitle(project: { user_display_title?: unknown; name?: string | null }): string {
  const display = typeof project.user_display_title === "string" ? project.user_display_title.trim() : "";
  if (display) return display;
  const name = (project.name ?? "").trim();
  return name.replace(MANAGEMENT_PREFIX_RE, "").trim() || name;
}
