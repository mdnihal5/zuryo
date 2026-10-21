import { afterAll, describe, expect, it } from "vitest";
import {
    api,
    buyPackage,
    bearer,
    book,
    closeAll,
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

async function setup(sessions: number) {
    const zone = await makeZone();
    for (let i = 0; i < 6; i++) await makeTrainer(zone); // plenty of trainers so only the package can be the limit
    const customer = await makeCustomer(zone);
    const token = await tokenFor(customer.email);
    const pkg = await buyPackage(token, sessions);
    return { customer, token, packageId: pkg.body.data.id as number };
}

const packageOf = async (token: string, id: number) =>
    (
        (await api.get("/v1/packages").set(bearer(token))).body.data as {
            id: number;
            purchased: number;
            used: number;
            remaining: number;
        }[]
    ).find((p) => p.id === id)!;

describe("package balance", () => {
    it("shows purchased, used and remaining", async () => {
        const { token, packageId } = await setup(5);
        expect(await packageOf(token, packageId)).toMatchObject({ purchased: 5, used: 0, remaining: 5 });
        await book(token, { mode: "scheduled", startsAt: tomorrowAt(9), packageId });
        expect(await packageOf(token, packageId)).toMatchObject({ purchased: 5, used: 1, remaining: 4 });
    });

    it("a retried request deducts once", async () => {
        const { token, packageId } = await setup(5);
        const key = newKey();
        const body = { mode: "scheduled", startsAt: tomorrowAt(9), packageId };
        await book(token, body, key);
        await book(token, body, key);
        expect((await packageOf(token, packageId)).remaining).toBe(4);
    });

    it("with 1 session left, 6 parallel bookings on different slots: one succeeds, the balance never goes negative", async () => {
        const { customer, token, packageId } = await setup(5);
        // use 4 of 5 first
        for (const h of [8, 9, 10, 11])
            expect((await book(token, { mode: "scheduled", startsAt: tomorrowAt(h), packageId })).status).toBe(201);
        const results = await Promise.all(
            [13, 14, 15, 16, 17, 19].map((h) => book(token, { mode: "scheduled", startsAt: tomorrowAt(h), packageId })),
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === "PACKAGE_EMPTY")).toBe(true);
        expect(await packageOf(token, packageId)).toMatchObject({ used: 5, remaining: 0 });
        expect(
            await count(
                "SELECT count(*) n FROM package_ledger l JOIN bookings b ON b.id = l.booking_id WHERE b.customer_id = $1",
                [customer.id],
            ),
        ).toBe(5);
    });

    it("the database itself refuses a second deduction or refund for the same booking", async () => {
        const { token, packageId } = await setup(5);
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(9), packageId });
        await expect(
            pool.query(
                "INSERT INTO package_ledger (package_id, booking_id, delta, reason) VALUES ($1,$2,-1,'booking')",
                [packageId, b.body.data.id],
            ),
        ).rejects.toMatchObject({ code: "23505" });
    });

    it("another customer cannot spend my package", async () => {
        const { packageId } = await setup(5);
        const other = await makeCustomer(
            (await pool.query("SELECT id FROM zones ORDER BY id DESC LIMIT 1")).rows[0].id,
        );
        const res = await book(await tokenFor(other.email), { mode: "scheduled", startsAt: tomorrowAt(9), packageId });
        expect(res.status).toBe(404);
    });
});

describe("cancellation and refunds", () => {
    it("cancel before the deadline refunds a single payment exactly once, even with parallel cancels", async () => {
        const { token } = await setup(5);
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const results = await Promise.all(
            Array.from({ length: 5 }, () => api.post(`/v1/bookings/${b.body.data.id}/cancel`).set(bearer(token))),
        );
        expect(results.every((r) => r.status === 200 && r.body.data.status === "cancelled")).toBe(true);
        expect(results[0].body.data.payment.refunded).toBe(true);
        expect(
            await count("SELECT count(*) n FROM payment_orders WHERE booking_id = $1 AND status = 'refunded'", [
                b.body.data.id,
            ]),
        ).toBe(1);
        expect(
            await count("SELECT count(*) n FROM notifications WHERE booking_id = $1 AND kind = 'booking_cancelled'", [
                b.body.data.id,
            ]),
        ).toBe(2);
    });

    it("cancel before the deadline returns a package session exactly once", async () => {
        const { token, packageId } = await setup(5);
        const b = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11), packageId });
        expect((await packageOf(token, packageId)).remaining).toBe(4);
        await Promise.all(
            Array.from({ length: 4 }, () => api.post(`/v1/bookings/${b.body.data.id}/cancel`).set(bearer(token))),
        );
        expect(await packageOf(token, packageId)).toMatchObject({ used: 0, remaining: 5 });
        expect(
            await count("SELECT count(*) n FROM package_ledger WHERE booking_id = $1 AND reason = 'refund'", [
                b.body.data.id,
            ]),
        ).toBe(1);
    });

    it("cancel inside the 2-hour window gives nothing back", async () => {
        const { token, packageId } = await setup(5);
        const single = await book(token, { mode: "instant" }); // starts in 15 minutes
        const viaPackage = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11), packageId });
        // pretend the package booking is now 110 minutes away
        await pool.query(
            "UPDATE bookings SET starts_at = now() + interval '110 minutes', ends_at = now() + interval '170 minutes', busy_until = now() + interval '185 minutes' WHERE id = $1",
            [viaPackage.body.data.id],
        );

        const a = await api.post(`/v1/bookings/${single.body.data.id}/cancel`).set(bearer(token));
        const b = await api.post(`/v1/bookings/${viaPackage.body.data.id}/cancel`).set(bearer(token));
        expect(a.body.data.status).toBe("cancelled");
        expect(a.body.data.payment.refunded).toBe(false);
        expect(b.body.data.payment.refunded).toBe(false);
        expect((await packageOf(token, packageId)).remaining).toBe(4);
        expect(
            await count("SELECT count(*) n FROM payment_orders WHERE booking_id = $1 AND status = 'paid'", [
                single.body.data.id,
            ]),
        ).toBe(1);
    });
});
