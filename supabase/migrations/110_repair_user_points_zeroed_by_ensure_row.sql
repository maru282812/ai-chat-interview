-- 110_repair_user_points_zeroed_by_ensure_row.sql
--
-- ensureRow のゼロ上書きで消えた user_points の残高を、正準台帳
-- point_histories から再計算して復旧する。
--
-- 背景:
--   userPointService.ensureRow は「残高行が無ければ 0 で作る」つもりで
--   upsert({total:0, available:0, lifetime:0}, {onConflict:'line_user_id'})
--   を呼んでいた。Supabase の upsert は競合時に指定列を上書きするため、
--   既存ユーザーに当たると残高がまるごと 0 に潰れる。
--   これが「ついでスワイプ / デイリーアンケート」の付与直前に呼ばれていたので、
--   答えるたびに残高が消えて付与分だけが残る状態になっていた。
--   （コード側は同時に修正済み。ignoreDuplicates: true を付けた）
--
-- 復旧方針:
--   available / lifetime を point_histories の集計で置き換える。
--     available = 全トランザクションの純増減（交換のマイナスも含む）
--     lifetime  = 交換系を除く正の付与の累計（ランク判定に使う「稼いだ総額」）
--
-- 対象を絞る理由（重要）:
--   デモユーザー（demo_user_*）は 044 で user_points に残高を直接 INSERT して
--   おり、対応する point_histories を持たない。全件を台帳から再構築すると
--   デモの残高が消えるため、**台帳の集計が現在値を上回るユーザーだけ**に限定する。
--   これは「消えた分を戻す」方向だけの修正で、減らす方向には決して働かない。
--
-- 破壊性: 低。増加方向のみ。減算は行わない（下の WHERE / GREATEST で保証）。
--   実行前に現在値を user_points_repair_backup_110 に退避する。
--
-- ロールバック:
--   UPDATE user_points u SET available_points = b.available_points,
--                            lifetime_points  = b.lifetime_points,
--                            total_points     = b.total_points
--     FROM user_points_repair_backup_110 b
--    WHERE u.line_user_id = b.line_user_id;

-- 1) 退避（冪等: 既にあれば作り直さない）
CREATE TABLE IF NOT EXISTS user_points_repair_backup_110 AS
SELECT line_user_id, total_points, available_points, lifetime_points, now() AS backed_up_at
  FROM user_points;

-- 2) 台帳から正しい残高を出して復旧する
WITH ledger AS (
  SELECT
    line_user_id,
    SUM(points) AS ledger_available,
    SUM(CASE
          WHEN points > 0
           AND transaction_type <> 'redemption'
           AND transaction_type NOT LIKE 'exchange%'
          THEN points ELSE 0
        END) AS ledger_lifetime
  FROM point_histories
  GROUP BY line_user_id
)
UPDATE user_points u
   SET available_points = GREATEST(u.available_points, l.ledger_available),
       lifetime_points  = GREATEST(u.lifetime_points,  l.ledger_lifetime),
       total_points     = GREATEST(u.total_points,     l.ledger_lifetime),
       updated_at       = now()
  FROM ledger l
 WHERE u.line_user_id = l.line_user_id
   -- 増える場合だけ。デモのように台帳が現在値に満たないユーザーは触らない。
   AND (l.ledger_available > u.available_points
        OR l.ledger_lifetime  > u.lifetime_points);

-- 3) 検証: 復旧後、台帳合計が現在値を上回るユーザーが残っていないこと。
--    残っていれば復旧できていないので migration ごと失敗させる。
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
    FROM user_points u
    JOIN (
      SELECT line_user_id, SUM(points) AS ledger_available
        FROM point_histories
       GROUP BY line_user_id
    ) l ON l.line_user_id = u.line_user_id
   WHERE l.ledger_available > u.available_points;

  IF remaining > 0 THEN
    RAISE EXCEPTION
      '110: 残高の復旧に失敗しました（台帳が現在値を上回るユーザーが % 件残っています）', remaining;
  END IF;
END $$;
