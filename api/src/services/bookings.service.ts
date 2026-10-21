import type { PoolClient } from "pg";
import { pool, withTransaction } from "../db/pool.js";
import * as bookingsQueries from "../queries/bookings.queries.js";
import * as trainersQueries from "../queries/trainers.queries.js";
import * as packagesQueries from "../queries/packages.queries.js";
import * as paymentsQueries from "../queries/payments.queries.js";
import * as pricingQueries from "../queries/pricing.queries.js";
import * as usersQueries from "../queries/users.queries.js";
import * as notifications from "./notifications.service.js";
import { completeDueSessions } from "./sessions.service.js";
import { createOrder, expireHolds } from "./payments.service.js";
import {
    ALTERNATIVES_WINDOW_DAYS,
    ALTERNATIVE_SLOTS,
    BUFFER_MINUTES,
    FREE_CANCEL_HOURS,
    HOLD_MINUTES,
    SESSION_MINUTES,
    PAGE_DEFAULT,
} from "../config/constants.js";
import { computePrice } from "../lib/pricing.js";
import { rankTrainers } from "../lib/assignment.js";
import { addMinutes } from "../lib/ist.js";
import { alignUp, resolveStart } from "../lib/booking-time.js";
import { freeCancelDeadline } from "../lib/cancellation.js";
import { toBookingView } from "../lib/booking.mapper.js";
import { pageOf, type Cursor } from "../lib/cursor.js";
import { conflict, notFound, unprocessable } from "../lib/http-error.js";
import { assertSameRequest, requestHash } from "../lib/idempotency.js";
import { log } from "../lib/logger.js";
import type { AuthUser, BookingRow } from "../types/index.js";

type Placement = {
    customerId: number;
    mode: "instant" | "scheduled";
    startsAt: Date;
    preferredTrainerId: number | null;
    packageId: number | null;
    key: string;
    requestHash: string;
    rescheduledFrom: number | null;
};

// Creates a booking in the caller's transaction: package deduction (confirmed) or payment order
// (pending_payment holds the slot until the webhook). Returns the new booking id.
async function placeBooking(client: PoolClient, p: Placement): Promise<number> {
    const customer = await usersQueries.findProfileBasics(client, p.customerId);
    if (!customer || customer.zone_id === null || customer.lat === null || customer.lng === null) {
        throw unprocessable("CUSTOMER_LOCATION_MISSING", "Your account has no service zone or location yet.");
    }

    // Price is decided here from the stored rules. Nothing about money comes from the client.
    const price = computePrice(await pricingQueries.get(client), p.startsAt);
    const endsAt = addMinutes(p.startsAt, SESSION_MINUTES);
    const busyUntil = addMinutes(endsAt, BUFFER_MINUTES);

    await bookingsQueries.lockZone(client, customer.zone_id);
    const now = new Date();
    await expireHolds(client, now, "booking"); // a hold that ran out must not block this request

    if (p.packageId !== null) {
        const pkg = await packagesQueries.lockWithUsage(client, p.packageId, p.customerId);
        if (!pkg) throw notFound("PACKAGE_NOT_FOUND", "No package with that id.");
        if (pkg.used >= pkg.sessions_total) throw conflict("PACKAGE_EMPTY", "This package has no sessions left.");
    }

    const eligible = await trainersQueries.findEligible(client, customer.zone_id, p.startsAt);
    const { ranked, preferredEligible } = rankTrainers(
        eligible,
        { lat: customer.lat, lng: customer.lng },
        p.preferredTrainerId ?? undefined,
    );

    const lostRaceTo: number[] = [];
    for (const candidate of ranked) {
        const isPreferred = preferredEligible && candidate.trainerId === p.preferredTrainerId;
        const inserted = await bookingsQueries.insertBooking(client, {
            customerId: p.customerId,
            trainerId: candidate.trainerId,
            mode: p.mode,
            startsAt: p.startsAt,
            endsAt,
            busyUntil,
            rescheduledFrom: p.rescheduledFrom,
            status: p.packageId === null ? "pending_payment" : "confirmed",
            holdExpiresAt: p.packageId === null ? addMinutes(now, HOLD_MINUTES) : null,
            isPeak: price.isPeak,
            sessionPricePaise: price.sessionPricePaise,
            commissionPaise: price.commissionPaise,
            totalPaise: price.totalPaise,
            packageId: p.packageId,
            idempotencyKey: p.key,
            requestHash: p.requestHash,
            assignment: {
                preferredTrainerId: p.preferredTrainerId,
                preferredEligible,
                rule: isPreferred ? "preferred_trainer" : "fewest_sessions_then_nearest_then_id",
                candidates: ranked,
                lostRaceTo: [...lostRaceTo],
            },
        });
        if (inserted.result === "customer_busy") {
            throw conflict("CUSTOMER_ALREADY_BOOKED", "You already have a session that overlaps this time.");
        }
        if (inserted.result === "trainer_busy") {
            // Another request took this trainer between our check and our insert. Try the next one.
            lostRaceTo.push(candidate.trainerId);
            continue;
        }
        if (p.packageId !== null) {
            await packagesQueries.insertLedger(client, p.packageId, inserted.id, -1, "booking");
        } else {
            await createOrder(client, {
                purpose: "booking",
                bookingId: inserted.id,
                customerId: p.customerId,
                amountPaise: price.totalPaise,
            });
        }
        return inserted.id;
    }

    log.warn("booking.no_trainer", {
        customerId: p.customerId,
        zoneId: customer.zone_id,
        startsAt: p.startsAt.toISOString(),
        tried: ranked.length,
    });
    throw conflict("NO_TRAINER_AVAILABLE", "No trainer is available at that time.", {
        alternatives: await alternativeSlots(client, customer.zone_id, p.startsAt),
    });
}

