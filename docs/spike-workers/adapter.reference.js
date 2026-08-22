// Express アプリを Workers の fetch handler に載せるアダプタ。
//
// 方針: 自作モックではなく workerd の nodejs_compat が提供する
// 本物の http.IncomingMessage / http.ServerResponse を使う。
// これにより Express の res.render / res.redirect / res.cookie など
// 全APIが無改修で動く（自作モックだと実装漏れが必ず出る）。
import { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { Buffer } from "node:buffer";

export function createFetchHandler(app) {
  return async function handleFetch(request) {
    const url = new URL(request.url);

    const bodyBuf =
      request.method === "GET" || request.method === "HEAD"
        ? null
        : Buffer.from(await request.arrayBuffer());

    // ソケットの代わりに Readable を差し込む。IncomingMessage は
    // socket からデータを読む設計なので、ここに実体を渡す。
    // workerd の IncomingMessage は push() が期待通りに動かないため、
    // Readable を土台にして IncomingMessage のプロパティを載せる方式にする。
    // body-parser(raw-body) は on("data")/on("end") しか見ないのでこれで足りる。
    const req = Readable.from(bodyBuf && bodyBuf.length ? [bodyBuf] : []);
    req.method = request.method;
    req.url = url.pathname + url.search;
    req.headers = Object.fromEntries(request.headers);
    req.rawHeaders = [];
    for (const [k, v] of request.headers) req.rawHeaders.push(k, v);
    req.httpVersion = "1.1";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 1;
    // on-finished の isFinished() は socket.readable を見る（node_modules/on-finished/index.js:76）。
    // readable:true が無いと body-parser が「読み終わった」と誤判定してボディを読まない。
    req.socket = {
      remoteAddress: "127.0.0.1",
      encrypted: url.protocol === "https:",
      readable: true,
      writable: true,
      destroyed: false,
      on() { return this; },
      once() { return this; },
      removeListener() { return this; },
      setTimeout() { return this; },
    };
    req.connection = req.socket;
    req.aborted = false;
    req.complete = false;
    req.setTimeout = () => req;

    const res = new ServerResponse(req);
    const chunks = [];

    // ServerResponse は socket へ書く。socket を横取りして
    // 生バイト列を集め、Response へ組み替える。
    const fakeSocket = {
      write(chunk, enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc || "utf8"));
        if (cb) cb();
        return true;
      },
      end(chunk, enc, cb) {
        if (chunk) this.write(chunk, enc);
        if (cb) cb();
        return this;
      },
      on() { return this; },
      once() { return this; },
      emit() { return this; },
      removeListener() { return this; },
      destroy() { return this; },
      cork() {},
      uncork() {},
      writable: true,
digest: undefined,
    };

    return await new Promise((resolve, reject) => {
      // workerd の ServerResponse は assignSocket が未実装（意図的なスタブ）。
      // 代わりに write/end を差し替えて出力を横取りする。
      const origWrite = res.write.bind(res);
      const origEnd = res.end.bind(res);
      let settled = false;

      res.write = (chunk, enc, cb) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === "string" ? enc : "utf8"));
        if (typeof enc === "function") enc();
        else if (cb) cb();
        return true;
      };

      res.end = (chunk, enc, cb) => {
        if (chunk && typeof chunk !== "function") {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === "string" ? enc : "utf8"));
        }
        if (typeof chunk === "function") chunk();
        else if (typeof enc === "function") enc();
        else if (cb) cb();

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
        headers.delete("transfer-encoding");
        headers.delete("content-length");

        const noBody = res.statusCode === 204 || res.statusCode === 304 || request.method === "HEAD";
        resolve(new Response(noBody ? null : body, { status: res.statusCode, headers }));
        return res;
      };

      res.on("error", (e) => { if (!settled) { settled = true; reject(e); } });

      try {
        app(req, res);
      } catch (e) {
        if (!settled) { settled = true; reject(e); }
      }
    });
  };
}
