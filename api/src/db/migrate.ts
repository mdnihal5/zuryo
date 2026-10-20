import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool, closePool } from "./pool.js";

const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));

export async function migrate(): Promise<string[]> {
    await pool.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await pool.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename));
    const applied: string[] = [];
    for (const file of readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()) {
        if (done.has(file)) continue;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(readFileSync(dir + file, "utf8"));
            await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
            await client.query("COMMIT");
            applied.push(file);
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    }
    return applied;
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
