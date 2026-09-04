# ミッション Phase 2残（部屋）＋ Phase 3（隠し部屋・山分け・抽選）実装仕様

作成: 2026-09-04 / 親計画: [plan-mission-phases.md](plan-mission-phases.md) / モック: `mockups/campaign/game.html` §5・§7・§8

## 実装目的

- **部屋**: 「探す」の案件を `projects.category` でテーマ別の部屋に見せ、
  「すきな部屋からどうぞ」の回遊導線を作る（Phase 2 の残作業 2-3）。
- **隠し部屋**: 「まだひらいていない部屋がある」で継続動機を作り、
  山分け・一律・抽選の報酬を**すべて景表法・賭博罪の安全設計**（下記）で載せる。

## 法的設計条件（コードで強制するもの）

| 条件 | 実装 |
|---|---|
| 全報酬 1人あたり上限 2,000pt（D-19） | `PER_PERSON_CAP` を純関数で適用＋DB CHECK の二重 |
| 山分けは締切後に確定（D-16） | cron の settle バッチ。1人あたり `min(2000, floor(原資/人数))` |
| 「回答が多いほど当たりやすい」不可（D-17） | 抽選は**1人1口・等確率**。口数の概念をテーブルに持たない |
| ランダムは「いつ出るか」だけ | 開く時刻をサーバーが保存時に乱数確定。**中身（額）は全員同じ**。ハズレなし |
| 先着は明文で安全（運用基準3） | 入室行の COUNT で先着N判定 |
| ポイントを払って抽選は賭博（絶対不可） | 参加＝入室＋回答のみ。ポイント消費の配管が存在しない |
| 規模を見せない（D-1） | 参加人数・山分けの実人数は画面に出さない。ルール文言のみ |

## 部屋（Phase 2 残）

- 部屋 = discoverable 案件（`listDiscoverable`）を `category` で自動グルーピング。
  **部屋定義テーブルは作らない**（0件の部屋はそもそも生成されない＝D-14系の空部屋問題も消える）。
- 進捗 = 自分の respondents（status=completed）に部屋内の案件があるか。
  クリア = 部屋の全案件を回答済み。
- ミッションページに部屋グリッドを表示。タップで `/liff/projects?category=<カテゴリ>`
  （projects.ejs にクエリ初期フィルタを追加。ナビ自体は変更しない＝R-9）。
- 隠し部屋のカテゴリは通常部屋の一覧から**除外**する（先に見えたら隠しにならない）。

## 隠し部屋（Phase 3）

### DB — migration 099

- `mission_hidden_rooms`: mission_id（UNIQUE＝1ミッション1部屋）／category／
  open_mode `rooms_cleared|schedule|first_n|random`／rooms_needed／opens_at／closes_at／first_n／
  award_mode `split|flat|raffle`／pot_points／flat_points（CHECK ≤2000）／
  prize_points（CHECK ≤2000）／winners_count／settled_at
- `mission_hidden_entries`: hidden_room_id×line_user_id UNIQUE。入室記録＝先着判定と参加者集合
- `mission_hidden_awards`: hidden_room_id×line_user_id UNIQUE。結果表示と冪等の記録

### 状態機械（純関数 `missionRooms.ts`）

`locked → open →（split/raffle: awaiting → settled ／ flat: closed）`
- rooms_cleared: 自分のクリア部屋数 ≥ rooms_needed で open（**ユーザーごと**）
- schedule / random: opens_at ≤ now ≤ closes_at（random は保存時に開く時刻を乱数確定して opens_at に格納）
- first_n: 入室済み or 入室数 < N。満員は `full`

### 参加と資格

1. 「この部屋にはいる」→ POST（サーバーが open を再検証して entry 記録）→ 部屋の案件一覧へ
2. **資格 = 入室後に部屋カテゴリの案件を1件以上回答完了**（仕事の報酬の枠に載せる）
3. flat は資格成立をページ読込時に検出して即付与（ステージと同じ読み時評価）
4. split / raffle はミッション終了後の settle バッチで確定

### settle バッチ（cronDispatchService に追加）

- 対象: is_active ミッションの ends_at < now かつ settled_at IS NULL
- split: 1人 `min(2000, floor(pot/資格者数))`。raffle: 資格者から winners_count 名を
  **seed=部屋ID の決定的選出**（再実行で当選者がブレない）で prize_points ずつ
- awardPoints の idempotency_key `hidden:{roomId}:{user}` ＋ awards テーブル UNIQUE の二重冪等
- 付与後に LINE push（失敗しても付与は成立＝Phase 1 と同じ「付与が正・通知は従」）
- 全付与後に settled_at を立てる（途中クラッシュは次分の cron が再実行・冪等で安全）

## 変更ファイル

| 種別 | パス | 内容 |
|---|---|---|
| 新規 | supabase/migrations/099_mission_hidden_rooms.sql | 上記3テーブル＋GRANT |
| 新規 | src/lib/missionRooms.ts | 部屋ビュー・状態機械・山分け/抽選の純関数 |
| 新規 | src/tests/missionRooms.test.ts | 純関数テスト |
| 新規 | src/repositories/missionHiddenRoomRepository.ts | 隠し部屋・入室・付与記録 |
| 新規 | src/services/missionHiddenRoomService.ts | 入室・状態解決・flat付与・settle |
| 修正 | src/repositories/missionRepository.ts | 完了案件ID一覧（部屋進捗用） |
| 修正 | src/services/missionService.ts | getPageData に rooms / hiddenRoom を追加 |
| 修正 | src/controllers/missionController.ts | enter API・admin フォーム受け |
| 修正 | src/routes/liffRoutes.ts | POST /liff/mission/:id/hidden-room/enter |
| 修正 | src/views/liff/mission.ejs | 部屋グリッド＋ボスカード |
| 修正 | src/views/liff/projects.ejs | ?category= 初期フィルタ |
| 修正 | src/views/admin/mission/form.ejs | 隠し部屋セクション |
| 修正 | src/services/cronDispatchService.ts | hidden_room_settle ジョブ |

## 完了条件

- [ ] typecheck / test / build 緑
- [ ] migration 099 本番適用＋テーブル存在確認＋GRANT 確認
- [ ] 純関数テスト: キャップ・状態遷移・先着境界・決定的抽選・0人山分け
- [ ] 実機（モバイルビューポート）でミッションページに部屋・ボスカードが出る
