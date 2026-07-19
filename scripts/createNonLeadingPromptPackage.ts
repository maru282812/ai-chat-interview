/**
 * createNonLeadingPromptPackage.ts
 *
 * 「非誘導プロンプト（例示なし）」パッケージを DB に作成する。
 *
 * 背景:
 * - 標準プロンプト（standard-prompt）を原則としつつ、回答者に見える文面から
 *   回答例を排除したいケースがある。
 *     例）「あなたの興味あることを答えてください（金利、株、FX）」
 *       → 「あなたの興味あることを答えてください」
 * - 用途プリセット "non_leading" は BASE 本文の末尾に「例示の排除」ルールを
 *   追記した本文で全キーを実体化する（対象は回答者向け文面を出す10キーのみ。
 *   残りは BASE のまま＝標準と同一）。
 *
 * 管理画面の「新規パッケージ（用途: 非誘導（例示なし））」と同じ生成ロジック
 * （buildInitialTemplatesForPreset + promptPackageRepository）を再利用する。
 *
 * Usage:
 *   npx tsx scripts/createNonLeadingPromptPackage.ts
 *   npx tsx scripts/createNonLeadingPromptPackage.ts --no-publish   # 公開せず draft のまま
 */

import { promptPackageRepository } from "../src/repositories/promptPackageRepository";
import {
  buildInitialTemplatesForPreset,
  NON_LEADING_OVERRIDE_KEYS,
  PROMPT_PRESETS,
} from "../src/prompts/basePromptTemplates";
import type { AIPromptPolicy } from "../src/types/domain";

const NAME = "非誘導プロンプト（例示なし）";
const DESCRIPTION =
  "標準プロンプトが原則。回答者に見える設問文・深掘り文から回答例を排除し、回答者自身の言葉で答えてもらう。深掘りの強さ・トーンは標準と同じ。";
const BASE_SLUG = "non-leading-prompt";
const PRESET = "non_leading" as const;

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

  // 既に非誘導パッケージがあれば二重作成しない
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

  const templatesJson = buildInitialTemplatesForPreset(PRESET);
  const presetPolicy: AIPromptPolicy = PROMPT_PRESETS[PRESET]?.policy ?? {};
  const policyJson = Object.keys(presetPolicy).length > 0 ? presetPolicy : null;

  const v1 = await promptPackageRepository.createVersion({
    package_id: pkg.id,
    policy_json: policyJson,
    templates_json: templatesJson,
    change_note: `標準テンプレートから作成（用途: ${PROMPT_PRESETS[PRESET].label}／例示排除の対象 ${NON_LEADING_OVERRIDE_KEYS.length} キー）`,
  });
  console.log(
    `Version ${v1.version_no} 作成 (id=${v1.id}, keys=${Object.keys(templatesJson).length}, 非誘導上書き=${NON_LEADING_OVERRIDE_KEYS.length})`,
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
