/**
 * Express アプリを Cloudflare Workers の fetch handler に載せるアダプタ。
 *
 * Phase 0 のスパイクで実測した知見をそのまま実装している
 * （経緯と踏んだ罠は docs/spike-workers/RESULTS.md）。
 *
 * ## 設計上の要点
 *
 * 1. **res は workerd の本物の ServerResponse を使う**
 *    自作モックだと res.render / res.redirect / res.cookie などの実装漏れが必ず出る。
 *    nodejs_compat が本物を提供しているのでそれを使う。
 *
 * 2. **ただし assignSocket は使えない**
 *    workerd の ServerResponse.assignSocket は意図的な未実装スタブで
 *    ERR_METHOD_NOT_IMPLEMENTED を投げる。そのため write/end を差し替えて出力を捕まえる。
 *
 * 3. **req は Readable ベースで組む**
 *    workerd の IncomingMessage は push() が期待通りに動かない。
 *    body-parser(raw-body) は on("data")/on("end") しか見ないので Readable で足りる。
 *
 * 4. **req.socket.readable = true が必須（最重要）**
 *    body-parser → on-finished の isFinished() が `!socket.readable` を見て
 *    「もう読み終わった」と誤判定し、**エラーを出さずに next() する**。
 *    結果 req.body は undefined のまま HTTP 200 が返る＝全 POST が無言で壊れる。
 *    同じ理由で req.complete = true も立ててはいけない。
 */
import { Readable } from "node:stream";
import { Buffer } from "node:buffer";
import type { Express } from "express";

type NodeReq = Readable & {
  method: string;
  url: string;
  headers: Record<string, string>;
  rawHeaders: string[];
  httpVersion: string;
  httpVersionMajor: number;
  httpVersionMinor: number;
  socket: unknown;
  connection: unknown;
  aborted: boolean;
  complete: boolean;
  setTimeout: () => unknown;
};

export function createFetchHandler(app: Express) {
  return async function handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const bodyBuf =
      request.method === "GET" || request.method === "HEAD"
        ? null
        : Buffer.from(await request.arrayBuffer());

    const req = Readable.from(bodyBuf && bodyBuf.length ? [bodyBuf] : []) as NodeReq;
    req.method = request.method;
    req.url = url.pathname + url.search;
    req.headers = Object.fromEntries(request.headers) as Record<string, string>;
    req.rawHeaders = [];
    for (const [k, v] of request.headers) req.rawHeaders.push(k, v);
    req.httpVersion = "1.1";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    // readable:true が無いと body-parser がボディを読まない（上記4）
    req.socket = {
      remoteAddress:
        request.headers.get("cf-connecting-ip") ?? "127.0.0.1",
      encrypted: url.protocol === "https:",
      readable: true,
      writable: true,
      destroyed: false,
      on() {
        return this;
      },
      once() {
        return this;
      },
      removeListener() {
        return this;
      },
      setTimeout() {
        return this;
      },
    };
    req.connection = req.socket;
    req.aborted = false;
    req.complete = false;
    req.setTimeout = () => req;

    // ServerResponse は動的 import ではなく静的 import したいが、
    // 型が Node のものと衝突するのでここで require 相当に解決する。
    const { ServerResponse } = await import("node:http");
    const res = new ServerResponse(req as never);
    const chunks: Buffer[] = [];

    return await new Promise<Response>((resolve, reject) => {
      let settled = false;

      const toBuf = (chunk: unknown, enc?: unknown): Buffer =>
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk), (typeof enc === "string" ? enc : "utf8") as BufferEncoding);

      res.write = ((chunk: unknown, enc?: unknown, cb?: unknown) => {
        if (chunk) chunks.push(toBuf(chunk, enc));
        if (typeof enc === "function") (enc as () => void)();
        else if (typeof cb === "function") (cb as () => void)();
        return true;
      }) as typeof res.write;

      res.end = ((chunk?: unknown, enc?: unknown, cb?: unknown) => {
        if (chunk && typeof chunk !== "function") chunks.push(toBuf(chunk, enc));
        if (typeof chunk === "function") (chunk as () => void)();
        else if (typeof enc === "function") (enc as () => void)();
        else if (typeof cb === "function") (cb as () => void)();

        if (settled) return res;
        settled = true;

        const body = Buffer.concat(chunks);
        const headers = new Headers();
        const h = res.getHeaders();
        for (const [k, v] of Object.entries(h)) {
          if (v === undefined) continue;
          if (Array.isArray(v)) for (const vv of v) headers.append(k, String(vv));
          else headers.set(k, String(v));
        }
        // 転送方式は Workers 側が決める
        headers.delete("transfer-encoding");
        headers.delete("content-length");

        const noBody =
          res.statusCode === 204 || res.statusCode === 304 || request.method === "HEAD";

        resolve(
          new Response(noBody ? null : body, {
            status: res.statusCode,
            headers,
          })
        );
        return res;
      }) as typeof res.end;

      res.on("error", (e) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      });

      try {
        (app as unknown as (r: unknown, s: unknown) => void)(req, res);
      } catch (e) {
        if (!settled) {
          settled = true;
          reject(e);
        }
      }
    });
  };
}
