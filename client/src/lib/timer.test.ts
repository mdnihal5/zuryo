import { describe, expect, it } from "vitest";
import { crossed, elapsedFraction, formatCountdown, remainingMs, timerPhase } from "./timer";

const session = {
    startedAt: "2026-10-19T12:00:00.000Z",
    warningAt: "2026-10-19T12:55:00.000Z",
    endsAt: "2026-10-19T13:00:00.000Z",
};
const at = (iso: string) => Date.parse(iso);

describe("timerPhase", () => {
    it("is running before 55 minutes", () => {
        expect(timerPhase(session, at("2026-10-19T12:54:59.999Z"))).toBe("running");
    });
    it("is warning from 55 to 60 minutes", () => {
        expect(timerPhase(session, at("2026-10-19T12:55:00.000Z"))).toBe("warning");
        expect(timerPhase(session, at("2026-10-19T12:59:59.999Z"))).toBe("warning");
    });
    it("is done at 60 minutes", () => {
        expect(timerPhase(session, at("2026-10-19T13:00:00.000Z"))).toBe("done");
    });
});

describe("countdown", () => {
    it("never goes below zero", () => {
        expect(remainingMs(session, at("2026-10-19T13:05:00.000Z"))).toBe(0);
    });
    it("formats minutes and seconds", () => {
        expect(formatCountdown(38 * 60_000 + 12_000)).toBe("38:12");
        expect(formatCountdown(0)).toBe("00:00");
    });
    it("reports progress", () => {
        expect(elapsedFraction(session, at("2026-10-19T12:30:00.000Z"))).toBe(0.5);
    });
});

describe("crossed", () => {
    it("fires only on the tick that passes the time", () => {
        const warn = session.warningAt;
        expect(crossed(at("2026-10-19T12:54:59.000Z"), at("2026-10-19T12:55:00.000Z"), warn)).toBe(true);
        expect(crossed(at("2026-10-19T12:55:00.000Z"), at("2026-10-19T12:55:01.000Z"), warn)).toBe(false);
        expect(crossed(at("2026-10-19T12:50:00.000Z"), at("2026-10-19T12:54:00.000Z"), warn)).toBe(false);
    });
});
