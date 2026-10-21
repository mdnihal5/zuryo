import type { Db } from "../db/pool.js";

export type MockpayOrder = {
    provider_order_id: string;
    amount_paise: number;
    currency: string;
    return_path: string;
    outcome: "success" | "failure" | null;
    provider_payment_id: string | null;
};

export async function insertOrder(
    db: Db,
    o: { providerOrderId: string; amountPaise: number; currency: string; returnPath: string },
) {
    await db.query(
        "INSERT INTO mockpay_orders (provider_order_id, amount_paise, currency, return_path) VALUES ($1,$2,$3,$4)",
        [o.providerOrderId, o.amountPaise, o.currency, o.returnPath],
    );
}

export async function find(db: Db, providerOrderId: string) {
    const { rows } = await db.query("SELECT * FROM mockpay_orders WHERE provider_order_id = $1", [providerOrderId]);
    return (rows[0] as MockpayOrder | undefined) ?? null;
}

// Only the first completion sticks; a second click or a replayed request finds the order already completed.
export async function complete(db: Db, providerOrderId: string, outcome: "success" | "failure", paymentId: string) {
    const { rows } = await db.query(
        `UPDATE mockpay_orders SET outcome = $2, provider_payment_id = $3, completed_at = now()
            WHERE provider_order_id = $1 AND outcome IS NULL RETURNING *`,
        [providerOrderId, outcome, paymentId],
    );
    return (rows[0] as MockpayOrder | undefined) ?? null;
}
