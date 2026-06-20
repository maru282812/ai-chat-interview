/**
 * createStandardPromptPackage.ts
 *
 * 「標準プロンプト」パッケージを DB に作成する。
 *
 * 背景:
 * - プロンプトパッケージ機能が入る前（main ブランチ最終コミット時点）の
 *   既定プロンプトが「標準プロンプト」。
 * - その本文は現在の BASE_PROMPT_TEMPLATES に {{placeholder}} 形式で
 *   文言そのままに移植済み（basePromptTemplates.ts 冒頭コメント／実コード照合済み）。
 * - 用途プリセット "standard" は全キーを BASE 本文そのままで実体化するため、
 *   これで作る Version 1 = main 時点の標準プロンプトの忠実なスナップショット。
 *
 * 管理画面の「新しいパッケージ（用途: 標準（汎用））」と同じ生成ロジック
 * （buildInitialTemplatesForPreset + promptPackageRepository）を再利用する。
 *
 * Usage:
 *   npx tsx scripts/createStandardPromptPackage.ts
 *   npx tsx scripts/createStandardPromptPackage.ts --no-publish   # 公開せず draft のまま
 */

import { promptPackageRepository } from "../src/repositories/promptPackageRepository";
import {
  buildInitialTemplatesForPreset,
  PROMPT_PRESETS,
} from "../src/prompts/basePromptTemplates";
import type { AIPromptPolicy } from "../src/types/domain";

const NAME = "標準プロンプト";
const DESCRIPTION =
  "プロンプトパッケージ導入前（main 最終コミット）の既定プロンプト。BASE標準セットをそのまま実体化したスナップショット。";
const BASE_SLUG = "standard-prompt";
const PRESET = "standard" as const;

function resolveUniqueSlug(base: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

async function main(): Promise<void> {
  const publish = !process.argv.includes("--no-publish");

  const existingSlugs = await promptPackageRepository.listSlugs();

  // 既に標準プロンプトパッケージがあれば二重作成しない
  if (existingSlugs.includes(BASE_SLUG)) {
    console.log(
      `slug "${BASE_SLUG}" は既に存在します。重複作成を避けるため中断しました。`,
    );
    return;
  }

  const slug = resolveUniqueSlug(BASE_SLUG, existingSlugs);
  const pkg = await promptPackageRepository.create({
    slug,
    name: NAME,
    description: DESCRIPTION,
    category: null,
  });
  console.log(`パッケージ作成: ${pkg.name} (id=${pkg.id}, slug=${pkg.slug})`);

  // Version 1 を用途プリセット "standard" で実体化（全キー = BASE 本文）
  const templatesJson = buildInitialTemplatesForPreset(PRESET);
  const presetPolicy: AIPromptPolicy = PROMPT_PRESETS[PRESET]?.policy ?? {};
  const policyJson = Object.keys(presetPolicy).length > 0 ? presetPolicy : null;

  const v1 = await promptPackageRepository.createVersion({
    package_id: pkg.id,
    policy_json: policyJson,
    templates_json: templatesJson,
    change_note: "標準テンプレート（BASE標準セット）から作成",
  });
  console.log(
    `Version ${v1.version_no} 作成 (id=${v1.id}, keys=${Object.keys(templatesJson).length})`,
  );

  if (publish) {
    await promptPackageRepository.publishVersion(v1.id);
    console.log(`Version ${v1.version_no} を公開しました。`);
  } else {
    console.log("--no-publish 指定のため draft のままにしました。");
  }

  console.log("完了。管理画面 → プロンプトパッケージ で確認できます。");
}

main().catch((err) => {
  console.error("失敗:", err);
  process.exit(1);
});
