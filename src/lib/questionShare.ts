import type { Question, QuestionType } from "../types/domain";

/**
 * questionShare.ts
 *
 * 「店舗等への伝達を目的として設けた設問」の回答を、当該店舗へ開示してよいかを判定する純関数群。
 *
 * 根拠となる条文（migration 102 で追加した 回答者向け利用規約 第9条3項）:
 *   「店舗等への伝達を目的として設けた設問について、当該設問である旨及び当該回答が
 *     当該店舗等に開示される旨を回答画面上であらかじめ明示したうえで、ユーザーが
 *     当該設問に回答した場合、当該回答の内容を、統計化又は匿名加工することなく、
 *     当該回答に係る店舗等に対してのみ開示することができます。」
 *
 * 条文の3つの限定が、そのままこのモジュールの制約になっている:
 *   1. 「回答画面上であらかじめ明示したうえで」→ notice 必須。未設定なら共有不可（fail-closed）。
 *   2. 「当該回答に係る店舗等に対してのみ」    → 所有者スコープ検証（呼び出し側の責務）。
 *   3. 「直接特定する情報を併せて開示しません」→ respondents へ JOIN しない（呼び出し側の責務）。
 *
 * 設定の置き場所は question_config.meta（QuestionMeta）。
 * docs/spec-client-aggregation-foundation.md の方針どおり DDL 不要（JSONB 拡張）。
 *
 * ⚠ 既定は「共有しない」。設問は今後も増えるため、既定を共有側に倒すと
 *   新しく足した設問が意図せず店舗に流れる。必ずオプトインにすること。
 */

/** 共有の粒度。 */
export type ShareMode =
  /** 原文をそのまま見せる（自由記述の申し送りなど）。 */
  | "verbatim"
  /** 選択肢ごとの件数だけ見せる。原文は出さない。 */
  | "aggregate";

/** 共有を開始するタイミング。 */
export type ShareTiming =
  /** 回答が入り次第すぐ。 */
  | "immediate"
  /** 案件の締切後。 */
  | "on_close";

/** question_config.meta.share_with_store の形。 */
export interface ShareWithStoreConfig {
  enabled?: boolean;
  mode?: ShareMode;
  timing?: ShareTiming;
  /** 回答画面に表示した告知文。規約 第9条3項の「あらかじめ明示」の実体。 */
  notice?: string;
}

/** 判定結果。共有可のときだけ resolved を返す。 */
export type ShareDecision =
  | { shared: false; reason: ShareDeniedReason }
  | { shared: true; mode: ShareMode; timing: ShareTiming; notice: string };

export type ShareDeniedReason =
  /** そもそもフラグが立っていない（既定）。 */
  | "not_enabled"
  /** 告知文が無い＝回答者に明示していないので開示根拠が無い。 */
  | "missing_notice"
  /** 原文開示が許されない設問型（画像など）。 */
  | "type_not_allowed";

/**
 * 原文（verbatim）での開示を禁じる設問型。
 *
 * image_upload は回答者がアップロードした画像そのものが出るため、
 * 何が写っているかを事前に制御できない。原文開示の対象から外す。
 */
const VERBATIM_FORBIDDEN_TYPES: readonly QuestionType[] = ["image_upload"];

/** 自由記述系（原文開示の際に人手レビューを推奨する型）。 */
const FREE_TEXT_TYPES: readonly QuestionType[] = [
  "text",
  "free_text_short",
  "free_text_long",
  "text_with_image"
];

/** 設問が自由記述系か。 */
export function isFreeTextQuestion(type: QuestionType): boolean {
  return FREE_TEXT_TYPES.includes(type);
}

/**
 * question_config.meta.share_with_store を取り出す。
 *
 * DB から来る JSONB なので、型どおりとは限らない（手で入れた値・古い形）。
 * オブジェクト以外は「設定なし」として扱う。
 */
export function readShareConfig(question: Question): ShareWithStoreConfig | null {
  const raw: unknown = question.question_config?.meta?.share_with_store;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ShareWithStoreConfig;
}

