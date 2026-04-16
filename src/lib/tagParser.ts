/**
 * tagParser.ts
 *
 * PDFタグ仕様を raw 文字列 → 構造化 JSON に変換するパーサ。
 *
 * 設計原則:
 *   - parser / validator / generator / evaluator を分離する
 *   - ここでは pure な変換のみ行う（DB アクセス・副作用なし）
 *   - エラーを throw せず TagParserResult に含めて返す
 *
 * 扱うタグ一覧:
 *   共通: <size=n> <norep> <fix> <br> <must> <ex>
 *         <img=file textPosition=...>
 *         <n> / <n,3>  <al>  <len=...>  <code=n>  <min=n> <max=n>
 *         <type(year)> <type(jyear)> <type(month)> <type(day)>
 *         <rows=n> <cols=n>
 *   マトリクス: <sa> <ma> <fs=n> <fl=cols,rows> <bf=text> <af=text>
 *   制御: <pipe 条件式>  <ans q●●>  <disable 選択肢値 条件式>
 */

import type {
  DisplayTagsParsed,
  TagValidationError,
  TagParserResult,
  LengthRule,
  ImageTagData,
  MatrixColSetting,
  PipingCondition,
  AnswerInsertion,
  DisableRule,
  NumericInputType,
} from "../types/questionSchema";

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

/** タグを全て抽出する正規表現 */
const TAG_REGEX = /<([^<>]+)>/g;

function addError(
  errors: TagValidationError[],
  code: string,
  message: string,
  tagName?: string,
  detail?: string
): void {
  errors.push({ code, message, severity: "error", tagName, detail });
}

function addWarning(
  warnings: TagValidationError[],
  code: string,
  message: string,
  tagName?: string
): void {
  warnings.push({ code, message, severity: "warning", tagName });
}

// ------------------------------------------------------------------
// len= のパース
// ------------------------------------------------------------------

function parseLenValue(
  val: string,
  parsed: DisplayTagsParsed,
  errors: TagValidationError[]
): void {
  const match = val.match(/^(>=|<=|=|>|<)(\d+)$/);
  if (!match) {
    addError(
      errors,
      "LEN_INVALID_FORMAT",
      `<len> の値が正しくありません: "${val}" (期待形式: >=n, <=n, =n, >n, <n)`,
      "len"
    );
    return;
  }
  parsed.lengthRule = {
    operator: (match[1] ?? "=") as LengthRule["operator"],
    value: parseInt(match[2] ?? "0", 10),
  };
}

// ------------------------------------------------------------------
// 主エントリ: parseDisplayTags
// ------------------------------------------------------------------

/**
 * raw タグ文字列を解析して DisplayTagsParsed を生成する。
 * エラーは throw せず result.errors に格納して返す。
 */
