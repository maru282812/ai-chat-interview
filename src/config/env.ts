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
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  DEFAULT_PROJECT_ID: z.string().uuid(),
  SESSION_SUMMARY_INTERVAL: z.coerce.number().int().positive().default(5),
  MAX_AI_PROBES_PER_ANSWER: z.coerce.number().int().nonnegative().default(1),
  MAX_AI_PROBES_PER_SESSION: z.coerce.number().int().nonnegative().default(2),
  MENU_ACTION_DEBUG_FORCE_PROJECT_LIST: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  ADMIN_BASIC_USER: z.string().min(1),
  ADMIN_BASIC_PASSWORD: z.string().min(1)
});

export const env = envSchema.parse(process.env);
