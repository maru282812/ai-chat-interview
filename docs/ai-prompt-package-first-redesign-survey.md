# AIプロンプト管理「Package First」再設計 調査レポート

作成日: 2026-06-14 / 対象: 設計思想のズレ（プロジェクト中心 → プロンプトパッケージ中心）の調査

> 本レポートは**調査のみ**。コード修正は未実施。

---

## 0. 結論（先に要点）

- **現状の管理主体は依然として `Project`**。`Package`/`Version` は「Project に投影される素材（blob）」に過ぎず、実行時解決は必ず `Project.ai_prompt_mode` を起点に分岐する（根拠: `aiService.ts:101`）。
- 本文（テンプレート）編集はパッケージ画面に集約済み（Phase 6-A）。**しかし `policy`・`override`・`mode選択`・「package未設定のまま作成」** がプロジェクト編集画面に残っており、Project が依然「編集できる主体」になっている。
- そのため「Package → Version → Templates → Project へ適用（Project は適用先のみ）」という求める構造に対して、**Project が co-equal な編集主体として残存**しているのがズレの正体。

---

## 1. 新規プロジェクト作成時の導線

### フロー
1. `GET /admin/projects/new` → `newProject` （`adminController.ts:2105`）が `project:null` で researchForm を描画。
2. researchForm 5節「AIプロンプト設定」で mode 既定値を決定:
   - `researchForm.ejs:609` `const currentPromptMode = project ? (project.ai_prompt_mode || 'custom') : 'package';`
   - → **新規は UI 上 `package` 既定**（ラジオ `package` が checked）。
3. `POST /admin/projects` → `createProject`（`adminController.ts:2113`）:
   - `adminController.ts:2124` `parseAIPromptModeFromRequest(req, 'package')` → 既定 package。
   - `adminController.ts:2125` `resolvePackageVersionIdFromRequest(req, mode)`。

### どこで custom モードになるか
| 箇所 | 内容 |
|---|---|
| `researchForm.ejs:609` | **既存**プロジェクトで `ai_prompt_mode` が null のとき `|| 'custom'` で custom 表示 |
| `researchForm.ejs:674` | ラジオに `custom`（非推奨ラベルだが**選択可能**）が常設 |
| `adminController.ts:697` | `parseAIPromptModeFromRequest` の既定引数が `'custom'`（呼び出し側で上書きしているが、関数既定は custom） |
| `projectRepository.ts:126` | `copyProject` が `source.ai_prompt_mode ?? 'custom'`（複製時に custom へ落ちうる） |
| テスト多数 | `ai_prompt_mode: "custom"` 固定（phase4/7/rendering/questionSchema） |

### どこで package モードが無効化（骨抜き）されるか
**「package モードだがバージョン未選択でも作成・保存できてしまう」**点が最大の骨抜き:
- `adminController.ts:744-752` `resolvePackageVersionIdFromRequest`: version 未選択は **error ではなく warning**（作成を妨げない）。
- `adminController.ts:2179-2182`: 未選択時は編集画面へ redirect して警告するだけ（**作成は成立**）。
- 結果、`ai_prompt_mode='package'` かつ `ai_prompt_package_version_id=null` の「実体のない package モード」が生まれ、実行時は `aiService.ts:101` の条件で **BASE/legacy にフォールバック** → 見かけ package・中身 legacy。
- DB 既定値: `060_ai_prompt_mode_default_package.sql` で `DEFAULT 'package'`（**要本番適用**）。ただし `projectRepository.create` は常に明示値を渡すため DB 既定はほぼ効かない。

---

## 2. プロジェクト画面依存箇所（全件洗い出し）

凡例: 🟥=プロジェクト中心思想の核（要改修） / 🟨=プロジェクト依存だが補助 / 🟩=パッケージ中心（OK）

