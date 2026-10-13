# 日付・時刻・期間の回答形式（ACI＋hibi 共通契約）

2026-10-14 確定。ACI（回答画面・管理画面・partner API）と hibi-site（店舗専用アンケートの編集・表示）で共有する契約。

## ユーザー決定事項
- 形式は4つすべて: 日付 / 時刻 / 日付＋時刻 / 期間（開始〜終了）
- 時間軸の操作 = 横の時間軸を指でなぞる（スライダー型・刻み停止）
- カレンダー = 画面内に月カレンダーを常時表示（ネイティブ input[type=date] は使わない）。「今日」「昨日」の近道ボタンあり
- 日付範囲 = 設問ごとに管理画面で指定

## question_type（新規4種）
| type | 意味 | answer_text（保存形式・JST・タイムゾーン表記なし） |
|---|---|---|
| `date` | 日付 | `YYYY-MM-DD` |
| `time` | 時刻 | `HH:MM`（24時間制） |
| `datetime` | 日付＋時刻 | `YYYY-MM-DDTHH:MM` |
| `period` | 期間 | `開始/終了`（ISO 8601 区間表記）。単位は config.period_unit に従い各端は上の3形式のどれか。例 `2026-10-01/2026-10-03`、`13:00/15:30` |

- `normalized_answer`（jsonb）: date/time/datetime は `{"value": "..."}`、period は `{"start": "...", "end": "...", "unit": "date|time|datetime"}`
- 選択肢（answer_options）は持たない
- 文字列の辞書順比較 = 時系列比較 になる形式を保つ（ゼロ埋め必須）

## config（questions.config の管理キー・すべて任意）
| キー | 型 | 既定 | 対象 |
|---|---|---|---|
| `date_min_offset` | int\|null | null（下限なし） | date/datetime/period(date,datetime) 回答日(JST)からの相対日数。過去のみ=`max 0`、未来のみ=`min 0` |
| `date_max_offset` | int\|null | null（上限なし） | 同上 |
| `time_step_minutes` | 5\|10\|15\|30\|60 | 15 | time/datetime/period(time,datetime) |
| `time_min` | `HH:MM` | `00:00` | 時間軸の左端 |
| `time_max` | `HH:MM` | `24:00` | 時間軸の右端（`24:00` は終了端のみ可） |
| `period_unit` | `date`\|`time`\|`datetime` | `date` | period のみ |

管理画面の日付範囲プリセット: 制限なし / 過去のみ（今日まで）/ 未来のみ（今日から）/ 今日から前後N日（min・max を個別指定）。

## 検証（サーバー権威）
- 形式の正規表現・実在日付（2月30日を弾く）・時刻範囲・刻み一致・`date_*_offset` 範囲（JST基準・日付境界のずれ吸収に±1日の許容）・period は 開始 ≤ 終了（同値可）
- 日付またぎの時間帯（22:00〜翌2:00）は今回対象外

## 表示・集計
- 表示ラベル: `2026年10月13日(火)` / `14:30` / `2026年10月13日(火) 14:30` / `10月1日(木)〜10月3日(土)`・`13:00〜15:30`
- 分岐条件 compare: 両辺が同じ日時形式なら文字列比較（parseFloat で年だけ比較される事故を防ぐ）
- codebook data_type = `datetime`（period も datetime・note に形式を明記）。集計は none
- rawdata / wide / long: 列は既存どおり設問1列に answer_text をそのまま出す（**列の追加・改名はしない**＝集計アプリ契約）。`${q}_datetime`（回答時刻列）とは別物
- GT: ratio_allowed=false 扱い（hibi 側はグラフ「none」）
- 店舗開示（verbatim）: entries.text には表示ラベルを入れる。⚠来店日時の原文開示は店舗側で個人を特定しうる → 管理画面の開示ONの横に注意書きを出す（既定はOFFのまま）

## 対象外（今回は扱わない）
- デイリーアンケート・ついでスワイプ・LINEトーク/AIチャット経路（interview_chat）。送信前バリデーションで「チャット形式では未対応」と警告する

## partner API（ACI⇄hibi）
- `PARTNER_QUESTION_TYPES` に `date` `time` `datetime` `period` を追加（内部型と同名・選択肢不要）
- 設問 payload に任意フィールド `datetime_config`: `{date_min_offset, date_max_offset, time_step_minutes, time_min, time_max, period_unit}`（上の config と同じキー・すべて任意）。日時系以外では送らない／返さない
- バージョンハッシュ（lib/partnerSurveyVersion.ts）は既存設問の値を変えないこと（日時系の設問のときだけ datetime_config を含める）
