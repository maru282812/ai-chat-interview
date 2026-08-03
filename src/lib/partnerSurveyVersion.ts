import { createHash } from "node:crypto";

import type { PartnerQuestionView } from "./partnerQuestions";

/**
 * partnerSurveyVersion.ts
 *
 * 店舗専用アンケートの「版」を、設問の**内容そのもの**から算出する純関数。
 * 楽観ロック（`PUT /api/partner/surveys/:id` の `base_version`）で使う。
 *
 * ## なぜ updated_at ではなく内容ハッシュなのか
 * `SurveyView.updated_at` は `projects.updated_at` だけを返している
 * （`toSurveyView()` 参照）。ところが `updated_at` は**テーブルごとのトリガ**で
 * 動くため（`supabase/migrations/001_init.sql` の trg_projects_updated_at /
 * trg_questions_updated_at）、**設問だけを編集すると `questions` 側しか動かず
 * `projects.updated_at` は据え置き**になる。
 *
 * つまり updated_at を版に使うと「運営が管理画面で設問だけ直した」という
 * いちばん検知したい競合をすり抜ける。だから内容から作る。
 *
 * ## question_code を軸にしない理由
 * パートナー設問の `question_code`（pq1, pq2, ...）は保存のたびに index で
 * 振り直される。これを含めると「2番目と3番目を入れ替えただけ」でも
 * 全設問のコードがズレて別版に見える……のは実は**正しい**（並びが変われば
 * 中身は変わっている）。ただしコード自体は再採番の副産物でしかないので、
 * 版の材料には**並び順（配列の位置）と内容だけ**を使い、コードは混ぜない。
 *
 * ## 固定設問（性年代）を除く理由
 * `__partner_gender__` / `__partner_age__` はサーバーが毎回再構築する。
 * 版に含めると再構築のたびに版が変わり、誰も編集していないのに競合になる。
 *
 * ## この関数の絶対条件
 * DB もネットワークも触らない。入力は設問ビューの配列だけ。
 * ポータル側（hibi-site）は `question_key` という独自の軸を持っているが、
 * **ACI はそれを一切知らない**。よってここでは question_key に依存しない。
 * 「何がどう変わったか」の解釈はポータル側の責務で、ここは
 * 「変わったか否か」だけを判定できれば十分。
 */

/** 版の材料に使う、1設問ぶんの正規化済みデータ。 */
interface VersionedQuestion {
  text: string;
  type: string;
  required: boolean;
  options: { value: string; label: string }[];
}

/**
 * 文言の揺れを版に反映させない正規化。
 * 改行コードと前後の空白だけ潰す（`survey-diff.ts` の normalizeText と同じ方針）。
 */
function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * 版の材料になる形へ落とす。
 * `sort_order` の実値は使わず**配列の並び順**で表現する
 * （サーバーが 10, 11, 12... と振り直すため、実値は安定しない）。
 */
function toVersionedQuestions(questions: PartnerQuestionView[]): VersionedQuestion[] {
  return questions
    .filter((question) => !question.is_fixed)
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((question) => ({
      text: normalizeText(question.question_text),
      type: normalizeText(question.question_type),
      required: question.is_required,
      // free_text は選択肢を持たない。null と [] の揺れを版に出さない
      options: (question.answer_options ?? []).map((option) => ({
        value: normalizeText(option.value),
        label: normalizeText(option.label)
      }))
    }));
}

/**
 * 設問配列から版文字列を作る。
 *
 * 戻り値は `sha256:` 前置きの16進64文字。前置きは、将来アルゴリズムを
 * 変えたときに「古い版」と識別できるようにするため
 * （比較は文字列一致なので、前置きが変われば必ず不一致＝安全側に倒れる）。
 *
 * タイトルは**含めない**。タイトル変更は設問の集計互換性に影響せず、
 * ここに含めると「店舗がタイトルだけ直した」で競合が出て邪魔になる。
 */
export function computeSurveyVersion(questions: PartnerQuestionView[]): string {
  const material = toVersionedQuestions(questions);
  const json = JSON.stringify(material);
  return `sha256:${createHash("sha256").update(json, "utf8").digest("hex")}`;
}
