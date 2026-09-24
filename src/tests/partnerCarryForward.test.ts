/**
 * partnerCarryForward.test.ts
 *
 * Partner API 経由の「選択肢の持ち越し（carry-forward）」。
 *
 * 背景:
 *   「今日、重視していることは？（いくつでも）」→「特に重視しているものは？（ひとつだけ）」
 *   のように、前問で選んだものだけを次問に出す設計が調査票側にある。
 *   ACI 内製テンプレ（yotto-salon-a）は display_tags_parsed.optionSource で実現していたが、
 *   Partner API には渡す口が無く、hibi 経由で作られた案件では全選択肢が出ていた。
 *
 * 参照は **sort_order**。question_code はサーバー採番（pq1, pq2…）で、
 * パートナー側は自分が送った sort_order でしか前問を指せないため。
 *
 * ここで守りたいこと:
 *   1. 後方互換（carry_forward を送らない既存リクエストが従来どおり通る）
 *   2. 壊れた参照は 400 で弾く（保存させて実機で気づく事態にしない）
 *   3. sort_order → question_code の解決が採番と一致する
 */

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PARTNER_IMAGE_URL_ALLOWED_HOSTS ??= "portal.example.com";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.LINE_CHANNEL_SECRET ??= "test-secret";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ??= "00000000-0000-4000-8000-000000000000";
process.env.ADMIN_PASSWORD_HASH ??= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ??= "test-admin-session-secret-000000000000";

const routes = require("../routes/partnerRoutes") as typeof import("../routes/partnerRoutes");
const listSchema = routes.partnerQuestionListSchemaForTest;
const toQuestionInput = routes.partnerToQuestionInputForTest;

const {
  buildCarryForwardTags,
  toPartnerCarryForward
} = require("../lib/partnerQuestions") as typeof import("../lib/partnerQuestions");

const ASPECTS = [
  { value: "finish", label: "仕上がり" },
  { value: "proposal", label: "自分に合った提案" },
  { value: "price", label: "価格への納得感" }
];

/** pq5「重視していること（いくつでも）」→ pq6「特に重視しているもの（ひとつだけ）」の最小形。 */
function pair(carryOverrides: Record<string, unknown> | null = { from_sort_order: 5 }) {
  return [
    {
      question_text: "今日、重視していることは何ですか？（いくつでも）",
      question_type: "multi_choice",
      answer_options: ASPECTS,
      sort_order: 5
    },
    {
      question_text: "今日、特に重視していることは何ですか？（ひとつだけ）",
      question_type: "single_choice",
      answer_options: ASPECTS,
      sort_order: 6,
      ...(carryOverrides ? { carry_forward: carryOverrides } : {})
    }
  ];
}

/** 失敗メッセージを取り出す（どの理由で落ちたかまで確認する）。 */
function errorOf(body: unknown): string {
  const parsed = listSchema.safeParse(body);
  assert.equal(parsed.success, false, "400 になるはずが通ってしまいました");
  return parsed.success ? "" : (parsed.error.issues[0]?.message ?? "");
}

// ------------------------------------------------------------------
// 後方互換
// ------------------------------------------------------------------

test("carry_forward を送らない既存リクエストはこれまでどおり通る", () => {
  const parsed = listSchema.safeParse(pair(null));
  assert.equal(parsed.success, true);
  // 省略時は null に正規化され、保存側で持ち越し無しとして扱われる。
  assert.equal(toQuestionInput(pair(null)[1] as never).carry_forward, null);
});

// ------------------------------------------------------------------
// 正常系
// ------------------------------------------------------------------

test("前問を sort_order で参照する指定が通る", () => {
  const parsed = listSchema.safeParse(pair());
  assert.equal(parsed.success, true);
  const input = toQuestionInput(pair()[1] as never);
  assert.deepEqual(input.carry_forward, { from_sort_order: 5 });
});

test("mode=unselected も指定できる", () => {
  const parsed = listSchema.safeParse(pair({ from_sort_order: 5, mode: "unselected" }));
  assert.equal(parsed.success, true);
});

test("mode 省略時は selected として内部表現に写る", () => {
  const tags = buildCarryForwardTags({ from_sort_order: 5 }, "pq5");
  assert.deepEqual(tags, { optionSource: { fromQuestion: "pq5", mode: "selected" } });
});

test("fromQuestion は小文字にそろえる（ctx.answers は小文字キーで引くため）", () => {
  const tags = buildCarryForwardTags({ from_sort_order: 5 }, "PQ5");
  assert.equal(tags?.optionSource?.fromQuestion, "pq5");
});

// ------------------------------------------------------------------
// 異常系: 壊れた参照は保存させない
// ------------------------------------------------------------------

test("存在しない sort_order を参照したら 400", () => {
  assert.match(errorOf(pair({ from_sort_order: 99 })), /does not match any question/);
});

test("自分自身を参照したら 400", () => {
  assert.match(errorOf(pair({ from_sort_order: 6 })), /must not reference itself/);
});

test("後ろの設問を参照したら 400（まだ回答されていない）", () => {
  const body = [
    {
      question_text: "特に重視しているものは？",
      question_type: "single_choice",
      answer_options: ASPECTS,
      sort_order: 5,
      carry_forward: { from_sort_order: 6 }
    },
    {
      question_text: "重視していることは？",
      question_type: "multi_choice",
      answer_options: ASPECTS,
      sort_order: 6
    }
  ];
  assert.match(errorOf(body), /must come before this question/);
});

