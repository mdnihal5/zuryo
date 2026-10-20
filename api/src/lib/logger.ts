import { config } from "../config/index.js";

type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /pass|token|secret|authorization|cookie|api_?key|database_?url/i;

function clean(fields: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        out[k] = REDACT.test(k) ? "[redacted]" : v;
    }
    return out;
}

// One event, one line. Dev: "12:04:31.221 INFO  booking.created  id=12 ...". Production: the same data as JSON.
function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
    if (RANK[level] < RANK[config.logLevel]) return;
    if (config.env === "test" && level !== "error") return;
    const f = clean(fields);
    const now = new Date();
    const line = config.isProduction
        ? JSON.stringify({ t: now.toISOString(), level, event, ...f })
        : `${now.toISOString().slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${event.padEnd(20)} ` +
          Object.entries(f)
              .map(([k, v]) => `${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`)
              .join(" ");
    (level === "error" ? console.error : console.log)(line);
}

export const log = {
    debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
    info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
    error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
