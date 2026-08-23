/**
 * 管理画面AIチャットのツールレジストリ（docs/impl-admin-ai-chat.md Phase 1）
 *
 * AI に渡せる操作をホワイトリストで宣言する。全ツールは既存 service 層を経由し、
 * AI 専用の自由クエリ・自由 HTTP は作らない。
 *
 * tier は「実装側が静的に宣言する」危険度で、AI の自己申告ではない:
 *   A = 読み取り（副作用なし）
 *   B = 戻せる書き込み（社内データのみ・undo 可能・対外送信なし）
 *   C = 不可逆・対外（LINE 配信 / ポイント付与 / 公開 / entry_code 変更 など）
 * 境界例（公開後の設問編集＝ロウデータ列契約に触る等）は必ず C 側に倒すこと。
 *
 * 実行可否のゲートは adminChatService 側で強制する。ここは「宣言と絞り込み」だけを担う。
 */

import { getScreenByKey } from "../../lib/adminScreenCatalog";

export type ToolTier = "A" | "B" | "C";

export interface AdminChatToolContext {
  /** チャットを開いている画面が対象にしているレコード（案件ID / セッションID 等） */
  entityId: string | null;
  screenKey: string;
}

/**
 * Tier C の確認内容。**必ずサーバー側で実データから計算する**。
 * AI が申告した件数を表示すると「推定と実行対象が別ロジック」の事故（P0-3）を再現するため、
 * 承認カードに出す数字はここで作ったものだけを使い、承認実行時にも再計算して突き合わせる。
 */
export interface ToolPreparation {
  /** 何をするのかの1行（例: 「セグメント『20代女性』へLINE配信」） */
  summary: string;
  /** 影響の箇条書き（例: 「対象 128 名」「未同意者 3 名を除外」） */
  impact: string[];
  /** 対象件数。承認時の再計算で差分が出たら中断する基準になる */
  targetCount: number | null;
}

export interface AdminChatTool {
  /** OpenAI の function name。英数字とアンダースコアのみ */
  name: string;
  tier: ToolTier;
  /**
   * このツールを出す画面。空配列は「どの画面にも出ない」＝登録エラー。
   * `["*"]`（ALL_SCREENS）は全画面。道しるべ（find_screen / resolve_entity）のように
   * どの画面から聞かれても安全な読み取りツールで使う。
   * **Tier C の `"*"` は登録時 throw**（不可逆・対外操作の全画面露出を構造で禁止する）。
   */
  screenKeys: string[];
  /** AI に渡す説明。いつ使うかが分かる日本語で書く */
  description: string;
  /** OpenAI function calling の JSON Schema（type:"object" 必須） */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: AdminChatToolContext) => Promise<unknown>;
  /**
   * Tier C 専用・必須。実行せずに「何が起きるか」を実データから計算して返す。
   * チャットは prepare() の結果で承認カードを出し、execute() は人間の承認後にのみ呼ぶ。
   */
  prepare?: (args: Record<string, unknown>, ctx: AdminChatToolContext) => Promise<ToolPreparation>;
}

/** 全画面ワイルドカード。screenKeys にこの値を含めるとどの画面でも出る */
export const ALL_SCREENS = "*";

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const VALID_TIERS: ToolTier[] = ["A", "B", "C"];

const registry = new Map<string, AdminChatTool>();

/**
 * ツールを登録する。
 * tier 未宣言・不正 tier・name 重複・screenKeys 空はすべて throw する
 * （黙って登録されると「宣言し忘れたツールが Tier ゲートをすり抜ける」ため）。
 */
export function registerTool(tool: AdminChatTool): void {
  if (!tool || typeof tool.name !== "string" || !TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(
      `registerTool: 不正なツール名です（英小文字始まり・英数字とアンダースコア3〜64字）: ${String(tool?.name)}`
    );
  }
  if (!VALID_TIERS.includes(tool.tier)) {
    throw new Error(`registerTool: tier が未宣言または不正です（A/B/C）: ${tool.name}`);
  }
  if (!Array.isArray(tool.screenKeys) || tool.screenKeys.length === 0) {
    throw new Error(`registerTool: screenKeys が空です: ${tool.name}`);
  }
  // 画面カタログに無い key はタイプミスの可能性が高い。放置すると「どの画面にも出ない」まま
  // 誰も気づかない（Tier C の限定開放でこれをやると配信ツールが静かに消える）ので登録時に落とす。
  // 例外は `test-` 始まりのダミー key だけ（テストが合成ツールを登録するため。
  // 実画面の key に `test-` 始まりは無く、台帳の突合テストがそれを担保している）。
  for (const key of tool.screenKeys) {
    if (key === ALL_SCREENS || key.startsWith("test-")) continue;
    if (!getScreenByKey(key)) {
      throw new Error(
        `registerTool: screenKeys に画面カタログ（ADMIN_SCREENS）へ存在しない key があります: ${tool.name} → ${key}`
      );
    }
  }
  if (typeof tool.execute !== "function") {
    throw new Error(`registerTool: execute が関数ではありません: ${tool.name}`);
  }
  if (!tool.parameters || (tool.parameters as { type?: string }).type !== "object") {
    throw new Error(`registerTool: parameters は type:"object" の JSON Schema が必要です: ${tool.name}`);
  }
  // Tier C は承認カードが命綱。prepare() が無いツールは「確認内容を出せない＝
  // 人間が何を承認するのか分からないまま実行される」ことになるので登録させない。
  if (tool.tier === "C" && typeof tool.prepare !== "function") {
    throw new Error(`registerTool: Tier C には prepare が必要です: ${tool.name}`);
  }
  // Tier C を全画面に開放させない。承認カードがあっても、LINE 実配信・公開のような
  // 不可逆操作をダッシュボード含む全画面へ露出させる利益がない。
  // 規約でなく構造（＝登録時 throw）で守る。screenKeys 空の throw と同じ思想。
  if (tool.tier === "C" && tool.screenKeys.includes(ALL_SCREENS)) {
    throw new Error(
      `registerTool: Tier C に screenKeys "*"（全画面）は使えません。対象画面を明示してください: ${tool.name}`
    );
  }
  if (tool.tier !== "C" && typeof tool.prepare === "function") {
    throw new Error(`registerTool: prepare は Tier C 専用です: ${tool.name}`);
  }
  if (registry.has(tool.name)) {
    throw new Error(`registerTool: ツール名が重複しています: ${tool.name}`);
  }
  registry.set(tool.name, tool);
}

/** そのツールが指定画面で使えるか。`"*"` は全画面に展開する */
export function toolMatchesScreen(tool: AdminChatTool, screenKey: string): boolean {
  return tool.screenKeys.includes(ALL_SCREENS) || tool.screenKeys.includes(screenKey);
}

/** 指定画面で使えるツール一覧（登録順） */
export function toolsForScreen(screenKey: string): AdminChatTool[] {
  return [...registry.values()].filter((tool) => toolMatchesScreen(tool, screenKey));
}

export function getTool(name: string): AdminChatTool | undefined {
  return registry.get(name);
}

/** チャットパネルを出す画面かどうか（未登録画面ではボタンを出さない） */
export function isRegisteredScreen(screenKey: string): boolean {
  return [...registry.values()].some((tool) => toolMatchesScreen(tool, screenKey));
}

/** OpenAI chat.completions の tools 形式へ変換 */
export function toOpenAITools(tools: AdminChatTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** テスト用: レジストリを空にする（本番コードから呼ばない） */
export function __resetRegistryForTest(): void {
  registry.clear();
}
