import path from "path";
import express from "express";
import { env } from "./config/env";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { adminCsrfMiddleware } from "./middleware/adminCsrf";
import { adminLocals } from "./middleware/adminLocals";
import { perfTiming } from "./middleware/perfTiming";
import { errorHandler } from "./lib/http";
import { adminRoutes } from "./routes/adminRoutes";
import { liffRoutes } from "./routes/liffRoutes";
import { webhookRoutes } from "./routes/webhookRoutes";
import { cronRoutes } from "./routes/cronRoutes";
import { mentalProxyRoutes } from "./routes/mentalProxyRoutes";
import { partnerAdminRoutes } from "./routes/partnerAdminRoutes";
import { partnerRoutes } from "./routes/partnerRoutes";
import { registerAdminChatTools } from "./services/adminChat/registerTools";
import { renderCompiled } from "./lib/compiledViews";

/**
 * express が view の絶対パスを組み立てるための基準ディレクトリ。
 * プリコンパイル済みビューを使うので実際にこの場所を読みには行かないが、
 * express の内部処理（パス結合）に必要なので名目上の値を渡す。
 */
const VIEWS_ROOT = "/views";

/**
 * express が渡してくる絶対パス（VIEWS_ROOT + "/" + name + ".ejs"）を、
 * compiledViews のキー（views ルートからの相対パス・拡張子なし）へ戻す。
 */
function toViewKey(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\.ejs$/, "");
  const idx = normalized.indexOf(`${VIEWS_ROOT}/`);
  return idx >= 0 ? normalized.slice(idx + VIEWS_ROOT.length + 1) : normalized.replace(/^\//, "");
}

/**
 * express 既定の View クラスは、描画前に `fs.existsSync` でテンプレートの実在を確認し、
 * 見つからなければ「Failed to lookup view」で失敗する（express/lib/application.js:558）。
 * プリコンパイル済みビューは FS 上に無いので、その探索を丸ごと差し替える。
 *
 * ここで `path` を素通しし、実際の解決は app.engine 側（toViewKey → renderCompiled）に任せる。
 */
class CompiledView {
  public readonly name: string;
  public readonly path: string;
  private readonly engineFn: (
    filePath: string,
    options: unknown,
    callback: (e: Error | null, rendered?: string) => void
  ) => void;

  constructor(
    name: string,
    opts: {
      defaultEngine?: string;
      root?: string | string[];
      engines: Record<string, CompiledView["engineFn"]>;
    }
  ) {
    this.name = name;
    const ext = name.endsWith(".ejs") ? "" : ".ejs";
    this.path = `${VIEWS_ROOT}/${name}${ext}`;
    const engine = opts.engines[".ejs"];
    if (!engine) throw new Error("ejs engine is not registered");
    this.engineFn = engine;
  }

  render(options: unknown, callback: (e: Error | null, rendered?: string) => void): void {
    this.engineFn(this.path, options, callback);
  }
}

export function createApp() {
  const app = express();

  // 管理画面AIチャットが使えるツールを登録する（docs/impl-admin-ai-chat.md）
  registerAdminChatTools();

  // ビューはプリコンパイル済みのものを使う（src/views/_compiled.ts）。
  // 実行時に FS からテンプレートを読まないため、Cloudflare Workers でも動く。
  // Vercel / ローカルでも同じ経路を通す（環境で描画方式を変えると片方だけ壊れるため）。
  // 再生成: npm run build:views
  app.set("view engine", "ejs");
  app.engine("ejs", (filePath, options, callback) => {
    try {
      // express は views ルート + 拡張子を付けた絶対パスを渡してくる。
      // compiledViews 側のキー（views からの相対パス・拡張子なし）へ戻す。
      const key = toViewKey(filePath);
      callback(null, renderCompiled(key, options as Record<string, unknown>));
    } catch (e) {
      callback(e as Error);
    }
  });
  // express が絶対パスを組み立てるための基準（実際に読みには行かない）
  app.set("views", VIEWS_ROOT);
  // 既定の View は FS 実在チェックをするので、プリコンパイル用に差し替える
  app.set("view", CompiledView);

  app.use((_req, res, next) => {
    const originalRender = res.render.bind(res);
    res.render = ((view: string, options?: unknown, callback?: unknown) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return originalRender(view, options as never, callback as never);
    }) as typeof res.render;
    next();
  });

  app.use("/public", express.static(path.join(process.cwd(), "src", "public")));
  app.use("/webhooks/line", express.raw({ type: "application/json" }));
  app.use(express.json({ limit: "10mb" }));
  // 計測ビーコンだけは「壊れた JSON でも 204」を守る。express.json() はパース失敗を
  // throw し、それはルートの try/catch より前で起きるためルート側では捕まえられない。
  // ここで本ルートのパースエラーだけを body={} に丸め、計測が 500 を出さないようにする
  // （他のエンドポイントの 400/500 挙動は変えない）。
  app.use((err: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.path === "/liff/behavior-beacon" && err instanceof SyntaxError) {
      req.body = {};
      next();
      return;
    }
    next(err);
  });
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      environment: env.NODE_ENV
    });
  });

  app.use("/webhooks", webhookRoutes);
  app.use("/api/cron", cronRoutes);
  app.use("/api/mental", mentalProxyRoutes);
  // 会員ポータル（hibi-portal）向けパートナーAPI（docs/partner-api.md）。
  // 認証は X-Partner-Key（partnerRoutes 内でルータ全体に適用）。
  app.use("/api/partner", partnerRoutes);
  // 運営専用API（docs/partner-api.md §8）。ポータルの /ops から案件を店舗へ割り当てる。
  // 認証は X-Partner-Admin-Key（PARTNER_ADMIN_API_KEY・店舗用の鍵とは別物）。
  app.use("/api/partner-admin", partnerAdminRoutes);
  app.use("/admin", adminAuthMiddleware, adminCsrfMiddleware, adminLocals, adminRoutes);
  app.use("/liff", perfTiming, liffRoutes);

  app.get("/", (_req, res) => {
    res.redirect("/admin");
  });

  app.use(errorHandler);
  return app;
}
