-- 112_terms_answer_based_followup_interview.sql
-- 回答内容に基づいて追加インタビューへの協力を依頼できるようにする改定（利用規約 v2.2 / プライバシーポリシー v2.2）。
--
-- 背景:
--   GT集計表の「気になるセル」（＝特定の設問で特定の選択肢を選んだ回答者）を母集団として、
--   AI深掘りインタビューを追加配信する機能を実装する（docs/plan-gt-cell-interview-impl.md）。
--   しかし現行規約が定めているのは以下の2つだけで、いずれも本機能の根拠にならない。
--     - v2.1 第9条2項: 「**プロフィール情報**を配信対象の選定に利用する」
--       → 性別・年代等での抽出しか読めない。「過去の回答内容で抽出する」ことは書かれていない。
--     - v2.0 第9条4項: 「店舗等への伝達を目的とした設問の回答を当該店舗へ開示する」
--       → 開示の話であって、回答者への**再接触**の話ではない。
--   本改定で「回答内容を、追加調査の対象者選定および協力依頼のために利用する」ことを明文化する。
--
-- 【新バージョンを切る】理由:
--   利用目的の追加であり、既存版の本文を書き換えるだけでは再同意が発生しない
--   （consentService は同意済み version_id と documents.current_version_id の一致で判定するため）。
--   本文だけ差し替えると「同意していない条文に拘束されている」状態になるので、必ず新版を作る。
--
--   ⚠ 個人情報保護法上、利用目的の追加は遡及しない。本改定より前に取得した回答を根拠に
--     追加インタビューを依頼することはできない。実装側は「同意日時 <= 回答日時」で機械的に
--     絞り込むこと（既存の src/lib/questionShare.ts の isCoveredByConsent をそのまま再利用する）。
--     人の判断に委ねず、コードで弾くこと。
--
-- 再接触の範囲（条文と実装の対応）:
--   - 抽出に使うのは回答内容そのもの（どの設問でどの選択肢を選んだか）。
--   - クライアント企業へ渡すのは人数と集計のみ。**誰が該当したかは開示しない**
--     （抽出条件は「名簿」ではない。既存 partnerSurveyService.getResults の作法を踏襲）。
--   - 協力依頼であって義務ではない。応じないことによる不利益を与えない旨を明記する。
--
-- ⚠ 本番DBの本文は CRLF、本ファイルは LF。既存本文を土台に新版を作るため、
--   置換のアンカーは必ず「改行を含まない単一行の断片」にすること。
--   末尾の検証ブロックで、意図した改定が入ったことを必ず確認する。
--
-- ⚠ 第9条の項番は 111 適用後に 1..6 である前提（1=利用目的 / 2=プロフィールでの配信対象選定 /
--   3=統計化しての提供 / 4=店舗等への開示 / 5=終了後の取扱い / 6=知的財産権）。
--   本改定は新3項を挿入し、3→4, 4→5, 5→6, 6→7 に繰り下げる。
--   **繰り下げは必ず後ろから置換する**（前からだと繰り下げた番号を次の置換が再び拾う）。

BEGIN;

