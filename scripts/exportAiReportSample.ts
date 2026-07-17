/**
 * ai-report（集計アプリ）向けサンプルの実エクスポート。
 * 本番の admin エクスポートと同じ statExportService.rawdataCsv / rawdataLayoutCsv を使う
 * （= 送付物と本番出力が乖離しない）。既定ステータスは completed/partial/abandoned。
 *
 * Usage:
 *   npx tsx scripts/exportAiReportSample.ts [projectId]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { statExportService } from "../src/services/statExportService";

const DEMO_PROJECT_ID = "00000000-0000-4000-8000-000000000150";
const projectId = process.argv[2] ?? DEMO_PROJECT_ID;

async function main(): Promise<void> {
  const [rawdata, layout] = await Promise.all([
    statExportService.rawdataCsv(projectId, {}),
    statExportService.rawdataLayoutCsv(projectId, {})
  ]);

  const exportDir = join(dirname(fileURLToPath(import.meta.url)), "../exports/rawdata");
  mkdirSync(exportDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const rawdataPath = join(exportDir, `rawdata_${stamp}.csv`);
  const layoutPath = join(exportDir, `rawdata-layout_${stamp}.csv`);
  writeFileSync(rawdataPath, rawdata);
  writeFileSync(layoutPath, layout);

  const rowCount = rawdata.split("\r\n").filter((line) => line.length > 0).length - 1;
  const layoutCount = layout.split("\r\n").filter((line) => line.length > 0).length - 1;
  console.log(`rawdata: ${rawdataPath} (${rowCount} rows)`);
  console.log(`layout:  ${layoutPath} (${layoutCount} rows)`);
}

main().catch((error) => {
  console.error("FATAL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
