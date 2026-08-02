/**
 * 行動証拠による顧客発見（P13）テスト
 * docs/要件定義_AIフロー作成_行動証拠による顧客発見_2026-07-27.md §9 受け入れ条件
 *
 * 確認項目:
 *  A. 調査仮説シートの必須検証（失敗条件を書かずに生成へ進めない）
 *  B. P13 役割タグの解析とフロー構造の充足チェック
 *  C. 証拠の確度分類（§6.5）
 *  D. GO/PIVOT/STOP 基準の突き合わせ（§6.6・システムは判定しない）
 *  E. 生成プロンプト（§6.3 の生成規則が本文に載っている・standard は無変更）
 *  F. 深掘りプリセット behavior_evidence（非誘導の上に積む二段構成）
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

import {
  classifyEvidenceStrength,
  describeBuyerIsUser,
  ECONOMIC_VALUE_ROLES,
  evaluateJudgementCriteria,
  MIN_SEGMENT_RESPONDENTS,
  parseP13Role,
  REQUIRED_HYPOTHESIS_FIELDS,
  stripP13Role,
  summarizeFlowP13Coverage,
  summarizeJudgement,
  validateResearchHypothesis,
  type JudgementInput,
} from "../lib/behaviorEvidence";
import {
  ALL_PROMPT_KEYS,
  BASE_PROMPT_TEMPLATES,
  BEHAVIOR_EVIDENCE_OVERRIDE_KEYS,
  buildInitialTemplatesForPreset,
  NON_LEADING_OVERRIDE_KEYS,
  PROMPT_KEY_PLACEMENT,
  PROMPT_PRESETS,
  summarizeTemplateDefinitions,
} from "../prompts/basePromptTemplates";
import {
  buildGenerateFlowBehaviorEvidencePrompt,
  buildGenerateFlowPrompt,
} from "../prompts/adminPrompts";

const VALID_HYPOTHESIS = {
  segment: "従業員5〜20名の工務店の経営者",
  scene: "月末の請求書作成から送付まで",
  problem_hypothesis: "手作業の転記に時間がかかっている",
  current_method: "Excelの自作テンプレートと手打ち",
  stop_condition: "5人中3人以上から直近1か月の具体例が出なければ STOP",
};

// ---------------------------------------------------------------------------
// A. 調査仮説シートの必須検証
// ---------------------------------------------------------------------------

test("BE-A1: 必須5項目がすべて埋まっていれば ok", () => {
  const result = validateResearchHypothesis(VALID_HYPOTHESIS);
  assert.equal(result.ok, true);
  assert.ok(result.value);
  assert.equal(result.value.stop_condition, VALID_HYPOTHESIS.stop_condition);
  assert.equal(result.value.buyer_is_user, null);
  assert.deepEqual(result.missing, []);
});

test("BE-A2: 失敗条件が空なら生成へ進めない（P13の核・差し戻し条件§10）", () => {
  const result = validateResearchHypothesis({
    ...VALID_HYPOTHESIS,
    stop_condition: "   ",
  });
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
  assert.deepEqual(result.missing, ["stop_condition"]);
  assert.match(result.message ?? "", /失敗条件/);
});

test("BE-A3: 必須5項目に stop_condition が含まれている", () => {
  assert.ok(REQUIRED_HYPOTHESIS_FIELDS.includes("stop_condition"));
  assert.equal(REQUIRED_HYPOTHESIS_FIELDS.length, 5);
});

test("BE-A4: 空オブジェクト・非オブジェクトは全項目 missing になる", () => {
  for (const input of [{}, null, undefined, "文字列", 42]) {
    const result = validateResearchHypothesis(input);
    assert.equal(result.ok, false, `${String(input)} が ok になった`);
    assert.equal(result.missing.length, REQUIRED_HYPOTHESIS_FIELDS.length);
  }
});

test("BE-A5: 長すぎる入力は弾く（プロンプトへの丸ごと差し込みを守る）", () => {
  const result = validateResearchHypothesis({
    ...VALID_HYPOTHESIS,
    segment: "あ".repeat(501),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.tooLong, ["segment"]);
});

test("BE-A6: buyer_is_user は既知の値だけ通し、それ以外は null にする", () => {
  assert.equal(
    validateResearchHypothesis({ ...VALID_HYPOTHESIS, buyer_is_user: "same" }).value
      ?.buyer_is_user,
    "same"
  );
  assert.equal(
    validateResearchHypothesis({ ...VALID_HYPOTHESIS, buyer_is_user: "different" }).value
      ?.buyer_is_user,
    "different"
  );
  assert.equal(
    validateResearchHypothesis({ ...VALID_HYPOTHESIS, buyer_is_user: "妙な値" }).value
      ?.buyer_is_user,
    null
  );
});

test("BE-A7: 製品名フィールドは正規化後の値に混入しない（§6.2 製品を見せない）", () => {
  const result = validateResearchHypothesis({
    ...VALID_HYPOTHESIS,
    product_name: "スーパー請求くん",
    feature_idea: "ワンクリック請求書生成",
  });
  assert.equal(result.ok, true);
  const keys = Object.keys(result.value ?? {});
  assert.ok(!keys.includes("product_name"));
  assert.ok(!keys.includes("feature_idea"));
});

test("BE-A8: describeBuyerIsUser は未入力を「未回答」と明示する", () => {
  assert.equal(describeBuyerIsUser(null), "未回答");
  assert.match(describeBuyerIsUser("same"), /同一/);
  assert.match(describeBuyerIsUser("different"), /決裁者/);
});

// ---------------------------------------------------------------------------
// B. P13 役割タグ
// ---------------------------------------------------------------------------

test("BE-B1: research_goal 先頭の役割タグを解析できる", () => {
  assert.equal(parseP13Role("[P13:recent_behavior] 直近の実施時期"), "recent_behavior");
  assert.equal(
    parseP13Role("[P13:economic_value/time_loss] 1回あたりの所要時間"),
    "economic_value/time_loss"
  );
  assert.equal(parseP13Role("[P13:commitment] 追加ヒアリング可否"), "commitment");
});

test("BE-B2: タグ無し・未知タグ・空は null（誤分類より未分類を選ぶ）", () => {
  assert.equal(parseP13Role("直近の実施時期"), null);
  assert.equal(parseP13Role("[P13:unknown_role] なにか"), null);
  assert.equal(parseP13Role(""), null);
  assert.equal(parseP13Role(null), null);
  assert.equal(parseP13Role(undefined), null);
});

test("BE-B3: stripP13Role はタグを外した本文を返す", () => {
  assert.equal(stripP13Role("[P13:recent_behavior] 直近の実施時期"), "直近の実施時期");
  assert.equal(stripP13Role("タグ無しの本文"), "タグ無しの本文");
  assert.equal(stripP13Role(null), "");
});

test("BE-B4: 経済価値4要素が揃ったフローは missingEconomicValue が空", () => {
  const questions = [
    { research_goal: "[P13:recent_behavior] 直近" },
    { research_goal: "[P13:economic_value/frequency] 頻度" },
    { research_goal: "[P13:economic_value/time_loss] 時間" },
    { research_goal: "[P13:economic_value/money_loss] 金額" },
    { research_goal: "[P13:economic_value/satisfaction] 満足度" },
    { research_goal: "[P13:commitment] 協力可否" },
  ];
  const coverage = summarizeFlowP13Coverage(questions);
  assert.equal(coverage.tagged, 6);
  assert.equal(coverage.total, 6);
  assert.deepEqual(coverage.missingEconomicValue, []);
  assert.equal(coverage.hasRecentBehavior, true);
  assert.equal(coverage.hasCommitment, true);
});

test("BE-B5: 経済価値が欠けたフローは欠落を名指しで返す", () => {
  const coverage = summarizeFlowP13Coverage([
    { research_goal: "[P13:recent_behavior] 直近" },
    { research_goal: "[P13:economic_value/frequency] 頻度" },
    { research_goal: "タグ無し" },
  ]);
  assert.equal(coverage.tagged, 2);
  assert.equal(coverage.total, 3);
  assert.equal(coverage.hasCommitment, false);
  assert.deepEqual(coverage.missingEconomicValue, [
    "economic_value/time_loss",
    "economic_value/money_loss",
    "economic_value/satisfaction",
  ]);
});

test("BE-B6: 経済価値4要素の定義が要件どおり4つ", () => {
  assert.equal(ECONOMIC_VALUE_ROLES.length, 4);
});

// ---------------------------------------------------------------------------
// C. 証拠の確度（§6.5）
// ---------------------------------------------------------------------------

test("BE-C1: 時期＋数値が揃えば numeric", () => {
  const result = classifyEvidenceStrength({
    answerText: "先週の金曜にやりました。3時間かかって、外注に2万円払っています。",
  });
  assert.equal(result.strength, "numeric");
  assert.equal(result.signals.hasNumeric, true);
  assert.equal(result.signals.hasRecall, true);
});

test("BE-C2: 時期だけなら concrete_recall", () => {
  const result = classifyEvidenceStrength({
    answerText: "先月末にやりました。担当が休んでいて自分でやりました。",
  });
  assert.equal(result.strength, "concrete_recall");
});

test("BE-C3: 一般論だけなら statement_only（数値があっても時期が無ければ上げない）", () => {
  const result = classifyEvidenceStrength({
    answerText: "だいたいいつも3時間くらいかかっていると思います。",
  });
  assert.equal(result.strength, "statement_only");
  assert.equal(result.signals.hasGeneralization, true);
});

test("BE-C4: 願望のみは statement_only（意見を証拠に数えない）", () => {
  const result = classifyEvidenceStrength({
    answerText: "自動化ツールがあったら便利だと思います。使ってみたいです。",
  });
  assert.equal(result.strength, "statement_only");
  assert.equal(result.signals.hasOpinionOnly, true);
});

test("BE-C5: 深掘りで出た具体も確度に算入する", () => {
  const result = classifyEvidenceStrength({
    answerText: "けっこう時間がかかります",
    probeTexts: ["先週の水曜でした", "だいたい2時間半です"],
  });
  assert.equal(result.strength, "numeric");
});

test("BE-C6: 空回答は statement_only（未回答を証拠に数えない）", () => {
  assert.equal(classifyEvidenceStrength({ answerText: "" }).strength, "statement_only");
  assert.equal(classifyEvidenceStrength({ answerText: null }).strength, "statement_only");
});

// ---------------------------------------------------------------------------
// D. GO / PIVOT / STOP 基準の突き合わせ（§6.6）
// ---------------------------------------------------------------------------

function buildJudgementInput(overrides: Partial<JudgementInput> = {}): JudgementInput {
  return {
    respondentCount: 8,
    strengthCounts: { statement_only: 1, concrete_recall: 3, numeric: 4 },
    timeLossReportedCount: 6,
    moneyLossReportedCount: 5,
    satisfiedWithCurrentCount: 1,
    nextOccurrenceKnownCount: 6,
    commitmentCount: 3,
    economicValueComplete: true,
    ...overrides,
  };
}

test("BE-D1: 証拠が揃った案件は GO 系がすべて met・STOP 系は 0", () => {
  const summary = summarizeJudgement(buildJudgementInput());
  assert.equal(summary.goMet, summary.goTotal);
  assert.equal(summary.stopHit, 0);
  assert.equal(summary.insufficientSample, false);
});

test("BE-D2: 母数不足では unmet でなく unknown を返す（STOPへ誘導しない）", () => {
  const summary = summarizeJudgement(
    buildJudgementInput({
      respondentCount: 3,
      strengthCounts: { statement_only: 3, concrete_recall: 0, numeric: 0 },
      timeLossReportedCount: 0,
      moneyLossReportedCount: 0,
      commitmentCount: 0,
      nextOccurrenceKnownCount: 0,
    })
  );
  assert.equal(summary.insufficientSample, true);
  // 母数が足りない以上「STOP該当」と数えてはいけない
  assert.equal(summary.stopHit, 0);
  assert.ok(summary.unknownCount > 0);
});

test("BE-D3: 発言のみが過半数なら STOP 系が立つ", () => {
  const summary = summarizeJudgement(
    buildJudgementInput({
      strengthCounts: { statement_only: 6, concrete_recall: 1, numeric: 1 },
    })
  );
  const stopNoBehavior = summary.criteria.find((c) => c.key === "stop_no_behavior");
  assert.equal(stopNoBehavior?.status, "met");
});

test("BE-D4: 無料でもテスト協力が取れない案件は STOP 系が立つ（§6.6）", () => {
  const summary = summarizeJudgement(buildJudgementInput({ commitmentCount: 0 }));
  const criterion = summary.criteria.find((c) => c.key === "stop_no_free_cooperation");
  assert.equal(criterion?.status, "met");
});

test("BE-D5: 現行手段に満足が過半数なら PIVOT 系が立つ", () => {
  const summary = summarizeJudgement(buildJudgementInput({ satisfiedWithCurrentCount: 6 }));
  const criterion = summary.criteria.find((c) => c.key === "pivot_satisfied");
  assert.equal(criterion?.status, "met");
});

test("BE-D6: 経済価値の設問が欠けていれば設計側の不足として PIVOT 系に出る", () => {
  const summary = summarizeJudgement(buildJudgementInput({ economicValueComplete: false }));
  const criterion = summary.criteria.find((c) => c.key === "pivot_measurement_gap");
  assert.equal(criterion?.status, "met");
});

test("BE-D7: 各基準に根拠（detail）が必ず付く（数字だけを出さない §6.6）", () => {
  const criteria = evaluateJudgementCriteria(buildJudgementInput());
  for (const criterion of criteria) {
    assert.ok(criterion.detail.trim().length > 0, `${criterion.key} に detail が無い`);
    assert.ok(criterion.label.trim().length > 0, `${criterion.key} に label が無い`);
  }
});

test("BE-D8: システムは GO を断定しない（判定文言を出さない §3-2 / §10）", () => {
  const summary = summarizeJudgement(buildJudgementInput());
  const serialized = JSON.stringify(summary);
  // 「GO です」「STOP です」のような断定表現を返り値に含めない
  assert.ok(!/GOです|GO です|STOPです|STOP です|PIVOTです/.test(serialized));
  // 代わりに「判定は運営者」と明示する
  assert.match(summary.disclaimer, /運営者が決めて/);
  // 対面観察が無いことの但し書きも必須（§3-5）
  assert.match(summary.disclaimer, /数値あり.*上限|上限.*数値あり/);
  assert.match(summary.disclaimer, /申告値/);
});

test("BE-D9: 判定基準の下限人数は P13 の運用基準（5人）", () => {
  assert.equal(MIN_SEGMENT_RESPONDENTS, 5);
});

// ---------------------------------------------------------------------------
// E. 生成プロンプト（§6.3）
// ---------------------------------------------------------------------------

test("BE-E1: P13 生成プロンプトが BASE に登録され、配置メタも揃っている", () => {
  const def = BASE_PROMPT_TEMPLATES.buildGenerateFlowBehaviorEvidencePrompt;
  assert.ok(def, "buildGenerateFlowBehaviorEvidencePrompt が無い");
  assert.ok(def.systemPrompt, "systemPrompt が無い（管理ツール系は必要）");
  assert.ok(ALL_PROMPT_KEYS.includes("buildGenerateFlowBehaviorEvidencePrompt"));
  const placement = PROMPT_KEY_PLACEMENT.buildGenerateFlowBehaviorEvidencePrompt;
  assert.equal(placement.family, "admin_tool");
  assert.equal(placement.managedBy, "base");
});

test("BE-E2: 生成規則に P13 の核が明記されている（型を薄めない §3-1）", () => {
  const template = BASE_PROMPT_TEMPLATES.buildGenerateFlowBehaviorEvidencePrompt.template;
  // (a) 直近の1回の再現
  assert.match(template, /直近/);
  // (b) 経済価値4要素
  assert.match(template, /発生頻度/);
  assert.match(template, /時間損失/);
  assert.match(template, /金銭損失/);
  assert.match(template, /満足度/);
  // (c) 購入に近い行動
  assert.match(template, /ヒアリング/);
  assert.match(template, /紹介/);
  // (d) 生成禁止ルール
  assert.match(template, /欲しいですか/);
  assert.match(template, /あったら便利ですか/);
  assert.match(template, /いくらなら払いますか/);
  // (e) 役割タグ
  assert.match(template, /\[P13:recent_behavior\]/);
  assert.match(template, /\[P13:commitment\]/);
});

test("BE-E3: 経済価値4要素を自由記述で作らせない指示がある（差し戻し条件§10）", () => {
  const template = BASE_PROMPT_TEMPLATES.buildGenerateFlowBehaviorEvidencePrompt.template;
  assert.match(template, /free_text_short \/ free_text_long で作ってはいけません/);
});

test("BE-E4: 仮説シートの値がプロンプトへ展開される", () => {
  const built = buildGenerateFlowBehaviorEvidencePrompt(
    {
      segment: VALID_HYPOTHESIS.segment,
      scene: VALID_HYPOTHESIS.scene,
      problemHypothesis: VALID_HYPOTHESIS.problem_hypothesis,
      currentMethod: VALID_HYPOTHESIS.current_method,
      stopCondition: VALID_HYPOTHESIS.stop_condition,
      buyerIsUser: describeBuyerIsUser("different"),
    },
    null
  );
  assert.equal(built.promptKey, "buildGenerateFlowBehaviorEvidencePrompt");
  assert.equal(built.templateMode, "legacy");
  assert.match(built.userPrompt, new RegExp(VALID_HYPOTHESIS.stop_condition));
  assert.match(built.userPrompt, new RegExp(VALID_HYPOTHESIS.segment));
  // 主題である「調べる業務・場面」は、設問文へ写させるため複数箇所に出す
  const sceneHits = built.userPrompt.split(VALID_HYPOTHESIS.scene).length - 1;
  assert.ok(sceneHits >= 2, `scene の出現が ${sceneHits} 回しかない`);
  // 未展開のプレースホルダーが残っていない
  assert.ok(!/\{\{\w+\}\}/.test(built.userPrompt), "未展開のプレースホルダーが残っている");
});

test("BE-E4b: 案件名・調査目的はP13プロンプトへ渡さない（主題ずれの防止）", () => {
  // 案件メタ情報が scene とズレていると、モデルがそちらを主題に据えて
  // 別の話題の設問を作る（実測で再現）。プレースホルダごと持たせない。
  const def = BASE_PROMPT_TEMPLATES.buildGenerateFlowBehaviorEvidencePrompt;
  assert.ok(!def.allowedPlaceholders.includes("projectName"));
  assert.ok(!def.allowedPlaceholders.includes("objective"));
  assert.ok(!/\{\{projectName\}\}|\{\{objective\}\}/.test(def.template));
});

test("BE-E5: 既存 standard フロー生成は無変更（§7 スコープ外 / §10）", () => {
  const template = BASE_PROMPT_TEMPLATES.buildGenerateFlowPrompt.template;
  // P13 の語が standard 側へ漏れていないこと
  assert.ok(!/P13/.test(template));
  assert.ok(!/失敗条件/.test(template));
  assert.ok(!/経済価値/.test(template));
  // 従来の出力契約が保たれていること
  assert.match(template, /8〜15問|"questions"/);
  const built = buildGenerateFlowPrompt(
    { projectName: "案件", objective: "目的" },
    null
  );
  assert.equal(built.promptKey, "buildGenerateFlowPrompt");
  assert.equal(built.templateMode, "legacy");
  assert.ok(!/P13/.test(built.userPrompt));
});

test("BE-E6: allowedPlaceholders と本文中のプレースホルダーが一致する", () => {
  const def = BASE_PROMPT_TEMPLATES.buildGenerateFlowBehaviorEvidencePrompt;
  const used = new Set(
    [...def.template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string)
  );
  for (const placeholder of used) {
    assert.ok(
      def.allowedPlaceholders.includes(placeholder),
      `${placeholder} が allowedPlaceholders に無い`
    );
  }
});

// ---------------------------------------------------------------------------
// F. 深掘りプリセット（§6.4）
// ---------------------------------------------------------------------------

test("BE-F1: behavior_evidence プリセットが存在し全キーを実体化する", () => {
  assert.ok(PROMPT_PRESETS.behavior_evidence, "behavior_evidence プリセットが無い");
  const templates = buildInitialTemplatesForPreset("behavior_evidence");
  assert.equal(Object.keys(templates).length, ALL_PROMPT_KEYS.length);
  for (const key of ALL_PROMPT_KEYS) {
    assert.equal(templates[key]!.enabled, true);
    assert.ok((templates[key]!.template ?? "").trim().length > 0, `${key} が空本文`);
  }
  const summary = summarizeTemplateDefinitions(templates);
  assert.equal(summary.disabled, 0);
});

test("BE-F2: 上書き対象は非誘導と同一キー（回答者に見える10キーのみ）", () => {
  assert.deepEqual(
    [...BEHAVIOR_EVIDENCE_OVERRIDE_KEYS].sort(),
    [...NON_LEADING_OVERRIDE_KEYS].sort()
  );
});

test("BE-F3: 非誘導の上に積む二段構成（BASE本文＋非誘導ルール＋P13ルール）", () => {
  const templates = buildInitialTemplatesForPreset("behavior_evidence");
  for (const key of BEHAVIOR_EVIDENCE_OVERRIDE_KEYS) {
    const body = templates[key]?.template ?? "";
    // BASE 本文が丸ごと保持されている＝挙動保存
    assert.ok(
      body.startsWith(BASE_PROMPT_TEMPLATES[key].template),
      `${key} が BASE 本文で始まっていない`
    );
    // 非誘導ルールが残っている
    assert.ok(
      /Non-leading rule|非誘導ルール/.test(body),
      `${key} に非誘導ルールが無い`
    );
    // P13 ルールが載っている
    assert.ok(
      /Behavior-evidence rule|行動証拠の深掘り/.test(body),
      `${key} に P13 ルールが無い`
    );
  }
});

test("BE-F4: 上書き対象外のキーは BASE のまま（標準と同一）", () => {
  const templates = buildInitialTemplatesForPreset("behavior_evidence");
  const overrideSet = new Set<string>(BEHAVIOR_EVIDENCE_OVERRIDE_KEYS);
  for (const key of ALL_PROMPT_KEYS) {
    if (overrideSet.has(key)) continue;
    assert.equal(
      templates[key]?.template,
      BASE_PROMPT_TEMPLATES[key].template,
      `${key} が BASE から変わっている`
    );
  }
});

test("BE-F5: 深掘りが「たとえば？」で掘らない指示を持つ（差し戻し条件§10）", () => {
  const templates = buildInitialTemplatesForPreset("behavior_evidence");
  const probeBody = templates.probeGuidanceCommon?.template ?? "";
  assert.match(probeBody, /「たとえば？」では聞かない/);
  assert.match(probeBody, /直近の1回に引き戻す/);
  // 数値をこちらから出さない（記憶の捏造防止）
  assert.match(probeBody, /こちらから出して確認させない/);
});

test("BE-F6: ambiguousAnswerRule に concrete_example を当てない（「たとえば」と衝突するため）", () => {
  const policy = PROMPT_PRESETS.behavior_evidence.policy;
  assert.notEqual(policy.ambiguousAnswerRule, "concrete_example");
  assert.ok((policy.restrictions ?? []).includes("no_leading_question"));
});

test("BE-F7: 非誘導・若年層プリセットは P13 ルールを持たない（層の混線がない）", () => {
  for (const preset of ["non_leading", "young_casual"] as const) {
    const templates = buildInitialTemplatesForPreset(preset);
    for (const key of NON_LEADING_OVERRIDE_KEYS) {
      const body = templates[key]?.template ?? "";
      assert.ok(
        !/Behavior-evidence rule|行動証拠の深掘り/.test(body),
        `${preset}/${key} に P13 ルールが混入している`
      );
    }
  }
});
