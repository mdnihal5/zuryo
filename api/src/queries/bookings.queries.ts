import type { Db } from "../db/pool.js";
import { FINISHED_STATUSES } from "../config/constants.js";
import type { AssignmentDecision, BookingRow } from "../types/index.js";
import type { Cursor } from "../lib/cursor.js";

const SELECT = `
  SELECT b.*, cu.name AS customer_name, t.user_id AS trainer_user_id, tu.name AS trainer_name,
    sr.customer_rating, sr.customer_comment,
    (SELECT r.id FROM bookings r WHERE r.rescheduled_from = b.id LIMIT 1) AS rescheduled_to,
    (COALESCE(o.status = 'refunded', false)
       OR EXISTS (SELECT 1 FROM package_ledger l WHERE l.booking_id = b.id AND l.reason = 'refund')) AS refunded,
    o.status AS order_status, o.provider_order_id
  FROM bookings b
  JOIN users cu ON cu.id = b.customer_id
  JOIN trainers t ON t.id = b.trainer_id
  JOIN users tu ON tu.id = t.user_id
  LEFT JOIN payment_orders o ON o.booking_id = b.id
  LEFT JOIN session_records sr ON sr.booking_id = b.id`;

// A trainer only ever sees bookings that were paid for (or covered by a package).
const NOT_FOR_TRAINERS = "b.status NOT IN ('pending_payment', 'payment_failed', 'expired')";

const findWhere = async (db: Db, where: string, params: unknown[]) =>
    ((await db.query(`${SELECT} WHERE ${where}`, params)).rows[0] as BookingRow | undefined) ?? null;

// Every lookup carries its owner in the WHERE clause, so a miss is a 404 and there is no branch to forget.
export const findForCustomer = (db: Db, id: number, customerId: number) =>
    findWhere(db, "b.id = $1 AND b.customer_id = $2", [id, customerId]);
export const findForTrainer = (db: Db, id: number, trainerId: number) =>
    findWhere(db, `b.id = $1 AND b.trainer_id = $2 AND ${NOT_FOR_TRAINERS}`, [id, trainerId]);
export const findForAdmin = (db: Db, id: number) => findWhere(db, "b.id = $1", [id]);
export const findByKey = (db: Db, customerId: number, key: string) =>
    findWhere(db, "b.customer_id = $1 AND b.idempotency_key = $2", [customerId, key]);

type NewBooking = {
    customerId: number;
    trainerId: number;
    mode: "instant" | "scheduled";
    startsAt: Date;
    endsAt: Date;
    busyUntil: Date;
    rescheduledFrom: number | null;
    status: "pending_payment" | "confirmed";
    holdExpiresAt: Date | null;
    isPeak: boolean;
    sessionPricePaise: number;
    commissionPaise: number;
    totalPaise: number;
    packageId: number | null;
    idempotencyKey: string;
    requestHash: string;
    assignment: AssignmentDecision;
};

const ZONE_LOCK = 1;

// Serialises bookings per zone so eligibility sees earlier ones as committed; released at commit/rollback.
// Without it, concurrent inserts for one trainer deadlocked on each other (1 s per victim).
export const lockZone = (db: Db, zoneId: number) =>
    db.query("SELECT pg_advisory_xact_lock($1, $2)", [ZONE_LOCK, zoneId]);