async function alternativeSlots(client: PoolClient, zoneId: number, around: Date) {
    const from = alignUp(around);
    const until = addMinutes(from, ALTERNATIVES_WINDOW_DAYS * 24 * 60);
    const rules = await pricingQueries.get(client);
    const slots = await trainersQueries.listSlotStarts(client, zoneId, from, until, ALTERNATIVE_SLOTS + 1);
    return slots
        .filter((s) => s.startsAt.getTime() !== around.getTime())
        .slice(0, ALTERNATIVE_SLOTS)
        .map((s) => ({ startsAt: s.startsAt, ...computePrice(rules, s.startsAt) }));
}

// A retry returns the booking the first request made, before any other check.
async function replayIfSeen(customerId: number, key: string, hash: string, now: Date) {
    const existing = await bookingsQueries.findByKey(pool, customerId, key);
    if (!existing) return null;
    assertSameRequest(existing.request_hash, hash);
    return toBookingView(existing, now, "customer");
}

// A failure may be a lost race against a request with the same key; if that booking exists, return it.
async function replayOrThrow(err: unknown, customerId: number, key: string, hash: string, now: Date) {
    const winner = await replayIfSeen(customerId, key, hash, now);
    if (winner) return winner;
    throw err;
}

const notCancellable = () =>
    conflict("BOOKING_NOT_CANCELLABLE", "A session that has started or finished cannot be cancelled.");

// Money lines are written after the transaction commits, so a rolled-back booking never logs a charge or refund.
function logCharge(b: BookingRow) {
    if (b.package_id !== null) log.info("ledger.debit", { bookingId: b.id, packageId: b.package_id, delta: -1 });
}

function logRefund(b: BookingRow) {
    if (b.package_id !== null) log.info("ledger.credit", { bookingId: b.id, packageId: b.package_id, delta: 1 });
    else log.info("payment.refunded", { bookingId: b.id, amountPaise: b.total_paise });
}

type CreateInput = {
    mode: "instant" | "scheduled";
    startsAt?: Date;
    preferredTrainerId?: number;
    packageId?: number;
};

export async function createBooking(customer: AuthUser, input: CreateInput, key: string) {
    const now = new Date();

    const hash = requestHash({
        kind: "create",
        mode: input.mode,
        startsAt: input.startsAt?.toISOString(),
        preferredTrainerId: input.preferredTrainerId,
        packageId: input.packageId,
    });
    const replay = await replayIfSeen(customer.id, key, hash, now);
    if (replay) return replay;

    const startsAt = resolveStart(input.mode, input.startsAt, now);
    try {
        const row = await withTransaction(async (client) => {
            const id = await placeBooking(client, {
                customerId: customer.id,
                mode: input.mode,
                startsAt,
                preferredTrainerId: input.preferredTrainerId ?? null,
                packageId: input.packageId ?? null,
                key,
                requestHash: hash,
                rescheduledFrom: null,
            });
            const created = (await bookingsQueries.findForCustomer(client, id, customer.id))!;
            // A booking waiting for payment is not a session yet: the trainer hears about it when the webhook confirms it.
            if (created.status === "confirmed") await notifications.bookingAssigned(client, created);
            return created;
        });
        log.info("booking.created", {
            bookingId: row.id,
            customerId: customer.id,
            trainerId: row.trainer_id,
            totalPaise: row.total_paise,
            via: row.package_id ? "package" : "single",
        });
        logCharge(row);
        return toBookingView(row, now, "customer");
    } catch (err) {
        return replayOrThrow(err, customer.id, key, hash, now);
    }
}

