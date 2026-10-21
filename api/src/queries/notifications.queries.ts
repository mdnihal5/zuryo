import type { Db } from "../db/pool.js";

export type NewNotification = {
    userId: number;
    kind:
        | "booking_assigned"
        | "booking_cancelled"
        | "booking_rescheduled"
        | "session_completed"
        | "session_warning"
        | "payment_failed"
        | "payment_refunded";
    bookingId: number;
    message: string;
};

// One statement for all recipients, so a booking transaction spends one round trip on notifications, not one per person.
export async function insertMany(db: Db, rows: NewNotification[]) {
    await db.query(
        `INSERT INTO notifications (user_id, kind, booking_id, message)
     SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::text[])`,
        [rows.map((r) => r.userId), rows.map((r) => r.kind), rows.map((r) => r.bookingId), rows.map((r) => r.message)],
    );
}

export async function listForUser(db: Db, userId: number, limit: number) {
    const { rows } = await db.query(
        `SELECT id, kind, booking_id AS "bookingId", message, created_at AS "createdAt", read_at AS "readAt"
     FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
        [userId, limit],
    );
    return rows;
}

export async function markAllRead(db: Db, userId: number, now: Date) {
    await db.query("UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL", [userId, now]);
}
