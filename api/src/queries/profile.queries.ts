import type { Db } from "../db/pool.js";
import type { FitnessProfile, SessionHistoryItem } from "../types/index.js";

const COLUMNS = "age, weight_kg, goals, level, preferences";

export async function get(db: Db, customerId: number) {
    const { rows } = await db.query(`SELECT ${COLUMNS}, updated_at FROM fitness_profiles WHERE customer_id = $1`, [
        customerId,
    ]);
    return (rows[0] as (FitnessProfile & { updated_at: Date }) | undefined) ?? null;
}

export async function upsert(db: Db, customerId: number, p: FitnessProfile) {
    await db.query(
        `INSERT INTO fitness_profiles (customer_id, ${COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (customer_id) DO UPDATE SET age = $2, weight_kg = $3, goals = $4, level = $5, preferences = $6, updated_at = now()`,
        [customerId, p.age, p.weight_kg, p.goals, p.level, p.preferences],
    );
}

// Newest first. Only completed sessions that have a record.
export async function recentSessions(db: Db, customerId: number, limit: number): Promise<SessionHistoryItem[]> {
    const { rows } = await db.query(
        `SELECT b.starts_at, r.duration_minutes, r.exercises
            FROM bookings b JOIN session_records r ON r.booking_id = b.id
            WHERE b.customer_id = $1 AND b.status = 'completed'
            ORDER BY b.starts_at DESC LIMIT $2`,
        [customerId, limit],
    );
    return rows.map((r) => ({ startsAt: r.starts_at, durationMinutes: r.duration_minutes, exercises: r.exercises }));
}
