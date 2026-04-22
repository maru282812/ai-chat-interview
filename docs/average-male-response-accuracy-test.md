# 平均男性ペルソナ回答精度テスト

このドキュメントは、LINE インタビュー AI の回答精度を確認するための仮定プロジェクト、平均的な男性ペルソナによる会話ログ、期待される抽出結果、精度評価をまとめたものです。

ここでの「平均男性」は統計的な代表値ではなく、検証用に作成した合成ペルソナです。実データの分布や性別による一般化を主張するものではありません。

## 仮定プロジェクト

- project_name: コンビニ昼食・軽食購買体験インタビュー
- client_name: Demo Retail
- research_mode: interview
- objective: 会社員男性がコンビニを利用する場面、利用理由、不満点、改善ニーズを把握する
- primary_objectives:
  - 利用頻度と主な利用シーンを把握する
  - 購買理由と重視点を把握する
  - 不満点と改善要望を具体化する
- prompt_rules:
  - 回答にない事実を推測しない
  - 1 回の深掘りでは 1 つの論点だけ聞く
  - LINE 会話として短く自然に聞く
  - 質問番号や内部コードを表示しない

## 質問設計

| code | type | role | question | expected_slots |
| --- | --- | --- | --- | --- |
| Q1 | single_select | screening | ふだんコンビニをどれくらいの頻度で利用しますか？ | frequency |
| Q2 | text | main | どのような場面でコンビニを利用することが多いですか？ | usage_scene, purchase_items, motive |
| Q3 | text | comparison_core | コンビニに対して不満や改善してほしい点があれば教えてください。 | pain_point, pain_scene, improvement_request |
| __free_comment__ | text | free_comment | 最後に、ここまでで話しきれなかったことがあれば自由に教えてください。 | optional_note |

## 回答者ペルソナ

- persona_id: synthetic_average_male_01
- 属性: 35 歳男性、都内勤務の会社員、既婚、子どもなし
- 生活背景: 平日は電車通勤。朝は時間がなく、昼休みも短め。自炊は週末中心。
- コンビニ利用傾向: 平日の朝と昼に利用しやすい。価格よりも近さ、早さ、品ぞろえを重視。
- 口調: 丁寧すぎず、短めだが具体例は出せる

## 会話ログ

| turn | speaker | message | expected_ai_behavior |
| --- | --- | --- | --- |
| 1 | assistant | ふだんコンビニをどれくらいの頻度で利用しますか？ 1. ほぼ毎日 2. 週に4から6回 3. 週に2から3回 4. 週に1回くらい 5. 月に数回以下 | 選択肢回答を受け付ける |
| 2 | respondent | 2 | frequency = 週に4から6回 として保存する |
| 3 | assistant | どのような場面でコンビニを利用することが多いですか？買うものや、その場面で使う理由も一緒に教えてください。 | Q2 を自然に提示する |
| 4 | respondent | 平日の朝、会社に行く前に駅前のコンビニでおにぎりとコーヒーを買うことが多いです。昼も忙しい日は弁当やサラダを買います。 | 場面、購入品、理由が概ね埋まるが、理由を少し深掘りできる |
| 5 | assistant | 朝に駅前で買うときは、どんな点が便利だと感じますか？ | 回答内容に基づいた 1 点深掘り |
| 6 | respondent | 駅から近くてすぐ寄れるのと、レジが早いので助かります。朝は時間がないので、迷わず買える定番商品があるのもいいです。 | motive = 近さ、早さ、定番商品の安心感 として補完する |
| 7 | assistant | コンビニに対して不満や改善してほしい点があれば教えてください。小さなことでも構いません。 | Q3 を自然に提示する |
| 8 | respondent | 昼時のレジ待ちが気になります。 | 短く抽象的なので、発生場面か影響を深掘りする |
| 9 | assistant | 昼時のレジ待ちは、どんな場面で特に困りますか？ | Q3 の不満点に限定して深掘りする |
| 10 | respondent | 12時過ぎに弁当を買うと5分以上並ぶことがあって、昼休みが短くなります。セルフレジやモバイル注文がもっと使いやすいと助かります。 | pain_scene, impact, improvement_request を抽出する |
| 11 | assistant | 最後に、ここまでで話しきれなかったことがあれば自由に教えてください。 | free_comment を提示する |
| 12 | respondent | アプリのクーポンはたまに使いますが、探すのが少し面倒です。よく買う商品だけ自動で出ると使いやすいと思います。 | optional_note として補足保存する |
| 13 | assistant | ありがとうございます。インタビューは完了です。 | 完了処理に進む |

