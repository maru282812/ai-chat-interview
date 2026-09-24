# 検証計画: 店舗専用アンケート連鎖（入口→作成→表示→深掘り→完了→回帰）

作成: 2026-09-02。目的＝「実装はしたが本当に良い挙動か分からない」を潰すため、
店舗専用アンケートを起点に連鎖する全サーフェスの検証項目を整理し、現状判定を付ける。

**判定凡例**
- ✅ = 自動テストで仕様固定済み（コード変更しない限り信頼してよい）
- 🟡 = 実装済みだが**実機未検証**（今回の検証の主対象）
- ❌ = 既知の未達・ギャップ（修正 or 意思決定が必要）
- ⬜ = 未検証（今回確認して判定を埋める）

**共通の前提（厳守）**
- dev の `.env` も本番 Supabase を向く。検証案件は必ず `visibility_type=private_store` + `is_discoverable=false` で作り、終了後に cleanup。
- 実ユーザーへの LINE push 禁止。認証は `tmtest:` Bearer + 偽ユーザー `Uverify_test_001` seam（`liffAuthService.ts`）。
- テストは `npm test`（7本のみ）ではなく `npx tsx src/tests/<name>.test.ts` を**1本ずつ**（並列は偽陽性）。
- ゲート: `npx tsc --noEmit` → 対象スイート個別実行 → `npm run verify:views`。

**seed 資産**
- 店舗3モード検証: `node scripts/seedDeployCheckProjects.mjs`（通常/interview_chat/スワイプ、全て private_store + entry_code。⚠ --cleanup 無し＝手動削除）
- 分岐×非表示・probe別行: `node scripts/seedDisplayModeVerifyProjects.mjs` / `--cleanup`
- 業種テンプレ一括生成: `scripts/seedIndustryTemplates.mjs` → 管理画面から店舗追加

---

## 0. 静的ゲート（毎回最初に）

| # | 確認内容 | 手順 | 判定 |
|---|---|---|---|
| 0-1 | 型チェック | `npx tsc --noEmit` | ⬜ |
| 0-2 | 関連スイート個別pass | storeSurveyEntry / storeProvisioning / answerPresentation / surveyValidationDisplayMode / surveyProbeAnswerRole / experienceConfig / crossProjectCarryForward | ⬜ |
| 0-3 | コンパイル済みビュー整合 | `npm run verify:views` | ⬜ |

## 1. 入口（QR / entry_code / 専用URL）

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| 1-1 | QR/配信URLが liff.line.me 恒久URLで生成される | `buildStoreEntryLiffUrl`（liffService.ts:204）経由。`APP_BASE_URL/liff/store` 直組みが新規に無いこと（grepで確認） | 🟡 |
| 1-2 | LIFF玄関→/liff/store への 302（query と liff.state 両経路） | liffRoutes.ts:75-92。liff.state はリダイレクト先に**残さない** | 🟡 |
| 1-3 | 未知コード / public案件のコード / 未公開案件 | 404「このお店のアンケートが見つかりませんでした」 | ✅ storeSurveyEntry.test |
| 1-4 | コード空 | 400 | ✅ 同上 |
| 1-5 | 同一ユーザーが2回開く（冪等） | respondent/assignment が重複生成されない・回答途中の状態が壊れない | ✅(unit) / 🟡(実機) |
| 1-6 | ログインループガード | ストレージ不能環境でも `liff_retry` 上限2回で停止しエラー表示（無限往復しない） | 🟡 |
| 1-7 | 回答前のプロフィール確認ゲートがスキップされる | private_store は profile-check へ誘導されず即設問（liffController.ts:876付近） | 🟡 |

