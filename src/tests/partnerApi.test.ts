import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGE_OPTIONS,
  AGE_VALUES,
  DEMOGRAPHIC_AGE_CODE,
  DEMOGRAPHIC_GENDER_CODE,
  GENDER_OPTIONS,
  GENDER_VALUES,
  RESERVED_QUESTION_CODES,
  demographicAnswerToken,
  isDemographicQuestion,
  normalizeDemographicValue,
  summarizeDemographics
} from "../lib/partnerDemographics";
import { PARTNER_PACKAGES, findPartnerPackage } from "../lib/partnerPackages";
import {
  PARTNER_QUESTION_TYPES,
  type PartnerQuestionTextImage,
  buildPartnerQuestionConfig,
  collectDisallowedImageUrls,
  isAllowedImageUrl,
  parseImageUrlAllowedHosts,
  partnerTypeRequiresOptions,
  toInternalQuestionType,
  toPartnerQuestionTextImage,
  toPartnerQuestionType
} from "../lib/partnerQuestions";
import type { Question } from "../types/domain";

/**
 * パートナーAPI（docs/partner-api.md）の純関数テスト。
 * DB / HTTP には触らない（既存テストと同じくローカルで実行できる範囲に閉じる）。
 */

function question(overrides: Partial<Question>): Question {
  return {
    id: "qid",
    project_id: "pid",
    question_code: "pq1",
    question_text: "Q",
    comment_top: null,
    comment_bottom: null,
    question_role: "main",
    question_type: "single_choice",
    is_required: true,
    sort_order: 10,
    answer_output_type: null,
    display_tags_raw: null,
    display_tags_parsed: null,
    visibility_conditions: null,
    page_group_id: null,
    branch_rule: null,
    question_config: null,
    ai_probe_enabled: false,
    probe_guideline: null,
    max_probe_count: null,
    render_strategy: "static",
    answer_options_locked: false,
    is_screening_question: false,
    is_system: false,
    is_hidden: false,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}

// ------------------------------------------------------------------
// 性年代の固定定義
// ------------------------------------------------------------------

test("性別は3値・年代は6区分で固定されている", () => {
  assert.deepEqual(GENDER_OPTIONS.map((o) => o.label), ["女性", "男性", "未回答"]);
  assert.deepEqual(
    AGE_OPTIONS.map((o) => o.label),
    ["20代未満", "20代", "30代", "40代", "50代", "60代以上"]
  );
  assert.equal(GENDER_VALUES.length, 3);
  assert.equal(AGE_VALUES.length, 6);
});

test("性年代設問のコードは予約されており、パートナー設問と識別できる", () => {
  assert.deepEqual([...RESERVED_QUESTION_CODES], [DEMOGRAPHIC_GENDER_CODE, DEMOGRAPHIC_AGE_CODE]);
  assert.equal(isDemographicQuestion(question({ question_code: DEMOGRAPHIC_GENDER_CODE })), true);
  assert.equal(isDemographicQuestion(question({ question_code: DEMOGRAPHIC_AGE_CODE })), true);
  assert.equal(isDemographicQuestion(question({ question_code: "pq1" })), false);
});

// ------------------------------------------------------------------
// 値の正規化
// ------------------------------------------------------------------

test("normalizeDemographicValue: value でも label でも拾える。未知値は null", () => {
  assert.equal(normalizeDemographicValue("female", GENDER_OPTIONS), "female");
  assert.equal(normalizeDemographicValue("女性", GENDER_OPTIONS), "female");
  assert.equal(normalizeDemographicValue("  30s  ", AGE_OPTIONS), "30s");
  assert.equal(normalizeDemographicValue("30代", AGE_OPTIONS), "30s");
  assert.equal(normalizeDemographicValue("unknown", GENDER_OPTIONS), null);
  assert.equal(normalizeDemographicValue("", GENDER_OPTIONS), null);
  assert.equal(normalizeDemographicValue(null, GENDER_OPTIONS), null);
});

test("demographicAnswerToken: normalized_answer.value を優先し、無ければ answer_text", () => {
  assert.equal(
    demographicAnswerToken({ answer_text: "女性", normalized_answer: { value: "female" } }),
    "female"
  );
  assert.equal(
    demographicAnswerToken({ answer_text: "女性", normalized_answer: { label: "女性" } }),
    "女性"
  );
  assert.equal(demographicAnswerToken({ answer_text: "male", normalized_answer: null }), "male");
  assert.equal(demographicAnswerToken({ answer_text: "  male  ", normalized_answer: {} }), "male");
});

// ------------------------------------------------------------------
// 集計
// ------------------------------------------------------------------

test("summarizeDemographics: 0件でも全キーを 0 埋めで返す", () => {
  const summary = summarizeDemographics([]);
  assert.deepEqual(Object.keys(summary.gender).sort(), [...GENDER_VALUES].sort());
  assert.deepEqual(Object.keys(summary.age).sort(), [...AGE_VALUES].sort());
  assert.equal(summary.cross.length, GENDER_VALUES.length * AGE_VALUES.length);
  assert.equal(
    summary.cross.every((cell) => cell.count === 0),
    true
  );
});

test("summarizeDemographics: 性別・年代・クロスを正しく数える", () => {
  const summary = summarizeDemographics([
    { genderRaw: "female", ageRaw: "30s" },
    { genderRaw: "女性", ageRaw: "30代" },
    { genderRaw: "male", ageRaw: "40s" },
    { genderRaw: "no_answer", ageRaw: "under20" }
  ]);

  assert.equal(summary.gender.female, 2);
  assert.equal(summary.gender.male, 1);
  assert.equal(summary.gender.no_answer, 1);
  assert.equal(summary.age["30s"], 2);
  assert.equal(summary.age["40s"], 1);
  assert.equal(summary.age.under20, 1);

  const findCell = (gender: string, age: string) =>
    summary.cross.find((cell) => cell.gender === gender && cell.age === age)?.count;
  assert.equal(findCell("female", "30s"), 2);
  assert.equal(findCell("male", "40s"), 1);
  assert.equal(findCell("no_answer", "under20"), 1);
  assert.equal(findCell("female", "40s"), 0);

  // クロスの合計は、両軸とも判明している回答者数と一致する
  assert.equal(
    summary.cross.reduce((sum, cell) => sum + cell.count, 0),
    4
  );
});

test("summarizeDemographics: 片方だけ未回答なら、判明している軸だけ数えクロスには入れない", () => {
  const summary = summarizeDemographics([
    { genderRaw: "female", ageRaw: null },
    { genderRaw: null, ageRaw: "20s" },
    { genderRaw: "garbage", ageRaw: "garbage" }
  ]);

  assert.equal(summary.gender.female, 1);
  assert.equal(summary.age["20s"], 1);
  assert.equal(
    summary.cross.reduce((sum, cell) => sum + cell.count, 0),
    0
  );
});

// ------------------------------------------------------------------
// 設問タイプの写像
// ------------------------------------------------------------------

test("パートナー設問タイプは4種のみ", () => {
  assert.deepEqual(
    [...PARTNER_QUESTION_TYPES],
    ["single_choice", "multi_choice", "free_text", "scale"]
  );
});

test("toInternalQuestionType: 4種が既存の内部型へ写像される", () => {
  assert.equal(toInternalQuestionType("single_choice"), "single_choice");
  assert.equal(toInternalQuestionType("multi_choice"), "multi_choice");
  assert.equal(toInternalQuestionType("free_text"), "free_text_long");
  // scale は「順序尺度として描画する single_choice」として保存する
  assert.equal(toInternalQuestionType("scale"), "single_choice");
});

test("toPartnerQuestionType: 内部設問からパートナー種別へ戻せる。scale は presentation で判別", () => {
  assert.equal(toPartnerQuestionType(question({ question_type: "single_choice" })), "single_choice");
  assert.equal(toPartnerQuestionType(question({ question_type: "multi_choice" })), "multi_choice");
  assert.equal(toPartnerQuestionType(question({ question_type: "free_text_long" })), "free_text");
  assert.equal(
    toPartnerQuestionType(
      question({ question_type: "single_choice", question_config: { presentation: { scale: true } } })
    ),
    "scale"
  );
  // パートナーが表現できない種別は null（レスポンスから落とす）
  assert.equal(toPartnerQuestionType(question({ question_type: "matrix_single" })), null);
  assert.equal(toPartnerQuestionType(question({ question_type: "image_upload" })), null);
});

test("scale の往復変換で種別が保存される", () => {
  const config = buildPartnerQuestionConfig("scale", [
    { value: "1", label: "低" },
    { value: "5", label: "高" }
  ]);
  const stored = question({ question_type: toInternalQuestionType("scale"), question_config: config });
  assert.equal(toPartnerQuestionType(stored), "scale");
  assert.equal(stored.question_config?.options?.length, 2);
});

test("partnerTypeRequiresOptions: free_text 以外は選択肢が必要", () => {
  assert.equal(partnerTypeRequiresOptions("single_choice"), true);
  assert.equal(partnerTypeRequiresOptions("multi_choice"), true);
  assert.equal(partnerTypeRequiresOptions("scale"), true);
  assert.equal(partnerTypeRequiresOptions("free_text"), false);
});

test("buildPartnerQuestionConfig: free_text は選択肢も presentation も付けない", () => {
  const config = buildPartnerQuestionConfig("free_text", null);
  assert.equal(config?.options, undefined);
  assert.equal(config?.presentation, undefined);
});

// ------------------------------------------------------------------
// 設問文画像（Phase 4）
//
// 「設問タイプは4種のまま。4種すべてに画像を添えられる」が方針。
// text_with_image のような新しい question_type は作らない。
// ------------------------------------------------------------------

const ALLOWED_HOSTS = ["portal.example.com", "portal-staging.example.com"];

const SAMPLE_IMAGE: PartnerQuestionTextImage = {
  main_url: "https://portal.example.com/api/public/question-images/abc",
  additional_urls: ["https://portal.example.com/api/public/question-images/def"],
  caption: "店内の様子"
};

test("画像を渡さないと question_text_image は付かない（従来形式が完全に従来通り）", () => {
  for (const type of PARTNER_QUESTION_TYPES) {
    const options = partnerTypeRequiresOptions(type)
      ? [
          { value: "1", label: "A" },
          { value: "2", label: "B" }
        ]
      : null;
    // 第3引数を省略した既存の呼び出し形
    const omitted = buildPartnerQuestionConfig(type, options);
    assert.equal(omitted?.question_text_image, undefined, `${type}: 省略時に画像が付いている`);
    // 明示的に null を渡した場合も同じ
    const explicitNull = buildPartnerQuestionConfig(type, options, null);
    assert.equal(explicitNull?.question_text_image, undefined, `${type}: null で画像が付いている`);
    assert.deepEqual(explicitNull, omitted, `${type}: 省略と null で結果が違う`);
  }
});

test("性年代の固定2問には画像が付かない（第3引数なしで呼ばれる）", () => {
  // ensureDemographicQuestions と同じ呼び出し形
  const config = buildPartnerQuestionConfig("single_choice", [...GENDER_OPTIONS]);
  assert.equal(config?.question_text_image, undefined);
  assert.equal(config?.options?.length, GENDER_OPTIONS.length);
});

test("画像を渡すと question_config.question_text_image に camelCase で入る", () => {
  const config = buildPartnerQuestionConfig("free_text", null, SAMPLE_IMAGE);
  assert.deepEqual(config?.question_text_image, {
    mainUrl: "https://portal.example.com/api/public/question-images/abc",
    additionalUrls: ["https://portal.example.com/api/public/question-images/def"],
    caption: "店内の様子"
  });
});

test("4種すべてに画像を添えられる（scale は presentation と共存する）", () => {
  for (const type of PARTNER_QUESTION_TYPES) {
    const options = partnerTypeRequiresOptions(type)
      ? [
          { value: "1", label: "A" },
          { value: "2", label: "B" }
        ]
      : null;
    const config = buildPartnerQuestionConfig(type, options, SAMPLE_IMAGE);
    assert.equal(
      config?.question_text_image?.mainUrl,
      SAMPLE_IMAGE.main_url,
      `${type}: 画像が入っていない`
    );
    // 種別は写像されたまま。新しい question_type は増えていない。
    const stored = question({
      question_type: toInternalQuestionType(type),
      question_config: config
    });
    assert.equal(toPartnerQuestionType(stored), type, `${type}: 画像で種別が変わっている`);
  }
});

test("GET のレスポンス変換: camelCase → snake_case。無ければ null", () => {
  const config = buildPartnerQuestionConfig("single_choice", null, SAMPLE_IMAGE);
  assert.deepEqual(toPartnerQuestionTextImage(config?.question_text_image), SAMPLE_IMAGE);
  // 画像が無い設問は null（キー欠損ではない）
  assert.equal(toPartnerQuestionTextImage(undefined), null);
  assert.equal(toPartnerQuestionTextImage(null), null);
});

test("画像の往復変換で値が失われない", () => {
  const config = buildPartnerQuestionConfig("multi_choice", null, SAMPLE_IMAGE);
  const roundTripped = toPartnerQuestionTextImage(config?.question_text_image);
  const again = buildPartnerQuestionConfig("multi_choice", null, roundTripped);
  assert.deepEqual(again?.question_text_image, config?.question_text_image);
});

test("PUT で画像を送らないと画像が消える（全置換の仕様どおり）", () => {
  // 1回目: 画像つきで保存
  const withImage = buildPartnerQuestionConfig("single_choice", null, SAMPLE_IMAGE);
  assert.ok(withImage?.question_text_image);

  // 2回目（PUT）: 同じ設問を画像なしで送る。question_config はゼロから組み直されるので
  // 直前の画像は引き継がれない。
  const replaced = buildPartnerQuestionConfig("single_choice", null);
  assert.equal(replaced?.question_text_image, undefined);
  assert.equal(toPartnerQuestionTextImage(replaced?.question_text_image), null);
  // → ポータル側は PUT を組み立てるたびにサーバー側で画像を合成し直す必要がある（Phase 5）。
});

// --- URL のホスト検証 ---

test("parseImageUrlAllowedHosts: カンマ区切り・空白・大文字を正規化する", () => {
  assert.deepEqual(parseImageUrlAllowedHosts(" A.example.com , b.example.com "), [
    "a.example.com",
    "b.example.com"
  ]);
  assert.deepEqual(parseImageUrlAllowedHosts("a.example.com,,"), ["a.example.com"]);
  assert.deepEqual(parseImageUrlAllowedHosts(""), []);
  assert.deepEqual(parseImageUrlAllowedHosts(undefined), []);
});

test("許可リストが空（env 未設定）なら画像URLは一切通らない（fail-closed）", () => {
  assert.equal(isAllowedImageUrl("https://portal.example.com/x.png", []), false);
  assert.deepEqual(collectDisallowedImageUrls(SAMPLE_IMAGE, []), [
    SAMPLE_IMAGE.main_url,
    ...SAMPLE_IMAGE.additional_urls
  ]);
});

test("許可ホストの https URL だけが通る", () => {
  assert.equal(isAllowedImageUrl("https://portal.example.com/a.png", ALLOWED_HOSTS), true);
  assert.equal(isAllowedImageUrl("https://PORTAL.example.com/a.png", ALLOWED_HOSTS), true);
  assert.equal(isAllowedImageUrl("https://portal-staging.example.com/a.png", ALLOWED_HOSTS), true);
});

test("許可外ホストの URL は拒否（400 になる）", () => {
  assert.equal(isAllowedImageUrl("https://evil.example.com/a.png", ALLOWED_HOSTS), false);
  // サブドメインは自動で許可しない（完全一致のみ）
  assert.equal(isAllowedImageUrl("https://evil.portal.example.com/a.png", ALLOWED_HOSTS), false);
  // ホスト名の後方一致でごまかせない
  assert.equal(isAllowedImageUrl("https://notportal.example.com/a.png", ALLOWED_HOSTS), false);
});

test("http:// は許可ホストでも拒否（400 になる）", () => {
  assert.equal(isAllowedImageUrl("http://portal.example.com/a.png", ALLOWED_HOSTS), false);
});

test("https 以外のスキーム・壊れたURLは拒否", () => {
  assert.equal(isAllowedImageUrl("data:image/png;base64,AAAA", ALLOWED_HOSTS), false);
  assert.equal(isAllowedImageUrl("javascript:alert(1)", ALLOWED_HOSTS), false);
  assert.equal(isAllowedImageUrl("not a url", ALLOWED_HOSTS), false);
  assert.equal(isAllowedImageUrl("", ALLOWED_HOSTS), false);
});

test("collectDisallowedImageUrls: additional_urls の1件でも許可外なら弾く", () => {
  assert.deepEqual(collectDisallowedImageUrls(null, ALLOWED_HOSTS), []);
  assert.deepEqual(collectDisallowedImageUrls(SAMPLE_IMAGE, ALLOWED_HOSTS), []);
  assert.deepEqual(
    collectDisallowedImageUrls(
      { main_url: null, additional_urls: [], caption: "文字だけ" },
      ALLOWED_HOSTS
    ),
    []
  );
  assert.deepEqual(
    collectDisallowedImageUrls(
      {
        main_url: "https://portal.example.com/ok.png",
        additional_urls: ["https://evil.example.com/ng.png"]
      },
      ALLOWED_HOSTS
    ),
    ["https://evil.example.com/ng.png"]
  );
  assert.deepEqual(
    collectDisallowedImageUrls(
      { main_url: "http://portal.example.com/ng.png", additional_urls: [] },
      ALLOWED_HOSTS
    ),
    ["http://portal.example.com/ng.png"]
  );
});

// ------------------------------------------------------------------
// パッケージマスタ
// ------------------------------------------------------------------

test("パッケージ: id は一意で、設問は4種のみ・選択肢の整合が取れている", () => {
  const ids = PARTNER_PACKAGES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "package id が重複している");

  for (const pkg of PARTNER_PACKAGES) {
    assert.ok(pkg.ticket_cost >= 1, `${pkg.id}: ticket_cost は1以上`);
    assert.ok(pkg.questions.length > 0, `${pkg.id}: 設問が空`);
    const orders = pkg.questions.map((q) => q.sort_order);
    assert.equal(new Set(orders).size, orders.length, `${pkg.id}: sort_order が重複している`);

    for (const q of pkg.questions) {
      assert.ok(
        PARTNER_QUESTION_TYPES.includes(q.question_type),
        `${pkg.id}: 未知の question_type ${q.question_type}`
      );
      if (partnerTypeRequiresOptions(q.question_type)) {
        assert.ok(
          (q.answer_options?.length ?? 0) >= 2,
          `${pkg.id}: ${q.question_type} は選択肢が2つ以上必要`
        );
      } else {
        assert.equal(q.answer_options, null, `${pkg.id}: free_text に選択肢が付いている`);
      }
    }
  }
});

test("findPartnerPackage: 既知IDは引けて、未知IDは null", () => {
  assert.equal(findPartnerPackage("general_basic")?.id, "general_basic");
  assert.equal(findPartnerPackage("no_such_package"), null);
});
