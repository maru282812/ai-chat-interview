-- 046_seed_demo_documents.sql
-- 書類管理・同意管理の業務確認用デモデータ
-- 名称先頭に [デモ] を付ける。再実行時はデモデータのみ入れ替える。

BEGIN;

DELETE FROM user_consent_records
WHERE document_id IN (SELECT id FROM documents WHERE title LIKE '[デモ]%');

DELETE FROM project_document_requirements
WHERE document_id IN (SELECT id FROM documents WHERE title LIKE '[デモ]%');

DELETE FROM document_versions
WHERE document_id IN (SELECT id FROM documents WHERE title LIKE '[デモ]%');

DELETE FROM documents
WHERE title LIKE '[デモ]%';

-- ── デモ書類（案件向け個別・キャンペーン） ──────────────────────────────────
INSERT INTO documents (id, document_type, title, description, is_active, is_required_global)
VALUES
  ('dd000000-0000-0000-0000-000000000001', 'project_specific',
   '[デモ] 美容室調査 個別同意書', '美容室利用実態アンケート専用の同意書', true, false),
  ('dd000000-0000-0000-0000-000000000002', 'campaign_terms',
   '[デモ] キャンペーン応募規約', '週末回答ボーナスキャンペーンの応募規約', true, false),
  ('dd000000-0000-0000-0000-000000000003', 'project_specific',
   '[デモ] 健康食品調査 録音利用同意', '健康食品調査インタビューの録音・AI分析利用同意', false, false);

-- ── デモバージョン（複数バージョン確認用） ──────────────────────────────────
INSERT INTO document_versions (id, document_id, version_no, content, change_reason, effective_from, effective_to, created_by)
VALUES
  -- 美容室調査 v1.0（旧版、effective_to あり）
  ('df000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', '1.0',
   '# 美容室調査 個別同意書 v1.0

本調査への参加にあたり、以下に同意をお願いします。

1. 回答内容は美容業界の分析に利用します
2. 匿名加工後にレポートとして提供されます
',
   '初版', now() - interval '30 days', now() - interval '5 days', 'admin'),

  -- 美容室調査 v1.1（最新版）
  ('df000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000001', '1.1',
   '# 美容室調査 個別同意書 v1.1

本調査への参加にあたり、以下に同意をお願いします。

1. 回答内容は美容業界の分析・改善提案に利用します
2. 匿名加工後にレポートとして提供されます
3. AI分析による傾向把握に利用する場合があります（追記）
',
   'AI分析利用条項を追記', now() - interval '5 days', NULL, 'admin'),

  -- キャンペーン応募規約 v1.0
  ('df000000-0000-0000-0000-000000000003', 'dd000000-0000-0000-0000-000000000002', '1.0',
   '# キャンペーン応募規約

## 対象
本キャンペーン期間中に対象アンケートへ回答されたユーザー

## ボーナスポイント
通常付与ポイントに加えて20ポイントを付与します

## 注意事項
- 同一案件への重複応募は1回のみカウントします
- 不正行為が確認された場合は付与を取り消します
',
   '初版', now() - interval '5 days', NULL, 'admin'),

  -- 健康食品調査 v1.0（無効書類のバージョン）
  ('df000000-0000-0000-0000-000000000004', 'dd000000-0000-0000-0000-000000000003', '1.0',
   '# 健康食品調査 録音利用同意 v1.0

インタビューの録音データを以下の目的で利用します。

1. 発言内容のテキスト化
2. AI分析による傾向把握
3. 匿名加工後の研究利用
',
   '初版', now() - interval '20 days', NULL, 'admin');

-- current_version_id を設定
UPDATE documents SET current_version_id = 'df000000-0000-0000-0000-000000000002' WHERE id = 'dd000000-0000-0000-0000-000000000001';
UPDATE documents SET current_version_id = 'df000000-0000-0000-0000-000000000003' WHERE id = 'dd000000-0000-0000-0000-000000000002';
UPDATE documents SET current_version_id = 'df000000-0000-0000-0000-000000000004' WHERE id = 'dd000000-0000-0000-0000-000000000003';

-- ── 案件×書類 関連付け ─────────────────────────────────────────────────────
-- 美容室調査（project 002）に美容室調査個別同意書を必須設定
INSERT INTO project_document_requirements (project_id, document_id, is_required, sort_order)
VALUES
  ('20000000-0000-0000-0000-000000000002', 'dd000000-0000-0000-0000-000000000001', true, 10),
  ('20000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006', false, 20)
ON CONFLICT (project_id, document_id) DO UPDATE SET
  is_required  = EXCLUDED.is_required,
  sort_order   = EXCLUDED.sort_order;

-- ── デモ同意レコード ───────────────────────────────────────────────────────
-- グローバル必須3書類の同意（demo_user_001, 004, 007）
INSERT INTO user_consent_records (id, line_user_id, document_id, document_version_id, project_id, consented_at, consent_source, ip_address, user_agent)
VALUES
  -- demo_user_001: グローバル3書類に同意済み
  ('ce000000-0000-0000-0000-000000000001','demo_user_001','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',NULL,now() - interval '29 days','liff','192.168.1.1','Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),
  ('ce000000-0000-0000-0000-000000000002','demo_user_001','d0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002',NULL,now() - interval '29 days','liff','192.168.1.1','Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),
  ('ce000000-0000-0000-0000-000000000003','demo_user_001','d0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000003',NULL,now() - interval '29 days','liff','192.168.1.1','Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),
  -- demo_user_001: 美容室調査 v1.0 に同意（旧版 → 再同意確認用）
  ('ce000000-0000-0000-0000-000000000004','demo_user_001','dd000000-0000-0000-0000-000000000001','df000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',now() - interval '8 days','liff','192.168.1.1','Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),

  -- demo_user_004: グローバル3書類に同意済み
  ('ce000000-0000-0000-0000-000000000005','demo_user_004','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',NULL,now() - interval '39 days','liff','10.0.0.5','Mozilla/5.0 (Linux; Android 14)'),
  ('ce000000-0000-0000-0000-000000000006','demo_user_004','d0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002',NULL,now() - interval '39 days','liff','10.0.0.5','Mozilla/5.0 (Linux; Android 14)'),
  ('ce000000-0000-0000-0000-000000000007','demo_user_004','d0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000003',NULL,now() - interval '39 days','liff','10.0.0.5','Mozilla/5.0 (Linux; Android 14)'),
  -- demo_user_004: 美容室調査 v1.1（最新版）に同意済み
  ('ce000000-0000-0000-0000-000000000008','demo_user_004','dd000000-0000-0000-0000-000000000001','df000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',now() - interval '4 days','liff','10.0.0.5','Mozilla/5.0 (Linux; Android 14)'),

  -- demo_user_007: グローバル3書類に同意済み
  ('ce000000-0000-0000-0000-000000000009','demo_user_007','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',NULL,now() - interval '21 days','liff','172.16.0.10','Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)'),
  ('ce000000-0000-0000-0000-000000000010','demo_user_007','d0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002',NULL,now() - interval '21 days','liff','172.16.0.10','Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)'),
  ('ce000000-0000-0000-0000-000000000011','demo_user_007','d0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000003',NULL,now() - interval '21 days','liff','172.16.0.10','Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)')

ON CONFLICT (id) DO NOTHING;

COMMIT;
