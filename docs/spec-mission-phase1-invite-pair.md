# 実装仕様書: ミッション Phase 1 — 招待とペアアンケート

作成: 2026-09-04 / 状態: **未実装**
関連: [requirements/requirements.md](../requirements/requirements.md) ／
[requirements/legal-premium-act.md](../requirements/legal-premium-act.md) ／
モック: `mockups/campaign/`

## 目的

参加率の向上と新規会員の獲得。既存会員が友だちを招待し、双方がアンケートに答えると
両者にポイントが入る。招待された人はペア設問に答えると「答え合わせ」が見られる。

**Phase 1 に限定する理由**: 招待とペアは景表法の調査で**規制対象外と確認済み**
（定義告示運用基準 4(7) と 5(3)）。ステージ・部屋・隠し部屋は Phase 2 以降。
抽選・山分けは**弁護士確認が完了するまで着手しない**。

## スコープ外（今回やらないこと）

- ステージ（段階報酬）・部屋えらび・隠し部屋・山分け・抽選 → Phase 2 / 3
- テーマ15種の切り替え → Phase 2（Phase 1 は既定テーマ固定）
- 「戻る」レイヤー（連続記録の復元） → Phase 3
- 招待ツリーの可視化・紹介ランキング → **不採用**（D-6 / D-7）
- 既存ナビ（探す/回答する/やりとり/マイページ）の変更 → **禁止**（R-9）

## 前提（既存コードの確認済み事項）

| 項目 | 実態 |
|---|---|
| 構成 | Express + EJS（Next.js ではない）。ルートは `src/routes/liffRoutes.ts` / `adminRoutes.ts` |
| 画面 | `src/views/liff/*.ejs`、共通は `src/views/partials/*`、CSS は `src/public/hibi.css` |
| 認証 | LIFF IDトークン検証。`liffAuthService` / `partials/liff-auth.ejs` |
| ポイント付与 | `userPointService.awardPoints()`。`idempotencyKey` で二重付与を防ぐ（23505 ハンドリング済み） |
| 品質係数 | `qualityFactor` / `basePoints` / `qualityReasons` を awardPoints に渡す |
| LIFF URL 生成 | **必ず `liffService` のヘルパー経由**。`APP_BASE_URL` 直組みは無限ループ事故の元（PR#37） |
| 最新 migration | `096_industry_templates_and_stores.sql` → 本仕様は **097** |
| GRANT | 新規テーブルには `GRANT ... TO service_role` を明示（074 の事故を繰り返さない） |

## 画面

### U-1 招待ランディング（URL: `/liff/invite/:token`）— **未ログインで閲覧可**

新規獲得の生命線。未登録の人が最初に見る唯一の画面。

- **表示項目**: 招待者の表示名／受け取れるポイント（100pt）／所要時間（約3分）／
  設問形式（選ぶだけ）／回答の公開有無（ありません）
- **操作**: 「はじめる」ボタン1つのみ（LINE ログインへ）
- **禁止**: 参加人数・累計回答数・全体ゲージ・ランキングを**表示しない**（D-1）。
  少人数期は過疎の証明になる。出すのは「〇〇さんから招待されました」という1対1の事実のみ
- **状態**:
  - 有効 … 通常表示
  - 期限切れ／招待上限到達／無効化済み … 理由を明示し「Hibi について見る」に誘導。**無言404にしない**
  - 自己招待（同一 line_user_id） … 「自分の招待は使えません」
  - 既存会員が踏んだ … 招待報酬なしと明示。ペア回答は成立させる
  - トークン不正 … 期限切れと同じ扱い（存在の有無を漏らさない）

### U-3 ペア設問の回答（URL: `/liff/pair/:pairId/answer`）

- **表示項目**: 相手の表示名／設問（**選択式のみ**）／進捗ドット
- **操作**: 選択して次へ。既存 `partials/answer-ui.ejs` を流用
- **状態**: 未回答／回答中／自分だけ完了（相手待ち）／両者完了→U-4へ／期限切れ／**設問0件**

### U-4 答え合わせ（URL: `/liff/pair/:pairId/result`）

