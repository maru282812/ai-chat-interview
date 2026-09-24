-- 102_terms_store_feedback_disclosure.sql
-- 「店舗への申し送り」設問の回答を、当該店舗へ原文のまま個別開示できるようにする改定。
--
-- 背景:
--   美容室ABCサイクルの A-Q12（施術中の会話量の希望）/ A-Q13（スタッフへの伝達事項）は、
--   設問文に「この設問のみ担当者が施術前に確認いたします」と明記して回答を得ている。
--   しかし利用規約 第9条・プライバシーポリシー 第5条は「統計化又は匿名加工したうえで」
--   クライアント企業へ提供する場合しか定めておらず、原文開示の根拠条項が欠けていた。
--   設問文での告知と規約本文の食い違いを解消し、根拠を規約側に明文化する。
--
-- 【新バージョンを切る】理由:
--   利用目的の追加であり、権利義務の内容に実質的な変更が生じる。
--   100/101 の「未確定だった事業者表示の確定」とは性質が異なり、既存版の本文を
--   書き換えるだけでは再同意が発生しない（consentService は利用者の同意済み
--   version_id と documents.current_version_id の一致で判定するため）。
--   本文だけ差し替えると「同意していない条文に拘束されている」状態になるので、
--   必ず新バージョンを作成して current_version_id を差し替える。
--
--   ⚠ 個人情報保護法上、利用目的の追加は遡及しない。本改定より前に取得した回答は
--     本条を根拠に開示できない。開示対象は v2.0 に同意した以降の回答に限ること。
--     （実装側で「同意日時 <= 回答日時」の判定が必要。consentedOnly 相当の絞り込み）
--
-- 開示の範囲（条文と実装の対応）:
--   - 開示できるのは「店舗等への伝達を目的として設けた設問」の回答に限る。
--   - 当該設問である旨を回答画面上で事前明示していることが条件（notice 必須の根拠）。
--   - 開示先は当該回答に係る店舗のみ。
--   - 氏名・LINEユーザーID 等の直接識別子は開示しない。
--
-- ⚠ 本番DBの本文は CRLF、本ファイルは LF。既存本文を土台に新版を作るため、
--   置換のアンカーは必ず「改行を含まない単一行の断片」にすること。
--   末尾の検証ブロックで、意図した改定が入ったことを必ず確認する。

BEGIN;

-- ── 1. 利用規約 v2.0 ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_doc_id      UUID := 'd0000000-0000-0000-0000-000000000001'::UUID;
  v_new_id      UUID := '63020000-0000-0000-0000-000000000001'::UUID;
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
    RAISE NOTICE '利用規約 v2.0 は適用済みのためスキップします';
    RETURN;
  END IF;

  SELECT content INTO v_content FROM document_versions WHERE id = v_old_id;

  -- 1-a. 第9条1項の利用目的リストに開示目的を追加
  v_new_content := replace(
    v_content,
    '- 法令に基づく対応',
    '- 回答者が店舗等への伝達を目的として入力した回答内容を、当該店舗等へ開示すること' || crlf || crlf ||
    '- 法令に基づく対応'
  );

  -- 1-b. 第9条2項の直後に新3項（原文開示）を挿入し、以降の項番を繰り下げる
  v_new_content := replace(
    v_new_content,
    '3. ユーザーは、本サービスの利用終了、退会又は本規約に基づく契約終了後においても、',
    '3. 前項にかかわらず、当方は、店舗その他の事業者(以下「店舗等」といいます)への伝達を目的として設けた設問について、当該設問である旨及び当該回答が当該店舗等に開示される旨を回答画面上であらかじめ明示したうえで、ユーザーが当該設問に回答した場合、当該回答の内容を、統計化又は匿名加工することなく、当該回答に係る店舗等に対してのみ開示することができます。この場合において、当方は、ユーザーの氏名、LINEユーザーID その他ユーザーを直接特定する情報を併せて開示しません。' || crlf || crlf ||
    '4. ユーザーは、本サービスの利用終了、退会又は本規約に基づく契約終了後においても、'
  );
  v_new_content := replace(
    v_new_content,
    '4. 回答データ等に関する一切の知的財産権は、',
    '5. 回答データ等に関する一切の知的財産権は、'
  );

  -- 版表記の更新
  v_new_content := replace(v_new_content, '制定日:2026年6月18日', '制定日:2026年6月18日' || crlf || crlf || '改定日:2026年9月9日(第9条 店舗等への開示に関する規定を追加)');

  IF v_new_content = v_content THEN
    RAISE EXCEPTION '利用規約の本文が変化していません（アンカー不一致。CRLF/LF を確認すること）';
  END IF;

  UPDATE document_versions SET effective_to = ts WHERE id = v_old_id;

  INSERT INTO document_versions (id, document_id, version_no, content, change_reason, effective_from, created_by)
  VALUES (
    v_new_id, v_doc_id, '2.0', v_new_content,
    '店舗等への伝達を目的とした設問の回答を、当該店舗へ個別開示する旨を第9条に追加',
    ts, 'migration-102'
  );

  UPDATE documents SET current_version_id = v_new_id, updated_at = ts WHERE id = v_doc_id;