// Cancels inside the caller's transaction. Returns false when someone else cancelled first.
// The refund runs only for the request whose conditional UPDATE actually changed the row.
async function cancelInTx(client: PoolClient, row: BookingRow, now: Date, reason: "customer" | "rescheduled") {
    const cancelled = await bookingsQueries.cancelConfirmed(client, row.id, now, reason);
    if (!cancelled) return false;
    if (now <= freeCancelDeadline(row.starts_at)) {
        if (row.package_id !== null) await packagesQueries.insertLedger(client, row.package_id, row.id, 1, "refund");
        else await paymentsQueries.refundForBooking(client, row.id);
    }
    return true;
}

export async function cancelBooking(customer: AuthUser, id: number) {
    const now = new Date();
    await completeDueSessions(now);
    const result = await withTransaction(async (client) => {
        const row = await bookingsQueries.findForCustomer(client, id, customer.id);
        if (!row) throw notFound("BOOKING_NOT_FOUND", "No booking with that id.");
        if (row.status !== "cancelled" && row.status !== "confirmed") {
            throw notCancellable();
        }
        // Cancelling twice is not an error; the second call just shows the cancelled booking.
        const changed = row.status === "confirmed" && (await cancelInTx(client, row, now, "customer"));
        const fresh = (await bookingsQueries.findForCustomer(client, id, customer.id))!;
        if (fresh.status !== "cancelled") {
            throw notCancellable();
        }
        if (changed) await notifications.bookingCancelled(client, fresh);
        return { fresh, changed };
    });
    if (result.changed) {
        log.info("booking.cancelled", { bookingId: id, customerId: customer.id, refunded: result.fresh.refunded });
        if (result.fresh.refunded) logRefund(result.fresh);
    }
    return toBookingView(result.fresh, now, "customer");
}

export type RescheduleInput = { startsAt: Date; preferredTrainerId?: number };

// Reschedule = cancel the old booking and create a new one linked by rescheduled_from, all or nothing.
// If no trainer is free at the new time, the old booking stays exactly as it was.
export async function rescheduleBooking(customer: AuthUser, id: number, input: RescheduleInput, key: string) {
    const now = new Date();
    await completeDueSessions(now);

    const hash = requestHash({
        kind: "reschedule",
        bookingId: id,
        startsAt: input.startsAt.toISOString(),
        preferredTrainerId: input.preferredTrainerId,
    });
    const replay = await replayIfSeen(customer.id, key, hash, now);
    if (replay) return replay;

    const startsAt = resolveStart("scheduled", input.startsAt, now);
    try {
        const { old, created } = await withTransaction(async (client) => {
            const old = await bookingsQueries.findForCustomer(client, id, customer.id);
            if (!old) throw notFound("BOOKING_NOT_FOUND", "No booking with that id.");
            if (old.status !== "confirmed")
                throw conflict("BOOKING_NOT_RESCHEDULABLE", "Only an upcoming booking can be rescheduled.");
            if (now > freeCancelDeadline(old.starts_at)) {
                throw conflict(
                    "RESCHEDULE_TOO_LATE",
                    `Rescheduling is only possible until ${FREE_CANCEL_HOURS} hours before the start.`,
                );
            }
            if (!(await cancelInTx(client, old, now, "rescheduled"))) {
                throw conflict("BOOKING_NOT_RESCHEDULABLE", "This booking was just changed. Reload and try again.");
            }
            const newId = await placeBooking(client, {
                customerId: customer.id,
                mode: "scheduled",
                startsAt,
                preferredTrainerId: input.preferredTrainerId ?? null,
                packageId: old.package_id,
                key,
                requestHash: hash,
                rescheduledFrom: old.id,
            });
            const created = (await bookingsQueries.findForCustomer(client, newId, customer.id))!;
            if (created.status === "confirmed") await notifications.bookingRescheduled(client, old, created);
            else await notifications.bookingCancelled(client, old);
            return { old, created };
        });
        log.info("booking.rescheduled", { fromBookingId: old.id, toBookingId: created.id, customerId: customer.id });
        logRefund(old);
        logCharge(created);
        return toBookingView(created, now, "customer");
    } catch (err) {
        return replayOrThrow(err, customer.id, key, hash, now);
    }
}

type ListQuery = { view?: "upcoming" | "history"; limit?: number; cursor: Cursor | null };

export async function listMine(customer: AuthUser, q: ListQuery) {
    const now = new Date();
    await completeDueSessions(now);
    await expireHolds(pool, now);
    const limit = q.limit ?? PAGE_DEFAULT;
    const rows = await bookingsQueries.listForCustomer(
        pool,
        customer.id,
        { view: q.view },
        { limit, cursor: q.cursor },
    );
    return pageOf(rows, limit, (r) => toBookingView(r, now, "customer"));
}

export async function getMine(customer: AuthUser, id: number) {
    const now = new Date();
    await completeDueSessions(now);
    await expireHolds(pool, now);
    const row = await bookingsQueries.findForCustomer(pool, id, customer.id);
    if (!row) throw notFound("BOOKING_NOT_FOUND", "No booking with that id.");
    return toBookingView(row, now, "customer");
}
