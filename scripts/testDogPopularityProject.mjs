/**
 * testDogPopularityProject.mjs
 * 人気犬種調査プロジェクトの全回答形式・AI深掘り設定・分岐を動作確認するスクリプト
 *
 * Usage: node scripts/testDogPopularityProject.mjs
 */

// ─── parseAnswer（questionFlowServiceV2.ts 相当） ───

function normalizeOptionInput(input) {
  return input
    .trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

function findOption(input, options) {
  const normalized = normalizeOptionInput(input).toLowerCase();
  const numbered = Number(normalized);
  if (!Number.isNaN(numbered) && options[numbered - 1]) return options[numbered - 1] ?? null;
  return options.find((o) => {
    return normalized === o.label.trim().toLowerCase() || normalized === o.value.trim().toLowerCase();
  }) ?? null;
}

function parseAnswer(question, rawText) {
  const text = rawText.trim();
  const opts = question.question_config?.options ?? [];
  if (!text) throw new Error("回答が空です。");

  switch (question.question_type) {
    case "free_text_short":
    case "free_text_long": {
      const max = question.question_config?.max_length ?? null;
      if (max !== null && text.length > max) throw new Error(`${max}文字以内`);
      return { answerText: text, normalizedAnswer: { value: text } };
    }
    case "single_choice":
    case "text_with_image": {
      const opt = findOption(text, opts);
      if (!opt) throw new Error("選択肢から回答してください。");
      return { answerText: opt.label, normalizedAnswer: { value: opt.value, label: opt.label } };
    }
    case "multi_choice": {
      const parts = text.split(/[,\n、]/).map(p => p.trim()).filter(Boolean);
      const matched = parts.map(p => findOption(p, opts));
      if (matched.some(item => !item)) throw new Error("選択肢から回答してください。");
      const unique = Array.from(new Map(matched.map(item => [item.value, item])).values());
      const minSelect = question.question_config?.min_select ?? null;
      const maxSelect = question.question_config?.max_select ?? null;
      if (minSelect !== null && unique.length < minSelect) throw new Error(`${minSelect}件以上`);
      if (maxSelect !== null && unique.length > maxSelect) throw new Error(`${maxSelect}件以下`);
      return { answerText: unique.map(o => o.label).join(", "), normalizedAnswer: { values: unique.map(o => o.value), labels: unique.map(o => o.label) } };
    }
    case "numeric": {
      const value = Number(text);
      if (Number.isNaN(value)) throw new Error("数値で入力してください。");
      const min = question.question_config?.min ?? null;
      const max = question.question_config?.max ?? null;
      if (min !== null && value < min) throw new Error(`${min}以上`);
      if (max !== null && value > max) throw new Error(`${max}以下`);
      return { answerText: String(value), normalizedAnswer: { value } };
    }
    case "sd": {
      const scaleMax = opts.length > 0 ? opts.length : 7;
      const value = Number(text);
      if (Number.isNaN(value) || value < 1 || value > scaleMax) throw new Error(`1〜${scaleMax}の数字`);
      const matchedOpt = opts[value - 1];
      return { answerText: matchedOpt ? `${value}(${matchedOpt.label})` : String(value), normalizedAnswer: { value, label: matchedOpt?.label ?? String(value) } };
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

function normalizePrimitive(v) {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  return null;
}
function extractPrimitiveCandidates(v) {
  if (Array.isArray(v)) return v.flatMap(extractPrimitiveCandidates);
  const p = normalizePrimitive(v); return p === null ? [] : [p];
}
function resolvePathValues(value, path) {
  const segs = String(path ?? "").split(".").map(s => s.trim()).filter(Boolean);
  if (!segs.length) return [value];
  const walk = (cur, i) => {
    if (i >= segs.length) return [cur];
    if (Array.isArray(cur)) return cur.flatMap(item => walk(item, i));
    if (!cur || typeof cur !== "object") return [];
    return walk(cur[segs[i]], i + 1);
  };
  return walk(value, 0);
}
function collectBranchCandidates(route, ans) {
  if (route.field) return resolvePathValues(ans, route.field).flatMap(extractPrimitiveCandidates);
  return [...extractPrimitiveCandidates(ans.value), ...extractPrimitiveCandidates(ans.boolean), ...extractPrimitiveCandidates(ans.values)];
}
function comparePrimitive(a, b) {
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return a === b;
}
function matchesCondition(when, candidates) {
  if ("equals" in when) return candidates.some(c => comparePrimitive(c, when.equals));
  if ("includes" in when) return candidates.some(c => comparePrimitive(c, when.includes));
  if ("any_of" in when) return when.any_of.some(exp => candidates.some(c => comparePrimitive(c, exp)));
  if ("gte" in when) return candidates.some(c => Number(c) >= when.gte);
  if ("lte" in when) return candidates.some(c => Number(c) <= when.lte);
  return false;
}
function resolveNextCode(branchRule, ans) {
  if (branchRule?.branches) {
    for (const br of branchRule.branches) {
      if (matchesCondition(br.when, collectBranchCandidates(br, ans))) return br.next;
    }
  }
  return branchRule?.default_next ?? null;
}

// ─── テストユーティリティ ───

let passed = 0, failed = 0;
function ok(label, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? `  (${detail})` : ""}`); failed++; }
}
function section(title) {
  console.log(`\n${"─".repeat(60)}\n  ${title}\n${"─".repeat(60)}`);
}

// ─── DB からプロジェクト設問取得 ───

async function fetchQuestions() {
  const res = await fetch(
    "http://localhost:3000/admin/api/projects/00000000-0000-4000-8000-0000000000b3/flow-preview",
    { headers: { Authorization: "Basic " + Buffer.from("admin:change-me").toString("base64") } }
  );
  const json = await res.json();
  if (!json.ok) throw new Error("Failed to fetch: " + JSON.stringify(json));
  const map = {};
  for (const q of json.questions) map[q.question_code] = q;
  return map;
}

async function main() {
  console.log("=== 人気犬種調査プロジェクト 動作チェック ===\n");

  const qs = await fetchQuestions();
  console.log(`DB から ${Object.keys(qs).length} 件の設問を取得しました。`);

  // ─── Q1: single_choice + 3方向分岐 ───
  section("Q1: single_choice（飼育状況 → 3方向分岐）");
  {
    const q = qs["Q1"];
    ok("question_type = single_choice", q.question_type === "single_choice");
    ok("ai_probe_enabled = false", q.ai_probe_enabled === false);

    const rHave = parseAnswer(q, "1");
    ok("1 → have", rHave.normalizedAnswer.value === "have");
    ok("have → Q2_HAVE", resolveNextCode(q.branch_rule, rHave.normalizedAnswer) === "Q2_HAVE");

    const rHad = parseAnswer(q, "以前飼っていたが今はいない");
    ok("ラベル入力 → had", rHad.normalizedAnswer.value === "had");
    ok("had → Q2_HAD", resolveNextCode(q.branch_rule, rHad.normalizedAnswer) === "Q2_HAD");

    const rWant = parseAnswer(q, "3");
    ok("3 → want (default_next = Q2_WANT)", resolveNextCode(q.branch_rule, rWant.normalizedAnswer) === "Q2_WANT");

    const rNone = parseAnswer(q, "4");
    ok("4 → none (default_next = Q2_WANT)", resolveNextCode(q.branch_rule, rNone.normalizedAnswer) === "Q2_WANT");

    const r4z = parseAnswer(q, "４");
    ok("全角4 → none (default_next = Q2_WANT)", resolveNextCode(q.branch_rule, r4z.normalizedAnswer) === "Q2_WANT");

    let threw = false;
    try { parseAnswer(q, "不正な値"); } catch { threw = true; }
    ok("不正入力でエラー", threw);
  }

  // ─── Q2_HAVE: free_text_short + probe ───
  section("Q2_HAVE: free_text_short（現飼育者向け + AI probe）");
  {
    const q = qs["Q2_HAVE"];
    ok("question_type = free_text_short", q.question_type === "free_text_short");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);
    const r = parseAnswer(q, "柴犬を飼っています。独立心があるのに甘えてくる瞬間がたまらないです");
    ok("テキスト回答が通る", typeof r.normalizedAnswer.value === "string");
    ok("next → Q3", resolveNextCode(q.branch_rule, r.normalizedAnswer) === "Q3");
    let threw = false;
    try { parseAnswer(q, "あ".repeat(121)); } catch { threw = true; }
    ok("max_length=120 超過でエラー", threw);
  }

  // ─── Q2_HAD: free_text_short + probe ───
  section("Q2_HAD: free_text_short（元飼育者向け + AI probe）");
  {
    const q = qs["Q2_HAD"];
    ok("question_type = free_text_short", q.question_type === "free_text_short");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);
    const r = parseAnswer(q, "ゴールデンレトリバーを飼っていました。公園で一緒に走った記憶が鮮明です");
    ok("テキスト回答が通る", typeof r.normalizedAnswer.value === "string");
    ok("next → Q3", resolveNextCode(q.branch_rule, r.normalizedAnswer) === "Q3");
  }

  // ─── Q2_WANT: free_text_short + probe ───
  section("Q2_WANT: free_text_short（未飼育者向け + AI probe）");
  {
    const q = qs["Q2_WANT"];
    ok("question_type = free_text_short", q.question_type === "free_text_short");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);
    const r = parseAnswer(q, "トイプードルです。賢くて抜け毛が少なく、マンションでも飼いやすそうだからです");
    ok("テキスト回答が通る", typeof r.normalizedAnswer.value === "string");
    ok("next → Q3", resolveNextCode(q.branch_rule, r.normalizedAnswer) === "Q3");
  }

  // ─── Q3: multi_choice + includes 分岐 ───
  section("Q3: multi_choice（inluces: companion → Q4_COMPANION）");
  {
    const q = qs["Q3"];
    ok("question_type = multi_choice", q.question_type === "multi_choice");
    ok("ai_probe_enabled = false", q.ai_probe_enabled === false);

    const rComp = parseAnswer(q, "1,2");
    ok("1,2 → companion + active", rComp.normalizedAnswer.values.includes("companion"));
    ok("companion あり → Q4_COMPANION", resolveNextCode(q.branch_rule, rComp.normalizedAnswer) === "Q4_COMPANION");

    const rNoComp = parseAnswer(q, "2,3");
    ok("2,3 → active + child (companion なし)", !rNoComp.normalizedAnswer.values.includes("companion"));
    ok("companion なし → Q5 (default)", resolveNextCode(q.branch_rule, rNoComp.normalizedAnswer) === "Q5");

    let threw = false;
    try { parseAnswer(q, ""); } catch { threw = true; }
    ok("空入力でエラー", threw);

    let threw2 = false;
    try { parseAnswer(q, "1,2,3,4,5"); } catch { threw2 = true; }
    ok("5件でmax_select=4エラー", threw2);
  }

  // ─── Q4_COMPANION: free_text_short + probe ───
  section("Q4_COMPANION: free_text_short（companion 分岐後 + AI probe）");
  {
    const q = qs["Q4_COMPANION"];
    ok("question_type = free_text_short", q.question_type === "free_text_short");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);
    const r = parseAnswer(q, "帰宅したときに尻尾を振って迎えてくれる瞬間が一日の疲れを忘れさせてくれます");
    ok("テキスト回答が通る", typeof r.normalizedAnswer.value === "string");
    ok("next → Q5", resolveNextCode(q.branch_rule, r.normalizedAnswer) === "Q5");
  }

  // ─── Q5: free_text_long + probe ───
  section("Q5: free_text_long（理想の犬 + AI probe）");
  {
    const q = qs["Q5"];
    ok("question_type = free_text_long", q.question_type === "free_text_long");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);
    ok("branch_rule = null → sort_order で次へ", q.branch_rule === null);
    const r = parseAnswer(q, "活発で散歩が大好きな犬がいいです。週末に公園でフリスビーをしたり、夜は一緒にのんびりできる犬が理想です");
    ok("テキスト回答が通る", typeof r.normalizedAnswer.value === "string");
  }

  // ─── Q6: matrix_single ───
  section("Q6: matrix_single（LINE text fallback）");
  {
    const q = qs["Q6"];
    ok("question_type = matrix_single", q.question_type === "matrix_single");
    const r = parseAnswer(q, "柴犬=4, トイプードル=5, ラブラドール=3");
    ok("matrix_text_fallback で受理", r.normalizedAnswer.note === "matrix_text_fallback");
    ok("matrix_rows に柴犬あり", q.question_config?.matrix_rows?.some(row => row.label === "柴犬"));
    ok("matrix_cols に5段階あり", q.question_config?.matrix_cols?.length === 5);
  }

  // ─── Q7: matrix_multi ───
  section("Q7: matrix_multi（LINE text fallback）");
  {
    const q = qs["Q7"];
    ok("question_type = matrix_multi", q.question_type === "matrix_multi");
    const r = parseAnswer(q, "朝の散歩=活発,大型 / 休日=おとなしい");
    ok("matrix_text_fallback で受理", r.normalizedAnswer.note === "matrix_text_fallback");
  }

  // ─── Q8: matrix_mixed ───
  section("Q8: matrix_mixed（LINE text fallback）");
  {
    const q = qs["Q8"];
    ok("question_type = matrix_mixed", q.question_type === "matrix_mixed");
    const r = parseAnswer(q, "体の大きさ=小型 / 毛の抜けやすさ=少ない / 好みのコメント=抜け毛が気になります");
    ok("matrix_text_fallback で受理", r.normalizedAnswer.note === "matrix_text_fallback");
    ok("free_text_short 行が混在している", q.question_config?.matrix_rows?.some(row => row.answer_type === "free_text_short"));
  }

  // ─── Q9: numeric + lte/gte 分岐 ───
  section("Q9: numeric（関心度 + lte/gte 分岐）");
  {
    const q = qs["Q9"];
    ok("question_type = numeric", q.question_type === "numeric");

    const r1 = parseAnswer(q, "1");
    ok("1 → Q9_LOW (lte 2)", resolveNextCode(q.branch_rule, r1.normalizedAnswer) === "Q9_LOW");

    const r2 = parseAnswer(q, "2");
    ok("2 → Q9_LOW (lte 2)", resolveNextCode(q.branch_rule, r2.normalizedAnswer) === "Q9_LOW");

    const r3 = parseAnswer(q, "3");
    ok("3 → Q10 (default, gte4 でも lte2 でもない)", resolveNextCode(q.branch_rule, r3.normalizedAnswer) === "Q10");

    const r4 = parseAnswer(q, "4");
    ok("4 → Q9_HIGH (gte 4)", resolveNextCode(q.branch_rule, r4.normalizedAnswer) === "Q9_HIGH");

    const r5 = parseAnswer(q, "5");
    ok("5 → Q9_HIGH (gte 4)", resolveNextCode(q.branch_rule, r5.normalizedAnswer) === "Q9_HIGH");

    let threw1 = false; try { parseAnswer(q, "0"); } catch { threw1 = true; }
    ok("0 (min=1 未満) でエラー", threw1);
    let threw2 = false; try { parseAnswer(q, "6"); } catch { threw2 = true; }
    ok("6 (max=5 超過) でエラー", threw2);
    let threw3 = false; try { parseAnswer(q, "abc"); } catch { threw3 = true; }
    ok("非数値でエラー", threw3);
  }

  // ─── Q9_LOW / Q9_HIGH: free_text_short + probe ───
  section("Q9_LOW / Q9_HIGH: free_text_short（分岐後理由質問 + AI probe）");
  {
    for (const code of ["Q9_LOW", "Q9_HIGH"]) {
      const q = qs[code];
      ok(`${code}: question_type = free_text_short`, q.question_type === "free_text_short");
      ok(`${code}: ai_probe_enabled = true`, q.ai_probe_enabled === true);
      ok(`${code}: next → Q10`, resolveNextCode(q.branch_rule, { value: "test" }) === "Q10");
    }
  }

  // ─── Q10: sd ───
  section("Q10: sd（おとなしい ↔ 活発）");
  {
    const q = qs["Q10"];
    ok("question_type = sd", q.question_type === "sd");

    const r1 = parseAnswer(q, "1");
    ok("1 → おとなしい", r1.normalizedAnswer.label === "おとなしい");

    const r5 = parseAnswer(q, "5");
    ok("5 → 活発", r5.normalizedAnswer.label === "活発");

    const r3 = parseAnswer(q, "3");
    ok("3 → どちらともいえない", r3.normalizedAnswer.label === "どちらともいえない");

    let threw1 = false; try { parseAnswer(q, "0"); } catch { threw1 = true; }
    ok("0 (範囲外) でエラー", threw1);
    let threw2 = false; try { parseAnswer(q, "6"); } catch { threw2 = true; }
    ok("6 (範囲外) でエラー", threw2);
  }

  // ─── Q11: text_with_image + probe ───
  section("Q11: text_with_image（画像付き設問 + AI probe）");
  {
    const q = qs["Q11"];
    ok("question_type = text_with_image", q.question_type === "text_with_image");
    ok("ai_probe_enabled = true", q.ai_probe_enabled === true);
    ok("question_text_image が設定されている", Boolean(q.question_config?.question_text_image?.url));

    const r1 = parseAnswer(q, "1");
    ok("1 → cute (かわいい・癒される)", r1.normalizedAnswer.value === "cute");

    const r2 = parseAnswer(q, "活発そうで一緒に動きたい");
    ok("ラベル入力 → active", r2.normalizedAnswer.value === "active");

    let threw = false; try { parseAnswer(q, "不正な値"); } catch { threw = true; }
    ok("不正入力でエラー", threw);
  }

  // ─── Q12: image_upload ───
  section("Q12: image_upload（LINE text fallback）");
  {
    const q = qs["Q12"];
    ok("question_type = image_upload", q.question_type === "image_upload");
    ok("ai_probe_enabled = false", q.ai_probe_enabled === false);
    const r = parseAnswer(q, "画像なし");
    ok("テキストを image_upload_text_fallback で受理", r.normalizedAnswer.note === "image_upload_text_fallback");
  }

  // ─── Q13: hidden_single ───
  section("Q13: hidden_single");
  {
    const q = qs["Q13"];
    ok("question_type = hidden_single", q.question_type === "hidden_single");
    const r = parseAnswer(q, "A");
    ok("テキスト受理", r.answerText === "A");
  }

  // ─── Q14: hidden_multi ───
  section("Q14: hidden_multi");
  {
    const q = qs["Q14"];
    ok("question_type = hidden_multi", q.question_type === "hidden_multi");
    const r = parseAnswer(q, "A,B");
    ok("テキスト受理", r.answerText === "A,B");
  }

  // ─── AI probe 整合性チェック ───
  section("AI probe 設定整合性チェック");
  {
    const probeTargets = ["Q2_HAVE", "Q2_HAD", "Q2_WANT", "Q4_COMPANION", "Q5", "Q9_LOW", "Q9_HIGH", "Q11"];
    const probeBlocked = ["Q1", "Q3", "Q6", "Q7", "Q8", "Q9", "Q10", "Q12", "Q13", "Q14"];
    for (const code of probeTargets) {
      if (qs[code]) ok(`${code}: ai_probe_enabled = true`, qs[code].ai_probe_enabled === true);
    }
    for (const code of probeBlocked) {
      if (qs[code]) ok(`${code}: ai_probe_enabled = false`, qs[code].ai_probe_enabled === false);
    }
  }

  // ─── 13種類すべての question_type が存在するか ───
  section("全 question_type 網羅チェック");
  {
    const expectedTypes = [
      "single_choice", "multi_choice",
      "free_text_short", "free_text_long",
      "matrix_single", "matrix_multi", "matrix_mixed",
      "numeric", "sd",
      "text_with_image", "image_upload",
      "hidden_single", "hidden_multi"
    ];
    const actualTypes = new Set(Object.values(qs).map(q => q.question_type));
    for (const t of expectedTypes) {
      ok(`question_type: ${t} が存在する`, actualTypes.has(t));
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
