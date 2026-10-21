import { afterAll, describe, expect, it } from "vitest";
import {
    api,
    bearer,
    book,
    closeAll,
    count,
    makeCustomer,
    makeTrainer,
    makeZone,
    tokenFor,
    tomorrowAt,
} from "./helpers.js";
import { pool, withTransaction } from "../src/db/pool.js";
import { lockZone } from "../src/queries/bookings.queries.js";

afterAll(closeAll);

async function scene() {
    const zone = await makeZone();
    const trainer = await makeTrainer(zone);
    const customer = await makeCustomer(zone);
    return {
        zone,
        trainer,
        customer,
        token: await tokenFor(customer.email),
        trainerToken: await tokenFor(trainer.email),
    };
}

describe("locks", () => {
    it("a transaction that fails after taking the zone lock leaves nothing locked", async () => {
        const { zone } = await scene();
        const failing = withTransaction(async (client) => {
            await lockZone(client, zone);
            await client.query("SELECT 1/0");
        });
        await expect(failing).rejects.toBeDefined();
        const probe = await pool.query("SELECT pg_try_advisory_lock(1, $1) AS got", [zone]);
        expect(probe.rows[0].got).toBe(true);
        await pool.query("SELECT pg_advisory_unlock_all()");
    });

    it("time off and a booking racing for the same hour never both succeed", async () => {
        for (const hour of [8, 10, 12, 14]) {
            const { trainer, token, trainerToken } = await scene();
            const startsAt = tomorrowAt(hour);
            const [off, booking] = await Promise.all([
                api
                    .post("/v1/trainer/time-off")
                    .set(bearer(trainerToken))
                    .send({ startsAt, endsAt: tomorrowAt(hour + 1) }),
                book(token, { mode: "scheduled", startsAt }),
            ]);
            expect([off.status, booking.status].sort()).not.toEqual([201, 201]);
            expect(trainer.trainerId).toBeGreaterThan(0);
        }
    });
});

describe("validation never reaches the database as a 500", () => {
    it("huge, negative and odd ids, NUL characters", async () => {
        const { token, trainerToken } = await scene();
        const statuses = await Promise.all([
            api.get("/v1/bookings/99999999999").set(bearer(token)),
            api.get("/v1/bookings/-1").set(bearer(token)),
            api.get("/v1/bookings/1e3").set(bearer(token)),
            api.post("/v1/bookings/99999999999/cancel").set(bearer(token)),
            book(token, { mode: "scheduled", startsAt: tomorrowAt(11), packageId: 99999999999 }),
            api
                .post("/v1/trainer/time-off")
                .set(bearer(trainerToken))
                .send({ startsAt: tomorrowAt(9), endsAt: tomorrowAt(10), reason: "a\u0000b" }),
            api
                .put("/v1/profile")
                .set(bearer(token))
                .send({ age: 30, weightKg: 70, goals: ["a\u0000"], level: "beginner", preferences: [] }),
        ]);
        expect(statuses.map((r) => r.status)).toEqual([400, 400, 404, 400, 400, 400, 400]);
    });
});

describe("working hours", () => {
    it("a session may not run past midnight, even when the trainer's window ends at 23:59", async () => {
        const { zone, trainer, token } = await scene();
        await pool.query("UPDATE trainer_hours SET start_time = '00:00', end_time = '23:59' WHERE trainer_id = $1", [
            trainer.trainerId,
        ]);
        const late = await book(token, { mode: "scheduled", startsAt: tomorrowAt(23, 30) });
        expect(late.status).toBe(409);
        expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(22, 30) })).status).toBe(201);
        expect(zone).toBeGreaterThan(0);
    });

    it("two parallel edits of the weekly hours leave one window per weekday", async () => {
        const { trainer, trainerToken } = await scene();
        const hours = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "18:00" }));
        const res = await Promise.all(
            [1, 2, 3, 4].map(() => api.put("/v1/trainer/availability/hours").set(bearer(trainerToken)).send({ hours })),
        );
        expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200]);
        expect(await count("SELECT count(*) n FROM trainer_hours WHERE trainer_id = $1", [trainer.trainerId])).toBe(5);
    });
});

describe("cancel racing session start", () => {
    it("exactly one wins and the loser gets a 409", async () => {
        const { token, trainerToken } = await scene();
        const b = await book(token, { mode: "instant" });
        const id = b.body.data.id;
        const [cancel, start] = await Promise.all([
            api.post(`/v1/bookings/${id}/cancel`).set(bearer(token)),
            api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(trainerToken)),
        ]);
        expect([cancel.status, start.status].sort()).toEqual([200, 409]);
        const status = (await pool.query("SELECT status FROM bookings WHERE id = $1", [id])).rows[0].status;
        expect(status).toBe(cancel.status === 200 ? "cancelled" : "in_progress");
    });
});

describe("validation limits", () => {
    it("oversized, mistyped and out-of-range input is a 4xx", async () => {
        const { token } = await scene();
        const huge = "x".repeat(150_000);
        const res = await Promise.all([
            api
                .put("/v1/profile")
                .set(bearer(token))
                .send({ goals: [huge] }),
            api.put("/v1/bookings/1/feedback").set(bearer(token)).send({ rating: "5" }),
            api
                .put("/v1/bookings/1/feedback")
                .set(bearer(token))
                .send({ rating: 5, comment: "y".repeat(2001) }),
            api.get("/v1/bookings?limit=0").set(bearer(token)),
            api.get("/v1/bookings?cursor=not-a-cursor").set(bearer(token)),
            api.get("/v1/slots?date=2026-02-31").set(bearer(token)),
            book(token, { mode: "scheduled", startsAt: ["2026-01-01"] }),
            book(token, { mode: "scheduled", startsAt: tomorrowAt(11), packageId: -3 }),
            api.post("/v1/packages").set(bearer(token)).set("Idempotency-Key", "short").send({ sessions: 5 }),
        ]);
        expect(res.map((r) => r.status)).toEqual([413, 400, 400, 400, 400, 400, 400, 400, 400]);
    });
});

describe("pricing update racing bookings", () => {
    it("every booking carries one consistent price snapshot", async () => {
        const zone = await makeZone();
        for (let i = 0; i < 6; i++) await makeTrainer(zone);
        const tokens = await Promise.all(
            Array.from({ length: 6 }, async () => tokenFor((await makeCustomer(zone)).email)),
        );
        const admin = await tokenFor("admin@zuryo.test", "Demo@12345");
        const rules = (await api.get("/v1/admin/pricing-rules").set(bearer(admin))).body.data;
        const next = { ...rules, normalPricePaise: 60000, peakPricePaise: 70000 };
        delete next.updatedAt;
        const [, ...bookings] = await Promise.all([
            api.put("/v1/admin/pricing-rules").set(bearer(admin)).send(next),
            ...tokens.map((t) => book(t, { mode: "scheduled", startsAt: tomorrowAt(12) })),
        ]);
        const { updatedAt: _u, ...old } = rules;
        await api.put("/v1/admin/pricing-rules").set(bearer(admin)).send(old);
        for (const b of bookings) {
            const p = b.body.data.price;
            expect(p.sessionPricePaise + p.commissionPaise).toBe(p.totalPaise);
            expect([39900, 60000]).toContain(p.sessionPricePaise);
        }
    });
});
