function escapeCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const escaped = raw.replaceAll("\"", "\"\"");
  return `"${escaped}"`;
}

export function toCsv<T extends object>(rows: T[]): string {
  if (rows.length === 0) {
    return "";
  }

  const firstRow = rows[0] as object;
  const headers = Object.keys(firstRow);
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    const mapped = row as Record<string, unknown>;
    lines.push(headers.map((header) => escapeCell(mapped[header])).join(","));
  }
  return lines.join("\n");
}
