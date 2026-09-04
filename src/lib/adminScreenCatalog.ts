/**
 * adminScreenCatalog.ts
 *
 * 管理画面の「画面カタログ台帳」。admin の全 GET ページを1画面1エントリで宣言する
 * コード内の単一台帳で、ヘッダーナビ・（後続フェーズの）グローバル検索・設定索引・
 * 道しるべAI の4つが同じここを参照する。
 *
 * 経緯（旧 header.ejs :11-14 のコメントを移設）:
 *   ナビは22本のフラットな羅列だったため現在地が分からず、さらに user-profiles /
 *   ai-logs / delivery-templates / scheduler-settings / reward-campaigns /
 *   daily-question-priorities はルートが存在するのにリンクが無く到達できなかった。
 *   業務のまとまりでグループ化し、全ページを載せる。
 *   さらに今回、ナビから到達不能だった7画面（stores / cycles / clients overview /
 *   segments campaigns / prompt-packages migration / quality-scoring recent /
 *   ai-analysis report）を台帳に収録した。
 *
 * 設計上の約束:
 * - **DBに置かない**。コード内定数にして `src/tests/adminScreenCatalog.test.ts` の
 *   routes 突合テストで陳腐化を防ぐ（新画面を足して台帳に書き忘れたらテストが落ちる）。
 * - **既存4画面の key を変えない**: `research-form` / `respondent-show` /
 *   `sessions-index` / `session-show`。AIチャットの sessionStorage 会話キーと
 *   `admin_ai_actions.screen_key` の監査履歴がこの値に紐づくため。
 * - `nav:false` は「ヘッダーに出さない画面」（動的URLで一覧の行から入る画面・
 *   新規作成/編集フォームなど）。台帳からは落とさず、検索・道しるべ・関連リンクで到達させる。
 * - `description` / `settings` / `synonyms` は空にしない（空だと突合テストで fail）。
 *   AIの根拠テキストと検索の素材になるので、実際に画面でできることを書く。
 *
 * カタログ対象外（ページではない・ナビにも出ない）:
 *   `/admin/api/*` ・ `.csv` / `.png` / `.json` / `.zip` を返すエクスポート ・ POST ・
 *   `/admin/login` ・ `/admin/exchange-requests/pending-count`（バッジ用 JSON） ・
 *   `/admin/projects/:projectId/{validate,snapshots,exports/stat/status-counts,exports/stat/history}`
 *   （拡張子は無いが `res.json` を返す JSON API）。
 *   ヘッダーの「アンケでYOTTO」外部リンク群（`portalOpsNavLinks()`）も admin ルートでは
 *   ないのでここには入れない（header.ejs 側でカタログ生成ナビの後ろに push している）。
 */

export interface AdminScreenEntry {
  /** screenKey。既存4キーは現行値を維持（sessionStorage / 監査ログ互換） */
  key: string;
  /** Express のルートパス（`/admin` 込み・`:param` はそのまま） */
  path: string;
  /** ナビ・候補カードの表示名 */
  label: string;
  /** ナビのグループ（調査 / 回答者 / 報酬 / 配信 / 投稿・分析 / 設定 / 店舗） */
  group: string;
  /** ヘッダーナビに出すか（動的URL画面・フォーム画面は false） */
  nav: boolean;
  /** この画面で何ができるか（1〜2文。AIの根拠テキスト） */
  description: string;
  /** この画面で設定・変更できる項目（設定索引と検索の素材） */
  settings: string[];
  /** 別名・言い換え（「離脱率」→ cycles 等） */
  synonyms: string[];
  /** 関連画面の key */
  related: string[];
  /** 動的URL画面のパラメータ（後続フェーズの resolve_entity 用） */
  dynamicParam?: { name: string; resolver: "project" | "client" | "respondent" | "session" };
  /** ナビで強調表示する（現行 `is-primary`） */
  primary?: boolean;
  /**
   * ヘッダー最上段の「ピン留め」列に外出しする（毎日使う画面）。
   * ピン留めしてもグループ内の掲載は消さない（同じ画面が2箇所に出る）。
   * ドロップダウンを開かずに1クリックで行けることを優先するための重複。
   */
  pinned?: boolean;
  /** ナビ項目に付ける通知バッジの DOM id（現行 `nav-exchange-badge`） */
  badgeId?: string;
}

/** ナビのグループ表示順。ここに無いグループのエントリは末尾に回る。 */
export const ADMIN_NAV_GROUP_ORDER = [
  "調査",
  "店舗",
  "回答者",
  "報酬",
  "配信",
  "投稿・分析",
  "設定"
] as const;

