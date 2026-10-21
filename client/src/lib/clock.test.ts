import { describe, expect, it } from "vitest";
import { computeOffset } from "./clock";

describe("computeOffset", () => {
    it("is positive when the device clock is behind the server", () => {
        expect(computeOffset("2026-10-19T10:00:05.000Z", Date.parse("2026-10-19T10:00:00.000Z"))).toBe(5000);
    });
    it("is negative when the device clock is ahead", () => {
        expect(computeOffset("2026-10-19T10:00:00.000Z", Date.parse("2026-10-19T10:03:00.000Z"))).toBe(-180000);
    });
});
