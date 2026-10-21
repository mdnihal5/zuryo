import type { Db } from "../db/pool.js";
import type { Exercise } from "../types/index.js";

const SELECT = `SELECT booking_id AS "bookingId", exercises, duration_minutes AS "durationMinutes", trainer_notes AS "trainerNotes", customer_rating AS "customerRating", customer_comment AS "customerComment", suggested_next_workout AS "suggestedNextWorkout", updated_at AS "updatedAt"
    FROM session_records`;

export async function find(db: Db, bookingId: number) {
    return (await db.query(`${SELECT} WHERE booking_id = $1`, [bookingId])).rows[0] ?? null;
}

export async function upsertTrainerPart(
    db: Db,
    bookingId: number,
    r: {
        exercises: Exercise[];
        durationMinutes: number;
        trainerNotes: string | null;
        suggestedNextWorkout: string | null;
    },
) {
    await db.query(
        `INSERT INTO session_records (booking_id, exercises, duration_minutes, trainer_notes, suggested_next_workout)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (booking_id) DO UPDATE SET exercises = $2, duration_minutes = $3, trainer_notes = $4, suggested_next_workout = $5, updated_at = now()`,
        [bookingId, JSON.stringify(r.exercises), r.durationMinutes, r.trainerNotes, r.suggestedNextWorkout],
    );
}

export async function upsertFeedback(db: Db, bookingId: number, rating: number, comment: string | null) {
    await db.query(
        `INSERT INTO session_records (booking_id, customer_rating, customer_comment) VALUES ($1,$2,$3)
            ON CONFLICT (booking_id) DO UPDATE SET customer_rating = $2, customer_comment = $3, updated_at = now()`,
        [bookingId, rating, comment],
    );
}
