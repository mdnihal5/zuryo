import { pool, type Db } from "../db/pool.js";
import * as notificationsQueries from "../queries/notifications.queries.js";
import type { NewNotification } from "../queries/notifications.queries.js";
import { formatIst } from "../lib/ist.js";
import { log } from "../lib/logger.js";
import type { BookingRow } from "../types/index.js";

export async function bookingAssigned(db: Db, b: BookingRow) {
    const when = formatIst(b.starts_at);
    await notificationsQueries.insertMany(db, [
        {
            userId: b.trainer_user_id,
            kind: "booking_assigned",
            bookingId: b.id,
            message: `New session with ${b.customer_name} on ${when}.`,
        },
        {
            userId: b.customer_id,
            kind: "booking_assigned",
            bookingId: b.id,
            message: `Booked: ${b.trainer_name} on ${when}.`,
        },
    ]);
    log.info("notification.written", {
        kind: "booking_assigned",
        bookingId: b.id,
        userIds: `${b.trainer_user_id},${b.customer_id}`,
    });
}

export async function paymentFailed(db: Db, b: BookingRow) {
    await notificationsQueries.insertMany(db, [
        {
            userId: b.customer_id,
            kind: "payment_failed",
            bookingId: b.id,
            message: `Payment for your session on ${formatIst(b.starts_at)} did not go through. The slot was released.`,
        },
    ]);
    log.info("notification.written", { kind: "payment_failed", bookingId: b.id });
}

export async function paymentRefunded(db: Db, b: BookingRow) {
    await notificationsQueries.insertMany(db, [
        {
            userId: b.customer_id,
            kind: "payment_refunded",
            bookingId: b.id,
            message: `Your payment arrived after the hold on ${formatIst(b.starts_at)} ended and the slot could not be kept. It is being refunded.`,
        },
    ]);
    log.info("notification.written", { kind: "payment_refunded", bookingId: b.id });
}

export async function bookingCancelled(db: Db, b: BookingRow) {
    const when = formatIst(b.starts_at);
    await notificationsQueries.insertMany(db, [
        {
            userId: b.trainer_user_id,
            kind: "booking_cancelled",
            bookingId: b.id,
            message: `Session with ${b.customer_name} on ${when} was cancelled.`,
        },
        {
            userId: b.customer_id,
            kind: "booking_cancelled",
            bookingId: b.id,
            message: `Your session on ${when} was cancelled.`,
        },
    ]);
    log.info("notification.written", {
        kind: "booking_cancelled",
        bookingId: b.id,
        userIds: `${b.trainer_user_id},${b.customer_id}`,
    });
}

export async function bookingRescheduled(db: Db, from: BookingRow, to: BookingRow) {
    const oldWhen = formatIst(from.starts_at);
    const newWhen = formatIst(to.starts_at);
    const rows: NewNotification[] = [
        {
            userId: to.customer_id,
            kind: "booking_rescheduled",
            bookingId: to.id,
            message: `Rescheduled from ${oldWhen} to ${newWhen} with ${to.trainer_name}.`,
        },
        {
            userId: to.trainer_user_id,
            kind: "booking_rescheduled",
            bookingId: to.id,
            message: `Session with ${to.customer_name} moved from ${oldWhen} to ${newWhen}.`,
        },
    ];
    if (from.trainer_user_id !== to.trainer_user_id) {
        rows.push({
            userId: from.trainer_user_id,
            kind: "booking_rescheduled",
            bookingId: from.id,
            message: `Session with ${from.customer_name} on ${oldWhen} was moved to another trainer.`,
        });
    }
    await notificationsQueries.insertMany(db, rows);
    log.info("notification.written", { kind: "booking_rescheduled", bookingId: to.id });
}

export const list = (userId: number) => notificationsQueries.listForUser(pool, userId, 50);
export const markAllRead = (userId: number) => notificationsQueries.markAllRead(pool, userId, new Date());
