import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveCodebook } from "../lib/codebook";
import type { ExportAnswerGroup, ExportRespondent } from "../lib/statExport";
import {
  type RawdataRespondent,
  ageBand,
  assignQNumbers,
  buildRawdataColumnIndex,
  buildRawdataLayoutRows,
  buildRawdataRows,
  buildStatusCounts,
  computeAge
} from "../lib/rawdataExport";
import type { Answer, Question, QuestionConfig } from "../types/domain";

function makeQuestion(
  partial: Partial<Question> & Pick<Question, "question_code" | "question_type" | "sort_order">
): Question {
  return {
    id: partial.id ?? `qid-${partial.question_code}`,
    project_id: "p1",
    question_code: partial.question_code,
    question_text: partial.question_text ?? "質問文",
    comment_top: null,
    comment_bottom: null,
    question_role: partial.question_role ?? "main",
    question_type: partial.question_type,
    is_required: partial.is_required ?? true,
    sort_order: partial.sort_order,
    answer_output_type: null,
    display_tags_raw: null,
    display_tags_parsed: null,
    visibility_conditions: null,
    page_group_id: null,
    branch_rule: null,
    question_config: partial.question_config ?? null,
    ai_probe_enabled: partial.ai_probe_enabled ?? false,
    probe_guideline: null,
    max_probe_count: null,
    render_strategy: "static",
    answer_options_locked: false,
    is_screening_question: false,
    is_system: false,
    is_hidden: false,
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:00:00.000Z"
  };
}

function makeAnswer(partial: Partial<Answer> & Pick<Answer, "question_id">): Answer {
  return {
    id: partial.id ?? `aid-${Math.random().toString(36).slice(2)}`,
    session_id: partial.session_id ?? "s1",
    question_id: partial.question_id,
    answer_text: partial.answer_text ?? "",
    free_text_answer: partial.free_text_answer ?? null,
    answer_role: partial.answer_role ?? "primary",
    parent_answer_id: partial.parent_answer_id ?? null,
    normalized_answer: partial.normalized_answer ?? null,
    created_at: partial.created_at ?? "2026-07-12T00:01:00.000Z"
  };
}

const Q_SINGLE = makeQuestion({
  question_code: "Q1",
  question_type: "single_choice",
  sort_order: 1,
  question_config: { options: [{ value: "tea", label: "お茶" }, { value: "coffee", label: "コーヒー" }] }
});
const Q_MULTI = makeQuestion({
  question_code: "Q2",
  question_type: "multi_choice",
  sort_order: 2,
  question_config: {
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C", allow_free_text: true }
    ]
  }
});
const Q_NUM = makeQuestion({ question_code: "Q3", question_type: "numeric", sort_order: 3, question_config: { scaleMin: 1, scaleMax: 5 } });
const Q_TEXT = makeQuestion({ question_code: "Q4", question_type: "free_text_long", sort_order: 4, ai_probe_enabled: true });
const Q_MATRIX_S = makeQuestion({
  question_code: "Q5",
  question_type: "matrix_single",
  sort_order: 5,
  question_config: {
    matrix_rows: [{ value: "r1", label: "味" }, { value: "r2", label: "価格" }],
    matrix_cols: [{ value: "1", label: "不満" }, { value: "2", label: "普通" }, { value: "3", label: "満足" }]
  } as unknown as QuestionConfig
});
const Q_MATRIX_M = makeQuestion({
  question_code: "Q6",
  question_type: "matrix_multi",
  sort_order: 6,
  question_config: {
    matrix_rows: [{ value: "r1", label: "朝" }],
    matrix_cols: [{ value: "1", label: "パン" }, { value: "2", label: "米" }, { value: "3", label: "麺" }]
  } as unknown as QuestionConfig
});

const QUESTIONS = [Q_SINGLE, Q_MULTI, Q_NUM, Q_TEXT, Q_MATRIX_S, Q_MATRIX_M];
const VARIABLES = deriveCodebook(QUESTIONS);

function groupsFor(map: Record<string, { primary?: Answer; probes?: Answer[] }>): ExportAnswerGroup[] {
  return QUESTIONS.map((question) => ({
    question,
    primaryAnswer: map[question.id]?.primary ?? null,
    extraction: null,
    probeAnswers: map[question.id]?.probes ?? []
  }));
}