## 2. 案件作成側（管理画面）

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| 2-1 | 既存案件の店舗専用化 | entry_code 自動採番（st-xxxxxx）・QR即発行可 | 🟡 |
| 2-2 | revert（通常案件へ戻す） | visibility=public + entry_code=null。QR一覧から消える | ⬜ |
| 2-3 | entry_code バリデーション | 重複NG・許可文字のみ | ✅(実装) / ⬜(画面) |
| 2-4 | 業種テンプレ→店舗追加1操作 | A/B/C案件＋設問＋entry_code(`<slug>-a/-b/-c`)＋サイクル定義が揃う。再実行で重複しない | ✅ storeProvisioning.test / 🟡(実機) |
| 2-5 | **管理画面の「複製」単体** | ❌ **既知バグ: copyProject は display_mode / answer_ui_preset / visibility_type / carry_forward / client_id / store_id を写さない**（projectRepository.ts:125-197）。一括生成側は補完済みだが、複製ボタンで店舗案件を作ると素の設定に落ちる → 修正 or 運用ルール化の意思決定が必要 | ❌ |
| 2-6 | 非公開時の警告 | 店舗一覧に「公開中でないと回答不可」警告・チラシに配布前警告 | ⬜ |
| 2-7 | 送付前バリデーション | validateSurvey に project が渡りモード整合チェックが効く。survey_page レガシー案件は `?force=1` 必須（意図した挙動変更） | ✅ surveyValidationDisplayMode.test |

## 3. 回答表示（display_mode × answer_ui_preset）

**最優先の実機検証対象**: 2026-08-06 の表示モード監査 Phase1-6 修正は tsc/unit 緑だが**実機3モード通しが未実施のままコミットされている**（survey.ejs は実機でしか出ない罠が過去2件あり: label+hidden checkbox 二重トグル / data-code input の value 上書き）。

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| 3-1 | survey_question（1問1答）通し | 全設問→完了まで。casual/standard で tap_cards/carousel/face_scale が正しく描画・確定 | 🟡 |
| 3-2 | interview_chat 通し | チャットUIで全問→完了。free_comment 設問が流れない既知制約の再確認 | 🟡 |
| 3-3 | スワイプ（casual swipe_card） | スタンプ・auto-advance・戻る | 🟡 |
| 3-4 | 分岐(branch_rule)×非表示設問の共存 | 誤設問ジャンプ/範囲外完了しない（Phase3修正の実機確認。seedDisplayModeVerify 案件a） | 🟡 |
| 3-5 | submitAnswer の失敗が見える | サーバー400/409時に沈黙せずエラー表示・回答消失しない（Phase2修正） | 🟡 |
| 3-6 | presentation_pattern 設問単位上書き | 正常値は反映・不適用条件は自動降格（fallback_applied） | ✅ answerPresentation.test / 🟡(描画) |
| 3-7 | preset未設定時の既定解決 | プロジェクト上書き > 全体既定 > standard | ✅ experienceConfig.test |
| 3-8 | 途中離脱→再開 | ❌ **既知未達: 全モードでリロード＝最初から**（サーバー側resumeは死にコード）。店舗の短尺アンケートで許容するか意思決定 | ❌ |
| 3-9 | survey_page モード | ❌ 実質未完成（監査どおり）。管理selectからの到達ガードが効いているかのみ確認 | ⬜ |
| 3-10 | 「その他」自由記述 × auto-advance | 入力前確定しない | ⬜ |

## 4. AI深掘り（probe / プロンプト）

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| 4-1 | 発火条件 | probe_policy.enabled × 設問 ai_probe_enabled（interview=既定ON / survey_interview=明示ON必須） | 🟡 |
| 4-2 | 回数上限 | 設問あたり/セッションあたり min(env, policy, meta) で停止 | ⬜ |
| 4-3 | probe回答の別行保存 | answers に `answer_role='ai_probe'` 別行・parent紐付け・**本回答を上書きしない**・分岐は primary のみで評価（Phase5修正） | ✅ surveyProbeAnswerRole.test / 🟡(実機) |
| 4-4 | POST /liff/chat の所有者検証 | 他人の session_id では 401/403（Phase4修正・IDOR遮断） | 🟡 |
| 4-5 | probe生成失敗は非致命 | LLM失敗時 warn のみで回答フローが継続（probe_question:null） | ⬜ |
| 4-6 | プロンプト解決順 | プロジェクトのプロンプトパッケージ > BASE_PROMPT_TEMPLATES（probeGuidance* 26キー）。パッケージ差し替えで深掘り文が変わる | ✅ (基盤) / ⬜(店舗案件で実LLM) |
| 4-7 | 深掘り文の品質 | 誘導しない・例示で回答を狭めない・実LLMは約43秒かかる前提で待つ（15秒での誤診に注意） | ⬜(人間判定) |

