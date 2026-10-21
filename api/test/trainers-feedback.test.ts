import { afterAll, describe, expect, it } from "vitest";
import { api, bearer, book, closeAll, makeCustomer, makeTrainer, makeZone, tokenFor, tomorrowAt } from "./helpers.js";
import { pool } from "../src/db/pool.js";

afterAll(closeAll);

const complete = (id: number) =>
    pool.query(
        "UPDATE bookings SET status = 'completed', started_at = starts_at, session_ends_at = ends_at, completed_at = ends_at WHERE id = $1",
        [id],
    );
const rate = (token: string, id: number, body: object) =>
    api.put(`/v1/bookings/${id}/feedback`).set(bearer(token)).send(body);

async function completedBooking(customerToken: string, hour: number) {
    const b = await book(customerToken, { mode: "scheduled", startsAt: tomorrowAt(hour) });
    await complete(b.body.data.id);
    return b.body.data.id as number;
}

describe("trainer info for customers", () => {
    it("shows name, specialties, experience, rating and distance, and never coordinates, phone or email", async () => {
        const zone = await makeZone();
        const trainer = await makeTrainer(zone, { lat: 17.4401, lng: 78.35 });
        const token = await tokenFor((await makeCustomer(zone)).email);

        const list = await api.get("/v1/trainers").set(bearer(token));
        expect(list.status).toBe(200);
        expect(list.body.data).toHaveLength(1);
        expect(list.body.data[0]).toMatchObject({
            id: trainer.trainerId,
            specialties: ["strength", "mobility"],
            experienceYears: 4,
            rating: { average: null, count: 0 },
            sessionsWithYou: 0,
        });
        expect(list.body.data[0].distanceKm).toBeCloseTo(0.01, 1);
        expect(Object.keys(list.body.data[0]).sort()).toEqual([
            "distanceKm",
            "experienceYears",
            "id",
            "name",
            "rating",
            "sessionsWithYou",
            "specialties",
        ]);

        const slots = await api.get(`/v1/slots?date=${tomorrowAt(11).slice(0, 10)}`).set(bearer(token));
        const raw = JSON.stringify([list.body, slots.body]);
        expect(raw).not.toMatch(/home_|lat|lng|latitude|longitude|phone|@test\.local|email/i);
        expect(slots.body.data.slots[0].trainers[0]).toHaveProperty("rating");
    });

    it("averages the ratings customers gave and counts sessions with this customer", async () => {
        const zone = await makeZone();
        const trainer = await makeTrainer(zone);
        const a = await tokenFor((await makeCustomer(zone)).email);
        const b = await tokenFor((await makeCustomer(zone)).email);
        const first = await completedBooking(a, 9);
        const second = await completedBooking(b, 12);
        await rate(a, first, { rating: 5 });
        await rate(b, second, { rating: 4 });

        const seenByA = (await api.get("/v1/trainers").set(bearer(a))).body.data[0];
        expect(seenByA).toMatchObject({
            id: trainer.trainerId,
            rating: { average: 4.5, count: 2 },
            sessionsWithYou: 1,
        });
        await rate(a, first, { rating: 3 }); // changing a rating replaces it, it does not add a second one
        expect((await api.get("/v1/trainers").set(bearer(a))).body.data[0].rating).toEqual({ average: 3.5, count: 2 });
    });
});

describe("structured feedback", () => {
    it("accepts ratings 1 to 5 only", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const token = await tokenFor((await makeCustomer(zone)).email);
        const id = await completedBooking(token, 11);

        for (const bad of [
            {},
            { rating: 0 },
            { rating: 6 },
            { rating: 3.5 },
            { rating: "4" },
            { rating: 4, comment: "x".repeat(2001) },
        ]) {
            const res = await rate(token, id, bad);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe("VALIDATION_ERROR");
        }
        for (const rating of [1, 5]) expect((await rate(token, id, { rating })).status).toBe(200);
    });

    it("only the booking's customer, and only after completion", async () => {
        const zone = await makeZone();
        const trainer = await makeTrainer(zone);
        const owner = await tokenFor((await makeCustomer(zone)).email);
        const stranger = await tokenFor((await makeCustomer(zone)).email);
        const trainerToken = await tokenFor(trainer.email);
        const b = await book(owner, { mode: "scheduled", startsAt: tomorrowAt(11) });
        const id = b.body.data.id;

        const early = await rate(owner, id, { rating: 4 });
        expect(early.status).toBe(409);
        expect(early.body.error.code).toBe("SESSION_NOT_COMPLETED");

        await complete(id);
        expect((await rate(stranger, id, { rating: 1 })).status).toBe(404);
        expect((await rate(trainerToken, id, { rating: 5 })).status).toBe(403);
        const ok = await rate(owner, id, { rating: 4, comment: "  Great pacing  " });
        expect(ok.status).toBe(200);
        expect(ok.body.data).toMatchObject({ customerRating: 4, customerComment: "Great pacing" });
    });

    it("the rating shows on the booking for the customer, the trainer and the admin", async () => {
        const zone = await makeZone();
        const trainer = await makeTrainer(zone);
        const owner = await tokenFor((await makeCustomer(zone)).email);
        const id = await completedBooking(owner, 11);
        expect((await api.get(`/v1/bookings/${id}`).set(bearer(owner))).body.data.feedback).toBeNull();
        await rate(owner, id, { rating: 4, comment: "Solid" });

        const admin = await tokenFor("admin@zuryo.test", "Demo@12345");
        const views = [
            await api.get(`/v1/bookings/${id}`).set(bearer(owner)),
            await api.get(`/v1/trainer/sessions/${id}`).set(bearer(await tokenFor(trainer.email))),
            await api.get(`/v1/admin/bookings/${id}`).set(bearer(admin)),
        ];
        for (const v of views) expect(v.body.data.feedback).toEqual({ rating: 4, comment: "Solid" });
    });
});

describe("admin assignment decision", () => {
    it("names every candidate", async () => {
        const zone = await makeZone();
        const t1 = await makeTrainer(zone);
        const t2 = await makeTrainer(zone, { lat: 17.5 });
        const token = await tokenFor((await makeCustomer(zone)).email);
        const id = (await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) })).body.data.id;
        const admin = await tokenFor("admin@zuryo.test", "Demo@12345");
        const { candidates } = (await api.get(`/v1/admin/bookings/${id}`).set(bearer(admin))).body.data.assignment;
        const names = (
            await pool.query(
                "SELECT t.id, u.name FROM trainers t JOIN users u ON u.id = t.user_id WHERE t.id = ANY($1)",
                [[t1.trainerId, t2.trainerId]],
            )
        ).rows;
        for (const c of candidates) expect(c.name).toBe(names.find((n) => n.id === c.trainerId).name);
        expect(candidates).toHaveLength(2);
    });
});
