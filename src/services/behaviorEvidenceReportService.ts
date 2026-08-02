/**
 * behaviorEvidenceReportService.ts
 *
 * GO / PIVOT / STOP 判定支援レポート（要件 §6.5〜6.6）。
 *
 * 責務:
 * - 案件の回答を読み、P13 役割タグ（research_goal の `[P13:...]`）で設問を分類する
 * - 回答者ごとに証拠の確度を判定する（§6.5）
 * - 判定基準ごとの充足状況を組み立てる（§6.6）
 *
 * **やらないこと: GO / PIVOT / STOP の断定**（§3-2）。
 * このサービスが返すのは基準ごとの met / unmet / unknown と根拠だけで、
 * 「GOです」と書くのは差し戻し条件（§10）。文言を足すときもここを崩さないこと。
 *
 * 判定ロジックは src/lib/behaviorEvidence.ts の純関数に置いてあり、ここは
 * DB からの材料集めと組み立てに徹する（テストは純関数側で担保する）。
 */

import {
  classifyEvidenceStrength,
  ECONOMIC_VALUE_ROLES,
  EVIDENCE_STRENGTH_LABELS,
  parseP13Role,
  stripP13Role,
  summarizeJudgement,
  type EvidenceStrength,
  type JudgementInput,
  type JudgementSummary,
  type P13Role,
} from "../lib/behaviorEvidence";
import { answerRepository } from "../repositories/answerRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import type { Answer, Question, ResearchHypothesis } from "../types/domain";

/** 1回のレポートで読むセッションの上限。超えたらその旨をレポートに明示する */
const MAX_SESSIONS = 300;
/** verbatim 引用の1件あたり文字数 */
const MAX_QUOTE_CHARS = 300;
/** 各基準に添える引用の件数 */
const MAX_QUOTES_PER_ROLE = 5;

/** 「満足している」と読む回答文字列（現行手段への満足度・選択式） */
const SATISFIED_PATTERN = /(とても満足|満足|やや満足|十分|問題ない|困っていない|不満はない)/;
const DISSATISFIED_PATTERN = /(不満|満足していない|困って|不便)/;

/** 購入に近い行動を承諾したと読む回答文字列 */
const COMMITMENT_YES_PATTERN = /(はい|可能|協力できる|できます|問題ない|OK|大丈夫|よい|良い|承諾)/i;
const COMMITMENT_NO_PATTERN = /(いいえ|難しい|できません|不可|遠慮|お断り|無理)/;

/** 「次にいつ起きるか」を答えられたと読む表現 */
const NEXT_OCCURRENCE_PATTERN =
  /(来週|来月|再来月|今月末|月末|月初|来年|毎月|毎週|次回|\d{1,2}\s*月|\d{1,2}\s*日後|\d+\s*(日|週間|か月|ヶ月|カ月)後)/;

