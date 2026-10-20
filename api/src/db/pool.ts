import pg from "pg";
import { config } from "../config/index.js";

// pg returns int4 as numbers already; numeric (weight_kg) is parsed to a number below.
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 20,
    statement_timeout: 10_000,
});

export type Db = pg.Pool | pg.PoolClient;

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

export const closePool = () => pool.end();