export const ADMIN_SCREENS: AdminScreenEntry[] = [
  // ---------------------------------------------------------------------------
  // ダッシュボード（グループ無し。header は先頭に固定リンクで出す）
  // ---------------------------------------------------------------------------
  {
    key: "dashboard",
    path: "/admin",
    label: "ダッシュボード",
    group: "調査",
    nav: false, // header 冒頭の固定リンクとして別枠で描画するためグループには出さない
    description: "管理画面のトップ。案件・回答・配信の全体サマリを一望する。",
    settings: [],
    synonyms: ["トップ", "ホーム", "概要", "サマリ", "dashboard"],
    related: ["projects-index", "sessions-index"]
  },

  // ---------------------------------------------------------------------------
  // 調査
  // ---------------------------------------------------------------------------
  {
    key: "projects-index",
    path: "/admin/projects",
    label: "プロジェクト",
    group: "調査",
    nav: true,
    // ピン留め: 案件を開く起点。ほぼ毎日通る。
    pinned: true,
    description: "調査案件の一覧。ステータスや掲載状態で絞り込み、案件の作成・複製・削除の入口になる。",
    settings: ["案件の絞り込み条件", "案件の複製", "案件の削除"],
    synonyms: ["案件", "調査", "プロジェクト一覧", "アンケート案件", "projects"],
    related: ["research-form", "project-new", "questions-index"]
  },
  {
    key: "project-new",
    path: "/admin/projects/new",
    label: "プロジェクト新規作成",
    group: "調査",
    nav: false,
    description: "調査案件を新規作成する。案件設定フォーム（research-form）と同じ入力項目を持つ。",
    settings: ["案件名", "調査目的", "調査モード", "表示モード", "回答UIプリセット", "謝礼ポイント"],
    synonyms: ["案件作成", "新しい案件", "案件を作る", "新規プロジェクト"],
    related: ["projects-index", "research-form"]
  },
  {
    key: "research-form",
    path: "/admin/projects/:projectId/edit",
    label: "案件設定",
    group: "調査",
    nav: false,
    description:
      "案件の全設定を編集する中心画面。調査モード・表示モード・回答UIプリセット・謝礼・スクリーニング条件・プロンプトパッケージをここで決める。",
    settings: [
      "案件名",
      "調査目的",
      "調査モード（チャット型/設問型）",
      "表示モード",
      "回答UIプリセット",
      "謝礼ポイント",
      "LIFF掲載（一覧に出す）",
      "スクリーニング条件",
      "プロンプトパッケージ・バージョン",
      "若年層体験オプション",
      "所要時間の目安"
    ],
    synonyms: ["案件編集", "案件の設定", "調査設定", "プロジェクト編集", "リサーチフォーム"],
    related: ["projects-index", "questions-index", "project-screening", "prompt-packages-index"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "project-prompt-package-history",
    path: "/admin/projects/:projectId/prompt-package-history",
    label: "案件のプロンプト適用履歴",
    group: "調査",
    nav: false,
    description: "この案件にどのプロンプトパッケージ・バージョンがいつ適用されたかの履歴を見る。",
    settings: [],
    synonyms: ["プロンプト履歴", "パッケージ適用履歴", "AI設定の履歴"],
    related: ["research-form", "prompt-packages-index"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "questions-index",
    path: "/admin/projects/:projectId/questions",
    label: "設問一覧",
    group: "調査",
    nav: false,
    description: "案件の設問を一覧・並べ替え・追加する。設問文・回答形式・選択肢の編集入口。",
    settings: ["設問の並び順", "設問の追加・削除", "設問文", "回答形式", "選択肢"],
    synonyms: ["設問", "質問", "アンケート項目", "設問設計", "questions"],
    related: ["question-flow", "question-new", "question-edit", "research-form"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "question-flow",
    path: "/admin/projects/:projectId/questions/flow",
    label: "フローデザイナー",
    group: "調査",
    nav: false,
    description: "設問の分岐・条件表示をフロー図で編集する。他案件からのフロー流用やAI自動生成もここから行う。",
    settings: ["設問の分岐条件", "条件表示", "選択肢の持ち越し", "フローの流用元案件", "AIによるフロー自動生成"],
    synonyms: ["分岐", "条件分岐", "フロー", "設問の流れ", "ロジック", "flow"],
    related: ["questions-index", "project-blocks", "project-page-groups"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "question-new",
    path: "/admin/projects/:projectId/questions/new",
    label: "設問の新規作成",
    group: "調査",
    nav: false,
    description: "案件に設問を1件追加する。設問文・回答形式・選択肢を入力する。",
    settings: ["設問文", "回答形式", "選択肢", "必須／任意", "深掘りの有無"],
    synonyms: ["設問追加", "質問を足す", "新しい設問"],
    related: ["questions-index", "question-edit"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "question-edit",
    path: "/admin/questions/:questionId/edit",
    label: "設問の編集",
    group: "調査",
    nav: false,
    description: "設問1件の内容を編集する。設問文・回答形式・選択肢・深掘り設定を変更する。",
    settings: ["設問文", "回答形式", "選択肢", "必須／任意", "深掘りの有無", "指標コード"],
    synonyms: ["設問修正", "質問の編集"],
    related: ["questions-index", "question-flow"]
  },
  {
    key: "project-page-groups",
    path: "/admin/projects/:projectId/page-groups",
    label: "ページグループ",
    group: "調査",
    nav: false,
    description: "survey_page 表示モードで、どの設問を同じページにまとめるかを管理する。",
    settings: ["ページの区切り", "ページごとの設問割り当て", "ページ名"],
    synonyms: ["ページ分け", "ページ構成", "1ページに複数設問"],
    related: ["questions-index", "research-form"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "project-concepts",
    path: "/admin/projects/:projectId/concepts",
    label: "コンセプト・ローテーション",
    group: "調査",
    nav: false,
    description: "コンセプト評価用の提示物を登録し、回答者への出し分け（ローテーション）方式を決める。",
    settings: ["コンセプトの追加・編集・削除", "ローテーション方式"],
    synonyms: ["コンセプト", "提示物", "コンセプトテスト", "ローテーション"],
    related: ["questions-index", "project-blocks"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "project-blocks",
    path: "/admin/projects/:projectId/blocks",
    label: "ブロック自動設計",
    group: "調査",
    nav: false,
    description: "AIに設問ブロック構成を提案させ、プレビューしてから適用する。",
    settings: ["ブロック構成の提案条件", "ブロックの適用"],
    synonyms: ["ブロック", "ブロック設計", "AI設計", "自動設計"],
    related: ["question-flow", "questions-index"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "project-screening",
    path: "/admin/projects/:projectId/screening",
    label: "スクリーニング条件",
    group: "調査",
    nav: false,
    description: "プロフィール属性や過去回答の条件で、この案件に回答できる人を絞り込む。",
    settings: ["プロフィール条件", "回答条件", "条件の組み合わせ（AND/OR）"],
    synonyms: ["スクリーニング", "出し分け", "対象条件", "絞り込み条件", "SC"],
    related: ["research-form", "user-profiles-index", "segments-index"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "project-respondents",
    path: "/admin/projects/:projectId/respondents",
    label: "案件の回答者",
    group: "調査",
    nav: false,
    description: "この案件に割り当てられた回答者の状況（未配信・回答中・完了）を一覧する。",
    settings: ["回答者の絞り込み"],
    synonyms: ["案件の参加者", "対象者一覧", "アサイン一覧"],
    related: ["project-delivery", "respondents-index"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "project-delivery",
    path: "/admin/projects/:projectId/delivery",
    label: "案件の配信",
    group: "調査",
    nav: false,
    description: "この案件のLINE配信を行う。配信対象の抽出・配信実行・リマインド送信ができる。",
    settings: ["配信対象の条件", "配信メッセージ", "リマインド送信"],
    synonyms: ["案件配信", "この案件を送る", "アサイン配信", "リマインド"],
    related: ["delivery-operations", "delivery-templates-index", "project-respondents"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "project-analysis",
    path: "/admin/projects/:projectId/analysis",
    label: "案件の分析",
    group: "調査",
    nav: false,
    description: "この案件の回答結果を集計・AI分析する。統計エクスポートの入口でもある。",
    settings: ["分析の実行", "エクスポート形式の選択"],
    synonyms: ["集計", "結果", "分析", "レポート", "エクスポート"],
    related: ["ai-analysis-index", "ai-analysis-report"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "daily-surveys-index",
    path: "/admin/daily-surveys",
    label: "デイリーアンケート",
    group: "調査",
    nav: true,
    // ピン留め: 毎日の出題管理。
    pinned: true,
    description: "1日1問のデイリーアンケートを管理する。キューに積むと上から順に自動配信される。",
    settings: ["設問の追加", "配信キューの並び", "配信日の固定", "夜枠の有無"],
    synonyms: ["デイリー", "今日の1問", "毎日のアンケート", "1問", "daily"],
    related: ["daily-survey-new", "daily-question-priorities-index", "delivery-calendar"]
  },
  {
    key: "daily-survey-new",
    path: "/admin/daily-surveys/new",
    label: "デイリーアンケート新規作成",
    group: "調査",
    nav: false,
    description: "デイリーアンケートの設問を1件作成し、配信キューに積む。",
    settings: ["設問文", "回答形式", "選択肢", "配信日", "配信枠（朝／夜）", "謝礼ポイント"],
    synonyms: ["デイリー作成", "1問作る", "今日の1問を追加"],
    related: ["daily-surveys-index", "daily-survey-show"]
  },
  {
    key: "daily-survey-show",
    path: "/admin/daily-surveys/:surveyId",
    label: "デイリーアンケート詳細",
    group: "調査",
    nav: false,
    description: "デイリーアンケート1件の内容と配信状況・回答状況を見る。",
    settings: [],
    synonyms: ["デイリー詳細", "1問の中身"],
    related: ["daily-surveys-index", "daily-survey-analytics", "daily-survey-edit"]
  },
  {
    key: "daily-survey-analytics",
    path: "/admin/daily-surveys/:surveyId/analytics",
    label: "デイリーアンケート集計",
    group: "調査",
    nav: false,
    description: "デイリーアンケート1件の回答分布・回答率を集計して見る。",
    settings: [],
    synonyms: ["デイリー集計", "1問の結果", "回答分布"],
    related: ["daily-survey-show", "daily-surveys-index"]
  },
  {
    key: "daily-survey-edit",
    path: "/admin/daily-surveys/:surveyId/edit",
    label: "デイリーアンケート編集",
    group: "調査",
    nav: false,
    description: "デイリーアンケート1件の設問文・選択肢・配信日・謝礼を編集する。",
    settings: ["設問文", "回答形式", "選択肢", "配信日", "配信枠（朝／夜）", "謝礼ポイント"],
    synonyms: ["デイリー編集", "1問を直す"],
    related: ["daily-surveys-index", "daily-survey-show"]
  },
  {
    key: "daily-question-priorities-index",
    path: "/admin/daily-question-priorities",
    label: "デイリー優先設問",
    group: "調査",
    nav: true,
    description: "デイリーアンケートで優先的に配信したい設問を登録・並べ替えする。",
    settings: ["優先設問の追加・削除", "優先順位", "有効期間"],
    synonyms: ["優先設問", "優先出題", "デイリー優先", "先に聞きたい設問"],
    related: ["daily-surveys-index", "daily-question-priority-new"]
  },
  {
    key: "daily-question-priority-new",
    path: "/admin/daily-question-priorities/new",
    label: "デイリー優先設問の新規作成",
    group: "調査",
    nav: false,
    description: "デイリーで優先配信する設問を1件登録する。",
    settings: ["対象設問", "優先順位", "有効期間"],
    synonyms: ["優先設問を追加"],
    related: ["daily-question-priorities-index"]
  },
  {
    key: "daily-question-priority-edit",
    path: "/admin/daily-question-priorities/:id/edit",
    label: "デイリー優先設問の編集",
    group: "調査",
    nav: false,
    description: "登録済みのデイリー優先設問の優先順位・有効期間を編集する。",
    settings: ["対象設問", "優先順位", "有効期間"],
    synonyms: ["優先設問を直す"],
    related: ["daily-question-priorities-index"]
  },
  {
    key: "pool-questions-index",
    path: "/admin/pool-questions",
    label: "ついでスワイプ",
    group: "調査",
    nav: true,
    description: "案件一覧に埋め込む低ステークスな2択設問（設問プール）を管理する。信頼スコアの素材になる。",
    settings: ["設問の追加・編集・公開", "トピックタグ", "1日の出題上限", "再出題のクールダウン"],
    synonyms: ["スワイプ", "設問プール", "ついで", "2択", "pool"],
    related: ["pool-question-new", "pool-questions-bulk", "quality-scoring-index"]
  },
  {
    key: "pool-question-new",
    path: "/admin/pool-questions/new",
    label: "ついでスワイプ設問の新規作成",
    group: "調査",
    nav: false,
    description: "ついでスワイプの設問を1件作成する。",
    settings: ["設問文", "選択肢", "トピックタグ", "謝礼ポイント", "公開状態"],
    synonyms: ["スワイプ設問を追加", "プール設問作成"],
    related: ["pool-questions-index", "pool-questions-bulk"]
  },
  {
    key: "pool-questions-bulk",
    path: "/admin/pool-questions/bulk",
    label: "ついでスワイプ設問の一括作成",
    group: "調査",
    nav: false,
    description: "ついでスワイプの設問をまとめて作成する。",
    settings: ["設問文（複数行）", "トピックタグ", "公開状態"],
    synonyms: ["スワイプ一括", "まとめて作る", "一括登録"],
    related: ["pool-questions-index", "pool-question-new"]
  },
  {
    key: "pool-question-edit",
    path: "/admin/pool-questions/:id/edit",
    label: "ついでスワイプ設問の編集",
    group: "調査",
    nav: false,
    description: "ついでスワイプの設問1件の内容・タグ・公開状態を編集する。",
    settings: ["設問文", "選択肢", "トピックタグ", "謝礼ポイント", "公開状態"],
    synonyms: ["スワイプ設問を直す"],
    related: ["pool-questions-index"]
  },

  // ---------------------------------------------------------------------------
  // 店舗（新設グループ。store-surveys を調査から移し、到達不能だった stores / cycles を載せる）
  // ---------------------------------------------------------------------------
  {
    key: "stores-index",
    path: "/admin/stores",
    label: "店舗マスタ",
    group: "店舗",
    nav: true,
    description:
      "法人（クライアント）と店舗を管理する。店舗を1件追加するとA/B/C案件・設問・QRコード・サイクル定義がまとめて生成される。",
    settings: ["法人の登録", "店舗の登録・編集", "業種テンプレートの選択", "店舗別案件の一括生成"],
    synonyms: ["店舗", "お店", "チェーン", "法人", "クライアント", "店舗一覧", "stores"],
    related: ["cycles-index", "store-surveys-index", "client-overview"]
  },
  {
    key: "cycles-index",
    path: "/admin/cycles",
    label: "サイクル分析",
    group: "店舗",
    nav: true,
    description:
      "店舗のA/B/Cサイクル（繰り返し来店調査）の進行と離脱率を見る。回次をまたいだ横串のファネルを確認する。",
    settings: ["対象店舗・期間の絞り込み"],
    synonyms: ["離脱", "離脱率", "ファネル", "サイクル", "リピート", "来店周期", "cycles"],
    related: ["stores-index", "store-surveys-index", "client-overview"]
  },
  {
    key: "store-surveys-index",
    path: "/admin/store-surveys",
    label: "店舗専用アンケート",
    group: "店舗",
    nav: true,
    description: "店舗QR・専用URLから流入する単発アンケートを管理する。チラシとQRコードの発行もここから行う。",
    settings: ["店舗専用アンケートの割り当て", "入場コード（entry_code）", "チラシ・QRの発行"],
    synonyms: ["店舗アンケート", "QR", "単発アンケート", "チラシ", "店頭"],
    related: ["store-survey-flyer", "stores-index", "client-overview"]
  },
  {
    key: "store-survey-flyer",
    path: "/admin/store-surveys/:projectId/flyer",
    label: "店舗アンケートのチラシ",
    group: "店舗",
    nav: false,
    description: "店頭に置く印刷用チラシ（QRコード付き）を表示する。そのまま印刷して使う。",
    settings: [],
    synonyms: ["チラシ", "ポスター", "印刷", "QRコード"],
    related: ["store-surveys-index"],
    dynamicParam: { name: "projectId", resolver: "project" }
  },
  {
    key: "client-overview",
    path: "/admin/clients/:clientId/overview",
    label: "企業まとめ",
    group: "店舗",
    nav: false, // 動的URL（clientId 必須）なのでナビには出せない。店舗一覧／道しるべから入る
    description: "1つの法人（クライアント）に紐づく店舗・案件・回答結果を横断してまとめて見る。",
    settings: ["対象期間の絞り込み"],
    synonyms: ["企業", "法人まとめ", "クライアント", "会社ごと", "横断集計"],
    related: ["stores-index", "cycles-index", "store-surveys-index"],
    dynamicParam: { name: "clientId", resolver: "client" }
  },

  // ---------------------------------------------------------------------------
  // 回答者
  // ---------------------------------------------------------------------------
  {
    key: "respondents-index",
    path: "/admin/respondents",
    label: "回答者",
    group: "回答者",
    nav: true,
    // ピン留め: 回答者を調べる起点。
    pinned: true,
    description: "回答者を一覧・検索する。案件・ステータス・氏名で絞り込み、詳細画面へ入る。",
    settings: ["絞り込み条件（案件・ステータス・氏名）"],
    synonyms: ["ユーザー", "参加者", "モニター", "会員", "回答者一覧", "respondents"],
    related: ["respondent-show", "user-profiles-index", "sessions-index"]
  },
  {
    key: "respondent-show",
    path: "/admin/respondents/:respondentId",
    label: "回答者詳細",
    group: "回答者",
    nav: false,
    description: "回答者1人の参加案件・回答履歴・ポイント・ランクをまとめて見る。手動でのポイント付与もここから行う。",
    settings: ["ステータス変更", "手動ポイント付与", "メモ"],
    synonyms: ["ユーザー詳細", "この人の履歴", "回答者の中身"],
    related: ["respondents-index", "session-show", "points-index"],
    dynamicParam: { name: "respondentId", resolver: "respondent" }
  },
  {
    key: "sessions-index",
    path: "/admin/sessions",
    label: "セッション",
    group: "回答者",
    nav: true,
    description: "回答セッションを一覧する。案件・ステータスで絞り込み、途中離脱や未完了を洗い出す。",
    settings: ["絞り込み条件（案件・ステータス）"],
    synonyms: ["回答状況", "進捗", "セッション一覧", "途中離脱", "sessions"],
    related: ["session-show", "respondents-index", "project-analysis"]
  },
  {
    key: "session-show",
    path: "/admin/sessions/:sessionId",
    label: "セッション詳細",
    group: "回答者",
    nav: false,
    description: "回答セッション1件の会話ログ・回答内容・AIの深掘りを1問ずつ確認する。",
    settings: [],
    synonyms: ["会話ログ", "回答の中身", "チャット履歴", "1件の回答"],
    related: ["sessions-index", "respondent-show", "ai-logs-index"],
    dynamicParam: { name: "sessionId", resolver: "session" }
  },
  {
    key: "user-profiles-index",
    path: "/admin/user-profiles",
    label: "プロフィール検索",
    group: "回答者",
    nav: true,
    description: "登録者のプロフィール属性（年代・地域・職業など）で検索し、対象になり得る人数を確認する。",
    settings: ["検索条件（属性の組み合わせ）"],
    synonyms: ["プロフィール", "属性検索", "何人いる", "母集団", "ターゲット検索"],
    related: ["attributes-index", "segments-index", "project-screening"]
  },
  {
    key: "applications-index",
    path: "/admin/applications",
    label: "応募管理",
    group: "回答者",
    nav: true,
    description: "案件への応募を一覧し、当選・落選を判定する。一括での当選／落選処理もできる。",
    settings: ["応募の絞り込み", "当選・落選の判定", "一括当選／一括落選"],
    synonyms: ["応募", "当選", "落選", "選考", "抽選", "applications"],
    related: ["projects-index", "respondents-index", "project-delivery"]
  },
  {
    key: "attributes-index",
    path: "/admin/attributes",
    label: "属性管理",
    group: "回答者",
    nav: true,
    description: "回答者プロフィールの属性定義（項目名・型・選択肢）を追加・削除する。",
    settings: ["属性定義の追加・削除", "属性の型", "属性の選択肢"],
    synonyms: ["属性", "プロフィール項目", "デモグラ", "attributes"],
    related: ["user-profiles-index", "segments-index"]
  },

  // ---------------------------------------------------------------------------
  // 報酬
  // ---------------------------------------------------------------------------
  {
    key: "points-index",
    path: "/admin/points",
    label: "ポイント",
    group: "報酬",
    nav: true,
    description: "ポイントの付与履歴を一覧・検索する。誰にいつ何ポイント入ったかを追う。",
    settings: ["履歴の絞り込み"],
    synonyms: ["ポイント", "pt", "謝礼", "報酬履歴", "points"],
    related: ["ranks-index", "exchange-requests-index", "reward-campaigns-index"]
  },
  {
    key: "ranks-index",
    path: "/admin/ranks",
    label: "ランク",
    group: "報酬",
    nav: true,
    description: "ランク（階級）の名称・必要ポイント・バッジ表示ラベルを設定する。",
    settings: ["ランク名", "必要ポイント（下限）", "バッジ表示ラベル"],
    synonyms: ["ランク", "階級", "レベル", "ブロンズ", "ゴールド", "ranks"],
    related: ["badges-index", "points-index", "quality-scoring-index"]
  },
  {
    key: "badges-index",
    path: "/admin/badges",
    label: "バッジ",
    group: "報酬",
    nav: true,
    description: "回答者に付与するバッジの定義と付与条件を管理する。",
    settings: ["バッジ名", "付与条件", "表示アイコン"],
    synonyms: ["バッジ", "称号", "実績", "badges"],
    related: ["ranks-index", "points-index"]
  },
  {
    key: "reward-campaigns-index",
    path: "/admin/reward-campaigns",
    label: "報酬キャンペーン",
    group: "報酬",
    nav: true,
    description: "期間限定のポイント増量などの報酬キャンペーンを一覧・管理する。",
    settings: ["キャンペーンの有効／無効", "対象期間", "倍率・加算ポイント"],
    synonyms: ["キャンペーン", "ポイント増量", "ボーナス", "倍率"],
    related: ["reward-campaign-new", "points-index"]
  },
  {
    key: "reward-campaign-new",
    path: "/admin/reward-campaigns/new",
    label: "報酬キャンペーンの新規作成",
    group: "報酬",
    nav: false,
    description: "報酬キャンペーンを1件作成する。",
    settings: ["キャンペーン名", "対象期間", "倍率・加算ポイント", "対象条件"],
    synonyms: ["キャンペーン追加"],
    related: ["reward-campaigns-index"]
  },
  {
    key: "reward-campaign-edit",
    path: "/admin/reward-campaigns/:id/edit",
    label: "報酬キャンペーンの編集",
    group: "報酬",
    nav: false,
    description: "報酬キャンペーン1件の期間・倍率・対象条件を編集する。",
    settings: ["キャンペーン名", "対象期間", "倍率・加算ポイント", "対象条件"],
    synonyms: ["キャンペーン編集"],
    related: ["reward-campaigns-index"]
  },
  {
    key: "exchange-requests-index",
    path: "/admin/exchange-requests",
    label: "交換申請",
    group: "報酬",
    nav: true,
    // ピン留め: 申請が溜まると滞留するので常時見える位置に置く。
    pinned: true,
    badgeId: "nav-exchange-badge",
    description: "ポイント交換（eGift）の申請を一覧し、承認・却下・送付を行う。申請中の件数はナビにバッジで出る。",
    settings: ["申請の承認・却下", "送付処理", "絞り込み条件"],
    synonyms: ["交換", "ギフト", "eGift", "換金", "交換申請一覧", "exchange"],
    related: ["points-index", "respondents-index"]
  },
  {
    key: "missions-index",
    path: "/admin/mission",
    label: "ミッション",
    group: "報酬",
    nav: true,
    description: "ミッション（段階報酬キャンペーン）の一覧。ステージ・テーマ・隠し部屋つき企画の作成入口になる。",
    settings: ["ミッションの作成", "公開状態の確認"],
    synonyms: ["ミッション一覧", "段階報酬", "キャンペーン企画", "missions"],
    related: ["mission-form", "mission-invites"]
  },
  {
    key: "mission-form",
    path: "/admin/mission/:id",
    label: "ミッションの作成・編集",
    group: "報酬",
    nav: false,
    description: "ミッション1件の期間・テーマ・ステージ（最大5段）・隠し部屋（山分け/一律/抽選）を設定する。報酬は1人あたり上限2,000pt。",
    settings: ["ミッション名", "対象範囲", "期間", "テーマ", "ステージ条件と報酬", "隠し部屋の開き方と報酬"],
    synonyms: ["ミッション編集", "ステージ設定", "隠し部屋"],
    related: ["missions-index"]
  },
  {
    key: "mission-invites",
    path: "/admin/mission/invites",
    label: "招待実績",
    group: "報酬",
    nav: true,
    description: "招待リンクの発行・登録・回答の実績一覧。招待偏重のフラグ確認と招待の取消ができる。",
    settings: ["招待の取消"],
    synonyms: ["招待", "紹介", "友だち招待", "invites"],
    related: ["missions-index"]
  },

  // ---------------------------------------------------------------------------
  // 配信
  // ---------------------------------------------------------------------------
  {
    key: "delivery-operations",
    path: "/admin/delivery-operations",
    label: "配信オペレーション",
    group: "配信",
    nav: true,
    // ピン留め: 配信の実行導線。
    pinned: true,
    primary: true,
    description: "日々のLINE配信をまとめて行う中心画面。対象抽出から配信実行までをここで完結させる。",
    settings: ["配信対象の抽出条件", "配信テンプレートの選択", "配信の実行"],
    synonyms: ["配信", "送る", "LINE配信", "プッシュ", "オペレーション", "delivery"],
    related: ["delivery-calendar", "segments-index", "delivery-templates-index"]
  },
  {
    key: "delivery-calendar",
    path: "/admin/delivery-calendar",
    label: "配信カレンダー",
    group: "配信",
    nav: true,
    // ピン留め: 配信予定の確認。
    pinned: true,
    description: "いつ何が配信される／配信されたかをカレンダーで俯瞰する。日付をドラッグして配信日を動かせる。",
    settings: ["配信日の変更", "表示月の切り替え"],
    synonyms: ["カレンダー", "配信予定", "スケジュール", "いつ送る"],
    related: ["delivery-operations", "daily-surveys-index", "scheduler-settings"]
  },
  {
    key: "segments-index",
    path: "/admin/segments",
    label: "セグメント配信",
    group: "配信",
    nav: true,
    description: "属性・行動条件で回答者のセグメントを定義し、対象人数をプレビューする。セグメント宛の配信キャンペーンの起点。",
    settings: ["セグメントの条件", "セグメントの追加・編集・削除", "対象人数のプレビュー"],
    synonyms: ["セグメント", "条件配信", "ターゲティング", "絞って送る", "segments"],
    related: ["segment-new", "segments-campaigns-index", "delivery-operations"]
  },
  {
    key: "segment-new",
    path: "/admin/segments/new",
    label: "セグメントの新規作成",
    group: "配信",
    nav: false,
    description: "配信対象セグメントを1件作成する。条件を組んで対象人数を確認できる。",
    settings: ["セグメント名", "属性条件", "回答条件", "対象人数のプレビュー"],
    synonyms: ["セグメント追加", "条件を作る"],
    related: ["segments-index"]
  },
  {
    key: "segment-edit",
    path: "/admin/segments/:segmentId/edit",
    label: "セグメントの編集",
    group: "配信",
    nav: false,
    description: "既存セグメントの条件を編集し、対象人数を再確認する。",
    settings: ["セグメント名", "属性条件", "回答条件", "対象人数のプレビュー"],
    synonyms: ["セグメント編集", "条件を直す"],
    related: ["segments-index"]
  },
  {
    key: "segments-campaigns-index",
    path: "/admin/segments/campaigns",
    label: "配信キャンペーン",
    group: "配信",
    nav: true,
    description: "セグメント宛のLINE配信キャンペーンを一覧し、実行状況・実行結果を確認する。",
    settings: ["キャンペーンの実行", "キャンペーンの中止", "絞り込み条件"],
    synonyms: ["キャンペーン配信", "セグメント配信の実行", "一斉配信", "campaigns"],
    related: ["segments-index", "segments-campaign-new", "delivery-operations"]
  },
  {
    key: "segments-campaign-new",
    path: "/admin/segments/campaigns/new",
    label: "配信キャンペーンの新規作成",
    group: "配信",
    nav: false,
    description: "セグメント宛の配信キャンペーンを1件作成する。対象セグメントと配信内容を決める。",
    settings: ["キャンペーン名", "対象セグメント", "配信メッセージ", "配信予定日時"],
    synonyms: ["キャンペーン作成", "一斉配信を作る"],
    related: ["segments-campaigns-index", "segments-index"]
  },
  {
    key: "segments-campaign-edit",
    path: "/admin/segments/campaigns/:campaignId/edit",
    label: "配信キャンペーンの編集",
    group: "配信",
    nav: false,
    description: "配信キャンペーン1件の対象セグメント・メッセージ・予定日時を編集する。",
    settings: ["キャンペーン名", "対象セグメント", "配信メッセージ", "配信予定日時"],
    synonyms: ["キャンペーン編集"],
    related: ["segments-campaigns-index"]
  },
  {
    key: "delivery-templates-index",
    path: "/admin/delivery-templates",
    label: "配信テンプレート",
    group: "配信",
    nav: true,
    description: "LINE配信の文面テンプレート（Flex含む）を一覧・管理する。配信オペレーションから選んで使う。",
    settings: ["テンプレートの追加・編集・削除", "文面", "対象セグメント"],
    synonyms: ["配信文面", "テンプレ", "メッセージ雛形", "Flex"],
    related: ["delivery-template-new", "delivery-operations", "notification-templates-index"]
  },
  {
    key: "delivery-template-new",
    path: "/admin/delivery-templates/new",
    label: "配信テンプレートの新規作成",
    group: "配信",
    nav: false,
    description: "LINE配信の文面テンプレートを1件作成する。",
    settings: ["テンプレート名", "文面", "差し込み変数", "対象セグメント"],
    synonyms: ["テンプレ追加", "文面を作る"],
    related: ["delivery-templates-index"]
  },
  {
    key: "delivery-template-edit",
    path: "/admin/delivery-templates/:id/edit",
    label: "配信テンプレートの編集",
    group: "配信",
    nav: false,
    description: "配信テンプレート1件の文面・差し込み変数・対象セグメントを編集する。",
    settings: ["テンプレート名", "文面", "差し込み変数", "対象セグメント"],
    synonyms: ["テンプレ編集", "文面を直す"],
    related: ["delivery-templates-index"]
  },
  {
    key: "notification-templates-index",
    path: "/admin/notification-templates",
    label: "通知テンプレート",
    group: "配信",
    nav: true,
    description: "リマインドや完了通知など、システム通知の文面テンプレートを管理する。",
    settings: ["通知テンプレートの追加・編集・削除", "通知種別", "文面"],
    synonyms: ["通知", "リマインド文面", "お知らせ", "notification"],
    related: ["notification-template-new", "delivery-templates-index", "scheduler-settings"]
  },
  {
    key: "notification-template-new",
    path: "/admin/notification-templates/new",
    label: "通知テンプレートの新規作成",
    group: "配信",
    nav: false,
    description: "システム通知の文面テンプレートを1件作成する。",
    settings: ["テンプレート名", "通知種別", "文面", "差し込み変数"],
    synonyms: ["通知テンプレ追加"],
    related: ["notification-templates-index"]
  },
  {
    key: "notification-template-edit",
    path: "/admin/notification-templates/:templateId/edit",
    label: "通知テンプレートの編集",
    group: "配信",
    nav: false,
    description: "通知テンプレート1件の種別・文面・差し込み変数を編集する。",
    settings: ["テンプレート名", "通知種別", "文面", "差し込み変数"],
    synonyms: ["通知テンプレ編集"],
    related: ["notification-templates-index"]
  },
  {
    key: "scheduler-settings",
    path: "/admin/scheduler-settings",
    label: "スケジューラ",
    group: "配信",
    nav: true,
    description: "自動配信の時間枠（朝枠・夜枠）や有効／無効など、定期実行の設定を変更する。",
    settings: ["朝枠の配信時刻", "夜枠の有無と配信時刻", "自動配信の有効／無効", "追い付き実行の窓"],
    synonyms: ["スケジューラ", "自動配信", "cron", "定期実行", "配信時刻", "何時に送る"],
    related: ["delivery-calendar", "daily-surveys-index", "delivery-operations"]
  },

  // ---------------------------------------------------------------------------
  // 投稿・分析
  // ---------------------------------------------------------------------------
  {
    key: "posts-index",
    path: "/admin/posts",
    label: "投稿",
    group: "投稿・分析",
    nav: true,
    description: "回答者の投稿を一覧・検索し、公開／非公開の判断を行う。",
    settings: ["投稿の絞り込み", "公開・非公開の切り替え"],
    synonyms: ["投稿", "口コミ", "ユーザー投稿", "posts"],
    related: ["post-show", "post-analysis-index", "data-management"]
  },
  {
    key: "post-show",
    path: "/admin/posts/:postId",
    label: "投稿詳細",
    group: "投稿・分析",
    nav: false,
    description: "投稿1件の本文・添付・モデレーション判定結果を確認する。",
    settings: ["公開・非公開の切り替え", "モデレーション判定の上書き"],
    synonyms: ["投稿の中身", "1件の投稿"],
    related: ["posts-index", "data-management"]
  },
  {
    key: "post-analysis-index",
    path: "/admin/post-analysis",
    label: "投稿分析",
    group: "投稿・分析",
    nav: true,
    description: "投稿群をAIで分析し、傾向・トピックを俯瞰する。",
    settings: ["分析対象の絞り込み", "分析の実行"],
    synonyms: ["投稿の傾向", "投稿AI分析", "トピック分析"],
    related: ["posts-index", "ai-analysis-index"]
  },
  {
    key: "ai-analysis-index",
    path: "/admin/ai-analysis",
    label: "AI分析",
    group: "投稿・分析",
    nav: true,
    description: "案件の回答をAIで分析するダッシュボード。分析の実行と結果の閲覧を行う。",
    settings: ["分析対象案件", "分析の実行"],
    synonyms: ["AI分析", "自動分析", "インサイト", "分析ダッシュボード"],
    related: ["ai-analysis-report", "project-analysis", "ai-logs-index"]
  },
  {
    key: "ai-analysis-report",
    path: "/admin/ai-analysis/report",
    label: "AI拡張分析レポート",
    group: "投稿・分析",
    nav: true,
    description: "AI分析の結果を読み物のレポート形式でまとめて見る。案件横断の考察を確認する。",
    settings: ["レポート対象の絞り込み"],
    synonyms: ["レポート", "拡張分析", "AIレポート", "考察", "report"],
    related: ["ai-analysis-index", "project-analysis"]
  },
  {
    key: "ai-logs-index",
    path: "/admin/ai-logs",
    label: "AI実行ログ",
    group: "投稿・分析",
    nav: true,
    description: "AI呼び出しの実行ログを一覧する。失敗・遅延・トークン消費の調査に使う。",
    settings: ["ログの絞り込み（種別・期間・成否）"],
    synonyms: ["AIログ", "LLMログ", "実行履歴", "エラー調査", "logs"],
    related: ["ai-log-show", "ai-analysis-index", "prompt-packages-index"]
  },
  {
    key: "ai-log-show",
    path: "/admin/ai-logs/:logId",
    label: "AI実行ログ詳細",
    group: "投稿・分析",
    nav: false,
    description: "AI呼び出し1件のプロンプト・応答・所要時間・エラー内容を確認する。",
    settings: [],
    synonyms: ["ログ詳細", "プロンプトの中身", "AI応答"],
    related: ["ai-logs-index", "prompt-packages-index"]
  },
  {
    key: "data-management",
    path: "/admin/data-management",
    label: "モデレーション設定",
    group: "投稿・分析",
    nav: true,
    description: "投稿のモデレーション基準やNGワードなど、データ取り扱いの設定を変更する。",
    settings: ["NGワード", "モデレーション基準", "自動非公開の閾値"],
    synonyms: ["モデレーション", "NGワード", "検閲", "データ管理", "不適切投稿"],
    related: ["posts-index", "post-show"]
  },

  // ---------------------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------------------
  {
    key: "documents-index",
    path: "/admin/documents",
    label: "書類管理",
    group: "設定",
    nav: true,
    description: "利用規約・プライバシーポリシーなどの書類とそのバージョンを管理し、同意取得の対象を決める。",
    settings: ["書類の追加・編集", "バージョンの作成・公開", "同意必須の指定", "適用範囲"],
    synonyms: ["規約", "利用規約", "プライバシーポリシー", "同意", "書類", "documents"],
    related: ["document-new", "document-show", "document-consent-audit"]
  },
  {
    key: "document-new",
    path: "/admin/documents/new",
    label: "書類の新規作成",
    group: "設定",
    nav: false,
    description: "規約などの書類を1件新規登録する。",
    settings: ["書類名", "書類種別", "同意必須の指定", "適用範囲"],
    synonyms: ["書類追加", "規約を作る"],
    related: ["documents-index"]
  },
  {
    key: "document-show",
    path: "/admin/documents/:documentId",
    label: "書類詳細",
    group: "設定",
    nav: false,
    description: "書類1件の本文と各バージョンの公開状況・同意件数を確認する。",
    settings: ["バージョンの公開・非公開"],
    synonyms: ["書類の中身", "規約の詳細"],
    related: ["documents-index", "document-version-new", "document-consent-audit"]
  },
  {
    key: "document-edit",
    path: "/admin/documents/:documentId/edit",
    label: "書類の編集",
    group: "設定",
    nav: false,
    description: "書類1件の名称・種別・同意必須の指定・適用範囲を編集する。",
    settings: ["書類名", "書類種別", "同意必須の指定", "適用範囲"],
    synonyms: ["書類編集", "規約を直す"],
    related: ["documents-index", "document-show"]
  },
  {
    key: "document-version-new",
    path: "/admin/documents/:documentId/versions/new",
    label: "書類バージョンの新規作成",
    group: "設定",
    nav: false,
    description: "書類の新しいバージョン（改訂版）を作成し、公開して再同意の対象にする。",
    settings: ["バージョン番号", "本文", "施行日", "公開の可否"],
    synonyms: ["改訂", "新バージョン", "規約の更新", "再同意"],
    related: ["documents-index", "document-show"]
  },
  {
    key: "document-consent-audit",
    path: "/admin/documents/:documentId/consent-audit",
    label: "書類の同意監査",
    group: "設定",
    nav: false,
    description: "誰がどのバージョンにいつ同意したかの記録を監査する。",
    settings: ["監査対象の絞り込み（バージョン・期間）"],
    synonyms: ["同意履歴", "同意記録", "誰が同意したか", "監査"],
    related: ["documents-index", "document-show"]
  },
  {
    key: "prompt-packages-index",
    path: "/admin/prompt-packages",
    label: "プロンプトパッケージ",
    group: "設定",
    nav: true,
    description: "AIの振る舞い（深掘り・会話トーンなど）をまとめたプロンプトパッケージとそのバージョンを管理する。",
    settings: ["パッケージの追加・編集", "バージョンの作成・公開・アーカイブ", "プリセットの選択", "振る舞い方針"],
    synonyms: ["プロンプト", "AI設定", "深掘り設定", "パッケージ", "トーン", "prompt"],
    related: ["prompt-package-new", "prompt-package-show", "prompt-packages-migration", "research-form"]
  },
  {
    key: "prompt-package-new",
    path: "/admin/prompt-packages/new",
    label: "プロンプトパッケージの新規作成",
    group: "設定",
    nav: false,
    description: "プロンプトパッケージを1件新規作成する。",
    settings: ["パッケージ名", "用途", "初期バージョンの内容"],
    synonyms: ["パッケージ作成", "プロンプトを作る"],
    related: ["prompt-packages-index"]
  },
  {
    key: "prompt-package-show",
    path: "/admin/prompt-packages/:packageId",
    label: "プロンプトパッケージ詳細",
    group: "設定",
    nav: false,
    description: "パッケージ1件のバージョン一覧と、系統別のプロンプト定義状況を確認する。",
    settings: ["バージョンの公開・アーカイブ"],
    synonyms: ["パッケージの中身", "バージョン一覧"],
    related: ["prompt-packages-index", "prompt-package-version-new", "prompt-package-compare"]
  },
  {
    key: "prompt-package-edit",
    path: "/admin/prompt-packages/:packageId/edit",
    label: "プロンプトパッケージの編集",
    group: "設定",
    nav: false,
    description: "パッケージ1件の名称・用途などのメタ情報を編集する。",
    settings: ["パッケージ名", "用途", "説明"],
    synonyms: ["パッケージ編集"],
    related: ["prompt-packages-index", "prompt-package-show"]
  },
  {
    key: "prompt-package-compare",
    path: "/admin/prompt-packages/:packageId/compare",
    label: "プロンプトバージョン比較",
    group: "設定",
    nav: false,
    description: "同じパッケージの2バージョンをキーごとに並べて差分を比較する。深掘り関連を中心に並べ替えられる。",
    settings: ["比較対象バージョンの選択", "系統フィルタ", "並べ替え"],
    synonyms: ["比較", "差分", "バージョン比較", "diff"],
    related: ["prompt-package-show", "prompt-package-version-edit"]
  },
  {
    key: "prompt-package-version-new",
    path: "/admin/prompt-packages/:packageId/versions/new",
    label: "プロンプトバージョンの新規作成",
    group: "設定",
    nav: false,
    description: "パッケージに新しいバージョンを作る。振る舞い方針からAIに本文を生成させることもできる。",
    settings: ["振る舞い方針", "用途／深掘り／品質の方針", "各プロンプトキーの本文", "プリセットの適用"],
    synonyms: ["バージョン作成", "プロンプト新版", "ビルダー"],
    related: ["prompt-package-show", "prompt-package-version-edit"]
  },
  {
    key: "prompt-package-version-edit",
    path: "/admin/prompt-packages/:packageId/versions/:versionId/edit",
    label: "プロンプトバージョンの編集",
    group: "設定",
    nav: false,
    description: "バージョン1件の各プロンプトキー本文を編集する。深掘りプレイグラウンドで実際の出力を試せる。",
    settings: ["振る舞い方針", "各プロンプトキーの本文", "深掘りプレイグラウンド", "プリセットの適用"],
    synonyms: ["バージョン編集", "プロンプトを直す", "プレイグラウンド"],
    related: ["prompt-package-show", "prompt-package-compare", "prompt-package-version-publish-confirm"]
  },
  {
    key: "prompt-package-version-publish-confirm",
    path: "/admin/prompt-packages/:packageId/versions/:versionId/publish-confirm",
    label: "プロンプトバージョンの公開確認",
    group: "設定",
    nav: false,
    description: "バージョンを公開する前に影響範囲を確認する。公開すると案件のAI挙動が切り替わる。",
    settings: ["公開の実行"],
    synonyms: ["公開", "リリース", "publish"],
    related: ["prompt-package-show", "prompt-package-version-edit"]
  },
  {
    key: "prompt-package-version-archive-confirm",
    path: "/admin/prompt-packages/:packageId/versions/:versionId/archive-confirm",
    label: "プロンプトバージョンのアーカイブ確認",
    group: "設定",
    nav: false,
    description: "バージョンをアーカイブする前に影響範囲を確認する。使用中の案件があれば警告が出る。",
    settings: ["アーカイブの実行"],
    synonyms: ["アーカイブ", "廃止", "archive"],
    related: ["prompt-package-show", "prompt-package-version-edit"]
  },
  {
    key: "prompt-packages-migration",
    path: "/admin/prompt-packages/migration",
    label: "プロンプト移行レポート",
    group: "設定",
    nav: true,
    description: "案件ごとの旧カスタムプロンプトからパッケージへの移行状況を一覧で確認する。",
    settings: [],
    synonyms: ["移行", "マイグレーション", "移行状況", "カスタムプロンプト", "migration"],
    related: ["prompt-packages-index", "research-form"]
  },
  {
    key: "experience-settings",
    path: "/admin/experience-settings",
    label: "体験設定",
    group: "設定",
    nav: true,
    description: "回答体験まわりの全体設定（若年層向けオプションなど）を変更する。",
    settings: ["体験オプションの有効／無効", "既定値"],
    synonyms: ["体験", "回答体験", "若年層", "オプション設定", "experience"],
    related: ["research-form", "prompt-packages-index"]
  },
  {
    key: "quality-scoring-index",
    path: "/admin/quality-scoring",
    label: "品質係数",
    group: "設定",
    nav: true,
    description: "回答品質からポイント倍率（品質係数）を算出する基準を設定する。",
    settings: ["係数のレンジ", "絶対キャップ", "信頼スコアの重み", "判定基準"],
    synonyms: ["品質", "係数", "ポイント倍率", "信頼スコア", "quality"],
    related: ["quality-scoring-recent", "points-index", "ranks-index"]
  },
  {
    key: "quality-scoring-recent",
    path: "/admin/quality-scoring/recent",
    label: "品質係数の直近判定",
    group: "設定",
    nav: true,
    description: "直近に算出された品質係数の判定結果を一覧し、基準が効きすぎ／緩すぎでないかを確認する。",
    settings: ["表示件数・期間の絞り込み"],
    synonyms: ["品質の直近", "係数の実績", "判定結果", "recent"],
    related: ["quality-scoring-index", "points-index"]
  },
  {
    key: "screen-index",
    path: "/admin/screen-index",
    label: "設定の索引",
    group: "設定",
    nav: true,
    // この画面自身もカタログのエントリ。載せないと突合テストが「幽霊ルート」で落ちる。
    description: "「この設定はどの画面でするのか」をグループ→画面→設定項目の順に一覧できる逆引き索引。各行から画面へ直接飛べる。",
    settings: ["設定項目から画面を逆引きする"],
    synonyms: ["索引", "インデックス", "逆引き", "設定一覧", "画面一覧", "どこで設定", "目次", "screen index"],
    related: ["documents-index", "experience-settings", "quality-scoring-index"]
  }
];

// ---------------------------------------------------------------------------
// 参照ヘルパ
// ---------------------------------------------------------------------------

/** key -> エントリ。key 重複はテストで落とすのでここでは後勝ちにしない。 */
const SCREENS_BY_KEY = new Map<string, AdminScreenEntry>();
for (const screen of ADMIN_SCREENS) {
  if (!SCREENS_BY_KEY.has(screen.key)) SCREENS_BY_KEY.set(screen.key, screen);
}

export function getScreenByKey(key: string): AdminScreenEntry | null {
  return SCREENS_BY_KEY.get(key) ?? null;
}

/** `/admin/projects/:projectId/edit` を1セグメントずつに割る（先頭・末尾の空要素は落とす）。 */
function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * 実際のリクエストパスから画面エントリを引く。`:param` は任意の1セグメントに一致する。
 *
 * 静的セグメントが多いエントリを優先する（`/admin/segments/campaigns` を
 * `/admin/segments/:segmentId` より先に当てるため。ルート定義側の「静的を先に」と同じ発想）。
 * クエリ文字列と末尾スラッシュは無視する。
 */
export function resolveScreenByPath(path: string): AdminScreenEntry | null {
  if (typeof path !== "string" || path.length === 0) return null;
  const withoutQuery = path.split("?")[0] ?? "";
  const target = splitPath(withoutQuery);

  let best: AdminScreenEntry | null = null;
  let bestStaticCount = -1;

  for (const screen of ADMIN_SCREENS) {
    const pattern = splitPath(screen.path);
    if (pattern.length !== target.length) continue;

    let staticCount = 0;
    let matched = true;
    for (let i = 0; i < pattern.length; i += 1) {
      const patternSegment = pattern[i] as string;
      if (patternSegment.startsWith(":")) continue; // 任意の1セグメントに一致
      if (patternSegment !== target[i]) {
        matched = false;
        break;
      }
      staticCount += 1;
    }
    if (!matched) continue;

    if (staticCount > bestStaticCount) {
      best = screen;
      bestStaticCount = staticCount;
    }
  }
  return best;
}

export interface AdminNavItem {
  href: string;
  label: string;
  primary?: boolean;
  badgeId?: string;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
  /** 外部リンク群（アンケでYOTTO）と同じ形にしておき、header 側で同じループに流せるようにする */
  external?: boolean;
}

/**
 * ヘッダー最上段に外出しする「よく使う」項目。`pinned:true` の宣言順。
 * グループ側からは消さない（同じ画面が2箇所に出る）。ピン留めは近道であって
 * 所属の付け替えではなく、「配信オペレーションは配信の画面」という所在は保つ。
 */
export function buildPinnedNavItems(): AdminNavItem[] {
  const items: AdminNavItem[] = [];
  for (const screen of ADMIN_SCREENS) {
    if (!screen.nav || !screen.pinned) continue;
    const item: AdminNavItem = { href: screen.path, label: screen.label };
    if (screen.primary) item.primary = true;
    // バッジ DOM id はページ内で一意でなければならない。ピン留め側に本物を出し、
    // グループ側は id 無し（バッジ非表示）にする。id 重複は getElementById が
    // 先勝ちになり、どちらか一方が黙って更新されない事故になる。
    if (screen.badgeId) item.badgeId = screen.badgeId;
    items.push(item);
  }
  return items;
}

/**
 * ヘッダーナビ用のグループ配列を組み立てる。
 * `nav:true` のエントリだけを ADMIN_NAV_GROUP_ORDER の順で並べる（グループ内は宣言順）。
 * 外部リンク群（portalOpsNavLinks）はカタログ対象外なので、header 側でこの後ろに push する。
 */
export function buildNavGroups(): AdminNavGroup[] {
  const groups = new Map<string, AdminNavItem[]>();
  for (const screen of ADMIN_SCREENS) {
    if (!screen.nav) continue;
    const items = groups.get(screen.group) ?? [];
    const item: AdminNavItem = { href: screen.path, label: screen.label };
    if (screen.primary) item.primary = true;
    // ピン留め済みの画面はバッジをピン留め側だけに出す（DOM id の重複を作らない）
    if (screen.badgeId && !screen.pinned) item.badgeId = screen.badgeId;
    items.push(item);
    groups.set(screen.group, items);
  }

  const ordered: AdminNavGroup[] = [];
  for (const label of ADMIN_NAV_GROUP_ORDER) {
    const items = groups.get(label);
    if (items && items.length > 0) ordered.push({ label, items });
    groups.delete(label);
  }
  // ORDER に無いグループを足しても消えないよう、残りを宣言順のまま末尾に回す
  for (const [label, items] of groups) {
    if (items.length > 0) ordered.push({ label, items });
  }
  return ordered;
}
