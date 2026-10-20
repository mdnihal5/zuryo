// `npm run stress`: builds a throwaway Postgres (port 55490) with extra synthetic data, starts the API on
// port 4500, hammers it with three scenarios, checks the data invariants in SQL, then stops and deletes everything.
// Rate limits are switched off for this run only (RATE_LIMIT_ENABLED=false in the API's environment below).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, existsSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";
import bcrypt from "bcryptjs";
import { sign, SIGNATURE_HEADER } from "../src/lib/mockpay.js";

const PG_BIN = process.env.PG_BIN ?? "/usr/lib/postgresql/18/bin";
const PG_PORT = 55490;
const API_PORT = 4500;
const API = `http://127.0.0.1:${API_PORT}/v1`;
const MIXED_SECONDS = Number(process.env.STRESS_SECONDS ?? 60);
const CONCURRENCY = 50;

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, ".tmp-stress");
const data = join(dir, "data");
const dbUrl = `postgres://postgres@127.0.0.1:${PG_PORT}/zuryo_stress`;
const WEBHOOK_SECRET = "stress-webhook-secret-stress-123456";
const GATEWAY = `http://127.0.0.1:${API_PORT}/mockpay`;
const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
    SEED_ALLOW_PRODUCTION: "1", // throwaway database
    PORT: String(API_PORT),
    DATABASE_URL: dbUrl,
    JWT_SECRET: "stress-secret-stress-secret-stress-secret-123",
    BCRYPT_COST: "4",
    RATE_LIMIT_ENABLED: "false",
    LOG_LEVEL: "info",
    // MockPay posts its webhooks back to this same API over real HTTP.
    MOCKPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    MOCKPAY_WEBHOOK_DELAY_MS: "20",
    PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
};
const PASSWORD = "Demo@12345";

const quiet = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8" });
const tsx = (script: string) =>
    spawnSync(process.execPath, ["--import", "tsx", script], { cwd: root, env, stdio: "inherit" });

function stopPostgres() {
    if (existsSync(join(data, "postmaster.pid"))) quiet(`${PG_BIN}/pg_ctl`, ["-D", data, "-m", "fast", "-w", "stop"]);
}

// ---------- results ----------
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// ---------- http + stats ----------
type Stat = { ms: number[]; status: Map<number, number> };
type Stats = Map<string, Stat>;
const newStats = (): Stats => new Map();

