import jwt from "jsonwebtoken";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
    api,
    buyPackage,
    reschedule,
    bearer,
    book,
    bookPending,
    closeAll,
    payOrder,
    count,
    makeCustomer,
    makeTrainer,
    makeZone,
    newKey,
    tokenFor,
    tomorrowAt,
} from "./helpers.js";
import { pool } from "../src/db/pool.js";
import { config } from "../src/config/index.js";

afterAll(closeAll);
afterEach(() => vi.useRealTimers());

async function scene(trainers = 1) {
    const zone = await makeZone();
    const ts = [];
    for (let i = 0; i < trainers; i++) ts.push(await makeTrainer(zone));
    const customer = await makeCustomer(zone);
    return { zone, trainer: ts[0], customer, token: await tokenFor(customer.email) };
}

const buy = (token: string, sessions = 5) => buyPackage(token, sessions);
const cancel = (token: string, id: number) => api.post(`/v1/bookings/${id}/cancel`).set(bearer(token));
const balance = async (packageId: number) =>
    Number(
        (
            await pool.query(
                "SELECT p.sessions_total + COALESCE(SUM(l.delta),0) n FROM packages p LEFT JOIN package_ledger l ON l.package_id = p.id WHERE p.id = $1 GROUP BY p.id",
                [packageId],
            )
        ).rows[0].n,
    );

// Makes every notification insert for one user fail, to simulate a server error late in a transaction.
async function breakNotificationsFor(userId: number) {
    const name = `boom_${userId}`;
    await pool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$`,
    );
    await pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON notifications FOR EACH ROW WHEN (NEW.user_id = ${userId}) EXECUTE FUNCTION ${name}()`,
    );
    return async () => {
        await pool.query(`DROP TRIGGER ${name} ON notifications`);
        await pool.query(`DROP FUNCTION ${name}()`);
    };
}

describe("fault injection: an error late in the transaction leaves nothing behind", () => {
    it("package booking: the booking row and the ledger are rolled back; the same key works afterwards", async () => {
        const { customer, token } = await scene();
        const pkg = (await buy(token)).body.data.id;
        const restore = await breakNotificationsFor(customer.id);
        const key = newKey();
        const viaPackage = await book(token, { mode: "scheduled", startsAt: tomorrowAt(13), packageId: pkg }, key);
        expect(viaPackage.status).toBe(500);
        expect(await count("SELECT count(*) n FROM bookings WHERE customer_id = $1", [customer.id])).toBe(0);
        expect(await count("SELECT count(*) n FROM package_ledger WHERE package_id = $1", [pkg])).toBe(0);
        await restore();
        expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(13), packageId: pkg }, key)).status).toBe(
            201,
        );
    });

    it("webhook: a failure while confirming rolls back the order and the booking; the gateway's retry then works", async () => {
        const { customer, token } = await scene();
        const pending = await bookPending(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        expect(pending.status).toBe(201);
        const event = {
            providerOrderId: pending.body.data.payment.providerOrderId,
            amountPaise: pending.body.data.price.totalPaise,
            paymentId: "pay_fault_injection",
        };
        const restore = await breakNotificationsFor(customer.id);
        expect((await payOrder(event)).status).toBe(500);
        const mid = (await pool.query("SELECT status FROM bookings WHERE id = $1", [pending.body.data.id])).rows[0];
        expect(mid.status).toBe("pending_payment");
        expect(
            await count("SELECT count(*) n FROM payment_orders WHERE booking_id = $1 AND status = 'created'", [
                pending.body.data.id,
            ]),
        ).toBe(1);
        await restore();
        expect((await payOrder(event)).status).toBe(200);
        const done = (await api.get(`/v1/bookings/${pending.body.data.id}`).set(bearer(token))).body.data;
        expect(done.status).toBe("confirmed");
    });

    it("cancel: a failure after the status update and refund undoes both", async () => {
        const { customer, token } = await scene();
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const restore = await breakNotificationsFor(customer.id);
        expect((await cancel(token, b.body.data.id)).status).toBe(500);
        await restore();
        const row = (
            await pool.query(
                "SELECT b.status, p.status pay FROM bookings b JOIN payment_orders p ON p.booking_id = b.id WHERE b.id = $1",
                [b.body.data.id],
            )
        ).rows[0];
        expect(row).toEqual({ status: "confirmed", pay: "paid" });
    });

    it("reschedule: a failure undoes the cancel, the refund and the new booking", async () => {
        const { customer, token } = await scene();
        const pkg = (await buy(token)).body.data.id;
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11), packageId: pkg });
        const restore = await breakNotificationsFor(customer.id);
        expect((await reschedule(token, b.body.data.id, tomorrowAt(14))).status).toBe(500);
        await restore();
        expect(
            await count("SELECT count(*) n FROM bookings WHERE customer_id = $1 AND status = 'confirmed'", [
                customer.id,
            ]),
        ).toBe(1);
        expect(await count("SELECT count(*) n FROM bookings WHERE customer_id = $1", [customer.id])).toBe(1);
        expect(await balance(pkg)).toBe(4);
    });
});

