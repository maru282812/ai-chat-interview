/**
 * storeProvisioningService.ts
 *
 * 業種テンプレから「店舗一式」を一括生成する担当 (Migration 096)。
 *
 * 生成するもの（店舗1件につき）:
 *   - A/B/C の案件（テンプレ案件の複製・設問ごと）
 *   - 各案件の entry_code（`<slug>-a` / `-b` / `-c`）
 *   - サイクル定義（cycle_groups）とステップ（cycle_group_steps）
 *   - C→A の carry-forward 参照（店舗内で閉じる）
 *
 * なぜ案件を共有せず複製するのか:
 *   設問も謝礼も店舗ごとに変える要件があるため。案件を共有すると
 *   「この店舗だけ1問足す」ができない。複製の手作業をここで無くす。
 *
 * 冪等性:
 *   同じ店舗に対して2度呼ばれても案件は増えない（既存の store_id + role で判定）。
 *   途中で失敗した場合は作れたところまで残り、再実行で続きから作る。
 *   ⚠ トランザクションではない。Supabase の REST 経由のため複数テーブルを
 *     まとめてロールバックできない。よって「途中まで作られた状態」を
 *     正常系として扱い、再実行で収束させる設計にしている。
 */

import { logger } from "../lib/logger";
import { cycleGroupRepository } from "../repositories/cycleRepository";
import { projectRepository } from "../repositories/projectRepository";
import { industryTemplateRepository, storeRepository } from "../repositories/storeRepository";
import type { IndustryTemplate, Project, Store, TemplateStepRole } from "../types/domain";

export interface ProvisionResult {
  store: Store;
  projects: { role: TemplateStepRole; project: Project; entryCode: string }[];
  cycleGroupId: string | null;
  created: boolean;
}

/**
 * ポータル会員店舗の受け皿となる固定法人 (Migration 104)。
 * ポータル店舗は1店舗＝1事業者でチェーンを構成しないため、法人を店舗ごとに作ると
 * clients が店舗数ぶん増える。受け皿を1件に固定する。
 * ⚠ migration 104 の INSERT と同じ UUID。片方だけ変えると店舗が作れなくなる。
 */
export const PORTAL_CLIENT_ID = "c0000000-0000-4000-8000-000000000001";

/**
 * 店舗一式の生成オプション。すべて任意で、既定は従来の運営マスタ挙動そのまま。
 */
export interface ProvisionOptions {
  /**
   * 生成した案件の初期ステータス。
   * 既定 `published`＝運営の店舗マスタ画面からの生成（従来どおり作った瞬間から回る）。
   * ポータル注文は `draft`。公開はチケットを消費する QR 発行（publishSet）だけを入口にする
   * ＝ draft のまま渡せば storeEntryService が「公開中でない」で止めるので無料では回らない。
   */
  initialStatus?: "draft" | "published";
  /**
   * hibi-portal の店舗ID。指定すると stores.partner_store_id に保存し、
   * 生成する案件すべてに partner_store_id と partner_readonly=true を付ける。
   *
   * readonly にする理由: パートナー設問の編集（PUT /api/partner/surveys/:id）は
   * 設問を4種へ全置換するため、B のマトリクスや A-Q11 の分岐が壊れる。
   */
  partnerStoreId?: string | null;
  /** 参照した hibi パッケージID。A 案件の objective に `package:<id>` として残す。 */
  packageId?: string | null;
}

/** objective に埋めるパッケージ参照の接頭辞（partnerSurveyService と同じ表現）。 */
const PACKAGE_MARKER_PREFIX = "package:";

/** テンプレの3案件を役割順に並べる。未設定の役割は飛ばす（A→Bだけの業種もありうる）。 */
function templateSteps(
  template: IndustryTemplate
): { role: Exclude<TemplateStepRole, "template">; projectId: string; suffix: string }[] {
  const steps: { role: Exclude<TemplateStepRole, "template">; projectId: string; suffix: string }[] = [];
  if (template.entry_template_project_id)
    steps.push({ role: "entry", projectId: template.entry_template_project_id, suffix: "a" });
  if (template.followup_template_project_id)
    steps.push({ role: "followup", projectId: template.followup_template_project_id, suffix: "b" });
  if (template.verify_template_project_id)
    steps.push({ role: "verify", projectId: template.verify_template_project_id, suffix: "c" });
  return steps;
}

