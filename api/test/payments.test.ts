import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
    api,
    bearer,
    book,
    bookPending,
    buyPackage,
    buyPackagePending,
    closeAll,
    count,
    makeCustomer,
    makeTrainer,
    makeZone,
    newKey,
    payOrder,
    sendWebhook,
    tokenFor,
    tomorrowAt,
    webhookBody,
} from "./helpers.js";
import { pool } from "../src/db/pool.js";
import { SIGNATURE_HEADER, sign } from "../src/lib/mockpay.js";
import { config } from "../src/config/index.js";

afterAll(closeAll);
afterEach(() => vi.restoreAllMocks());

async function scene(trainers = 1) {
    const zone = await makeZone();
    const ts = [];
    for (let i = 0; i < trainers; i++) ts.push(await makeTrainer(zone));
    const customer = await makeCustomer(zone);
    return { zone, trainers: ts, customer, token: await tokenFor(customer.email) };
}

async function customerInZone(zone: number) {
    const c = await makeCustomer(zone);
    return { customer: c, token: await tokenFor(c.email) };
}

// A booking waiting for payment, with what the gateway would send for it.
async function pendingBooking(token: string, hour = 11) {
    const res = await bookPending(token, { mode: "scheduled", startsAt: tomorrowAt(hour) });
    expect(res.status).toBe(201);
    const b = res.body.data;
    return {
        id: b.id as number,
        event: { providerOrderId: b.payment.providerOrderId as string, amountPaise: b.price.totalPaise as number },
        booking: b,
    };
}

const get = async (token: string, id: number) => (await api.get(`/v1/bookings/${id}`).set(bearer(token))).body.data;
const orderOf = async (bookingId: number) =>
    (await pool.query("SELECT * FROM payment_orders WHERE booking_id = $1", [bookingId])).rows[0];
