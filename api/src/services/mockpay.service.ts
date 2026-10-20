import { randomBytes } from "node:crypto";
import { pool, type Db } from "../db/pool.js";
import * as mockpayQueries from "../queries/mockpay.queries.js";
import { config } from "../config/index.js";
import { sign, SIGNATURE_HEADER } from "../lib/mockpay.js";
import { notFound } from "../lib/http-error.js";
import { log } from "../lib/logger.js";

// MockPay stands in for an external gateway: it owns the order, checkout and webhook call a real provider
// would. Nothing outside this module may read mockpay_orders.

const WEBHOOK_ATTEMPTS = 3;
const RETRY_MS = 1000;

// The "create order" call. A real gateway does this over HTTPS and answers with its own order id and
// payment page link; here the order is a row we own.
export async function registerOrder(
    db: Db,
    o: { providerOrderId: string; amountPaise: number; currency: string; returnPath: string },
) {
    if (config.mockpayEnabled) await mockpayQueries.insertOrder(db, o);
}

const view = (o: mockpayQueries.MockpayOrder) => ({
    providerOrderId: o.provider_order_id,
    merchant: "Zuryo",
    amountPaise: o.amount_paise,
    currency: o.currency,
    returnPath: o.return_path,
    status: o.outcome === null ? "pending" : o.outcome === "success" ? "paid" : "failed",
});

export async function getOrder(providerOrderId: string) {
    const order = await mockpayQueries.find(pool, providerOrderId);
    if (!order) throw notFound("MOCKPAY_ORDER_NOT_FOUND", "No such payment order.");
    return view(order);
}

// The customer pressed Pay or Simulate failure on the hosted page. The gateway records the result, answers
// the page, and tells the merchant separately by webhook. The page's own redirect confirms nothing.
export async function complete(providerOrderId: string, outcome: "success" | "failure") {
    const order = await mockpayQueries.find(pool, providerOrderId);
    if (!order) throw notFound("MOCKPAY_ORDER_NOT_FOUND", "No such payment order.");
    const paymentId = `pay_${randomBytes(9).toString("hex")}`;
    const done = await mockpayQueries.complete(pool, providerOrderId, outcome, paymentId);
    if (!done) return view(order);
    log.info("mockpay.completed", { providerOrderId, outcome });
    const body = JSON.stringify({
        type: outcome === "success" ? "PAYMENT_SUCCESS_WEBHOOK" : "PAYMENT_FAILED_WEBHOOK",
        event_time: new Date().toISOString(),
        data: {
            order: { order_id: providerOrderId, order_amount_paise: done.amount_paise, order_currency: done.currency },
            payment: {
                payment_id: paymentId,
                payment_status: outcome === "success" ? "SUCCESS" : "FAILED",
                payment_amount_paise: done.amount_paise,
                payment_currency: done.currency,
            },
        },
    });
    setTimeout(() => void deliverWebhook(providerOrderId, body, 1), config.mockpayWebhookDelayMs);
    return view(done);
}

// Gateways retry a webhook until they get a 2xx; MockPay tries a few times.
async function deliverWebhook(providerOrderId: string, body: string, attempt: number) {
    try {
        const res = await fetch(`${config.publicApiUrl}/v1/payments/webhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: sign(body, config.webhookSecret) },
            body,
        });
        if (res.ok) return log.info("mockpay.webhook_delivered", { providerOrderId, attempt });
        log.warn("mockpay.webhook_rejected", { providerOrderId, attempt, status: res.status });
    } catch (err) {
        log.warn("mockpay.webhook_unreachable", { providerOrderId, attempt, err: (err as Error).name });
    }
    if (attempt < WEBHOOK_ATTEMPTS) setTimeout(() => void deliverWebhook(providerOrderId, body, attempt + 1), RETRY_MS);
}