## 5. 完了・会員化・ポイント

completion の自動テストは**存在しない**（実機のみ）。2経路（showComplete / finalizeChatCompletion）を必ず両方通す。

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| 5-1 | survey_question 完了 | 完了画面＋「Hibiに参加する（会員登録）」CTA表示・「今はしない」で非表示 | 🟡 |
| 5-2 | interview_chat 完了 | 同上（finalizeChatCompletion 経路） | 🟡 |
| 5-3 | トークン失効リカバリ | 長時間回答後の完了401→一度だけ再ログインで回復。CTAが消えない | 🟡 |
| 5-4 | 非会員のポイント保留 | 回答時0pt（award.deferred）→ consent 送信で遡って付与（awardDeferredCompletionsForMember）・二重付与なし | 🟡 |
| 5-5 | 会員化フロー | CTA→/liff/consent(d001-d003)→mypage→profile未完なら基本情報入力 | 🟡 |
| 5-6 | 既完了の再アクセス | alreadyCompleted で据え置き（再回答ポリシーは未決の残TODO） | ⬜ |
| 5-7 | 完了後の重い処理 | runPostCompleteProcess が await される（投げっぱなし禁止ルール準拠） | ✅(コード確認済) |

## 6. 認証・権限・露出

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| 6-1 | 誤表示遮断 | private_store 案件が「探す」一覧・詳細に**出ない** | ✅ storeSurveyEntry.test / ⬜(実機一覧) |
| 6-2 | authRequired 組合せ | LIFF_AUTH_REQUIRED × liffAuthAvailable の4組合せで回答/完了が壊れない（8ケーステストで固定済） | ✅ |
| 6-3 | IDOR | 他人の assignment_id/session_id への回答・完了・chat が拒否される。body の assignment_id ではなく session から引く | ✅(unit) / ⬜(HTTP直叩き) |
| 6-4 | トークン無し書き込み | authRequired=true 時は必須。トークンがあれば authRequired=false でも検証される | ✅ |

## 7. 回帰（既存機能への影響）

| # | 確認内容 | 期待結果 | 判定 |
|---|---|---|---|
| 7-1 | 統計エクスポート凍結契約 | wide/long/codebook の列不変。ai_probe 行が primary と分離されたまま | ✅(実装判断で確認済) / ⬜ |
| 7-2 | 通常案件（admin push 型） | 店舗改修で従来配信→回答→完了が壊れていない | ⬜ |
| 7-3 | サイクルB/C配信リンク | liff.line.me 形式・ループしない（PR#37） | 🟡 |
| 7-4 | デイリーアンケート | 店舗と同じ survey 系パーシャルの変更が波及していない | ⬜ |

---

## Receipt: 実機検証 第1回 — 2026-09-02

**Gates**: `npx tsc --noEmit` 緑 / 関連7スイート **119件 全pass**（storeSurveyEntry 10・storeProvisioning 13・answerPresentation 27・surveyValidationDisplayMode 21・surveyProbeAnswerRole 11・experienceConfig 26・crossProjectCarryForward 11）/ `verify:views` **INCLUDE ERRORS 0**（other errors 17 は空locals由来の想定内・survey系は非該当）。

**Runtime Verify**（dev server :3100 ＋ `tmtest:` seam、seedDisplayModeVerifyProjects 2案件、終了後 --cleanup 済み・残0件）:

