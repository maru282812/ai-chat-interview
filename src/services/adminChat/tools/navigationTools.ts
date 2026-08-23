/**
 * 管理画面AIチャット: 道しるべツール（Tier A = 読み取り専用・全画面）
 * docs/plan-admin-navigator-ai.md Phase 3
 *
 * 「〇〇の設定どこ？」に候補カードで答えるための2本。
 *
 * 設計の要（ここを崩すと事故る）:
 * - **URL はサーバー計算値のみ。** 候補の url は画面カタログ（ADMIN_SCREENS）の path、
 *   または repository で引いた実 ID を差し込んだものだけ。AI の生成テキストから URL を
 *   拾わない。AI が URL を捏造して誤誘導する事故を構造的に防ぐ（pendingActions と同じ思想）。
 * - execute の戻り値は「AI が説明を書くための材料」。実際に候補カードとして描画される
 *   URL は adminChatService が `navigations` 封筒へ別経路で載せる（下の `navigationsOf`）。
 * - find_screen は動的URL（`/:param` を含む画面）を候補カードから除く。ID が埋まっていない
 *   URL を押させても 404 になるため。そういう画面は resolve_entity で ID を解決してから出す。
 */

import { getScreenByKey } from "../../../lib/adminScreenCatalog";
import { clientRepository } from "../../../repositories/clientRepository";
import { projectRepository } from "../../../repositories/projectRepository";
import { respondentRepository } from "../../../repositories/respondentRepository";
import { sessionRepository } from "../../../repositories/sessionRepository";
import { searchScreens } from "../screenSearchService";
import { ALL_SCREENS, type AdminChatTool, registerTool } from "../toolRegistry";

/** 候補カード1枚分。adminChatService が `navigations` 封筒へそのまま載せる */
export interface AdminChatNavigation {
  label: string;
  /** サーバー計算値の遷移先URL（カタログ path、または実IDを埋めた動的URL） */
  url: string;
  description: string;
  group: string;
}

/** 道しるべツールの戻り値。`navigations` を持つものだけが候補カードになる */
interface NavigationToolResult {
  navigations: AdminChatNavigation[];
  [key: string]: unknown;
}

/** 動的URL（`/:param` を含む）かどうか。ID 未解決のまま押させないための判定 */
function isDynamicUrl(url: string): boolean {
  return url.includes("/:");
}

/**
 * ツールの実行結果から候補カードを取り出す。
 * `navigations` を持つ形の結果だけを受け付け、他のツールの戻り値は無視する
 * （AI が任意の JSON を返させて封筒に URL を差し込む経路を作らないため）。
 */
export function navigationsOf(result: unknown): AdminChatNavigation[] {
  if (!result || typeof result !== "object") return [];
  const raw = (result as { navigations?: unknown }).navigations;
  if (!Array.isArray(raw)) return [];
  const out: AdminChatNavigation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const nav = item as Partial<AdminChatNavigation>;
    if (typeof nav.url !== "string" || typeof nav.label !== "string") continue;
    out.push({
      label: nav.label,
      url: nav.url,
      description: typeof nav.description === "string" ? nav.description : "",
      group: typeof nav.group === "string" ? nav.group : "",
    });
  }
  return out;
}

/** 名前照合用の正規化。全角空白・大小文字の揺れだけ吸収する（形態素解析は持ち込まない） */
function normalizeName(value: string): string {
  return value.replace(/[\s　]+/g, "").toLowerCase();
}

function nameMatches(candidate: string | null | undefined, needle: string): boolean {
  if (!candidate) return false;
  return normalizeName(candidate).includes(needle);
}

const NAVIGATION_TOOLS: AdminChatTool[] = [];

