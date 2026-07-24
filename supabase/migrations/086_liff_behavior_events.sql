-- 086_liff_behavior_events.sql
-- LIFF の行動計測イベント置き場。
-- 目的は「ボトムナビの構成」「探す画面の情報階層」を、感覚でなく実データで決めること。
-- リリース前に仕込んでおき、リリース後に溜まった実データで判断する（P13＝行動証拠）。
--
-- 設計方針:
--  - 事実だけを積む append-only。集計はクエリ側で行い、ここでは加工しない。
--  - 個人を追跡する目的ではないので PII は入れない。line_user_id は残すが
--    「誰が」でなく「同一人物の一連の行動か」を見るための識別子として使う。
--  - 計測がユーザー体験を壊さないこと最優先。書き込み失敗は握りつぶす（呼び出し側の責務）。
--  - 保持期間は 180 日を想定（判断材料としてはそれ以上不要）。cron 削除は別途。

CREATE TABLE IF NOT EXISTS liff_behavior_events (
  id           BIGSERIAL   PRIMARY KEY,
  -- 何が起きたか。増やすときはこの CHECK に追記する（自由文字列にすると集計不能になるため）。
  event_type   TEXT        NOT NULL CHECK (event_type IN (
                             'nav_tap',        -- ボトムナビのタップ（提案1の判断材料）
                             'page_view',      -- LIFFページの表示
                             'list_reach',     -- 「探す」で案件一覧まで到達（提案2の判断材料）
                             'card_tap',       -- 案件カードのタップ
                             'daily_answer',   -- 今日の1問に回答
                             'pool_answer',    -- ついでスワイプに回答
                             'save_toggle',    -- 保存のON/OFF（提案1＝保存タブの要否）
                             'apply_tap'       -- 応募ボタンのタップ
                           )),
  -- どの画面で起きたか。'projects' / 'mypage' など。liff/*.ejs のページ名に対応。
  page         TEXT        NOT NULL,
  -- 対象の識別子。nav_tap なら 'saved'、card_tap なら project_id など。
  -- UUID に限定しないので TEXT。集計時の group by キー。
  target       TEXT,
  -- 補助数値。list_reach なら一覧到達までのスクロール量(px)、
  -- page_view なら表示までの経過ms など。イベント種別ごとに意味が変わる。
  value_num    INTEGER,
  -- 同一表示内での一連の行動をまとめるためのID（クライアント生成のランダム値）。
  -- ファネル（表示→一覧到達→カードtap）を追うのに使う。
  session_key  TEXT,
  line_user_id TEXT        REFERENCES user_profiles(line_user_id) ON DELETE SET NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 集計軸は「イベント種別 × 時系列」が主。ダッシュボードでの期間絞り込みを想定。
CREATE INDEX IF NOT EXISTS idx_liff_behavior_type_time
  ON liff_behavior_events(event_type, occurred_at DESC);

-- 「探す画面のファネル」を1セッション内で追うため。
CREATE INDEX IF NOT EXISTS idx_liff_behavior_session
  ON liff_behavior_events(session_key, occurred_at)
  WHERE session_key IS NOT NULL;

-- 保持期間クリーンアップ用（occurred_at < now() - 180d の一括削除）。
CREATE INDEX IF NOT EXISTS idx_liff_behavior_occurred
  ON liff_behavior_events(occurred_at);

-- サーバー（service_role）からのみ書き込む。anon には触らせない。
-- 074 で GRANT 欠落の一括是正をしているので、新規テーブルでは最初から付ける。
ALTER TABLE liff_behavior_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON liff_behavior_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE liff_behavior_events_id_seq TO service_role;

COMMENT ON TABLE liff_behavior_events IS
  'LIFF行動計測。ボトムナビ構成と探す画面の情報階層をデータで判断するための append-only ログ。180日保持想定。';
