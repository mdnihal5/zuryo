import { afterAll, describe, expect, it } from "vitest";
import { api, bearer, book, closeAll, makeCustomer, makeTrainer, makeZone, tokenFor, tomorrowAt } from "./helpers.js";

afterAll(closeAll);

describe("authentication", () => {
    it("rejects missing, malformed and unknown credentials with the same message", async () => {
        expect((await api.get("/v1/bookings")).status).toBe(401);
        expect((await api.get("/v1/bookings").set("Authorization", "Bearer nonsense")).status).toBe(401);
        const wrongPassword = await api.post("/v1/auth/login").send({ email: "asha@zuryo.test", password: "nope" });
        const unknownEmail = await api.post("/v1/auth/login").send({ email: "nobody@zuryo.test", password: "nope" });
        expect(wrongPassword.status).toBe(401);
        expect(unknownEmail.status).toBe(401);
        expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    });

    it("logout invalidates every token issued before", async () => {
        const token = await tokenFor("ravi@zuryo.test", "Demo@12345");
        expect((await api.get("/v1/auth/me").set(bearer(token))).status).toBe(200);
        await api.post("/v1/auth/logout").set(bearer(token));
        expect((await api.get("/v1/auth/me").set(bearer(token))).status).toBe(401);
    });

    it("never returns a password hash", async () => {
        const res = await api.post("/v1/auth/login").send({ email: "asha@zuryo.test", password: "Demo@12345" });
        expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
    });
});

describe("authorization", () => {
    it("a customer cannot read, cancel or reschedule another customer's booking (404, not 403)", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const owner = await tokenFor((await makeCustomer(zone)).email);
        const stranger = await tokenFor((await makeCustomer(zone)).email);
        const mine = await book(owner, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const id = mine.body.data.id;

        expect((await api.get(`/v1/bookings/${id}`).set(bearer(stranger))).status).toBe(404);
        expect((await api.post(`/v1/bookings/${id}/cancel`).set(bearer(stranger))).status).toBe(404);
        expect((await api.get(`/v1/bookings/${id}/record`).set(bearer(stranger))).status).toBe(404);
        expect(
            (
                await api
                    .post(`/v1/bookings/${id}/reschedule`)
                    .set(bearer(stranger))
                    .set("Idempotency-Key", "abcdefgh12")
                    .send({ startsAt: tomorrowAt(13) })
            ).status,
        ).toBe(404);
        const list = await api.get("/v1/bookings").set(bearer(stranger));
        expect(list.body.data.items).toHaveLength(0);
        expect((await api.get(`/v1/bookings/${id}`).set(bearer(owner))).status).toBe(200);
    });

    it("a trainer sees only their own sessions and cannot reach admin or customer routes", async () => {
        const zone = await makeZone();
        const t1 = await makeTrainer(zone);
        const t2 = await makeTrainer(zone);
        const customer = await tokenFor((await makeCustomer(zone)).email);
        const booking = await book(customer, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const owner = booking.body.data.trainer.id === t1.trainerId ? t1 : t2;
        const other = owner === t1 ? t2 : t1;

        const ownerToken = await tokenFor(owner.email);
        const otherToken = await tokenFor(other.email);
        expect((await api.get(`/v1/trainer/sessions/${booking.body.data.id}`).set(bearer(ownerToken))).status).toBe(
            200,
        );
        expect((await api.get(`/v1/trainer/sessions/${booking.body.data.id}`).set(bearer(otherToken))).status).toBe(
            404,
        );
        expect((await api.get("/v1/trainer/sessions").set(bearer(otherToken))).body.data.items).toHaveLength(0);

        expect((await api.get("/v1/admin/bookings").set(bearer(ownerToken))).status).toBe(403);
        expect((await api.get("/v1/admin/pricing-rules").set(bearer(ownerToken))).status).toBe(403);
        expect((await api.put("/v1/admin/pricing-rules").set(bearer(ownerToken)).send({})).status).toBe(403);
        expect((await api.get("/v1/bookings").set(bearer(ownerToken))).status).toBe(403);
    });

    it("a customer cannot use trainer or admin routes", async () => {
        const customer = await tokenFor("asha@zuryo.test", "Demo@12345");
        expect((await api.get("/v1/trainer/sessions").set(bearer(customer))).status).toBe(403);
        expect((await api.post("/v1/trainer/sessions/1/start").set(bearer(customer))).status).toBe(403);
        expect((await api.get("/v1/admin/bookings").set(bearer(customer))).status).toBe(403);
    });

    it("only the admin sees the assignment decision", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const customer = await tokenFor((await makeCustomer(zone)).email);
        const admin = await tokenFor("admin@zuryo.test", "Demo@12345");
        const b = await book(customer, { mode: "scheduled", startsAt: tomorrowAt(11) });
        expect(b.body.data.assignment).toBeUndefined();
        const asAdmin = await api.get(`/v1/admin/bookings/${b.body.data.id}`).set(bearer(admin));
        expect(asAdmin.body.data.assignment.candidates).toHaveLength(1);
        expect(asAdmin.body.data.assignment.rule).toBe("fewest_sessions_then_nearest_then_id");
        const filtered = await api.get(`/v1/admin/bookings?status=confirmed&limit=5`).set(bearer(admin));
        expect(filtered.status).toBe(200);
        expect(filtered.body.data.items.length).toBeLessThanOrEqual(5);
    });

    it("validation errors use the standard error shape, with no stack trace", async () => {
        const customer = await tokenFor("asha@zuryo.test", "Demo@12345");
        const res = await api
            .post("/v1/bookings")
            .set(bearer(customer))
            .set("Idempotency-Key", "abcdefgh12")
            .send({ mode: "scheduled", startsAt: "tomorrow" });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
        expect(res.body.error.requestId).toBeTruthy();
        expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
        const bad = await api.post("/v1/auth/login").set("Content-Type", "application/json").send("{oops");
        expect(bad.status).toBe(400);
        expect(bad.body.error.code).toBe("INVALID_JSON");
    });
});
