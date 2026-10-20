import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    api,
    book,
    bearer,
    closeAll,
    count,
    makeCustomer,
    makeTrainer,
    makeZone,
    tokenFor,
    tomorrowAt,
} from "./helpers.js";
import { pool } from "../src/db/pool.js";

afterAll(closeAll);

describe("double booking", () => {
    it("20 parallel bookings for one trainer and one slot: exactly one succeeds", async () => {
        const zone = await makeZone();
        const trainer = await makeTrainer(zone);
        const tokens = await Promise.all(
            Array.from({ length: 20 }, async () => tokenFor((await makeCustomer(zone)).email)),
        );
        const startsAt = tomorrowAt(11);

        const results = await Promise.all(tokens.map((t) => book(t, { mode: "scheduled", startsAt })));

        const ok = results.filter((r) => r.status === 201);
        const lost = results.filter((r) => r.status === 409);
        expect(ok).toHaveLength(1);
        expect(lost).toHaveLength(19);
        expect(lost[0].body.error.code).toBe("NO_TRAINER_AVAILABLE");
        expect(Array.isArray(lost[0].body.error.details.alternatives)).toBe(true);
        expect(
            await count("SELECT count(*) n FROM bookings WHERE trainer_id = $1 AND status = 'confirmed'", [
                trainer.trainerId,
            ]),
        ).toBe(1);
        // the losers were rolled back completely: one payment in total
        expect(
            await count(
                "SELECT count(*) n FROM payment_orders p JOIN bookings b ON b.id = p.booking_id WHERE b.trainer_id = $1",
                [trainer.trainerId],
            ),
        ).toBe(1);
    });

    it("a herd of 100 for 10 trainers: exactly 10 succeed, the rest get a clean 409, and it finishes fast", async () => {
        const zone = await makeZone();
        for (let i = 0; i < 10; i++) await makeTrainer(zone);
        const tokens = await Promise.all(
            Array.from({ length: 100 }, async () => tokenFor((await makeCustomer(zone)).email)),
        );
        const startsAt = tomorrowAt(16);

        const started = Date.now();
        const results = await Promise.all(tokens.map((t) => book(t, { mode: "scheduled", startsAt })));

        expect(results.map((r) => r.status).filter((s) => s !== 201 && s !== 409)).toEqual([]);
        expect(results.filter((r) => r.status === 201)).toHaveLength(10);
        // Without the per-trainer lock, concurrent inserts deadlocked one at a time (1 s each) and took tens of seconds.
        expect(Date.now() - started).toBeLessThan(8_000);
    });

    it("a loser falls through to the next trainer: 2 trainers, 6 requests, 2 succeed on different trainers", async () => {
        const zone = await makeZone();
        const t1 = await makeTrainer(zone);
        const t2 = await makeTrainer(zone);
        const tokens = await Promise.all(
            Array.from({ length: 6 }, async () => tokenFor((await makeCustomer(zone)).email)),
        );
        const startsAt = tomorrowAt(12);

        const results = await Promise.all(tokens.map((t) => book(t, { mode: "scheduled", startsAt })));

        expect(results.filter((r) => r.status === 201)).toHaveLength(2);
        expect(results.filter((r) => r.status === 409)).toHaveLength(4);
        const trainers = results
            .filter((r) => r.status === 201)
            .map((r) => r.body.data.trainer.id)
            .sort();
        expect(trainers).toEqual([t1.trainerId, t2.trainerId].sort());
    });

    it("back-to-back sessions are allowed only after the 15-minute buffer", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const token = await tokenFor((await makeCustomer(zone)).email);
        expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(9) })).status).toBe(201);
        // 10:00 starts when the first ends, but the trainer is busy until 10:15
        expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(10) })).status).toBe(409);
        expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(10, 30) })).status).toBe(201);
    });

    it("one customer cannot hold two overlapping sessions with different trainers", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        await makeTrainer(zone);
        const token = await tokenFor((await makeCustomer(zone)).email);
        const startsAt = tomorrowAt(14);
        const [a, b] = await Promise.all([
            book(token, { mode: "scheduled", startsAt }),
            book(token, { mode: "scheduled", startsAt }),
        ]);
        expect([a.status, b.status].sort()).toEqual([201, 409]);
        const loser = a.status === 409 ? a : b;
        expect(loser.body.error.code).toBe("CUSTOMER_ALREADY_BOOKED");
    });
});

describe("slots", () => {
    let token: string;
    beforeAll(async () => {
        const zone = await makeZone();
        const trainer = await makeTrainer(zone);
        await pool.query("UPDATE trainer_hours SET start_time = '06:00', end_time = '21:00' WHERE trainer_id = $1", [
            trainer.trainerId,
        ]);
        token = await tokenFor((await makeCustomer(zone)).email);
    });

    it("lists 30-minute grid slots with peak flag and price, and hides a booked slot", async () => {
        const istDate = new Date(new Date(tomorrowAt(11)).getTime() + 330 * 60_000).toISOString().slice(0, 10);
        const before = await api.get(`/v1/slots?date=${istDate}`).set(bearer(token));
        expect(before.status).toBe(200);
        const slots = before.body.data.slots as { startsAt: string; isPeak: boolean; totalPaise: number }[];
        const at = (iso: string) => slots.find((s) => s.startsAt === iso);
        expect(at(tomorrowAt(6))?.isPeak).toBe(true);
        expect(at(tomorrowAt(9))?.isPeak).toBe(false);
        expect(at(tomorrowAt(18))?.totalPaise).toBe(54890);
        expect(at(tomorrowAt(11))?.totalPaise).toBe(43890);
        expect(at(tomorrowAt(5, 30))).toBeUndefined(); // before working hours

        await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const after = await api.get(`/v1/slots?date=${istDate}`).set(bearer(token));
        const starts = (after.body.data.slots as { startsAt: string }[]).map((s) => s.startsAt);
        expect(starts).not.toContain(tomorrowAt(11));
        expect(starts).not.toContain(tomorrowAt(11, 30)); // inside the booked hour
        expect(starts).not.toContain(tomorrowAt(12)); // inside the 15-minute buffer
        expect(starts).toContain(tomorrowAt(12, 30));
    });
});
