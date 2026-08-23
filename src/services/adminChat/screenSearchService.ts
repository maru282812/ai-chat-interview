/**
 * screenSearchService.ts
 *
 * 画面カタログ（src/lib/adminScreenCatalog.ts）に対するグローバル検索。
 * 「〇〇の設定どこ？」に **AIを使わず即時** で答えるための素朴な部分一致＋スコアリング。
 *
 * 使われる場所は2つ:
 *   1. `GET /admin/api/screen-search?q=`（ヘッダーの検索ボックス）
 *   2. Phase 3 の `find_screen` ツール（道しるべAI）
 *
 * ⚠ 2つで共用するため、この関数は **副作用なし・DB非依存の純関数** にする。
 *   ここに fetch / DB / logger を持ち込むとツール側から呼べなくなる（ツールは
 *   同期的にカタログだけを見たい）。呼び出し側の都合はここに入れない。
 *
 * スコアリングの方針:
 *   label > synonyms > settings > description の順で重みを付ける。
 *   「離脱」で `/admin/cycles`（synonyms に「離脱率」）が上位に出ることが受入基準。
 *   完全一致 > 前方一致 > 部分一致 の順にさらに加点する（「配信」のような短い語で
 *   description にたまたま含むだけの画面が上に来ないようにするため）。
 */

import { ADMIN_SCREENS, type AdminScreenEntry } from "../../lib/adminScreenCatalog";

/** どのフィールドで当たったか。UI のバッジと AI の説明に使う */
export type ScreenSearchField = "label" | "synonyms" | "settings" | "description";

export interface ScreenSearchResult {
  key: string;
  label: string;
  /** ナビ・候補カードに出す URL。**サーバー計算値**（AI 生成テキストから拾わせない） */
  url: string;
  group: string;
  /** 当たったフィールド（重みの高い順） */
  matchedOn: ScreenSearchField[];
  /** 当たった具体的な語（settings / synonyms のどれに当たったかを UI に出す用） */
  matchedTerms: string[];
  description: string;
  score: number;
}

/** 上限。多すぎると選べないので絞る（計画書の「上位8件」） */
export const SCREEN_SEARCH_LIMIT = 8;

/** フィールドごとの基礎点。label > synonyms > settings > description */
const FIELD_WEIGHT: Record<ScreenSearchField, number> = {
  label: 100,
  synonyms: 70,
  settings: 45,
  description: 20
};

/**
 * 一致の質による倍率。
 * 完全一致を強く優遇するのは、「配信」のように短い語が長い description に
 * 埋もれて当たるケースより、synonyms に「配信」と明示した画面を上に出したいため。
 */
const EXACT_BONUS = 2.0;
const PREFIX_BONUS = 1.4;
const PARTIAL_BONUS = 1.0;

/**
 * クエリを正規化する。
 * 日本語なので単語分割はしない（形態素解析を持ち込むと依存が増える）。
 * 全角空白も区切りとして扱い、空白区切りの語すべてを AND ではなく OR で加点する
 * （AND にすると「離脱 率」のような揺れで 0 件になる）。
 */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(q: string): string[] {
  return normalize(q)
    .split(/[\s　]+/)
    .filter((t) => t.length > 0);
}

/** 1つの語が1つのテキストに当たったときの倍率。当たらなければ 0 */
function matchFactor(text: string, token: string): number {
  const haystack = normalize(text);
  if (haystack.length === 0) return 0;
  if (haystack === token) return EXACT_BONUS;
  if (haystack.startsWith(token)) return PREFIX_BONUS;
  if (haystack.includes(token)) return PARTIAL_BONUS;
  return 0;
}

interface FieldHit {
  field: ScreenSearchField;
  score: number;
  terms: string[];
}

/** 1画面 × 1語 のスコア。当たったフィールドと語も返す */
function scoreScreenForToken(screen: AdminScreenEntry, token: string): FieldHit[] {
  const hits: FieldHit[] = [];

  const labelFactor = matchFactor(screen.label, token);
  if (labelFactor > 0) {
    hits.push({ field: "label", score: FIELD_WEIGHT.label * labelFactor, terms: [screen.label] });
  }

  // key も label 相当として拾う（"cycles" のような英字キーで引く運用があるため）。
  // ただし label より弱く扱う（表示名ではないので）。
  const keyFactor = matchFactor(screen.key, token);
  if (keyFactor > 0) {
    hits.push({ field: "label", score: FIELD_WEIGHT.label * keyFactor * 0.6, terms: [screen.key] });
  }

  const synonymTerms: string[] = [];
  let synonymScore = 0;
  for (const synonym of screen.synonyms) {
    const factor = matchFactor(synonym, token);
    if (factor > 0) {
      synonymScore = Math.max(synonymScore, FIELD_WEIGHT.synonyms * factor);
      synonymTerms.push(synonym);
    }
  }
  if (synonymScore > 0) hits.push({ field: "synonyms", score: synonymScore, terms: synonymTerms });

  const settingTerms: string[] = [];
  let settingScore = 0;
  for (const setting of screen.settings) {
    const factor = matchFactor(setting, token);
    if (factor > 0) {
      settingScore = Math.max(settingScore, FIELD_WEIGHT.settings * factor);
      settingTerms.push(setting);
    }
  }
  if (settingScore > 0) hits.push({ field: "settings", score: settingScore, terms: settingTerms });

  // description は文章なので「含む」しか意味がない（前方一致・完全一致は起きない）
  if (normalize(screen.description).includes(token)) {
    hits.push({ field: "description", score: FIELD_WEIGHT.description, terms: [] });
  }

  return hits;
}

const FIELD_ORDER: ScreenSearchField[] = ["label", "synonyms", "settings", "description"];

/**
 * カタログを検索して上位候補を返す。
 *
 * @param q      検索語（空白区切りで複数可）。空文字・空白のみなら空配列
 * @param limit  返す最大件数（既定 8）
 */
export function searchScreens(q: string, limit: number = SCREEN_SEARCH_LIMIT): ScreenSearchResult[] {
  if (typeof q !== "string") return [];
  const tokens = tokenize(q);
  if (tokens.length === 0) return [];

  const results: ScreenSearchResult[] = [];

  for (const screen of ADMIN_SCREENS) {
    let total = 0;
    const fields = new Set<ScreenSearchField>();
    const terms = new Set<string>();

    for (const token of tokens) {
      for (const hit of scoreScreenForToken(screen, token)) {
        total += hit.score;
        fields.add(hit.field);
        for (const term of hit.terms) terms.add(term);
      }
    }
    if (total === 0) continue;

    // ナビに出る画面（一覧・設定の入口）をわずかに優遇する。フォーム・詳細は
    // 動的URLで直接飛べないことも多く、迷子の答えとしては入口の方が役に立つ。
    if (screen.nav) total += 8;

    results.push({
      key: screen.key,
      label: screen.label,
      url: screen.path,
      group: screen.group,
      matchedOn: FIELD_ORDER.filter((f) => fields.has(f)),
      matchedTerms: [...terms],
      description: screen.description,
      score: total
    });
  }

  // 同点は宣言順（＝カタログの並び＝業務のまとまり順）で安定させる。
  // sort は安定ソートなので、push 順を保つために key では並べ替えない。
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, Math.max(0, limit));
}
