import type { Db } from "../db/pool.js";
import type { TrainerRow } from "../types/index.js";
import {
    BUFFER_MINUTES,
    FINISHED_STATUSES,
    SESSION_MINUTES,
    SLOT_GRID_MINUTES,
    TIME_ZONE,
} from "../config/constants.js";

// "Can this trainer take a session starting at <s>?" Written once and used by both the booking
// check (s = $2) and the slot list (s = a generated start time), so the rule cannot drift.
// $1 = zone id. Session length, buffer and time zone are our own constants, not user input.
const FINISHED = FINISHED_STATUSES.map((s) => `'${s}'`).join(",");
const eligibleWhere = (s: string) => `
    tr.zone_id = $1
    AND (${s} AT TIME ZONE '${TIME_ZONE}')::date = ((${s} + interval '${SESSION_MINUTES} minutes') AT TIME ZONE '${TIME_ZONE}')::date
    AND EXISTS (SELECT 1 FROM trainer_hours h WHERE h.trainer_id = tr.id AND h.weekday = EXTRACT(ISODOW FROM (${s} AT TIME ZONE '${TIME_ZONE}'))
        AND h.start_time <= (${s} AT TIME ZONE '${TIME_ZONE}')::time AND h.end_time >= (${s} AT TIME ZONE '${TIME_ZONE}')::time AND h.end_time >= ((${s} + interval '${SESSION_MINUTES} minutes') AT TIME ZONE '${TIME_ZONE}')::time)
    AND NOT EXISTS (SELECT 1 FROM trainer_time_off o WHERE o.trainer_id = tr.id AND tstzrange(o.starts_at, o.ends_at) && tstzrange(${s}, ${s} + interval '${SESSION_MINUTES} minutes'))
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trainer_id = tr.id AND b.status NOT IN (${FINISHED}) AND tstzrange(b.starts_at, b.busy_until, '[)') && tstzrange(${s}, ${s} + interval '${SESSION_MINUTES + BUFFER_MINUTES} minutes', '[)'))`;

export async function findEligible(db: Db, zoneId: number, startsAt: Date) {
    const { rows } = await db.query(
        `SELECT tr.id AS trainer_id, u.name, tr.home_lat AS lat, tr.home_lng AS lng,
            (SELECT count(*)::int FROM bookings b WHERE b.trainer_id = tr.id AND b.status <> 'cancelled' AND (b.starts_at AT TIME ZONE '${TIME_ZONE}')::date = ($2::timestamptz AT TIME ZONE '${TIME_ZONE}')::date) AS sessions_that_day
            FROM trainers tr JOIN users u ON u.id = tr.user_id
            WHERE ${eligibleWhere("$2::timestamptz")}`,
        [zoneId, startsAt],
    );
    return rows.map((r) => ({
        trainerId: r.trainer_id as number,
        name: r.name as string,
        sessionsThatDay: r.sessions_that_day as number,
        lat: r.lat as number,
        lng: r.lng as number,
    }));
}

// Grid start times in [from, to] where at least one trainer is free, with who is free.
export async function listSlotStarts(db: Db, zoneId: number, from: Date, to: Date, limit: number) {
    const { rows } = await db.query(
        `SELECT s.starts_at, array_agg(tr.id ORDER BY tr.id) AS trainer_ids
            FROM generate_series($2::timestamptz, $3::timestamptz, interval '${SLOT_GRID_MINUTES} minutes') AS s(starts_at)
            JOIN trainers tr ON ${eligibleWhere("s.starts_at")}
            GROUP BY s.starts_at ORDER BY s.starts_at LIMIT $4`,
        [zoneId, from, to, limit],
    );
    return rows.map((r) => ({ startsAt: r.starts_at as Date, trainerIds: r.trainer_ids as number[] }));
}

// Home coordinates come back only so the service can compute a distance; the mapper never forwards them.
export async function listZoneTrainers(db: Db, zoneId: number, customerId: number) {
    const { rows } = await db.query(
        `SELECT tr.id, u.name, tr.specialties, tr.experience_years, tr.home_lat, tr.home_lng, rt.average AS rating_average, rt.count AS rating_count,
            (SELECT count(*)::int FROM bookings b WHERE b.trainer_id = tr.id AND b.customer_id = $2 AND b.status = 'completed') AS sessions_with_customer
            FROM trainers tr
            JOIN users u ON u.id = tr.user_id
            CROSS JOIN LATERAL (SELECT round(avg(sr.customer_rating), 1)::float AS average, count(*)::int AS count FROM bookings b JOIN session_records sr ON sr.booking_id = b.id WHERE b.trainer_id = tr.id AND sr.customer_rating IS NOT NULL) rt
            WHERE tr.zone_id = $1 ORDER BY tr.id`,
        [zoneId, customerId],
    );
    return rows as TrainerRow[];
}

export async function listHours(db: Db, trainerId: number) {
    const { rows } = await db.query(
        `SELECT weekday, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"
            FROM trainer_hours WHERE trainer_id = $1 ORDER BY weekday`,
        [trainerId],
    );
    return rows as { weekday: number; start: string; end: string }[];
}

export async function zoneOf(db: Db, trainerId: number) {
    const { rows } = await db.query("SELECT zone_id FROM trainers WHERE id = $1", [trainerId]);
    return rows[0].zone_id as number;
}

// Two edits of the same trainer's hours queue here, so the delete-then-insert of one never meets the other's.
export const lockTrainer = (db: Db, trainerId: number) =>
    db.query("SELECT id FROM trainers WHERE id = $1 FOR UPDATE", [trainerId]);

export async function replaceHours(
    db: Db,
    trainerId: number,
    hours: { weekday: number; start: string; end: string }[],
) {
    await db.query("DELETE FROM trainer_hours WHERE trainer_id = $1", [trainerId]);
    for (const h of hours) {
        await db.query("INSERT INTO trainer_hours (trainer_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)", [
            trainerId,
            h.weekday,
            h.start,
            h.end,
        ]);
    }
}

export async function listTimeOff(db: Db, trainerId: number) {
    const { rows } = await db.query(
        `SELECT id, starts_at AS "startsAt", ends_at AS "endsAt", reason FROM trainer_time_off
            WHERE trainer_id = $1 AND ends_at > now() ORDER BY starts_at`,
        [trainerId],
    );
    return rows as { id: number; startsAt: Date; endsAt: Date; reason: string | null }[];
}

export async function insertTimeOff(db: Db, trainerId: number, startsAt: Date, endsAt: Date, reason: string | null) {
    const { rows } = await db.query(
        `INSERT INTO trainer_time_off (trainer_id, starts_at, ends_at, reason) VALUES ($1,$2,$3,$4)
            RETURNING id, starts_at AS "startsAt", ends_at AS "endsAt", reason`,
        [trainerId, startsAt, endsAt, reason],
    );
    return rows[0] as { id: number; startsAt: Date; endsAt: Date; reason: string | null };
}

export async function deleteTimeOff(db: Db, trainerId: number, id: number) {
    const { rowCount } = await db.query("DELETE FROM trainer_time_off WHERE id = $1 AND trainer_id = $2", [
        id,
        trainerId,
    ]);
    return rowCount === 1;
}