function makeRespondent(partial: Partial<RawdataRespondent> = {}): RawdataRespondent {
  const base: ExportRespondent = {
    respondent_key: "r-A",
    session_id: "s-A",
    response_status: "completed",
    is_test: false,
    channel: "liff",
    started_at: "2026-07-12T00:00:00.000Z",
    completed_at: "2026-07-12T00:05:30.000Z",
    total_duration_sec: 330,
    groups: groupsFor({
      [Q_SINGLE.id]: { primary: makeAnswer({ question_id: Q_SINGLE.id, normalized_answer: { value: "coffee" }, answer_text: "コーヒー", created_at: "2026-07-12T00:01:10.000Z" }) },
      [Q_MULTI.id]: { primary: makeAnswer({ question_id: Q_MULTI.id, normalized_answer: { values: ["a", "c"] }, answer_text: "A,C", free_text_answer: "抹茶ラテ" }) },
      [Q_NUM.id]: { primary: makeAnswer({ question_id: Q_NUM.id, normalized_answer: { value: 4 }, answer_text: "4" }) },
      [Q_TEXT.id]: {
        primary: makeAnswer({ id: "primary-q4", question_id: Q_TEXT.id, answer_text: "好きだから" }),
        probes: [makeAnswer({ question_id: Q_TEXT.id, answer_role: "ai_probe", parent_answer_id: "primary-q4", answer_text: "味が好き", normalized_answer: { probe_question: "具体的には?" } })]
      },
      [Q_MATRIX_S.id]: { primary: makeAnswer({ question_id: Q_MATRIX_S.id, answer_text: JSON.stringify({ "0": 2, "1": 0 }) }) },
      [Q_MATRIX_M.id]: { primary: makeAnswer({ question_id: Q_MATRIX_M.id, answer_text: JSON.stringify({ "0": [0, 2] }) }) }
    })
  };
  return { ...base, ...partial };
}

const ASSIGNMENTS = assignQNumbers(VARIABLES, QUESTIONS);

test("rawdata: q番号は master_order 昇順で1始まり", () => {
  assert.equal(ASSIGNMENTS.length, 6);
  assert.equal(ASSIGNMENTS[0]!.variable.question_code, "Q1");
  assert.equal(ASSIGNMENTS[0]!.qNumber, 1);
  assert.equal(ASSIGNMENTS[5]!.variable.question_code, "Q6");
  assert.equal(ASSIGNMENTS[5]!.qNumber, 6);
});

test("rawdata: コード出力（SA=位置コード・MA=フラグ・マトリクス展開・メタ列）", () => {
  const rows = buildRawdataRows(ASSIGNMENTS, [makeRespondent()]);
  assert.equal(rows.length, 1);
  const row = rows[0]!;

  // メタ
  assert.equal(row.MID, "r-A");
  assert.equal(row.STA, "COMP");
  assert.equal(row.TIME, "0:5:30");
  assert.equal(row.IS_TEST, 0);

  // SA: coffee は2番目 → 2
  assert.equal(row.q1, 2);
  // MA: a,c 選択
  assert.equal(row.q2c1, 1);
  assert.equal(row.q2c2, 0);
  assert.equal(row.q2c3, 1);
  assert.equal(row.q2t1, "抹茶ラテ");
  // 数値
  assert.equal(row.q3, 4);
  // 自由記述
  assert.equal(row.q4t1, "好きだから");
  // マトリクス single: 行1=列3(満足), 行2=列1(不満)
  assert.equal(row.q5s1, 3);
  assert.equal(row.q5s2, 1);
  // マトリクス multi: 行1 = パン+麺
  assert.equal(row.q6s1c1, 1);
  assert.equal(row.q6s1c2, 0);
  assert.equal(row.q6s1c3, 1);
  // 設問別回答時刻
  assert.equal(row.q1_datetime, "2026-07-12T00:01:10.000Z");
  // 深掘り（既定ON・ai_probe_enabled の Q4 のみ）
  assert.equal(row.q4_probe_count, 1);
  assert.equal(row.q4_final_answer_text, "好きだから / 味が好き");
  assert.ok(!("q1_probe_count" in row), "probe無効設問には深掘り列が付かない");
});

test("rawdata: 回答値（ラベル）出力", () => {
  const rows = buildRawdataRows(ASSIGNMENTS, [makeRespondent()], { mode: "label" });
  const row = rows[0]!;
  assert.equal(row.q1, "コーヒー");
  assert.equal(row.q5s1, "満足");
  assert.equal(row.q5s2, "不満");
});