| 項目 | 結果 |
|---|---|
| 1-2 LIFF玄関302 | ✅ `/liff?entry_code=` → `/liff/store?entry_code=` |
| 1-3/1-4 未知404・空400 | ✅ |
| 1-5 冪等 | ✅ 2回解決で同一 assignment_id |
| **3-4 分岐×非表示** | ✅ **yes→分岐先Q3が非表示のためQ4へ正送り／no→Q2／Q2=b でQ3出現／Q4で next=null 完了**。監査最重大の誤設問ジャンプは実機で解消 |
| 3-4c 非表示設問への直接POST | ✅ 409 で拒否 |
| 3-5 失敗の可視化 | ✅ 不正question_code=404・非表示=409 と明示エラー（沈黙しない） |
| **4-3 probe別行保存** | ✅ **primary "yes" を残したまま ai_probe 行が別行生成・parent_answer_id 張り済み・ワイヤ'probe'→DB'ai_probe'正規化**。上書きバグ解消を実機確認 |
| 4-4 /liff/chat IDOR | ✅ 他人session は 403 |
| 4-5 probe失敗の非致命 | ✅ LLM 401時も warn のみで `{probe_question:null}`・回答継続 |
| 5-1 完了 | ✅ 200 `alreadyCompleted:false` |
| 5-6 二重完了 | ✅ `alreadyCompleted:true` で冪等 |
| 5-4 非会員ポイント保留 | ✅ user_points 空・履歴0（回答時0pt設計どおり） |
| 6-1 誤表示遮断 | ✅ private_store 2件は projects-data に出ない |
| 6-3 IDOR（回答） | ✅ session+assignment 完全形でも 403 |

**検証できなかった項目**: 4-1/4-6/4-7 の**深掘り文の実生成と品質**（ローカル .env の OpenAI APIキーが 401 で無効。発火条件・上限判定・LLM呼び出し到達までは確認済みで、残るのは生成文そのもの）。3-1〜3-3 の**ブラウザ描画**（HTTP層は通過を確認したが、survey.ejs の実描画は Playwright 未整備のため未実施）。

**この検証で新たに判明した運用上の問題（コードのバグではない）**:
1. ⚠ **本番DBに動作確認用テスト案件3件が `public` + `is_discoverable=true` で残留**（chk2608-survey / chk2608-chat / chk2608-swipe）。前回 Workers 検証の `--discoverable` 実行分。実ユーザーの「探す」一覧に出続けている → 要 false 化。
2. ⚠ **ローカル dev server 起動でスケジューラが本番DB相手に登録される**（朝8時/夜19時/21時＋配信テンプレ2件）。検証のため起動したまま放置すると実ユーザーへ配信が飛ぶ。今回は検証後に即停止済み。
3. ⚠ **完了処理が実LINE pushを行う**（今回は偽ユーザー宛で400。実ユーザーassignmentでの完了検証は本番配信を意味する）。
4. `answer_value` が正しいフィールド名（`answer` ではない）。検証スクリプトを書く際の注意点。

## Receipt: 実機検証 第2回（AI深掘り） — 2026-09-02

**前提の修正**: 第1回で「APIキーが401」としたのは**キーの問題ではなく、Windowsユーザー環境変数 `OPENAI_API_KEY`（旧キー・末尾 r_YA）が .env（新キー・末尾 BosA）を上書きしていた**のが真因。dotenv は既存の環境変数を上書きしないため、**.env を書き換えても永久に反映されない**。今回はセッション限りで `$env:OPENAI_API_KEY` に .env の値を入れて起動し検証した。

**恒久対応（未実施・要ユーザー判断）**: ユーザー環境変数の削除 or 更新が必要。
`[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $null, "User")` で削除すれば以後 .env が効く。
⚠ 他プロジェクトが同じ環境変数に依存している可能性があるため、消す前に確認すること。

**Runtime Verify（実LLM gpt-5-mini）**:

| 項目 | 結果 |
|---|---|
| 4-1 probe発火 | ✅ 実LLMで生成成功（**16.7秒**。従来メモの43秒より速い） |
| 4-2 回数上限 | ✅ 同一設問2回目は `probe_question:null` で打ち止め（maxProbesPerAnswer=1） |
| 4-3 別行保存（実LLM経由） | ✅ primary "yes" 保持のまま ai_probe 行・parent張り済み |
| 4-6 プロンプト解決 | ✅ 設問文脈を正しく反映した深掘り文を生成 |
| 4-7 深掘り品質 | ✅ 下記のとおり良好（人間判定） |

**生成された深掘り文（実物）**:
- 「はい」回答時 → 「先ほど『普段よく使うコンビニ』を選ばれたとのことですが、なぜそのコンビニをよく利用するようになったのか、**立地・品揃え・価格・サービスのうち主にどの点が理由か**を1点だけ具体的に教えてください。」
- 「いいえ」回答時 → 「『no』と回答されています（『その他・使わない』に該当しますか）。なぜ普段コンビニを使わないのか、**利用導線や不便に感じる点のうち一つ**を具体的に教えてください。」

