-- 088_research_hypothesis.sql
-- 調査仮説シート（P13「行動証拠による顧客発見」フロー生成モードの入力）の永続化。
--
-- 出典: docs/要件定義_AIフロー作成_行動証拠による顧客発見_2026-07-27.md §6.2 / §12-A1。
--
-- なぜ保存するのか:
--   P13 の核は「失敗条件（何が確認できなければ STOP か）を先に書かせる」こと。
--   生成時にだけ渡して捨てると、回答が集まったあとの GO/PIVOT/STOP 判定支援レポート（§6.6）が
--   「そもそも何を確認できれば GO だったのか」を復元できず、判定の基準が消える。
--   だから生成のたびに上書き保存し、レポート側から参照する。
--
-- なぜ ai_state_json など既存 JSON に相乗りしないのか:
--   既存フィールドは AI が生成した状態を持つ枠で、人間が書いた前提条件とは寿命も責任者も違う。
--   混ぜるとレポートが拾いづらく、AI 再生成で人間の入力が飛ぶ事故を招く。
--
-- 製品名・機能案は意図的に持たない（§6.2）。列に無ければプロンプトにも混入しない。

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS research_hypothesis_json JSONB;

COMMENT ON COLUMN projects.research_hypothesis_json IS
  '調査仮説シート（P13）。{ segment, scene, problem_hypothesis, current_method, stop_condition, buyer_is_user, saved_at }。NULL＝behavior_evidence モードで生成していない案件。製品名・機能案は保持しない。';
