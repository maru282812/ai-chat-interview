-- 113_gt_cell_interview.sql
-- GT集計表の「気になるセル」から追加AIインタビューを配信する機能の土台。
-- 設計: docs/plan-gt-cell-interview-impl.md
--
-- 作るもの:
--   1. cell_interview_requests   … 「どの案件のどのセルから、どの追加調査を生んだか」の台帳
--   2. cell_interview_targets    … 誰に配信したか（冪等性の担保。二重配信を防ぐ）
--   3. projects への追記         … 追加調査が「どのセルから生まれたか」の逆引き
--
-- ⚠ GRANT を必ず明示する。074 / 047 で GRANT 漏れによる 500 を一括是正した経緯があり、
--   RLS だけ付けて GRANT を忘れると permission denied で全滅する。
--
-- ⚠ 冪等性の方式は cycleFollowupService の「先行クレーム」を踏襲する。
--   送る前に cell_interview_targets へ claimed 行を立て、成功/失敗を後から書く。
--   「送ってから記録」にすると、記録前に落ちた場合に二重配信になる。

BEGIN;

-- ── 1. セルインタビュー要求の台帳 ──────────────────────────────────────────
create table if not exists cell_interview_requests (
  id uuid primary key default gen_random_uuid(),

  -- 抽出元（どの案件のどの設問のどの選択肢か）
  source_project_id uuid not null references projects(id) on delete cascade,
  source_question_id uuid not null references questions(id) on delete cascade,
  -- 選択肢の value。⚠ ラベルではなく value を保存する（ラベルは後から変わり得る）
  source_option_value text not null,
  -- 表示用に、実行時点のラベルを控える（後からラベルが変わっても何を選んだか分かるように）
  source_option_label text,

  -- 属性ブレークで絞った場合の軸と値（総数セルなら null）
  break_axis text,
  break_code text,

  -- 生成した追加調査
  interview_project_id uuid references projects(id) on delete set null,

  -- 実行時点の人数（顧客に見せた数字を監査できるように保存する）
  matched_count integer not null default 0,
  reachable_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,

  -- 誰が実行したか（運営 or 顧客ストア）
  requested_by_admin text,
  requested_by_store_id uuid,

  status text not null default 'draft',
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cell_interview_requests_status_check
    check (status in ('draft', 'claimed', 'sent', 'failed', 'canceled')),
  -- 軸と値は両方あるか両方無いか（片方だけだと条件を再現できない）
  constraint cell_interview_requests_break_pair_check
    check ((break_axis is null) = (break_code is null))
);

comment on table cell_interview_requests is
  'GT集計表のセル条件から生成した追加AIインタビューの台帳。matched/reachable は実行時点の値を監査用に保存する。';
comment on column cell_interview_requests.source_option_value is
  '選択肢の value。ラベルは変わり得るため value を正とする（lib/answerOptionMatch.ts と対応）。';

create index if not exists idx_cell_interview_requests_source_project
  on cell_interview_requests(source_project_id);
create index if not exists idx_cell_interview_requests_interview_project
  on cell_interview_requests(interview_project_id);

-- ── 2. 配信対象の台帳（冪等性）──────────────────────────────────────────────
create table if not exists cell_interview_targets (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references cell_interview_requests(id) on delete cascade,

  -- 名寄せ後の識別子。⚠ respondents は案件ごとに1行あるため line_user_id で一意にする
  line_user_id text not null,

  -- 先行クレーム方式: 送る前に claimed で立て、結果を後から書く
  status text not null default 'claimed',
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  error_message text,

  constraint cell_interview_targets_status_check
    check (status in ('claimed', 'sent', 'failed', 'skipped')),
  -- 同一要求に同じ人を二重で入れない（これが二重配信の防波堤）
  constraint cell_interview_targets_unique unique (request_id, line_user_id)
);

comment on table cell_interview_targets is
  '追加インタビューの配信対象。送信前に claimed を立てる先行クレーム方式（cycleFollowupService と同じ作法）。';

create index if not exists idx_cell_interview_targets_request
  on cell_interview_targets(request_id);
create index if not exists idx_cell_interview_targets_line_user
  on cell_interview_targets(line_user_id);

-- ── 3. 配信頻度制御（G16）──────────────────────────────────────────────────
-- 「直近N日に追加インタビューを何回受けたか」を数えるための索引。
-- 短期間に同じ人へ繰り返し依頼すると離脱するため、到達可能判定で使う。
create index if not exists idx_cell_interview_targets_line_user_sent_at
  on cell_interview_targets(line_user_id, sent_at)
  where status = 'sent';

-- ── 4. 追加調査側から抽出元を引けるようにする ──────────────────────────────
alter table projects
  add column if not exists cell_interview_request_id uuid references cell_interview_requests(id) on delete set null;

comment on column projects.cell_interview_request_id is
  'この案件がGT表のセルから自動生成された追加インタビューである場合の抽出元。通常案件は null。';

create index if not exists idx_projects_cell_interview_request
  on projects(cell_interview_request_id)
  where cell_interview_request_id is not null;

-- ── 5. 権限（⚠ GRANT 漏れは permission denied で全滅する。必ず明示する）────
GRANT SELECT, INSERT, UPDATE, DELETE ON cell_interview_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON cell_interview_targets  TO service_role;

ALTER TABLE cell_interview_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cell_interview_targets  ENABLE ROW LEVEL SECURITY;

-- service_role 経由でのみ触る（アプリは service_role キーで接続する）。
-- 回答者・顧客が直接読む経路は作らない（識別子を含むため）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cell_interview_requests'
      AND policyname = 'cell_interview_requests_service_role_all'
  ) THEN
    CREATE POLICY cell_interview_requests_service_role_all
      ON cell_interview_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cell_interview_targets'
      AND policyname = 'cell_interview_targets_service_role_all'
  ) THEN
    CREATE POLICY cell_interview_targets_service_role_all
      ON cell_interview_targets FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 6. 検証 ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c_tables  INTEGER;
  c_column  INTEGER;
  c_grants  INTEGER;
BEGIN
  SELECT count(*) INTO c_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('cell_interview_requests', 'cell_interview_targets');

  SELECT count(*) INTO c_column
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'projects'
    AND column_name = 'cell_interview_request_id';

  -- GRANT が実際に付いたかを確認する（RLS だけ付いて GRANT 漏れ＝過去の事故パターン）
  SELECT count(*) INTO c_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('cell_interview_requests', 'cell_interview_targets')
    AND grantee = 'service_role'
    AND privilege_type = 'SELECT';

  IF c_tables <> 2 THEN
    RAISE EXCEPTION 'テーブルが作成されていません（期待2件・実際%件）', c_tables;
  END IF;
  IF c_column <> 1 THEN
    RAISE EXCEPTION 'projects.cell_interview_request_id が作成されていません';
  END IF;
  IF c_grants <> 2 THEN
    RAISE EXCEPTION 'service_role への GRANT が不足しています（期待2件・実際%件）', c_grants;
  END IF;

  RAISE NOTICE '113 適用OK（テーブル%件 / カラム%件 / GRANT%件）', c_tables, c_column, c_grants;
END $$;

COMMIT;
