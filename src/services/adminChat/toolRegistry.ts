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
  /** このツールを出す画面。空配列は「どの画面にも出ない」＝登録エラー */
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
  if (tool.tier !== "C" && typeof tool.prepare === "function") {
    throw new Error(`registerTool: prepare は Tier C 専用です: ${tool.name}`);
  }
  if (registry.has(tool.name)) {
    throw new Error(`registerTool: ツール名が重複しています: ${tool.name}`);
  }
  registry.set(tool.name, tool);
}

/** 指定画面で使えるツール一覧（登録順） */
export function toolsForScreen(screenKey: string): AdminChatTool[] {
  return [...registry.values()].filter((tool) => tool.screenKeys.includes(screenKey));
}

export function getTool(name: string): AdminChatTool | undefined {
  return registry.get(name);
}

/** チャットパネルを出す画面かどうか（未登録画面ではボタンを出さない） */
export function isRegisteredScreen(screenKey: string): boolean {
  return [...registry.values()].some((tool) => tool.screenKeys.includes(screenKey));
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