/**
 * この設問の回答を店舗へ開示してよいかを判定する。
 *
 * ## 規約は「項」で要件が違う。ここを混ぜないこと
 *
 * - **第9条4項**: 統計化・匿名加工した情報の第三者提供 → **事前明示は不要**
 * - **第9条5項**: 統計化も匿名加工もしない**原文開示** → 「回答画面上であらかじめ
 *   明示」が**必要**（＝ notice 必須）
 *
 * 選択式の件数集計（aggregate）は 4項の範囲なので、設定が無くても締切後に出せる。
 * 以前は両方を同じ `enabled` + `notice` ゲートで塞いでおり、**4項で出せるはずの
 * 集計まで出せていなかった**（店舗が締め切っても集計が1つも開かない状態）。
 *
 * ## 既定（設定が無いとき）
 *
 * - 選択式 → **aggregate / on_close で開示する**（4項）
 * - 自由記述 → **開示しない**。原文が出るということなので 5項の領域に入る。
 *   出すには運営が明示的に設定し、notice を書く必要がある
 *
 * `enabled: false` が明示されていれば、いずれにせよ開示しない（運営の意思を優先）。
 */
export function resolveShareDecision(question: Question): ShareDecision {
  const config = readShareConfig(question);

  // 運営が明示的に切っているなら、何があっても出さない
  if (config?.enabled === false) {
    return { shared: false, reason: "not_enabled" };
  }

  if (!config || config.enabled !== true) {
    return resolveDefaultShareDecision(question);
  }

  const mode: ShareMode = config.mode === "verbatim" ? "verbatim" : "aggregate";
  const timing: ShareTiming = config.timing === "immediate" ? "immediate" : "on_close";
  const notice = typeof config.notice === "string" ? config.notice.trim() : "";

  // **原文開示（5項）は notice が無ければ出さない。** フラグが立っていても同じ。
  if (mode === "verbatim" && notice.length === 0) {
    return { shared: false, reason: "missing_notice" };
  }

  if (mode === "verbatim" && VERBATIM_FORBIDDEN_TYPES.includes(question.question_type)) {
    return { shared: false, reason: "type_not_allowed" };
  }

  return { shared: true, mode, timing, notice };
}

/**
 * 設定が無い設問の既定。**選択式の件数集計だけを許す**（規約 第9条4項）。
 *
 * ⚠ 自由記述をここに含めないこと。自由記述の集計は実質的に原文の列挙になり、
 *   「統計化又は匿名加工したうえで」に当たらない（5項の領域）。
 *   `isFreeTextQuestion` に載っていない新しい設問型を足すときは、
 *   **原文がそのまま出うるか**を必ず確認する。
 */
function resolveDefaultShareDecision(question: Question): ShareDecision {
  if (isFreeTextQuestion(question.question_type)) {
    return { shared: false, reason: "not_enabled" };
  }
  // image_upload など、件数集計になじまない型も既定では出さない
  if (VERBATIM_FORBIDDEN_TYPES.includes(question.question_type)) {
    return { shared: false, reason: "type_not_allowed" };
  }
  return {
    shared: true,
    mode: "aggregate",
    // 締め切ってから開く。回収中に見せると「まだ集まっていない」数字で
    // 判断させることになる（納品前ロックの考え方と揃える）。
    timing: "on_close",
    // 4項の範囲なので事前明示は要らない。告知は出さない
    notice: "",
  };
}

/**
 * 今このタイミングで出してよいか。
 *
 * timing=on_close の設問は、案件が closed になるまで出さない。
 */
export function isShareVisibleNow(decision: ShareDecision, projectStatus: string): boolean {
  if (!decision.shared) {
    return false;
  }
  if (decision.timing === "immediate") {
    return true;
  }
  return projectStatus === "closed";
}

/**
 * 開示対象の設問だけを選び出す。
 *
 * 呼び出し側はこの結果に含まれない設問の回答を、決して外部へ出してはならない
 * （ホワイトリスト方式）。
 */