### package未設定警告
| ファイル:行 | 区分 | 内容 |
|---|---|---|
| `adminController.ts:210-211` | 🟨 | `resolveNoticeMessage('prompt_package_unset')` |
| `adminController.ts:746-752` | 🟥 | 未選択を warning 扱いで**作成許可** |
| `adminController.ts:2177-2182` | 🟥 | 未選択 → edit へ redirect（作成は成立） |
| `researchForm.ejs:645` | 🟥 | 「パッケージ未選択です」パネル（プロジェクト画面） |
| `researchForm.ejs:1086-1095` | 🟥 | `confirmPromptPackageSelection()` 送信時 confirm |
| `migration.ejs:25` | 🟩 | packageUnset 件数（パッケージ側レポート） |

### package選択UI
| ファイル:行 | 区分 | 内容 |
|---|---|---|
| `researchForm.ejs:663-746` | 🟥 | mode ラジオ＋パッケージ2段選択＋プレビュー＋変更理由＋override（**プロジェクト画面に集中**） |
| `researchForm.ejs:1066,1088,1090,1171` | 🟥 | mode/version 切替の JS |

### ai_prompt_mode
| ファイル:行 | 区分 |
|---|---|
| `domain.ts:269` | 型定義 `'custom' | 'package'` |
| `projectRepository.ts:50,126` | 🟥 Mutation入力・copy既定 custom |
| `adminController.ts:699,2124,2164,2249,2299,2308,2342` | 🟥 parse・create・update・変更ログ |
| `aiService.ts:101` | 🟥 **実行時分岐の起点（管理主体の証拠）** |
| `adminService.ts:98,151` | 🟨 一覧表示用 packageInfo 集計 |
| `promptPackageRepository.ts:120,318,329,363` | 🟩 「package利用プロジェクト」逆引き |
| `researchForm.ejs:609,668,674` / `indexDesigner.ejs:43,54` | 🟥 プロジェクト画面・一覧でのmode表示/選択 |
| `promptMigrationService.ts:122` | 🟩 移行分類 |

### ai_prompt_package_version_id
| ファイル:行 | 区分 |
|---|---|
| `domain.ts:271` / `projectRepository.ts:51,127` | 型・Mutation |
| `adminController.ts:744,2165,2300,2309,2318-2337,6037-6072,6449` | 🟥/🟨 適用・変更ログ・一覧 |
| `aiService.ts:101,106` | 🟥 実行時 version 解決 |
| `adminService.ts:98,151-152` | 🟨 一覧 |
| `researchForm.ejs:610,713,1090,1171` | 🟥 version 選択 UI |
| `show.ejs:151` | 🟩 パッケージ画面で利用プロジェクト逆引き |
| `promptPackageRepository.ts:*` | 🟩 利用集計 |

### ai_prompt_templates_json（本文）
| ファイル:行 | 区分 | 内容 |
|---|---|---|
| `adminController.ts:2163` | 🟩 | createProject は **null**（プロジェクトで本文を持たない） |
| `adminController.ts:2298` | 🟨 | updateProject は `existing` を**温存**（旧customデータ保全） |
| `adminController.ts:6308,6381` | 🟩 | **パッケージ version-form でのみ**書込み |
| `aiService.ts:124,145,165` | 🟥 | 実行時に `project.ai_prompt_templates_json` を読む（legacy/custom 経路が生存） |
| `researchForm.ejs` | 🟩 | 本文編集UIは**撤去済み**（Phase 6-A） |

→ **本文編集はほぼ Package 中心化済み**。ただし projects テーブルに列が残り、custom/legacy 経路で実行時に読まれる。

### ai_prompt_policy_json（方針）
| ファイル:行 | 区分 | 内容 |
|---|---|---|
| `adminController.ts:681` | 🟥 | `parseAIPromptPolicyFromRequest`（プロジェクトフォームの `ai_policy_*` を読む） |
| `adminController.ts:2161,2295` | 🟥 | **create/update が無条件で project に policy を保存** |
| `aiService.ts:84,123,144,174,185` | 🟥 | 実行時 policy 解決・ai_logs スナップショット |
| `adminController.ts:886` | 🟩 | package version 保存 |

→ **policy はまだプロジェクト画面で編集・保存されている**（本文と違い未集約）。これが「プロジェクト中心」の残存核。

