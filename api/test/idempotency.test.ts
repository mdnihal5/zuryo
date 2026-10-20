import { afterAll, describe, expect, it } from "vitest";
import {
    api,
    bearer,
    book,
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

afterAll(closeAll);

async function setup() {
    const zone = await makeZone();
    await makeTrainer(zone);
    const customer = await makeCustomer(zone);
    return { zone, customer, token: await tokenFor(customer.email) };
}

describe("idempotent booking", () => {
    it("a retry with the same key returns the same booking and charges once", async () => {
        const { customer, token } = await setup();
        const key = newKey();
        const body = { mode: "scheduled", startsAt: tomorrowAt(11) };
        const first = await book(token, body, key);
        const second = await book(token, body, key);
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body.data.id).toBe(first.body.data.id);
        expect(await count("SELECT count(*) n FROM bookings WHERE customer_id = $1", [customer.id])).toBe(1);
        expect(
            await count(
                "SELECT count(*) n FROM payment_orders p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_id = $1",
                [customer.id],
            ),
        ).toBe(1);
        // trainer is notified once, not once per attempt
        expect(
            await count("SELECT count(*) n FROM notifications WHERE booking_id = $1 AND kind = 'booking_assigned'", [
                first.body.data.id,
            ]),
        ).toBe(2);
    });

    it("5 simultaneous requests with the same key create one booking", async () => {
        const { customer, token } = await setup();
        const key = newKey();
        const body = { mode: "scheduled", startsAt: tomorrowAt(12) };
        const results = await Promise.all(Array.from({ length: 5 }, () => book(token, body, key)));
        expect(results.every((r) => r.status === 201)).toBe(true);
        expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
        expect(await count("SELECT count(*) n FROM bookings WHERE customer_id = $1", [customer.id])).toBe(1);
        expect(
            await count(
                "SELECT count(*) n FROM payment_orders p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_id = $1",
                [customer.id],
            ),
        ).toBe(1);
    });

    it("requires an Idempotency-Key", async () => {
        const { token } = await setup();
        const res = await api.post("/v1/bookings").set(bearer(token)).send({ mode: "instant" });
        expect(res.status).toBe(400);
    });

    it("instant booking: a retry returns the original even though 'now' has moved", async () => {
        const { token } = await setup();
        const key = newKey();
        const a = await book(token, { mode: "instant" }, key);
        await new Promise((r) => setTimeout(r, 1100));
        const b = await book(token, { mode: "instant" }, key);
        expect(a.status).toBe(201);
        expect(b.body.data.id).toBe(a.body.data.id);
        expect(b.body.data.startsAt).toBe(a.body.data.startsAt);
    });
});

describe("key reuse", () => {
    it("double-tap on package purchase buys one package, also when simultaneous", async () => {
        const { customer, token } = await setup();
        const key = newKey();
        const buy = () =>
            api.post("/v1/packages").set(bearer(token)).set("Idempotency-Key", key).send({ sessions: 10 });
        const results = [await buy(), await buy(), ...(await Promise.all([buy(), buy(), buy()]))];
        expect(results.every((r) => r.status === 201)).toBe(true);
        expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
        expect(await count("SELECT count(*) n FROM packages WHERE customer_id = $1", [customer.id])).toBe(1);
        expect((await api.post("/v1/packages").set(bearer(token)).send({ sessions: 10 })).status).toBe(400); // key required
    });

    it("the same key with a different body is 422, not a replay", async () => {
        const { customer, token } = await setup();
        const key = newKey();
        expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) }, key)).status).toBe(201);
        const other = await book(token, { mode: "scheduled", startsAt: tomorrowAt(13) }, key);
        expect(other.status).toBe(422);
        expect(other.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
        expect((await book(token, { mode: "instant" }, key)).status).toBe(422);
        expect(await count("SELECT count(*) n FROM bookings WHERE customer_id = $1", [customer.id])).toBe(1);

        const pkgKey = newKey();
        await api.post("/v1/packages").set(bearer(token)).set("Idempotency-Key", pkgKey).send({ sessions: 5 });
        const diff = await api
            .post("/v1/packages")
            .set(bearer(token))
            .set("Idempotency-Key", pkgKey)
            .send({ sessions: 10 });
        expect(diff.status).toBe(422);
        expect(diff.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
        // the same request written differently (other date format) is still the same request
        const sameInstant = new Date(tomorrowAt(11)).toISOString().replace("Z", "+00:00");
        expect((await book(token, { mode: "scheduled", startsAt: sameInstant }, key)).status).toBe(201);
    });
});

describe("reschedule", () => {
    it("cancels the old booking and creates a linked one; a retry changes nothing more", async () => {
        const { customer, token } = await setup();
        const original = await book(token, { mode: "scheduled", startsAt: tomorrowAt(10) });
        const key = newKey();
        const send = () =>
            api
                .post(`/v1/bookings/${original.body.data.id}/reschedule`)
                .set(bearer(token))
                .set("Idempotency-Key", key)
                .send({ startsAt: tomorrowAt(16) });
        const first = await send();
        const second = await send();
        expect(first.status).toBe(201);
        expect(second.body.data.id).toBe(first.body.data.id);
        expect(first.body.data.rescheduledFromId).toBe(original.body.data.id);
        expect(first.body.data.status).toBe("pending_payment"); // the new time is paid for like any new booking
        await payOrder({
            providerOrderId: first.body.data.payment.providerOrderId,
            amountPaise: first.body.data.price.totalPaise,
        });

        const old = (await api.get(`/v1/bookings/${original.body.data.id}`).set(bearer(token))).body.data;
        expect(old.status).toBe("cancelled");
        expect(old.cancellation.reason).toBe("rescheduled");
        expect(old.rescheduledToId).toBe(first.body.data.id);
        expect(old.payment.refunded).toBe(true);
        expect(await count("SELECT count(*) n FROM bookings WHERE customer_id = $1", [customer.id])).toBe(2);
        // one active payment, one refunded
        expect(
            await count(
                "SELECT count(*) n FROM payment_orders p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_id = $1 AND p.status = 'paid'",
                [customer.id],
            ),
        ).toBe(1);
        expect(
            await count("SELECT count(*) n FROM notifications WHERE booking_id = $1 AND kind = 'booking_assigned'", [
                first.body.data.id,
            ]),
        ).toBe(2);
    });

    it("if no trainer is free at the new time, the old booking is untouched", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const a = await tokenFor((await makeCustomer(zone)).email);
        const b = await tokenFor((await makeCustomer(zone)).email);
        await book(b, { mode: "scheduled", startsAt: tomorrowAt(15) });
        const mine = await book(a, { mode: "scheduled", startsAt: tomorrowAt(10) });
        const res = await api
            .post(`/v1/bookings/${mine.body.data.id}/reschedule`)
            .set(bearer(a))
            .set("Idempotency-Key", newKey())
            .send({ startsAt: tomorrowAt(15) });
        expect(res.status).toBe(409);
        const still = (await api.get(`/v1/bookings/${mine.body.data.id}`).set(bearer(a))).body.data;
        expect(still.status).toBe("confirmed");
        expect(still.payment.refunded).toBe(false);
    });

    it("is refused inside the 2-hour window", async () => {
        const { token } = await setup();
        const soon = await book(token, { mode: "instant" });
        const res = await api
            .post(`/v1/bookings/${soon.body.data.id}/reschedule`)
            .set(bearer(token))
            .set("Idempotency-Key", newKey())
            .send({ startsAt: tomorrowAt(16) });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("RESCHEDULE_TOO_LATE");
    });
});

void pool;
