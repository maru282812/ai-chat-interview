/**
 * セキュリティ通知の判定（決定的コア。DB も fetch も触らない）。
 *
 * securityEventService が 1 件記録するたびに呼び、「いま知らせるべきか」を返す。
 * 数え上げ（直近の失敗回数など）は呼び出し側が DB から引いて渡す。
 *
 * 知らせるもの:
 *   - login_failures   直近 15 分のログイン失敗（全 IP 合計）が 5 回以上
 *   - login_locked     ロックがかかった（同じ IP が 5 回外した）
 *   - unusual_login    ログイン成功が深夜（日本時間 0〜5 時）または日本以外から
 *   - error_spike      直近 10 分のサーバーエラーが 10 件以上
 *
 * 同じ規則の通知は 60 分に 1 回まで（unusual_login は毎回。1 回でも本人か確かめたい）。
 */

export type SecurityEventKind =
  | "login_failed"
  | "login_succeeded"
  | "login_locked"
  | "api_key_rejected"
  | "admin_action"
  | "server_error"
  | "alert_sent";

export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const FAILURE_THRESHOLD = 5;
export const ERROR_WINDOW_MS = 10 * 60 * 1000;
export const ERROR_THRESHOLD = 10;
export const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
export const RETENTION_DAYS = 90;

export type AlertRule = "login_failures" | "login_locked" | "unusual_login" | "error_spike";

export interface AlertInput {
  kind: SecurityEventKind;
  occurredAt: Date;
  /** Cloudflare の cf-ipcountry（2 文字）。分からなければ null。 */
  country: string | null;
  /** 直近 FAILURE_WINDOW_MS のログイン失敗＋API キー拒否の件数（今回の分を含む）。 */
  recentFailures: number;
  /** 直近 ERROR_WINDOW_MS のサーバーエラー件数（今回の分を含む）。 */
  recentErrors: number;
}

/** 日本時間の時（0〜23）。 */
export function hourInJst(date: Date): number {
  return (date.getUTCHours() + 9) % 24;
}

/** 深夜（日本時間 0:00〜5:59）か。 */
export function isLateNightJst(date: Date): boolean {
  return hourInJst(date) < 6;
}

/** 日本以外からか。分からない（null・"XX"・"T1"=Tor 以外の不明）は「日本以外」に数えない。Tor は数える。 */
export function isForeign(country: string | null): boolean {
  if (!country) return false;
  const c = country.trim().toUpperCase();
  if (c === "" || c === "XX") return false;
  return c !== "JP";
}

export function decideAlert(input: AlertInput): AlertRule | null {
  switch (input.kind) {
    case "login_failed":
    case "api_key_rejected":
      return input.recentFailures >= FAILURE_THRESHOLD ? "login_failures" : null;
    case "login_locked":
      return "login_locked";
    case "login_succeeded":
      return isLateNightJst(input.occurredAt) || isForeign(input.country) ? "unusual_login" : null;
    case "server_error":
      return input.recentErrors >= ERROR_THRESHOLD ? "error_spike" : null;
    default:
      return null;
  }
}

/** 同じ規則の通知を間引くか。lastSentAt は同じ規則で最後に送った時刻（無ければ null）。 */
export function shouldSuppress(rule: AlertRule, lastSentAt: Date | null, now: Date): boolean {
  if (rule === "unusual_login") return false;
  if (!lastSentAt) return false;
  return now.getTime() - lastSentAt.getTime() < ALERT_COOLDOWN_MS;
}

export interface AlertMessageInput {
  rule: AlertRule;
  service: string;
  occurredAt: Date;
  ip: string | null;
  country: string | null;
  recentFailures: number;
  recentErrors: number;
}

function jstLabel(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}（日本時間）`;
}

/** 通知メールの件名と本文。何が起きたか・まず何をするかを書く。 */
export function buildAlertMessage(input: AlertMessageInput): { subject: string; text: string } {
  const where = `${input.ip ?? "不明"}${input.country ? `（${input.country}）` : ""}`;
  const when = jstLabel(input.occurredAt);
  const head = `[${input.service}]`;
  switch (input.rule) {
    case "login_failures":
      return {
        subject: `${head} 管理画面のログイン失敗が続いています`,
        text: [
          `直近15分で管理画面のログイン失敗が ${input.recentFailures} 回ありました。`,
          `最後の試行: ${when} / 送信元 ${where}`,
          "",
          "自分で打ち間違えていないなら、総当たりの可能性があります。",
          "同じ IP が続くなら Cloudflare の WAF でその IP を止めてください。"
        ].join("\n")
      };
    case "login_locked":
      return {
        subject: `${head} 管理画面のログインをロックしました`,
        text: [
          `同じ送信元が15分で${FAILURE_THRESHOLD}回パスワードを外したため、ロックしました。`,
          `時刻: ${when} / 送信元 ${where}`,
          "",
          "自分でなければ、パスワードの変更と、その IP の遮断を検討してください。"
        ].join("\n")
      };
    case "unusual_login":
      return {
        subject: `${head} いつもと違う管理画面ログインがありました`,
        text: [
          `管理画面にログインがありました（深夜か、日本以外から）。`,
          `時刻: ${when} / 送信元 ${where}`,
          "",
          "自分なら何もしなくて大丈夫です。",
          "覚えがなければ、すぐにパスワードを変えてください（ADMIN_PASSWORD_HASH の入れ替え）。"
        ].join("\n")
      };
    case "error_spike":
      return {
        subject: `${head} サーバーエラーが急に増えています`,
        text: [
          `直近10分でサーバーエラーが ${input.recentErrors} 件ありました。`,
          `最後のエラー: ${when}`,
          "",
          "障害か、異常なリクエストを大量に送られている可能性があります。",
          "Cloudflare の Workers のログ（Observability）で中身を確かめてください。"
        ].join("\n")
      };
  }
}