### ai_prompt_overrides_json（個別上書き）
| ファイル:行 | 区分 |
|---|---|
| `domain.ts:273` / `adminController.ts:707-717,2166,2301` | 🟥 プロジェクト画面で policy を上書き保存 |
| `aiService.ts:85,94,123,144` | 🟥 実行時 override マージ（`overrides.policy > package > project`） |
| `researchForm.ejs:749-759` | 🟥 override 編集 details |

### どの画面がプロジェクト中心思想か
- 🟥 **`researchForm.ejs` 5節「AIプロンプト設定」**: mode選択・policy(Section A)・override・package未設定許容。**プロジェクト画面が editor になっている核心**。
- 🟨 `indexDesigner.ejs`（プロジェクト一覧）: mode/package を**表示**（編集ではないが Project 起点の世界観）。
- 🟩 `prompt-packages/*`: 本文/version 管理は適切に Package 中心。

---

## 3. 管理主体の特定（根拠コード付き）

**実際の管理主体 = `Project`。** 根拠:

1. **実行時解決は必ず Project から始まる**
   `aiService.ts:96-101`
   ```ts
   export async function resolveEffectiveProjectConfig(project: Project): Promise<...> {
     if (project.ai_prompt_mode !== "package" || !project.ai_prompt_package_version_id) {
       return { effectiveProject: project, packageMeta: null, isFallback: false };
     }
   ```
   → 入口は Project。mode が Project にあり、Project がパッケージを「使うか」を決める。

2. **Version の内容は Project に投影されてから使われる**
   `aiService.ts:141-146`
   ```ts
   effectiveProject: { ...project,
     ai_prompt_policy_json: applyPolicyOverrides(project, version.policy_json),
     ai_prompt_templates_json: version.templates_json ?? project.ai_prompt_templates_json },
   ```
   → Version は素材。最終的に `Project` 形に畳まれる。**Version だけで完結する解決経路は存在しない**。

3. **Project が5つの権威フィールドを保持**
   `domain.ts:265-273`: `ai_prompt_policy_json` / `ai_prompt_templates_json` / `ai_prompt_mode` / `ai_prompt_package_version_id` / `ai_prompt_overrides_json`。
   → 状態の所有者が Project。

4. **編集面が Project にも残る**: `adminController.ts:2161,2295`（policy）, `2166,2301`（override）。

**Version の位置づけ**: 本文/方針の「内容」holder ではあるが**authoritative ではない**。Package は version をまとめる入れ物。→ 求める「Package/Version が主、Project は適用先」とは逆転している。

---

## 4. 求める最終状態との差分一覧

| # | 求める状態 | 現状 | 差分 / 残課題 |
|---|---|---|---|
| 1 | プロンプト管理画面が**唯一**の管理画面 | プロジェクト編集5節に policy/override/mode 編集が残存 | 🟥 プロジェクト画面に編集機能あり |
| 2 | ベースプロンプト編集は**パッケージのみ** | 本文編集は version-form のみ（達成）。ただし `project.ai_prompt_templates_json` 列が生存し legacy 経路で読まれる | 🟨 ほぼ達成・旧データ経路残 |
| 3 | バージョン管理は**パッケージ配下のみ** | version は package 配下のみ | 🟩 達成 |
| 4 | プロジェクトは**適用先** | mode=custom 選択可・package未設定許容・policy/override 編集可 → 実質編集主体 | 🟥 未達成 |
| 5 | プロジェクト側で**編集不可** | policy(Section A)・override・mode をプロジェクト画面で編集/保存 | 🟥 未達成 |
| 6 | 管理主体 = Package/Version | 実行時起点は `Project.ai_prompt_mode`（`aiService.ts:101`） | 🟥 主体が Project のまま |

---

## 5. 改修計画（Phase A → D）

> 後方互換とデータ保全のため「実行時の真実を Version に寄せる → UI 縮小 → 導線反転 → 旧データ移行」の順。各 Phase 完了で `npm run build` / 既存テストスイート緑を維持。