test("rawdata: ステータスフィルタ（既定で未完了も含む・指定で完了のみに絞れる）", () => {
  const partial = makeRespondent({ respondent_key: "r-P", response_status: "partial", completed_at: null, total_duration_sec: null });
  const defaultRows = buildRawdataRows(ASSIGNMENTS, [makeRespondent(), partial]);
  assert.equal(defaultRows.length, 2, "既定は completed/partial/abandoned（裁定は集計アプリ側）");
  assert.equal(defaultRows[1]!.STA, "PARTIAL");
  assert.equal(defaultRows[1]!.TIME, "", "既存 TIME は完了者のみ");

  const completedOnly = buildRawdataRows(ASSIGNMENTS, [makeRespondent(), partial], { statuses: ["completed"] });
  assert.equal(completedOnly.length, 1);
});

test("rawdata: TIME_SEC（完了=開始→完了・未完了=開始→最終回答時刻・回答ゼロは空欄）", () => {
  const completed = buildRawdataRows(ASSIGNMENTS, [makeRespondent()])[0]!;
  assert.equal(completed.TIME_SEC, 330);

  // 未完了: 最終回答は Q1 の 00:01:10（既定の groups で最も遅い created_at）
  const partial = makeRespondent({
    respondent_key: "r-P",
    response_status: "partial",
    completed_at: null,
    total_duration_sec: null,
    groups: groupsFor({
      [Q_SINGLE.id]: { primary: makeAnswer({ question_id: Q_SINGLE.id, answer_text: "コーヒー", created_at: "2026-07-12T00:02:00.000Z" }) }
    })
  });
  const partialRow = buildRawdataRows(ASSIGNMENTS, [partial], { statuses: ["partial"] })[0]!;
  assert.equal(partialRow.TIME_SEC, 120);

  const noAnswer = makeRespondent({ respondent_key: "r-Z", response_status: "partial", completed_at: null, total_duration_sec: null, groups: groupsFor({}) });
  assert.equal(buildRawdataRows(ASSIGNMENTS, [noAnswer], { statuses: ["partial"] })[0]!.TIME_SEC, "");
});

test("rawdata: SURVEY_VERSION（回答した調査票の版数・未確定は空欄）", () => {
  const versioned = buildRawdataRows(ASSIGNMENTS, [makeRespondent({ snapshot_version: 3 })])[0]!;
  assert.equal(versioned.SURVEY_VERSION, 3);
  assert.equal(buildRawdataRows(ASSIGNMENTS, [makeRespondent()])[0]!.SURVEY_VERSION, "");
});

test("rawdata: テスト回答は既定除外・excludeTest:false で含む", () => {
  const testRespondent = makeRespondent({ respondent_key: "r-T", is_test: true });
  assert.equal(buildRawdataRows(ASSIGNMENTS, [makeRespondent(), testRespondent]).length, 1);
  const included = buildRawdataRows(ASSIGNMENTS, [makeRespondent(), testRespondent], { excludeTest: false });
  assert.equal(included.length, 2);
  assert.equal(included[1]!.IS_TEST, 1);
});

test("rawdata: 未回答は欠損センチネル（完了=無回答'.'・テキスト列は空欄）", () => {
  const empty = makeRespondent({ respondent_key: "r-E", groups: groupsFor({}) });
  const row = buildRawdataRows(ASSIGNMENTS, [empty])[0]!;
  assert.equal(row.q1, ".");
  assert.equal(row.q2c1, ".");
  assert.equal(row.q2t1, "");
  assert.equal(row.q4t1, "");
  assert.equal(row.q5s1, ".");
  assert.equal(row.q1_datetime, "");
});

test("rawdata: includeProbe:false で深掘り列が消える", () => {
  const assignments = assignQNumbers(VARIABLES, QUESTIONS, { includeProbe: false });
  const row = buildRawdataRows(assignments, [makeRespondent()])[0]!;
  assert.ok(!("q4_probe_count" in row));
  assert.ok(!("q4_final_answer_text" in row));
});