- **表示項目**: 一致/不一致の**判定のみ**、自分自身の回答、相手は**表示名まで**
- **順序**: 一致した設問を先に、不一致を後に（驚きの設計）
- **⚠ 絶対条件（D-10 / D-11）**: **相手の回答原文を一切表示しない**。
  規約 v2.0 第10条4項(1)「回答原文を第三者に提供しない」にペア相手も該当する
- **状態**: 両者完了／相手未回答（催促導線）／期限切れ／相手退会

### A-1 招待実績一覧（URL: `/admin/mission/invites`）

- **表示項目**: 招待者／被招待者／状態／付与額／登録日時／同一端末フラグ／回答数と招待数の比
- **操作**: 不正の取消（`manual_adjustment` で減算）
- **「要確認」の条件**: 招待数に対し本人の回答数が極端に少ない（招待偏重＝自作自演の典型）

## API

すべて `src/routes/liffRoutes.ts` / `adminRoutes.ts` に追加。既存の `asyncHandler` を使う。

### `GET /liff/invite/:token`
- 種別: ページ（EJS レンダリング）
- 認可: **不要**（未ログインで閲覧可）
- 出力: 招待者の表示名・報酬額・状態。**トークンの有効性以外の情報を漏らさない**

### `POST /liff/invite/:token/accept`
- 認可: LIFF 認証必須
- 処理: 自己招待・重複・上限・期限を検証 → `mission_invites` を `registered` に更新 →
  被招待者へ 100pt、招待者へ 50pt を即時付与
- 冪等キー: `invite:{inviteId}:register`
- エラー: `self_invite` / `already_used` / `limit_reached` / `expired` / `already_member`

### `GET /liff/pair/:pairId/data`
- 認可: LIFF 認証必須。**pair の当事者のみ**（所有者検証を必ず行う）
- 出力: 設問・自分の回答状況・相手の回答**有無のみ**（内容は返さない）

### `POST /liff/pair/:pairId/answer`
- 認可: 同上
- 処理: 回答保存 → 両者完了なら `completed_at` を立て、招待者へ 150pt 付与
- 冪等キー: `pair:{pairId}:complete`
- 品質判定: `qualityScore` を通す。基準未満はペア報酬を**付与しない**

### `GET /liff/pair/:pairId/result`
- 認可: 同上。**両者完了時のみ** 200。未完了は 409
- 出力: 設問ごとの `matched: boolean` と**自分の選択肢のみ**。
  **相手の選択肢を返してはいけない**（D-10）

## DB（migration 097）

```sql
-- 097_mission_invites_and_pairs.sql
--
-- 招待とペアアンケート。ステージ・部屋・隠し部屋は Phase 2 以降で別 migration。
-- 破壊性: なし（新規テーブルのみ）
-- rollback:
--   DROP TABLE IF EXISTS pair_answers;
--   DROP TABLE IF EXISTS survey_pairs;
--   DROP TABLE IF EXISTS mission_invites;

-- 招待
CREATE TABLE IF NOT EXISTS mission_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text NOT NULL UNIQUE,          -- 推測不能（32文字以上のランダム）
  inviter_id    text NOT NULL,                 -- 招待した人の line_user_id
  invitee_id    text,                          -- 登録後に埋まる
  status        text NOT NULL DEFAULT 'issued'
                CHECK (status IN ('issued','registered','answered','expired','revoked')),
  registered_at timestamptz,
  answered_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  -- 不正検出の材料（migration 086 の行動計測から取る）
  signup_ua     text,
  signup_ip     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_not_self CHECK (invitee_id IS NULL OR invitee_id <> inviter_id)
);
CREATE INDEX IF NOT EXISTS ix_mission_invites_inviter ON mission_invites (inviter_id);
-- 同じ人を2回招待しても2回払わない
CREATE UNIQUE INDEX IF NOT EXISTS ux_mission_invites_pair
  ON mission_invites (inviter_id, invitee_id) WHERE invitee_id IS NOT NULL;

-- ペア
CREATE TABLE IF NOT EXISTS survey_pairs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id    uuid NOT NULL REFERENCES mission_invites(id) ON DELETE CASCADE,
  user_a       text NOT NULL,                  -- 招待者
  user_b       text NOT NULL,                  -- 被招待者
  expires_at   timestamptz NOT NULL,           -- 成立期限（既定14日）
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pair_distinct CHECK (user_a <> user_b)
);
CREATE INDEX IF NOT EXISTS ix_survey_pairs_users ON survey_pairs (user_a, user_b);

-- ペア回答。選択式のみ（D-11）＝自由記述カラムを持たない
CREATE TABLE IF NOT EXISTS pair_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     uuid NOT NULL REFERENCES survey_pairs(id) ON DELETE CASCADE,
  line_user_id text NOT NULL,
  question_id uuid NOT NULL,
  choice_code text NOT NULL,                   -- 選択肢コードのみ。自由記述は保存しない
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pair_id, line_user_id, question_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON mission_invites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_pairs   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON pair_answers   TO service_role;
```

