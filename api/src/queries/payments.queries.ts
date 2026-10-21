import type { Db } from "../db/pool.js";

export type OrderRow = {
    id: number;
    purpose: "booking" | "package";
    booking_id: number | null;
    package_id: number | null;
    customer_id: number;
    amount_paise: number;
    currency: string;
    status: "created" | "paid" | "failed" | "expired" | "refunded";
    provider_order_id: string;
    provider_payment_id: string | null;
};

const COLUMNS = `id, purpose, booking_id, package_id, customer_id, amount_paise, currency, status, provider_order_id, provider_payment_id`;

export async function insertOrder(
    db: Db,
    o: {
        purpose: "booking" | "package";
        bookingId: number | null;
        packageId: number | null;
        customerId: number;
        amountPaise: number;
        providerOrderId: string;
    },
) {
    await db.query(
        `INSERT INTO payment_orders (purpose, booking_id, package_id, customer_id, amount_paise, provider_order_id)
            VALUES ($1,$2,$3,$4,$5,$6)`,
        [o.purpose, o.bookingId, o.packageId, o.customerId, o.amountPaise, o.providerOrderId],
    );
}

export async function findByProviderOrderId(db: Db, providerOrderId: string) {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM payment_orders WHERE provider_order_id = $1`, [
        providerOrderId,
    ]);
    return (rows[0] as OrderRow | undefined) ?? null;
}

// The webhook locks the booking (or package) first and the order second. Expiry does the same, so the
// two can never wait on each other.
export async function lockOrder(db: Db, providerOrderId: string) {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM payment_orders WHERE provider_order_id = $1 FOR UPDATE`, [
        providerOrderId,
    ]);
    return rows[0] as OrderRow;
}

export async function lockBooking(db: Db, bookingId: number) {
    const { rows } = await db.query("SELECT status FROM bookings WHERE id = $1 FOR UPDATE", [bookingId]);
    return rows[0].status as string;
}

export async function lockPackage(db: Db, packageId: number) {
    const { rows } = await db.query("SELECT status FROM packages WHERE id = $1 FOR UPDATE", [packageId]);
    return rows[0].status as string;
}

// All the order updates are conditional on the current status: whoever changes the row owns the follow-up work.
export async function markPaid(db: Db, id: number, providerPaymentId: string, now: Date) {
    const { rowCount } = await db.query(
        `UPDATE payment_orders SET status = 'paid', provider_payment_id = $2, paid_at = $3
            WHERE id = $1 AND status IN ('created', 'expired')`,
        [id, providerPaymentId, now],
    );
    return rowCount === 1;
}

export async function markFailed(db: Db, id: number) {
    const { rowCount } = await db.query(
        "UPDATE payment_orders SET status = 'failed' WHERE id = $1 AND status = 'created'",
        [id],
    );
    return rowCount === 1;
}

// Money arrived for a booking that cannot be honoured: the simulated gateway gives it back.
export async function markRefundedAfterLatePayment(db: Db, id: number, providerPaymentId: string, now: Date) {
    const { rowCount } = await db.query(
        `UPDATE payment_orders SET status = 'refunded', provider_payment_id = $2, paid_at = $3
            WHERE id = $1 AND status IN ('created', 'expired', 'failed')`,
        [id, providerPaymentId, now],
    );
    return rowCount === 1;
}

// Only a 'paid' order can be refunded, so a second call changes nothing and returns false.
export async function refundForBooking(db: Db, bookingId: number) {
    const { rowCount } = await db.query(
        "UPDATE payment_orders SET status = 'refunded' WHERE booking_id = $1 AND status = 'paid'",
        [bookingId],
    );
    return rowCount === 1;
}

export async function activatePackage(db: Db, packageId: number) {
    const { rowCount } = await db.query(
        "UPDATE packages SET status = 'active' WHERE id = $1 AND status = 'pending_payment'",
        [packageId],
    );
    return rowCount === 1;
}
