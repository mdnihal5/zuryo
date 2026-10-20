import { randomUUID } from "node:crypto";
import { sign, SIGNATURE_HEADER } from "../src/lib/mockpay.js";
import { config } from "../src/config/index.js";
import request from "supertest";
import { app } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { hashPassword } from "../src/lib/password.js";
import { addMinutes, istMidnight, istParts } from "../src/lib/ist.js";

const server = app.listen(0); // one server for the whole file, instead of one per request
export const api = request(server);
export const PASSWORD = "Test@12345";
const passwordHash = await hashPassword(PASSWORD);
let counter = 0;
const unique = () => `${Date.now().toString(36)}${counter++}`;

export async function makeZone() {
    const { rows } = await pool.query("INSERT INTO zones (name) VALUES ($1) RETURNING id", [`zone-${unique()}`]);
    return rows[0].id as number;
}

async function makeUser(role: string, zoneId: number | null, lat: number | null, lng: number | null) {
    const email = `${role}-${unique()}@test.local`;
    const { rows } = await pool.query(
        "INSERT INTO users (email, password_hash, name, role, zone_id, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [email, passwordHash, `${role} ${email.split("@")[0]}`, role, zoneId, lat, lng],
    );
    return { id: rows[0].id as number, email };
}

export const makeCustomer = (zoneId: number) => makeUser("customer", zoneId, 17.44, 78.35);

export async function makeTrainer(zoneId: number, opts: { lat?: number; lng?: number } = {}) {
    const user = await makeUser("trainer", null, null, null);
    const { rows } = await pool.query(
        "INSERT INTO trainers (user_id, zone_id, home_lat, home_lng, specialties, experience_years) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [user.id, zoneId, opts.lat ?? 17.44, opts.lng ?? 78.35, ["strength", "mobility"], 4],
    );
    const trainerId = rows[0].id as number;
    await pool.query(
        "INSERT INTO trainer_hours (trainer_id, weekday, start_time, end_time) SELECT $1, d, '00:00', '23:59' FROM generate_series(1,7) d",
        [trainerId],
    );
    return { ...user, trainerId };
}

export async function tokenFor(email: string, password = PASSWORD) {
    const res = await api.post("/v1/auth/login").send({ email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    return res.body.data.token as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const newKey = () => randomUUID();

// A grid slot on tomorrow's Kolkata calendar day, e.g. tomorrowAt(11) = 11:00 IST tomorrow, tomorrowAt(11, 30) = 11:30.
// Tomorrow is always at least 15 minutes away and inside the booking window, whatever time the tests run.
export function tomorrowAt(hour: number, minute = 0, daysAhead = 1) {
    const today = istParts(new Date()).date;
    const midnight = istMidnight(today);
    return addMinutes(midnight, daysAhead * 24 * 60 + hour * 60 + minute).toISOString();
}

// ---- payment gateway helpers: the tests play the part of MockPay and call the webhook themselves ----

export function webhookBody(o: {
    providerOrderId: string;
    amountPaise: number;
    outcome?: "success" | "failure";
    paymentId?: string;
    orderAmountPaise?: number;
}) {
    const ok = (o.outcome ?? "success") === "success";
    return {
        type: ok ? "PAYMENT_SUCCESS_WEBHOOK" : "PAYMENT_FAILED_WEBHOOK",
        event_time: new Date().toISOString(),
        data: {
            order: {
                order_id: o.providerOrderId,
                order_amount_paise: o.orderAmountPaise ?? o.amountPaise,
                order_currency: "INR",
            },
            payment: {
                payment_id: o.paymentId ?? `pay_${randomUUID().slice(0, 12)}`,
                payment_status: ok ? "SUCCESS" : "FAILED",
                payment_amount_paise: o.amountPaise,
                payment_currency: "INR",
            },
        },
    };
}

// Sends exactly the bytes it signs, like the gateway does.
export const sendWebhook = (body: object | string, signature?: string | null) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const req = api.post("/v1/payments/webhook").set("Content-Type", "application/json");
    if (signature !== null) req.set(SIGNATURE_HEADER, signature ?? sign(raw, config.webhookSecret));
    return req.send(raw);
};

export const payOrder = (o: Parameters<typeof webhookBody>[0]) => sendWebhook(webhookBody(o));

type Reply = Awaited<ReturnType<typeof bookPending>>;

// A booking that was created waiting for payment is paid here (webhook), then the reply shows the fresh booking.
async function settleIfPending(token: string, res: Reply) {
    const b = res.body?.data;
    if (res.status === 201 && b?.status === "pending_payment") {
        const paid = await payOrder({ providerOrderId: b.payment.providerOrderId, amountPaise: b.price.totalPaise });
        if (paid.status !== 200) throw new Error(`webhook failed: ${paid.status} ${JSON.stringify(paid.body)}`);
        res.body.data = (await api.get(`/v1/bookings/${b.id}`).set(bearer(token))).body.data;
    }
    return res;
}

export const bookPending = (token: string, body: object, key = newKey()) =>
    api.post("/v1/bookings").set(bearer(token)).set("Idempotency-Key", key).send(body);

// Books and, for a paid booking, completes the payment, so most tests can keep treating a booking as confirmed.
export const book = async (token: string, body: object, key = newKey()) =>
    settleIfPending(token, await bookPending(token, body, key));

export const reschedulePending = (token: string, id: number, startsAt: string, key = newKey()) =>
    api.post(`/v1/bookings/${id}/reschedule`).set(bearer(token)).set("Idempotency-Key", key).send({ startsAt });
export const reschedule = async (token: string, id: number, startsAt: string, key = newKey()) =>
    settleIfPending(token, await reschedulePending(token, id, startsAt, key));

export const buyPackagePending = (token: string, sessions: number, key = newKey()) =>
    api.post("/v1/packages").set(bearer(token)).set("Idempotency-Key", key).send({ sessions });
export async function buyPackage(token: string, sessions: number, key = newKey()) {
    const res = await buyPackagePending(token, sessions, key);
    if (res.status === 201 && res.body.data.status === "pending_payment") {
        const price = (
            await pool.query("SELECT amount_paise FROM payment_orders WHERE provider_order_id = $1", [
                res.body.data.providerOrderId,
            ])
        ).rows[0].amount_paise as number;
        await payOrder({ providerOrderId: res.body.data.providerOrderId, amountPaise: price });
        res.body.data = (await api.get("/v1/packages").set(bearer(token))).body.data.find(
            (p: { id: number }) => p.id === res.body.data.id,
        );
    }
    return res;
}

export async function count(sql: string, params: unknown[] = []) {
    return Number((await pool.query(sql, params)).rows[0].n);
}

export async function closeAll() {
    server.close();
    await pool.end();
}
