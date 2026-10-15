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
理由は **067 が2本あること**。

```
067_document_usage_category.sql     （書類の用途区分）
067_respondent_test_flag.sql        （回答の有効性フラグ）
```

中身は別物で、別コミットで同じ番号に衝突した。Supabase CLI は
`supabase_migrations.schema_migrations` の主キーをファイル名のバージョン部分
（=`067`）にするため、2本目の記録で duplicate key になって `db reset` が止まる。

**このプロジェクトの正準は `npm run db:migrate`（`scripts/applyMigrations.mjs`）**で、
こちらは `_app_migrations` の**ファイル名**を主キーにし、同番号は `localeCompare` で
順序を決めるため 067 が2本でも問題なく通る。本番もこの経路なので影響はない。

⚠ **番号を振り直してはいけない。** `_app_migrations` はファイル名で適用済みを見るので、
リネームすると「未適用」と判定されて**本番で再実行される**。CLI 側の制約に
合わせる価値より再実行事故のリスクが大きい。したがって CLI には任せず、
ローカルは `scripts/isolated/applyMigrationsLocal.mjs` で psql に直接流す。

### 修正済み: 034 の FK 依存（旧・白紙再構築が不可能だった原因）

以前は 034 が落ちて白紙再構築ができなかった。

```
034 → daily_question_priorities に attr_key='car_ownership' 等を INSERT
035 → その attr_key を attribute_definitions に登録（コメントは「事前登録」）
```

FK `daily_question_priorities_attr_key_fkey` 違反。**034 に 035 と同じ
`ON CONFLICT (attr_key) DO NOTHING` 付き INSERT を持たせて自己完結させた**
（番号の振り直しは上記の再実行事故になるため採らない）。035 が適用済みの環境では
完全な no-op なので、本番への影響はない。

これにより **ファイル名順そのままで 117/117 適用できる**（修正を戻すと 034 で
FK 違反になることを実測して確認済み）。

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

- **067 が2本ある**: `npm run db:migrate`（正準）では問題ないが、Supabase CLI の
  `db reset` は通らない。番号の振り直しは本番での再実行事故になるため、CLI を
  使いたい場合は `schema_migrations` 側を手当てする等の別手段が必要。
- **zod 4 の `.uuid()` がバージョン桁を検証する**: `20000000-0000-0000-0000-000000000003`
  のような**バージョン桁が 0 の UUID** は弾かれる。`GET /assignable-surveys` は
  `assignable:true` で返すのに `GET/POST /surveys/:id` 系が 404 になり、
  **一覧に出るのに割り当てられない**案件ができる。該当は migration 044 の `[デモ]` 6件
  （本番にも存在）。partner / partner-admin の `:id` 系 15 経路が影響を受ける。
- TM-311（LINE⇄サイトの無限ループ不発生）は LINE 実機でしか確証できない。
  URL 生成側の恒久URL化は `src/tests/liffUrlBuilders.test.ts` で機械的に担保済み。