-- ── 1. 利用規約 v2.2 ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_doc_id      UUID := 'd0000000-0000-0000-0000-000000000001'::UUID;
  v_new_id      UUID := '63040000-0000-0000-0000-000000000001'::UUID;
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
    RAISE NOTICE '利用規約 v2.2 は適用済みのためスキップします';
    RETURN;
  END IF;

  SELECT content INTO v_content FROM document_versions WHERE id = v_old_id;

  -- ── 1-a. 第9条1項の利用目的リストに「回答内容に基づく追加調査の依頼」を追加 ──
  --    アンカーは 111 が追加した行にする（この行の直後に足す）。
  v_new_content := replace(
    v_content,
    '- ユーザーが登録したプロフィール情報(性別、年代、居住地域、職業等)を、アンケート等の配信対象の選定に利用すること',
    '- ユーザーが登録したプロフィール情報(性別、年代、居住地域、職業等)を、アンケート等の配信対象の選定に利用すること' || crlf || crlf ||
    '- ユーザーの回答内容を、追加のアンケート又はインタビューの対象者の選定及び協力依頼に利用すること'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '第9条1項の利用目的リストにアンカーが見つかりません（111 が適用されているか、本文の改行コードを確認してください）';
  END IF;

  -- ── 1-b. 第6条1項のサービス内容に、追加インタビューという提供形態を明示 ──
  v_content := v_new_content;
  v_new_content := replace(
    v_content,
    '- クライアント企業の依頼に基づく調査の実施(当方が保有する会員の中から、依頼内容に応じた条件に合致する方を選んで配信する場合を含みます)',
    '- クライアント企業の依頼に基づく調査の実施(当方が保有する会員の中から、依頼内容に応じた条件に合致する方を選んで配信する場合を含みます)' || crlf || crlf ||
    '- 実施済みの調査の回答内容に基づく追加調査の実施(特定の設問に特定の内容を回答した方に対して、その理由等をさらに伺う場合を含みます)'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '第6条1項のサービス内容にアンカーが見つかりません（111 が適用されているか確認してください）';
  END IF;

  -- ── 1-c. 第9条に新3項を挿入し、以降の項番を繰り下げる ──
  --    ⚠ **後ろから**置換する（前からだと繰り下げた番号を次の置換が再び拾う）。
  v_content := v_new_content;

  -- 6 → 7（知的財産権）
  v_new_content := replace(
    v_content,
    '6. 回答データ等に関する一切の知的財産権は、',
    '7. 回答データ等に関する一切の知的財産権は、'
  );
  -- 5 → 6（終了後の取扱い）
  v_new_content := replace(
    v_new_content,
    '5. ユーザーは、本サービスの利用終了、退会又は本規約に基づく契約終了後においても、',
    '6. ユーザーは、本サービスの利用終了、退会又は本規約に基づく契約終了後においても、'
  );
  -- 4 → 5（102 が入れた店舗等への開示）
  v_new_content := replace(
    v_new_content,
    '4. 前項にかかわらず、当方は、店舗その他の事業者(以下「店舗等」といいます)への伝達を目的として',
    '5. 前項にかかわらず、当方は、店舗その他の事業者(以下「店舗等」といいます)への伝達を目的として'
  );
  -- 3 → 4（統計化しての提供）＋ その手前に新3項を挿入
  v_new_content := replace(
    v_new_content,
    '3. 当方は、回答データ等を、個人を特定できない形に統計化又は匿名加工したうえで、',
    '3. 当方は、ユーザーの回答内容を、追加のアンケート又はインタビューの対象者の選定及び協力依頼のために利用します。この場合において、当方は、当該選定に用いた回答内容と当該ユーザーとの対応関係をクライアント企業に提供することはせず、クライアント企業に提供する情報は、該当する人数及び次項に定める統計化又は匿名加工された情報に限ります。追加のアンケート又はインタビューへの協力は任意であり、ユーザーがこれに応じないことによって、当方はユーザーに対し何らの不利益も課しません。' || crlf || crlf ||
    '4. 当方は、回答データ等を、個人を特定できない形に統計化又は匿名加工したうえで、'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '第9条の項番繰り下げ・新3項の挿入に失敗しました（111 適用後の項番 1..6 を前提としています）';
  END IF;

  -- ── 1-d. 版表記の更新 ──
  v_content := v_new_content;
  v_new_content := replace(
    v_content,
    '改定日:2026年9月22日(第6条・第9条 配信対象の選定に関する規定を追加)',
    '改定日:2026年9月22日(第6条・第9条 配信対象の選定に関する規定を追加)' || crlf || crlf ||
    '改定日:2026年9月24日(第6条・第9条 回答内容に基づく追加調査に関する規定を追加)'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '版表記のアンカーが見つかりません（111 の改定日行を確認してください）';
  END IF;

  UPDATE document_versions SET effective_to = ts WHERE id = v_old_id;

  INSERT INTO document_versions (id, document_id, version_no, content, change_reason, effective_from, created_by)
  VALUES (
    v_new_id, v_doc_id, '2.2', v_new_content,
    '回答内容を追加のアンケート又はインタビューの対象者選定及び協力依頼に利用する旨を第6条・第9条に追加',
    ts, 'migration-112'
  );

  UPDATE documents SET current_version_id = v_new_id, updated_at = ts WHERE id = v_doc_id;

  RAISE NOTICE '利用規約 v2.2 を作成し、current_version_id を差し替えました';
END $$;

-- ── 2. プライバシーポリシー v2.2 ────────────────────────────────────────────
DO $$
DECLARE
  v_doc_id      UUID := 'd0000000-0000-0000-0000-000000000002'::UUID;
  v_new_id      UUID := '63040000-0000-0000-0000-000000000002'::UUID;
  v_old_id      UUID;
  v_content     TEXT;
  v_new_content TEXT;
  ts            TIMESTAMPTZ := now();
  crlf          TEXT := chr(13) || chr(10);
BEGIN
  SELECT current_version_id INTO v_old_id FROM documents WHERE id = v_doc_id;
  IF v_old_id IS NULL THEN
    RAISE EXCEPTION 'プライバシーポリシーの current_version_id が取得できません（document_id=%）', v_doc_id;
  END IF;

  IF EXISTS (SELECT 1 FROM document_versions WHERE id = v_new_id) THEN
    RAISE NOTICE 'プライバシーポリシー v2.2 は適用済みのためスキップします';
    RETURN;
  END IF;

  SELECT content INTO v_content FROM document_versions WHERE id = v_old_id;

  -- ── 2-a. 利用目的リストに追加 ──
  --    102 が入れた「6の2」の直後に「6の3」として足す。
  v_new_content := replace(
    v_content,
    '6の2. 店舗等への伝達を目的として設けた設問について、当該回答が当該店舗等に開示される旨を回答画面上であらかじめ明示したうえで取得した回答内容を、当該回答に係る店舗等へ開示すること',
    '6の2. 店舗等への伝達を目的として設けた設問について、当該回答が当該店舗等に開示される旨を回答画面上であらかじめ明示したうえで取得した回答内容を、当該回答に係る店舗等へ開示すること' || crlf || crlf ||
    '6の3. 取得した回答内容を、追加のアンケート又はインタビューの対象者の選定及び協力依頼に利用すること'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION 'プライバシーポリシーの利用目的リストにアンカーが見つかりません（102 が適用されているか確認してください）';
  END IF;

  -- ── 2-b. 第5条(第三者提供)に、追加調査での取扱いの説明を追加 ──
  v_content := v_new_content;
  v_new_content := replace(
    v_content,
    '## 第6条(業務委託及び外国にある第三者への提供)',
    '【回答内容に基づく追加調査について】' || crlf || crlf ||
    '当方は、取得した回答内容を、追加のアンケート又はインタビューの対象者の選定及び協力依頼のために利用します。この場合において、クライアント企業に提供する情報は、条件に該当する人数及び統計化又は匿名加工された情報に限られ、どなたが該当したかをクライアント企業に開示することはありません。追加のアンケート又はインタビューへの協力は任意であり、応じないことによる不利益はありません。なお、個人情報の保護に関する法律に基づき、利用目的の追加は遡及しないため、本改定にご同意いただく前に取得した回答内容を、追加調査の対象者選定に利用することはありません。' || crlf || crlf ||
    '## 第6条(業務委託及び外国にある第三者への提供)'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION 'プライバシーポリシー第5条のアンカーが見つかりません';
  END IF;

  UPDATE document_versions SET effective_to = ts WHERE id = v_old_id;

  INSERT INTO document_versions (id, document_id, version_no, content, change_reason, effective_from, created_by)
  VALUES (
    v_new_id, v_doc_id, '2.2', v_new_content,
    '回答内容を追加のアンケート又はインタビューの対象者選定及び協力依頼に利用する旨を追加',
    ts, 'migration-112'
  );

  UPDATE documents SET current_version_id = v_new_id, updated_at = ts WHERE id = v_doc_id;

  RAISE NOTICE 'プライバシーポリシー v2.2 を作成し、current_version_id を差し替えました';
END $$;

-- ── 3. 検証: 新版が current になり、条文が入っていることを確認する ──────────
DO $$
DECLARE
  c_terms      INTEGER;
  c_privacy    INTEGER;
  c_renumber   INTEGER;
BEGIN
  SELECT count(*) INTO c_terms
  FROM documents d
  JOIN document_versions dv ON dv.id = d.current_version_id
  WHERE dv.content LIKE '%追加のアンケート又はインタビューの対象者の選定及び協力依頼のために利用します%'
    AND dv.version_no = '2.2'
    AND d.id = 'd0000000-0000-0000-0000-000000000001'::UUID;

  SELECT count(*) INTO c_privacy
  FROM documents d
  JOIN document_versions dv ON dv.id = d.current_version_id
  WHERE dv.content LIKE '%【回答内容に基づく追加調査について】%'
    AND dv.version_no = '2.2'
    AND d.id = 'd0000000-0000-0000-0000-000000000002'::UUID;

  -- 項番の繰り下げが最後まで通ったことを確認する（7項＝知的財産権が存在するか）。
  SELECT count(*) INTO c_renumber
  FROM documents d
  JOIN document_versions dv ON dv.id = d.current_version_id
  WHERE dv.content LIKE '%7. 回答データ等に関する一切の知的財産権は、%'
    AND d.id = 'd0000000-0000-0000-0000-000000000001'::UUID;

  IF c_terms = 0 THEN
    RAISE EXCEPTION '利用規約 v2.2 が current_version になっていません';
  END IF;
  IF c_privacy = 0 THEN
    RAISE EXCEPTION 'プライバシーポリシー v2.2 が current_version になっていません';
  END IF;
  IF c_renumber = 0 THEN
    RAISE EXCEPTION '第9条の項番繰り下げが不完全です（7項が見つかりません）';
  END IF;

  RAISE NOTICE '規約改定 v2.2 を適用しました（利用規約=%件 / プライバシーポリシー=%件 / 項番繰り下げOK）', c_terms, c_privacy;
END $$;

COMMIT;
