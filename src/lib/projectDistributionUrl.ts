import { buildProjectDetailLiffUrl, buildStoreEntryLiffUrl } from "../services/liffService";

/**
 * 案件を配布するときの URL（QR の中身）を決める。
 *
 * - 店舗専用（private_store）: entry_code の専用URL（/liff/store 導線）。entry_code 未設定なら出せない。
 * - 通常案件（public）: 案件詳細ページ（/liff/projects/:id）。
 *   詳細ページは getDiscoverableById（published × public × is_discoverable）を通るので、
 *   どれかが欠けると QR を読んでも 404 になる → warnings で知らせる（QR 自体は事前準備用に出す）。
 */
export interface ProjectDistribution {
  kind: "store_entry" | "project_detail";
  url: string | null;
  warnings: string[];
}

export function resolveProjectDistribution(project: {
  id: string;
  status?: string | null;
  visibility_type?: string | null;
  is_discoverable?: boolean | null;
  entry_code?: string | null;
}): ProjectDistribution {
  const warnings: string[] = [];
  const isPublished = project.status === "published";

  if (project.visibility_type === "private_store") {
    if (!project.entry_code) {
      return { kind: "store_entry", url: null, warnings: ["店舗コード（entry_code）が未設定のためQRを発行できません。"] };
    }
    if (!isPublished) warnings.push("公開中ではないため、このままだとQRから回答できません。");
    return { kind: "store_entry", url: buildStoreEntryLiffUrl(project.entry_code), warnings };
  }

  if (!isPublished) warnings.push("公開中ではないため、このままだとQRを読んでも案件が表示されません。");
  if (project.is_discoverable === false) {
    warnings.push("「一覧に出す」がOFFのため、QRを読んでも案件が表示されません（詳細ページは一覧と同じ条件で公開）。");
  }
  return { kind: "project_detail", url: buildProjectDetailLiffUrl(project.id), warnings };
}
