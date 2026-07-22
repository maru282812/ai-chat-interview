# Phase Status: 若年層体験パック（20代モニター向け UX 強化）

指示書: docs/spec-young-experience-pack.md / 対象repo: c:\work\ai-chat-interview
ゲート: `npx tsc --noEmit` → 関連テストを **1本ずつ** `npx tsx src/tests/<name>.test.ts`（`npm test` は1本しか流さない・全体並列は偽陽性）

## Phases

| # | 名前 | 指示書の対象 | 状態 | ゲート | 更新 |
|---|------|------|------|--------|------|
| 1 | 基盤（体験設定） | Phase 0 全部 | todo | - | - |
| 2 | 本音の核 | A-3 → A-4 → A-1 → A-2 | todo | - | - |
| 3 | 書く体験 | B-1 → B-2 → B-3 → B-4 | todo | - | - |
| 4 | 楽しさ（表示層） | C-3 → C-5 → C-4 | todo | - | - |
| 5 | 中断再開・音声 | C-6 → C-2 | todo | - | - |
| 6 | 成長ループ | D-4 → D-3 → D-5 | todo | - | - |
| 7 | ダークモード | D-6 | todo | - | - |
| — | **保留（規約ゲート）** | **C-1 / D-1 / D-2** | **blocked** | - | - |

## 確定した決定 / 前提（後フェーズが依存）

- **C-1（回答分布）・D-1（招待）・D-2（シェア画像）は着手しない。** 指示書「5. 着手前ゲート」で
  規約 v2（docs/terms-v2-draft.md）との整合確認が済むまで実装禁止と明記されているため。周回終了時に人間へエスカレーションする。
- migration 084 は当初 C-1 の `show_distribution` と D-5 の `is_onboarding` の同居予定だったが、
  C-1 が保留のため **`is_onboarding` のみ**で作る（Phase 6）。`show_distribution` は C-1 解除時に別 migration で追加する。
- レイヤ規約: controller → service → repository。LIFF 画面は partials 共通化（answer-ui / rank-celebration の流儀）。
- migration は `supabase/migrations/0NN_name.sql` 連番。作成後 `npm run db:migrate` で本番 Supabase へ適用（自動適用が本プロジェクトの既定運用）。
- 禁止事項（全フェーズ共通）: 回答保存形式（single=スカラー / multi=配列）変更禁止 / エクスポート列変更禁止 /
  `runSlot` をローカルから叩かない / 商用副作用はレスポンス前に await / 完了系は survey_question・interview_chat の両経路必須 /
  answer-ui 新レンダラで「label+hidden checkbox」「data-code input への独自 value 配線」禁止。
- 既定 OFF のフラグは出荷しても挙動が変わらないこと（安全にマージできる）を各フェーズで確認する。

## 未解決課題（重い・要人間判断）

- [ ] C-1 みんなの回答分布: 集計値の本人向け表示が規約 v2 の利用目的に収まるか要確認
- [ ] D-1 招待: 紹介プログラムの付与条件・不正時没収の条文が規約に必要
- [ ] D-2 シェア画像: 公表・二次利用の範囲について規約整合確認が必要

## フェーズ別ログ（サブが追記）
