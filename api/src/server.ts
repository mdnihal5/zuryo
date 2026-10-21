import { app } from "./app.js";
import { config } from "./config/index.js";
import { closePool } from "./db/pool.js";
import { completeDueSessions } from "./services/sessions.service.js";
import { expireHolds } from "./services/payments.service.js";
import { log } from "./lib/logger.js";

const server = app.listen(config.port, () => log.info("server.started", { port: config.port, env: config.env }));

// A tick is skipped while the previous sweep is still running, and shutdown waits for it.
let inFlight: Promise<void> | null = null;
const sweep = config.sweepEnabled
    ? setInterval(() => {
          if (inFlight) return;
          const now = new Date();
          inFlight = Promise.all([completeDueSessions(now, "sweep"), expireHolds(undefined, now, "sweep")])
              .then(() => {})
              .catch((err) => log.error("sweep.failed", { err: err?.name, code: err?.code }))
              .finally(() => {
                  inFlight = null;
              });
      }, config.sweepIntervalSeconds * 1000)
    : null;

async function shutdown(signal: string) {
    log.info("server.stopping", { signal });
    setTimeout(() => process.exit(1), 10_000).unref();
    if (sweep) clearInterval(sweep);
    await inFlight;
    server.close(async () => {
        await closePool();
        process.exit(0);
    });
}

process.on("unhandledRejection", (reason) =>
    log.error("process.unhandled_rejection", { message: reason instanceof Error ? reason.message : String(reason) }),
);

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
