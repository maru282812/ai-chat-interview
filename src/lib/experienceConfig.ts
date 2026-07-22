/**
 * experienceConfig.ts
 *
 * 若年層体験パック（docs/spec-young-experience-pack.md）の体験フラグをサーバー権威で解決する純関数。
 *
 * 決定順:
 *   1. projects.experience_config[key]        プロジェクト上書き（scope='project' のキーのみ）
 *   2. app_settings('experience_defaults')[key] 全体既定
 *   3. コード内デフォルト（本ファイルの EXPERIENCE_KEYS.default）
 *
 * 責務外:
 *   - DB アクセス（appSettingsRepository / experienceService が担う）
 *   - 描画（LIFF へは解決済み値だけを window.EXPERIENCE として渡す）
 *   - 個々の機能の挙動（Phase A 以降）
 *
 * 方針:
 *   - 未知キーは無視する（将来キーを削っても古い保存値で壊れない）。
 *   - 型が合わない値は「その層に無かった」ものとして捨て、次の層へ落ちる。
 *   - scope='global' のキーはプロジェクト上書き不可（招待・オンボーディング等、案件に紐付かないもの）。
 */

/** 上書きスコープ。project = 全体既定＋プロジェクト上書き可 / global = 全体既定のみ。 */
export type ExperienceScope = "global" | "project";

export type ExperienceValue = boolean | string | number;

export type AnswerUiPresetValue = "casual" | "standard" | "formal";

/** 管理画面のセクション分け（A 本音の書きやすさ / B 書く体験 / C 楽しさ / D 成長ループ）。 */
export type ExperienceSection = "A" | "B" | "C" | "D";

interface ExperienceKeyDefBase {
  scope: ExperienceScope;
  section: ExperienceSection;
  /** 管理画面の行ラベル。 */
  label: string;
  /** 管理画面の 1 行説明（仕様書の機能名をそのまま使う）。 */
  description: string;
}

export type ExperienceKeyDef =
  | (ExperienceKeyDefBase & { type: "bool"; default: boolean })
  | (ExperienceKeyDefBase & { type: "string"; default: string })
  | (ExperienceKeyDefBase & { type: "int"; default: number })
  | (ExperienceKeyDefBase & { type: "enum"; default: string; values: readonly string[] });

/** A-2 匿名性の明示の既定文言（プロジェクト上書き可）。 */
export const DEFAULT_ANONYMITY_NOTE_TEXT =
  "🔒 回答は匿名で集計されます。あなたの名前が企業に伝わることはありません";

/**
 * 体験フラグの全定義。キー名は snake_case で固定（仕様書のフラグ一覧と 1:1）。
 * 追加するときは必ずここに書く。ここに無いキーは保存も解決もされない。
 */
