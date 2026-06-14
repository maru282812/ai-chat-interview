# custom モード整理 影響分析レポート（再設計指示 Phase G）

作成日: 2026-06-14 / 対象ブランチ: feature/phase2

> 本レポートは **調査・提案のみ**。コード変更・マイグレーションは含まない。
> 実装は本レポートの承認後に別パスで行う。

---

## 1. 現状サマリー

### 1.1 `ai_prompt_mode` の定義

- DB: `projects.ai_prompt_mode text NOT NULL DEFAULT 'custom'`（Migration 054, `CHECK IN ('custom','package')`）。
- 型: `Project.ai_prompt_mode: 'custom' | 'package'`（[domain.ts:269](../src/types/domain.ts#L269)）。

### 1.2 不整合（指示書 Phase G の指摘）

| 層 | 既定値 | 根拠 |
|---|---|---|
| DB default | **custom** | Migration 054（[054_prompt_package_management.sql:58](../supabase/migrations/054_prompt_package_management.sql#L58)） |
| UI（新規プロジェクト） | **package** | researchForm の `project ? (mode||'custom') : 'package'`（[researchForm.ejs:609](../src/views/admin/projects/researchForm.ejs#L609)・Phase 8） |

→ フォーム経由の新規作成は `package` を送るため実害は限定的だが、**API/スクリプト/シード等フォーム外の経路で作成すると `custom` 既定**になる。「Package First」方針と DB 既定が逆を向いている。

### 1.3 実行時の解決優先順位（[aiService.ts:96 resolveEffectiveProjectConfig](../src/services/aiService.ts#L96)）

```
ai_prompt_mode === 'package' かつ version_id あり
  ├─ published        → パッケージの policy/templates（+ overrides）
  ├─ archived         → 同パッケージの published へ fallback（無ければ custom 相当）
  └─ draft / 不明      → custom 相当（project の ai_prompt_*_json）
else（custom / null） → project.ai_prompt_*_json（無ければ legacy = BASE）
```

custom モードは「project が直接持つ `ai_prompt_policy_json` / `ai_prompt_templates_json` を使う」経路。本文編集 UI は Phase 6-A で撤去済みのため、custom で **新たに本文を作る導線は既に無い**（policy 個別設定と、過去に保存された templates の保全のみ）。

### 1.4 custom 依存箇所（影響範囲の全体像）

- `resolveEffectiveProjectConfig`：mode 分岐の `else` 節。
- `resolvePromptMeta`：packageMeta が無い場合に `custom_template` / `base_template` / `legacy` を記録（[aiService.ts:160](../src/services/aiService.ts#L160)）。
- researchForm：`prompt-custom-section`（policy 7軸の個別設定 UI、[researchForm.ejs:860](../src/views/admin/projects/researchForm.ejs#L860)）とラジオ。
- adminController：`parseAIPromptModeFromRequest` / `parseAIPromptOverridesFromRequest` / `updateProject` の custom 時は既存 templates/overrides を保持。
- 変更履歴ログ：mode 切替を `project_prompt_package_change_logs` に記録。

---

## 2. 4案の比較

### 案1: custom 完全廃止

**内容:** `ai_prompt_mode` を廃止し、全プロジェクトを package 解決に一本化。`ai_prompt_policy_json` / `ai_prompt_templates_json` の project 直持ちを廃止。

- **メリット:** 設計が最もクリーン。Package First を完全実現。分岐消滅でバグ面減。
- **デメリット / 影響:**
  - 既存の custom プロジェクト（project に policy/templates を直持ち）は **必ず移行が必要**（案4 とセット）。
  - package 未割当のプロジェクトの受け皿（既定パッケージ or legacy フォールバック）が必須。
  - researchForm の custom セクション・ラジオ撤去、`resolveEffectiveProjectConfig` の else 節撤去、型変更（`ai_prompt_mode` 削除 or 固定）。
  - Migration（列削除 or 無効化）＋ 全 Project モックを持つ既存テスト（phase4〜7B 等）の修正。
- **リスク:** 高（破壊的・後方互換喪失）。

### 案2: custom 後方互換維持（現状維持＋既定の明確化のみ）

**内容:** custom を残すが「後方互換専用・非推奨」と明示。新規は package に誘導（UI は Phase 8 で実施済み）。コードは原則そのまま。

- **メリット:** リスク最小。既存挙動を一切壊さない。実装コストほぼゼロ。
- **デメリット:** DB 既定 `custom` のままなのでフォーム外経路の不整合は残る。「整理した」感は弱い。
- **リスク:** 低。

### 案3: DB default 変更（`custom` → `package`）

**内容:** `ALTER TABLE projects ALTER COLUMN ai_prompt_mode SET DEFAULT 'package'` のみ。custom 自体は後方互換で温存。

- **メリット:** UI 既定（package）と DB 既定が一致し、§1.2 の不整合が解消。低コスト。フォーム外作成も Package First に。
- **デメリット / 影響:**
  - 既存行は不変（default は新規 INSERT のみ）。
  - `ai_prompt_package_version_id` を伴わず `package` 既定になった行は、実行時 §1.3 の「version_id 無し → custom 相当 → legacy(BASE)」に落ちる。**= 害は無いが「package なのに BASE」状態が増える**点を許容する必要あり（Phase F で `template_mode` は追跡可能）。
  - Migration 1本（CHECK 制約・列はそのまま）。コード変更不要。
- **リスク:** 低〜中。

### 案4: 既存データ移行

**内容:** 既存 custom プロジェクトを package へ移行。policy/templates を持つ custom 行ごとに、相当するパッケージバージョンを作成 or 既定パッケージを割当てて `ai_prompt_mode='package'` + `version_id` を設定。

- **メリット:** 既存資産を維持したまま Package First へ寄せられる。案1の前提条件を満たす。
- **デメリット / 影響:**
  - 移行スクリプトが必要（custom の policy/templates → パッケージ化、または「既定パッケージ」への集約）。
  - templates を直持ちする custom 行の棚卸しが前提（実データ調査が必要）。
  - 取り違え時の本番プロンプト変化リスク → 段階適用・ドライラン・ロールバック設計が必要。
- **リスク:** 中〜高（データ依存）。

---

## 3. 推奨

**段階移行：案3（DB default 変更）を即時 → 案4（移行）→ 将来的に案1（廃止）** を推奨する。

理由:
1. **案3 を先に** 入れると、コード変更ゼロ・低リスクで §1.2 の不整合を解消でき、フォーム外経路まで Package First に揃う。Phase F により「package なのに BASE」も `template_mode=package_template` で可視化済みなので運用上の盲点が無い。
2. **案4 は実データ調査が前提。** 現在 custom で `ai_prompt_templates_json` を直持ちするプロジェクトの件数・内容を棚卸ししてから、(a) 既定パッケージへ集約するか (b) プロジェクト個別パッケージを生成するかを決める。
3. **案1（完全廃止）は案4 完了後。** 移行で custom 実データが消えてから列・分岐・UI を撤去すれば破壊的影響を避けられる。
4. **案2 は「何もしない」に近く、不整合が残る**ため単独では非推奨。ただし案4 着手前の中間状態としては許容。

### 推奨アクション（承認後の想定タスク）

| 順 | 作業 | 種別 | リスク |
|---|---|---|---|
| 1 | `ai_prompt_mode` DEFAULT を `package` に変更 | Migration（新規 060 想定）| 低 |
| 2 | custom で templates/policy を直持ちするプロジェクトの棚卸し（調査クエリ） | 調査 | なし |
| 3 | 移行方針（既定パッケージ集約 or 個別生成）の決定 → 移行スクリプト | スクリプト | 中 |
| 4 | 移行検証後、custom 分岐・UI・列の撤去（案1） | リファクタ | 高 |

> いずれも本レポート承認後に着手。まずは **手順1（DB default 変更）** のみの先行実施でも、不整合解消の効果が得られる。

---

## 4. 実装記録（2026-06-14 / Phase G 着手）

本レポート承認を受け、**案3（DB default 変更）＋ 可視化（移行レポート）＋ UI 降格**を実装した。案4（実データ移行）・案1（custom 廃止）は実データ棚卸し後に別パスで継続。

| # | 指示項目 | 実装 |
|---|---|---|
| 1 | DB default を package に | `060_ai_prompt_mode_default_package.sql`（`ALTER ... SET DEFAULT 'package'`）。アプリ側 `parseAIPromptModeFromRequest(req, fallback)` で新規作成は `package`、更新は既存モード維持 |
| 2 | 新規作成で公開済みパッケージ選択を標準導線に | researchForm の新規既定 package（Phase 8 既存）を維持 |
| 3 | package 未選択で作成時の明確な警告 | submit 時 `confirm`（researchForm）＋ 作成後は編集画面へ誘導し `notice=prompt_package_unset` ＋ 警告パネル表示 |
| 4 | custom は後方互換で温存 | 実行時分岐・型・UI とも削除せず維持 |
| 5 | UI 上で custom を非推奨に降格 | プロジェクト一覧に「要移行」バッジ追加。ラジオの非推奨表示（Phase 8 既存）維持 |
| 6 | custom 一覧・移行候補レポート | `GET /admin/prompt-packages/migration`・`promptMigrationService.buildPromptMigrationReport`・`migration.ejs` |
| 7 | archived / 未公開参照の把握 | 同レポートに archived 参照・orphan 参照（draft/削除済み）・package 未設定を区分表示 |
| 8 | AIログの custom/package 追跡維持 | `aiService.resolvePromptMeta`（package_template / custom_template / base_template / legacy）変更なし・維持 |
| 9 | テスト | `src/tests/promptPackagePhaseG.test.ts`（7件）。既存全スイート pass・`npm run build` 通過 |

**未着手（次パス）:** 案4 実データ移行スクリプト、案1 custom 列・分岐・UI 撤去（移行完了後）。
