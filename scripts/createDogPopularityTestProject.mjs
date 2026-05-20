/**
 * createDogPopularityTestProject.mjs
 * 人気犬種調査テストプロジェクトを DB に投入するスクリプト
 *
 * Usage: node scripts/createDogPopularityTestProject.mjs
 */

import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

loadDotEnv();

const SQL_PATH = "supabase/test_dog_popularity_project.sql";

const projectColumns = [
  "id", "name", "client_name", "objective", "status", "reward_points",
  "research_mode", "display_mode", "primary_objectives", "secondary_objectives",
  "comparison_constraints", "prompt_rules", "probe_policy", "response_style",
  "ai_state_template_key", "ai_state_generated_at", "ai_state_json",
  "created_at", "updated_at"
];

const questionColumns = [
  "project_id", "question_code", "question_text", "question_role",
  "question_type", "is_required", "sort_order", "branch_rule",
  "question_config", "ai_probe_enabled", "probe_guideline", "max_probe_count",
  "render_strategy", "is_system", "is_hidden", "comment_top", "comment_bottom",
  "answer_output_type", "display_tags_raw", "display_tags_parsed",
  "visibility_conditions", "page_group_id", "answer_options_locked",
  "created_at", "updated_at"
];

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "'" && text[i + 1] === "'") { i += 1; }
      else if (ch === "'") { inString = false; }
      continue;
    }
    if (ch === "'") { inString = true; }
    else if (ch === "(") { depth += 1; }
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("Unmatched parenthesis in SQL");
}

function splitTopLevelComma(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "'" && text[i + 1] === "'") { i += 1; }
      else if (ch === "'") { inString = false; }
      continue;
    }
    if (ch === "'") { inString = true; }
    else if (ch === "(") { depth += 1; }
    else if (ch === ")") { depth -= 1; }
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function parseValue(raw) {
  const value = raw.trim();
  const jsonMatch = value.match(/^'([\s\S]*)'::jsonb$/);
  if (jsonMatch) return JSON.parse(jsonMatch[1].replace(/''/g, "'"));
  const stringMatch = value.match(/^'([\s\S]*)'$/);
  if (stringMatch) return stringMatch[1].replace(/''/g, "'");
  if (/^null$/i.test(value)) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^now\(\)$/i.test(value)) return new Date().toISOString();
  if (/^-?\d+$/.test(value)) return Number(value);
  throw new Error(`Unsupported SQL value: ${value.slice(0, 80)}`);
}

function parseProject(sql) {
  const marker = "values (";
  const valuesStart = sql.indexOf(marker, sql.indexOf("insert into projects"));
  if (valuesStart < 0) throw new Error("Project values block not found");
  const openIndex = valuesStart + "values ".length;
  const closeIndex = findMatchingParen(sql, openIndex);
  const values = splitTopLevelComma(sql.slice(openIndex + 1, closeIndex)).map(parseValue);
  return Object.fromEntries(projectColumns.map((col, i) => [col, values[i]]));
}

function parseQuestionRows(sql) {
  const insertIndex = sql.indexOf("insert into questions");
  const valuesIndex = sql.indexOf("values", insertIndex);
  const conflictIndex = sql.indexOf("on conflict", valuesIndex);
  const valuesText = sql.slice(valuesIndex + "values".length, conflictIndex).trim().replace(/;$/, "");
  const rows = [];
  for (let i = 0; i < valuesText.length; i += 1) {
    if (valuesText[i] !== "(") continue;
    const closeIndex = findMatchingParen(valuesText, i);
    const rawValues = splitTopLevelComma(valuesText.slice(i + 1, closeIndex));
    rows.push(Object.fromEntries(questionColumns.map((col, idx) => [col, parseValue(rawValues[idx])])));
    i = closeIndex;
  }
  return rows;
}

async function removeExisting(supabase, projectId) {
  for (const table of ["point_transactions", "project_assignments", "project_analysis_reports", "respondents", "questions"]) {
    const { error } = await supabase.from(table).delete().eq("project_id", projectId);
    if (error) throw new Error(`${table} delete failed: ${error.message}`);
  }
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw new Error(`projects delete failed: ${error.message}`);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const project = parseProject(sql);
  const questions = parseQuestionRows(sql);
  const projectId = project.id;

  console.log(`Project ID: ${projectId}`);
  console.log(`Questions: ${questions.length} rows`);
  console.log(`Types: ${[...new Set(questions.map(q => q.question_type))].join(", ")}`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log("\nRemoving existing project data...");
  await removeExisting(supabase, projectId);

  console.log("Inserting project...");
  const { error: projectError } = await supabase.from("projects").insert(project);
  if (projectError) throw new Error(`project insert failed: ${projectError.message}`);

  console.log("Inserting questions...");
  const { error: questionsError } = await supabase.from("questions").insert(questions);
  if (questionsError) throw new Error(`questions insert failed: ${questionsError.message}`);

  console.log(`\nDone! Created project ${projectId} with ${questions.length} questions.`);
  console.log(`Admin URL: http://localhost:3000/admin/projects/${projectId}/questions`);
}

main().catch((error) => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