**品質評価**: 前段の回答を正しく引き継ぎ、回答ごとに問いを変え、「1点だけ」と回答負荷を絞れている。誘導的な断定はない。

**例示（立地・品揃え・価格・サービス）について＝欠陥ではない**: 深掘りの例示は**プロンプトで意図的に出し分けている設計**。例示ありで回答負荷を下げる型と、`non_leading` のように例示を排除して素の言葉を引き出す型を作り分けている。したがって検証の判定基準は「例示の有無」ではなく **「指定したプリセットどおりに出し分かるか」**。今回の検証案件はプリセット未適用＝素の標準挙動であり、この出力は仕様どおり。
→ 未検証として残るのは **プリセット別の出し分けが実際に効くか**（同一設問・同一回答で標準/non_leading を切り替え、例示の有無が変わることを確認する）。

⚠ 「『no』と回答されています」と**内部値がそのまま露出**している（ラベル「いいえ」ではない）。回答者から見ると不自然で、これはプリセットとは独立した表示上の課題。

## Receipt: 実機検証 第3回（プリセット別の出し分け） — 2026-09-02

**検証の狙い**: 深掘りの例示は**プロンプトで意図的に出し分けている設計**なので、判定基準は「例示の有無」ではなく **指定したプリセットどおりに出し分かるか**。同一案件・同一設問・同一回答（Q1に "yes"）で、適用パッケージだけを差し替えて実LLM（gpt-5-mini）で各3回生成し比較した。

**前提（調査で判明した構造）**:
- プリセットは version 作成時に `templates_json` へ**焼き込まれる**。実行時にプリセット名で分岐する経路は無く、案件は `ai_prompt_mode='package'` + `ai_prompt_package_version_id`(UUID) で紐づく。
- non_leading は BASE 本文を書き換えず**末尾に追記**する設計。標準の `probeGuidanceChoiceSingle` は逆に例示を促す本文（「例：〇〇を選ばれたとのことですが」）を持つため、**同一プロンプト内に「例示を促す文」と「例示を禁じる文」が共存する**。これが実LLMで正しく打ち消せるかが本検証の要点だった。
- 本番DBには standard / non-leading / young-casual / behavior-evidence の4パッケージが全て v1 published で存在。

**結果: 出し分けは実LLMで明確に機能している（3条件×3回=9回、ブレなし）**

| プリセット | 生成された深掘り文 | 例示 | 字数 |
|---|---|---|---|
| **標準** | 「具体的にはセブン-イレブン／ローソン／ファミリーマート／その他のうちどれを…」 | **あり**（3/3回とも店名列挙） | 68-82字 |
| **non_leading** | 「普段よく使うコンビニの**名前を教えてください**。」 | **なし**（3/3回とも例示ゼロ） | 33-40字 |
| **young_casual** | 「普段よく使うコンビニ名を教えてください。」 | **なし**（3/3回） | **34-37字**（60字制約を遵守） |

判定: ✅ **4-6/4-7 パス**。末尾追記方式でも標準の例示指示を確実に打ち消せており、若年層は非誘導を土台にトーン制約（短文化）が上乗せされる二段構成も設計どおり機能している。

**残る課題（プリセットとは独立）**: 全条件で「『yes』と回答されていますが」と**内部値がそのまま露出**する（ラベル「はい」ではない）。標準・非誘導・若年層いずれでも発生。回答者から見て不自然なので、ラベル解決の修正が要る。

## 修正記録 — 2026-09-02（未コミット・DB変更なし）

### 修正1: 深掘りプロンプトへの内部値露出を解消

**症状**: 選択肢設問で深掘り文が「『yes』と回答されていますが」と **value をそのまま露出**。回答者はラベル（「はい」）しか見ていないため不自然。

**原因**: LIFF の survey_question 経路（`survey.ejs` → `POST /liff/chat`）が選択肢の value を `message` として送り、`liffController.chatMessage` が `analyzeAnswer` へ素通ししていた。
- LINE webhook 経路は `questionFlowServiceV2.parseAnswer` が label 化済みのため**この不具合は出ない**（経路差）。
- interview_chat 経路もクライアントの `formatAnswerForDisplay` を通すため偶然出ていなかった。

