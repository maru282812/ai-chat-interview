-- 104_portal_store_link.sql
-- 会員ポータル（hibi-portal）の店舗と、ACI の店舗マスタ（stores）を1対1で対応させる。
--
-- 背景:
--   これまで hibi から注文されたアンケートは partnerSurveyService が「案件1件」として作っており、
--   A/B/C のサイクル（storeProvisioningService が生成する店舗一式）に乗らなかった。
--   ポータル注文を店舗マスタ生成に乗せるには「hibi の店舗 = ACI のどの store か」が要る。
--
-- 何をするか:
--   1. stores.partner_store_id … hibi-portal 側 stores.id（別DBの外部ID）。UNIQUE で1対1を保証する。
--      ⚠ projects.partner_store_id と同じ値が入るが、あちらは案件の所有者スコープ。
--        こちらは店舗マスタ行そのものの対応付けで、役割が違う（どちらも hibi の店舗IDを指す）。
--   2. clients にポータル会員店舗用の固定法人を1件。ポータル経由の店舗はここにぶら下げる
--      （stores.client_id が NOT NULL のため、法人が無いと店舗を作れない）。
--
-- 追加のみ。既存列の型変更・削除・データ更新は行わない＝既存店舗は partner_store_id=NULL のまま
-- 従来どおり動く。rollback は列の DROP と固定行の DELETE で戻せる（下記参照）。

-- ------------------------------------------------------------------
-- 1. 店舗マスタに hibi 店舗IDを持たせる
-- ------------------------------------------------------------------

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS partner_store_id text;

COMMENT ON COLUMN stores.partner_store_id IS
  'hibi-portal（会員ポータル・別DB）の stores.id。ポータル注文で作られた店舗のみ非NULL。1店舗1行（UNIQUE）';

-- 部分 UNIQUE。NULL は重複可（＝従来の運営マスタ店舗は何件でも NULL のままでよい）。
CREATE UNIQUE INDEX IF NOT EXISTS ux_stores_partner_store
  ON stores (partner_store_id) WHERE partner_store_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 2. ポータル会員店舗用の固定法人
-- ------------------------------------------------------------------
-- ポータル店舗は「1店舗＝1事業者」でチェーンを構成しないため、法人を店舗ごとに作ると
-- clients が店舗数ぶん増えて運営画面が読めなくなる。受け皿を1件に固定する。
-- ID はコード側（storeProvisioningService.PORTAL_CLIENT_ID）と一致させること。

INSERT INTO clients (id, name, contact)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'アンケでYOTTO 会員店舗',
  'contact@yottollc.com'
)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------
-- 3. 権限（074 の GRANT 漏れ事故を繰り返さないため明示）
-- ------------------------------------------------------------------
-- 新規テーブルは無いが、096 で付けた stores への GRANT が現存することを冪等に確かめる。
-- （RLS だけ通って GRANT が無いと permission denied で全滅する事故を何度も踏んでいる）

GRANT SELECT, INSERT, UPDATE, DELETE ON stores TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO service_role;

-- ------------------------------------------------------------------
-- rollback（必要になったとき手で流す）
-- ------------------------------------------------------------------
-- DROP INDEX IF EXISTS ux_stores_partner_store;
-- ALTER TABLE stores DROP COLUMN IF EXISTS partner_store_id;
-- DELETE FROM clients WHERE id = 'c0000000-0000-4000-8000-000000000001'
--   AND NOT EXISTS (SELECT 1 FROM stores WHERE client_id = 'c0000000-0000-4000-8000-000000000001');