export const EXPERIENCE_KEYS = {
  // ── A: 本音の書きやすさ ────────────────────────────────
  probe_skip_button: {
    type: "bool",
    default: true,
    scope: "project",
    section: "A",
    label: "深掘りパスボタン",
    description: "A-1 深掘り中に「うまく言えない・パス」で次へ進めるようにする。",
  },
  anonymity_note: {
    type: "bool",
    default: true,
    scope: "project",
    section: "A",
    label: "匿名性の明示",
    description: "A-2 自由記述・深掘りの直上に匿名である旨の 1 行を表示する。",
  },
  anonymity_note_text: {
    type: "string",
    default: DEFAULT_ANONYMITY_NOTE_TEXT,
    scope: "project",
    section: "A",
    label: "匿名性の文言",
    description: "A-2 実名を取る案件ではプロジェクト側で文言変更・非表示にできる。",
  },
  completion_reward_display: {
    type: "bool",
    default: true,
    scope: "project",
    section: "A",
    label: "完了画面のポイント表示",
    description: "A-3 アンケート完了時に獲得ポイントと残高を表示する。",
  },
  rank_celebration_on_complete: {
    type: "bool",
    default: true,
    scope: "project",
    section: "A",
    label: "完了時の昇格演出",
    description: "A-4 案件完了でランク階級/段位が上がったとき昇格演出を再生する。",
  },

  // ── B: 書く体験 ──────────────────────────────────────
  probe_chat_persona: {
    type: "bool",
    default: false,
    scope: "project",
    section: "B",
    label: "インタビュアーキャラクター",
    description: "B-1 AI バブルにアバターと名前を付け、冒頭に自己紹介を出す（見た目のみ）。",
  },
  persona_name: {
    type: "string",
    default: "ヒビ",
    scope: "global",
    section: "B",
    label: "キャラクター名",
    description: "B-1 インタビュアーの表示名。",
  },
  persona_icon: {
    type: "string",
    default: "🌱",
    scope: "global",
    section: "B",
    label: "キャラクターアイコン",
    description: "B-1 アバターに使う絵文字または画像URL。",
  },
  writing_helper_chips: {
    type: "bool",
    default: false,
    scope: "project",
    section: "B",
    label: "書き出し支援チップ",
    description: "B-2 自由記述の上にタップで文頭が入るチップ列を出す。",
  },
  chat_progress: {
    type: "bool",
    default: true,
    scope: "project",
    section: "B",
    label: "チャット進捗表示",
    description: "B-3 会話モードのヘッダに進捗バーと「あと◯問くらい」を出す。",
  },
  time_remaining: {
    type: "bool",
    default: true,
    scope: "project",
    section: "B",
    label: "残り所要時間",
    description: "B-4 進捗バー直下に「あと約◯分」を出す（所要時間が設定された案件のみ）。",
  },

  // ── C: 楽しさ ────────────────────────────────────────
  answer_distribution: {
    type: "bool",
    default: false,
    scope: "global",
    section: "C",
    label: "みんなの回答分布",
    description: "C-1 プール/デイリーの選択式で、回答後に分布を表示する（設問単位フラグとの AND）。",
  },
  voice_input: {
    type: "bool",
    default: false,
    scope: "project",
    section: "C",
    label: "音声入力",
    description: "C-2 自由記述にマイクボタンを出す（ブラウザ内 STT 対応環境のみ）。",
  },
  default_answer_ui_preset: {
    type: "enum",
    default: "standard",
    values: ["casual", "standard", "formal"] as const,
    scope: "global",
    section: "C",
    label: "回答UIプリセットの全体既定",
    description: "C-3 新規プロジェクト作成・「全体既定に従う」選択時に実体化される既定プリセット。",
  },
  haptics: {
    type: "bool",
    default: true,
    scope: "global",
    section: "C",
    label: "ハプティクス",
    description: "C-4 スワイプ確定・昇格演出で端末を短く振動させる（非対応端末では無効）。",
  },
  quality_micro_feedback: {
    type: "bool",
    default: false,
    scope: "project",
    section: "C",
    label: "品質マイクロコピー",
    description: "C-5 自由記述の入力量に応じて「いい感じです」等のポジティブな一言を出す。",
  },
  survey_resume: {
    type: "bool",
    default: true,
    scope: "global",
    section: "C",
    label: "中断・再開",
    description: "C-6 1問1画面モードで、回答済みの設問を飛ばして続きから再開する。",
  },

  // ── D: 成長ループ ────────────────────────────────────
  referral_enabled: {
    type: "bool",
    default: false,
    scope: "global",
    section: "D",
    label: "友達招待",
    description: "D-1 紹介コードによる招待機能（規約整合の確認が済むまで OFF のまま）。",
  },
  referral_bonus_points: {
    type: "int",
    default: 100,
    scope: "global",
    section: "D",
    label: "招待ボーナス（招待した側）",
    description: "D-1 招待された人が有効回答 3 件を達成したときに招待者へ付与する pt。",
  },
  referral_bonus_points_invitee: {
    type: "int",
    default: 50,
    scope: "global",
    section: "D",
    label: "招待ボーナス（招待された側）",
    description: "D-1 有効回答 3 件を達成したときに招待された側へ付与する pt。",
  },
  share_card_enabled: {
    type: "bool",
    default: false,
    scope: "global",
    section: "D",
    label: "シェア画像",
    description: "D-2 性格タイプ・実績カードの画像を生成して LINE でシェアできるようにする。",
  },
  streak_freeze_enabled: {
    type: "bool",
    default: false,
    scope: "global",
    section: "D",
    label: "ストリークフリーズ",
    description: "D-3 1 日飛ばしても保有フリーズを消費して連続日数を維持する。",
  },
  streak_reminder_enabled: {
    type: "bool",
    default: false,
    scope: "global",
    section: "D",
    label: "夜リマインダー",
    description: "D-3 夜枠配信に相乗りして、未回答かつ連続 3 日以上のユーザーへ一言 push する。",
  },
  badge_toast: {
    type: "bool",
    default: true,
    scope: "global",
    section: "D",
    label: "バッジ獲得トースト",
    description: "D-4 バッジを獲得した瞬間に画面下からトーストを出す。",
  },
  onboarding_swipe: {
    type: "bool",
    default: false,
    scope: "global",
    section: "D",
    label: "初回スワイプ体験",
    description: "D-5 登録直後のユーザーに 3 問のスワイプ体験オーバーレイを出す。",
  },
} as const satisfies Record<string, ExperienceKeyDef>;