export function parseDisplayTags(raw: string | null | undefined): TagParserResult {
  const parsed: DisplayTagsParsed = {};
  const errors: TagValidationError[] = [];
  const warnings: TagValidationError[] = [];

  if (!raw || raw.trim() === "") {
    return { parsed, errors, warnings, rawGenerated: "" };
  }

  const tagMatches = Array.from(raw.matchAll(TAG_REGEX));

  for (const match of tagMatches) {
    const content = (match[1] ?? "").trim();
    if (!content) continue;

    // ----------------------------------------------------------------
    // 1. <ans q●●>  回答差し込み
    // ----------------------------------------------------------------
    if (/^ans\s+/i.test(content)) {
      const sourceCode = content.slice(4).trim().toLowerCase();
      if (!sourceCode) {
        addError(errors, "ANS_MISSING_CODE", "<ans> に質問コードがありません", "ans");
        continue;
      }
      if (!parsed.answerInsertions) parsed.answerInsertions = [];
      parsed.answerInsertions.push({
        source: sourceCode,
        target: "question_text",
      } as AnswerInsertion);
      continue;
    }

    // ----------------------------------------------------------------
    // 2. <pipe 条件式>  表示条件 / 遷移条件
    // ----------------------------------------------------------------
    if (/^pipe\s+/i.test(content)) {
      const expression = content.slice(5).trim();
      if (!expression) {
        addError(errors, "PIPE_MISSING_EXPRESSION", "<pipe> に条件式がありません", "pipe");
        continue;
      }
      if (!parsed.pipingConditions) parsed.pipingConditions = [];
      parsed.pipingConditions.push({ expression } as PipingCondition);
      continue;
    }

    // ----------------------------------------------------------------
    // 3. <disable 選択肢値 条件式>  選択肢非表示
    // ----------------------------------------------------------------
    if (/^disable\s+/i.test(content)) {
      const rest = content.slice(8).trim();
      const firstSpace = rest.indexOf(" ");
      if (firstSpace === -1) {
        addError(
          errors,
          "DISABLE_INVALID_FORMAT",
          `<disable> は "disable 選択肢値 条件式" の形式が必要です: "${content}"`,
          "disable"
        );
        continue;
      }
      const targetChoice = rest.slice(0, firstSpace).trim();
      const condition = rest.slice(firstSpace + 1).trim();
      if (!condition) {
        addError(
          errors,
          "DISABLE_MISSING_CONDITION",
          `<disable> の条件式がありません: "${content}"`,
          "disable"
        );
        continue;
      }
      if (!parsed.disableRules) parsed.disableRules = [];
      parsed.disableRules.push({ targetChoice, condition } as DisableRule);
      continue;
    }

    // ----------------------------------------------------------------
    // 4. <type(year)> / <type(jyear)> / <type(month)> / <type(day)>
    // ----------------------------------------------------------------
    const typeMatch = content.match(/^type\((\w+)\)$/i);
    if (typeMatch) {
      const typeVal = (typeMatch[1] ?? "").toLowerCase();
      if (!parsed.inputType) parsed.inputType = {} as NumericInputType;
      switch (typeVal) {
        case "year":  parsed.inputType.year  = true; break;
        case "jyear": parsed.inputType.jyear = true; break;
        case "month": parsed.inputType.month = true; break;
        case "day":   parsed.inputType.day   = true; break;
        default:
          addWarning(warnings, "UNKNOWN_TYPE_VALUE", `未知の type 値: "${typeVal}"`, "type");
      }
      continue;
    }

    // ----------------------------------------------------------------
    // 5. <n> / <n,3>  数値入力
    // ----------------------------------------------------------------
    if (/^n(,\d+)?$/i.test(content)) {
      parsed.numericOnly = true;
      const decMatch = content.match(/^n,(\d+)$/i);
      if (decMatch?.[1]) {
        parsed.numericDecimalPlaces = parseInt(decMatch[1], 10);
      }
      continue;
    }

    // ----------------------------------------------------------------
    // 6. <fl=cols,rows>  自由記述列（長）
    // ----------------------------------------------------------------
    const flMatch = content.match(/^fl=(\d+),(\d+)$/i);
    if (flMatch) {
      if (!parsed.matrixColSettings) parsed.matrixColSettings = [];
      parsed.matrixColSettings.push({
        type: "free_long",
        freeCols: parseInt(flMatch[1] ?? "0", 10),
        freeRows: parseInt(flMatch[2] ?? "0", 10),
      } as MatrixColSetting);
      continue;
    }

    // ----------------------------------------------------------------
    // 7. <img=file textPosition=...>  画像
    // ----------------------------------------------------------------
    const imgMatch = content.match(/^img=(\S+)(?:\s+textPosition=(\S+))?/i);
    if (imgMatch) {
      const imgFile = imgMatch[1] ?? "";
      const imgPos  = imgMatch[2];
      parsed.image = {
        file: imgFile,
        textPosition: imgPos ? (imgPos as ImageTagData["textPosition"]) : undefined,
      };
      continue;
    }

    // ----------------------------------------------------------------
    // 8. key=value タグ
    // ----------------------------------------------------------------
    const kvMatch = content.match(/^(\w+)=(.+)$/);
    if (kvMatch) {
      const key = (kvMatch[1] ?? "").toLowerCase();
      const val = (kvMatch[2] ?? "").trim();
      switch (key) {
        case "size": {
          const n = parseInt(val, 10);
          if (isNaN(n)) {
            addError(errors, "SIZE_INVALID", `<size> の値が数値ではありません: "${val}"`, "size");
          } else {
            parsed.inputSize = n;
          }
          break;
        }
        case "len": parseLenValue(val, parsed, errors); break;
        case "code": {
          const n = parseInt(val, 10);
          if (isNaN(n)) {
            addError(errors, "CODE_INVALID", `<code> の値が数値ではありません: "${val}"`, "code");
          } else {
            parsed.inputCode = n;
          }
          break;
        }
        case "min": {
          const n = parseFloat(val);
          if (isNaN(n)) {
            addError(errors, "MIN_INVALID", `<min> の値が数値ではありません: "${val}"`, "min");
          } else {
            parsed.minValue = n;
          }
          break;
        }
        case "max": {
          const n = parseFloat(val);
          if (isNaN(n)) {
            addError(errors, "MAX_INVALID", `<max> の値が数値ではありません: "${val}"`, "max");
          } else {
            parsed.maxValue = n;
          }
          break;
        }
        case "rows": {
          const n = parseInt(val, 10);
          if (isNaN(n)) {
            addError(errors, "ROWS_INVALID", `<rows> の値が数値ではありません: "${val}"`, "rows");
          } else {
            parsed.rows = n;
          }
          break;
        }
        case "cols": {
          const n = parseInt(val, 10);
          if (isNaN(n)) {
            addError(errors, "COLS_INVALID", `<cols> の値が数値ではありません: "${val}"`, "cols");
          } else {
            parsed.cols = n;
          }
          break;
        }
        case "fs": {
          if (!parsed.matrixColSettings) parsed.matrixColSettings = [];
          const n = parseInt(val, 10);
          if (isNaN(n)) {
            addError(errors, "FS_INVALID", `<fs> の値が数値ではありません: "${val}"`, "fs");
          } else {
            parsed.matrixColSettings.push({ type: "free_short", freeSize: n });
          }
          break;
        }
        case "bf": parsed.beforeText = val; break;
        case "af": parsed.afterText  = val; break;
        default:
          addWarning(
            warnings,
            "UNKNOWN_TAG",
            `未知のタグ: <${content}>`,
            key
          );
      }
      continue;
    }

    // ----------------------------------------------------------------
    // 9. Boolean タグ
    // ----------------------------------------------------------------
    switch (content.toLowerCase()) {
      case "norep": parsed.noRepeat      = true; break;
      case "fix":   parsed.fixedChoice   = true; break;
      case "br":    parsed.lineBreak     = true; break;
      case "must":  parsed.mustInput     = true; break;
      case "ex":    parsed.exampleInput  = true; break;
      case "al":    parsed.alphaNumericOnly = true; break;
      case "sa": {
        if (!parsed.matrixColSettings) parsed.matrixColSettings = [];
        parsed.matrixColSettings.push({ type: "sa" });
        break;
      }
      case "ma": {
        if (!parsed.matrixColSettings) parsed.matrixColSettings = [];
        parsed.matrixColSettings.push({ type: "ma" });
        break;
      }
      default:
        addWarning(
          warnings,
          "UNKNOWN_TAG",
          `未知のタグ: <${content}>`,
          content
        );
    }
  }

  return {
    parsed,
    errors,
    warnings,
    rawGenerated: generateTagsFromParsed(parsed),
  };
}

