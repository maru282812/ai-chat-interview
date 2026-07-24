import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_LIFF_CHANNEL_ID: z.string().min(1).optional(),
  LINE_LIFF_ID: z.string().min(1).optional(),
  LINE_LIFF_ID_RANT: z.string().min(1).optional(),
  LINE_LIFF_ID_DIARY: z.string().min(1).optional(),
  LINE_LIFF_ID_PERSONALITY: z.string().min(1).optional(),
  // survey / mypage 用 LIFF ID（未設定時は LINE_LIFF_ID にフォールバック）
  // LINE Developers で survey 用 / mypage 用 LIFF App を作成後に設定する
  LINE_LIFF_ID_SURVEY: z.string().min(1).optional(),
  LINE_LIFF_ID_MYPAGE: z.string().min(1).optional(),
  LINE_LIFF_ID_CONTACT: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  ADMIN_NOTIFICATION_EMAIL: z.string().email().optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  // 管理ツール系 AI 呼び出し（設問生成・フロー流用・属性提案）に使うモデル。
  // 将来は管理画面から変更可能にする予定。既存挙動を維持するため gpt-4o-mini をデフォルトとする。
  OPENAI_TOOL_MODEL: z.string().default("gpt-4o-mini"),
  DEFAULT_PROJECT_ID: z.string().uuid(),
  SESSION_SUMMARY_INTERVAL: z.coerce.number().int().positive().default(5),
  MAX_AI_PROBES_PER_ANSWER: z.coerce.number().int().nonnegative().default(1),
  MAX_AI_PROBES_PER_SESSION: z.coerce.number().int().nonnegative().default(2),
  // Survey LIFF 本人確認設定
  // LIFF_AUTH_REQUIRED=true のとき、サーバー側で auth 必須を強制する（本番では true に）
  LIFF_AUTH_REQUIRED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  // ALLOW_LIFF_AUTH_SKIP=false のとき、クライアント側での本人確認スキップを禁止する（本番では false に）
  ALLOW_LIFF_AUTH_SKIP: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  MENU_ACTION_DEBUG_FORCE_PROJECT_LIST: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  ADMIN_BASIC_USER: z.string().min(1),
  ADMIN_BASIC_PASSWORD: z.string().min(1),
  // Vercel Cron ディスパッチャ（/api/cron/dispatch）の認証用シークレット。
  // Vercel に CRON_SECRET を設定すると Vercel Cron が Authorization: Bearer <secret> を付与する。
  // 未設定の場合 /api/cron/dispatch は 503 を返し、定期配信は行われない。
  CRON_SECRET: z.string().min(1).optional(),
  // staff-voice（企業メンタルチェック・別リポ/別DB）からの Push プロキシ（/api/mental/push）の
  // 認証用シークレット。staff-voice 側の env と同じ値を設定する。
  // 未設定の場合 /api/mental/push は 503 を返し、プロキシは無効。
  MENTAL_PUSH_PROXY_SECRET: z.string().min(16).optional(),
  // 管理画面AIチャット（docs/impl-admin-ai-chat.md）
  // 1指示あたりのツール実行往復の上限。超えたら途中結果で打ち切って報告する。
  ADMIN_CHAT_MAX_TOOL_ROUNDS: z.coerce.number().int().positive().max(20).default(8),
  // 1指示あたりのソフトタイムアウト（ミリ秒）。Vercel の実行時間内に収めるための自主制限。
  ADMIN_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  // チャットに使うモデル。未設定なら OPENAI_TOOL_MODEL（既定 gpt-4o-mini）を使う。
  // 既定モデルでも読み取り・集計・実行不可の案内は実測で正しく動く。要約の質を上げたい
  // ときだけ、他の管理ツール系AIを巻き込まずにここだけ上位モデルへ切り替えられるようにしておく。
  ADMIN_CHAT_MODEL: z.string().optional()
});

export const env = envSchema.parse(process.env);