END $$;

-- ── 2. プライバシーポリシー v2.0 ────────────────────────────────────────────
DO $$
DECLARE
  v_doc_id      UUID;
  v_new_id      UUID := '63020000-0000-0000-0000-000000000002'::UUID;
  v_old_id      UUID;
  v_content     TEXT;
  v_new_content TEXT;
  ts            TIMESTAMPTZ := now();
  crlf          TEXT := chr(13) || chr(10);
BEGIN
  -- 本番DBで確認済みの固定ID（2026-09-09時点 v1.1 が current）
  v_doc_id := 'd0000000-0000-0000-0000-000000000002'::UUID;

  SELECT current_version_id INTO v_old_id FROM documents WHERE id = v_doc_id;

  IF v_old_id IS NULL THEN
    RAISE EXCEPTION 'プライバシーポリシーの current_version_id が取得できません（document_id=%）', v_doc_id;
  END IF;

  IF EXISTS (SELECT 1 FROM document_versions WHERE id = v_new_id) THEN
    RAISE NOTICE 'プライバシーポリシー v2.0 は適用済みのためスキップします';
    RETURN;
  END IF;

  SELECT content INTO v_content FROM document_versions WHERE id = v_old_id;

  -- 2-a. 利用目的リストに追加
  v_new_content := replace(
    v_content,
    '6. 統計化又は匿名加工された情報をクライアント企業に提供し、クライアント企業の商品開発、マーケティング分析、業務改善に役立てること',
    '6. 統計化又は匿名加工された情報をクライアント企業に提供し、クライアント企業の商品開発、マーケティング分析、業務改善に役立てること' || crlf || crlf ||
    '6の2. 店舗等への伝達を目的として設けた設問について、当該回答が当該店舗等に開示される旨を回答画面上であらかじめ明示したうえで取得した回答内容を、当該回答に係る店舗等へ開示すること'
  );

  -- 2-b. 第5条(第三者提供)に開示の説明を追加
  v_new_content := replace(
    v_new_content,
    '## 第6条(業務委託及び外国にある第三者への提供)',
    '【店舗等への伝達を目的とした回答の開示について】' || crlf || crlf ||
    '当方は、店舗その他の事業者(以下「店舗等」といいます)への伝達を目的として設けた設問について、当該回答が当該店舗等に開示される旨を回答画面上であらかじめ明示したうえで取得した回答内容を、当該回答に係る店舗等に対してのみ開示します。この開示は、ユーザーご本人の同意に基づくものです。開示に際して、氏名、LINEユーザーID その他ユーザーを直接特定する情報は併せて開示しません。' || crlf || crlf ||
    '## 第6条(業務委託及び外国にある第三者への提供)'
  );

  IF v_new_content = v_content THEN
    RAISE EXCEPTION 'プライバシーポリシーの本文が変化していません（アンカー不一致）';
  END IF;

  UPDATE document_versions SET effective_to = ts WHERE id = v_old_id;

  INSERT INTO document_versions (id, document_id, version_no, content, change_reason, effective_from, created_by)
  VALUES (
    v_new_id, v_doc_id, '2.0', v_new_content,
    '店舗等への伝達を目的とした設問の回答を、当該店舗へ個別開示する旨を追加',
    ts, 'migration-102'
  );

  UPDATE documents SET current_version_id = v_new_id, updated_at = ts WHERE id = v_doc_id;
END $$;

-- ── 3. 検証: 新版が current になり、条文が入っていることを確認する ──────────
DO $$
DECLARE
  c_terms   INTEGER;
  c_privacy INTEGER;
BEGIN
  SELECT count(*) INTO c_terms
  FROM documents d
  JOIN document_versions dv ON dv.id = d.current_version_id
  WHERE dv.content LIKE '%統計化又は匿名加工することなく、当該回答に係る店舗等に対してのみ開示%'
    AND dv.version_no = '2.0';

  SELECT count(*) INTO c_privacy
  FROM documents d
  JOIN document_versions dv ON dv.id = d.current_version_id
  WHERE dv.content LIKE '%【店舗等への伝達を目的とした回答の開示について】%'
    AND dv.version_no = '2.0';

  IF c_terms = 0 THEN
    RAISE EXCEPTION '利用規約 v2.0 が current_version になっていません';
  END IF;
  IF c_privacy = 0 THEN
    RAISE EXCEPTION 'プライバシーポリシー v2.0 が current_version になっていません';
  END IF;

  RAISE NOTICE '規約改定 v2.0 を適用しました（利用規約=%件 / プライバシーポリシー=%件）', c_terms, c_privacy;
END $$;

COMMIT;
