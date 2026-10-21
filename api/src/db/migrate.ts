import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool, closePool } from "./pool.js";

// One transaction for all pending files, behind a transaction-level advisory lock (safe through a transaction
// pooler), so two instances booting at once apply each migration exactly once.
const LOCK_ID = 727001;
const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));

export async function migrate(): Promise<string[]> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
        await client.query(
            "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
        );
        const done = new Set(
            (await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
        );
        const pending = readdirSync(dir)
            .filter((f) => f.endsWith(".sql") && !done.has(f))
            .sort();
        for (const file of pending) {
            await client.query(readFileSync(dir + file, "utf8"));
            await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        }
        await client.query("COMMIT");
        return pending;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// Run directly: npm run migrate
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    migrate()
        .then((a) => console.log(a.length ? `applied: ${a.join(", ")}` : "already up to date"))
        .catch((e) => {
            console.error(e.message);
            process.exitCode = 1;
        })
        .finally(closePool);
}
