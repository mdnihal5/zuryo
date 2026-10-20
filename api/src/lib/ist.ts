import { IST_OFFSET_MINUTES } from "../config/constants.js";

const OFFSET_MS = IST_OFFSET_MINUTES * 60_000;
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

// Wall-clock parts of an instant in Asia/Kolkata.
export function istParts(d: Date) {
    const local = new Date(d.getTime() + OFFSET_MS);
    return {
        date: local.toISOString().slice(0, 10), // YYYY-MM-DD
        minutesOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
    };
}

// The instant at which a given Kolkata calendar date starts.
export const istMidnight = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET_MS);

export const formatIst = (d: Date) =>
    d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
