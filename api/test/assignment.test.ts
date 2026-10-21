import { afterAll, describe, expect, it } from "vitest";
import { rankTrainers } from "../src/lib/assignment.js";
import {
    api,
    bearer,
    book,
    closeAll,
    makeCustomer,
    makeTrainer,
    makeZone,
    newKey,
    tokenFor,
    tomorrowAt,
} from "./helpers.js";
import { pool } from "../src/db/pool.js";
import { recommendByRules } from "../src/lib/recommend-rules.js";

afterAll(closeAll);

const customer = { lat: 17.44, lng: 78.35 };
const t = (trainerId: number, sessionsThatDay: number, lat: number) => ({
    trainerId,
    name: `T${trainerId}`,
    sessionsThatDay,
    lat,
    lng: 78.35,
});

describe("trainer ranking", () => {
    it("fewest sessions that day wins before distance", () => {
        const { ranked } = rankTrainers([t(1, 2, 17.44), t(2, 0, 17.5)], customer);
        expect(ranked.map((r) => r.trainerId)).toEqual([2, 1]);
    });
    it("nearest wins when sessions tie, then the lower id", () => {
        expect(rankTrainers([t(1, 1, 17.5), t(2, 1, 17.45)], customer).ranked[0].trainerId).toBe(2);
        expect(rankTrainers([t(5, 1, 17.45), t(3, 1, 17.45)], customer).ranked[0].trainerId).toBe(3);
    });
    it("the preferred trainer goes first only when eligible", () => {
        expect(rankTrainers([t(1, 0, 17.44), t(2, 5, 17.9)], customer, 2)).toMatchObject({
            preferredEligible: true,
            ranked: [{ trainerId: 2 }, { trainerId: 1 }],
        });
        expect(rankTrainers([t(1, 0, 17.44)], customer, 9)).toMatchObject({
            preferredEligible: false,
            ranked: [{ trainerId: 1 }],
        });
    });
});

describe("assignment through the API", () => {
    it("assigns the preferred trainer when free, stores the decision, and falls back when not", async () => {
        const zone = await makeZone();
        const near = await makeTrainer(zone, { lat: 17.4401, lng: 78.35 });
        const far = await makeTrainer(zone, { lat: 17.6, lng: 78.5 });
        const token = await tokenFor((await makeCustomer(zone)).email);
        const admin = await tokenFor("admin@zuryo.test", "Demo@12345");

        const auto = await book(token, { mode: "scheduled", startsAt: tomorrowAt(9) });
        expect(auto.body.data.trainer.id).toBe(near.trainerId);

        const preferred = await book(token, {
            mode: "scheduled",
            startsAt: tomorrowAt(12),
            preferredTrainerId: far.trainerId,
        });
        expect(preferred.body.data.trainer.id).toBe(far.trainerId);
        const decision = (await api.get(`/v1/admin/bookings/${preferred.body.data.id}`).set(bearer(admin))).body.data
            .assignment;
        expect(decision).toMatchObject({
            preferredTrainerId: far.trainerId,
            preferredEligible: true,
            rule: "preferred_trainer",
        });
        expect(decision.candidates.map((c: { trainerId: number }) => c.trainerId)).toEqual([
            far.trainerId,
            near.trainerId,
        ]);

        // preferred trainer is on time off -> falls back to the other one
        await pool.query("INSERT INTO trainer_time_off (trainer_id, starts_at, ends_at) VALUES ($1,$2,$3)", [
            far.trainerId,
            tomorrowAt(15),
            tomorrowAt(17),
        ]);
        const fallback = await book(token, {
            mode: "scheduled",
            startsAt: tomorrowAt(15, 30),
            preferredTrainerId: far.trainerId,
        });
        expect(fallback.body.data.trainer.id).toBe(near.trainerId);
        const d2 = (await api.get(`/v1/admin/bookings/${fallback.body.data.id}`).set(bearer(admin))).body.data
            .assignment;
        expect(d2).toMatchObject({ preferredEligible: false, rule: "fewest_sessions_then_nearest_then_id" });
    });

    it("spreads work: the second booking of the day goes to the trainer with fewer sessions", async () => {
        const zone = await makeZone();
        const near = await makeTrainer(zone, { lat: 17.4401 });
        const far = await makeTrainer(zone, { lat: 17.6 });
        const token = await tokenFor((await makeCustomer(zone)).email);
        const first = await book(token, { mode: "scheduled", startsAt: tomorrowAt(9) });
        const second = await book(token, { mode: "scheduled", startsAt: tomorrowAt(13) });
        expect(first.body.data.trainer.id).toBe(near.trainerId);
        expect(second.body.data.trainer.id).toBe(far.trainerId);
    });

    it("a customer in a zone without trainers gets 409 NO_TRAINER_AVAILABLE", async () => {
        const zone = await makeZone();
        const token = await tokenFor((await makeCustomer(zone)).email);
        const res = await book(token, { mode: "scheduled", startsAt: tomorrowAt(11) });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("NO_TRAINER_AVAILABLE");
        expect(res.body.error.details.alternatives).toEqual([]);
    });

    it("an instant booking starts about 15 minutes from now", async () => {
        const zone = await makeZone();
        await makeTrainer(zone);
        const token = await tokenFor((await makeCustomer(zone)).email);
        const res = await book(token, { mode: "instant" });
        const minutes = (new Date(res.body.data.startsAt).getTime() - Date.now()) / 60_000;
        expect(res.body.data.mode).toBe("instant");
        expect(minutes).toBeGreaterThan(14);
        expect(minutes).toBeLessThan(16.1);
    });
});