describe("idempotency edge cases", () => {
    it("the same key from two customers is two independent bookings", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        await makeTrainer(zone);
        const a = await tokenFor((await makeCustomer(zone)).email);
        const b = await tokenFor((await makeCustomer(zone)).email);
        const key = newKey();
        const [ra, rb] = [
            await book(a, { mode: "scheduled", startsAt: tomorrowAt(11) }, key),
            await book(b, { mode: "scheduled", startsAt: tomorrowAt(11) }, key),
        ];
        expect([ra.status, rb.status]).toEqual([201, 201]);
        expect(ra.body.data.id).not.toBe(rb.body.data.id);
    });

    it("a key whose first attempt failed (no trainer) works once a trainer is free", async () => {
        const { token, trainer } = await scene();
        await pool.query("DELETE FROM trainer_hours WHERE trainer_id = $1", [trainer.trainerId]);
        const key = newKey();
        expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) }, key)).status).toBe(409);
        await pool.query(
            "INSERT INTO trainer_hours (trainer_id, weekday, start_time, end_time) SELECT $1, d, '06:00', '21:00' FROM generate_series(1,7) d",
            [trainer.trainerId],
        );
        expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) }, key)).status).toBe(201);
    });

    it("5 parallel reschedules with one key: one new booking, one refund, one charge", async () => {
        const { customer, token } = await scene(2);
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const key = newKey();
        const res = await Promise.all(
            Array.from({ length: 5 }, () => reschedule(token, b.body.data.id, tomorrowAt(14), key)),
        );
        expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
        expect(new Set(res.map((r) => r.body.data.id)).size).toBe(1);
        expect(
            await count("SELECT count(*) n FROM bookings WHERE customer_id = $1 AND status = 'confirmed'", [
                customer.id,
            ]),
        ).toBe(1);
        expect(
            await count(
                "SELECT count(*) n FROM payment_orders p JOIN bookings x ON x.id = p.booking_id WHERE x.customer_id = $1 AND p.status = 'paid'",
                [customer.id],
            ),
        ).toBe(1);
    });
});

