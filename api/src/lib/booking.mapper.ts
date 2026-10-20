import { addMinutes } from "./ist.js";
import { freeCancelDeadline } from "./cancellation.js";
import { sessionPhase } from "./session-phase.js";
import { WARNING_MINUTES } from "../config/constants.js";
import { config } from "../config/index.js";
import type { BookingRow } from "../types/index.js";

// The hosted checkout page of the (mock) gateway. A real gateway would give us this URL when the order is created.
export const checkoutUrl = (providerOrderId: string) => `${config.clientUrl}/pay/${providerOrderId}`;

export type Audience = "customer" | "trainer" | "admin";

// The only place a booking row becomes JSON. Customers never see the assignment decision;
// trainers see the customer's name only.
export function toBookingView(r: BookingRow, now: Date, audience: Audience) {
    const phase = sessionPhase({ status: r.status, startedAt: r.started_at, sessionEndsAt: r.session_ends_at }, now);
    const freeCancelUntil = freeCancelDeadline(r.starts_at);
    return {
        id: r.id,
        mode: r.mode,
        status: r.status,
        phase,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        trainer: { id: r.trainer_id, name: r.trainer_name },
        ...(audience !== "customer" && { customer: { id: r.customer_id, name: r.customer_name } }),
        price: {
            isPeak: r.is_peak,
            sessionPricePaise: r.session_price_paise,
            commissionPaise: r.commission_paise,
            totalPaise: r.total_paise,
        },
        payment: {
            method: r.package_id ? "package" : "single",
            packageId: r.package_id,
            refunded: r.refunded,
            status: r.order_status,
            providerOrderId: r.provider_order_id,
            checkoutUrl: r.order_status === "created" ? checkoutUrl(r.provider_order_id!) : null,
            holdExpiresAt: r.status === "pending_payment" ? r.hold_expires_at : null,
        },
        session: {
            startedAt: r.started_at,
            endsAt: r.session_ends_at,
            warningAt: r.started_at ? addMinutes(r.started_at, WARNING_MINUTES) : null,
            completedAt: r.completed_at,
        },
        cancellation: {
            cancelledAt: r.cancelled_at,
            reason: r.cancel_reason,
            freeCancelUntil,
            canCancelFree: r.status === "confirmed" && now <= freeCancelUntil,
        },
        feedback: r.customer_rating === null ? null : { rating: r.customer_rating, comment: r.customer_comment },
        rescheduledFromId: r.rescheduled_from,
        rescheduledToId: r.rescheduled_to,
        createdAt: r.created_at,
        ...(audience === "admin" && { assignment: r.assignment }),
    };
}

export type BookingView = ReturnType<typeof toBookingView>;