export type ExperienceKey = keyof typeof EXPERIENCE_KEYS;

type DefOf<K extends ExperienceKey> = (typeof EXPERIENCE_KEYS)[K];

type ValueOfDef<D> = D extends { type: "bool" }
  ? boolean
  : D extends { type: "int" }
    ? number
    : D extends { type: "enum"; values: readonly (infer V)[] }
      ? V
      : string;

/** 解決済みの体験設定。LIFF へはこれをそのまま window.EXPERIENCE として渡す。 */
export type ResolvedExperience = {
  [K in ExperienceKey]: ValueOfDef<DefOf<K>>;
};

/** キー名の配列（管理画面のフォーム生成・ホワイトリスト検証に使う）。 */
export const EXPERIENCE_KEY_LIST = Object.keys(EXPERIENCE_KEYS) as ExperienceKey[];

/** プロジェクト上書きが許されるキー（researchForm のホワイトリスト）。 */
export const PROJECT_SCOPED_KEYS = EXPERIENCE_KEY_LIST.filter(
  (k) => EXPERIENCE_KEYS[k].scope === "project",
);

export function isExperienceKey(key: string): key is ExperienceKey {
  return Object.prototype.hasOwnProperty.call(EXPERIENCE_KEYS, key);
}

/**
 * 1 つの生値を定義に照らして受理／却下する。
 * 受理できないときは null を返し、呼び出し側で「その層には無かった」として次の層へ落とす。
 *
 * - bool: boolean のみ（"true" 等の文字列はフォーム層で変換する責務）
 * - string: 非空の文字列のみ（空文字＝未設定＝継承として扱う）
 * - int: 整数の number のみ
 * - enum: 定義済みの値のみ
 */
export function coerceExperienceValue(key: ExperienceKey, raw: unknown): ExperienceValue | null {
  const def = EXPERIENCE_KEYS[key] as ExperienceKeyDef;
  switch (def.type) {
    case "bool":
      return typeof raw === "boolean" ? raw : null;
    case "string": {
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    case "int":
      return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
    case "enum":
      return typeof raw === "string" && def.values.includes(raw) ? raw : null;
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 体験設定を解決する。
 *
 * @param projectConfig   projects.experience_config（null/未設定可）。scope='global' のキーは無視する。
 * @param globalDefaults  app_settings('experience_defaults').value（null/未設定可）。
 */
export function resolveExperience(
  projectConfig: unknown,
  globalDefaults: unknown,
): ResolvedExperience {
  const proj = asRecord(projectConfig);
  const glob = asRecord(globalDefaults);

  const out: Record<string, ExperienceValue> = {};
  for (const key of EXPERIENCE_KEY_LIST) {
    const def = EXPERIENCE_KEYS[key] as ExperienceKeyDef;
    let value: ExperienceValue = def.default;

    if (Object.prototype.hasOwnProperty.call(glob, key)) {
      const g = coerceExperienceValue(key, glob[key]);
      if (g !== null) value = g;
    }

    // scope='global' のキーはプロジェクト上書き不可（保存されていても無視する）。
    if (def.scope === "project" && Object.prototype.hasOwnProperty.call(proj, key)) {
      const p = coerceExperienceValue(key, proj[key]);
      if (p !== null) value = p;
    }

    out[key] = value;
  }
  return out as ResolvedExperience;
}

/**
 * 保存前のサニタイズ。未知キー・型不一致を落とし、保存してよい形だけを残す。
 *
 * @param raw    フォーム等から組み立てた候補（値は既に型変換済みであること）
 * @param scope  'project' を渡すとプロジェクト上書き不可キーも落とす
 */
export function sanitizeExperienceConfig(
  raw: unknown,
  scope: ExperienceScope = "global",
): Record<string, ExperienceValue> {
  const src = asRecord(raw);
  const out: Record<string, ExperienceValue> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!isExperienceKey(key)) continue;
    if (scope === "project" && EXPERIENCE_KEYS[key].scope !== "project") continue;
    const coerced = coerceExperienceValue(key, value);
    if (coerced === null) continue;
    out[key] = coerced;
  }
  return out;
}

/** 解決済みプリセット値を answer_ui_preset の型として取り出す（C-3 の実体化に使う）。 */
export function resolveDefaultAnswerUiPreset(globalDefaults: unknown): AnswerUiPresetValue {
  return resolveExperience({}, globalDefaults).default_answer_ui_preset as AnswerUiPresetValue;
}
