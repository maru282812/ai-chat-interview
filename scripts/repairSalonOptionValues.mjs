/**
 * repairSalonOptionValues.mjs
 *
 * 美容室C（本音アンケート）の壊れた選択肢 value と分岐条件を、seed（原本）の定義へ戻す。
 *
 * 何が起きていたか:
 *   seed は Q5 に {value:"yes", label:"はい（この店／別の店）"} を入れ、
 *   Q6 の表示条件を "q5=yes" と書いていた。ところがフロー設計画面の保存 API は
 *   ラベル配列しか受け取らず、選択肢を {label, value: label} で作り直していたため、
 *   一度でも保存すると value がラベル文字列へ化けた。
 *   実行時の判定は String(actual) === String(expected) の文字列比較なので、
 *   "q5=yes" も branch_rule の when も二度と一致せず、
 *   Q5-Q7 の分岐と Q6-Q10 の出し分けが本番で黙って全滅していた。
 *
 *   さらに branch_rule の条件は {equals: 1|2|3}（1始まりの選択肢番号）で入っており、
 *   これも回答値（コード文字列）とは一致しない。番号→コードへ読み替えて直す。
 *
 * 原因側のコード修正（value を作り直さない）は adminController の
 * mergeOptionLabelsPreservingValues で済んでいる。このスクリプトは
 * 「既に壊れてしまったデータ」を戻すためのもの。
 *
 * 安全策:
 *   - 既定は dry-run。--apply を付けたときだけ書き込む。
 *   - 既にコードが入っている選択肢（Q1/Q3/Q8/Q9 等）は触らない。
 *   - ラベル一致で突合する。ラベルが seed と違う選択肢が1つでもあれば、その設問は
 *     スキップして報告する（勝手な当て推量で value を付けない）。
 *   - 回答（answers）は書き換えない。既存回答は Q1 に1件だけで、
 *     今回直す設問には付いていないことを確認済み。
 *
 * 使い方:
 *   node scripts/repairSalonOptionValues.mjs           # 差分表示のみ
 *   node scripts/repairSalonOptionValues.mjs --apply   # 本番へ適用
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = "5a10c003-0000-4000-8000-000000000003"; // 【●●美容室】C：本音アンケート

/**
 * seed（scripts/seedSalonSurveyProjects.mjs）が定義している「正しい」選択肢。
 * ラベルは seed の文字列そのまま（●● は店舗名プレースホルダで、DB 側も同じ文字列）。
 */
const EXPECTED_OPTIONS = {
  Q2: [
    ["home_styling_good", "自宅でセットしやすかった"],
    ["style_lasted", "髪型が長持ちした"],
    ["color_lasted", "ヘアカラーの色が長持ちした"],
    ["perm_lasted", "パーマが長持ちした"],
    ["color_liked", "ヘアカラーの色の感じが気に入った"],
    ["perm_liked", "パーマの感じが気に入った"],
    ["good_reputation", "周囲から評判が良かった"],
    ["style_liked", "髪型が気に入った"],
    ["other", "その他"],
    ["none", "特になし"],
  ],
  Q5: [
    ["yes", "はい（この店／別の店）"],
    ["no", "いいえ"],
  ],
  Q6: [
    ["same", "この●●美容室を再度利用した"],
    ["other", "別の美容室を利用した"],
    ["both", "この●●美容室と別の美容室の両方を利用した"],
  ],
  Q7: [
    ["same", "この美容室を再度利用する予定"],
    ["other", "別の美容室を利用する予定"],
    ["undecided", "検討中・考えていない"],
  ],
};

/** 正規化（全角空白・前後空白の揺れでラベル突合が外れないように） */
const norm = (s) => String(s ?? "").replace(/　/g, " ").trim();

