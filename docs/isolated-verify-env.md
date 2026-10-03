# 隔離検証環境（testmaster の blocked 項目を実データで回すため）

本番 Supabase しか接続先が無く、publish / close / assign のような**書き込みを伴う検証**が
できない状態だったので、ローカル Supabase で隔離環境を用意した。

## 何が動くようになったか

testmaster の blocked 14件のうち **13件が実データで検証できるようになった**
（残り1件は LINE 実機が必要な TM-311「LINE⇄サイトの無限ループ」）。

## ポート

他プロジェクトのローカル Supabase と衝突するので、**546xx 帯**を使う（`supabase/config.toml`）。

| 用途 | ポート |
|---|---|
| API (Kong) | 54621 |
| DB (Postgres) | 54622 |
| Studio | 54623 |
| Mailpit | 54624 |
| Pooler | 54629 |
| アプリ（隔離） | **3101** |

既に使用中の帯: 543xx=ai-tube / 544xx=resto-sns / 545xx=ai-trust。

## 起動手順

```bash
# 1) Docker Desktop を起動（WSL の docker-desktop ディストロが Stopped だと
#    プロセスが живой でもエンジンの named pipe が出ないので、その場合は下を先に打つ）
wsl --distribution docker-desktop --exec /bin/true

# 2) Supabase（migration/seed は config で無効化してある。理由は下記）
npx supabase start

# 3) migration を依存順で流す（115本）
node <scratch>/applyLocal.mjs
```

### migration を `supabase start` に任せない理由（重要）

`supabase/config.toml` で `[db.migrations] enabled = false` にしている。
**034 と 035 の依存順が逆**で、白紙から流すと必ず落ちるため。

```
034_notification_templates_seed.sql
  → daily_question_priorities に attr_key='car_ownership' 等を INSERT
035_attribute_definitions_daily_keys.sql
  → その attr_key を attribute_definitions に登録（コメントに「事前登録」と書いてある）
```

FK `daily_question_priorities_attr_key_fkey` 違反で 034 が失敗する。
035 を 034 の前に流すと **115/115 すべて成功する**。

本番は増分で育ったため顕在化していないが、**白紙からの再構築（DR・新環境・CI）はできない状態**。
migration の並べ替えは DB 変更なので、このドキュメントでは repo の migration を書き換えず
適用順だけ入れ替えている。恒久対応は別途判断が必要（下記「残課題」）。

## アプリを隔離環境に向ける

`src/config/env.ts` の `loadDotEnv()` は `.env`（＝**本番 Supabase**）をハードコードで読む。
dotenv は既に設定済みの `process.env` を上書きしないので、**環境変数として先に渡せば勝つ**。

`.env.tmverify`（`.gitignore` の `.env*` で除外済み）を作り、起動スクリプトが
それを `process.env` に載せてから子プロセスを起動する。

隔離環境で必ず潰すもの:

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` → ローカル(54621)
- `SUPABASE_PROJECT_REF` / `SUPABASE_ACCESS_TOKEN` → Management API で本番を触れないように
- `SUPABASE_URL_mental` 系 → 別プロジェクトの本番
- `LINE_CHANNEL_ACCESS_TOKEN` → ダミー（**server.ts はスケジューラを無条件起動する**ので、
  枠の時刻に当たると実ユーザーへ push が飛ぶ）
- `PORTAL_OPS_URL` → 到達不能アドレス

起動前に「`SUPABASE_URL` がローカルか」「本番 ref が残っていないか」「LINE トークンが
ダミーか」を検査して、満たさなければ**起動しない**ようにしている。

## 検証用データの作り方

本番データを持ち込まず、アプリ自身の API とリポジトリの seed スクリプトで作る。

```bash
# 業種テンプレ（ABCサイクルの原本）。projects → template の順でないと落ちる
SUPABASE_URL=http://127.0.0.1:54621 SUPABASE_SERVICE_ROLE_KEY=<local> \
  node scripts/seedRestaurantSurveyProjects.mjs
SUPABASE_URL=http://127.0.0.1:54621 SUPABASE_SERVICE_ROLE_KEY=<local> \
  node scripts/seedRestaurantIndustryTemplate.mjs
```

パートナー案件は `POST /api/partner/surveys` を実APIで叩いて作る（storeA / storeB の
2店舗を作ると所有者スコープ＝IDOR の検証ができる）。データは `[TMTEST]` 接頭辞にする。

## LIFF 認証を通す

`liffAuthService` に非本番専用の seam がある（`NODE_ENV=production` では分岐に入らない）。

```
Authorization: Bearer tmtest:<lineUserId>
```

**ヘッダで渡す**（body の `id_token` に入れる形は今回通らなかった）。これで
`POST /liff/store/resolve` が 200 を返し、assignment まで到達できる。

## 停止

```bash
npx supabase stop            # コンテナは残る（--no-backup でボリュームも消える）
```

`[TMTEST]` データを消すときは projects を消せば回答・assignment は CASCADE で落ちる。

## 残課題

- **034/035 の依存順**: 白紙再構築が不可能な状態。migration の並べ替え（または 034 から
  該当 INSERT を分離）が必要。DB 変更なので適用前に migration-review を通すこと。
- **zod 4 の `.uuid()` がバージョン桁を検証する**: `20000000-0000-0000-0000-000000000003`
  のような**バージョン桁が 0 の UUID** は弾かれる。`GET /assignable-surveys` は
  `assignable:true` で返すのに `GET/POST /surveys/:id` 系が 404 になり、
  **一覧に出るのに割り当てられない**案件ができる。該当は migration 044 の `[デモ]` 6件
  （本番にも存在）。partner / partner-admin の `:id` 系 15 経路が影響を受ける。
- TM-311（LINE⇄サイトの無限ループ不発生）は LINE 実機でしか確証できない。
  URL 生成側の恒久URL化は `src/tests/liffUrlBuilders.test.ts` で機械的に担保済み。
