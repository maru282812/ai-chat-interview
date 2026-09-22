-- 111_terms_monitor_panel.sql
-- 利用規約 v2.1: モニターパネル（属性で対象を絞ったアンケート配信）の根拠を明文化する。
--
-- 背景:
--   これまでの配信は「店舗の来店客に店頭QRで配る」形が中心で、規約もその前提で書かれている。
--   モニター調査（クライアント企業の依頼で、当方が保有する会員の中から
--   性別・年代・居住地域等の条件に合う方を選んで配信する）を提供するにあたり、
--   現行 v2.0 には次の根拠が無い:
--     - **プロフィール属性を「配信対象の選定」に使うこと**
--       （v2.0 は「属性」「プロフィール」「対象者」の語が本文に一度も出てこない）
--     - クライアント企業の依頼に基づく調査であることの明示
--   実務上は配信対象の絞り込みを行うため、根拠を規約側に明文化する。
--
-- 【新バージョンを切る】理由（102 と同じ）:
--   利用目的の追加であり、権利義務の内容に実質的な変更が生じる。
--   consentService は「利用者の同意済み version_id == documents.current_version_id」で
--   判定するため、**既存版の本文を書き換えるだけでは再同意が発生しない**。
--   本文だけ差し替えると「同意していない条文に拘束されている」状態になるので、
--   必ず新バージョンを作成して current_version_id を差し替える。
--
--   ⚠ 個人情報保護法上、利用目的の追加は遡及しない。
--     **本改定より前に取得した回答は、本条を根拠にモニター調査の成果として扱えない。**
--     だからこそ、実施の可否が決まる前であっても早く版を切る意味がある
--     （遅らせるほど「使える回答」が積み上がらない）。
--
-- 本改定で足すもの（条文と実装の対応）:
--   1. 第9条1項の利用目的リストに「配信対象の選定」を追加
--      → segments / 指名配信ルールが user_profiles を読む根拠
--   2. 第6条1項のサービス内容に「クライアント企業の依頼に基づく調査」を追加
--      → モニター調査という提供形態があることの明示
--   3. 第9条に新2項として「配信対象の選定」の条文を挿入し、以降の項番を繰り下げる
--      → 何に使い、何を渡さないか（属性そのものはクライアントへ渡さない）を明記
--
--   ⚠ 3 の項番繰り下げに注意。v2.0 で 2〜5 項がある（102 で 3 項を挿入済み）ので、
--     5 → 6, 4 → 5, 3 → 4, 2 → 3 の順に**後ろから**置換する
--     （前から置換すると、繰り下げた番号を次の置換が再び拾って壊れる）。
--
-- ⚠ 本番DBの本文は CRLF、本ファイルは LF。既存本文を土台に新版を作るため、
--   置換のアンカーは必ず「改行を含まない単一行の断片」にすること。
--   末尾の検証ブロックで、意図した改定が入ったことを必ず確認する。

BEGIN;

DO $$
DECLARE
  v_doc_id      UUID := 'd0000000-0000-0000-0000-000000000001'::UUID;
  v_new_id      UUID := '63030000-0000-0000-0000-000000000001'::UUID;
  v_old_id      UUID;
  v_content     TEXT;
  v_new_content TEXT;
  ts            TIMESTAMPTZ := now();
  crlf          TEXT := chr(13) || chr(10);
