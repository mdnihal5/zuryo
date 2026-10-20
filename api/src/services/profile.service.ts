import { pool } from "../db/pool.js";
import * as profileQueries from "../queries/profile.queries.js";
import type { AuthUser, FitnessProfile } from "../types/index.js";

export const toProfileView = (p: FitnessProfile & { updated_at: Date }) => ({
    age: p.age,
    weightKg: p.weight_kg,
    goals: p.goals,
    level: p.level,
    preferences: p.preferences,
    updatedAt: p.updated_at,
});

export async function get(customer: AuthUser) {
    const p = await profileQueries.get(pool, customer.id);
    return p ? toProfileView(p) : null;
}

export async function save(customer: AuthUser, input: FitnessProfile) {
    await profileQueries.upsert(pool, customer.id, input);
    return (await get(customer))!;
}