type Reply = { status: number; body: any };
async function call(
    stats: Stats,
    label: string,
    method: string,
    path: string,
    token: string,
    opts: { body?: object; key?: string } = {},
): Promise<Reply> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (opts.key) headers["Idempotency-Key"] = opts.key;
    const started = performance.now();
    let status = 0;
    let body: any = null;
    try {
        const res = await fetch(`${API}${path}`, {
            method,
            headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
        status = res.status;
        body = await res.json().catch(() => null);
    } catch {
        status = 0; // network failure
    }
    const s: Stat = stats.get(label) ?? { ms: [], status: new Map<number, number>() };
    s.ms.push(performance.now() - started);
    s.status.set(status, (s.status.get(status) ?? 0) + 1);
    stats.set(label, s);
    return { status, body };
}

// What the customer's browser does on the hosted page: press Pay (or Simulate failure). MockPay then calls our webhook.
async function gatewayComplete(stats: Stats, providerOrderId: string, outcome: "success" | "failure") {
    const started = performance.now();
    const res = await fetch(`${GATEWAY}/orders/${providerOrderId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
    }).catch(() => null);
    const s: Stat = stats.get("POST /mockpay complete") ?? { ms: [], status: new Map<number, number>() };
    s.ms.push(performance.now() - started);
    s.status.set(res?.status ?? 0, (s.status.get(res?.status ?? 0) ?? 0) + 1);
    stats.set("POST /mockpay complete", s);
}

// Pays a booking that came back pending_payment. Package bookings are confirmed already and need nothing.
async function payIfPending(stats: Stats, reply: Reply, outcome: "success" | "failure" = "success") {
    if (reply.status === 201 && reply.body.data.status === "pending_payment")
        await gatewayComplete(stats, reply.body.data.payment.providerOrderId, outcome);
}

// Waits until every booking whose payment the gateway has already finished has been settled by a webhook.
async function waitForWebhooks(db: pg.Client, seconds = 30) {
    const pending = () =>
        db
            .query(
                `SELECT count(*)::int AS n FROM bookings b JOIN payment_orders o ON o.booking_id = b.id
         JOIN mockpay_orders m ON m.provider_order_id = o.provider_order_id
         WHERE b.status = 'pending_payment' AND m.outcome IS NOT NULL`,
            )
            .then((r) => r.rows[0].n as number);
    for (let i = 0; i < seconds * 10 && (await pending()) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    return pending();
}

const pct = (sorted: number[], p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

function printStats(stats: Stats, seconds: number) {
    console.log(
        "endpoint".padEnd(28),
        "n".padStart(7),
        "rps".padStart(7),
        "p50".padStart(7),
        "p95".padStart(7),
        "p99".padStart(7),
        " statuses",
    );
    for (const [label, s] of [...stats].sort()) {
        const sorted = [...s.ms].sort((a, b) => a - b);
        const statuses = [...s.status]
            .sort()
            .map(([k, v]) => `${k}:${v}`)
            .join(" ");
        console.log(
            label.padEnd(28),
            String(sorted.length).padStart(7),
            (sorted.length / seconds).toFixed(1).padStart(7),
            pct(sorted, 50).toFixed(0).padStart(7),
            pct(sorted, 95).toFixed(0).padStart(7),
            pct(sorted, 99).toFixed(0).padStart(7),
            " " + statuses,
        );
    }
}

// ---------- time helpers (Asia/Kolkata is UTC+5:30, no daylight saving) ----------
const IST_MS = 330 * 60_000;
function istDate(daysAhead: number) {
    return new Date(Date.now() + IST_MS + daysAhead * 86_400_000).toISOString().slice(0, 10);
}
function slotAt(daysAhead: number, hour: number, minute = 0) {
    const midnightIst = Date.parse(`${istDate(0)}T00:00:00Z`) - IST_MS;
    return new Date(midnightIst + daysAhead * 86_400_000 + (hour * 60 + minute) * 60_000).toISOString();
}

// ---------- synthetic data ----------
type Customer = { id: number; email: string; zone: number; token: string; packageId: number | null };

async function seedSynthetic(db: pg.Client) {
    const hash = bcrypt.hashSync(PASSWORD, 4);
    const zones: number[] = [];
    for (const name of ["Stress A", "Stress B", "Stress C"]) {
        zones.push((await db.query("INSERT INTO zones (name) VALUES ($1) RETURNING id", [name])).rows[0].id);
    }
    const coords = () => [17.4 + Math.random() * 0.05, 78.3 + Math.random() * 0.05];
    for (let i = 0; i < 30; i++) {
        const userId = (
            await db.query(
                "INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,'trainer') RETURNING id",
                [`stress-trainer-${i}@stress.test`, hash, `Stress Trainer ${i}`],
            )
        ).rows[0].id;
        const [lat, lng] = coords();
        const trainerId = (
            await db.query(
                "INSERT INTO trainers (user_id, zone_id, home_lat, home_lng, specialties, experience_years) VALUES ($1,$2,$3,$4,'{strength}',3) RETURNING id",
                [userId, zones[Math.floor(i / 10)], lat, lng],
            )
        ).rows[0].id;
        await db.query(
            "INSERT INTO trainer_hours (trainer_id, weekday, start_time, end_time) SELECT $1, d, '00:00', '23:59' FROM generate_series(1,7) d",
            [trainerId],
        );
    }
    // 200 customers in zone A (the thundering herd), 50 each in B (retry storm) and C. Every second one has a 20-session package.
    const layout = [...Array(200).fill(0), ...Array(50).fill(1), ...Array(50).fill(2)];
    for (const [i, z] of layout.entries()) {
        const [lat, lng] = coords();
        const id = (
            await db.query(
                "INSERT INTO users (email, password_hash, name, role, zone_id, lat, lng) VALUES ($1,$2,$3,'customer',$4,$5,$6) RETURNING id",
                [`stress-customer-${i}@stress.test`, hash, `Stress Customer ${i}`, zones[z], lat, lng],
            )
        ).rows[0].id;
        if (i % 2 === 0) {
            await db.query(
                "INSERT INTO packages (customer_id, sessions_total, idempotency_key, request_hash) VALUES ($1, 20, 'stress-seed', 'stress')",
                [id],
            );
        }
    }
}

async function loadCustomers(db: pg.Client): Promise<Customer[]> {
    const { rows } = await db.query(
        `SELECT u.id, u.email, u.zone_id AS zone, (SELECT p.id FROM packages p WHERE p.customer_id = u.id LIMIT 1) AS "packageId"
     FROM users u WHERE u.email LIKE 'stress-customer-%@stress.test' ORDER BY u.id`,
    );
    const customers: Customer[] = rows.map((r) => ({ ...r, token: "" }));
    for (let i = 0; i < customers.length; i += 25) {
        await Promise.all(
            customers.slice(i, i + 25).map(async (c) => {
                const res = await fetch(`${API}/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: c.email, password: PASSWORD }),
                });
                c.token = (await res.json()).data.token;
            }),
        );
    }
    return customers;
}

