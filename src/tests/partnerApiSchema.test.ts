/**
 * パートナーAPI のリクエストスキーマ（400 判定）のテスト。
 *
 * HTTP は立てず、partnerRoutes が使っている zod スキーマそのものを直接検証する。
 * env は import 前にここで注入する（実 DB / 実キーには一切触らない）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// env は import 前に注入する必要があるため、routes は動的 import で読み込む
// （静的 import は巻き上げられて、この代入より先に env が確定してしまう）。
process.env.PARTNER_IMAGE_URL_ALLOWED_HOSTS = "portal.example.com,portal-staging.example.com";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.LINE_CHANNEL_SECRET ??= "test-secret";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ??= "00000000-0000-4000-8000-000000000000";
process.env.ADMIN_BASIC_USER ??= "admin";
process.env.ADMIN_BASIC_PASSWORD ??= "admin";

const routes = require("../routes/partnerRoutes") as typeof import("../routes/partnerRoutes");
const questionSchema = routes.partnerQuestionSchemaForTest;
const toQuestionInput = routes.partnerToQuestionInputForTest;

const OK_URL = "https://portal.example.com/api/public/question-images/abc";
const OK_URL_2 = "https://portal-staging.example.com/api/public/question-images/def";

function baseQuestion(overrides: Record<string, unknown> = {}) {
  return {
    question_text: "本日の満足度を教えてください。",
    question_type: "single_choice",
    answer_options: [
      { value: "1", label: "満足" },
      { value: "2", label: "不満" }
    ],
    sort_order: 1,
    is_required: true,
    ...overrides
  };
}

// ------------------------------------------------------------------
// 後方互換（回帰なし）
// ------------------------------------------------------------------

test("画像フィールドを送らない従来形式はそのまま通る（POST / PUT 共通）", () => {
  const parsed = questionSchema.safeParse(baseQuestion());
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  // 送っていないので undefined。サービス層へは null で渡る＝画像なし。
  assert.equal(parsed.data.question_text_image, undefined);
  assert.equal(toQuestionInput(parsed.data).question_text_image, null);
});

test("free_text も従来どおり（選択肢なしで通る）", () => {
  const parsed = questionSchema.safeParse(
    baseQuestion({ question_type: "free_text", answer_options: null })
  );
  assert.equal(parsed.success, true);
});

test("question_text_image: null / 省略はどちらも許容（必須にしない）", () => {
  assert.equal(questionSchema.safeParse(baseQuestion({ question_text_image: null })).success, true);
  assert.equal(questionSchema.safeParse(baseQuestion()).success, true);
});

test("既存の 400 判定は変わっていない（選択肢の検証が生きている）", () => {
  // 選択肢が1件しかない
  assert.equal(
    questionSchema.safeParse(baseQuestion({ answer_options: [{ value: "1", label: "A" }] })).success,
    false
  );
  // free_text に選択肢が付いている
  assert.equal(
    questionSchema.safeParse(baseQuestion({ question_type: "free_text" })).success,
    false
  );
  // value が重複
  assert.equal(
    questionSchema.safeParse(
      baseQuestion({
        answer_options: [
          { value: "1", label: "A" },
          { value: "1", label: "B" }
        ]
      })
    ).success,
    false
  );
});

// ------------------------------------------------------------------
// 画像フィールド
// ------------------------------------------------------------------

test("許可ホストの https 画像は通り、サービス層の入力へ落ちる", () => {
  const parsed = questionSchema.safeParse(
    baseQuestion({
      question_text_image: {
        main_url: OK_URL,
        additional_urls: [OK_URL_2],
        caption: "店内の様子"
      }
    })
  );
  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  assert.deepEqual(toQuestionInput(parsed.data).question_text_image, {
    main_url: OK_URL,
    additional_urls: [OK_URL_2],
    caption: "店内の様子"
  });
});

test("4種すべてで画像を受け付ける（タイプは増やしていない）", () => {
  const cases = [
    baseQuestion({ question_type: "single_choice" }),
    baseQuestion({ question_type: "multi_choice" }),
    baseQuestion({ question_type: "scale" }),
    baseQuestion({ question_type: "free_text", answer_options: null })
  ];
  for (const body of cases) {
    const parsed = questionSchema.safeParse({
      ...body,
      question_text_image: { main_url: OK_URL, additional_urls: [], caption: null }
    });
    assert.equal(parsed.success, true, `${body.question_type} が通らない`);
  }
});

test("許可外ホストの URL は 400", () => {
  const parsed = questionSchema.safeParse(
    baseQuestion({
      question_text_image: { main_url: "https://evil.example.com/a.png", additional_urls: [] }
    })
  );
  assert.equal(parsed.success, false);
  if (parsed.success) {
    return;
  }
  assert.equal(parsed.error.issues[0]?.path.join("."), "question_text_image");
});

test("additional_urls の1件でも許可外なら 400", () => {
  const parsed = questionSchema.safeParse(
    baseQuestion({
      question_text_image: {
        main_url: OK_URL,
        additional_urls: [OK_URL_2, "https://evil.example.com/a.png"]
      }
    })
  );
  assert.equal(parsed.success, false);
});

test("http:// は許可ホストでも 400", () => {
  const parsed = questionSchema.safeParse(
    baseQuestion({
      question_text_image: { main_url: "http://portal.example.com/a.png", additional_urls: [] }
    })
  );
  assert.equal(parsed.success, false);
});

test("URL 形式でない値は 400", () => {
  assert.equal(
    questionSchema.safeParse(
      baseQuestion({ question_text_image: { main_url: "not a url", additional_urls: [] } })
    ).success,
    false
  );
  assert.equal(
    questionSchema.safeParse(
      baseQuestion({
        question_text_image: { main_url: "javascript:alert(1)", additional_urls: [] }
      })
    ).success,
    false
  );
});

test("additional_urls は最大4件・caption は最大200文字", () => {
  assert.equal(
    questionSchema.safeParse(
      baseQuestion({
        question_text_image: { main_url: OK_URL, additional_urls: Array(5).fill(OK_URL) }
      })
    ).success,
    false
  );
  assert.equal(
    questionSchema.safeParse(
      baseQuestion({
        question_text_image: { main_url: OK_URL, additional_urls: [], caption: "あ".repeat(201) }
      })
    ).success,
    false
  );
  assert.equal(
    questionSchema.safeParse(
      baseQuestion({
        question_text_image: {
          main_url: OK_URL,
          additional_urls: Array(4).fill(OK_URL),
          caption: "あ".repeat(200)
        }
      })
    ).success,
    true
  );
});

test("caption だけ（画像URLなし）は通る", () => {
  const parsed = questionSchema.safeParse(
    baseQuestion({
      question_text_image: { main_url: null, additional_urls: [], caption: "説明だけ" }
    })
  );
  assert.equal(parsed.success, true);
});