### Phase A: 管理主体変更（Project → Version を真実に）
- **目的**: 実行時解決の権威を Version に移す。Project は `ai_prompt_package_version_id`（適用ポインタ）のみを正とする。
- 作業:
  - `aiService.resolveEffectiveProjectConfig`: package モード時は **version.policy_json / templates_json を唯一の真実**にし、`?? project.ai_prompt_*` のフォールバック（`aiService.ts:124,145`）を段階的に外す。
  - `ai_prompt_overrides_json` のマージ（`aiService.ts:85,123,144`）を**凍結→将来廃止**（override は package 側 or 廃止）。
  - `ai_prompt_mode` を内部的に「package を正」に寄せ、custom は read-only legacy 扱い（実データ移行後に廃止）。
  - DB: `060`（DEFAULT 'package'）を**本番適用**。
- 影響テスト: phase4/5/6/7 の `ai_prompt_mode/override` 期待値更新。

### Phase B: Project 編集 UI 縮小
- **目的**: プロジェクト画面から「編集」を消し、「適用先選択」だけにする。
- 作業:
  - `researchForm.ejs` 5節: **Section A（policy 編集）撤去**、**override details 撤去（or read-only 表示）**、**custom ラジオ撤去**（custom は既存 legacy のみ非活性表示）。残すのは「現在適用中パネル＋パッケージ2段選択＋read-only プレビュー＋パッケージ管理への導線」。
  - `adminController` create/update: `parseAIPromptPolicyFromRequest`（2161/2295）・`parseAIPromptOverridesFromRequest`（2166/2301）の**保存を停止**（既存値は温存）。
  - `parseAIPromptModeFromRequest` 既定を `'package'` に（697 行）。

### Phase C: Package 中心導線
- **目的**: 起点をパッケージにし、Project はそこから適用される側に。
- 作業:
  - **package 未選択での新規作成をブロック**（`resolvePackageVersionIdFromRequest` の未選択 warning → 新規は error/必須化、または作成直後に強制選択フロー）。
  - `prompt-packages/show.ejs`: 「このパッケージを適用しているプロジェクト一覧」に**適用/再適用アクション**を追加（パッケージ側から Project に適用できる）。
  - 管理ナビ/トップを `prompt-packages` 起点に。`indexDesigner.ejs` の mode 列は「適用中パッケージ表示」に純化。
  - `index.ejs` 冒頭の移行レポート導線は補助のまま（達成済み）。

### Phase D: 移行（custom → package）
- **目的**: 既存 custom 実データを Package/Version 化し、legacy 経路を撤去。
- 作業:
  - `promptMigrationService` をレポート専用から**実行系へ昇格**: custom プロジェクト（`templates_json`/`policy_json` 直持ち）を「移行用パッケージ＋Version」へ書き出し、Project を `mode=package` + `version_id` に張り替え、`ai_prompt_templates_json/policy_json/overrides_json` を **null 化**。
  - 移行完了の棚卸し後、**legacy コードパス削除**: `aiService` の `?? project.ai_prompt_*` フォールバック、`parseAIPromptPolicy/Overrides`、researchForm の custom 残骸、`ai_prompt_mode` の custom 分岐。
  - 列自体の DROP は最終段階（後方互換期間後）。

### 依存順序
```
A（実行時の真実をVersionへ）
 └→ B（Project編集UI縮小：Aで安全に消せる）
      └→ C（Package起点の導線・未選択ブロック）
           └→ D（実データ移行 → legacy撤去 → 列DROP）
```

---

## 付録: 主要根拠ファイル
- `src/services/aiService.ts:96-154` 実行時解決（管理主体の証拠）
- `src/controllers/adminController.ts:695-768` mode/version パース・未選択許容
- `src/controllers/adminController.ts:2113-2182,2236-2304` create/update の prompt 保存
- `src/views/admin/projects/researchForm.ejs:600-760` プロジェクト中心 UI の核
- `src/types/domain.ts:265-273` Project が持つ5フィールド
- `src/repositories/projectRepository.ts:48-52,124-128` Mutation 入力・copy 既定
