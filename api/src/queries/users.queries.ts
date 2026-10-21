import type { Db } from "../db/pool.js";
import type { Role } from "../types/index.js";

export async function findByEmail(db: Db, email: string) {
    const { rows } = await db.query("SELECT id, password_hash, token_version FROM users WHERE email = $1", [email]);
    return (rows[0] as { id: number; password_hash: string; token_version: number } | undefined) ?? null;
}

export async function findAuthUser(db: Db, id: number) {
    const { rows } = await db.query(
        `SELECT u.id, u.name, u.role, u.token_version, t.id AS trainer_id
     FROM users u LEFT JOIN trainers t ON t.user_id = u.id WHERE u.id = $1`,
        [id],
    );
    return (
        (rows[0] as
            { id: number; name: string; role: Role; token_version: number; trainer_id: number | null } | undefined) ??
        null
    );
}

export async function findProfileBasics(db: Db, id: number) {
    const { rows } = await db.query("SELECT id, email, name, role, zone_id, lat, lng FROM users WHERE id = $1", [id]);
    return (
        (rows[0] as
            | {
                  id: number;
                  email: string;
                  name: string;
                  role: Role;
                  zone_id: number | null;
                  lat: number | null;
                  lng: number | null;
              }
            | undefined) ?? null
    );
}

export async function bumpTokenVersion(db: Db, id: number) {
    await db.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [id]);
}
