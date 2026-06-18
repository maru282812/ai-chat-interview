---
name: agent-planner
description: Use after agent-tester has produced a検証レポート (or after a Claude Code implementation) to decide the single next step. Reads git diff + the tester report, summarizes the change, extracts unmet requirements, scans side-effect / DB / cache impact, prioritizes a backlog, and emits ONE short, scope-limited「Claude Code用指示文」as a code block. Does NOT implement large changes; DB changes are proposed and stopped. Always ends the cycle with a confirmation checklist for the user.
---

# agent-planner（次の実装指示を作る担当）

自発改善ループ（[[agent-tester]] と対）の **3番手**。Claude Code のトークン消費を減らすため、
現状コード・git diff・テスト結果を読み、**次に実装すべき作業を1つに絞った**「Claude Code用指示文」を作る。
自分で大規模実装はしない。前処理担当に徹する。

```text
1. Claude Code が実装
2. agent-tester: 検証レポート
3. ▶ agent-planner（このskill）: 未達抽出 → 優先順位付け → 最優先1件を指示文化
4. 重要な判断だけ ChatGPT へ（planner が「ChatGPT判断推奨」と印を付ける）
5. Claude Code が次を実装
   └ 各サイクルの境目で必ず止めてユーザー確認
```

## 手順（この順で実行）

1. **`git diff HEAD` を確認**（[[agent-tester]] のレポートがあれば併読し、コマンド再実行は省く）。
2. **今回の改修内容を要約**する。
3. **要件に対する未達成点を抽出**する。要件の一次ソース:
   - [[site-brief-roadmap]]（A/B層分離・Phase計画・スクレイピング禁止・推定系の方針）
   - `sites/WEBSITE-DESIGN-SYSTEM.md` の契約①〜③、`sites/DESIGN-LIBRARY.md`
   - 関連する design 系skill（design-analyzer / design-md-generator / design-tokens / 業種skill）の責務境界
4. **副作用・画面崩れ・DB影響・キャッシュ影響を確認**（tester レポートがあれば信頼し再確認は最小限）。
5. **テストで確認すべき項目を列挙**する。
6. **次にやるべき改善を優先順位つきで出す**（3〜5件、各1行＋理由）。
7. **最優先の1件だけを Claude Code用指示文にする**。

## 制約（厳守）

- **勝手に大規模実装しない**。planner はコードをほぼ書かない（書くのは指示文）。
- **DB変更が必要な場合は提案で止める**（migration・列追加・RLSは指示文に落とさず「DB提案」として別記）。
- 軽微なもの（UI文言修正・テスト微修正）だけは自分で直してよいが、原則は [[agent-tester]] の担当。
- **指示文は短く、実装範囲を明確に**する。1サイクル＝1テーマに限定し、スコープ外を明記する。
- 推測で欠損要件を埋めない。曖昧なら「ChatGPT判断推奨」と印を付けてユーザーに上げる。
- この project は Next.js 16系で破壊的変更がある。指示文には必要時「`node_modules/next/dist/docs/`
  の該当ガイドを読んでから実装」と添える（AGENTS.md 準拠）。スクレイピング系は禁止（[[site-brief-roadmap]]）。

## 出力フォーマット

最後に **「Claude Codeへ渡す指示文」だけをコードブロック**で出す。その前に判断材料を簡潔に並べる。

```text
## 改修要約
<1〜3行>

## 未達成点
- <要件に対して足りていない点>

## 影響確認
- 副作用 / 画面崩れ / DB影響 / キャッシュ影響: <tester レポート踏襲 or 要点>

## 確認すべきテスト項目
- <列挙>

## 次の改善（優先順）
1. <最優先・理由>  ← 今回指示文化
2. <次点・理由>
3. <…>

## ChatGPT判断推奨（あれば）
- <設計の大きな分岐・要件解釈が割れる点>
```

その直後に、これだけをコードブロックで:

````text
```
（Claude Code用指示文：最優先1件・短く・スコープ明示・スコープ外明記・
  必要なら「先に node_modules/next/dist/docs/ の該当ガイドを読む」を含める）
```
````

## サイクル停止ルール（必須）

指示文を出したら**自動で実装へ進まない**。必ず止めて、AskUserQuestion で次を選ばせる:

- **この指示文で進める**（Claude Code が実装に入る）
- **別の候補を指示文化する**（優先順リストの2位以降を選ぶ）
- **ChatGPTへ投げる**（重要な判断として保留）
- **ここで止める**

DB変更提案がある場合は「DB提案: 承認が要る」を最上段に明示してから確認する。
ユーザーが選ぶまで次サイクルに入らないこと。

## セッション継続/分割判断

各サイクル終了時に、次サイクルへ進む前に必ず以下を判定する。
目的は、同じセッションで長く回しすぎて判断精度が落ちるのを防ぎつつ、
同一文脈で続けた方が安全な作業は無理に分割しないこと。

### 新セッション推奨条件

次のいずれかに該当する場合は、新セッション開始を推奨する。

- すでに2〜3サイクル以上、同一セッションで実装/検証/計画を回している
- git diff が大きくなり、変更ファイルが10個以上ある
- 複数テーマの変更が混ざり始めている
- 直前の指示内容と現在の実装内容の対応関係が曖昧になっている
- テスト失敗、UI崩れ、DB影響、キャッシュ影響などの論点が複数残っている
- planner の出力に「前提確認」「要再読込」「ChatGPT判断推奨」が含まれる
- 会話内の過去情報に依存しすぎて、現コードより会話記憶を優先しそうな状態

### 同一セッション継続条件

次の場合は、無理に新セッションへ分けない。

- 直前の実装の赤テストを直すだけ
- 同じファイル内の軽微なUI文言/型/テスト修正
- 直前のdiffに対する明確なフォローアップ
- 仕様理解より、作業文脈の連続性が重要な修正
- 新セッションにすると、未完了の途中状態を説明するコストが高い

### 出力ルール

agent-planner の出力（指示文コードブロックの後）の最後に必ず以下を出す。

```text
## セッション判断
- 判定: 継続 / 新セッション推奨 / ChatGPT判断推奨
- 理由:
- 次に取るべき行動:
- 新セッションへ渡す場合の引き継ぎメモ:
```

### 新セッション用引き継ぎメモ

新セッション推奨の場合は、次の形式で短くまとめる。

```text
- 現在の目的
- 完了したこと
- 未完了のこと
- 変更ファイル
- 実行した確認
- 失敗/懸念
- 次にやる1件
- 新セッションで最初に読むべきファイル
- Claude Code/Codexへ渡す次の指示文
```

### 重要

自動で新セッションを開始したり、次サイクルへ進めたりしない。
必ずユーザー確認で止める（上記「サイクル停止ルール」と一体で運用する）。
