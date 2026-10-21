import type { Db } from "../db/pool.js";

export type PackageRow = {
    id: number;
    sessions_total: number;
    used: number;
    status: "pending_payment" | "active";
    created_at: Date;
    provider_order_id: string | null;
    order_status: string | null;
};

const WITH_USAGE = `
    SELECT p.id, p.sessions_total, p.status, p.created_at, COALESCE(-SUM(l.delta), 0)::int AS used, o.provider_order_id, o.status AS order_status
    FROM packages p
    LEFT JOIN package_ledger l ON l.package_id = p.id
    LEFT JOIN payment_orders o ON o.package_id = p.id`;
const GROUP = "GROUP BY p.id, o.id";

// Returns null when this (customer, key) already bought a package, so a retry cannot buy a second one.
export async function insertIfNew(db: Db, customerId: number, sessions: number, key: string, requestHash: string) {
    const { rows } = await db.query(
        `INSERT INTO packages (customer_id, sessions_total, idempotency_key, request_hash, status)
            VALUES ($1,$2,$3,$4,'pending_payment')
            ON CONFLICT (customer_id, idempotency_key) DO NOTHING RETURNING id`,
        [customerId, sessions, key, requestHash],
    );
    return (rows[0]?.id as number | undefined) ?? null;
}

export async function findByKey(db: Db, customerId: number, key: string) {
    const { rows } = await db.query(
        "SELECT id, request_hash FROM packages WHERE customer_id = $1 AND idempotency_key = $2",
        [customerId, key],
    );
    return rows[0] as { id: number; request_hash: string };
}

export async function listForCustomer(db: Db, customerId: number) {
    const { rows } = await db.query(
        `${WITH_USAGE} WHERE p.customer_id = $1 AND p.status = 'active' ${GROUP} ORDER BY p.id`,
        [customerId],
    );
    return rows as PackageRow[];
}

// Any status, so the buyer can see a package that is still waiting for its payment.
export async function findForCustomer(db: Db, customerId: number, id: number) {
    const { rows } = await db.query(`${WITH_USAGE} WHERE p.id = $1 AND p.customer_id = $2 ${GROUP}`, [id, customerId]);
    return (rows[0] as PackageRow | undefined) ?? null;
}

// FOR UPDATE: two bookings paying from the same package queue up here, so each one sees the
// other's deduction before checking the balance. Without it both could read "1 left" and both deduct.
export async function lockWithUsage(db: Db, packageId: number, customerId: number) {
    const locked = await db.query(
        "SELECT id FROM packages WHERE id = $1 AND customer_id = $2 AND status = 'active' FOR UPDATE",
        [packageId, customerId],
    );
    if (locked.rowCount === 0) return null;
    const { rows } = await db.query(`${WITH_USAGE} WHERE p.id = $1 ${GROUP}`, [packageId]);
    return rows[0] as PackageRow;
}

// false = this (booking, reason) pair already exists, i.e. a retry. Nothing is deducted twice.
export async function insertLedger(
    db: Db,
    packageId: number,
    bookingId: number,
    delta: -1 | 1,
    reason: "booking" | "refund",
) {
    const { rowCount } = await db.query(
        `INSERT INTO package_ledger (package_id, booking_id, delta, reason) VALUES ($1,$2,$3,$4)
            ON CONFLICT (booking_id, reason) DO NOTHING`,
        [packageId, bookingId, delta, reason],
    );
    return rowCount === 1;
}
