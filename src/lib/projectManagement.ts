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
