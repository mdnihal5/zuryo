import { afterAll, describe, expect, it } from "vitest";
import { computePrice, isPeak } from "../src/lib/pricing.js";
import {
    api,
    bearer,
    book,
    closeAll,
    makeCustomer,
    makeTrainer,
    makeZone,
    tokenFor,
    tomorrowAt,
    PASSWORD,
} from "./helpers.js";
import { pool } from "../src/db/pool.js";

afterAll(closeAll);

const rules = {
    normalPricePaise: 39900,
    peakPricePaise: 49900,
    commissionBps: 1000,
    peakWindows: [
        { start: "06:00", end: "09:00" },
        { start: "18:00", end: "21:00" },
    ],
};
// 2026-03-02 is a Monday; 00:30Z is 06:00 IST
const ist = (hhmm: string) => new Date(new Date(`2026-03-02T${hhmm}:00Z`).getTime() - 330 * 60_000);

describe("price calculation", () => {
    it("normal slot: 399.00 + 39.90 = 438.90", () => {
        expect(computePrice(rules, ist("11:00"))).toEqual({
            isPeak: false,
            sessionPricePaise: 39900,
            commissionPaise: 3990,
            totalPaise: 43890,
        });
    });
    it("peak slot: 499.00 + 49.90 = 548.90", () => {
        expect(computePrice(rules, ist("19:00"))).toEqual({
            isPeak: true,
            sessionPricePaise: 49900,
            commissionPaise: 4990,
            totalPaise: 54890,
        });
    });
    it("peak windows are start-inclusive, end-exclusive, in Kolkata time", () => {
        const peak = (t: string) => isPeak(ist(t), rules.peakWindows);
        expect([peak("05:59"), peak("06:00"), peak("08:59"), peak("09:00")]).toEqual([false, true, true, false]);
        expect([peak("17:59"), peak("18:00"), peak("20:59"), peak("21:00")]).toEqual([false, true, true, false]);
    });
    it("commission rounds half up in integer paise", () => {
        expect(
            computePrice({ ...rules, normalPricePaise: 10005, commissionBps: 1000 }, ist("11:00")).commissionPaise,
        ).toBe(1001);
    });
});

describe("pricing through the API", () => {
    it("ignores an amount sent by the client and snapshots the price on the booking", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const token = await tokenFor((await makeCustomer(zone)).email);
        const res = await book(token, {
            mode: "scheduled",
            startsAt: tomorrowAt(19),
            amount: 1,
            totalPaise: 1,
            price: { totalPaise: 1 },
        });
        expect(res.status).toBe(201);
        expect(res.body.data.price).toEqual({
            isPeak: true,
            sessionPricePaise: 49900,
            commissionPaise: 4990,
            totalPaise: 54890,
        });
        const paid = await pool.query("SELECT amount_paise FROM payment_orders WHERE booking_id = $1", [
            res.body.data.id,
        ]);
        expect(paid.rows[0].amount_paise).toBe(54890);
    });

    it("the quote endpoint shows the breakdown before payment", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const token = await tokenFor((await makeCustomer(zone)).email);
        const res = await api
            .get(`/v1/quote?mode=scheduled&startsAt=${encodeURIComponent(tomorrowAt(11))}`)
            .set(bearer(token));
        expect(res.body.data).toMatchObject({
            isPeak: false,
            sessionPricePaise: 39900,
            commissionPaise: 3990,
            totalPaise: 43890,
        });
    });

    it("an admin rule change affects new bookings only; existing bookings keep their snapshot", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const token = await tokenFor((await makeCustomer(zone)).email);
        const admin = await tokenFor("admin@zuryo.test", "Demo@12345");
        expect(PASSWORD).toBeTruthy();

        const before = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const original = (await api.get("/v1/admin/pricing-rules").set(bearer(admin))).body.data;
        try {
            const put = await api
                .put("/v1/admin/pricing-rules")
                .set(bearer(admin))
                .send({ ...original, normalPricePaise: 50000, commissionBps: 500 });
            expect(put.status).toBe(200);
            const after = await book(token, { mode: "scheduled", startsAt: tomorrowAt(13) });
            expect(after.body.data.price).toMatchObject({
                sessionPricePaise: 50000,
                commissionPaise: 2500,
                totalPaise: 52500,
            });
            const old = await api.get(`/v1/bookings/${before.body.data.id}`).set(bearer(token));
            expect(old.body.data.price.totalPaise).toBe(43890);
        } finally {
            await api.put("/v1/admin/pricing-rules").set(bearer(admin)).send(original);
        }
    });

    it("rejects invalid pricing rules", async () => {
        const admin = await tokenFor("admin@zuryo.test", "Demo@12345");
        const bad = await api
            .put("/v1/admin/pricing-rules")
            .set(bearer(admin))
            .send({
                normalPricePaise: -5,
                peakPricePaise: 1,
                commissionBps: 99999,
                peakWindows: [{ start: "10:00", end: "09:00" }],
            });
        expect(bad.status).toBe(400);
        expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    });
});
