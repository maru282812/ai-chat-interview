# Phase2 LIFFマイページ登録導線 設計方針

## 優先順位

Phase2は「管理画面を全部作る」より先に、LINEユーザーがLIFF上でマイページ登録を完了できる導線を最優先とする。

理由: セグメント配信・AI分析・ポイント管理・回答履歴・企業向けレポートは、
ユーザー属性が登録されていないと価値が出ないため。

---

## LIFFマイページ登録導線

### フロー

1. LINEメニューまたはLIFF URLからマイページを開く
2. LIFF認証（`liff.init()` + `getIDToken()`）
3. 未登録の場合は初回プロフィール入力画面を表示
4. 必須項目を入力
5. 推奨項目を任意で入力
6. 保存 → `profile_completed = true` に更新
7. 登録完了後、`next` URLがあれば元の画面へ戻す

### 実装ファイル

| ファイル | 役割 |
|---|---|
| `src/controllers/liffController.ts` | `mypagePage` / `updateMypageData` / `getProfileStatus` |
| `src/routes/liffRoutes.ts` | `/liff/mypage`, `/liff/profile-status` |
| `src/views/liff/mypage.ejs` | マイページUI（ダッシュボード・初期設定・編集） |
| `src/repositories/userProfileRepository.ts` | `UserProfileUpsertInput`, `markProfileCompleted` |
| `src/types/domain.ts` | `UserProfile`, `Gender` 型定義 |

---

## 必須項目

以下が全て揃ったときに `profile_completed = true` にする。

| フィールド | DB列 | 型 |
|---|---|---|
| 呼び名 / ニックネーム | `nickname` | TEXT |
| 生年月日 | `birth_date` | DATE |
| 性別 | `gender` | TEXT (male/female/other/prefer_not_to_say) |
| 都道府県 | `prefecture` | TEXT |
| 職業 | `occupation` | TEXT |
| 業種 | `industry` | TEXT |

利用規約・個人情報利用への同意はフォーム送信時にチェックボックスで確認する（DBには保存しない）。

### 必須項目チェックロジック（liffController.ts）

```ts
const requiredFields = [profile.nickname, profile.birth_date, profile.gender,
                        profile.prefecture, profile.occupation, profile.industry];
if (!profile.profile_completed && requiredFields.every(f => f !== null && f !== "")) {
  await userProfileRepository.markProfileCompleted(verifiedUser.userId);
}
```

---

## 推奨項目（任意）

入力すると「あなたに合ったアンケートが届きやすくなります」として案内する。

- 婚姻状況 (`marital_status`)
- 子どもの有無 (`has_children`)
- 子どもの年齢 (`children_ages`)
- 同居家族 (`household_composition`)
- 住所詳細 (`address_detail`)
- 世帯年収（未実装・将来対応）
- 興味ジャンル（`user_attributes` テーブルで管理）

---

## アンケート回答前のプロフィール確認（必須ルール）

### ルール

`/liff/survey`（案件アンケート本体）は、**回答を開始する前に必ずプロフィール確認画面を一度挟む**。
未登録ユーザーだけでなく、登録済みユーザーに対しても「回答開始前に基本情報を確認させる」ことを目的とする。

- 確認は **セッション単位** で一度きり。同一セッション内で確認済みなら以降はスキップする。
- 確認完了は `sessions.state_json.mypage_confirmed_at`（タイムスタンプ）で記録する。

### 判定ロジック（liffController.ts `surveyPage`）

```ts
// プロフィール確認: user_id が判明しており、かつ今セッションでまだ確認していない場合は
// プロフィール確認画面へ誘導する
if (assignment.user_id && !sessionForCheck?.state_json?.mypage_confirmed_at) {
  // session_id が空だと confirm-mypage が 400 になり無限リダイレクトになるため、
  // セッション未作成ならここで先行作成する
  const currentUrl = `/liff/survey?assignment_id=${encodeURIComponent(assignmentId)}`;
  res.redirect(
    `/liff/profile/check?next=${encodeURIComponent(currentUrl)}&session_id=${encodeURIComponent(sessionForCheck.id)}`
  );
  return;
}
```

