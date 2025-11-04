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

  function shouldLog(lvl: LogLevel): boolean {
    return order.indexOf(lvl) >= minIdx;
  }

  function log(lvl: LogLevel, msg: string, ctx?: Record<string, unknown>) {
    if (!shouldLog(lvl)) return;
    const payload = ctx ? ` ${JSON.stringify(ctx)}` : "";
    // eslint-disable-next-line no-console
    console[lvl === "debug" ? "log" : lvl](`[${lvl}] ${msg}${payload}`);
  }

  return {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
  };
}

export default createLogger;


