/**
 * Workers ビルド専用の node-cron スタブ。
 *
 * node-cron は子プロセスを起動する実装（background-scheduled-task が
 * `path.resolve(__dirname, "daemon.js")` を評価する）を含むため、
 * Workers では import しただけで `__dirname is not defined` になる。
 *
 * 常駐スケジューラは Workers では**そもそも起動しない**（定期実行は
 * wrangler.toml の Cron Trigger → workers/index.ts の scheduled handler が担う）。
 * したがって実体は不要で、型だけ合う空実装で置き換える。
 *
 * 誤って Workers 上で schedule() が呼ばれたら黙って無視せず throw する。
 * 「動いているつもりで動いていない」状態を作らないため。
 */
export interface ScheduledTask {
  start(): void;
  stop(): void;
  destroy?(): void;
}

function unsupported(): never {
  throw new Error(
    "node-cron is not available on Cloudflare Workers. " +
      "定期実行は wrangler.toml の Cron Trigger を使うこと（workers/index.ts の scheduled）。"
  );
}

export function schedule(): ScheduledTask {
  return unsupported();
}

export function validate(): boolean {
  return false;
}

export function getTasks(): Map<string, ScheduledTask> {
  return new Map();
}

export default { schedule, validate, getTasks };
