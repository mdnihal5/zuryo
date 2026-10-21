import { describe, expect, it } from "vitest";
import { addDays, formatPaise, istDate, istToIso } from "./format";

describe("formatPaise", () => {
    it("shows the assignment examples", () => {
        expect(formatPaise(43890)).toBe("₹438.90");
        expect(formatPaise(54890)).toBe("₹548.90");
        expect(formatPaise(39900)).toBe("₹399.00");
    });
    it("groups thousands the Indian way", () => {
        expect(formatPaise(123456700)).toBe("₹12,34,567.00");
    });
});

describe("Kolkata dates", () => {
    it("rolls the day at 18:30 UTC", () => {
        expect(istDate(Date.parse("2026-10-19T18:29:00Z"))).toBe("2026-10-19");
        expect(istDate(Date.parse("2026-10-19T18:30:00Z"))).toBe("2026-10-20");
    });
    it("converts a Kolkata wall time to UTC", () => {
        expect(istToIso("2026-10-21", "06:00")).toBe("2026-10-21T00:30:00.000Z");
    });
    it("adds days across a month end", () => {
        expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    });
});