async function main() {
  console.log(APPLY ? "=== 適用モード（本番へ書き込みます） ===" : "=== dry-run（書き込みません） ===");
  console.log("project:", PROJECT_ID, "\n");

  const { data: questions, error } = await supabase
    .from("questions")
    .select("id,question_code,question_config,branch_rule,visibility_conditions,sort_order")
    .eq("project_id", PROJECT_ID)
    .order("sort_order");
  if (error) throw error;

  // 回答が付いている設問を把握する（付いていたら value 書き換えは既存回答と食い違う）
  const { data: answered } = await supabase
    .from("answers")
    .select("question_id")
    .in("question_id", questions.map((q) => q.id));
  const answeredIds = new Set((answered ?? []).map((a) => a.question_id));

  const updates = [];
  const skipped = [];

  // ── 1) 選択肢 value の復元 ───────────────────────────────
  for (const q of questions) {
    const expected = EXPECTED_OPTIONS[q.question_code];
    if (!expected) continue;

    const current = q.question_config?.options ?? [];
    if (current.length === 0) { skipped.push(`${q.question_code}: 選択肢が無い`); continue; }

    if (answeredIds.has(q.id)) {
      skipped.push(`${q.question_code}: 回答が付いているため value を触らない`);
      continue;
    }

    // ラベルで突合する。1つでも seed に無いラベルがあれば、その設問はまるごと見送る。
    const byLabel = new Map(expected.map(([value, label]) => [norm(label), value]));
    const unknown = current.filter((o) => !byLabel.has(norm(o.label)));
    if (unknown.length > 0) {
      skipped.push(`${q.question_code}: seed に無いラベルがある → ${unknown.map((o) => JSON.stringify(o.label)).join(", ")}`);
      continue;
    }

    const nextOptions = current.map((o) => ({ ...o, value: byLabel.get(norm(o.label)) }));
    const changed = nextOptions.some((o, i) => o.value !== current[i].value);
    if (!changed) { console.log(`${q.question_code}: 選択肢 value は既に正しい`); continue; }

    console.log(`${q.question_code}: 選択肢 value を復元`);
    current.forEach((o, i) => {
      if (o.value !== nextOptions[i].value) {
        console.log(`    ${JSON.stringify(o.label)}: ${JSON.stringify(o.value)} -> ${JSON.stringify(nextOptions[i].value)}`);
      }
    });

    updates.push({
      id: q.id,
      code: q.question_code,
      patch: { question_config: { ...q.question_config, options: nextOptions } },
      _nextOptions: nextOptions,
    });
  }

  // ── 2) branch_rule の条件（1始まりの番号）をコードへ読み替え ──
  for (const q of questions) {
    const rule = q.branch_rule;
    if (!rule || Array.isArray(rule) || !(rule.branches ?? []).length) continue;

    // 復元後の選択肢を使う（同じ周回で value を直しているため）
    const pending = updates.find((u) => u.id === q.id);
    const options = pending?._nextOptions ?? q.question_config?.options ?? [];
    if (!options.length) continue;

    let touched = false;
    const branches = rule.branches.map((b) => {
      const when = b.when ?? {};
      if (when.equals === undefined) return b;

      const raw = String(when.equals);
      // 既にコード一致しているならそのまま
      if (options.some((o) => String(o.value) === raw)) return b;
      // 1始まりの選択肢番号として読み替える
      if (/^[0-9]+$/.test(raw)) {
        const idx = Number(raw) - 1;
        const hit = options[idx];
        if (hit) {
          touched = true;
          console.log(`${q.question_code}: 分岐条件 equals:${raw} -> equals:${JSON.stringify(hit.value)} （${hit.label}） → ${b.next}`);
          return { ...b, when: { ...when, equals: hit.value } };
        }
      }
      skipped.push(`${q.question_code}: 分岐条件 equals:${raw} を解決できない`);
      return b;
    });

    if (!touched) continue;
    const nextRule = { ...rule, branches };
    const existing = updates.find((u) => u.id === q.id);
    if (existing) existing.patch.branch_rule = nextRule;
    else updates.push({ id: q.id, code: q.question_code, patch: { branch_rule: nextRule } });
  }

  console.log("\n--- 対象:", updates.map((u) => u.code).join(", ") || "なし", "---");
  if (skipped.length) {
    console.log("--- 見送り ---");
    skipped.forEach((s) => console.log("   ", s));
  }

  if (!APPLY) {
    console.log("\ndry-run のため書き込んでいません。適用するには --apply を付けてください。");
    return;
  }

  for (const u of updates) {
    const { _nextOptions, ...rest } = u;
    const { error: upErr } = await supabase.from("questions").update(rest.patch).eq("id", u.id);
    if (upErr) throw new Error(`${u.code} の更新に失敗: ${upErr.message}`);
    console.log("updated:", u.code);
  }

  // ── 3) 適用後の検証（実際に読み直して条件が一致するか確かめる） ──
  const { data: after } = await supabase
    .from("questions")
    .select("question_code,question_config,branch_rule,visibility_conditions")
    .eq("project_id", PROJECT_ID)
    .order("sort_order");

  console.log("\n=== 適用後の検証 ===");
  let bad = 0;
  for (const q of after) {
    const values = new Set((q.question_config?.options ?? []).map((o) => String(o.value)));
    // 分岐条件が実在する選択肢を指しているか
    for (const b of q.branch_rule?.branches ?? []) {
      const eq = b.when?.equals;
      if (eq !== undefined && !values.has(String(eq))) {
        console.log(`  NG ${q.question_code}: 分岐条件 ${JSON.stringify(eq)} が選択肢に無い`);
        bad++;
      }
    }
    // 表示条件が参照する値が、参照先設問の選択肢に実在するか
    for (const vc of q.visibility_conditions ?? []) {
      const expr = vc.expression ?? "";
      for (const m of expr.matchAll(/\b(q\d+)\s*=\s*([^\s)]+)/gi)) {
        const target = after.find((x) => x.question_code.toLowerCase() === m[1].toLowerCase());
        if (!target) continue;
        const tv = new Set((target.question_config?.options ?? []).map((o) => String(o.value)));
        if (tv.size && !tv.has(m[2])) {
          console.log(`  NG ${q.question_code}: 表示条件 ${m[1]}=${m[2]} が ${m[1]} の選択肢に無い`);
          bad++;
        }
      }
    }
  }
  console.log(bad === 0 ? "  OK: 分岐条件・表示条件はすべて実在する選択肢を指しています" : `  ${bad} 件の不整合が残っています`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
