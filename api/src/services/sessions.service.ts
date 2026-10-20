import { pool } from "../db/pool.js";
import * as bookingsQueries from "../queries/bookings.queries.js";
import * as recordsQueries from "../queries/session-records.queries.js";
import { SESSION_MINUTES, EARLY_START_MINUTES } from "../config/constants.js";
import { addMinutes } from "../lib/ist.js";
import { conflict, notFound } from "../lib/http-error.js";
import { toBookingView } from "../lib/booking.mapper.js";
import { log } from "../lib/logger.js";
import type { FeedbackInput } from "../schemas/booking.schema.js";
import type { AuthUser, Exercise } from "../types/index.js";

// Called before every read that shows booking status, and by the sweep timer. The database is the
// truth: a session is complete once now >= session_ends_at, whether or not anything noticed.
export async function completeDueSessions(now = new Date(), by: "read" | "sweep" = "read") {
    const done = await bookingsQueries.completeDue(pool, now, "Session completed.");
    for (const id of done) {
        log.info("session.completed", { bookingId: id, by });
        log.info("notification.written", { kind: "session_completed", bookingId: id });
    }
    return done.length;
}

export async function startSession(trainer: AuthUser, id: number) {
    const now = new Date();
    await completeDueSessions(now);
    const row = await bookingsQueries.findForTrainer(pool, id, trainer.trainerId!);
    if (!row) throw notFound("BOOKING_NOT_FOUND", "No session with that id.");

    // A second tap on Start (or a retry) just returns the running session.
    if (row.status === "confirmed") {
        if (now < addMinutes(row.starts_at, -EARLY_START_MINUTES)) {
            throw conflict(
                "TOO_EARLY",
                `A session can start at most ${EARLY_START_MINUTES} minutes before its start time.`,
            );
        }
        await bookingsQueries.markStarted(pool, id, trainer.trainerId!, now, addMinutes(now, SESSION_MINUTES));
        log.info("session.started", { bookingId: id, trainerId: trainer.trainerId });
    } else if (row.status !== "in_progress") {
        throw conflict("SESSION_NOT_STARTABLE", `A ${row.status} session cannot be started.`);
    }
    const fresh = (await bookingsQueries.findForTrainer(pool, id, trainer.trainerId!))!;
    if (fresh.status !== "in_progress")
        throw conflict("SESSION_NOT_STARTABLE", `A ${fresh.status} session cannot be started.`);
    return toBookingView(fresh, new Date(), "trainer");
}

export type RecordInput = {
    exercises: Exercise[];
    durationMinutes: number;
    trainerNotes: string | null;
    suggestedNextWorkout: string | null;
};

export async function saveTrainerRecord(trainer: AuthUser, id: number, input: RecordInput) {
    await completeDueSessions();
    const row = await bookingsQueries.findForTrainer(pool, id, trainer.trainerId!);
    if (!row) throw notFound("BOOKING_NOT_FOUND", "No session with that id.");
    if (row.status !== "completed")
        throw conflict("SESSION_NOT_COMPLETED", "The record can be written once the session is complete.");
    await recordsQueries.upsertTrainerPart(pool, id, input);
    return recordsQueries.find(pool, id);
}

export async function saveCustomerFeedback(customer: AuthUser, id: number, feedback: FeedbackInput) {
    await completeDueSessions();
    const row = await bookingsQueries.findForCustomer(pool, id, customer.id);
    if (!row) throw notFound("BOOKING_NOT_FOUND", "No booking with that id.");
    if (row.status !== "completed")
        throw conflict("SESSION_NOT_COMPLETED", "Feedback can be left once the session is complete.");
    await recordsQueries.upsertFeedback(pool, id, feedback.rating, feedback.comment || null);
    return recordsQueries.find(pool, id);
}

export async function getRecord(user: AuthUser, id: number) {
    const row =
        user.role === "trainer"
            ? await bookingsQueries.findForTrainer(pool, id, user.trainerId!)
            : await bookingsQueries.findForCustomer(pool, id, user.id);
    if (!row) throw notFound("BOOKING_NOT_FOUND", "No booking with that id.");
    return recordsQueries.find(pool, id);
}
