/**
 * 深掘りプレイグラウンド（Phase I / A part2）の純関数テスト
 *
 * - buildProbePlaygroundPrompt: 合成 project/question から実ビルダーを呼び、
 *   「バージョン本文＋コード側 buildProbeTypeGuidance」を含む実プロンプトを返すこと。
 * - parseProbePlaygroundResult: analyze/interview の JSON から深掘り文を抽出、
 *   probe モードはプレーンテキスト、壊れた応答は raw フォールバック。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

import { buildInitialTemplatesForPreset } from "../prompts/basePromptTemplates";
import {
  buildProbePlaygroundPrompt,
  parseProbePlaygroundResult,
  PROBE_PLAYGROUND_KEY,
} from "../services/probePlaygroundService";

const templates = buildInitialTemplatesForPreset("standard");

// 共通ルール（buildProbeTypeGuidance）の固有文字列＝コード側ロジックが注入された証拠
const PROBE_GUIDANCE_MARK = "深掘り判定の共通ルール";

test("PG1: analyze は実 probeTypeGuidance＋設問＋回答を含むプロンプトを返す", () => {
  const prompt = buildProbePlaygroundPrompt({
    mode: "analyze",
    templates,
    policy: null,
    questionType: "free_text_long",
    questionText: "通勤で不便に感じることは？",
    answer: "まあ普通です",
  });
  assert.ok(prompt.includes(PROBE_GUIDANCE_MARK), "型別ガイダンスが注入されていない");
  assert.ok(prompt.includes("通勤で不便に感じることは？"), "設問文が含まれない");
  assert.ok(prompt.includes("まあ普通です"), "回答が含まれない");
});

test("PG2: interview モードは interviewTurn 経路で組み立てる", () => {
  const prompt = buildProbePlaygroundPrompt({
    mode: "interview",
    templates,
    policy: null,
    questionText: "最近の買い物で迷ったことは？",
    answer: "特にないです",
  });
  assert.ok(prompt.includes("最近の買い物で迷ったことは？"));
  assert.ok(prompt.includes("特にないです"));
});

test("PG3: probe モードは簡易深掘り経路で設問＋回答を含む", () => {
  const prompt = buildProbePlaygroundPrompt({
    mode: "probe",
    templates,
    policy: null,
    questionText: "好きな点は？",
    answer: "便利だから",
  });
  assert.ok(prompt.includes("好きな点は？"));
  assert.ok(prompt.includes("便利だから"));
});

test("PG4: 選択肢を渡すと選択型プロンプトに反映される", () => {
  const prompt = buildProbePlaygroundPrompt({
    mode: "analyze",
    templates,
    policy: null,
    questionType: "single_choice",
    questionText: "満足度は？",
    answer: "やや満足",
    options: [
      { value: "とても満足", label: "とても満足" },
      { value: "やや満足", label: "やや満足" },
    ],
  });
  assert.ok(prompt.includes("やや満足"));
});

test("PG5: PROBE_PLAYGROUND_KEY は各モードの実キーに対応", () => {
  assert.equal(PROBE_PLAYGROUND_KEY.analyze, "buildAnalyzeAnswerPrompt");
  assert.equal(PROBE_PLAYGROUND_KEY.interview, "buildInterviewTurnPrompt");
  assert.equal(PROBE_PLAYGROUND_KEY.probe, "buildProbePrompt");
});

test("PG6: parse - analyze JSON から question を深掘り文として抽出", () => {
  const r = parseProbePlaygroundResult(
    "analyze",
    '{"action":"probe","question":"具体的にどの場面でそう感じましたか？","reason":"abstract"}'
  );
  assert.equal(r.action, "probe");
  assert.equal(r.probe, "具体的にどの場面でそう感じましたか？");
  assert.equal(r.reason, "abstract");
  assert.equal(r.parsedJson, true);
});

test("PG7: parse - interview JSON は response_text を抽出", () => {
  const r = parseProbePlaygroundResult(
    "interview",
    '```json\n{"action":"probe","response_text":"もう少し詳しく教えてください"}\n```'
  );
  assert.equal(r.probe, "もう少し詳しく教えてください");
  assert.equal(r.parsedJson, true);
});

test("PG8: parse - probe モードはプレーンテキストをそのまま深掘り文に", () => {
  const r = parseProbePlaygroundResult("probe", "  それはなぜですか？  ");
  assert.equal(r.probe, "それはなぜですか？");
  assert.equal(r.parsedJson, false);
});

test("PG9: parse - 壊れた応答は raw を probe 候補に、空は null", () => {
  const broken = parseProbePlaygroundResult("analyze", "これはJSONではない");
  assert.equal(broken.probe, "これはJSONではない");
  assert.equal(broken.parsedJson, false);

  const empty = parseProbePlaygroundResult("analyze", "");
  assert.equal(empty.probe, null);
});

test("PG10: parse - action が probe 以外で question 空なら probe は null", () => {
  const r = parseProbePlaygroundResult("analyze", '{"action":"ask_next","question":""}');
  assert.equal(r.action, "ask_next");
  assert.equal(r.probe, null);
  assert.equal(r.parsedJson, true);
});

// ─── Phase I-B: 型別ガイダンスのバージョン化が効くこと ──────────────────────────

test("PG-B1: 単一選択と複数選択で型別ガイダンスが切り替わる", () => {
  const base = { mode: "analyze" as const, templates, policy: null, questionText: "満足度は？", answer: "やや満足" };
  const single = buildProbePlaygroundPrompt({ ...base, questionType: "single_choice" });
  const multi = buildProbePlaygroundPrompt({ ...base, questionType: "multi_choice" });
  assert.ok(single.includes("単数選択回答の深掘りルール"));
  assert.ok(!single.includes("複数選択回答の深掘りルール"));
  assert.ok(multi.includes("複数選択回答の深掘りルール"));
});

test("PG-B2: probeGuidanceText を版で上書きすると深掘りプロンプトに反映される", () => {
  const overridden = {
    ...templates,
    probeGuidanceText: { enabled: true, template: "★カスタム深掘り方針★ 一点だけ深く掘る。" },
  };
  const prompt = buildProbePlaygroundPrompt({
    mode: "analyze",
    templates: overridden,
    policy: null,
    questionType: "free_text_long",
    questionText: "不便な点は？",
    answer: "まあ普通",
  });
  assert.ok(prompt.includes("★カスタム深掘り方針★"), "上書き本文が反映されていない");
  assert.ok(!prompt.includes("テキスト回答の深掘りルール:"), "BASE本文が残っている");
  // 共通ルールは別キーなので維持される
  assert.ok(prompt.includes("深掘り判定の共通ルール"), "共通ルールが消えた");
});