describe("double writes", () => {
    it("two reschedules of one booking with different keys: one wins, the other gets 409", async () => {
        const { customer, token } = await scene(2);
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const [r1, r2] = await Promise.all([
            reschedule(token, b.body.data.id, tomorrowAt(14)),
            reschedule(token, b.body.data.id, tomorrowAt(16)),
        ]);
        expect([r1.status, r2.status].sort()).toEqual([201, 409]);
        expect(
            await count("SELECT count(*) n FROM bookings WHERE customer_id = $1 AND status = 'confirmed'", [
                customer.id,
            ]),
        ).toBe(1);
        expect(
            await count(
                "SELECT count(*) n FROM payment_orders p JOIN bookings x ON x.id = p.booking_id WHERE x.customer_id = $1 AND p.status = 'paid'",
                [customer.id],
            ),
        ).toBe(1);
    });

    it("cancel racing reschedule: money always matches the bookings that are still active", async () => {
        const { customer, token } = await scene(2);
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const res = await Promise.all([
            cancel(token, b.body.data.id),
            reschedule(token, b.body.data.id, tomorrowAt(14)),
        ]);
        expect(res.every((r) => r.status < 500)).toBe(true);
        const active = await count("SELECT count(*) n FROM bookings WHERE customer_id = $1 AND status = 'confirmed'", [
            customer.id,
        ]);
        const paid = await count(
            "SELECT count(*) n FROM payment_orders p JOIN bookings x ON x.id = p.booking_id WHERE x.customer_id = $1 AND p.status = 'paid'",
            [customer.id],
        );
        expect(paid).toBe(active);
    });

    it("the last package credit used from two tabs at once: one success, balance 0", async () => {
        const zone = await makeZone();
        for (let i = 0; i < 3; i++) await makeTrainer(zone);
        const customer = await makeCustomer(zone);
        const token = await tokenFor(customer.email);
        await pool.query(
            "INSERT INTO packages (customer_id, sessions_total, idempotency_key, request_hash) VALUES ($1, 1, 'one-credit-key', 'h')",
            [customer.id],
        );
        const pkg = (await pool.query("SELECT id FROM packages WHERE customer_id = $1", [customer.id])).rows[0].id;
        const res = await Promise.all([
            book(token, { mode: "scheduled", startsAt: tomorrowAt(11), packageId: pkg }),
            book(token, { mode: "scheduled", startsAt: tomorrowAt(15), packageId: pkg }),
        ]);
        expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
        expect(res.find((r) => r.status === 409)!.body.error.code).toBe("PACKAGE_EMPTY");
        expect(await balance(pkg)).toBe(0);
    });

    it("rescheduling a booking paid with the last credit keeps the balance at 0", async () => {
        const { customer, token } = await scene(2);
        await pool.query(
            "INSERT INTO packages (customer_id, sessions_total, idempotency_key, request_hash) VALUES ($1, 1, 'one-credit-2', 'h')",
            [customer.id],
        );
        const pkg = (await pool.query("SELECT id FROM packages WHERE customer_id = $1", [customer.id])).rows[0].id;
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11), packageId: pkg });
        expect((await reschedule(token, b.body.data.id, tomorrowAt(14))).status).toBe(201);
        expect(await balance(pkg)).toBe(0);
    });

    it("a reschedule that clashes with another of my sessions fails whole: the old booking stays", async () => {
        const { token } = await scene(2);
        const a = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        await book(token, { mode: "scheduled", startsAt: tomorrowAt(14) });
        const r = await reschedule(token, a.body.data.id, tomorrowAt(14));
        expect(r.status).toBe(409);
        expect((await api.get(`/v1/bookings/${a.body.data.id}`).set(bearer(token))).body.data.status).toBe("confirmed");
    });
});

describe("time edges", () => {
    it("cancel at exactly 2 h before the start is refunded, 1 ms later is not", async () => {
        const { token, customer } = await scene(2);
        const early = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const late = await book(token, { mode: "scheduled", startsAt: tomorrowAt(15) });
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(tomorrowAt(11)).getTime() - 2 * 3_600_000);
        const t1 = await tokenFor(customer.email);
        expect((await cancel(t1, early.body.data.id)).body.data.payment.refunded).toBe(true);
        vi.setSystemTime(new Date(tomorrowAt(15)).getTime() - 2 * 3_600_000 + 1);
        const t2 = await tokenFor(customer.email);
        expect((await cancel(t2, late.body.data.id)).body.data.payment.refunded).toBe(false);
    });

    it("peak boundaries through the API: 08:30 peak, 09:00 normal, 20:30 peak, 21:00 normal", async () => {
        const { token } = await scene();
        const peak = async (h: number, m: number) =>
            (
                await api
                    .get(`/v1/quote?mode=scheduled&startsAt=${encodeURIComponent(tomorrowAt(h, m))}`)
                    .set(bearer(token))
            ).body.data.isPeak;
        expect([await peak(8, 30), await peak(9, 0), await peak(20, 30), await peak(21, 0)]).toEqual([
            true,
            false,
            true,
            false,
        ]);
    });

    it("an instant booking whose hour would run past the working-hours end is refused; 19:45 sharp is fine", async () => {
        const { token, customer, trainer } = await scene();
        await pool.query("UPDATE trainer_hours SET start_time = '06:00', end_time = '21:00' WHERE trainer_id = $1", [
            trainer.trainerId,
        ]);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(tomorrowAt(19, 45)).getTime() + 1);
        const t = await tokenFor(customer.email);
        expect((await book(t, { mode: "instant" })).status).toBe(409);
        vi.setSystemTime(new Date(tomorrowAt(19, 45)));
        expect((await book(await tokenFor(customer.email), { mode: "instant" })).status).toBe(201);
        expect(token).toBeTruthy();
    });
});