BEGIN
  SELECT current_version_id INTO v_old_id FROM documents WHERE id = v_doc_id;
  IF v_old_id IS NULL THEN
    RAISE EXCEPTION '利用規約の current_version_id が取得できません（document_id=%）', v_doc_id;
  END IF;

  -- 既に適用済みなら何もしない（冪等）
  IF EXISTS (SELECT 1 FROM document_versions WHERE id = v_new_id) THEN
    RAISE NOTICE '利用規約 v2.1 は適用済みのためスキップします';
    RETURN;
  END IF;

  SELECT content INTO v_content FROM document_versions WHERE id = v_old_id;

  -- ── 1. 第9条1項の利用目的リストに「配信対象の選定」を追加 ──
  --    アンカーは 102 が追加した行の**直前**にある既存行にする。
  v_new_content := replace(
    v_content,
    '- クライアント企業の商品開発、マーケティング分析、業務改善のための情報提供',
    '- クライアント企業の商品開発、マーケティング分析、業務改善のための情報提供' || crlf || crlf ||
    '- ユーザーが登録したプロフィール情報(性別、年代、居住地域、職業等)を、アンケート等の配信対象の選定に利用すること'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '第9条1項の利用目的リストにアンカーが見つかりません（本文の改行コード等を確認してください）';
  END IF;

  -- ── 2. 第6条1項のサービス内容に、モニター調査という提供形態を明示 ──
  v_content := v_new_content;
  v_new_content := replace(
    v_content,
    '- AIチャットによるインタビュー(AIが生成する質問への回答取得)',
    '- AIチャットによるインタビュー(AIが生成する質問への回答取得)' || crlf || crlf ||
    '- クライアント企業の依頼に基づく調査の実施(当方が保有する会員の中から、依頼内容に応じた条件に合致する方を選んで配信する場合を含みます)'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '第6条1項のサービス内容にアンカーが見つかりません';
  END IF;

  -- ── 3. 第9条に新2項を挿入し、以降の項番を繰り下げる ──
  --    ⚠ **後ろから**置換する（前からだと繰り下げた番号を次の置換が再び拾う）。
  v_content := v_new_content;

  -- 5 → 6
  v_new_content := replace(
    v_content,
    '5. 回答データ等に関する一切の知的財産権は、',
    '6. 回答データ等に関する一切の知的財産権は、'
  );
  -- 4 → 5
  v_new_content := replace(
    v_new_content,
    '4. ユーザーは、本サービスの利用終了、退会又は本規約に基づく契約終了後においても、',
    '5. ユーザーは、本サービスの利用終了、退会又は本規約に基づく契約終了後においても、'
  );
  -- 3 → 4（102 が入れた店舗開示の条文）
  v_new_content := replace(
    v_new_content,
    '3. 前項にかかわらず、当方は、店舗その他の事業者(以下「店舗等」といいます)への伝達を目的として',
    '4. 前項にかかわらず、当方は、店舗その他の事業者(以下「店舗等」といいます)への伝達を目的として'
  );
  -- 2 → 3 ＋ その手前に新2項を挿入
  v_new_content := replace(
    v_new_content,
    '2. 当方は、回答データ等を、個人を特定できない形に統計化又は匿名加工したうえで、',
    '2. 当方は、ユーザーが登録したプロフィール情報を、アンケート等の配信対象の選定(クライアント企業の依頼に基づく調査において、依頼内容に応じた条件に合致するユーザーを抽出することを含みます)のために利用します。この場合において、当方は、当該選定に用いたプロフィール情報そのものをクライアント企業に提供することはせず、提供する情報は前条及び次項の定めに従います。' || crlf || crlf ||
    '3. 当方は、回答データ等を、個人を特定できない形に統計化又は匿名加工したうえで、'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '第9条の項番繰り下げ・新2項の挿入に失敗しました';
  END IF;

  -- ── 4. 版表記の更新 ──
  v_content := v_new_content;
  v_new_content := replace(
    v_content,
    '改定日:2026年9月9日(第9条 店舗等への開示に関する規定を追加)',
    '改定日:2026年9月9日(第9条 店舗等への開示に関する規定を追加)' || crlf || crlf ||
    '改定日:2026年9月22日(第6条・第9条 配信対象の選定に関する規定を追加)'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '版表記のアンカーが見つかりません';
  END IF;

  -- ── 5. 新バージョンを作成して差し替える ──
  INSERT INTO document_versions (id, document_id, version_no, content, change_reason, effective_from, created_by)
  VALUES (
    v_new_id,
    v_doc_id,
    '2.1',
    v_new_content,
    'プロフィール属性を配信対象の選定に利用する旨、及びクライアント企業の依頼に基づく調査の実施を第6条・第9条に追加',
    ts,
    'migration:111'
  );

  UPDATE documents SET current_version_id = v_new_id, updated_at = ts WHERE id = v_doc_id;

  RAISE NOTICE '利用規約 v2.1 を作成し、current_version_id を差し替えました';
END $$;

-- ── 検証: 意図した改定が入ったことを必ず確認する ──
--    置換が1件も当たらないまま「成功」することを防ぐ（本番は CRLF）。
DO $$
DECLARE
  v_content TEXT;
BEGIN
  SELECT dv.content INTO v_content
    FROM documents d
    JOIN document_versions dv ON dv.id = d.current_version_id
   WHERE d.id = 'd0000000-0000-0000-0000-000000000001'::UUID;

  IF position('配信対象の選定に利用すること' in v_content) = 0 THEN
    RAISE EXCEPTION '検証失敗: 第9条1項に配信対象の選定が入っていません';
  END IF;
  IF position('クライアント企業の依頼に基づく調査の実施' in v_content) = 0 THEN
    RAISE EXCEPTION '検証失敗: 第6条にモニター調査の記載が入っていません';
  END IF;
  IF position('6. 回答データ等に関する一切の知的財産権は、' in v_content) = 0 THEN
    RAISE EXCEPTION '検証失敗: 第9条の項番が繰り下がっていません';
  END IF;
  -- 旧項番が残っていないこと（前から置換して壊れていないかの確認）
  IF position('5. 回答データ等に関する一切の知的財産権は、' in v_content) > 0 THEN
    RAISE EXCEPTION '検証失敗: 第9条の旧項番(5)が残っています';
  END IF;

  RAISE NOTICE '検証OK: 利用規約 v2.1 の改定内容を確認しました';
END $$;

COMMIT;
