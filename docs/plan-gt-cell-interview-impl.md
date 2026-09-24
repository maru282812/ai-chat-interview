# 実装計画: GT集計表のセルから追加AIインタビューを配信する

> 作成: 2026-09-24 / 設計メモ: [[plan-gt-cell-interview]]（未実装メモ）を実装計画に落としたもの
> 対象リポジトリ: `ai-chat-interview`（ACI・主戦場）/ `hibi-site`（顧客ポータル）

## 確定した方針（2026-09-24 ユーザー判断）

| # | 論点 | 決定 |
|---|---|---|
| Q1 | 顧客に見せる範囲 | **集計と人数のみ**。個票・識別子は返さない（既存 `getResults` の作法を踏襲） |
| Q2 | インタビューは AI か人か | **AI**（`display_mode='interview_chat'` の既存機構を使う） |
| Q3 | 規約新版のタイミング | **Phase 1 と同時に最優先で切る**（同意の積み上げを最速で開始する） |
| Q4 | 謝礼単価 | **通常案件の固定倍率で暫定運用**。設定値として外に出し後から調整可能にする |
| Q5 | スコープ | **Phase 1-4 全部**（顧客セルフサービスまで） |

---

## 実装目的

顧客が GT集計表のセル（=「設問Qで選択肢Aを選んだ人」）をクリックすると、その回答者だけを母集団として
AI深掘りインタビューを配信でき、定量調査からそのまま定性データを取りに行ける状態にする。

完成時に顧客ができること:
1. 自社調査の GT集計表（n行＋%行・設問タブ・属性クロス）を見る
2. 気になるセルを選ぶと「該当492人・うち到達可能50人」が出る
3. ボタン1つで、その母集団へAIインタビュー案件が配信される
4. 数時間後に定性回答が集計として返る（**誰が答えたかは見えない**）

---

## 前提（調査で確認済み・2026-09-24）

### 既にあって流用できるもの
| 要素 | 場所 | 備考 |
|---|---|---|
| AI深掘り会話本体 | `src/services/conversationOrchestratorService.ts:702-770` | `probeType`/`probeCount`/`max_probes_per_session`。セッション内ステートマシン |
| 表示モード | `src/types/questionSchema.ts:20` | `"survey_page" \| "survey_question" \| "interview_chat"` |
| 指名配信（ID配列を渡すだけ） | `src/services/assignmentService.ts:646` | `assignManual({ projectId, sourceRespondentIds[] })`。**新規配信経路は不要** |
| 通知可否フィルタ | `src/services/projectDeliveryService.ts:25-26` | `notification_ok=true` かつ `is_notification_stopped=false`。**到達可能人数の分子にそのまま使える** |
| 同意日時ゲート | `src/lib/questionShare.ts:170` `isCoveredByConsent` | **「利用目的は遡及しない」を既に実装済み。規約新版のゲートはこれを再利用する** |
| 選択肢ごとの件数集計 | `src/services/partnerSurveyService.ts:728-742` | 0埋め・multi_choiceのカンマ分解。**Phase2の抽出はこの突合ロジックと必ず一致させる** |
| 識別子非開示の作法 | `src/services/partnerSurveyService.ts:664-666` | respondent_id / line_user_id / session_id を返さない |
| 顧客向け設問ホワイトリスト | `src/lib/questionShare.ts:146` `selectShareableQuestions` | 既定非開示。新設問が黙って流れない |
| 属性クロス集計（2軸のみ） | `src/lib/partnerDemographics.ts:151-180` | 性別×年代のみ。Phase1で汎用化する |
| クロス表の描画 | `hibi-site/app/(member)/project/[projectId]/demographic-panel.tsx:176` | `<td>` は静的。Phase4でクリック可能にする |
| 最も近い既存の「後から配信」 | `src/services/cycleFollowupService.ts` | 冪等性は `followup_sent_at` の先行クレーム方式。**この作法を踏襲する** |