## 期待される出力結果

```json
{
  "test_case_id": "average_male_response_accuracy_01",
  "project_name": "コンビニ昼食・軽食購買体験インタビュー",
  "respondent_persona": {
    "persona_id": "synthetic_average_male_01",
    "segment": "35歳男性・会社員・電車通勤",
    "note": "検証用の合成ペルソナ"
  },
  "session_status": "completed",
  "structured_answers": {
    "Q1": {
      "frequency": {
        "value": "週に4から6回",
        "evidence": "2",
        "confidence": 0.99
      }
    },
    "Q2": {
      "usage_scene": {
        "value": "平日の朝の通勤前、忙しい日の昼",
        "evidence": "平日の朝、会社に行く前 / 昼も忙しい日は",
        "confidence": 0.95
      },
      "purchase_items": {
        "value": "おにぎり、コーヒー、弁当、サラダ",
        "evidence": "おにぎりとコーヒー / 弁当やサラダ",
        "confidence": 0.97
      },
      "motive": {
        "value": "駅から近い、すぐ寄れる、レジが早い、定番商品を迷わず買える",
        "evidence": "駅から近くてすぐ寄れる / レジが早い / 迷わず買える定番商品",
        "confidence": 0.94
      }
    },
    "Q3": {
      "pain_point": {
        "value": "昼時のレジ待ち",
        "evidence": "昼時のレジ待ちが気になります",
        "confidence": 0.98
      },
      "pain_scene": {
        "value": "12時過ぎに弁当を買うと5分以上並ぶことがある",
        "evidence": "12時過ぎに弁当を買うと5分以上並ぶ",
        "confidence": 0.96
      },
      "impact": {
        "value": "昼休みが短くなる",
        "evidence": "昼休みが短くなります",
        "confidence": 0.96
      },
      "improvement_request": {
        "value": "セルフレジやモバイル注文をもっと使いやすくしてほしい",
        "evidence": "セルフレジやモバイル注文がもっと使いやすいと助かります",
        "confidence": 0.95
      }
    },
    "__free_comment__": {
      "optional_note": {
        "value": "アプリのクーポンは便利だが探すのが面倒で、よく買う商品だけ自動表示されるとよい",
        "evidence": "アプリのクーポンはたまに使いますが、探すのが少し面倒です",
        "confidence": 0.91
      }
    }
  },
  "final_summary": {
    "summary": "平日の朝と昼にコンビニを高頻度で利用する会社員男性。近さ、早さ、迷わず買える定番商品を重視している。一方で昼時のレジ待ちに不満があり、セルフレジやモバイル注文、よく買う商品のクーポン自動表示に改善余地を感じている。",
    "usage_scene": "通勤前の駅前店舗、忙しい日の昼食購入",
    "motive": "短時間で必要なものを買えること",
    "pain_points": [
      "昼時のレジ待ち",
      "クーポンを探す手間"
    ],
    "desired_state": [
      "セルフレジやモバイル注文が使いやすい",
      "よく買う商品のクーポンが自動で見つかる"
    ]
  }
}
```

## 精度評価

| metric | result | reason |
| --- | --- | --- |
| slot_coverage | PASS | 必須スロット frequency, usage_scene, purchase_items, motive, pain_point, pain_scene, improvement_request をすべて回収できている |
| groundedness | PASS | 抽出結果は会話ログ内の発言に根拠があり、回答にない属性や購買行動を追加していない |
| probe_relevance | PASS | Q2 の深掘りは「駅前で買う」理由、Q3 の深掘りは「昼時のレジ待ち」の発生場面に限定されている |
| topic_control | PASS | コンビニ購買体験から逸脱せず、別カテゴリの商品調査に広げていない |
| line_style | PASS | 質問は短く、1 メッセージ 1 論点で LINE 会話に向いている |
| risk | CAUTION | 「平均男性」は合成条件なので、実利用では年代、地域、家族構成、勤務形態ごとに複数ペルソナを用意する必要がある |

## 判定

このシミュレーションでは、AI は回答内容に基づいて自然な深掘りを行い、必須情報を過不足なく回収できているため、精度確認ケースとしては `PASS` と判定する。

追加で精度を検証する場合は、同じプロジェクトで以下のバリエーションを作る。

1. 短文回答だけを返す回答者
2. 話題が逸れる回答者
3. 不満がないと答える回答者
4. 選択肢にない頻度を自然文で答える回答者
