import type { Question } from "../types/domain";
import { metricLabel } from "./metricCatalog";

/**
 * aggregationScope.ts
 *
 * 集計単位（軸）の定義と、企業（client）横断で「合算できる指標」を集める純関数。
 * 設計方針（docs/spec-client-aggregation-foundation.md 土台②）:
 * - 集計ルートを project 固定から可変軸へ開く。今回は client 軸のみ実装。
 * - 将来 area / channel 軸は同じ union に足すだけ（★予約・rework無し）。
 * - リアルタイムダッシュボード等どの経路で集計しても、指標の意味は metricCatalog、
 *   集計軸はこの型を「唯一の正」とする（★予約②の一元化ルール）。
 */

export type AggregationScope =
  | { kind: "project"; project_id: string }
  | { kind: "client"; client_id: string };
// 将来: | { kind: "area"; area_code: string } | { kind: "channel"; entry_code: string }

export interface ClientMetricSummary {
  /** 共通指標コード（正規化済み） */
  code: string;
  /** 表示ラベル（metricCatalog 優先、無ければコード名） */
  label: string;
  /** この指標を持つ設問がある project 数 */
  project_count: number;
}

/** collectClientMetrics の入力：project ごとの設問集合。 */
export interface ProjectQuestions {
  project_id: string;
  questions: Question[];
}

/**
 * 企業配下の全 project 設問から metric_code を集計し、横断集計できる指標一覧を作る。
 * - 1つの project 内で同じ metric_code が複数設問にあっても project_count は 1 だけ増える。
 * - 出力は project_count 降順→code 昇順で安定ソート。
 * - 実集計（度数・平均）は将来Slice(B)。ここは「何が横断できるか」の可視化のみ。
 */
export function collectClientMetrics(projects: ProjectQuestions[]): ClientMetricSummary[] {
  const projectCountByCode = new Map<string, number>();

  for (const project of projects) {
    const codesInProject = new Set<string>();
    for (const question of project.questions) {
      const code = question.question_config?.meta?.metric_code;
      if (typeof code === "string" && code.length > 0) {
        codesInProject.add(code);
      }
    }
    for (const code of codesInProject) {
      projectCountByCode.set(code, (projectCountByCode.get(code) ?? 0) + 1);
    }
  }

  return [...projectCountByCode.entries()]
    .map(([code, project_count]) => ({ code, label: metricLabel(code), project_count }))
    .sort((left, right) =>
      right.project_count - left.project_count || left.code.localeCompare(right.code)
    );
}