### 無いもの（本機能で作る分）
| # | 要素 | 現状 |
|---|---|---|
| A | GT集計表（n行＋%行・設問タブ） | `views/admin/projects/analysis.ejs:229-261` は度数のみ。%を出すコードが無い |
| B | 設問×属性の汎用クロス集計 | `researchOpsService.ts:501-568` が `user_profiles` を join しない |
| C | 「この選択肢を選んだ人」の抽出 | `answerRepository`（全152行）に該当メソッドが無い |
| D | 回答値ベースのセグメント | `adminController.ts:2861-2864, 2939` はプロフィール属性＋total_pointsのみ。`evaluateConditionsIds`(:2965) は `answers` を見ない |
| E | 到達可能人数の算出 | フィルタ条件は存在するが、セル条件から人数を出す関数が無い |
| F | セル条件から案件生成・配信する導線 | 案件生成は管理画面の手動フォームのみ |
| G | 顧客が見る GT画面・API | partner API は7本のみ（`src/routes/partnerRoutes.ts`）。`/gt` も `/interviews` も無い |
| H | 再接触の利用目的（規約） | migration 111 (v2.1) は「属性で配信対象を選定」まで。**過去の回答を根拠にした再接触は未記載** |

### 仮定した仕様（要確認）
- 謝礼倍率の既定値は **2倍**（設定値として実装し、根拠は別途詰める）
- 到達可能人数の定義は §Phase2 の6条件で固定する（顧客に見せる数字なので定義を動かさない）
- 小N抑制のしきい値は **n<10**（`ai-servey` の `K_ANONYMITY_MIN_N=10` と `ai-analysis/report.ejs` の n<3 前例の中間ではなく、顧客公開なので厳しい側を採る）

---

## 変更対象

| 領域 | 変更 | 内容 |
|---|---|---|
| DB | **あり** | 規約新版 migration、追加調査の親子関係カラム、配信頻度制御、冪等キー |
| API | **あり** | ACI: partner API 2本新設＋管理画面用。hibi-site: BFF経由 |
| UI | **あり** | ACI管理画面のGT表、hibi-site の顧客向けGT表＋インタビュー実行 |
| 型定義 | **あり** | GT表のデータ契約、セル条件の型、`aci-types.ts` |
| その他 | **あり** | 規約本文（ACI documents で版管理）、謝礼倍率の設定値 |

---

## 実装フェーズ

依存順: **規約新版（並行・最優先） → Phase1（GT表） → Phase2（抽出・人数） → Phase3（生成・配信） → Phase4（顧客公開）**

### Phase 0: 規約新版を切る（Phase 1 と並行・最優先）
**最優先の理由**: 利用目的の追加は遡及しないため、新版公開前の回答は永久にインタビュー対象にできない。
実装を待つ分だけ母集団が失われる。

- 回答者向け利用規約の**新版**を作る（本文差し替えではなく必ず新版。`consentService` は version_id 一致で判定するため、差し替えでは再同意が発生しない）
- 追記する利用目的: 「**回答内容に基づき、追加のインタビューへのご協力をお願いする場合があります**」
- 回答画面に**あらかじめ明示**する（規約9条3項と同じ作法）
- **メジャー版↑＝再同意**（[[store-terms-aci-managed]] の方針。ただし対象は回答者向け規約）
- 完了条件: 新版が公開され、新規回答者の `user_consent_records` に新 version_id が積まれ始めている
- ⚠ 破壊的変更ではないが、**再同意ゲートで既存回答者が一時的に回答できなくなる**ため公開タイミングは要確認

### Phase 1: GT集計表を作る（管理画面に先に作る）
**これが無いと以降が全部乗らない。** 顧客公開（Phase4）の前に、まず運営画面で数字の正しさを確認する。

- `researchOpsService.buildProjectAnalysisDataset` に `user_profiles` の join を足す（B）
- 出力を **n行 + %行** の2段に（A）
- 設問タブ（属性PRE/ARE/JOB/MAR/CHI も設問として並べる）
- 設問×属性のクロス集計を汎用化（`partnerDemographics.ts` の2軸ハードコードを一般化）
- ⚠ `aggregation_type='qualitative_only'` の設問は**比率を出さない**（既存方針 "Do not use for ratio claims." を維持）
- ⚠ **小N抑制**: n<10 のセルは%をマスク
- ⚠ multi_choice はカンマ連結。**分解は必ずサーバー側**（既存 `getResults:735` のコメント通り）
- 完了条件: 管理画面で任意案件のGT表が出て、手計算した%と一致する。qualitative_only に%が出ていない

