// `npm test`: starts a throwaway local Postgres, migrates and seeds it, runs vitest, then stops and deletes it.
// It never reads DATABASE_URL from the environment or .env, so it cannot touch a real database.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PG_BIN = process.env.PG_BIN ?? "/usr/lib/postgresql/18/bin";
const PORT = process.env.TEST_PG_PORT ?? "55432";
const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, ".tmp", "pg-test");
const data = join(dir, "data");

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
    spawnSync(cmd, args, { stdio: "inherit", env, cwd: root });
const quiet = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });

function stopPostgres() {
    const pidFile = join(data, "postmaster.pid");
    if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, "utf8").split("\n")[0]);
        quiet(`${PG_BIN}/pg_ctl`, ["-D", data, "-m", "fast", "-w", "stop"]);
        try {
            process.kill(pid, 0);
            process.kill(pid, "SIGTERM");
        } catch {
            /* already gone */
        }
    }
    rmSync(join(root, ".tmp"), { recursive: true, force: true });
}

let code = 1;
try {
    stopPostgres();
    mkdirSync(dir, { recursive: true });
    let r = quiet(`${PG_BIN}/initdb`, ["-D", data, "-U", "postgres", "-A", "trust", "--no-sync", "-E", "UTF8"]);
    if (r.status !== 0) throw new Error(`initdb failed: ${r.stderr}`);
    r = quiet(`${PG_BIN}/pg_ctl`, [
        "-D",
        data,
        "-l",
        join(dir, "pg.log"),
        "-w",
        "start",
        "-o",
        `-p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c fsync=off -c max_connections=100`,
    ]);
    if (r.status !== 0) throw new Error(`pg_ctl start failed: ${r.stderr}`);
    r = quiet(`${PG_BIN}/createdb`, ["-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "zuryo_test"]);
    if (r.status !== 0) throw new Error(`createdb failed: ${r.stderr}`);

    const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        DATABASE_URL: `postgres://postgres@127.0.0.1:${PORT}/zuryo_test`,
        JWT_SECRET: "test-secret-test-secret-test-secret-123456",
        BCRYPT_COST: "4",
        RATE_LIMIT_ENABLED: "false",
        SWEEP_ENABLED: "false",
        MOCKPAY_WEBHOOK_SECRET: "test-webhook-secret-123456",
        MOCKPAY_WEBHOOK_DELAY_MS: "0",
    };
    if (run("npx", ["tsx", "src/db/migrate.ts"], env).status !== 0) throw new Error("migrate failed");
    if (run("npx", ["tsx", "src/scripts/seed.ts"], env).status !== 0) throw new Error("seed failed");
    code = run("npx", ["vitest", "run", ...process.argv.slice(2)], env).status ?? 1;
} catch (err) {
    console.error((err as Error).message);
} finally {
    stopPostgres();
}
process.exit(code);
