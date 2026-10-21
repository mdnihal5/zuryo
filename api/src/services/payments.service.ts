import { randomBytes } from "node:crypto";
import { pool, withTransaction, type Db } from "../db/pool.js";
import type { PoolClient } from "pg";
import * as paymentsQueries from "../queries/payments.queries.js";
import * as bookingsQueries from "../queries/bookings.queries.js";
import * as notifications from "./notifications.service.js";
import * as mockpay from "./mockpay.service.js";
import { unprocessable } from "../lib/http-error.js";
import { log } from "../lib/logger.js";
import type { WebhookEvent } from "../schemas/payments.schema.js";

type NewOrder =
    | { purpose: "booking"; bookingId: number; customerId: number; amountPaise: number }
    | { purpose: "package"; packageId: number; customerId: number; amountPaise: number };

// Creates our order row and asks the gateway to create its own. Swapping to a real gateway replaces the
// mockpay.registerOrder call with an HTTPS call; see "Swapping MockPay for Cashfree" in docs/api.md.
export async function createOrder(db: Db, o: NewOrder) {
    const providerOrderId = `order_${randomBytes(9).toString("hex")}`;
    const bookingId = o.purpose === "booking" ? o.bookingId : null;
    const packageId = o.purpose === "package" ? o.packageId : null;
    await mockpay.registerOrder(db, {
        providerOrderId,
        amountPaise: o.amountPaise,
        currency: "INR",
        returnPath: bookingId ? `/bookings/${bookingId}/status` : "/bookings",
    });
    await paymentsQueries.insertOrder(db, {
        purpose: o.purpose,
        bookingId,
        packageId,
        customerId: o.customerId,
        amountPaise: o.amountPaise,
        providerOrderId,
    });
    log.info("payment.order_created", { providerOrderId, purpose: o.purpose, amountPaise: o.amountPaise });
}

// Releases the slot of every hold that ran out. Called before anything that reads or sells slots.
export async function expireHolds(db: Db = pool, now = new Date(), by: "read" | "sweep" | "booking" = "read") {
    const ids = await bookingsQueries.expireDueHolds(db, now);
    for (const id of ids) log.info("payment.hold_expired", { bookingId: id, by });
    return ids.length;
}

type Outcome = "confirmed" | "refunded" | "failed" | "replay" | "ignored";

// The only place money turns into a confirmed booking or an active package. The signature has already been
// verified by the route; this checks the event against what WE stored, then changes state in one transaction.
export async function handleWebhook(event: WebhookEvent) {
    const { order, payment } = event.data;
    const stored = await paymentsQueries.findByProviderOrderId(pool, order.order_id);
    if (!stored) {
        // Acknowledge anyway: a retry cannot make an unknown order known.
        log.warn("payment.webhook_unknown_order", { providerOrderId: order.order_id });
        return { result: "ignored" as Outcome };
    }
    const amounts = [order.order_amount_paise, payment.payment_amount_paise];
    const currencies = [order.order_currency, payment.payment_currency];
    if (amounts.some((a) => a !== stored.amount_paise) || currencies.some((c) => c !== stored.currency)) {
        log.error("payment.webhook_mismatch", {
            providerOrderId: stored.provider_order_id,
            expectedPaise: stored.amount_paise,
            gotPaise: payment.payment_amount_paise,
        });
        throw unprocessable("PAYMENT_MISMATCH", "The event does not match the order.");
    }

    const now = new Date();
    const result = await withTransaction((client) =>
        payment.payment_status === "SUCCESS"
            ? settleSuccess(client, stored, payment.payment_id, now)
            : settleFailure(client, stored),
    );
    log.info("payment.webhook", { providerOrderId: stored.provider_order_id, bookingId: stored.booking_id, result });
    return { result };
}

// Locks the booking (or package) and then the order, always in that order, so this and the expiry
// statement can never wait on each other. A second webhook for the same order waits here, then sees the result.
async function lockAll(client: PoolClient, stored: paymentsQueries.OrderRow) {
    const ownerStatus = stored.booking_id
        ? await paymentsQueries.lockBooking(client, stored.booking_id)
        : await paymentsQueries.lockPackage(client, stored.package_id!);
    return { ownerStatus, order: await paymentsQueries.lockOrder(client, stored.provider_order_id) };
}

async function settleSuccess(
    client: PoolClient,
    stored: paymentsQueries.OrderRow,
    paymentId: string,
    now: Date,
): Promise<Outcome> {
    // A late payment may re-take a slot, so it queues behind bookings in the zone (zone lock first, like booking).
    if (stored.booking_id)
        await bookingsQueries.lockZone(client, await bookingsQueries.zoneOfBooking(client, stored.booking_id));
    const { ownerStatus, order } = await lockAll(client, stored);
    if (order.status === "paid" || order.status === "refunded") return "replay";

    if (order.purpose === "package") {
        await markPaid(client, order.id, paymentId, now);
        await paymentsQueries.activatePackage(client, order.package_id!);
        return "confirmed";
    }

    const bookingId = order.booking_id!;
    const payable = order.status === "created" || order.status === "expired";
    // pending_payment: the normal case. expired: the money came after the hold ended, so the slot is
    // re-taken only if nobody else has it.
    const confirmed =
        payable &&
        (ownerStatus === "pending_payment"
            ? await bookingsQueries.confirmPending(client, bookingId)
            : ownerStatus === "expired" && (await bookingsQueries.reconfirmExpired(client, bookingId, now)));
    const booking = (await bookingsQueries.findForAdmin(client, bookingId))!;
    if (confirmed) {
        await markPaid(client, order.id, paymentId, now);
        await notifications.bookingAssigned(client, booking);
        return "confirmed";
    }
    await paymentsQueries.markRefundedAfterLatePayment(client, order.id, paymentId, now);
    await notifications.paymentRefunded(client, booking);
    return "refunded";
}

async function markPaid(client: PoolClient, orderId: number, paymentId: string, now: Date) {
    if (!(await paymentsQueries.markPaid(client, orderId, paymentId, now))) {
        throw new Error("payment order changed while locked");
    }
}

async function settleFailure(client: PoolClient, stored: paymentsQueries.OrderRow): Promise<Outcome> {
    const { order } = await lockAll(client, stored);
    if (order.status !== "created") return "replay";
    await paymentsQueries.markFailed(client, order.id);
    if (order.booking_id) {
        await bookingsQueries.failPending(client, order.booking_id);
        await notifications.paymentFailed(client, (await bookingsQueries.findForAdmin(client, order.booking_id))!);
    }
    return "failed";
}