test("rawdata: 属性列のコード化（code/label両モード）", () => {
  const profile = {
    gender: "female",
    birth_date: "1990-06-15",
    prefecture: "東京都",
    occupation: "会社員（正社員）",
    industry: "小売・流通",
    marital_status: "married",
    has_children: true,
    household_income: "200_400"
  };
  const codeRow = buildRawdataRows(ASSIGNMENTS, [makeRespondent({ profile, rank_code: "silver", rank_name: "シルバー" })])[0]!;
  assert.equal(codeRow.SEX, 2);
  assert.equal(codeRow.AGE, 36); // 2026-07-12 時点・1990-06-15生 → 36歳
  assert.equal(codeRow.AGE_BAND, 30);
  assert.equal(codeRow.PRE, 13);
  assert.equal(codeRow.REGION, "関東地方");
  assert.equal(codeRow.JOB, 1);
  assert.equal(codeRow.BUS, 6);
  assert.equal(codeRow.MAR, 2);
  assert.equal(codeRow.INC, 2);
  assert.equal(codeRow.CHI, 1);
  assert.equal(codeRow.RANK, "silver");

  const labelRow = buildRawdataRows(ASSIGNMENTS, [makeRespondent({ profile, rank_code: "silver", rank_name: "シルバー" })], { mode: "label" })[0]!;
  assert.equal(labelRow.SEX, "女性");
  assert.equal(labelRow.PRE, "東京都");
  assert.equal(labelRow.REGION, "関東地方");
  assert.equal(labelRow.JOB, "会社員（正社員）");
  assert.equal(labelRow.BUS, "小売・流通");
  assert.equal(labelRow.MAR, "既婚");
  assert.equal(labelRow.INC, "200〜400万円未満");
  assert.equal(labelRow.CHI, "あり");
  assert.equal(labelRow.RANK, "シルバー");

  // コード表に無いラベル（旧データ・表記ゆれ）は 99
  const legacy = buildRawdataRows(ASSIGNMENTS, [makeRespondent({ profile: { ...profile, occupation: "会社員", industry: "小売" } })])[0]!;
  assert.equal(legacy.JOB, 99);
  assert.equal(legacy.BUS, 99);

  // プロフィール未登録は空欄
  const noProfile = buildRawdataRows(ASSIGNMENTS, [makeRespondent()])[0]!;
  assert.equal(noProfile.SEX, "");
  assert.equal(noProfile.AGE, "");
  assert.equal(noProfile.AGE_BAND, "");
  assert.equal(noProfile.REGION, "");
  assert.equal(noProfile.INC, "");
  assert.equal(noProfile.RANK, "");
});

test("ageBand: 10刻み（18〜19歳は10・上限90）", () => {
  assert.equal(ageBand(18), 10);
  assert.equal(ageBand(35), 30);
  assert.equal(ageBand(99), 90);
  assert.equal(ageBand(null), null);
});

test("rawdata: UserAgent/IPAddress は既定で出力しない（includePii でのみ出る）", () => {
  const withEnv = makeRespondent({ user_agent: "Mozilla/5.0 (iPhone)", ip_address: "203.0.113.1" });

  const defaultRow = buildRawdataRows(ASSIGNMENTS, [withEnv])[0]!;
  assert.ok(!("UserAgent" in defaultRow), "既定では個人情報列を出さない");
  assert.ok(!("IPAddress" in defaultRow));

  const piiRow = buildRawdataRows(ASSIGNMENTS, [withEnv], { includePii: true })[0]!;
  assert.equal(piiRow.UserAgent, "Mozilla/5.0 (iPhone)");
  assert.equal(piiRow.IPAddress, "203.0.113.1");

  const withoutEnv = buildRawdataRows(ASSIGNMENTS, [makeRespondent()], { includePii: true })[0]!;
  assert.equal(withoutEnv.UserAgent, "");
  assert.equal(withoutEnv.IPAddress, "");
});

test("computeAge: 誕生日前後で満年齢が変わる", () => {
  assert.equal(computeAge("1990-06-15", "2026-06-05T00:00:00.000Z"), 35);
  assert.equal(computeAge("1990-06-15", "2026-06-15T00:00:00.000Z"), 36);
  assert.equal(computeAge(null, "2026-06-15T00:00:00.000Z"), null);
});