NAVIGATION_TOOLS.push({
  name: "find_screen",
  tier: "A",
  screenKeys: [ALL_SCREENS],
  description:
    "「〇〇の設定はどこ？」「××はどの画面でやる？」のような、管理画面の場所を尋ねる質問に使う。" +
    "画面カタログを検索し、該当画面の名前・できること・URL を返す。" +
    "返した候補は画面上でクリック可能なカードとして表示されるので、URLを本文に書く必要はない。" +
    "該当が0件のときは正直に「該当画面はありません」と伝えること。",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "探したい機能・設定項目の言葉（例: 「離脱率」「LINE配信」「ポイント交換」）",
      },
    },
    required: ["query"],
  },
  execute: async (args): Promise<NavigationToolResult> => {
    const query = typeof args["query"] === "string" ? args["query"].trim() : "";
    if (!query) {
      return {
        navigations: [],
        query: "",
        note: "検索語が空です。何を探しているかを具体的な言葉で指定してください。",
      };
    }

    const hits = searchScreens(query);
    // 動的URL（/:param）はIDが埋まっていないので候補カードにしない。
    // 該当した場合は resolve_entity へ回すよう AI に伝える。
    const staticHits = hits.filter((hit) => !isDynamicUrl(hit.url));
    const dynamicHits = hits.filter((hit) => isDynamicUrl(hit.url));

    return {
      navigations: staticHits.map((hit) => ({
        label: hit.label,
        url: hit.url,
        description: hit.description,
        group: hit.group,
      })),
      query,
      matched_count: staticHits.length,
      // 対象レコードを選んでから開く画面（案件詳細・企業まとめ等）。ID が要るので
      // resolve_entity で名前からIDを解決してもらう必要がある。
      needs_entity: dynamicHits.map((hit) => ({
        label: hit.label,
        group: hit.group,
        description: hit.description,
        hint: "この画面は対象を1件選んでから開く。resolve_entity で名前からIDを解決すること。",
      })),
      instruction:
        staticHits.length === 0 && dynamicHits.length === 0
          ? "該当する画面はありませんでした。無理に近い画面を紹介せず「該当画面はありません」と正直に伝えること。"
          : "候補は画面上にカードとして表示済み。本文ではURLを書かず、上位3〜5件の画面名とできることを短くまとめ、" +
            "候補が多いときは絞り込みのための質問を1つだけ添えること。",
    };
  },
});

