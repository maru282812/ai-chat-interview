-- 043_delivery_campaigns_nullable_project.sql
-- delivery_campaigns.project_id を任意項目に変更
-- キャンペーンはプロジェクト非紐付けで作成できるようにする

ALTER TABLE delivery_campaigns
  ALTER COLUMN project_id DROP NOT NULL;
