/**
 * createBehaviorEvidencePromptPackage.ts
 *
 * 「行動証拠による顧客発見（P13）」パッケージを DB に作成する。
 *
 * 背景:
 * - P13 の需要検証インタビューでは、AI深掘りが普通の流儀（「たとえば？」「なぜ？」）で
 *   掘ると型が崩れる。例示を出した瞬間、回答者はそれに乗って答え、
 *   得られるのは行動の証拠ではなく「AIの仮説の追認」になるため。
 * - そこで非誘導プリセット（例示の排除）を土台に、P13 の深掘り流儀を重ねた
 *   合成プリセット "behavior_evidence" を用意した。
 *     - 一般論・願望が返ってきたら直近の1回に引き戻す
 *     - 具体は軸を名指しで取りに行く（時期／関係者／時間／金額／その後）
 *     - 数値をこちらから提示して確認させない（記憶の捏造を招く）
 *     - 「覚えていない」は受け入れて次へ進む
 * - 上書き対象は非誘導・若年層と同じ「回答者に見える文面を出す10キー」のみ。
 *   残りは BASE のまま＝標準と同一。
 *
 * 管理画面の「新規パッケージ（用途: 行動証拠による顧客発見（P13））」と
 * 同じ生成ロジック（buildInitialTemplatesForPreset + promptPackageRepository）を再利用する。
 *
 * Usage:
 *   npx tsx scripts/createBehaviorEvidencePromptPackage.ts
 *   npx tsx scripts/createBehaviorEvidencePromptPackage.ts --no-publish   # 公開せず draft のまま
 */

import { promptPackageRepository } from "../src/repositories/promptPackageRepository";
import {
  BEHAVIOR_EVIDENCE_OVERRIDE_KEYS,
  buildInitialTemplatesForPreset,
  PROMPT_PRESETS,
} from "../src/prompts/basePromptTemplates";
import type { AIPromptPolicy } from "../src/types/domain";

const NAME = "行動証拠による顧客発見（P13）";
const DESCRIPTION =
  "需要検証インタビュー向け。意見・要望ではなく直近に実際にやったことを聞く。一般論・願望が返ったら直近の1回に引き戻し、時期・関係者・時間・金額の具体を名指しで取りに行く。回答例は出さず（非誘導）、数値をこちらから提示して確認させない。";
const BASE_SLUG = "behavior-evidence-prompt";
const PRESET = "behavior_evidence" as const;

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

  // 既に行動証拠パッケージがあれば二重作成しない
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
    change_note: `標準テンプレートから作成（用途: ${PROMPT_PRESETS[PRESET].label}／非誘導＋P13上書きの対象 ${BEHAVIOR_EVIDENCE_OVERRIDE_KEYS.length} キー）`,
  });
  console.log(
    `Version ${v1.version_no} 作成 (id=${v1.id}, keys=${Object.keys(templatesJson).length}, 上書き=${BEHAVIOR_EVIDENCE_OVERRIDE_KEYS.length})`,
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