describe("recommendation", () => {
    it("rules engine: needs a profile, is deterministic, focuses on what was trained least", async () => {
        const zone = await makeZone();
        const fresh = await tokenFor((await makeCustomer(zone)).email);
        expect((await api.get("/v1/recommendations/next-workout").set(bearer(fresh))).status).toBe(422);

        const asha = await tokenFor("asha@zuryo.test", "Demo@12345");
        const a = await api.get("/v1/recommendations/next-workout").set(bearer(asha));
        const b = await api.get("/v1/recommendations/next-workout").set(bearer(asha));
        expect(a.body.data.engine).toBe("rules");
        expect(a.body.data.recommendation).toEqual(b.body.data.recommendation);
        expect(a.body.data.recommendation.exercises.length).toBeGreaterThan(1);
    });

    it("history changes the plan: a recently trained area is deprioritised", () => {
        const profile = {
            age: 30,
            weight_kg: 70,
            goals: ["strength"],
            level: "intermediate" as const,
            preferences: [],
        };
        const trainedUpper = [
            { startsAt: new Date(), durationMinutes: 60, exercises: [{ name: "Push-ups", focus: "upper" as const }] },
        ];
        expect(recommendByRules(profile, trainedUpper).focus[0]).toBe("lower");
        expect(recommendByRules(profile, []).intensity).toBe("light");
    });
});

describe("profile and packages validation", () => {
    it("saves and reads a fitness profile; rejects nonsense", async () => {
        const zone = await makeZone();
        const token = await tokenFor((await makeCustomer(zone)).email);
        const bad = await api
            .put("/v1/profile")
            .set(bearer(token))
            .send({ age: 5, weightKg: 70, goals: [], level: "pro", preferences: [] });
        expect(bad.status).toBe(400);
        const ok = await api
            .put("/v1/profile")
            .set(bearer(token))
            .send({ age: 29, weightKg: 72.5, goals: ["strength"], level: "beginner", preferences: ["outdoors"] });
        expect(ok.status).toBe(200);
        expect((await api.get("/v1/profile").set(bearer(token))).body.data).toMatchObject({
            age: 29,
            weightKg: 72.5,
            level: "beginner",
        });
        expect(
            (await api.post("/v1/packages").set(bearer(token)).set("Idempotency-Key", newKey()).send({ sessions: 7 }))
                .status,
        ).toBe(400);
    });
});
