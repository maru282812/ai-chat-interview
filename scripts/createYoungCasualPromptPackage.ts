/**
 * createYoungCasualPromptPackage.ts
 *
 * 「若年層向け（カジュアル・非誘導）」パッケージを DB に作成する。
 *
 * 背景:
 * - 若年層モニターは (1) 提示された語にそのまま乗りやすい (2) 硬い文面・長文・
 *   しつこい深掘りで離脱しやすい、という2つの弱点を同時に持つ。
 * - そこで非誘導プリセット（例示の排除）を土台に、トーン・離脱対策を重ねた
 *   合成プリセット "young_casual" を用意した。
 *     - です・ます調は維持（AIが崩すと滑るため）
 *     - 絵文字は完全禁止
 *     - 1メッセージ1問・60文字程度
 *     - 辞退回答の再確認は1回まで／同一論点の再深掘りはしない
 * - 上書き対象は非誘導と同じ「回答者に見える文面を出す10キー」のみ。
 *   残りは BASE のまま＝標準と同一。
 *
 * 管理画面の「新規パッケージ（用途: 若年層向け（カジュアル・非誘導））」と
 * 同じ生成ロジック（buildInitialTemplatesForPreset + promptPackageRepository）を再利用する。
 *
 * Usage:
 *   npx tsx scripts/createYoungCasualPromptPackage.ts
 *   npx tsx scripts/createYoungCasualPromptPackage.ts --no-publish   # 公開せず draft のまま
 */

import { promptPackageRepository } from "../src/repositories/promptPackageRepository";
import {
  buildInitialTemplatesForPreset,
  PROMPT_PRESETS,
  YOUNG_CASUAL_OVERRIDE_KEYS,
} from "../src/prompts/basePromptTemplates";
import type { AIPromptPolicy } from "../src/types/domain";

const NAME = "若年層向けプロンプト（カジュアル・非誘導）";
const DESCRIPTION =
  "若年層モニター向け。です・ます調を保ったまま硬さを取り、1問を短くする。回答例は出さず（非誘導）、辞退回答の再確認は1回まで・同一論点の再深掘りはしないことで離脱を防ぐ。絵文字・若者言葉はAI側では使わない。";
const BASE_SLUG = "young-casual-prompt";
const PRESET = "young_casual" as const;

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

  // 既に若年層パッケージがあれば二重作成しない
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
    change_note: `標準テンプレートから作成（用途: ${PROMPT_PRESETS[PRESET].label}／非誘導＋トーン上書きの対象 ${YOUNG_CASUAL_OVERRIDE_KEYS.length} キー）`,
  });
  console.log(
    `Version ${v1.version_no} 作成 (id=${v1.id}, keys=${Object.keys(templatesJson).length}, 上書き=${YOUNG_CASUAL_OVERRIDE_KEYS.length})`,
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