// Tries to insert. The exclusion constraints decide who wins a race; the loser gets a typed result
// instead of an exception. A savepoint keeps the surrounding transaction usable after the failure.
export async function insertBooking(db: Db, b: NewBooking) {
    await db.query("SAVEPOINT insert_booking");
    try {
        const { rows } = await db.query(
            `INSERT INTO bookings (customer_id, trainer_id, mode, starts_at, ends_at, busy_until, rescheduled_from,
         is_peak, session_price_paise, commission_paise, total_paise, package_id, idempotency_key, request_hash, assignment,
         status, hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
            [
                b.customerId,
                b.trainerId,
                b.mode,
                b.startsAt,
                b.endsAt,
                b.busyUntil,
                b.rescheduledFrom,
                b.isPeak,
                b.sessionPricePaise,
                b.commissionPaise,
                b.totalPaise,
                b.packageId,
                b.idempotencyKey,
                b.requestHash,
                JSON.stringify(b.assignment),
                b.status,
                b.holdExpiresAt,
            ],
        );
        await db.query("RELEASE SAVEPOINT insert_booking");
        return { result: "ok" as const, id: rows[0].id as number };
    } catch (err) {
        await db.query("ROLLBACK TO SAVEPOINT insert_booking");
        const e = err as { code?: string; constraint?: string };
        if (e.code === "23P01" && e.constraint === "bookings_customer_no_overlap")
            return { result: "customer_busy" as const };
        if (e.code === "23P01" || e.code === "40P01") return { result: "trainer_busy" as const };
        throw err;
    }
}

export type Page = { limit: number; cursor: Cursor | null };
type Filters = {
    customerId?: number;
    trainerId?: number;
    view?: "upcoming" | "history";
    status?: string;
    mode?: string;
    from?: Date;
    to?: Date;
};

async function list(db: Db, f: Filters, page: Page): Promise<BookingRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
        params.push(value);
        where.push(sql.replace("?", `$${params.length}`));
    };
    if (f.customerId !== undefined) add("b.customer_id = ?", f.customerId);
    if (f.trainerId !== undefined) {
        add("b.trainer_id = ?", f.trainerId);
        where.push(NOT_FOR_TRAINERS);
    }
    if (f.status) add("b.status = ?", f.status);
    if (f.mode) add("b.mode = ?", f.mode);
    if (f.from) add("b.starts_at >= ?", f.from);
    if (f.to) add("b.starts_at < ?", f.to);
    // A customer also sees the booking they are still paying for; it is not a session yet for anyone else.
    if (f.view === "upcoming")
        where.push(
            f.customerId !== undefined
                ? "b.status IN ('pending_payment','confirmed','in_progress')"
                : "b.status IN ('confirmed','in_progress')",
        );
    if (f.view === "history") where.push("b.status IN ('completed','cancelled','payment_failed','expired')");

    const asc = f.view === "upcoming";
    if (page.cursor) {
        params.push(page.cursor.startsAt, page.cursor.id);
        where.push(`(b.starts_at, b.id) ${asc ? ">" : "<"} ($${params.length - 1}, $${params.length})`);
    }
    params.push(page.limit + 1); // one extra row tells the caller whether there is a next page
    const order = asc ? "ASC" : "DESC";
    const sql = `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY b.starts_at ${order}, b.id ${order} LIMIT $${params.length}`;
    return (await db.query(sql, params)).rows;
}

export const listForCustomer = (db: Db, customerId: number, f: Pick<Filters, "view">, page: Page) =>
    list(db, { customerId, ...f }, page);
export const listForTrainer = (db: Db, trainerId: number, f: Pick<Filters, "view">, page: Page) =>
    list(db, { trainerId, ...f }, page);
export const listForAdmin = (db: Db, f: Omit<Filters, "view">, page: Page) => list(db, f, page);

export async function markStarted(db: Db, id: number, trainerId: number, now: Date, sessionEndsAt: Date) {
    const { rowCount } = await db.query(
        `UPDATE bookings SET status = 'in_progress', started_at = $3, session_ends_at = $4
     WHERE id = $1 AND trainer_id = $2 AND status = 'confirmed'`,
        [id, trainerId, now, sessionEndsAt],
    );
    return rowCount === 1;
}

// Conditional on status: when two requests race, only one gets rowCount = 1 and does the follow-up work.
export async function cancelConfirmed(db: Db, id: number, now: Date, reason: "customer" | "rescheduled") {
    const { rowCount } = await db.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3
     WHERE id = $1 AND status = 'confirmed'`,
        [id, now, reason],
    );
    return rowCount === 1;
}

// Completes due sessions and writes their notifications in one statement; only the UPDATE that changes a
// row gets it in RETURNING, so racing callers cannot double-notify.
export async function completeDue(db: Db, now: Date, message: string) {
    const { rows } = await db.query(
        `WITH done AS (
       UPDATE bookings b SET status = 'completed', completed_at = b.session_ends_at
       WHERE b.status = 'in_progress' AND b.session_ends_at <= $1
       RETURNING b.id, b.customer_id, b.trainer_id
     ), written AS (
       INSERT INTO notifications (user_id, kind, booking_id, message)
       SELECT u.user_id, 'session_completed', done.id, $2
       FROM done
       CROSS JOIN LATERAL (VALUES (done.customer_id), ((SELECT user_id FROM trainers WHERE id = done.trainer_id))) AS u(user_id)
     )
     SELECT id FROM done`,
        [now, message],
    );
    return rows.map((r) => r.id as number);
}

// A hold that ran out frees its slot: the booking and its order both become 'expired' in one statement.
// Conditional on status, so a webhook confirming the booking at the same moment simply wins (the row is locked,
// then no longer matches). Safe to call from any read, from many requests, and from the sweep.
export async function expireDueHolds(db: Db, now: Date) {
    const { rows } = await db.query(
        `WITH due AS (
       UPDATE bookings SET status = 'expired'
       WHERE status = 'pending_payment' AND hold_expires_at <= $1 RETURNING id
     ), orders AS (
       UPDATE payment_orders o SET status = 'expired' FROM due WHERE o.booking_id = due.id AND o.status = 'created'
     )
     SELECT id FROM due`,
        [now],
    );
    return rows.map((r) => r.id as number);
}

// Moves a booking out of 'pending_payment' once the gateway reports the result. false = it was not pending.
export async function confirmPending(db: Db, id: number) {
    const { rowCount } = await db.query(
        "UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = $1 AND status = 'pending_payment'",
        [id],
    );
    return rowCount === 1;
}

export async function failPending(db: Db, id: number) {
    const { rowCount } = await db.query(
        "UPDATE bookings SET status = 'payment_failed' WHERE id = $1 AND status = 'pending_payment'",
        [id],
    );
    return rowCount === 1;
}

export async function zoneOfBooking(db: Db, id: number) {
    const { rows } = await db.query(
        "SELECT t.zone_id FROM bookings b JOIN trainers t ON t.id = b.trainer_id WHERE b.id = $1",
        [id],
    );
    return rows[0].zone_id as number;
}

// A late payment for an expired hold: confirm only if the slot is still free (for the trainer and the customer)
// and the session has not started. Runs under the zone lock, like booking; the exclusion constraints stay as
// the backstop, and a savepoint keeps the transaction usable if they fire.
export async function reconfirmExpired(db: Db, id: number, now: Date) {
    const { rowCount: clashes } = await db.query(
        `SELECT 1 FROM bookings b JOIN bookings o ON o.id <> b.id AND o.status <> ALL($2)
       AND ((o.trainer_id = b.trainer_id
             AND tstzrange(o.starts_at, o.busy_until, '[)') && tstzrange(b.starts_at, b.busy_until, '[)'))
         OR (o.customer_id = b.customer_id
             AND tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')))
     WHERE b.id = $1 LIMIT 1`,
        [id, [...FINISHED_STATUSES]],
    );
    if (clashes) return false;
    await db.query("SAVEPOINT reconfirm");
    try {
        const { rowCount } = await db.query(
            "UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL WHERE id = $1 AND status = 'expired' AND starts_at > $2",
            [id, now],
        );
        await db.query("RELEASE SAVEPOINT reconfirm");
        return rowCount === 1;
    } catch (err) {
        await db.query("ROLLBACK TO SAVEPOINT reconfirm");
        const code = (err as { code?: string }).code;
        if (code === "23P01" || code === "40P01") return false;
        throw err;
    }
}

export async function hasActiveBookingBetween(db: Db, trainerId: number, from: Date, to: Date) {
    const { rowCount } = await db.query(
        `SELECT 1 FROM bookings WHERE trainer_id = $1 AND status <> ALL($4)
       AND tstzrange(starts_at, busy_until, '[)') && tstzrange($2, $3, '[)') LIMIT 1`,
        [trainerId, from, to, [...FINISHED_STATUSES]],
    );
    return (rowCount ?? 0) > 0;
}
