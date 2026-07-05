# LINE移行 変更ログ（ロールバック台帳）

目的: **サイト化への移行期**の記録。旧形態（機能別LIFF＋テキスト起動リッチメニュー）から
新形態（1本LIFF＋URI直リンクリッチメニュー）へ切り替える。**旧に戻せるよう、変更前の値と戻し方を必ず残す。**

運用ルール:
- LINE管理画面を触る前に「変更前」の値を**このファイルに書き写してから**変更する（コンソールは履歴が残らないため）。
- 1変更＝1エントリ。日付・担当・戻し方をセットで書く。
- 「旧形態がダメなら戻す」判断のため、各エントリに **判定基準** と **ロールバック手順** を必ず入れる。

---

## 移行前スナップショット（2026-07-05 時点・変更に入る前の状態）

### LIFF App（LINE Developers Console）
| 用途 | env キー | LIFF ID（末尾） | 現在の Endpoint URL ※要記入 |
|---|---|---|---|
| サイト正（採用予定） | LINE_LIFF_ID_MYPAGE | …T8sSk1w5 | `________________________`（変更前に控える） |
| 回答 | LINE_LIFF_ID_SURVEY | …GoscTkxr | `________________________` |
| 汎用フォールバック | LINE_LIFF_ID | （未設定 hasLineLiffId=false） | — |
| 問い合わせ | LINE_LIFF_ID_CONTACT | ※要確認 | `________________________` |
| Login チャネルID | LINE_LIFF_CHANNEL_ID | …4167 | （変更しない） |

> ⚠ Endpoint URL の現在値は LINE Developers Console でしか確認できない。**変更ボタンを押す前に上表へ必ず書き写す**（ロールバックの生命線）。

### リッチメニュー（LINE Official Account Manager）
- 現行方式: **テキスト起動**（ボタン→テキスト送信→Botが `line_menu_actions` を引いてLIFFリンクを返信→再タップ）。
- 現行メニューの構成（画像・ボタン文言・並び）: `________________________`（スクショを控えるか、現行リッチメニューを複製して保存）。
- `line_menu_actions`（DB）の現行行: participate_research / share_rant / today_feeling / mypage / personality（008_free_comment_system_question.sql のseed）。**今回このテーブルは変更しない**＝テキスト打ちの旧導線はそのまま残る＝リッチメニュー切替の保険になる。

### サーバ（env / コード）
- 現行 APP_BASE_URL: `https://rabidly-declinatory-karly.ngrok-free.dev`（ngrok・再起動で変わる点に注意）。
- コードは「サイト化 Phase1-5」実装済み・**未コミット**（下記 変更#0）。

---

## 変更エントリ

### 変更 #0 ─ コード実装（サイト化 Phase1-5） 〔2026-07-05・実施済み/未コミット〕
**内容**: 応募モデル＋Hibi UI＋応募APIの実装。詳細は docs/plan-site-implementation.md。
- 追加: migration 072（project_applications＋projects 5カラム）/ 073（project_favorites GRANT修正）
- 追加: src/services/applicationService.ts, src/repositories/projectApplicationRepository.ts, src/views/admin/applications/, src/public/hibi.css, src/tests/applicationService.test.ts
- 変更: liffController / adminController / projectRepository / liffRoutes / adminRoutes / templates/flex.ts / domain.ts / researchForm.ejs / header.ejs / projects.ejs / project-detail.ejs / interactions.ejs
- 追加(ルート): `GET /liff/` → `/liff/projects` へ302リダイレクト（LIFF endpointを `/liff` 基底にするための受け）

**判定基準**: `npx tsc --noEmit` クリーン・全27テストpass・E2E（auto応募→即回答／manual→admin当選→通知）確認済み。

**ロールバック**:
- コード: 未コミットなので `git checkout -- <file>` / 新規ファイル削除で戻せる。コミット後は revert 対象コミットを控えること。
- DB: 072/073 は**既存を壊さない追加のみ**（projects へのカラム追加＋新テーブル＋GRANT）。戻す場合は
  `ALTER TABLE projects DROP COLUMN tags, ng_conditions, recruit_deadline, apply_mode, interview_format;`
  `DROP TABLE project_applications;`（073のGRANTは戻す必要なし＝既存バグ修正なので残す）。
- **旧一覧/詳細UIに戻したい場合**: projects.ejs / project-detail.ejs / interactions.ejs を変更前に戻す（git）。応募APIは呼ばれなくなるだけで害はない。

---

### 変更 #1 ─ LIFF endpoint 変更（サイトLIFFを /liff 基底に） 〔予定〕
**対象**: LINE_LIFF_ID_MYPAGE（…T8sSk1w5）の Endpoint URL
**変更前**: `________________________`（#移行前スナップショットに控えた値）
**変更後**: `{APP_BASE_URL}/liff`（例: `https://rabidly-declinatory-karly.ngrok-free.dev/liff`）

**判定基準（これがOKなら旧に戻さない）**:
- [ ] リッチメニュー各ボタンが1タップで正しいページを開く
- [ ] **既存の「マイページ」テキスト返信リンクが壊れていない**（← 最重要。endpoint変更でmypage直リンクの解決先が変わる可能性。切替後すぐ確認）
- [ ] LIFF内でログイン画面が出ない

**ロールバック**: Endpoint URL を「変更前」の値に戻すだけ（即時反映）。リッチメニューをURI化済みなら、テキスト起動の旧メニューに一時的に戻すことも可（変更#3のバックアップメニュー）。

---

### 変更 #2 ─ env の LIFF ID 統合 〔予定〕
**変更前**:
```
LINE_LIFF_ID_SURVEY=2010174167-GoscTkxr
LINE_LIFF_ID_MYPAGE=2010174167-T8sSk1w5
LINE_LIFF_ID=（未設定）
LINE_LIFF_ID_CONTACT=（要確認）
```
**変更後**: 全て `2010174167-T8sSk1w5`（サイトLIFF）へ寄せる。
**判定基準**: 当選通知の回答URLがサイトLIFFで開き回答完了できる／回答→完了通知→ポイント反映が通る。
**ロールバック**: .env を上記「変更前」に戻してサーバ再起動。**変更前の値をこのブロックに残すこと。**

> 注意: SURVEY を統合すると回答画面のendpointも変わる。回答が別endpoint（…/liff/survey）前提の場合、endpoint統合後に回答URLの解決を必ず実機確認。ダメなら SURVEY は旧IDのまま据え置き（部分統合）に倒す。

---

### 変更 #3 ─ リッチメニュー URI化 〔予定〕
**変更前**: テキスト起動メニュー（現行）。→ **公開前に現行メニューを複製して「旧メニュー（バックアップ）」として保存**しておく。
**変更後**: 6ボタンURI直リンク（docs/line-side-setup-checklist.md B-2 の表）。
**判定基準**: D節チェックリスト全通過。
**ロールバック**: LINE Official Account Manager で「旧メニュー（バックアップ）」をデフォルトに再設定するだけ（画像・アクションは複製済みなので即復旧）。

---

## 移行完了の宣言（すべて安定したら記入）
- 完了日: __________
- 旧形態（機能別LIFF endpoint / テキスト起動メニュー）の撤去可否判断: __________
- 撤去した場合の記録: __________
