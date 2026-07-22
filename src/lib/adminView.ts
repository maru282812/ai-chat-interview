/**
 * 管理画面ビュー共通ヘルパ。
 *
 * これまで各ビューが個別に `toLocaleString('ja-JP')` / `toLocaleDateString('ja-JP')` /
 * `String.slice(0,10)` を使い分けており、表記ゆれに加えて slice 系は UTC 値がそのまま
 * 出て日付境界で1日ずれていた。ステータスの日本語ラベルも researchForm / store-surveys /
 * clients / delivery-templates に別々の定義が散っていて、一覧側では英字コードが
 * そのまま露出していた。ここに集約して `res.locals` 経由で全ビューへ配る。
 */

const JST_OFFSET_MINUTES = 9 * 60;

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** UTC 基準の Date を JST の壁時計時刻に平行移動した Date を返す（表示用途のみ） */
function shiftToJst(date: Date): Date {
  return new Date(date.getTime() + JST_OFFSET_MINUTES * 60 * 1000);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `2026/07/22 18:30 (JST)` — 管理画面の日時表記の既定形式 */
export function formatDateTimeJst(value: unknown, fallback = "-"): string {
  const date = toDate(value);
  if (!date) return fallback;
  const j = shiftToJst(date);
  return `${j.getUTCFullYear()}/${pad(j.getUTCMonth() + 1)}/${pad(j.getUTCDate())} ${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())} (JST)`;
}

/** `2026/07/22` — 日付だけで足りる箇所用 */
export function formatDateJst(value: unknown, fallback = "-"): string {
  const date = toDate(value);
  if (!date) return fallback;
  const j = shiftToJst(date);
  return `${j.getUTCFullYear()}/${pad(j.getUTCMonth() + 1)}/${pad(j.getUTCDate())}`;
}

/**
 * `datetime-local` の value 用。`toISOString().slice(0,16)` を直接使うと UTC 値が
 * ローカル時刻欄に入り、開いて保存し直すたびに9時間ずれる（segments/campaign-form,
 * reward-campaigns/form で発生していた）。
 */
export function toDateTimeLocalJst(value: unknown): string {
  const date = toDate(value);
  if (!date) return "";
  const j = shiftToJst(date);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}T${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}`;
}

/**
 * `datetime-local` から受け取った JST の壁時計文字列を UTC の ISO 文字列へ戻す。
 * 入力側もここを通さないと保存のたびにずれ続ける。
 */
export function fromDateTimeLocalJst(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const parsed = new Date(`${raw}:00+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** `3時間前` — 絶対時刻の補助表示に使う */
export function formatRelativeJst(value: unknown, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return "-";
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 0) return "まもなく";
  if (diffSec < 60) return "たった今";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}日前`;
  return formatDateJst(date);
}

/**
 * コード値 → 日本語ラベル。
 * 既存の各ビューにあった定義を統合したもの。値の追加は「末尾に足す」だけでよく、
 * 未知の値は英字コードのまま表示されるので取りこぼしても壊れない。
 */
export const STATUS_LABELS: Record<string, Record<string, string>> = {
  projectStatus: {
    draft: "下書き",
    ready: "準備完了",
    published: "LIFF掲載中",
    active: "実施中",
    paused: "一時停止",
    completed: "終了",
    archived: "アーカイブ"
  },
  respondentStatus: {
    active: "参加中",
    invited: "招待済み",
    blocked: "ブロック",
    withdrawn: "退会",
    completed: "完了"
  },
  sessionStatus: {
    pending: "開始前",
    active: "回答中",
    not_started: "未着手",
    in_progress: "回答中",
    completed: "完了",
    abandoned: "中断",
    expired: "期限切れ"
  },
  sessionPhase: {
    question: "設問回答",
    ai_probe: "AI深掘り",
    free_comment: "自由コメント",
    completed: "完了"
  },
  assignmentStatus: {
    ready: "配信可能",
    scheduled: "配信予約",
    delivered: "配信済み",
    in_progress: "回答中",
    completed: "完了",
    undelivered: "未配信",
    paused: "停止中",
    expired: "期限切れ"
  },
  applicationStatus: {
    applied: "選考中",
    accepted: "当選",
    rejected: "落選",
    cancelled: "取り下げ"
  },
  exchangeStatus: {
    pending: "申請中",
    approved: "承認済み",
    rejected: "却下",
    fulfilled: "送付済み",
    cancelled: "取り消し"
  },
  researchMode: {
    interview_chat: "チャット型",
    survey_question: "設問型",
    hybrid: "ハイブリッド"
  },
  questionType: {
    free_text_short: "自由記述（短文）",
    free_text_long: "自由記述（長文）",
    choice_single: "単一選択",
    choice_multi: "複数選択",
    numeric: "数値",
    scale: "尺度",
    date: "日付"
  },
  questionRole: {
    screening: "スクリーニング",
    main: "本調査",
    profile: "プロフィール",
    followup: "深掘り"
  },
  deliveryType: {
    new_project: "新着案件",
    reminder: "リマインダー",
    daily_survey: "デイリーアンケート",
    campaign: "キャンペーン"
  },
  senderType: {
    user: "回答者",
    bot: "AI",
    system: "システム",
    admin: "管理者"
  },
  attributeCategory: {
    basic: "基本情報",
    lifestyle: "ライフスタイル",
    ai_inferred: "AI推定"
  },
  attributeValueType: {
    text: "テキスト",
    number: "数値",
    tags: "タグ",
    json: "JSON",
    boolean: "はい/いいえ"
  },
  consentSource: {
    registration: "登録時",
    project_entry: "案件参加時",
    global_required: "必須同意",
    reconsent: "再同意"
  },
  postType: {
    free_comment: "自由コメント",
    rant: "愚痴",
    diary: "日記"
  },
  sentiment: {
    positive: "ポジティブ",
    negative: "ネガティブ",
    neutral: "ニュートラル",
    mixed: "混在"
  }
};

/** 未知の値はコードのまま返す（ラベル辞書の取りこぼしで画面が空にならないように） */
export function statusLabel(kind: string, value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!raw) return "-";
  return STATUS_LABELS[kind]?.[raw] ?? raw;
}

/** UUID をそのまま並べても管理業務上の意味がないので先頭8桁に丸める */
export function shortId(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return raw ? `${raw.slice(0, 8)}…` : "-";
}

/** ビューへ配るヘルパ一式 */
export const adminViewHelpers = {
  fmtDateTime: formatDateTimeJst,
  fmtDate: formatDateJst,
  fmtRelative: formatRelativeJst,
  dtLocal: toDateTimeLocalJst,
  statusLabel,
  shortId
};
