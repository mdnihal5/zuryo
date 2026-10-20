import { pool } from "../db/pool.js";
import * as usersQueries from "../queries/users.queries.js";
import { verifyPassword } from "../lib/password.js";
import { signToken } from "../lib/jwt.js";
import { HttpError } from "../lib/http-error.js";
import { log } from "../lib/logger.js";

const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

export async function login(email: string, password: string) {
    const user = await usersQueries.findByEmail(pool, email);
    // verifyPassword hashes even for an unknown email, so timing does not reveal which emails exist.
    const ok = await verifyPassword(password, user?.password_hash);
    if (!user || !ok) {
        log.warn("auth.login.failed", { email: maskEmail(email) });
        throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
    const basics = (await usersQueries.findProfileBasics(pool, user.id))!;
    log.info("auth.login", { userId: user.id, role: basics.role });
    return {
        token: signToken(user.id, user.token_version),
        user: { id: basics.id, name: basics.name, email: basics.email, role: basics.role },
    };
}

export async function me(userId: number) {
    const u = (await usersQueries.findProfileBasics(pool, userId))!;
    return { id: u.id, name: u.name, email: u.email, role: u.role, zoneId: u.zone_id };
}

// Bumping token_version makes every token issued before this moment invalid.
export async function logoutEverywhere(userId: number) {
    await usersQueries.bumpTokenVersion(pool, userId);
}

// Used by the auth middleware: a valid signature is not enough, the token must also match the user's current version.
export async function authenticate(userId: number, tokenVersion: number) {
    const u = await usersQueries.findAuthUser(pool, userId);
    if (!u || u.token_version !== tokenVersion) return null;
    return { id: u.id, role: u.role, name: u.name, trainerId: u.trainer_id };
}
