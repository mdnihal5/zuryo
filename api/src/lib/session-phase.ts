import { WARNING_MINUTES } from "../config/constants.js";
import { addMinutes } from "./ist.js";

export type Phase = "upcoming" | "running" | "warning" | "completed" | "cancelled";

// The phase is derived from stored server times and the server's clock, never from a client timer.
export function sessionPhase(
    b: { status: string; startedAt: Date | null; sessionEndsAt: Date | null },
    now: Date,
): Phase {
    if (b.status === "cancelled" || b.status === "payment_failed" || b.status === "expired") return "cancelled";
    if (b.status === "completed") return "completed";
    if (b.status === "pending_payment" || b.status === "confirmed" || !b.startedAt || !b.sessionEndsAt)
        return "upcoming";
    if (now >= b.sessionEndsAt) return "completed";
    return now >= addMinutes(b.startedAt, WARNING_MINUTES) ? "warning" : "running";
}