export const storeProvisioningService = {
  /**
   * 店舗を作り、業種テンプレから案件一式とサイクル定義を生成する。
   *
   * @param input.codeSlug entry_code の接頭辞。`<slug>-a` のようなコードになる。
   */
  async provisionStore(
    input: {
      clientId: string;
      industryTemplateId: string;
      name: string;
      codeSlug: string;
      rewardPointsOverride?: number | null;
    },
    options: ProvisionOptions = {}
  ): Promise<ProvisionResult> {
    const template = await industryTemplateRepository.getById(input.industryTemplateId);
    if (!template) throw new Error("業種テンプレートが見つかりません");

    const slug = input.codeSlug.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      throw new Error("店舗コードは英小文字・数字・ハイフンで指定してください");
    }

    const partnerStoreId = (options.partnerStoreId ?? "").trim() || null;

    // ポータル注文の冪等性は **partner_store_id を先に見る**。
    // code_slug は店舗名や member_no から作るので、同じポータル店舗でも呼び出し次第で
    // 変わりうる。slug だけで判定すると同じ店舗に2つ目の store ができてしまう。
    const linkedStore = partnerStoreId
      ? await storeRepository.getByPartnerStoreId(partnerStoreId)
      : null;
    const slugStore = await storeRepository.getByCodeSlug(slug);

    // ⚠ slug 衝突で**他人の店舗**を掴んではいけない。
    //
    // ここを「別のポータル店舗のときだけ弾く」にすると、運営が店舗マスタで作った店舗
    // （partner_store_id = NULL・A/B/C が published で稼働中）が素通りし、その稼働中の
    // セットをそのままポータル会員に返してしまう。会員はチケットを1枚も払わずに
    // 他店の調査へ接続され、さらに partner_store_id が書かれないので以後 404 になる。
    // ＝「自分が既に紐づいている店舗」以外は、既存行を絶対に使い回さない。
    if (partnerStoreId && slugStore && slugStore.id !== linkedStore?.id) {
      throw new Error("店舗コードが既に使われています");
    }

    const existing = linkedStore ?? slugStore;

    const store =
      existing ??
      (await storeRepository.create({
        client_id: input.clientId,
        industry_template_id: template.id,
        name: input.name,
        code_slug: slug,
        reward_points_override: input.rewardPointsOverride ?? null,
        partner_store_id: partnerStoreId,
      }));

    const result = await this.ensureStoreProjects(store, template, options);
    return { ...result, created: !existing };
  },

  /**
   * 店舗の案件一式とサイクル定義を「無ければ作る」。
   * 既に作られている分はそのまま返すので、再実行しても増えない。
   */
  async ensureStoreProjects(
    store: Store,
    template: IndustryTemplate,
    options: ProvisionOptions = {}
  ): Promise<Omit<ProvisionResult, "created">> {
    // ポータル紐づけは store 側の値を正とする（呼び出し側が渡し忘れても既存店舗の値で揃う）。
    const partnerStoreId = (options.partnerStoreId ?? store.partner_store_id ?? "").trim() || null;
    const initialStatus = options.initialStatus ?? "published";
    const packageId = (options.packageId ?? "").trim() || null;
    // 既存の店舗案件を役割別に引いておく（冪等性の判定材料）。
    const existingProjects = await projectRepository.listByStore(store.id);
    const byRole = new Map(existingProjects.map((p) => [p.template_step_role, p]));

    const created: { role: TemplateStepRole; project: Project; entryCode: string }[] = [];

    for (const step of templateSteps(template)) {
      const entryCode = `${store.code_slug}-${step.suffix}`;
      const already = byRole.get(step.role);
      if (already) {
        created.push({ role: step.role, project: already, entryCode: already.entry_code ?? entryCode });
        continue;
      }

      // テンプレ案件を設問ごと複製する（既存の copyProject を再利用）。
      const copied = await projectRepository.copyProject(step.projectId);
      const source = await projectRepository.getById(step.projectId);

      // copyProject が写さない項目をここで揃える。
      // 特に visibility_type / display_mode / answer_ui_preset は
      // 抜けると回答UIや公開範囲が変わってしまう。
      const project = await projectRepository.update(copied.id, {
        name: `【${store.name}】${stripStorePrefix(source.name)}`,
        client_name: store.name,
        client_id: store.client_id,
        store_id: store.id,
        industry_template_id: template.id,
        template_step_role: step.role,
        entry_code: entryCode,
        visibility_type: "private_store",
        is_discoverable: false,
        apply_mode: source.apply_mode ?? "auto",
        display_mode: source.display_mode,
        answer_ui_preset: source.answer_ui_preset,
        delivery_enabled: false,
        // 謝礼は店舗指定があればそれを使う（謝礼なしの店舗は 0 を指定する）。
        reward_points: store.reward_points_override ?? source.reward_points,
        status: initialStatus,
        // ポータル注文のときだけ、会員ポータルの店舗に「閲覧専用」で紐づける (Migration 103/104)。
        // partner_store_id があると店舗の /api/partner/surveys/:id から読めるようになり、
        // partner_readonly=true が書き込み（PUT / publish / close）を 409 で止める。
        ...(partnerStoreId
          ? { partner_store_id: partnerStoreId, partner_readonly: true }
          : {}),
        // A 案件にだけパッケージ参照を残す。hibi の消費チケット枚数の解決に使う。
        ...(packageId && step.role === "entry"
          ? { objective: `${PACKAGE_MARKER_PREFIX}${packageId}` }
          : {}),
      } as Parameters<typeof projectRepository.update>[1]);

      created.push({ role: step.role, project, entryCode });
      logger.info("storeProvisioning.projectCreated", {
        storeId: store.id,
        role: step.role,
        projectId: project.id,
        entryCode,
      });
    }

    // C は A の回答を参照する（店舗内で閉じる）。
    // 参照は entry_code ベースなので、店舗ごとに別コード＝他店舗と混ざらない。
    const entry = created.find((c) => c.role === "entry");
    const verify = created.find((c) => c.role === "verify");
    if (entry && verify && !verify.project.carry_forward_sources) {
      await projectRepository.update(verify.project.id, {
        carry_forward_sources: [{ namespace: "a", entry_code: entry.entryCode }],
      } as Parameters<typeof projectRepository.update>[1]);
    }

    const cycleGroupId = await this.ensureCycleGroup(store, template, created);
    return { store, projects: created, cycleGroupId };
  },

  /** 店舗のサイクル定義を「無ければ作る」。設定値は業種テンプレから引き継ぐ。 */
  async ensureCycleGroup(
    store: Store,
    template: IndustryTemplate,
    projects: { role: TemplateStepRole; project: Project }[]
  ): Promise<string | null> {
    const entry = projects.find((p) => p.role === "entry");
    if (!entry) return null;

    const existing = await cycleGroupRepository.findByStore(store.id);
    if (existing) return existing.id;

    const verify = projects.find((p) => p.role === "verify");

    const group = await cycleGroupRepository.create({
      name: `${store.name} ${template.name}`,
      client_id: store.client_id,
      entry_project_id: entry.project.id,
      followup_project_id: verify?.project.id ?? null,
      // テンプレの既定値をコピーする。以後は店舗ごとに変更できる
      // （テンプレを後から変えても既存店舗には影響しない）。
      grace_days: template.grace_days,
      undecided_days: template.undecided_days,
      restart_cooldown_days: template.restart_cooldown_days,
      followup_b_delay_minutes: template.followup_b_delay_minutes,
      frequency_question_code: template.frequency_question_code,
      frequency_days_json: template.frequency_days_json,
      store_id: store.id,
      industry_template_id: template.id,
    });

    const roleOrder: TemplateStepRole[] = ["entry", "followup", "verify"];
    let order = 1;
    for (const role of roleOrder) {
      const found = projects.find((p) => p.role === role);
      if (!found) continue;
      await cycleGroupRepository.addStep({
        cycle_group_id: group.id,
        project_id: found.project.id,
        step_order: order++,
        step_role: role as "entry" | "followup" | "verify",
      });
    }

    logger.info("storeProvisioning.cycleGroupCreated", { storeId: store.id, groupId: group.id });
    return group.id;
  },
};

/** テンプレ案件名の先頭に付いた店舗名（【●●美容室】）を落とす。 */
function stripStorePrefix(name: string): string {
  return name.replace(/^【[^】]*】\s*/, "");
}