// ------------------------------------------------------------------
// generateTagsFromParsed: canonical JSON → raw タグ文字列
// ------------------------------------------------------------------

/**
 * DisplayTagsParsed から raw タグ文字列を再生成する。
 * 「フォーム入力 → canonical JSON → raw 生成」の最終ステップ。
 */
export function generateTagsFromParsed(parsed: DisplayTagsParsed): string {
  const tags: string[] = [];

  if (parsed.inputSize !== undefined)   tags.push(`<size=${parsed.inputSize}>`);
  if (parsed.noRepeat)                  tags.push(`<norep>`);
  if (parsed.fixedChoice)               tags.push(`<fix>`);
  if (parsed.lineBreak)                 tags.push(`<br>`);
  if (parsed.mustInput)                 tags.push(`<must>`);
  if (parsed.exampleInput)              tags.push(`<ex>`);

  if (parsed.numericOnly) {
    tags.push(
      parsed.numericDecimalPlaces !== undefined
        ? `<n,${parsed.numericDecimalPlaces}>`
        : `<n>`
    );
  }
  if (parsed.alphaNumericOnly)          tags.push(`<al>`);
  if (parsed.lengthRule) {
    tags.push(`<len=${parsed.lengthRule.operator}${parsed.lengthRule.value}>`);
  }
  if (parsed.minValue !== undefined)    tags.push(`<min=${parsed.minValue}>`);
  if (parsed.maxValue !== undefined)    tags.push(`<max=${parsed.maxValue}>`);
  if (parsed.inputCode !== undefined)   tags.push(`<code=${parsed.inputCode}>`);

  if (parsed.inputType) {
    if (parsed.inputType.year)  tags.push(`<type(year)>`);
    if (parsed.inputType.jyear) tags.push(`<type(jyear)>`);
    if (parsed.inputType.month) tags.push(`<type(month)>`);
    if (parsed.inputType.day)   tags.push(`<type(day)>`);
  }

  if (parsed.rows !== undefined)        tags.push(`<rows=${parsed.rows}>`);
  if (parsed.cols !== undefined)        tags.push(`<cols=${parsed.cols}>`);

  if (parsed.image) {
    tags.push(
      parsed.image.textPosition
        ? `<img=${parsed.image.file} textPosition=${parsed.image.textPosition}>`
        : `<img=${parsed.image.file}>`
    );
  }

  if (parsed.matrixColSettings) {
    for (const col of parsed.matrixColSettings) {
      switch (col.type) {
        case "sa": tags.push(`<sa>`); break;
        case "ma": tags.push(`<ma>`); break;
        case "free_short":
          if (col.freeSize !== undefined) tags.push(`<fs=${col.freeSize}>`);
          break;
        case "free_long":
          if (col.freeCols !== undefined && col.freeRows !== undefined) {
            tags.push(`<fl=${col.freeCols},${col.freeRows}>`);
          }
          break;
      }
    }
  }

  if (parsed.beforeText) tags.push(`<bf=${parsed.beforeText}>`);
  if (parsed.afterText)  tags.push(`<af=${parsed.afterText}>`);

  if (parsed.pipingConditions) {
    for (const p of parsed.pipingConditions) {
      tags.push(`<pipe ${p.expression}>`);
    }
  }

  if (parsed.answerInsertions) {
    for (const a of parsed.answerInsertions) {
      tags.push(`<ans ${a.source}>`);
    }
  }

  if (parsed.disableRules) {
    for (const d of parsed.disableRules) {
      tags.push(`<disable ${d.targetChoice} ${d.condition}>`);
    }
  }

  return tags.join(" ");
}
