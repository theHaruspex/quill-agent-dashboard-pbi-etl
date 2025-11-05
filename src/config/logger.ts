import fs from "fs";
import path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const order: LogLevel[] = ["debug", "info", "warn", "error"];
  const minIdx = order.indexOf(level);

  // Initialize per-run file logger
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logsDir = process.env.LOG_DIR || path.join(process.cwd(), "logs");
  let fileStream: fs.WriteStream | null = null;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const filePath = path.join(logsDir, `run-${runStamp}.log`);
    fileStream = fs.createWriteStream(filePath, { flags: "a" });
  } catch {
    fileStream = null;
  }

  function shouldLog(lvl: LogLevel): boolean {
    return order.indexOf(lvl) >= minIdx;
  }

  function log(lvl: LogLevel, msg: string, ctx?: Record<string, unknown>) {
    if (!shouldLog(lvl)) return;
    const payload = ctx ? ` ${JSON.stringify(ctx)}` : "";
    const ts = new Date().toISOString();
    const line = `${ts} [${lvl}] ${msg}${payload}`;
    // eslint-disable-next-line no-console
    console[lvl === "debug" ? "log" : lvl](line);
    try {
      if (fileStream) fileStream.write(line + "\n");
    } catch {}
  }

  return {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
  };
}

export default createLogger;

export const logger: Logger = createLogger((process.env.LOG_LEVEL as LogLevel) || "info");


