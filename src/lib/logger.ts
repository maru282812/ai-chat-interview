type LogLevel = "INFO" | "WARN" | "ERROR";

function write(level: LogLevel, message: string, meta?: unknown): void {
  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    meta
  };
  const line = JSON.stringify(payload);
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info: (message: string, meta?: unknown) => write("INFO", message, meta),
  warn: (message: string, meta?: unknown) => write("WARN", message, meta),
  error: (message: string, meta?: unknown) => write("ERROR", message, meta)
};