test("layout: 全列の意味・コード表が引ける", () => {
  const rows = buildRawdataLayoutRows(ASSIGNMENTS);
  const byColumn = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byColumn.get(String(row.column_name)) ?? [];
    list.push(row);
    byColumn.set(String(row.column_name), list);
  }

  // SA はコード表が選択肢ぶん並ぶ
  const q1 = byColumn.get("q1")!;
  assert.equal(q1.length, 2);
  assert.equal(q1[0]!.code, 1);
  assert.equal(q1[0]!.label, "お茶");
  assert.equal(q1[0]!.question_code, "Q1");

  // MA フラグは選択肢1件ずつ
  assert.equal(byColumn.get("q2c3")![0]!.label, "C");

  // マトリクスは行ラベル付き
  const q5s1 = byColumn.get("q5s1")!;
  assert.equal(q5s1.length, 3);
  assert.ok(String(q5s1[0]!.column_role).includes("味"));

  // メタ・属性
  assert.ok(byColumn.has("MID"));
  assert.equal(byColumn.get("STA")!.length, 4);
  assert.equal(byColumn.get("SEX")!.length, 4);
  assert.ok(byColumn.has("PRE"));
  assert.equal(byColumn.get("INC")!.length, 10);
  assert.ok(byColumn.has("TIME_SEC"));
  assert.ok(byColumn.has("SURVEY_VERSION"));
  assert.ok(byColumn.has("AGE_BAND"));
  assert.equal(byColumn.get("REGION")!.length, 8, "8地方区分");
  assert.equal(byColumn.get("JOB")!.length, 9, "職業コード表");
  assert.equal(byColumn.get("BUS")!.length, 11, "業種コード表");
  assert.ok(byColumn.has("RANK"));

  // 個人情報列は既定で定義行も出さない（rawdata.csv 側と揃える）
  assert.ok(!byColumn.has("UserAgent"));
  assert.ok(!byColumn.has("IPAddress"));
  const withPii = buildRawdataLayoutRows(ASSIGNMENTS, { includePii: true });
  assert.ok(withPii.some((row) => row.column_name === "UserAgent"));
});

test("layout: ハブ突合キー（question_id / question_version / trait_key）が設問列に付く", () => {
  const rows = buildRawdataLayoutRows(ASSIGNMENTS, {
    questionVersion: 2,
    ranks: [{ rank_code: "bronze", rank_name: "ブロンズ" }]
  });

  const q1 = rows.find((row) => row.column_name === "q1")!;
  assert.equal(q1.question_id, Q_SINGLE.id);
  assert.equal(q1.question_version, 2);
  assert.equal(q1.trait_key, "", "metric_code 未設定は空欄（ハブ辞書に未登録）");

  // メタ・属性列には突合キーが付かない
  const sta = rows.find((row) => row.column_name === "STA")!;
  assert.equal(sta.question_id, "");
  assert.equal(sta.question_version, "");

  // ランクはコード表が引ける
  const rank = rows.find((row) => row.column_name === "RANK")!;
  assert.equal(rank.code, "bronze");
  assert.equal(rank.label, "ブロンズ");
  assert.ok(String(rank.note).includes("出力時点"));
});

test("columnIndex: 設問→ロウデータ列の対応（圧縮表記・列対応）", () => {
  const index = buildRawdataColumnIndex(ASSIGNMENTS);

  // SA は q1 のみ
  assert.equal(index.get(Q_SINGLE.id)!.q_number, 1);
  assert.equal(index.get(Q_SINGLE.id)!.summary, "q1");

  // MA 3肢は圧縮＋その他テキスト
  assert.equal(index.get(Q_MULTI.id)!.summary, "q2c1〜q2c3・q2t1");
  const maCols = index.get(Q_MULTI.id)!.columns;
  assert.equal(maCols.find((col) => col.name === "q2c3")!.label, "C");

  // 自由記述は t列
  assert.equal(index.get(Q_TEXT.id)!.summary, "q4t1");

  // マトリクス single 2行は列挙・multi 3列は圧縮
  assert.equal(index.get(Q_MATRIX_S.id)!.summary, "q5s1・q5s2");
  assert.equal(index.get(Q_MATRIX_M.id)!.summary, "q6s1c1〜q6s1c3");
  const matrixCols = index.get(Q_MATRIX_M.id)!.columns;
  assert.equal(matrixCols.find((col) => col.name === "q6s1c2")!.label, "朝 × 米");
});

test("statusCounts: ステータス別件数とテスト別掲", () => {
  const counts = buildStatusCounts([
    makeRespondent(),
    makeRespondent({ respondent_key: "r-2" }),
    makeRespondent({ respondent_key: "r-P", response_status: "partial" }),
    makeRespondent({ respondent_key: "r-T", is_test: true })
  ]);
  assert.equal(counts[0]!.status, "completed");
  assert.equal(counts[0]!.count, 2);
  assert.equal(counts[0]!.test_count, 1);
  assert.equal(counts[1]!.status, "partial");
  assert.equal(counts[1]!.count, 1);
});