// ---------- scenarios ----------
async function thunderingHerd(customers: Customer[], db: pg.Client) {
    console.log("\n== A. Thundering herd: 200 customers, one zone, 100 instant + 100 scheduled at once ==");
    const herd = customers.slice(0, 200);
    const zoneId = herd[0].zone;
    const trainers = Number(
        (await db.query("SELECT count(*) AS n FROM trainers WHERE zone_id = $1", [zoneId])).rows[0].n,
    );
    const slot = slotAt(1, 11);
    const stats = newStats();
    const replies = await Promise.all(
        herd.map((c, i) =>
            call(stats, i < 100 ? "POST /bookings instant" : "POST /bookings scheduled", "POST", "/bookings", c.token, {
                key: `herd-${c.id}-0001`,
                body: i < 100 ? { mode: "instant" } : { mode: "scheduled", startsAt: slot },
            }),
        ),
    );
    printStats(stats, 1);
    await Promise.all(replies.map((r) => payIfPending(newStats(), r)));
    check("herd: every payment settled by webhook", (await waitForWebhooks(db)) === 0);
    const ok = (from: number, to: number) => replies.slice(from, to).filter((r) => r.status === 201).length;
    const losers = replies.filter((r) => r.status !== 201);
    check(`instant: successes == eligible trainers (${trainers})`, ok(0, 100) === trainers, `got ${ok(0, 100)}`);
    check(`scheduled: successes == eligible trainers (${trainers})`, ok(100, 200) === trainers, `got ${ok(100, 200)}`);
    check(
        "every loser is 409 NO_TRAINER_AVAILABLE with alternatives",
        losers.every(
            (r) =>
                r.status === 409 &&
                r.body?.error?.code === "NO_TRAINER_AVAILABLE" &&
                Array.isArray(r.body.error.details?.alternatives) &&
                r.body.error.details.alternatives.length > 0,
        ),
        `${losers.length} losers`,
    );
    check(
        "zero 5xx",
        replies.every((r) => r.status < 500 && r.status !== 0),
    );
}

