import { MAX_ADVANCE_DAYS, SLOT_GRID_MINUTES, TRAVEL_MINUTES } from "../config/constants.js";
import { addMinutes } from "./ist.js";
import { unprocessable } from "./http-error.js";

const GRID_MS = SLOT_GRID_MINUTES * 60_000;
// IST is UTC+5:30, a multiple of 30 minutes, so a UTC-aligned grid is also an IST-aligned grid.
export const alignUp = (d: Date) => new Date(Math.ceil(d.getTime() / GRID_MS) * GRID_MS);
export const earliestStart = (now: Date) => addMinutes(now, TRAVEL_MINUTES);

// The start time a booking will really use.
//   instant:   now + travel estimate, rounded up to the next whole minute
//   scheduled: the requested time, which must be on the 30-minute grid and inside the booking window
export function resolveStart(mode: "instant" | "scheduled", requested: Date | undefined, now: Date): Date {
    if (mode === "instant") return new Date(Math.ceil(earliestStart(now).getTime() / 60_000) * 60_000);
    if (!requested) throw unprocessable("INVALID_SLOT", "startsAt is required for a scheduled booking.");
    const tooSoon = requested < earliestStart(now);
    const tooFar = requested > addMinutes(now, MAX_ADVANCE_DAYS * 24 * 60);
    if (requested.getTime() % GRID_MS !== 0 || tooSoon || tooFar) {
        throw unprocessable(
            "INVALID_SLOT",
            `Pick a ${SLOT_GRID_MINUTES}-minute slot between 15 minutes and ${MAX_ADVANCE_DAYS} days from now.`,
        );
    }
    return requested;
}