### Phase 2: セル → 回答者抽出と到達可能人数（サーバー内のみ）
- `answerRepository` に `listSessionIdsByQuestionOption(questionId, optionValue)` を追加（C）
  - ⚠ 突合ロジックは `getResults:735-741` と**同一実装を共有する**（別実装にすると表の数字と抽出人数がズレる）
  - ⚠ option の `value` にカンマが入ると抽出が壊れる。**value のカンマを禁止するバリデーションを併せて入れる**
- `answers → sessions.respondent_id → respondents.line_user_id` で名寄せ
  - ⚠ `respondents` は**案件ごとに1行**なので `line_user_id` で distinct（G6 と同じ罠）
- **到達可能人数**（「50人 / 492人」）の算出。分母=該当者、分子=下記を全て満たす人:
  1. `notification_ok = true`
  2. `is_notification_stopped = false`
  3. `is_blocked = false`
  4. **新規約版に同意済み、かつ同意日時 < 回答日時**（`isCoveredByConsent` を再利用）
  5. 配信頻度制限内（G16。無いので作る）
  6. この追加調査に未配信
- ⚠ この人数は**変動する**。表示時と実行時で**再計算**する（既存のAIチャット承認カードと同じ作法）
- 回答値ベースのセグメント（D）: `SUPPORTED_SEGMENT_FIELDS` は fail-closed なので、**新フィールドを評価器と同時に足す**（片方だけ足すと G8 と同じバグになる）
- 完了条件: 任意のセルについて「該当N人・到達可能M人」が出る。M≦N。GT表のセルの数字と Nが一致する

### Phase 3: 追加調査（AIインタビュー）の生成・配信
- セル条件から `display_mode='interview_chat'` の案件を生成（F）
- 親案件との関係を保持（どの案件のどのセルから生まれたか）
- 配信は既存 `assignmentService.assignManual` に respondent ID 配列を渡す（**新規配信経路は作らない**）
- 冪等性: `cycleFollowupService` の**先行クレーム方式**を踏襲（二重配信を防ぐ）
- 謝礼: 通常案件の**固定倍率**（既定2倍）を設定値として実装
- ⚠ **景品表示法**: 固定倍率＝全員に定額なので懸賞規制には当たらない。**抽選型・山分け型にしないこと**（取引付随性と限度額の検討が必要になる）
- 完了条件: セル選択→案件生成→対象者にLINEが届き、AI深掘り会話が成立し、回答が集計に乗る

### Phase 4: 顧客に見せる（ACI partner API ＋ hibi-site 画面）
- ACI: `GET /partner/surveys/:id/gt`（集計のみ・識別子なし）
- ACI: `POST /partner/surveys/:id/interviews`（セル条件を受け取り、人数返却／実行）
- ⚠ 既存 `selectShareableQuestions` の**ホワイトリスト方式を踏襲**（既定非開示）
- ⚠ 顧客に返すのは**人数と集計だけ**。個票・識別子は返さない
- hibi-site: GT表を描画し、セルをクリック可能にする（`demographic-panel.tsx` の `CrossTable` を拡張 or 新規）
- hibi-site: `lib/aci-types.ts` にGT表とセル条件の型を追加（現状 `cross: {gender, age, count}[]` は count だけでセルを識別できない）
- 完了条件: 顧客アカウントでGT表が見え、セルクリックで人数が出て、実行するとインタビューが配信される。
  レスポンスに識別子が1つも含まれない（テストで保証する）

---

## ファイル別変更内容