async function retryStorm(customers: Customer[], db: pg.Client) {
    console.log("\n== B. Retry storm: 50 customers x 5 concurrent identical requests, same Idempotency-Key ==");
    const group = customers.slice(200, 250);
    const stats = newStats();
    const results = await Promise.all(
        group.map(async (c, i) => {
            const body = {
                mode: "scheduled",
                startsAt: slotAt(2 + Math.floor(i / 20), 6 + (i % 20) / 2),
                ...(c.packageId ? { packageId: c.packageId } : {}),
            };
            const replies = await Promise.all(
                Array.from({ length: 5 }, () =>
                    call(stats, "POST /bookings (retry)", "POST", "/bookings", c.token, {
                        key: `storm-${c.id}-0001`,
                        body,
                    }),
                ),
            );
            return { c, replies };
        }),
    );
    printStats(stats, 1);
    check(
        "all 5 replies per customer carry the same payment order",
        results.every(({ replies }) =>
            replies.every((r) => r.body.data.payment.providerOrderId === replies[0].body.data.payment.providerOrderId),
        ),
    );
    const allSameBooking = results.every(({ replies }) =>
        replies.every((r) => r.status === 201 && r.body.data.id === replies[0].body.data.id),
    );
    check("all 5 replies per customer are the same booking (201)", allSameBooking);
    const ids = group.map((c) => c.id);
    const bookings = (
        await db.query("SELECT customer_id, count(*)::int AS n FROM bookings WHERE customer_id = ANY($1) GROUP BY 1", [
            ids,
        ])
    ).rows;
    check("exactly one booking per customer", bookings.length === 50 && bookings.every((r) => r.n === 1));
    // 5 concurrent success webhooks per order, signed like the gateway signs them: one confirmation each.
    const webhookResults = await Promise.all(
        results.flatMap(({ replies }) => {
            const b = replies[0].body.data;
            if (b.status !== "pending_payment") return [];
            const raw = JSON.stringify({
                type: "PAYMENT_SUCCESS_WEBHOOK",
                event_time: new Date().toISOString(),
                data: {
                    order: {
                        order_id: b.payment.providerOrderId,
                        order_amount_paise: b.price.totalPaise,
                        order_currency: "INR",
                    },
                    payment: {
                        payment_id: `storm_${b.id}`,
                        payment_status: "SUCCESS",
                        payment_amount_paise: b.price.totalPaise,
                        payment_currency: "INR",
                    },
                },
            });
            return [
                Promise.all(
                    Array.from({ length: 5 }, () =>
                        fetch(`http://127.0.0.1:${API_PORT}/v1/payments/webhook`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                [SIGNATURE_HEADER]: sign(raw, WEBHOOK_SECRET),
                            },
                            body: raw,
                        }).then(async (r) => ({ status: r.status, result: (await r.json()).data?.result as string })),
                    ),
                ),
            ];
        }),
    );
    check(
        "5 concurrent identical webhooks per order: all 200, exactly one confirmed, four replays",
        webhookResults.length > 0 &&
            webhookResults.every(
                (w) =>
                    w.every((x) => x.status === 200) &&
                    w.filter((x) => x.result === "confirmed").length === 1 &&
                    w.filter((x) => x.result === "replay").length === 4,
            ),
        `${webhookResults.length} orders`,
    );
    const notified = (
        await db.query(
            "SELECT booking_id, count(*)::int AS n FROM notifications WHERE kind = 'booking_assigned' AND booking_id IN (SELECT id FROM bookings WHERE customer_id = ANY($1)) GROUP BY 1",
            [ids],
        )
    ).rows;
    check(
        "one set of notifications (2) per confirmed booking",
        notified.every((r) => r.n === 2),
    );
    const charges = (
        await db.query(
            `SELECT b.customer_id, (SELECT count(*) FROM payment_orders p WHERE p.booking_id = b.id) + (SELECT count(*) FROM package_ledger l WHERE l.booking_id = b.id AND l.reason = 'booking') AS n
     FROM bookings b WHERE b.customer_id = ANY($1)`,
            [ids],
        )
    ).rows;
    check(
        "exactly one charge per customer (payment order or ledger -1)",
        charges.length === 50 && charges.every((r) => Number(r.n) === 1),
    );
}

async function mixedLoad(customers: Customer[], db: pg.Client) {
    console.log(`\n== C. Mixed load: ${MIXED_SECONDS}s, ${CONCURRENCY} concurrent workers ==`);
    const stats = newStats();
    const open: { token: string; id: number }[] = [];
    const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
    const deadline = Date.now() + MIXED_SECONDS * 1000;

    async function step() {
        const c = pick(customers);
        const r = Math.random();
        if (r < 0.3)
            return void (await call(
                stats,
                "GET /slots",
                "GET",
                `/slots?date=${istDate(1 + Math.floor(Math.random() * 7))}`,
                c.token,
            ));
        if (r < 0.5)
            return void (await call(
                stats,
                "GET /quote",
                "GET",
                `/quote?mode=scheduled&startsAt=${encodeURIComponent(slotAt(1 + Math.floor(Math.random() * 7), 6 + Math.floor(Math.random() * 14)))}`,
                c.token,
            ));
        if (r < 0.7)
            return void (await call(stats, "GET /bookings", "GET", "/bookings?view=upcoming&limit=20", c.token));
        if (r < 0.9) {
            const instant = Math.random() < 0.2;
            const body = instant
                ? { mode: "instant" }
                : {
                      mode: "scheduled",
                      startsAt: slotAt(
                          1 + Math.floor(Math.random() * 10),
                          Math.floor(Math.random() * 23),
                          Math.random() < 0.5 ? 0 : 30,
                      ),
                  };
            const usePackage = c.packageId && Math.random() < 0.5;
            const res = await call(stats, "POST /bookings", "POST", "/bookings", c.token, {
                key: `mix-${randomKey()}`,
                body: usePackage ? { ...body, packageId: c.packageId } : body,
            });
            if (res.status === 201) {
                // 70% pay, 15% fail at the gateway, 15% walk away (the hold just sits there)
                const dice = Math.random();
                if (dice < 0.7) await payIfPending(stats, res);
                else if (dice < 0.85) await payIfPending(stats, res, "failure");
                open.push({ token: c.token, id: res.body.data.id });
            }
            return;
        }
        const target = open.splice(Math.floor(Math.random() * open.length), 1)[0];
        if (target)
            await call(stats, "POST /bookings/:id/cancel", "POST", `/bookings/${target.id}/cancel`, target.token);
    }

    await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
            while (Date.now() < deadline) await step();
        }),
    );
    printStats(stats, MIXED_SECONDS);
    const unsettled = await waitForWebhooks(db);
    check(
        "every payment the gateway finished was settled by its webhook",
        unsettled === 0,
        `${unsettled} still pending`,
    );
    const total = [...stats.values()].reduce((n, s) => n + s.ms.length, 0);
    console.log(`total ${total} requests, ${(total / MIXED_SECONDS).toFixed(1)} req/s`);
    const bad = [...stats.values()].flatMap((s) => [...s.status]).filter(([status]) => status >= 500 || status === 0);
    check("mixed load: zero 5xx / network errors", bad.length === 0, bad.map(([s, n]) => `${s}:${n}`).join(" "));
}