**設計判断の記録**:
- `pair_answers` に**自由記述カラムを作らない**。D-11 をスキーマで強制する
- 保留ポイントは**テーブルに持たない**。`user_points.pending_points` は
  `exchange_request` 専用で流用できない（R-1）。確定時に初めて `awardPoints` を呼ぶ

## 権限

| 操作 | 未ログイン | 一般会員 | 管理者 |
|---|---|---|---|
| 招待LPの閲覧 | ✅ | ✅ | ✅ |
| 招待の受諾 | ❌ | ✅（自己招待を除く） | — |
| 招待リンクの発行 | ❌ | ✅（上限10件/人） | — |
| ペア設問の回答 | ❌ | ✅（当事者のみ） | — |
| 答え合わせの閲覧 | ❌ | ✅（当事者かつ両者完了） | — |
| 招待実績の閲覧・取消 | ❌ | ❌ | ✅ |

**RLS 方針**: 既存と同じくアプリ層（service_role）で認可する。
LIFF API は `verifyAssignmentOwnerOrThrow` と同型の所有者検証を**必ず通す**
（session/assignment 突合欠落による IDOR を過去に作った経緯がある）。

## 受け入れ条件

**正常系**
- [ ] 招待リンクを発行でき、未ログインで LP が開く
- [ ] 招待された人が登録すると、被招待者に100pt・招待者に50ptが**即時**入る
- [ ] 両者がペア設問に答えると、招待者に150ptが入る
- [ ] 答え合わせで一致/不一致が見え、一致→不一致の順に並ぶ
- [ ] 同じリンクを2回踏んでもポイントは1回だけ

**異常系**
- [ ] 自分の招待リンクを自分で踏むと拒否される
- [ ] 同じ人を2回招待しても2回目は報酬なし
- [ ] 11人目の招待は上限で拒否される
- [ ] 期限切れリンクは理由が表示される（**無言404にしない**）
- [ ] 相手が未回答のあいだ、答え合わせは 409 で開けない
- [ ] **答え合わせのレスポンスに相手の選択肢が含まれない**（D-10。API レスポンスを直接検証する）
- [ ] 品質基準を満たさない回答ではペア報酬が付かない
- [ ] LIFF トークン失効時に再取得され、401 のまま固まらない（過去の事故箇所）

## 実装指示

1. **実装順序**: migration 097 → repository → service → LIFF API → EJS 画面 → 管理画面
2. **規約**:
   - Express + EJS。Next.js の作法を持ち込まない
   - LIFF URL は `liffService` のヘルパーで生成（`APP_BASE_URL` 直組み禁止）
   - ポイント付与は `userPointService.awardPoints` のみを使う。台帳を直接触らない
   - 新規テーブルに `GRANT ... TO service_role` を必ず書く
   - 招待トークンは `crypto.randomBytes` 由来。連番・短い文字列は不可
3. **禁止事項**:
   - 既存ナビ（`partials/liff-bottom-nav.ejs`）を**変更しない**（行動計測の比較が切れる）
   - `user_points.pending_points` を保留の表現に使わない
   - ペア設問に自由記述を追加しない
   - 答え合わせ API から相手の回答内容を返さない
   - 本番 DB に書き込むスクリプトをローカルから実行しない
4. **完了確認**: `npx tsc --noEmit` / `npm test` / `npm run build` ＋ 上記の受け入れ条件。
   特に「相手の選択肢が返らない」は**レスポンスを直接検証する**テストを書く