function questionResearchGoal(question: Question): string {
  const config = (question.question_config ?? {}) as Record<string, unknown>;
  const meta = (config.meta ?? {}) as Record<string, unknown>;
  return typeof meta.research_goal === "string" ? meta.research_goal : "";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function answerText(answer: Answer): string {
  const free = (answer.free_text_answer ?? "").trim();
  const text = (answer.answer_text ?? "").trim();
  // 自由記述の方が語りが濃い。両方あるときは結合して確度判定の材料にする
  if (free && text && free !== text) return `${text} / ${free}`;
  return free || text;
}

/** 数値として読めるか（時間損失・金銭損失の「回答した人数」を数えるため） */
function hasNumericValue(text: string): boolean {
  if (text.trim() === "") return false;
  // 「0」や「なし」は損失を申告していないので数えない
  if (/^(0|０|なし|ない|不明|わからない|覚えていない)$/.test(text.trim())) return false;
  return /[0-9０-９]/.test(text);
}

export interface RoleQuote {
  respondentLabel: string;
  questionText: string;
  /** 原文のまま（要約・言い換えをしない。§6.7 と同じ原則） */
  quote: string;
}

export interface EvidenceReport {
  project: { id: string; name: string };
  /** 調査仮説シート。未入力なら null（＝この案件は behavior_evidence で生成していない） */
  hypothesis: ResearchHypothesis | null;
  /** フローに P13 役割タグ付きの設問があるか。無ければレポートの意味が薄い */
  taggedQuestionCount: number;
  totalQuestionCount: number;
  /** 完了セッション数（＝回答者数の代理） */
  respondentCount: number;
  /** 読み込み上限で打ち切ったか */
  truncated: boolean;
  /** 確度別の人数（1人につき最も高い確度で1回だけ数える） */
  strengthCounts: Record<EvidenceStrength, number>;
  strengthLabels: Record<EvidenceStrength, string>;
  judgement: JudgementSummary;
  /** 根拠として添える原文引用（役割別） */
  quotes: Partial<Record<P13Role, RoleQuote[]>>;
  /** 運営者への注意書き（母数不足・タグ無し等） */
  notes: string[];
}

export const behaviorEvidenceReportService = {
  /**
   * 案件の回答から判定支援レポートの材料を組み立てる。
   * 判定はしない（summarizeJudgement が返すのは基準ごとの充足状況）。
   */
  async buildReport(projectId: string): Promise<EvidenceReport> {
    const [project, questions, allSessions] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId, { includeHidden: true }),
      sessionRepository.listByProject(projectId),
    ]);

    const notes: string[] = [];

    // 設問を P13 役割で引けるようにする
    const roleByQuestionId = new Map<string, P13Role>();
    const questionById = new Map<string, Question>();
    for (const question of questions) {
      questionById.set(question.id, question);
      const role = parseP13Role(questionResearchGoal(question));
      if (role) roleByQuestionId.set(question.id, role);
    }

    if (roleByQuestionId.size === 0) {
      notes.push(
        "この案件の設問に P13 役割タグ（research_goal の [P13:...]）が付いていません。" +
          "顧客発見モードで生成したフローでない場合、このレポートの分類は機能しません。"
      );
    }

    // 完了セッションのみを母数にする。途中離脱を混ぜると「行動証拠が取れなかった」のか
    // 「そこまで到達していない」のかが区別できなくなる。
    const completed = allSessions.filter((session) => session.status === "completed");
    const truncated = completed.length > MAX_SESSIONS;
    const targetSessions = completed.slice(0, MAX_SESSIONS);
    if (truncated) {
      notes.push(
        `完了セッションが ${completed.length} 件あるため、直近 ${MAX_SESSIONS} 件のみで集計しました。`
      );
    }

    const answers = await answerRepository.listBySessions(
      targetSessions.map((session) => session.id)
    );

    // セッション単位に回答をまとめる。深掘り（probe）は親設問の材料として合流させる
    const bySession = new Map<string, Answer[]>();
    for (const answer of answers) {
      const list = bySession.get(answer.session_id);
      if (list) list.push(answer);
      else bySession.set(answer.session_id, [answer]);
    }

    const strengthCounts: Record<EvidenceStrength, number> = {
      statement_only: 0,
      concrete_recall: 0,
      numeric: 0,
    };
    const quotes: Partial<Record<P13Role, RoleQuote[]>> = {};

    let timeLossReportedCount = 0;
    let moneyLossReportedCount = 0;
    let satisfiedWithCurrentCount = 0;
    let nextOccurrenceKnownCount = 0;
    let commitmentCount = 0;

    for (const [index, session] of targetSessions.entries()) {
      const sessionAnswers = bySession.get(session.id) ?? [];
      const respondentLabel = `回答者${index + 1}`;

      // 深掘りは親回答に紐づく。行動の具体は深掘りで出ることが多いので確度判定に含める
      const probesByParent = new Map<string, string[]>();
      for (const answer of sessionAnswers) {
        if (answer.answer_role === "primary" || !answer.parent_answer_id) continue;
        const text = answerText(answer);
        if (text === "") continue;
        const list = probesByParent.get(answer.parent_answer_id);
        if (list) list.push(text);
        else probesByParent.set(answer.parent_answer_id, [text]);
      }

      let sessionBest: EvidenceStrength = "statement_only";
      let sawRecentBehaviorAnswer = false;
      let commitmentYes = false;

      for (const answer of sessionAnswers) {
        if (answer.answer_role !== "primary") continue;
        const role = roleByQuestionId.get(answer.question_id);
        if (!role) continue;

        const question = questionById.get(answer.question_id);
        const text = answerText(answer);
        const probeTexts = probesByParent.get(answer.id) ?? [];

        // ── 確度は「行動を語らせる設問」でのみ測る。
        //    数値設問や協力可否から確度を出すと、選択肢を押しただけで
        //    「証拠が取れた」ことになってしまう。
        if (role === "recent_behavior" || role === "past_attempt" || role === "decision_maker") {
          sawRecentBehaviorAnswer = true;
          const classified = classifyEvidenceStrength({
            answerText: text,
            probeTexts,
          });
          if (
            classified.strength === "numeric" ||
            (classified.strength === "concrete_recall" && sessionBest === "statement_only")
          ) {
            sessionBest = classified.strength;
          }
        }

        // ── 経済価値の実数
        if (role === "economic_value/time_loss" && hasNumericValue(text)) {
          timeLossReportedCount += 1;
        }
        if (role === "economic_value/money_loss" && hasNumericValue(text)) {
          moneyLossReportedCount += 1;
        }
        if (role === "economic_value/satisfaction" && text !== "") {
          // 「不満」を含む文字列は満足に数えない（"満足していない" の誤カウント防止）
          if (!DISSATISFIED_PATTERN.test(text) && SATISFIED_PATTERN.test(text)) {
            satisfiedWithCurrentCount += 1;
          }
        }

        // ── 次に問題が起きる時期。設問文でなく回答に時期表現があるかで見る
        if (role === "recent_behavior" && NEXT_OCCURRENCE_PATTERN.test([text, ...probeTexts].join("\n"))) {
          nextOccurrenceKnownCount += 1;
        }

        // ── 購入に近い行動。1人が複数承諾しても1人として数える
        if (role === "commitment" && text !== "") {
          if (!COMMITMENT_NO_PATTERN.test(text) && COMMITMENT_YES_PATTERN.test(text)) {
            commitmentYes = true;
          }
        }

        // ── 根拠となる原文引用（要約しない）
        if (text !== "") {
          const list = quotes[role] ?? [];
          if (list.length < MAX_QUOTES_PER_ROLE) {
            list.push({
              respondentLabel,
              questionText: question ? question.question_text : "",
              quote: truncate([text, ...probeTexts].join(" / "), MAX_QUOTE_CHARS),
            });
            quotes[role] = list;
          }
        }
      }

      if (commitmentYes) commitmentCount += 1;
      // 行動を聞く設問に一度も答えていない人は statement_only にも数えない方が
      // 正確だが、母数を揃えないと割合が読めなくなるため最弱として数える。
      if (!sawRecentBehaviorAnswer) {
        strengthCounts.statement_only += 1;
      } else {
        strengthCounts[sessionBest] += 1;
      }
    }

    // 次回時期は「行動設問の回答者数」を超えうる（複数設問に時期表現が出る）ので丸める
    nextOccurrenceKnownCount = Math.min(nextOccurrenceKnownCount, targetSessions.length);

    const presentRoles = new Set(roleByQuestionId.values());
    const economicValueComplete = ECONOMIC_VALUE_ROLES.every((role) => presentRoles.has(role));

    const judgementInput: JudgementInput = {
      respondentCount: targetSessions.length,
      strengthCounts,
      timeLossReportedCount,
      moneyLossReportedCount,
      satisfiedWithCurrentCount,
      nextOccurrenceKnownCount,
      commitmentCount,
      economicValueComplete,
    };

    const judgement = summarizeJudgement(judgementInput);

    if (judgement.insufficientSample) {
      notes.push(
        `完了回答が ${targetSessions.length} 人です。判定基準は同一セグメント5〜10人を前提にしているため、` +
          "この段階では「まだ分からない（unknown）」の基準が多く出ます。人数を増やしてから読んでください。"
      );
    }

    const hypothesis = project.research_hypothesis_json ?? null;
    if (!hypothesis) {
      notes.push(
        "調査仮説シートが保存されていません。失敗条件（何が確認できなければ STOP か）が" +
          "記録されていないため、基準の突き合わせは一般的な運用基準のみで行っています。"
      );
    }

    return {
      project: { id: project.id, name: project.name },
      hypothesis,
      taggedQuestionCount: roleByQuestionId.size,
      totalQuestionCount: questions.length,
      respondentCount: targetSessions.length,
      truncated,
      strengthCounts,
      strengthLabels: EVIDENCE_STRENGTH_LABELS,
      judgement,
      quotes,
      notes,
    };
  },

  /** 設問の research_goal からタグを外した本文（管理画面表示用の薄いラッパ） */
  describeGoal(question: Question): string {
    return stripP13Role(questionResearchGoal(question));
  },
};