`assignment.user_id` が無い（=匿名/LIFF未連携の流入）場合は確認画面を挟まずアンケート本体へ進む。

### リダイレクト先

```
/liff/profile/check?next={元のsurveyURL（encodeURIComponent済み）}&session_id={確認対象セッションID}
```

- 専用ページ `profileCheckPage`（`src/views/liff/profile-check.ejs`）を使う。
  マイページ機能（ポイント・履歴・ランク）は表示せず、プロフィール確認 → 保存 → 案件へ直接遷移する導線に特化する。
- survey LIFF コンテキスト内で別の LIFF ID（mypage）を `liff.init()` すると "Invalid LIFF ID" になるため、
  profile-check は **survey LIFF ID**（`LINE_LIFF_ID_SURVEY`）で動作する。

### 完了後の動作

1. profile-check 画面で「確認しました」操作をすると `POST /liff/session/confirm-mypage`
   （body: `session_id`）を呼び、`state_json.mypage_confirmed_at` を記録する。
2. その後 `next`（= 元の survey URL）へ `window.location.href` で戻す。
3. 再度 `/liff/survey` に到達した時点では `mypage_confirmed_at` が存在するため、
   確認をスキップしてアンケート本体を表示する。

### 関連エンドポイント / ファイル

| 種別 | パス / ファイル |
|---|---|
| 確認画面 | `GET /liff/profile/check` → `liffController.profileCheckPage` |
| 確認画面ビュー | `src/views/liff/profile-check.ejs` |
| 確認用プロフィール取得 | `GET /liff/profile-check-data` → `getProfileCheckData` |
| 確認完了の記録 | `POST /liff/session/confirm-mypage` → `confirmMypage` |
| 判定元 | `liffController.surveyPage`（`assignment.user_id` + `mypage_confirmed_at`） |

---

## 未登録ユーザーのリダイレクト制御（マイページ系）

### 対象ページ

| ページ | リダイレクト方式 |
|---|---|
| `/liff/rant` | クライアントサイド（LIFF init後にGET /liff/profile-status） |
| `/liff/diary` | クライアントサイド（同上） |
| `/liff/personality` | クライアントサイド（同上） |

> `/liff/survey` のプロフィール確認は上記「アンケート回答前のプロフィール確認」を参照（遷移先は `/liff/profile/check`）。

### リダイレクト先

```
/liff/mypage?next={元のURL（encodeURIComponent済み）}
```

### 完了後の動作

- `profile_just_completed = true` のレスポンスが返ったとき
- `next` URLがあれば `window.location.href = next` で戻す
- `next` URLがなければマイページダッシュボードを表示

---

## profile-status API

```
GET /liff/profile-status
Authorization: Bearer {LIFF ID Token}

Response: { ok: true, profile_completed: boolean }
```

クライアントサイドのリダイレクト判定に使用する。LIFF init後に呼び出す。

---

## DB マイグレーション

| マイグレーション | 内容 |
|---|---|
| `022_phase2_foundation.sql` | `user_profiles` 拡張（profile_completed 他） |
| `023_phase2d.sql` | `ng_words`, `post_categories`, `campaign_assignment_map` |
| `024_user_profile_gender.sql` | `user_profiles.gender` カラム追加 |

**注意**: 各マイグレーションをSupabase側で実行してからサーバーを起動すること。

---

## /admin/data-management について

ルート・コントローラー・ビューはすべて実装済み。

- ルート: `adminRoutes.get("/data-management", ...)` (adminRoutes.ts)
- コントローラー: `adminController.dataManagementPage` (adminController.ts)
- ビュー: `src/views/admin/data-management/index.ejs`

404 になる場合はサーバーが古いコードで起動しているため。
`npm run dev` で再起動すれば解消される。

DBテーブルが未作成の場合でも、コントローラーが `?? []` でフォールバックするため
ページ自体は表示される。`023_phase2d.sql` を適用すればデータも扱える。
