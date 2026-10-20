import { app } from "./app.js";
import { config } from "./config/index.js";
import { closePool } from "./db/pool.js";
import { completeDueSessions } from "./services/sessions.service.js";
import { expireHolds } from "./services/payments.service.js";
import { log } from "./lib/logger.js";

const server = app.listen(config.port, () => log.info("server.started", { port: config.port, env: config.env }));

const sweep = config.sweepEnabled
    ? setInterval(() => {
          const now = new Date();
          Promise.all([completeDueSessions(now, "sweep"), expireHolds(undefined, now, "sweep")]).catch((err) =>
              log.error("sweep.failed", { err: err?.name, code: err?.code }),
          );
      }, config.sweepIntervalSeconds * 1000)
    : null;

async function shutdown(signal: string) {
    log.info("server.stopping", { signal });
    if (sweep) clearInterval(sweep);
    server.close(async () => {
        await closePool();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