test("free_text を参照したら 400（選んだ値が無い）", () => {
  const body = [
    {
      question_text: "ご意見をどうぞ",
      question_type: "free_text",
      answer_options: null,
      sort_order: 5
    },
    {
      question_text: "特に重視しているものは？",
      question_type: "single_choice",
      answer_options: ASPECTS,
      sort_order: 6,
      carry_forward: { from_sort_order: 5 }
    }
  ];
  assert.match(errorOf(body), /must be single_choice or multi_choice/);
});

test("value が一つも共有されていなければ 400（必ず0件になる）", () => {
  const body = [
    {
      question_text: "重視していることは？",
      question_type: "multi_choice",
      answer_options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" }
      ],
      sort_order: 5
    },
    {
      question_text: "特に重視しているものは？",
      question_type: "single_choice",
      answer_options: ASPECTS,
      sort_order: 6,
      carry_forward: { from_sort_order: 5 }
    }
  ];
  assert.match(errorOf(body), /values shared with the source question/);
});

test("sort_order が重複している設問は参照できない（一意に定まらない）", () => {
  const body = [
    { question_text: "A", question_type: "multi_choice", answer_options: ASPECTS, sort_order: 5 },
    { question_text: "B", question_type: "multi_choice", answer_options: ASPECTS, sort_order: 5 },
    {
      question_text: "特に重視しているものは？",
      question_type: "single_choice",
      answer_options: ASPECTS,
      sort_order: 6,
      carry_forward: { from_sort_order: 5 }
    }
  ];
  assert.match(errorOf(body), /ambiguous/);
});

// ------------------------------------------------------------------
// レスポンス（内部 question_code → sort_order へ逆引き）
// ------------------------------------------------------------------

test("GET では sort_order 参照に戻して返す", () => {
  const map = new Map([
    ["pq5", 14],
    ["pq6", 15]
  ]);
  const view = toPartnerCarryForward(
    { optionSource: { fromQuestion: "pq5", mode: "selected" } },
    map
  );
  assert.deepEqual(view, { from_sort_order: 14, mode: "selected" });
});

test("参照先が消えていれば null を返す（壊れた参照は返さない）", () => {
  const view = toPartnerCarryForward(
    { optionSource: { fromQuestion: "pq99", mode: "selected" } },
    new Map([["pq5", 14]])
  );
  assert.equal(view, null);
});

test("持ち越し設定が無ければ null", () => {
  assert.equal(toPartnerCarryForward(null, new Map()), null);
  assert.equal(toPartnerCarryForward({ disableRules: [] }, new Map()), null);
});

// ------------------------------------------------------------------
// 保存経路: sort_order → 採番後の question_code を正しく解決するか
//
// ここが本丸。zod を通っても、採番(pq1,pq2…)と参照解決がズレていれば
// 「存在しない設問を参照する持ち越し」が保存され、実機で選択肢が0件になる。
// リポジトリを差し替えて、実際に書き込まれるペイロードを見る。
// ------------------------------------------------------------------

const { partnerSurveyService } = require("../services/partnerSurveyService") as typeof import("../services/partnerSurveyService");
const { projectRepository } = require("../repositories/projectRepository") as typeof import("../repositories/projectRepository");
const { questionRepository } = require("../repositories/questionRepository") as typeof import("../repositories/questionRepository");

test("保存時に sort_order 参照が採番後の question_code へ解決される", async () => {
  const written: Record<string, unknown>[] = [];

  // entry_code の採番は DB の重複チェックを引くので黙らせる（持ち越しとは無関係）。
  projectRepository.findAnyByEntryCode = (async () =>
    null) as unknown as typeof projectRepository.findAnyByEntryCode;

  projectRepository.create = (async () => ({
    id: "proj-1",
    name: "t",
    status: "draft",
    entry_code: "p-test",
    client_name: "s",
    created_at: "",
    updated_at: ""
  })) as unknown as typeof projectRepository.create;

  questionRepository.listByProject = (async () => []) as unknown as typeof questionRepository.listByProject;
  questionRepository.getByProjectAndCode = (async () => null) as unknown as typeof questionRepository.getByProjectAndCode;
  questionRepository.create = (async (input: Record<string, unknown>) => {
    written.push(input);
    return { id: `id-${written.length}`, ...input };
  }) as unknown as typeof questionRepository.create;
  questionRepository.update = (async (_id: string, input: Record<string, unknown>) => {
    written.push(input);
    return { id: _id, ...input };
  }) as unknown as typeof questionRepository.update;

  await partnerSurveyService.createSurvey({
    partnerStoreId: "store-1",
    title: "美容室ABC",
    store: { name: "美容室ABC" },
    // sort_order は飛び飛び。採番は入力の昇順で pq1, pq2 になる。
    questions: [
      {
        question_text: "今日、重視していることは？（いくつでも）",
        question_type: "multi_choice",
        answer_options: ASPECTS,
        sort_order: 14
      },
      {
        question_text: "特に重視しているものは？（ひとつだけ）",
        question_type: "single_choice",
        answer_options: ASPECTS,
        sort_order: 15,
        carry_forward: { from_sort_order: 14 }
      }
    ]
  });

  const carried = written.find(
    (w) => typeof w.question_text === "string" && w.question_text.includes("特に重視")
  );
  assert.ok(carried, "持ち越し設問が書き込まれていません");
  assert.deepEqual(
    carried?.display_tags_parsed,
    { optionSource: { fromQuestion: "pq1", mode: "selected" } },
    "sort_order=14 は採番後の pq1 を指すこと（pq14 等ではない）"
  );

  const source = written.find(
    (w) => typeof w.question_text === "string" && w.question_text.includes("（いくつでも）")
  );
  assert.equal(source?.display_tags_parsed, null, "参照元には持ち越し設定を付けないこと");
});
