/**
 * testAllAnswerTypes.mjs
 * 全回答形式の parseAnswer / renderQuestion / branch_rule を動作確認するスクリプト
 *
 * Usage: node scripts/testAllAnswerTypes.mjs
 */

// ─── parseAnswer の移植（src/services/questionFlowServiceV2.ts 相当） ───

function normalizeOptionInput(input) {
  return input
    .trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

function findOption(input, options) {
  const normalized = normalizeOptionInput(input).toLowerCase();
  const numbered = Number(normalized);
  if (!Number.isNaN(numbered) && options[numbered - 1]) {
    return options[numbered - 1] ?? null;
  }
  return (
    options.find((option) => {
      const label = option.label.trim().toLowerCase();
      const value = option.value.trim().toLowerCase();
      return normalized === label || normalized === value;
    }) ?? null
  );
}

function parseAnswer(question, rawText) {
  const text = rawText.trim();
  const configuredOptions = question.question_config?.options ?? [];
  if (!text) throw new Error("回答が空です。");

  switch (question.question_type) {
    case "free_text_short":
    case "free_text_long": {
      const maxLength = question.question_config?.max_length ?? null;
      if (maxLength !== null && text.length > maxLength) throw new Error(`${maxLength}文字以内`);
      return { answerText: text, normalizedAnswer: { value: text } };
    }
    case "single_choice":
    case "text_with_image": {
      const option = findOption(text, configuredOptions);
      if (!option) throw new Error("選択肢から回答してください。");
      return { answerText: option.label, normalizedAnswer: { value: option.value, label: option.label } };
    }
    case "multi_choice": {
      const parts = text.split(/[,\n、]/).map(p => p.trim()).filter(Boolean);
      const matched = parts.map(p => findOption(p, configuredOptions));
      if (matched.some(item => !item)) throw new Error("選択肢から回答してください。");
      const unique = Array.from(new Map(matched.map(item => [item.value, item])).values());
      const minSelect = question.question_config?.min_select ?? null;
      const maxSelect = question.question_config?.max_select ?? null;
      if (minSelect !== null && unique.length < minSelect) throw new Error(`${minSelect}件以上`);
      if (maxSelect !== null && unique.length > maxSelect) throw new Error(`${maxSelect}件以下`);
      return {
        answerText: unique.map(o => o.label).join(", "),
        normalizedAnswer: { values: unique.map(o => o.value), labels: unique.map(o => o.label) }
      };
    }
    case "numeric": {
      const value = Number(text);
      if (Number.isNaN(value)) throw new Error("数値で入力してください。");
      const minVal = question.question_config?.min ?? null;
      const maxVal = question.question_config?.max ?? null;
      if (minVal !== null && value < minVal) throw new Error(`${minVal} 以上`);
      if (maxVal !== null && value > maxVal) throw new Error(`${maxVal} 以下`);
      return { answerText: String(value), normalizedAnswer: { value } };
    }
    case "sd": {
      const options = configuredOptions;
      const scaleMax = options.length > 0 ? options.length : 7;
      const value = Number(text);
      if (Number.isNaN(value) || value < 1 || value > scaleMax) throw new Error(`1〜${scaleMax} の数字`);
      const matchedOption = options[value - 1];
      return {
        answerText: matchedOption ? `${value}(${matchedOption.label})` : String(value),
        normalizedAnswer: { value, label: matchedOption?.label ?? String(value) }
      };
    }
    case "matrix_single":
    case "matrix_multi":
    case "matrix_mixed":
      return { answerText: text, normalizedAnswer: { value: text, note: "matrix_text_fallback" } };
    case "hidden_single":
    case "hidden_multi":
      return { answerText: text, normalizedAnswer: { value: text } };
    case "image_upload":
      return { answerText: text, normalizedAnswer: { value: text, note: "image_upload_text_fallback" } };
    default:
      return { answerText: text, normalizedAnswer: { value: text } };
  }
}

// ─── branch_rule マッチング ───

function normalizePrimitive(value) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function extractPrimitiveCandidates(value) {
  if (Array.isArray(value)) return value.flatMap(extractPrimitiveCandidates);
  const p = normalizePrimitive(value);
  return p === null ? [] : [p];
}

function resolvePathValues(value, path) {
  const segments = String(path ?? "").split(".").map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return [value];
  const walk = (current, index) => {
    if (index >= segments.length) return [current];
    if (Array.isArray(current)) return current.flatMap(item => walk(item, index));
    if (!current || typeof current !== "object") return [];
    return walk(current[segments[index]], index + 1);
  };
  return walk(value, 0);
}

function collectBranchCandidates(route, normalizedAnswer) {
  if (route.field) {
    return resolvePathValues(normalizedAnswer, route.field).flatMap(extractPrimitiveCandidates);
  }
  return [
    ...extractPrimitiveCandidates(normalizedAnswer.value),
    ...extractPrimitiveCandidates(normalizedAnswer.boolean),
    ...extractPrimitiveCandidates(normalizedAnswer.values)
  ];
}

function comparePrimitive(left, right) {
  if (typeof left === "number" || typeof right === "number") return Number(left) === Number(right);
  return left === right;
}

function matchesCanonicalCondition(when, candidates) {
  if ("equals" in when) return candidates.some(c => comparePrimitive(c, when.equals));
  if ("includes" in when) return candidates.some(c => comparePrimitive(c, when.includes));
  if ("any_of" in when) return when.any_of.some(exp => candidates.some(c => comparePrimitive(c, exp)));
  if ("gte" in when) return candidates.some(c => Number(c) >= when.gte);
  if ("lte" in when) return candidates.some(c => Number(c) <= when.lte);
  return false;
}

function resolveMatchedBranchCode(branchRule, normalizedAnswer) {
  if (!branchRule?.branches) return null;
  for (const branch of branchRule.branches) {
    const candidates = collectBranchCandidates(branch, normalizedAnswer);
    if (matchesCanonicalCondition(branch.when, candidates)) return branch.next;
  }
  return null;
}

function resolveNextCode(branchRule, normalizedAnswer) {
  const matched = resolveMatchedBranchCode(branchRule, normalizedAnswer);
  if (matched) return matched;
  return branchRule?.default_next ?? null;
}

// ─── テストユーティリティ ───

let passed = 0;
let failed = 0;

function ok(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `  (${detail})` : ""}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ─── テストデータ（DB から取得した questions） ───
// ※ fetch from admin API at runtime

async function fetchQuestions() {
  const res = await fetch(
    "http://localhost:3000/admin/api/projects/00000000-0000-4000-8000-0000000000b2/flow-preview",
    { headers: { Authorization: "Basic " + Buffer.from("admin:change-me").toString("base64") } }
  );
  const json = await res.json();
  if (!json.ok) throw new Error("Failed to fetch questions: " + JSON.stringify(json));
  const map = {};
  for (const q of json.questions) map[q.question_code] = q;
  return map;
}

async function main() {
  console.log("=== 全回答形式 動作チェック ===\n");

  let qs;
  try {
    qs = await fetchQuestions();
    console.log(`DB から ${Object.keys(qs).length} 件の設問を取得しました。`);
  } catch (e) {
    console.error("設問の取得に失敗しました:", e.message);
    process.exit(1);
  }

  // ─── 1. single_choice ───
  section("Q1: single_choice + branch_rule");
  {
    const q = qs["Q1"];
    ok("question_type = single_choice", q.question_type === "single_choice");

    // 番号入力
    const r1 = parseAnswer(q, "1");
    ok("番号1 → prepared", r1.normalizedAnswer.value === "prepared", JSON.stringify(r1.normalizedAnswer));

    // ラベル入力
    const r2 = parseAnswer(q, "ほとんど用意していない");
    ok("ラベル入力 → unprepared", r2.normalizedAnswer.value === "unprepared");

    // 全角数字
    const r3 = parseAnswer(q, "４");
    ok("全角4 → other", r3.normalizedAnswer.value === "other");

    // 不正入力
    let threw = false;
    try { parseAnswer(q, "不正な値"); } catch { threw = true; }
    ok("不正入力でエラー", threw);

    // branch
    const brPrepared = resolveNextCode(q.branch_rule, r1.normalizedAnswer);
    ok("branch: prepared → Q2_PREPARED", brPrepared === "Q2_PREPARED", brPrepared);

    const brUnprepared = resolveNextCode(q.branch_rule, r2.normalizedAnswer);
    ok("branch: unprepared → Q2_UNPREPARED", brUnprepared === "Q2_UNPREPARED", brUnprepared);

    // default branch
    const rPartial = parseAnswer(q, "2");
    const brPartial = resolveNextCode(q.branch_rule, rPartial.normalizedAnswer);
    ok("branch: partial → Q2_OTHER (default)", brPartial === "Q2_OTHER", brPartial);
  }

  // ─── 2. free_text_short (Q2_PREPARED) ───
  section("Q2_PREPARED: free_text_short + AI probe enabled");
  {
    const q = qs["Q2_PREPARED"];
    ok("question_type = free_text_short", q.question_type === "free_text_short");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);

    const r = parseAnswer(q, "水と非常食を用意しています。停電でも使えるからです。");
    ok("テキスト回答が通る", r.normalizedAnswer.value === "水と非常食を用意しています。停電でも使えるからです。");

    // max_length 超過
    const over = "あ".repeat(121);
    let threw = false;
    try { parseAnswer(q, over); } catch { threw = true; }
    ok("max_length=120 超過でエラー", threw);

    // branch default_next
    const next = resolveNextCode(q.branch_rule, r.normalizedAnswer);
    ok("次の設問 → Q3 (default_next)", next === "Q3", next);
  }

  // ─── 3. multi_choice (Q3) ───
  section("Q3: multi_choice + branch_rule (includes)");
  {
    const q = qs["Q3"];
    ok("question_type = multi_choice", q.question_type === "multi_choice");

    // カンマ区切り
    const r1 = parseAnswer(q, "1,3");
    ok("1,3 → checklist + expiry", JSON.stringify(r1.normalizedAnswer.values) === JSON.stringify(["checklist","expiry"]));

    // habit を含む選択
    const r2 = parseAnswer(q, "2,5");
    ok("2,5 → quantity + habit", r2.normalizedAnswer.values.includes("habit"));

    // habit 含む → Q6_HABIT
    const brHabit = resolveNextCode(q.branch_rule, r2.normalizedAnswer);
    ok("branch: habit included → Q6_HABIT", brHabit === "Q6_HABIT", brHabit);

    // habit なし → Q7
    const brNoHabit = resolveNextCode(q.branch_rule, r1.normalizedAnswer);
    ok("branch: no habit → Q7 (default)", brNoHabit === "Q7", brNoHabit);

    // min_select 未満
    let threw = false;
    try { parseAnswer(q, ""); } catch { threw = true; }
    ok("空入力でエラー", threw);

    // max_select 超過 (max=4, options=6: 1,2,3,4,5 → 5件はNG)
    let threw2 = false;
    try { parseAnswer(q, "1,2,3,4,5"); } catch { threw2 = true; }
    ok("5件選択でmax_select=4エラー", threw2);
  }

  // ─── 4. free_text_long (Q7) ───
  section("Q7: free_text_long");
  {
    const q = qs["Q7"];
    ok("question_type = free_text_long", q.question_type === "free_text_long");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);

    const r = parseAnswer(q, "台風前に慌てて買いに行くことが多く、何をどれだけ買えばよいかわからないのが不安です。");
    ok("テキスト回答が通る", typeof r.normalizedAnswer.value === "string");
    ok("branch_rule = null → default next (Q8)", q.branch_rule === null);
  }

  // ─── 5. matrix_single (Q8) ───
  section("Q8: matrix_single (LINE text fallback)");
  {
    const q = qs["Q8"];
    ok("question_type = matrix_single", q.question_type === "matrix_single");
    const r = parseAnswer(q, "必要量がわかりそう=4, 続けやすそう=3, 通知が役立ちそう=5");
    ok("テキスト入力を matrix_text_fallback で受理", r.normalizedAnswer.note === "matrix_text_fallback");
  }

  // ─── 6. matrix_multi (Q9) ───
  section("Q9: matrix_multi (LINE text fallback)");
  {
    const q = qs["Q9"];
    ok("question_type = matrix_multi", q.question_type === "matrix_multi");
    const r = parseAnswer(q, "台風前=通知,買い物リスト");
    ok("テキスト入力を matrix_text_fallback で受理", r.normalizedAnswer.note === "matrix_text_fallback");
  }

  // ─── 7. matrix_mixed (Q10) ───
  section("Q10: matrix_mixed (LINE text fallback)");
  {
    const q = qs["Q10"];
    ok("question_type = matrix_mixed", q.question_type === "matrix_mixed");
    const r = parseAnswer(q, "通知頻度=少なめ / 補充提案=必要 / 共有範囲=家族全員");
    ok("テキスト入力を matrix_text_fallback で受理", r.normalizedAnswer.note === "matrix_text_fallback");
  }

  // ─── 8. numeric (Q11) ───
  section("Q11: numeric + branch_rule (gte/lte)");
  {
    const q = qs["Q11"];
    ok("question_type = numeric", q.question_type === "numeric");

    const r1 = parseAnswer(q, "2");
    ok("2 → number 2", r1.normalizedAnswer.value === 2);
    const br1 = resolveNextCode(q.branch_rule, r1.normalizedAnswer);
    ok("2 (lte 2) → Q11_LOW", br1 === "Q11_LOW", br1);

    const r3 = parseAnswer(q, "3");
    ok("3 → number 3", r3.normalizedAnswer.value === 3);
    const br3 = resolveNextCode(q.branch_rule, r3.normalizedAnswer);
    ok("3 (neither lte2 nor gte4) → Q12 (default)", br3 === "Q12", br3);

    const r5 = parseAnswer(q, "5");
    ok("5 → number 5", r5.normalizedAnswer.value === 5);
    const br5 = resolveNextCode(q.branch_rule, r5.normalizedAnswer);
    ok("5 (gte 4) → Q11_HIGH", br5 === "Q11_HIGH", br5);

    // 範囲外
    let threw1 = false;
    try { parseAnswer(q, "0"); } catch { threw1 = true; }
    ok("0 (min=1 未満) でエラー", threw1);

    let threw2 = false;
    try { parseAnswer(q, "6"); } catch { threw2 = true; }
    ok("6 (max=5 超過) でエラー", threw2);

    let threw3 = false;
    try { parseAnswer(q, "abc"); } catch { threw3 = true; }
    ok("非数値でエラー", threw3);
  }

  // ─── 9. sd (Q12) ───
  section("Q12: sd (SD法)");
  {
    const q = qs["Q12"];
    ok("question_type = sd", q.question_type === "sd");

    const r1 = parseAnswer(q, "1");
    ok("1 → 1(続かなさそう)", r1.normalizedAnswer.value === 1 && r1.normalizedAnswer.label === "続かなさそう");

    const r5 = parseAnswer(q, "5");
    ok("5 → 5(続けやすそう)", r5.normalizedAnswer.value === 5 && r5.normalizedAnswer.label === "続けやすそう");

    let threw = false;
    try { parseAnswer(q, "6"); } catch { threw = true; }
    ok("6 (範囲外) でエラー", threw);

    let threw2 = false;
    try { parseAnswer(q, "0"); } catch { threw2 = true; }
    ok("0 (範囲外) でエラー", threw2);
  }

  // ─── 10. text_with_image (Q13) ───
  section("Q13: text_with_image (単一選択 + 画像)");
  {
    const q = qs["Q13"];
    ok("question_type = text_with_image", q.question_type === "text_with_image");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);
    ok("question_text_image が設定されている", Boolean(q.question_config?.question_text_image?.url));

    const r1 = parseAnswer(q, "1");
    ok("1 → easy (わかりやすい)", r1.normalizedAnswer.value === "easy");

    const r2 = parseAnswer(q, "情報量が多い");
    ok("ラベル入力 → too_much", r2.normalizedAnswer.value === "too_much");

    let threw = false;
    try { parseAnswer(q, "不正な値"); } catch { threw = true; }
    ok("不正入力でエラー", threw);
  }

  // ─── 11. image_upload (Q14) ───
  section("Q14: image_upload (LINE text fallback)");
  {
    const q = qs["Q14"];
    ok("question_type = image_upload", q.question_type === "image_upload");
    const r = parseAnswer(q, "画像なし");
    ok("テキスト入力を image_upload_text_fallback で受理", r.normalizedAnswer.note === "image_upload_text_fallback");
  }

  // ─── 12. hidden_single (Q15) ───
  section("Q15: hidden_single");
  {
    const q = qs["Q15"];
    ok("question_type = hidden_single", q.question_type === "hidden_single");
    const r = parseAnswer(q, "A");
    ok("テキスト入力を受理", r.answerText === "A");
  }

  // ─── 13. hidden_multi (Q16) ───
  section("Q16: hidden_multi");
  {
    const q = qs["Q16"];
    ok("question_type = hidden_multi", q.question_type === "hidden_multi");
    const r = parseAnswer(q, "A,B");
    ok("テキスト入力を受理", r.answerText === "A,B");
  }

  // ─── 追加: AI probe 設定整合性チェック ───
  section("AI probe 設定整合性チェック");
  {
    const probeTargets = ["Q2_PREPARED","Q2_UNPREPARED","Q2_OTHER","Q6_HABIT","Q7","Q11_LOW","Q11_HIGH","Q13"];
    const probeBlocked = ["Q1","Q3","Q8","Q9","Q10","Q11","Q12","Q14","Q15","Q16"];

    for (const code of probeTargets) {
      if (qs[code]) {
        ok(`${code}: ai_probe_enabled = true`, qs[code].ai_probe_enabled === true);
      }
    }
    for (const code of probeBlocked) {
      if (qs[code]) {
        ok(`${code}: ai_probe_enabled = false`, qs[code].ai_probe_enabled === false);
      }
    }
  }

  // ─── 結果サマリ ───
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  結果: ${passed} 件成功 / ${failed} 件失敗`);
  console.log("═".repeat(60));
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