const expireHold = (id: number) =>
    pool.query("UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [id]);

describe("creating a paid booking", () => {
    it("is pending_payment with a 10 minute hold, an order for the server's price, and a checkout link", async () => {
        const { token } = await scene();
        const { booking, id } = await pendingBooking(token, 20); // 20:00 is a peak slot
        expect(booking).toMatchObject({ status: "pending_payment", payment: { status: "created", method: "single" } });
        expect(booking.payment.checkoutUrl).toContain(`/pay/${booking.payment.providerOrderId}`);
        const heldFor = Date.parse(booking.payment.holdExpiresAt) - Date.now();
        expect(heldFor).toBeGreaterThan(9 * 60_000);
        expect(heldFor).toBeLessThanOrEqual(10 * 60_000);
        expect(await orderOf(id)).toMatchObject({ amount_paise: 54890, currency: "INR", status: "created" });
    });

    it("tells the trainer nothing until the payment is confirmed", async () => {
        const { token, trainers } = await scene();
        const { id, event } = await pendingBooking(token);
        const trainerToken = await tokenFor(trainers[0].email);
        const sessions = (await api.get("/v1/trainer/sessions?view=upcoming").set(bearer(trainerToken))).body.data;
        expect(sessions.items).toEqual([]);
        expect((await api.get(`/v1/trainer/sessions/${id}`).set(bearer(trainerToken))).status).toBe(404);
        expect(await count("SELECT count(*) n FROM notifications WHERE booking_id = $1", [id])).toBe(0);
        await payOrder(event);
        expect((await api.get(`/v1/trainer/sessions/${id}`).set(bearer(trainerToken))).status).toBe(200);
    });

    it("a retry with the same Idempotency-Key returns the same booking and the same order", async () => {
        const { customer, token } = await scene();
        const key = newKey();
        const body = { mode: "scheduled", startsAt: tomorrowAt(11) };
        const results = [
            await bookPending(token, body, key),
            ...(await Promise.all([1, 2, 3].map(() => bookPending(token, body, key)))),
        ];
        expect(results.every((r) => r.status === 201)).toBe(true);
        expect(new Set(results.map((r) => r.body.data.payment.providerOrderId)).size).toBe(1);
        expect(
            await count("SELECT count(*) n FROM payment_orders WHERE customer_id = $1 AND purpose = 'booking'", [
                customer.id,
            ]),
        ).toBe(1);
    });

    it("a pending hold blocks another customer from the same trainer and time", async () => {
        const { zone, token } = await scene();
        await pendingBooking(token);
        const other = await customerInZone(zone);
        const res = await bookPending(other.token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("NO_TRAINER_AVAILABLE");
    });
});

describe("webhook signature and amount", () => {
    it("a missing or wrong signature is 401 and nothing changes", async () => {
        const { token } = await scene();
        const { id, event } = await pendingBooking(token);
        const body = JSON.stringify(webhookBody(event));
        const forged = await sendWebhook(body, "00".repeat(32));
        const missing = await sendWebhook(body, null);
        const notHex = await sendWebhook(body, "not-a-signature");
        const wrongSecret = await sendWebhook(body, "ab".repeat(32));
        expect([forged.status, missing.status, notHex.status, wrongSecret.status]).toEqual([401, 401, 401, 401]);
        expect(forged.body.error.code).toBe("INVALID_SIGNATURE");
        expect((await get(token, id)).status).toBe("pending_payment");
        expect((await orderOf(id)).status).toBe("created");
    });

    it("a body changed after signing is 401", async () => {
        const { token } = await scene();
        const { id, event } = await pendingBooking(token);
        const raw = JSON.stringify(webhookBody(event));
        const signature = sign(raw, config.webhookSecret);
        expect((await sendWebhook(raw, signature)).status).toBe(200); // the untouched body passes
        const { id: id2, event: event2 } = await pendingBooking(token, 14);
        const other = JSON.stringify(webhookBody(event2));
        const res = await sendWebhook(other, signature); // another order's body under the first signature
        expect(res.status).toBe(401);
        expect((await get(token, id2)).status).toBe("pending_payment");
        expect((await get(token, id)).status).toBe("confirmed");
    });

    it("a validly signed body with a different amount is rejected and nothing changes", async () => {
        const { token } = await scene();
        const { id, event } = await pendingBooking(token);
        const cheaper = await payOrder({ ...event, amountPaise: 100 });
        const cheaperOrder = await payOrder({ ...event, orderAmountPaise: 100 });
        expect([cheaper.status, cheaperOrder.status]).toEqual([422, 422]);
        expect(cheaper.body.error.code).toBe("PAYMENT_MISMATCH");
        expect((await get(token, id)).status).toBe("pending_payment");
        expect(await orderOf(id)).toMatchObject({ status: "created", provider_payment_id: null });
    });

    it("an unknown order is acknowledged with 200 and ignored; a malformed signed body is 400", async () => {
        await scene();
        const unknown = await payOrder({ providerOrderId: "order_does_not_exist", amountPaise: 100 });
        expect(unknown.status).toBe(200);
        expect(unknown.body.data.result).toBe("ignored");
        expect((await sendWebhook({ hello: "world" })).status).toBe(400);
        expect((await sendWebhook("not json")).status).toBe(400);
    });
});

describe("confirming and failing", () => {
    it("a success webhook confirms the booking once and tells both people", async () => {
        const { customer, token, trainers } = await scene();
        const { id, event } = await pendingBooking(token);
        const res = await payOrder(event);
        expect(res.status).toBe(200);
        expect(res.body.data.result).toBe("confirmed");
        const b = await get(token, id);
        expect(b).toMatchObject({ status: "confirmed", payment: { status: "paid", checkoutUrl: null } });
        expect(await orderOf(id)).toMatchObject({ status: "paid" });
        const people = (
            await pool.query("SELECT user_id FROM notifications WHERE booking_id = $1 AND kind = 'booking_assigned'", [
                id,
            ])
        ).rows.map((r) => r.user_id);
        expect(people.sort()).toEqual([customer.id, trainers[0].id].sort());
    });

    it("the same success webhook sent 5 times at once confirms once and writes one set of notifications", async () => {
        const { token } = await scene();
        const { id, event } = await pendingBooking(token);
        const same = { ...event, paymentId: "pay_same_for_all" };
        const results = await Promise.all(Array.from({ length: 5 }, () => payOrder(same)));
        expect(results.every((r) => r.status === 200)).toBe(true);
        expect(results.filter((r) => r.body.data.result === "confirmed")).toHaveLength(1);
        expect(results.filter((r) => r.body.data.result === "replay")).toHaveLength(4);
        expect(await count("SELECT count(*) n FROM notifications WHERE booking_id = $1", [id])).toBe(2);
        expect(
            await count("SELECT count(*) n FROM payment_orders WHERE booking_id = $1 AND status = 'paid'", [id]),
        ).toBe(1);
    });

    it("a failure webhook marks it failed, releases the slot, and another customer can book it", async () => {
        const { zone, token } = await scene();
        const { id, event } = await pendingBooking(token);
        const res = await payOrder({ ...event, outcome: "failure" });
        expect(res.status).toBe(200);
        expect(await get(token, id)).toMatchObject({ status: "payment_failed", payment: { status: "failed" } });
        expect(
            await count("SELECT count(*) n FROM notifications WHERE booking_id = $1 AND kind = 'payment_failed'", [id]),
        ).toBe(1);
        const other = await customerInZone(zone);
        const taken = await book(other.token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        expect(taken.status).toBe(201);
        expect(taken.body.data.status).toBe("confirmed");
        // the gateway repeating the failure changes nothing
        expect((await payOrder({ ...event, outcome: "failure" })).body.data.result).toBe("replay");
    });
});

describe("holds that run out", () => {
    it("an expired hold is released on the next read, and the slot sells to someone else without any sweep", async () => {
        const { zone, token } = await scene();
        const { id } = await pendingBooking(token);
        await expireHold(id);
        const other = await customerInZone(zone);
        const taken = await book(other.token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        expect(taken.status).toBe(201);
        expect(await get(token, id)).toMatchObject({ status: "expired", payment: { status: "expired" } });
    });

    it("a success webhook after expiry confirms the booking if the slot is still free", async () => {
        const { token } = await scene();
        const { id, event } = await pendingBooking(token);
        await expireHold(id);
        expect((await get(token, id)).status).toBe("expired");
        const res = await payOrder(event);
        expect(res.body.data.result).toBe("confirmed");
        expect(await get(token, id)).toMatchObject({
            status: "confirmed",
            payment: { status: "paid", refunded: false },
        });
    });

    it("a success webhook after expiry refunds the money if someone else took the slot", async () => {
        const { zone, token } = await scene();
        const { id, event } = await pendingBooking(token);
        await expireHold(id);
        const other = await customerInZone(zone);
        expect((await book(other.token, { mode: "scheduled", startsAt: tomorrowAt(11) })).body.data.status).toBe(
            "confirmed",
        );
        const res = await payOrder(event);
        expect(res.status).toBe(200);
        expect(res.body.data.result).toBe("refunded");
        expect(await get(token, id)).toMatchObject({
            status: "expired",
            payment: { status: "refunded", refunded: true },
        });
        expect(
            await count("SELECT count(*) n FROM notifications WHERE booking_id = $1 AND kind = 'payment_refunded'", [
                id,
            ]),
        ).toBe(1);
        expect((await payOrder(event)).body.data.result).toBe("replay");
    });
});

describe("cancelling a paid booking", () => {
    it("before the deadline refunds the order exactly once, even with parallel cancels", async () => {
        const { token } = await scene();
        const { id, event } = await pendingBooking(token);
        await payOrder(event);
        const results = await Promise.all(
            [1, 2, 3].map(() => api.post(`/v1/bookings/${id}/cancel`).set(bearer(token))),
        );
        expect(results.every((r) => r.status === 200)).toBe(true);
        expect(await orderOf(id)).toMatchObject({ status: "refunded" });
        expect(await get(token, id)).toMatchObject({ status: "cancelled", payment: { refunded: true } });
        expect(
            await count("SELECT count(*) n FROM notifications WHERE booking_id = $1 AND kind = 'booking_cancelled'", [
                id,
            ]),
        ).toBe(2);
    });
});

describe("packages through the gateway", () => {
    it("a package is not usable until the paid webhook arrives", async () => {
        const { token } = await scene();
        const bought = await buyPackagePending(token, 5);
        expect(bought.status).toBe(201);
        expect(bought.body.data).toMatchObject({ status: "pending_payment", purchased: 5 });
        expect((await api.get("/v1/packages").set(bearer(token))).body.data).toEqual([]);
        const attempt = await bookPending(token, {
            mode: "scheduled",
            startsAt: tomorrowAt(11),
            packageId: bought.body.data.id,
        });
        expect(attempt.status).toBe(404);

        const order = (
            await pool.query("SELECT amount_paise FROM payment_orders WHERE provider_order_id = $1", [
                bought.body.data.providerOrderId,
            ])
        ).rows[0];
        expect(order.amount_paise).toBe(5 * 43890);
        await payOrder({ providerOrderId: bought.body.data.providerOrderId, amountPaise: order.amount_paise });
        const packages = (await api.get("/v1/packages").set(bearer(token))).body.data;
        expect(packages).toHaveLength(1);
        expect(packages[0]).toMatchObject({ purchased: 5, remaining: 5, status: "active" });
        const used = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11), packageId: packages[0].id });
        expect(used.body.data).toMatchObject({ status: "confirmed", payment: { method: "package" } });
    });

    it("a failed package payment never activates it; a retry with the same key shows the same order", async () => {
        const { token } = await scene();
        const key = newKey();
        const a = await buyPackagePending(token, 10, key);
        const b = await buyPackagePending(token, 10, key);
        expect(b.body.data.providerOrderId).toBe(a.body.data.providerOrderId);
        const amount = 10 * 43890;
        await payOrder({ providerOrderId: a.body.data.providerOrderId, amountPaise: amount, outcome: "failure" });
        expect((await api.get("/v1/packages").set(bearer(token))).body.data).toEqual([]);
        const bought = await buyPackage(token, 5);
        expect(bought.body.data.status).toBe("active");
    });
});

describe("MockPay, the stand-in gateway", () => {
    function interceptWebhook() {
        const sent: { body: string; signature: string }[] = [];
        vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
            const headers = init!.headers as Record<string, string>;
            sent.push({ body: init!.body as string, signature: headers[SIGNATURE_HEADER] });
            return new Response(null, { status: 200 });
        });
        return sent;
    }

    it("completing on the hosted page confirms nothing; only the signed webhook it sends does", async () => {
        const { token } = await scene();
        const { id, event } = await pendingBooking(token);
        const sent = interceptWebhook();

        const page = await api.get(`/mockpay/orders/${event.providerOrderId}`);
        expect(page.body.data).toMatchObject({
            merchant: "Zuryo",
            amountPaise: event.amountPaise,
            currency: "INR",
            status: "pending",
            returnPath: `/bookings/${id}/status`,
        });
        const done = await api.post(`/mockpay/orders/${event.providerOrderId}/complete`).send({ outcome: "success" });
        expect(done.body.data.status).toBe("paid");
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        expect((await get(token, id)).status).toBe("pending_payment"); // the redirect alone changed nothing

        const res = await sendWebhook(sent[0].body, sent[0].signature); // what the gateway's call would do
        expect(res.status).toBe(200);
        expect((await get(token, id)).status).toBe("confirmed");

        // clicking Pay again does not charge or notify again
        await api.post(`/mockpay/orders/${event.providerOrderId}/complete`).send({ outcome: "failure" });
        await new Promise((r) => setTimeout(r, 50));
        expect(sent).toHaveLength(1);
    });

    it("a failure outcome sends a signed failure webhook", async () => {
        const { token } = await scene();
        const { id, event } = await pendingBooking(token);
        const sent = interceptWebhook();
        await api.post(`/mockpay/orders/${event.providerOrderId}/complete`).send({ outcome: "failure" });
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        expect((await sendWebhook(sent[0].body, sent[0].signature)).status).toBe(200);
        expect((await get(token, id)).status).toBe("payment_failed");
    });

    it("rejects bad input and unknown orders", async () => {
        expect((await api.get("/mockpay/orders/order_nope")).status).toBe(404);
        expect((await api.post("/mockpay/orders/order_nope/complete").send({ outcome: "success" })).status).toBe(404);
        expect((await api.post("/mockpay/orders/order_nope/complete").send({ outcome: "maybe" })).status).toBe(400);
    });
});
