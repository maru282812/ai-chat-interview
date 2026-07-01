import {
  type RandomizationBlock,
  type RandomizationQuestion,
  computeDisplayOrder
} from "../lib/randomization";
import { computeOptionOrder } from "../lib/optionRandomization";
import { extractOrderingEdges } from "../lib/surveyValidation";
import { sessionRepository } from "../repositories/sessionRepository";
import { snapshotService } from "./snapshotService";
import { logger } from "../lib/logger";
import type { Project, Question, QuestionPageGroup, Session } from "../types/domain";

/**
 * surveyOrderingService（統計エクスポート §3 / §22）
 *
 * ページグループ＝ブロックとして、回答者ごとの表示順を依存順を壊さず決定的に確定する。
 * - 回答開始(LIFFアンケート表示)時に1度だけ順序を計算し、seed・display_order・snapshot を session に保存。
 * - 以後は保存済みの順序を再利用（同一回答者は常に同じ並び）。
 * - ランダム化が未設定なら何もしない（後方互換：従来どおりマスター順）。
 *
 * 並べ替えは、レンダリング用 DTO の sort_order を表示順位で上書きして反映する
 * （survey.ejs はクライアント側で sort_order 昇順に整列するため）。
 */

export function isRandomizationConfigured(pageGroups: QuestionPageGroup[]): boolean {
  return pageGroups.some((group) => group.is_randomizable === true || group.randomize_within === true);
}

/**
 * 選択肢ランダム化（L3）を回答者ごとに適用する。ページ設定とは独立に常に適用。
 * seed は session×設問で決定的（再描画で同じ並び）。アンカー（その他/特になし）は固定。
 */
function applyOptionRandomization(questions: Question[], sessionId: string): Question[] {
  return questions.map((question) => {
    const config = question.question_config?.option_randomization;
    const options = question.question_config?.options;
    if (!config?.enabled || !options || options.length <= 1) {
      return question;
    }
    const ordered = computeOptionOrder(options, config, `${sessionId}:${question.id}`);
    return { ...question, question_config: { ...question.question_config, options: ordered } };
  });
}

function reorderByPosition(
  questions: Question[],
  pageGroups: QuestionPageGroup[],
  order: Map<string, number>
): { questions: Question[]; pageGroups: QuestionPageGroup[] } {
  // sort_order を表示順位で上書きし、かつ配列自体も並べ替える。
  // - survey_page: クライアントが sort_order で再整列（上書き値で反映）
  // - survey_question: クライアントは配列順をそのまま使う（配列並べ替えで反映）
  const orderedQuestions = questions
    .map((question) => ({
      ...question,
      sort_order: order.get(question.id) ?? question.sort_order
    }))
    .sort((left, right) => left.sort_order - right.sort_order);

  // ページ(ブロック)順は、各ページに属する設問の最小表示順位で決める（＝ブロック表示順に一致）。
  const pageMinPosition = new Map<string, number>();
  for (const question of orderedQuestions) {
    if (question.page_group_id) {
      const current = pageMinPosition.get(question.page_group_id);
      if (current === undefined || question.sort_order < current) {
        pageMinPosition.set(question.page_group_id, question.sort_order);
      }
    }
  }
  const orderedPageGroups = pageGroups.map((group) => ({
    ...group,
    sort_order: pageMinPosition.get(group.id) ?? group.sort_order
  }));

  return { questions: orderedQuestions, pageGroups: orderedPageGroups };
}

export const surveyOrderingService = {
  isRandomizationConfigured,

  /**
   * 回答者ごとの表示順を解決して、並べ替え済みの questions / pageGroups を返す。
   * 初回計算時は seed・display_order・snapshot を session に保存する。
   */
  async resolveOrder(input: {
    session: Session;
    project: Project;
    questions: Question[];
    pageGroups: QuestionPageGroup[];
  }): Promise<{ questions: Question[]; pageGroups: QuestionPageGroup[] }> {
    const { session, project, pageGroups } = input;

    // L3 選択肢ランダム化はページ設定に関係なく常に適用する。
    const questions = applyOptionRandomization(input.questions, session.id);

    // パターン1: プロジェクト単位の簡単トグル（ブロック不要で全設問をランダム表示）。
    const projectLevelRandomize = project.randomize_question_order === true;
    const pageConfigured = isRandomizationConfigured(pageGroups);
    if (!projectLevelRandomize && !pageConfigured) {
      return { questions, pageGroups };
    }

    // 既に確定済みなら再利用（同一回答者は常に同じ並び）。
    if (session.display_order_json && Object.keys(session.display_order_json).length > 0) {
      const order = new Map(
        Object.entries(session.display_order_json).map(([questionId, position]) => [questionId, Number(position)])
      );
      return reorderByPosition(questions, pageGroups, order);
    }

    const seed = session.id; // 回答者ごとに決定的・再現可能(§22)

    // ブロック設定があればブロック単位、無ければ「全設問を1つのランダムブロック」として扱う。
    const ALL_BLOCK = "__all__";
    const blocks: RandomizationBlock[] = pageConfigured
      ? pageGroups.map((group) => ({
          block_code: group.id,
          master_order: group.sort_order,
          is_randomizable: group.is_randomizable ?? false,
          randomize_within: group.randomize_within ?? false,
          fix_within: group.fix_within ?? false
        }))
      : [{ block_code: ALL_BLOCK, master_order: 0, is_randomizable: false, randomize_within: true, fix_within: false }];
    const randomizationQuestions: RandomizationQuestion[] = questions.map((question) => ({
      id: question.id,
      question_code: question.question_code.toLowerCase(),
      block_code: pageConfigured ? question.page_group_id ?? null : ALL_BLOCK,
      master_order: question.sort_order
    }));
    const edges = extractOrderingEdges(questions);

    const { order } = computeDisplayOrder({ questions: randomizationQuestions, blocks, edges, seed });

    // 永続化（スナップショット凍結＋seed＋順序）。失敗しても回答継続を妨げない。
    try {
      const snapshot = await snapshotService.createOrReuse(project.id);
      await sessionRepository.update(session.id, {
        randomization_seed: seed,
        display_order_json: Object.fromEntries(order),
        snapshot_id: snapshot.id
      });
    } catch (error) {
      logger.warn("[surveyOrderingService] failed to persist display order", {
        sessionId: session.id,
        error: String(error)
      });
    }

    return reorderByPosition(questions, pageGroups, order);
  }
};
