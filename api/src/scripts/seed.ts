import { fileURLToPath } from "node:url";
import { pool, closePool, withTransaction } from "../db/pool.js";
import { hashPassword } from "../lib/password.js";
import { computePrice } from "../lib/pricing.js";
import { addMinutes } from "../lib/ist.js";
import * as pricingQueries from "../queries/pricing.queries.js";
import type { PoolClient } from "pg";

export const DEMO_PASSWORD = "Demo@12345";
const DAY = 24 * 60;

type Person = { name: string; email: string; lat: number; lng: number };

async function addUser(c: PoolClient, role: string, p: Person, hash: string, zoneId: number | null) {
    const { rows } = await c.query(
        `INSERT INTO users (email, password_hash, name, role, zone_id, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
            p.email,
            hash,
            p.name,
            role,
            role === "customer" ? zoneId : null,
            role === "customer" ? p.lat : null,
            role === "customer" ? p.lng : null,
        ],
    );
    return rows[0].id as number;
}

async function addTrainer(
    c: PoolClient,
    p: Person,
    hash: string,
    zoneId: number,
    days: number[],
    start: string,
    end: string,
    specialties: string[],
    years: number,
) {
    const userId = await addUser(c, "trainer", p, hash, null);
    const { rows } = await c.query(
        "INSERT INTO trainers (user_id, zone_id, home_lat, home_lng, specialties, experience_years) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [userId, zoneId, p.lat, p.lng, specialties, years],
    );
    for (const weekday of days) {
        await c.query("INSERT INTO trainer_hours (trainer_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)", [
            rows[0].id,
            weekday,
            start,
            end,
        ]);
    }
    return { id: rows[0].id as number, userId };
}

// A start time `daysAhead` days from now at the given hour in Kolkata (hour is IST, so subtract 5:30 for UTC).
function istSlot(daysAhead: number, hour: number) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return new Date(d.getTime() + daysAhead * DAY * 60_000 + hour * 3_600_000 - 330 * 60_000);
}

export async function seed(reset: boolean) {
    const exists = (await pool.query("SELECT 1 FROM users LIMIT 1")).rowCount! > 0;
    if (exists && !reset) return false;

    const hash = await hashPassword(DEMO_PASSWORD);
    await withTransaction(async (c) => {
        if (reset) {
            await c.query(
                "TRUNCATE notifications, session_records, package_ledger, payment_orders, mockpay_orders, bookings, packages, fitness_profiles, trainer_time_off, trainer_hours, trainers, users, zones RESTART IDENTITY CASCADE",
            );
        }
        const zone1 = (await c.query("INSERT INTO zones (name) VALUES ('Lakeview Residency') RETURNING id")).rows[0]
            .id as number;
        const zone2 = (await c.query("INSERT INTO zones (name) VALUES ('Palm Grove') RETURNING id")).rows[0]
            .id as number;

        await addUser(c, "admin", { name: "Operations Admin", email: "admin@zuryo.test", lat: 0, lng: 0 }, hash, null);

        const asha = await addUser(
            c,
            "customer",
            { name: "Asha Rao", email: "asha@zuryo.test", lat: 17.441, lng: 78.3495 },
            hash,
            zone1,
        );
        const ravi = await addUser(
            c,
            "customer",
            { name: "Ravi Menon", email: "ravi@zuryo.test", lat: 17.438, lng: 78.352 },
            hash,
            zone1,
        );
        await addUser(
            c,
            "customer",
            { name: "Meera Iyer", email: "meera@zuryo.test", lat: 12.9721, lng: 77.5951 },
            hash,
            zone2,
        );

        const all = [1, 2, 3, 4, 5, 6, 7];
        const kiran = await addTrainer(
            c,
            { name: "Kiran Patel", email: "kiran@zuryo.test", lat: 17.442, lng: 78.35 },
            hash,
            zone1,
            all,
            "06:00",
            "21:00",
            ["strength", "weight loss"],
            8,
        );
        await addTrainer(
            c,
            { name: "Divya Nair", email: "divya@zuryo.test", lat: 17.45, lng: 78.36 },
            hash,
            zone1,
            [1, 2, 3, 4, 5, 6],
            "06:00",
            "21:00",
            ["yoga", "flexibility", "stress relief"],
            6,
        );
        await addTrainer(
            c,
            { name: "Arjun Shah", email: "arjun@zuryo.test", lat: 17.43, lng: 78.34 },
            hash,
            zone1,
            all,
            "10:00",
            "20:00",
            ["endurance", "cardio"],
            3,
        );
        await addTrainer(
            c,
            { name: "Sana Khan", email: "sana@zuryo.test", lat: 12.97, lng: 77.594 },
            hash,
            zone2,
            all,
            "06:00",
            "21:00",
            ["strength", "mobility"],
            5,
        );

        const rules = await pricingQueries.get(c);
        const pkg = (
            await c.query(
                "INSERT INTO packages (customer_id, sessions_total, idempotency_key, request_hash) VALUES ($1, 10, 'seed', 'seed') RETURNING id",
                [asha],
            )
        ).rows[0].id as number;

        await c.query(
            `INSERT INTO fitness_profiles (customer_id, age, weight_kg, goals, level, preferences) VALUES ($1, 32, 68.5, $2, 'intermediate', $3)`,
            [asha, ["weight loss", "endurance"], ["morning sessions", "no gym equipment"]],
        );

        // A booking in the past (completed) or the future (confirmed), written directly with a valid price snapshot.
        const addBooking = async (
            customer: number,
            startsAt: Date,
            status: "completed" | "confirmed",
            packageId: number | null,
            key: string,
        ) => {
            const price = computePrice(rules, startsAt);
            const endsAt = addMinutes(startsAt, 60);
            const decision = {
                preferredTrainerId: null,
                preferredEligible: false,
                rule: "fewest_sessions_then_nearest_then_id",
                candidates: [{ trainerId: kiran.id, name: "Kiran Patel", sessionsThatDay: 0, distanceKm: 0.2 }],
                lostRaceTo: [],
            };
            const { rows } = await c.query(
                `INSERT INTO bookings (customer_id, trainer_id, mode, status, starts_at, ends_at, busy_until, started_at, session_ends_at, completed_at,
           is_peak, session_price_paise, commission_paise, total_paise, package_id, idempotency_key, request_hash, assignment)
         VALUES ($1,$2,'scheduled',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'seed',$16) RETURNING id`,
                [
                    customer,
                    kiran.id,
                    status,
                    startsAt,
                    endsAt,
                    addMinutes(endsAt, 15),
                    status === "completed" ? startsAt : null,
                    status === "completed" ? endsAt : null,
                    status === "completed" ? endsAt : null,
                    price.isPeak,
                    price.sessionPricePaise,
                    price.commissionPaise,
                    price.totalPaise,
                    packageId,
                    key,
                    JSON.stringify(decision),
                ],
            );
            const id = rows[0].id as number;
            if (packageId)
                await c.query(
                    "INSERT INTO package_ledger (package_id, booking_id, delta, reason) VALUES ($1,$2,-1,'booking')",
                    [packageId, id],
                );
            else
                await c.query(
                    `INSERT INTO payment_orders (purpose, booking_id, customer_id, amount_paise, status, provider_order_id, provider_payment_id, paid_at)
         VALUES ('booking', $1, $2, $3, 'paid', $4, $5, now())`,
                    [id, customer, price.totalPaise, `seed_order_${id}`, `seed_pay_${id}`],
                );
            return id;
        };

        const history: [number, number, object[], string, number][] = [
            [
                -7,
                7,
                [
                    { name: "Bodyweight squats", focus: "lower", sets: 3, reps: 12 },
                    { name: "Plank", focus: "core", minutes: 3 },
                    { name: "Skipping", focus: "cardio", minutes: 10 },
                ],
                "Good form on squats. Next: add upper body.",
                5,
            ],
            [
                -4,
                18,
                [
                    { name: "Push-ups", focus: "upper", sets: 3, reps: 10 },
                    { name: "Dumbbell rows", focus: "upper", sets: 3, reps: 12 },
                ],
                "Strong session. Core work next time.",
                4,
            ],
            [
                -2,
                7,
                [
                    { name: "Brisk intervals", focus: "cardio", minutes: 20 },
                    { name: "Lunges", focus: "lower", sets: 3, reps: 10 },
                ],
                "Stamina is improving.",
                5,
            ],
        ];
        for (const [i, [days, hour, exercises, next, rating]] of history.entries()) {
            const id = await addBooking(asha, istSlot(days, hour), "completed", pkg, `seed-asha-${i}`);
            await c.query(
                `INSERT INTO session_records (booking_id, exercises, duration_minutes, trainer_notes, customer_rating, customer_comment, suggested_next_workout) VALUES ($1,$2,60,$3,$4,$5,$6)`,
                [id, JSON.stringify(exercises), "Synthetic demo note.", rating, "Felt great.", next],
            );
        }

        const ravisPast = await addBooking(ravi, istSlot(-3, 10), "completed", null, "seed-ravi-0");
        await c.query(`INSERT INTO session_records (booking_id, exercises, duration_minutes) VALUES ($1,$2,60)`, [
            ravisPast,
            JSON.stringify([{ name: "Plank", focus: "core", minutes: 5 }]),
        ]);

        const upcoming = await addBooking(asha, istSlot(1, 10), "confirmed", pkg, "seed-asha-upcoming");
        await c.query(
            `INSERT INTO notifications (user_id, kind, booking_id, message) VALUES ($1,'booking_assigned',$3,'Booked: Kiran Patel tomorrow at 10:00 AM.'), ($2,'booking_assigned',$3,'New session with Asha Rao tomorrow at 10:00 AM.')`,
            [asha, kiran.userId, upcoming],
        );
    });
    return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    seed(process.argv.includes("--reset"))
        .then((did) =>
            console.log(
                did
                    ? `seeded. Every demo account uses the password ${DEMO_PASSWORD}: admin@zuryo.test, asha@zuryo.test, ravi@zuryo.test, meera@zuryo.test, kiran@zuryo.test, divya@zuryo.test, arjun@zuryo.test, sana@zuryo.test`
                    : "database already has users; run with --reset to wipe and reseed",
            ),
        )
        .catch((e) => {
            console.error(e.message);
            process.exitCode = 1;
        })
        .finally(closePool);
}