**修正**: `src/lib/answerLabel.ts` を新設し、`liffController.ts` の `analyzeAnswer` 呼び出し**1点**で `toDisplayAnswerForPrompt(message, question)` を適用。
- 変換規則は LINE 経路と同一（single=label / multi=label をカンマ結合）＝両経路でプロンプト文面が揃う。
- **`answer_text` の保存・分岐・可視性・スクリーニング・統計エクスポートは一切変更なし**（すべて value 基準の凍結契約）。AI に渡す文字列だけを差し替えている。
- 選択肢に無い値が1つでも混じる場合は変換せず素通し（「その他」自由記述を部分ラベル化して回答を壊さないため）。

**検証**: `src/tests/answerLabel.test.ts` 7件 pass。実LLM3回とも「セブン-イレブン」とラベルで言及（修正前は `seven`）。同時に DB の `answer_text` が `"seven"` のまま保存されることを実データで確認。

### 修正2: `npm test` のゲート漏れを解消（7本 → 77本）

**症状**: 76スイート中 `npm test` は7本しか回さず、店舗・表示モード・プリセット系が**CIゲートから漏れていた**。

**確認**: 全76本を1本ずつ実行したところ **76/76 pass**＝中身は健全で、ゲート設定だけの問題だった。

**修正**: `scripts/runTests.mjs` を新設し `npm test` を全スイート実行に変更。
- **逐次実行**（並列は過去に偽陽性を出した実績があるため。理由をスクリプト冒頭に明記）。
- `node scripts/runTests.mjs <filter>` で部分実行可（例: `npm test` 相当の絞り込み）。
- 旧7本は `npm run test:smoke` として残置。
- tsx を直接起動（npx 経由をやめて実行時間 122秒 → **38.6秒**、DeprecationWarning も解消）。

**結果**: `npm test` = **77/77 pass (38.6s)**、`npx tsc --noEmit` 緑。

### 未実施（承認が必要）

- **本番DBのテスト案件3件の非公開化**: chk2608-survey / chk2608-chat / chk2608-swipe が `public` + `is_discoverable=true` で「探す」一覧に露出中（**assignments=0 ＝ 誰も回答していない**ので影響なし）。`private_store` + `is_discoverable=false` へ戻す更新を試みたが、**本番DBへの書き込みのため自動承認の対象外**として拒否された。実行には明示的な許可が必要。
- ⚠ 併せて `[デモ] デイリーチョコアイス購入実態調査` も一覧に出ているが、**assignments=3 で実利用があるため意図的な公開の可能性**があり、判断を仰ぐまで触っていない。

---

## 現状判定サマリ（2026-09-02 時点）

**条件達成と言えるもの（自動テストで固定済み）**: 入口の解決ロジック・誤表示遮断・presentation決定則・probe別行保存・authRequired 8ケース・validateSurveyモード整合・一括生成の冪等。

**達しているはずだが証拠が無いもの（今回の主対象）**: 表示モード監査 Phase1-6 の修正一式が**実機未検証のまま**。3-1〜3-5, 4-3, 4-4, 5-1〜5-5 を seedDeployCheckProjects + seedDisplayModeVerifyProjects で実機通しすれば、この塊がまとめて判定できる。

**未達（修正 or 意思決定が必要）**:
1. ❌ 2-5 管理画面「複製」単体でのフィールド落ち（店舗運用で複製を使うなら即修正対象）
2. ❌ 3-8 途中再開なし（店舗アンケートは短尺なら許容の判断もあり）
3. ❌ completion / consent の自動テスト不在
4. ❌ `npm test` が7本のみ＝店舗/表示モード系がゲートから漏れている
5. ❌ docs/VERIFY.md 不在（検証レシピが散在）・Playwright 資産未コミット（実機通しが再現不能）
6. ❌ seedDeployCheckProjects.mjs に --cleanup が無い

**推奨の当たり順**: ①セクション0ゲート → ②seed投入して 3章（表示3モード通し）→ ③4章（深掘り）→ ④5章（完了2経路＋会員化）→ ⑤6-1/6-3 実機 → ⑥終わったら cleanup → ⑦未達6件の扱いを決める。