export function selectShareableQuestions(
  questions: Question[],
  projectStatus: string
): Array<{ question: Question; mode: ShareMode; notice: string }> {
  const selected: Array<{ question: Question; mode: ShareMode; notice: string }> = [];
  for (const question of questions) {
    const decision = resolveShareDecision(question);
    if (!decision.shared || !isShareVisibleNow(decision, projectStatus)) {
      continue;
    }
    selected.push({ question, mode: decision.mode, notice: decision.notice });
  }
  return selected;
}

/**
 * 回答画面に出す開示の告知（規約 第9条5項の「あらかじめ明示」の実体）。
 *
 * `label` は**固定文言**、`notice` は設問ごとの補足。この2段構えにしているのは、
 * 条文が要求する「当該設問である旨」「当該店舗等に開示される旨」を**固定側で必ず担保**
 * するため。運営が notice を書き損ねても、法的に要る部分は落ちない。
 */
export interface ShareDisclosureNotice {
  /** 設問カードに出すバッジ文言（固定）。 */
  label: string;
  /** 設問ごとの補足（何のために・いつ見るか）。空なら出さない。 */
  notice: string;
  /** 原文がそのまま出るか。文言の強さを変えるのに使う。 */
  verbatim: boolean;
}

/**
 * 原文（verbatim）開示のバッジ。「そのまま伝わる」ことを省略しない。
 * 件数集計と違い、書いた内容がそのまま読まれるため。
 */
const VERBATIM_LABEL = "ご記入の内容が、そのままお店に伝わります（お名前は伝わりません）";

/** 件数集計（aggregate）開示のバッジ。 */
const AGGREGATE_LABEL = "この回答はお店に伝わります（お名前は伝わりません）";

/**
 * この設問の回答画面に出す告知を決める。**開示しない設問には何も出さない**。
 *
 * ⚠ `resolveShareDecision` と**同じ判定**を通すこと。ここで独自に条件を書くと、
 *   「告知は出ていないのに開示される」「開示しないのに告知が出る」のどちらかが起きる。
 *   前者は規約 第9条5項違反、後者は回答者を不必要に身構えさせる。
 *
 * タイミング（immediate / on_close）では出し分けない。回答者にとっては
 * 「いつ店舗が見るか」ではなく「店舗に伝わるかどうか」が判断材料だから。
 */
export function resolveDisclosureNotice(question: Question): ShareDisclosureNotice | null {
  const decision = resolveShareDecision(question);
  if (!decision.shared) return null;

  // **既定の件数集計（規約 第9条4項）には告知を出さない。**
  //
  // 4項は統計化した情報の提供なので事前明示を要さない。ここで全ての選択式設問に
  // 「お店に伝わります」を出すと、告知が画面中に並んで**本当に見てほしい原文開示
  // （5項）の告知が埋もれる**。伝えるべきものを目立たせるために、出す対象を絞る。
  //
  // 判定の根拠は「運営が明示的に設定したか」。設定がある＝その設問を店舗に
  // 伝える意図で置いているので、集計であっても回答者に伝える。
  const config = readShareConfig(question);
  if (!config || config.enabled !== true) return null;

  const verbatim = decision.mode === "verbatim";
  return {
    label: verbatim ? VERBATIM_LABEL : AGGREGATE_LABEL,
    notice: decision.notice,
    verbatim,
  };
}

/**
 * 回答者が「開示に同意した後で」回答したかを判定する。
 *
 * ⚠ 個人情報保護法上、利用目的の追加は遡及しない（migration 102 のコメント参照）。
 *   規約 v2.0 に同意する前に取得した回答は、第9条3項を根拠に開示できない。
 *
 * @param consentedAt  当該回答者が対象バージョンに同意した日時（未同意なら null）
 * @param answeredAt   回答日時
 */
export function isCoveredByConsent(
  consentedAt: string | null | undefined,
  answeredAt: string
): boolean {
  if (!consentedAt) {
    return false;
  }
  const consented = Date.parse(consentedAt);
  const answered = Date.parse(answeredAt);
  if (Number.isNaN(consented) || Number.isNaN(answered)) {
    return false;
  }
  return consented <= answered;
}
