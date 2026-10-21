import { pool, withTransaction } from "../db/pool.js";
import * as packagesQueries from "../queries/packages.queries.js";
import * as pricingQueries from "../queries/pricing.queries.js";
import { createOrder } from "./payments.service.js";
import { checkoutUrl } from "../lib/booking.mapper.js";
import { computePackageTotal } from "../lib/pricing.js";
import { assertSameRequest, requestHash } from "../lib/idempotency.js";
import { log } from "../lib/logger.js";
import type { AuthUser } from "../types/index.js";

// used = sessions booked from this package and not refunded. remaining = purchased - used.
const toView = (p: packagesQueries.PackageRow) => ({
    id: p.id,
    status: p.status,
    purchased: p.sessions_total,
    used: p.used,
    remaining: p.sessions_total - p.used,
    createdAt: p.created_at,
    providerOrderId: p.provider_order_id,
    checkoutUrl: p.order_status === "created" ? checkoutUrl(p.provider_order_id!) : null,
});

export async function list(customer: AuthUser) {
    return (await packagesQueries.listForCustomer(pool, customer.id)).map(toView);
}

// Buying creates the package as pending_payment plus a payment order; the package becomes active only when the
// gateway's webhook says it was paid. A retry with the same key returns the same package and the same order.
export async function buy(customer: AuthUser, sessions: number, key: string) {
    const hash = requestHash({ kind: "buy_package", sessions });
    const id = await withTransaction(async (client) => {
        const created = await packagesQueries.insertIfNew(client, customer.id, sessions, key, hash);
        if (created === null) {
            const existing = await packagesQueries.findByKey(client, customer.id, key);
            assertSameRequest(existing.request_hash, hash);
            return existing.id;
        }
        const rules = await pricingQueries.get(client);
        await createOrder(client, {
            purpose: "package",
            packageId: created,
            customerId: customer.id,
            amountPaise: computePackageTotal(rules, sessions),
        });
        log.info("package.bought", { packageId: created, customerId: customer.id, sessions });
        return created;
    });
    return toView((await packagesQueries.findForCustomer(pool, customer.id, id))!);
}
