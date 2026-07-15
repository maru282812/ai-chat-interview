-- ============================================================
-- 081_rank_ladder_reorder_progressive.sql
--
-- ランク体系の刷新 Phase 1：ランクの並べ替え・増設・累進しきい値。
--
-- 変更点（旧 032 の5段階 → 新7段階のポイントラダー）:
--   * 順序を … → プラチナ → エメラルド → ダイヤモンド → マスター に変更
--     （エメラルドを新設し、ダイヤモンドの手前へ。マスターも新設）
--   * 昇格しきい値を「一定でない累進（前半ほど小刻み）」に変更
--       0 → 100 → 300 → 600 → 1,100 → 1,800 → 3,000
--       （差: +100 +200 +300 +500 +700 +1,200）
--
-- 管理画面 /admin/ranks は ranks を sort_order 昇順で一覧・min_points を編集できるため、
-- この UPSERT で並び順・しきい値ともにそのまま反映される。
--
-- グランドマスター（#1〜#10 の個別順位）は保有ポイントのしきい値ランクではなく
-- リーダーボード順位制のため、この ranks テーブルには追加しない（Phase 3 で別実装）。
--
-- badge_label は当面の絵文字プレースホルダ（LIFF は rank_code から SVG を描くため非依存）。
-- Phase 4 で SVG アイコンへ置き換える。
--
-- 冪等：rank_code 一意制約に対する UPSERT。再実行しても同じ最終状態になる。
-- ロールバックは 032 の値（bronze0/silver200/gold500/platinum1000/diamond2000・5段階）へ戻す。
-- ============================================================

INSERT INTO ranks (rank_code, rank_name, min_points, sort_order, badge_label)
VALUES
  ('bronze',   'ブロンズ',        0, 1, '🥉'),
  ('silver',   'シルバー',      100, 2, '🥈'),
  ('gold',     'ゴールド',      300, 3, '🥇'),
  ('platinum', 'プラチナ',      600, 4, '💠'),
  ('emerald',  'エメラルド',   1100, 5, '💚'),
  ('diamond',  'ダイヤモンド', 1800, 6, '💎'),
  ('master',   'マスター',     3000, 7, '👑')
ON CONFLICT (rank_code) DO UPDATE SET
  rank_name   = excluded.rank_name,
  min_points  = excluded.min_points,
  sort_order  = excluded.sort_order,
  badge_label = excluded.badge_label,
  updated_at  = now();
