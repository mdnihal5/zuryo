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
import { pool } from "../src/db/pool.js";
import { completeDueSessions } from "../src/services/sessions.service.js";

afterAll(closeAll);

async function setup() {
    const zone = await makeZone();
    const trainer = await makeTrainer(zone);
    const customer = await makeCustomer(zone);
    const customerToken = await tokenFor(customer.email);
    const trainerToken = await tokenFor(trainer.email);
    const booking = await book(customerToken, { mode: "instant" }); // starts in 15 minutes, so it can be started now
    return { trainer, customer, customerToken, trainerToken, id: booking.body.data.id as number };
}

const view = (token: string, id: number, who: "bookings" | "trainer/sessions") =>
    api.get(`/v1/${who}/${id}`).set(bearer(token));

describe("session timer", () => {
    it("start sets server-side start and end times 60 minutes apart; every response has serverNow", async () => {
        const { trainerToken, customerToken, id } = await setup();
        const started = await api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(trainerToken));
        expect(started.status).toBe(200);
        const s = started.body.data.session;
        expect(new Date(s.endsAt).getTime() - new Date(s.startedAt).getTime()).toBe(60 * 60_000);
        expect(new Date(s.warningAt).getTime() - new Date(s.startedAt).getTime()).toBe(55 * 60_000);
        expect(started.body.data.phase).toBe("running");
        expect(Number.isNaN(Date.parse(started.body.serverNow))).toBe(false);

        const asCustomer = await view(customerToken, id, "bookings");
        expect(asCustomer.body.data.phase).toBe("running");
        expect(asCustomer.body.data.session.startedAt).toBe(s.startedAt);
        const err = await api.get("/v1/bookings/999999").set(bearer(customerToken));
        expect(err.status).toBe(404);
        expect(err.body.serverNow).toBeTruthy();
    });

    it("starting twice does not move the start time", async () => {
        const { trainerToken, id } = await setup();
        const a = await api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(trainerToken));
        const b = await api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(trainerToken));
        expect(b.status).toBe(200);
        expect(b.body.data.session.startedAt).toBe(a.body.data.session.startedAt);
    });

    it("phase becomes 'warning' at 55 minutes and 'completed' at 60, with the state kept on the server", async () => {
        const { trainerToken, customerToken, id } = await setup();
        await api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(trainerToken));

        await pool.query(
            "UPDATE bookings SET started_at = now() - interval '54 minutes 50 seconds', session_ends_at = now() + interval '5 minutes 10 seconds' WHERE id = $1",
            [id],
        );
        expect((await view(trainerToken, id, "trainer/sessions")).body.data.phase).toBe("running");

        await pool.query(
            "UPDATE bookings SET started_at = now() - interval '55 minutes 5 seconds', session_ends_at = now() + interval '4 minutes 55 seconds' WHERE id = $1",
            [id],
        );
        expect((await view(trainerToken, id, "trainer/sessions")).body.data.phase).toBe("warning");
        expect((await view(customerToken, id, "bookings")).body.data.phase).toBe("warning");

        await pool.query(
            "UPDATE bookings SET started_at = now() - interval '60 minutes 5 seconds', session_ends_at = now() - interval '5 seconds' WHERE id = $1",
            [id],
        );
        const done = await view(customerToken, id, "bookings");
        expect(done.body.data.status).toBe("completed");
        expect(done.body.data.phase).toBe("completed");
    });

    it("completion is idempotent: reads and the sweep racing produce one completion and two notifications", async () => {
        const { trainerToken, customerToken, id } = await setup();
        await api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(trainerToken));
        await pool.query(
            "UPDATE bookings SET started_at = now() - interval '61 minutes', session_ends_at = now() - interval '1 minute' WHERE id = $1",
            [id],
        );

        await Promise.all([
            view(customerToken, id, "bookings"),
            view(trainerToken, id, "trainer/sessions"),
            completeDueSessions(),
            completeDueSessions(),
            view(customerToken, id, "bookings"),
        ]);
        await completeDueSessions();
        expect(
            await count("SELECT count(*) n FROM notifications WHERE booking_id = $1 AND kind = 'session_completed'", [
                id,
            ]),
        ).toBe(2);
        expect((await view(customerToken, id, "bookings")).body.data.status).toBe("completed");
    });

    it("the sweep alone completes a session nobody is looking at", async () => {
        const { trainerToken, id } = await setup();
        await api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(trainerToken));
        await pool.query(
            "UPDATE bookings SET started_at = now() - interval '61 minutes', session_ends_at = now() - interval '1 minute' WHERE id = $1",
            [id],
        );
        expect(await completeDueSessions()).toBeGreaterThanOrEqual(1);
        expect((await pool.query("SELECT status FROM bookings WHERE id = $1", [id])).rows[0].status).toBe("completed");
    });

    it("cannot start more than 30 minutes early, or someone else's session", async () => {
        const zone = await makeZone();
        const trainer = await makeTrainer(zone);
        const other = await makeTrainer(zone);
        const customerToken = await tokenFor((await makeCustomer(zone)).email);
        const trainerToken = await tokenFor(trainer.email);
        const future = await book(customerToken, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const early = await api.post(`/v1/trainer/sessions/${future.body.data.id}/start`).set(bearer(trainerToken));
        expect(early.status).toBe(409);
        expect(early.body.error.code).toBe("TOO_EARLY");

        const notMine = await api
            .post(`/v1/trainer/sessions/${future.body.data.id}/start`)
            .set(bearer(await tokenFor(other.email)));
        expect(notMine.status).toBe(404);
    });

    it("the trainer records the session after completion and the customer adds feedback", async () => {
        const { trainerToken, customerToken, id } = await setup();
        const tooSoon = await api
            .put(`/v1/trainer/sessions/${id}/record`)
            .set(bearer(trainerToken))
            .send({ exercises: [{ name: "Plank", focus: "core" }], durationMinutes: 60 });
        expect(tooSoon.status).toBe(409);

        await api.post(`/v1/trainer/sessions/${id}/start`).set(bearer(trainerToken));
        await pool.query(
            "UPDATE bookings SET started_at = now() - interval '61 minutes', session_ends_at = now() - interval '1 minute' WHERE id = $1",
            [id],
        );
        const saved = await api
            .put(`/v1/trainer/sessions/${id}/record`)
            .set(bearer(trainerToken))
            .send({
                exercises: [{ name: "Plank", focus: "core", minutes: 3 }],
                durationMinutes: 58,
                trainerNotes: "Good effort",
                suggestedNextWorkout: "Legs",
            });
        expect(saved.status).toBe(200);
        await api
            .put(`/v1/bookings/${id}/feedback`)
            .set(bearer(customerToken))
            .send({ rating: 5, comment: "Loved it" });
        const record = (await api.get(`/v1/bookings/${id}/record`).set(bearer(customerToken))).body.data;
        expect(record).toMatchObject({
            durationMinutes: 58,
            trainerNotes: "Good effort",
            customerRating: 5,
            customerComment: "Loved it",
            suggestedNextWorkout: "Legs",
        });
    });
});
