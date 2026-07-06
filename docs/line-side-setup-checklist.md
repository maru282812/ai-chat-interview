# LINE側 設定変更チェックリスト（サイト化・リッチメニュー）

作成: 2026-07-05 ／ 対象: Hibi 公式LINE（LINE Developers Console ＋ LINE Official Account Manager）

コードは実装済み。ここに書くのは **LINEの管理画面で人が行う設定** だけ。作業は上から順に。
`{LIFF_ID}` `{APP_BASE_URL}` は実値に置き換える（例: APP_BASE_URL = 現在 `https://rabidly-declinatory-karly.ngrok-free.dev`、本番は独自ドメイン）。

---

## 現状の仕組み（前提）

- 今のリッチメニューは **ボタン→テキスト送信→Botが「マイページを開く: https://liff.line.me/…」と返信→そのリンクを再タップ** という2タップ方式（`line_menu_actions` テーブル駆動）。
- これを **ボタン＝直接LIFFを開くURIアクション（1タップ）** に作り替えるのが今回の変更。Botの往復が消えて素直になる。
- LIFF App は機能ごとに複数（survey/mypage/contact…）あるが、**1つに集約**して「サイト」の玄関にする。

---

## A. LIFF App の設定（LINE Developers Console）

`LINE Developers > 該当プロバイダー > LINE Login チャネル（Channel ID = 末尾4167のもの）> LIFF タブ`

### A-1. サイト用に使う LIFF App を1つ選んで endpoint を変更
- 使う LIFF App: **MYPAGE 用（`LINE_LIFF_ID_MYPAGE`）を"サイトの正"に採用**（探す一覧を既にこのIDで開いているため）。
- **Endpoint URL** を次に変更:
  ```
  {APP_BASE_URL}/liff
  ```
  ※ 末尾は `/liff`（ページ名を付けない基底URL）。こうすると `https://liff.line.me/{LIFF_ID}/projects` のようにパスを足したディープリンクが `/liff/projects` に解決される。無印で開かれた場合はコード側で `/liff/projects` へ302リダイレクト済み。
- **Scope**: `profile`, `openid` にチェック（既存のままでよいはず）。
- **Size**: `Full`（全画面）。

### A-2. 他の LIFF App（survey/contact 等）はどうするか
- **触らなくてよい**（当面は個別IDのまま動く）。env統合（下記C）で最終的に同一IDへ寄せると、通知や当選URLも同じサイトLIFFで開くようになる。
- 完全統合を急がないなら、A-1のMYPAGE用IDだけ整えればリッチメニュー導線は成立する。

---

## B. リッチメニュー（LINE Official Account Manager）

`LINE Official Account Manager > ホーム > リッチメニュー > 作成`
（画像は 2500×1686 の6分割＝2行×3列を推奨）

### B-1. 基本設定（＝「起動条件」に相当する項目）
| 設定項目 | 値 |
|---|---|
| タイトル（管理用） | Hibiメインメニュー v2 |
| 表示期間 | 期限なし（常時） |
| メニューバーのテキスト | `メニュー` |
| メニューのデフォルト表示 | **表示する**（友だちが開いたとき最初から開く） |
| テンプレート | 大（6分割：2×3） |

> 「起動条件」を細かく出すと: このリッチメニューを **デフォルトリッチメニュー** に設定する＝全友だち共通で表示。特定ユーザーだけ別メニューにする場合は Messaging API の richmenu alias が必要だが、**今回は全員同一で可**（会員/未会員の出し分けは不要。未同意者は各ページ内の同意ゲートで捕捉するため）。

### B-2. 6ボタンのアクション設定（各エリア）

すべて **アクション種別 = リンク（URI）** を選び、URLに以下を設定する。テキスト送信ではなく**直接リンク**にするのがポイント（1タップでLIFFが開く）。

| # | 位置 | ボタン文言（画像に描く） | アクション種別 | リンクURL |
|---|---|---|---|---|
| 1 | 左上 | さがす | リンク | `https://liff.line.me/{LIFF_ID}/projects` |
| 2 | 中上 | おすすめ | リンク | `https://liff.line.me/{LIFF_ID}/projects?sort=osusume` |
| 3 | 右上 | 保存 | リンク | `https://liff.line.me/{LIFF_ID}/saved-projects` |
| 4 | 左下 | やりとり | リンク | `https://liff.line.me/{LIFF_ID}/interactions` |
| 5 | 中下 | マイページ | リンク | `https://liff.line.me/{LIFF_ID}/mypage` |
| 6 | 右下 | ヘルプ | リンク | `https://liff.line.me/{LIFF_ID}/contact`（または既存のご利用ガイドURL） |

補足:
- 各エリアの「アクションのラベル」（アクセシビリティ/音声読み上げ用テキスト）にも同じ文言（さがす等）を入れておく。
- 「おすすめ」の `?sort=osusume` は将来のおすすめ順表示用パラメータ。現状は新着順で開くだけで害はない（実装が付いたら効く）。
- ボタン文言・アイコンは確定モック **p82** の配色（クリーム地・ゴールドアイコン・チャコール文字）に合わせる。

### B-3. 公開
- 保存 → **「デフォルトのリッチメニューに設定」** して公開。旧メニューは自動で置き換わる。

---

## C. 環境変数（.env・LINE管理画面ではなくサーバ側）

LINE操作ではないが、統合の仕上げとしてセットで実施:

```env
# サイトLIFFの1本化：全部 MYPAGE 用に採用した ID へ寄せる
LINE_LIFF_ID=<サイトLIFFのID>          # フォールバックも同値に
LINE_LIFF_ID_MYPAGE=<サイトLIFFのID>    # ← A-1で endpoint を /liff にしたID
LINE_LIFF_ID_SURVEY=<サイトLIFFのID>    # 当選通知の回答URLも同じLIFFで開くようになる
LINE_LIFF_ID_CONTACT=<サイトLIFFのID>   # ヘルプも同じLIFFに寄せる場合
```
- `LINE_LIFF_CHANNEL_ID`（末尾4167）は**変更不要**（IDトークン検証に使う LINE Login チャネルID）。
- 反映後にサーバ再起動。

---

## D. 動作確認（公開前チェック）

- [ ] リッチメニュー「さがす」タップ → LINE内で探す一覧が**1タップで**開く（Botの返信リンクを経由しない）
- [ ] 「マイページ」→ マイページ、「やりとり」→ やりとり、「保存」→ 保存一覧が開く
- [ ] auto案件を「応募してすぐ回答する」→ そのまま回答→完了→**LINEに完了通知＋ポイント反映**
- [ ] manual案件を応募→ admin `/admin/applications` で当選→ **LINEに当選通知（回答URL付き）が届き**、そのURLで回答できる
- [ ] LIFF内でログイン画面が出ない（＝endpoint/Channel ID が正しい）

---

## E. やらないこと / 注意

- **`line_menu_actions` テーブルは今回いじらない**。テキストで「マイページ」等と打った時のBot返信フォールバックとして残る。リッチメニューはURIに移すので、このテーブルはリッチメニューの見た目・挙動には影響しない。
- 旧・機能別LIFF（rant/diary/personality）は別導線として温存。今回のサイト用ID統合とは無関係。
- 独自ドメイン移行時は `APP_BASE_URL` と LIFF endpoint（A-1）の両方を新ドメインに更新すること（ngrokのままだと再起動でURLが変わり全リンクが切れる）。