/** resolve_entity が引ける対象種別 */
const ENTITY_TYPES = ["project", "client", "respondent", "session"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

/** 対象種別ごとの遷移先画面（カタログの key）。URL はカタログ path から組み立てる */
const ENTITY_SCREEN_KEYS: Record<EntityType, string[]> = {
  // 案件は「編集」を先頭に置く（設定変更が最頻の用途）
  project: ["research-form", "questions-index", "project-analysis"],
  client: ["client-overview"],
  respondent: ["respondent-show"],
  session: ["session-show"],
};

/** 1件あたりの候補上限。多すぎると選べない */
const ENTITY_MATCH_LIMIT = 5;

interface ResolvedEntity {
  id: string;
  name: string;
}

/**
 * 名前から対象を引く。**既存 repository のみを使い、ここで新しい SQL 経路を作らない。**
 * 一覧を取ってからメモリ上で部分一致させる（管理データ規模なので十分・
 * PostgREST の ilike に日本語を渡すときのエスケープ事故も避けられる）。
 */
async function resolveEntities(type: EntityType, name: string): Promise<ResolvedEntity[]> {
  const needle = normalizeName(name);
  if (!needle) return [];

  if (type === "project") {
    const projects = await projectRepository.list();
    return projects
      .filter((p) => nameMatches(p.name, needle) || nameMatches(p.user_display_title, needle))
      .map((p) => ({ id: p.id, name: p.name }));
  }
  if (type === "client") {
    const clients = await clientRepository.list();
    return clients.filter((c) => nameMatches(c.name, needle)).map((c) => ({ id: c.id, name: c.name }));
  }
  if (type === "respondent") {
    // 回答者は件数が多いので repository の検索（display_name / line_user_id の ilike）に任せる
    const { rows } = await respondentRepository.searchPaged({
      q: name,
      limit: ENTITY_MATCH_LIMIT,
      offset: 0,
    });
    return rows.map((r) => ({ id: r.id, name: r.display_name ?? r.line_user_id }));
  }
  // session は名前を持たないので、ID そのものを指定されたときだけ引ける
  const session = await sessionRepository.getById(name.trim()).catch(() => null);
  return session ? [{ id: session.id, name: session.id }] : [];
}

/** カタログの path に実 ID を差し込む。`:param` は1つだけ想定（カタログの動的URLは全て1つ） */
function buildEntityUrl(path: string, id: string): string {
  return path.replace(/:[A-Za-z0-9_]+/, encodeURIComponent(id));
}

NAVIGATION_TOOLS.push({
  name: "resolve_entity",
  tier: "A",
  screenKeys: [ALL_SCREENS],
  description:
    "「（企業名）のまとめ画面を開きたい」「（案件名）の設問を見たい」のように、" +
    "名前から特定のレコードの画面へ行きたいときに使う。名前でIDを検索し、その画面の実URLを返す。" +
    "find_screen が「対象を1件選んでから開く画面」を返したときの続きにも使う。" +
    "セッションは名前を持たないため、type=session では ID そのものを name に渡すこと。",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...ENTITY_TYPES],
        description: "対象の種別。project=案件 / client=企業（法人） / respondent=回答者 / session=回答セッション",
      },
      name: {
        type: "string",
        description: "対象の名前（部分一致で探す）。session の場合はセッションID",
      },
    },
    required: ["type", "name"],
  },
  execute: async (args): Promise<NavigationToolResult> => {
    const typeRaw = typeof args["type"] === "string" ? args["type"].trim() : "";
    const name = typeof args["name"] === "string" ? args["name"].trim() : "";
    if (!ENTITY_TYPES.includes(typeRaw as EntityType)) {
      return {
        navigations: [],
        note: `type は ${ENTITY_TYPES.join(" / ")} のいずれかを指定してください（受け取った値: ${typeRaw || "空"}）。`,
      };
    }
    if (!name) {
      return { navigations: [], note: "name が空です。対象の名前（session ならID）を指定してください。" };
    }

    const type = typeRaw as EntityType;
    const matches = (await resolveEntities(type, name)).slice(0, ENTITY_MATCH_LIMIT);
    if (matches.length === 0) {
      return {
        navigations: [],
        type,
        name,
        matched_count: 0,
        instruction:
          "名前に一致する対象が見つかりませんでした。存在しない可能性を正直に伝え、" +
          "別の言い方や一覧画面（find_screen で探せる）での確認を提案すること。",
      };
    }

    const screens = ENTITY_SCREEN_KEYS[type]
      .map((key) => getScreenByKey(key))
      .filter((screen): screen is NonNullable<typeof screen> => screen !== null && isDynamicUrl(screen.path));

    const navigations: AdminChatNavigation[] = [];
    for (const match of matches) {
      for (const screen of screens) {
        navigations.push({
          label: matches.length > 1 ? `${match.name}｜${screen.label}` : screen.label,
          url: buildEntityUrl(screen.path, match.id),
          description: screen.description,
          group: screen.group,
        });
      }
    }

    return {
      navigations,
      type,
      name,
      matched_count: matches.length,
      matches: matches.map((m) => ({ id: m.id, name: m.name })),
      instruction:
        matches.length > 1
          ? "複数の対象が一致しました。どれを指しているか確認する質問を1つ添えること。URLは本文に書かず、カードを押すよう促す。"
          : "候補は画面上にカードとして表示済み。URLは本文に書かず、どの画面へ行けるかだけを短く伝えること。",
    };
  },
});

/** 道しるべツールをレジストリへ登録する。アプリ起動時に1回だけ呼ぶ */
export function registerNavigationTools(): void {
  for (const tool of NAVIGATION_TOOLS) {
    registerTool(tool);
  }
}

/** テスト・画面判定用（登録せずに定義だけ見たい場合） */
export function navigationToolDefinitions(): AdminChatTool[] {
  return [...NAVIGATION_TOOLS];
}