let keyCounter = 0;
const randomKey = () => `${Date.now().toString(36)}-${keyCounter++}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- invariants ----------
async function invariants(db: pg.Client, logFile: string) {
    console.log("\n== Invariants (SQL) ==");
    const count = async (sql: string) => Number((await db.query(sql)).rows[0].n);
    const ACTIVE = "('pending_payment','confirmed','in_progress')";
    const overlap = (
        col: string,
        until: string,
    ) => `SELECT count(*) AS n FROM bookings a JOIN bookings b ON a.${col} = b.${col} AND a.id < b.id
    AND a.status IN ${ACTIVE} AND b.status IN ${ACTIVE}
    AND tstzrange(a.starts_at, a.${until}, '[)') && tstzrange(b.starts_at, b.${until}, '[)')`;

    const trainerOverlaps = await count(overlap("trainer_id", "busy_until"));
    check("no overlapping active bookings per trainer (busy_until)", trainerOverlaps === 0, `${trainerOverlaps} pairs`);
    check("no overlapping active bookings per customer", (await count(overlap("customer_id", "ends_at"))) === 0);
    const wrongMoney = await count(`SELECT count(*) AS n FROM bookings b WHERE NOT (
      -- package booking: one ledger -1 and no order
      (b.package_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM payment_orders o WHERE o.booking_id = b.id)
        AND (SELECT count(*) FROM package_ledger l WHERE l.booking_id = b.id AND l.reason = 'booking' AND l.delta = -1) = 1)
      -- pay-now booking: exactly one order, no ledger line, and the order agrees with the booking status
      OR (b.package_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM package_ledger l WHERE l.booking_id = b.id)
        AND (SELECT count(*) FROM payment_orders o WHERE o.booking_id = b.id) = 1
        AND EXISTS (SELECT 1 FROM payment_orders o WHERE o.booking_id = b.id AND o.amount_paise = b.total_paise AND CASE
          WHEN b.status IN ('confirmed','in_progress','completed') THEN o.status = 'paid'
          WHEN b.status = 'cancelled' THEN o.status IN ('paid','refunded')
          WHEN b.status = 'pending_payment' THEN o.status = 'created'
          WHEN b.status = 'payment_failed' THEN o.status = 'failed'
          WHEN b.status = 'expired' THEN o.status IN ('expired','refunded') END)))`);
    check(
        "every pay-now booking has exactly one order that agrees with its status; confirmed ones have one paid",
        wrongMoney === 0,
        `${wrongMoney} violating`,
    );
    const paidOrders = await count(`SELECT count(*) AS n FROM payment_orders o JOIN bookings b ON b.id = o.booking_id
    WHERE o.status = 'paid' AND b.status NOT IN ('confirmed','in_progress','completed','cancelled')`);
    check("no paid order behind a booking that is not confirmed", paidOrders === 0, `${paidOrders} violating`);
    const dupePayments = await count(
        "SELECT count(*) AS n FROM (SELECT 1 FROM payment_orders WHERE provider_payment_id IS NOT NULL GROUP BY provider_payment_id HAVING count(*) > 1) x",
    );
    check("no payment id used by two orders", dupePayments === 0);
    const orphanNotes = await count(`SELECT count(*) AS n FROM notifications n JOIN bookings b ON b.id = n.booking_id
    WHERE n.kind = 'booking_assigned' AND b.status IN ('pending_payment','payment_failed') `);
    check(
        "no trainer was told about a booking that is unpaid or failed",
        orphanNotes === 0,
        `${orphanNotes} violating`,
    );
    const negative = await count(`SELECT count(*) AS n FROM packages p
    WHERE p.sessions_total + COALESCE((SELECT sum(delta) FROM package_ledger WHERE package_id = p.id), 0) NOT BETWEEN 0 AND p.sessions_total`);
    check("no package balance below zero (or above purchased)", negative === 0, `${negative} violating`);
    const dupes = await count(
        "SELECT count(*) AS n FROM (SELECT 1 FROM package_ledger GROUP BY booking_id, reason HAVING count(*) > 1) x",
    );
    check("no duplicate (booking_id, reason) in the ledger", dupes === 0);

    const refunded = `(EXISTS (SELECT 1 FROM payment_orders p WHERE p.booking_id = b.id AND p.status = 'refunded')
    OR EXISTS (SELECT 1 FROM package_ledger l WHERE l.booking_id = b.id AND l.reason = 'refund'))`;
    const beforeDeadline = "b.status = 'cancelled' AND b.cancelled_at <= b.starts_at - interval '2 hours'";
    const wrongRefund = await count(
        `SELECT count(*) AS n FROM bookings b WHERE ${refunded} AND NOT (${beforeDeadline})`,
    );
    const missingRefund = await count(
        `SELECT count(*) AS n FROM bookings b WHERE ${beforeDeadline} AND NOT ${refunded}`,
    );
    const cancelled = await count("SELECT count(*) AS n FROM bookings WHERE status = 'cancelled'");
    check("refunds only for cancellations before the deadline", wrongRefund === 0, `${wrongRefund} wrong`);
    check(
        "every cancellation before the deadline was refunded",
        missingRefund === 0,
        `${missingRefund} missing; ${cancelled} cancelled in total`,
    );

    const errorLines = readFileSync(logFile, "utf8")
        .split("\n")
        .filter((l) => l.includes('"level":"error"'));
    check("no error-level lines in the API log", errorLines.length === 0, errorLines[0]?.slice(0, 200));
}

// ---------- main ----------
let apiProc: ChildProcess | null = null;
async function main() {
    stopPostgres();
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    let r = quiet(`${PG_BIN}/initdb`, ["-D", data, "-U", "postgres", "-A", "trust", "--no-sync", "-E", "UTF8"]);
    if (r.status !== 0) throw new Error(`initdb failed: ${r.stderr}`);
    r = quiet(`${PG_BIN}/pg_ctl`, [
        "-D",
        data,
        "-l",
        join(dir, "pg.log"),
        "-w",
        "start",
        "-o",
        `-p ${PG_PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c fsync=off -c max_connections=100`,
    ]);
    if (r.status !== 0) throw new Error(`pg_ctl start failed: ${r.stderr}`);
    r = quiet(`${PG_BIN}/createdb`, ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", "postgres", "zuryo_stress"]);
    if (r.status !== 0) throw new Error(`createdb failed: ${r.stderr}`);

    if (tsx("src/db/migrate.ts").status !== 0) throw new Error("migrate failed");
    if (tsx("src/scripts/seed.ts").status !== 0) throw new Error("seed failed");
    const db = new pg.Client({ connectionString: dbUrl });
    await db.connect();
    await seedSynthetic(db);

    const logFile = join(dir, "api.log");
    const out = openSync(logFile, "w");
    apiProc = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
        cwd: root,
        env,
        stdio: ["ignore", out, out],
    });
    for (let i = 0; ; i++) {
        if (
            await fetch(`http://127.0.0.1:${API_PORT}/healthz`).then(
                (x) => x.ok,
                () => false,
            )
        )
            break;
        if (i > 100) throw new Error("API did not start");
        await new Promise((res) => setTimeout(res, 200));
    }
    console.log(`API pid ${apiProc.pid} on ${API_PORT}, Postgres on ${PG_PORT}`);

    const customers = await loadCustomers(db);
    await thunderingHerd(customers, db);
    await retryStorm(customers, db);
    await mixedLoad(customers, db);
    await invariants(db, logFile);
    await db.end();
}

async function cleanup() {
    if (apiProc?.pid) {
        apiProc.kill("SIGTERM");
        await new Promise((res) => (apiProc!.exitCode !== null ? res(null) : apiProc!.once("exit", res)));
    }
    stopPostgres();
    rmSync(dir, { recursive: true, force: true });
}

try {
    await main();
} catch (err) {
    console.error((err as Error).message);
    failures++;
} finally {
    await cleanup();
}
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