describe("auth", () => {
    const sign = (sub: number, o: { secret?: string; tv?: number; expiresIn?: number } = {}) =>
        jwt.sign({ tv: o.tv ?? 0 }, o.secret ?? config.jwtSecret, {
            algorithm: "HS256",
            subject: String(sub),
            expiresIn: o.expiresIn ?? 3600,
        });

    it("expired, forged, unsigned and wrong-version tokens are all 401", async () => {
        const { customer } = await scene();
        const tokens = [
            sign(customer.id, { expiresIn: -10 }),
            sign(customer.id, { secret: "x".repeat(40) }),
            sign(customer.id, { tv: 99 }),
            `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(`{"sub":"${customer.id}","tv":0}`).toString("base64url")}.`,
        ];
        for (const t of tokens) expect((await api.get("/v1/bookings").set(bearer(t))).status).toBe(401);
    });

    it("body fields cannot change role, owner or price", async () => {
        const { customer, token } = await scene();
        const res = await book(token, {
            mode: "scheduled",
            startsAt: tomorrowAt(11),
            role: "admin",
            customerId: 1,
            totalPaise: 1,
        });
        expect(res.status).toBe(201);
        expect(res.body.data.price.totalPaise).toBe(43890);
        expect((await api.get("/v1/admin/bookings").set(bearer(token))).status).toBe(403);
        expect(
            (
                await api
                    .put("/v1/profile")
                    .set(bearer(token))
                    .send({ age: 30, weightKg: 70, goals: ["x"], level: "beginner", preferences: [], role: "admin" })
            ).status,
        ).toBe(200);
        expect((await pool.query("SELECT role FROM users WHERE id = $1", [customer.id])).rows[0].role).toBe("customer");
    });

    it("a trainer cannot start, read or record another trainer's session, or delete their time off", async () => {
        const zone = await makeZone();
        const t1 = await makeTrainer(zone);
        const t2 = await makeTrainer(zone, { lat: 18, lng: 79 });
        const customer = await tokenFor((await makeCustomer(zone)).email);
        const mine = await book(customer, { mode: "instant", preferredTrainerId: t1.trainerId });
        expect(mine.body.data.trainer.id).toBe(t1.trainerId);
        const other = await tokenFor(t2.email);
        const id = mine.body.data.id;
        const statuses = [
            await api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(other)),
            await api.get(`/v1/trainer/sessions/${id}`).set(bearer(other)),
            await api.get(`/v1/trainer/sessions/${id}/record`).set(bearer(other)),
            await api
                .put(`/v1/trainer/sessions/${id}/record`)
                .set(bearer(other))
                .send({ exercises: [{ name: "x", focus: "core" }], durationMinutes: 10 }),
        ].map((r) => r.status);
        expect(statuses).toEqual([404, 404, 404, 404]);
        const off = await api
            .post("/v1/trainer/time-off")
            .set(bearer(await tokenFor(t1.email)))
            .send({ startsAt: tomorrowAt(1), endsAt: tomorrowAt(2) });
        expect((await api.delete(`/v1/trainer/time-off/${off.body.data.id}`).set(bearer(other))).status).toBe(404);
    });

    it("notifications are private to their owner", async () => {
        const { token } = await scene();
        await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const other = await scene();
        expect((await api.get("/v1/notifications").set(bearer(other.token))).body.data).toHaveLength(0);
    });
});
