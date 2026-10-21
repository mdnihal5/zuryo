import { pool, withTransaction } from "../db/pool.js";
import * as bookingsQueries from "../queries/bookings.queries.js";
import * as trainersQueries from "../queries/trainers.queries.js";
import { completeDueSessions } from "./sessions.service.js";
import { PAGE_DEFAULT } from "../config/constants.js";
import { toBookingView } from "../lib/booking.mapper.js";
import { pageOf, type Cursor } from "../lib/cursor.js";
import { conflict, notFound, unprocessable } from "../lib/http-error.js";
import type { AuthUser } from "../types/index.js";

export async function listSessions(
    trainer: AuthUser,
    q: { view?: "upcoming" | "history"; limit?: number; cursor: Cursor | null },
) {
    const now = new Date();
    await completeDueSessions(now);
    const limit = q.limit ?? PAGE_DEFAULT;
    const rows = await bookingsQueries.listForTrainer(
        pool,
        trainer.trainerId!,
        { view: q.view },
        { limit, cursor: q.cursor },
    );
    return pageOf(rows, limit, (r) => toBookingView(r, now, "trainer"));
}

export async function getSession(trainer: AuthUser, id: number) {
    const now = new Date();
    await completeDueSessions(now);
    const row = await bookingsQueries.findForTrainer(pool, id, trainer.trainerId!);
    if (!row) throw notFound("BOOKING_NOT_FOUND", "No session with that id.");
    return toBookingView(row, now, "trainer");
}

export async function getAvailability(trainer: AuthUser) {
    const [hours, timeOff] = await Promise.all([
        trainersQueries.listHours(pool, trainer.trainerId!),
        trainersQueries.listTimeOff(pool, trainer.trainerId!),
    ]);
    return { hours, timeOff };
}

// Replaces the weekly hours. Sessions already booked are not touched; only new bookings follow the new hours.
export async function setHours(trainer: AuthUser, hours: { weekday: number; start: string; end: string }[]) {
    await withTransaction(async (client) => {
        await trainersQueries.lockTrainer(client, trainer.trainerId!);
        await trainersQueries.replaceHours(client, trainer.trainerId!, hours);
    });
    return getAvailability(trainer);
}

export async function addTimeOff(trainer: AuthUser, startsAt: Date, endsAt: Date, reason: string | null) {
    if (endsAt <= startsAt) throw unprocessable("INVALID_RANGE", "endsAt must be after startsAt.");
    // Same zone lock as booking: a booking cannot slip in between the check below and the insert.
    return withTransaction(async (client) => {
        await bookingsQueries.lockZone(client, await trainersQueries.zoneOf(client, trainer.trainerId!));
        if (await bookingsQueries.hasActiveBookingBetween(client, trainer.trainerId!, startsAt, endsAt)) {
            throw conflict("TIME_OFF_HAS_BOOKINGS", "You have sessions in that period. They must be handled first.");
        }
        return trainersQueries.insertTimeOff(client, trainer.trainerId!, startsAt, endsAt, reason);
    });
}

export async function removeTimeOff(trainer: AuthUser, id: number) {
    if (!(await trainersQueries.deleteTimeOff(pool, trainer.trainerId!, id))) {
        throw notFound("TIME_OFF_NOT_FOUND", "No time off with that id.");
    }
}
