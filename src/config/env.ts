import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Vercel が自動で入れる（production / preview / development）。こちらが設定不要なので、
  // 「HTTPS 上で動いているか」の判定には NODE_ENV ではなくこれを使う。
  //
  // NODE_ENV は本番でも "development" のままにしてある（2026-08-13 時点）。
  // testmaster の検証シーム（liffAuthService の tmtest: トークン）と、
  // assignment.user_id 未設定時の本人確認が NODE_ENV=production で塞がるため、
  // 検証中は切り替えられない。Cookie の Secure 属性だけがそれに引きずられないよう分離する。
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
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
  // 管理画面ログイン（/admin/login）のパスワード。平文ではなく scrypt ハッシュを置く。
  // 生成: npm run admin:hash -- '<パスワード>'
  // 形式: scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>（lib/adminPassword.ts）
  ADMIN_PASSWORD_HASH: z.string().min(1),
  // セッション Cookie の HMAC 署名鍵（lib/adminSession.ts）。
  // **この値を変えると発行済みセッションが全て即座に無効になる**（緊急ログアウト手段）。
  // 値は十分にランダムにすること（例: openssl rand -hex 32）。
  ADMIN_SESSION_SECRET: z.string().min(32),
  // 管理画面を叩く非対話クライアント（scripts/adminChatSmoke.mjs 等）用の鍵。
  // 人間はログイン画面を通るが、スクリプトはセッションを張れないため別経路を用意する。
  // 未設定ならヘッダ経由の認証は一切通らない（fail-closed）。
  ADMIN_API_KEY: z.string().min(16).optional(),
  // Vercel Cron ディスパッチャ（/api/cron/dispatch）の認証用シークレット。
  // Vercel に CRON_SECRET を設定すると Vercel Cron が Authorization: Bearer <secret> を付与する。
  // 未設定の場合 /api/cron/dispatch は 503 を返し、定期配信は行われない。
  CRON_SECRET: z.string().min(1).optional(),
  // staff-voice（企業メンタルチェック・別リポ/別DB）からの Push プロキシ（/api/mental/push）の
  // 認証用シークレット。staff-voice 側の env と同じ値を設定する。
  // 未設定の場合 /api/mental/push は 503 を返し、プロキシは無効。
  MENTAL_PUSH_PROXY_SECRET: z.string().min(16).optional(),
  // パートナーAPI（/api/partner/*・docs/partner-api.md）の認証キー。
  // 会員ポータル（hibi-portal）がサーバー側からのみ X-Partner-Key ヘッダに載せて送る。
  // 未設定の場合 /api/partner/* は全て 503 を返す（起動は妨げない）。
  // 値は十分にランダムな文字列にすること（例: openssl rand -hex 32）。
  PARTNER_API_KEY: z.string().min(16).optional(),
  // 運営専用API（/api/partner-admin/*・docs/partner-api.md §8）の認証キー。
  // ACI 管理画面で作った未割り当て案件を、ポータルの運営画面（/ops）から店舗に割り当てる
  // ためだけに使う。**PARTNER_API_KEY とは別物で、フォールバックは一切しない**
  // （店舗スコープのキーで全社の案件が引けてはいけないため）。
  // 未設定の場合 /api/partner-admin/* は全て 503 を返す（起動は妨げない）。
  // 値は十分にランダムな文字列にすること（例: openssl rand -hex 32）。
  PARTNER_ADMIN_API_KEY: z.string().min(16).optional(),
  // パートナーAPI で受け付ける設問文画像URLのホスト許可リスト（カンマ区切り・ホスト名のみ）。
  // 例: PARTNER_IMAGE_URL_ALLOWED_HOSTS=portal.example.com,portal-staging.example.com
  //
  // 回答画面（LIFF）に差し込まれる <img> の向き先なので、任意の外部URLを通すと
  // トラッキング・回答者IPの収集・不適切画像の差し込みに使われる。
  // パートナーAPIキーが漏れた場合や将来パートナーが増えた場合の被害を抑えるため、
  // **未設定なら画像URLを一切受け付けない（fail-closed）**。https のみ許可。
  PARTNER_IMAGE_URL_ALLOWED_HOSTS: z.string().optional(),
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
