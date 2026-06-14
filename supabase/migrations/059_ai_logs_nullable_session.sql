-- ============================================================
-- 059: ai_logs.session_id を nullable 化（Phase 7-A）
-- 目的: セッション外で実行されるAI呼び出し（プロジェクトAI初期状態生成・
--       プロジェクト分析・投稿分析・愚痴/日記拡張分析・カウンセラー返信・
--       ペルソナタグ生成）も ai_logs に記録できるようにする
-- ============================================================

alter table ai_logs
  alter column session_id drop not null;

comment on column ai_logs.session_id is 'セッションID。セッション外実行（プロジェクト分析・投稿分析・ペルソナタグ等）は null';