### ai-chat-interview（ACI）
| 種別 | パス | 変更内容 |
|---|---|---|
| 新規 | `supabase/migrations/112_respondent_terms_v3.sql` | 回答者向け規約の新版（再接触の利用目的） |
| 新規 | `supabase/migrations/113_gt_cell_interview.sql` | 追加調査の親子関係・冪等キー・配信頻度制御 |
| 新規 | `src/lib/gtTable.ts` | GT表の組み立て（n行/%行・小N抑制・qualitative_only除外） |
| 新規 | `src/lib/answerOptionMatch.ts` | 選択肢突合ロジック（`getResults` と共有する唯一の正） |
| 新規 | `src/services/cellInterviewService.ts` | セル条件→抽出→到達可能人数→案件生成→配信 |
| 修正 | `src/repositories/answerRepository.ts` | `listSessionIdsByQuestionOption` 追加 |
| 修正 | `src/services/researchOpsService.ts:501-568` | `user_profiles` join・GT表出力 |
| 修正 | `src/services/partnerSurveyService.ts:728-742` | 突合ロジックを `answerOptionMatch` に差し替え |
| 修正 | `src/lib/partnerDemographics.ts:151-180` | クロス集計の汎用化（2軸固定を解く） |
| 修正 | `src/controllers/adminController.ts:2861-2939` | 回答値セグメントのフィールドを評価器と同時に追加 |
| 修正 | `src/services/assignmentService.ts:28-42` | `AssignmentRuleFilter` に回答値条件 |
| 修正 | `src/routes/partnerRoutes.ts` | `/gt`・`/interviews` 2本追加 |
| 修正 | `src/views/admin/projects/analysis.ejs:229-261` | GT表描画 |
| 修正 | `src/lib/surveyValidation.ts` | option の value にカンマを禁止 |

### hibi-site（顧客ポータル）
| 種別 | パス | 変更内容 |
|---|---|---|
| 新規 | `app/(member)/project/[projectId]/gt-table.tsx` | GT表＋セルクリック |
| 新規 | `app/(member)/project/[projectId]/cell-interview-dialog.tsx` | 人数表示と実行確認 |
| 修正 | `lib/aci-types.ts:486-492` | GT表・セル条件の型（cross に識別キーを追加） |
| 修正 | `lib/aci-client.ts` | `/gt`・`/interviews` のクライアント |
| 修正 | `lib/aci-mock.ts` / `lib/aci-admin-mock.ts` | モック追随 |
| 修正 | `app/(member)/project/[projectId]/demographic-panel.tsx` | GT表へ導線 |

---

## 注意点

### 法令・規約
- **個人情報保護法**: 利用目的の追加は遡及しない。Phase0 の新版公開前の回答は対象外。`isCoveredByConsent` で機械的に弾く（人の判断に委ねない）
- **規約**: 識別子を顧客に返さない現行方針を崩さない。セル選択は「抽出条件」であって「名簿」ではない
- **景品表示法**: 謝礼は固定倍率（全員定額）に留める。抽選・山分けにすると懸賞規制の検討が必要
- 再同意の発生条件を Phase0 で確定させる（メジャー版↑で全回答者が一時停止する）

### 実装上の罠（既に踏んだ記録があるもの）
- `respondents` は案件ごと1行 → `line_user_id` で distinct（G6）
- セグメントは fail-closed → **UIと評価器を同時に足す**（G8 の再発防止）
- multi_choice のカンマ連結 → 分解はサーバー側のみ。value のカンマを禁止
- GT表の%と抽出人数は**同一ロジック**から出す（二重実装するとズレて信用を失う）
- 到達可能人数は変動する → 表示時と実行時で再計算
- 二重配信 → `followup_sent_at` 方式の先行クレーム
- **GRANT の付与漏れ**（RLSだけだと permission denied で全滅した事故が複数回）

### 既存機能への影響
- `partnerSurveyService.getResults` の突合ロジック差し替えは**既存の顧客向け集計に影響する**。差し替え前後で同じ数字が出ることをテストで保証する
- `researchOpsService` への join 追加は既存 `/analysis` 画面に影響する
- 規約新版は**全回答者**に影響する（再同意）

---

## 完了条件

- [ ] Phase0: 新版規約が公開され、新規同意が積まれている
- [ ] Phase1: 管理画面のGT表の%が手計算と一致。qualitative_only に%が出ない。n<10 がマスクされる
- [ ] Phase2: セルの「該当N人／到達可能M人」が出る。M≦N。N が GT表のセルと一致
- [ ] Phase3: 実際にLINEが届き、AI深掘り会話が完了し、回答が集計に乗る
- [ ] Phase4: 顧客アカウントでセルクリック→実行までできる
- [ ] レスポンスに識別子（line_user_id / respondent_id / session_id）が含まれないことをテストで保証
- [ ] typecheck / test / build が両リポジトリで緑
- [ ] **実ブラウザ（モバイルビューポート）で hibi-site のGT表が表示され、console に Uncaught が出ない**
- [ ] migration が対象環境へ適用済み、information_schema で確認、GRANT 確認済み
