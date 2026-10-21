import { pool } from "../db/pool.js";
import * as pricingQueries from "../queries/pricing.queries.js";
import { computePrice, type PricingRules } from "../lib/pricing.js";
import { log } from "../lib/logger.js";

export const getRules = () => pricingQueries.get(pool);

const numbers = (r: PricingRules) => ({
    normalPricePaise: r.normalPricePaise,
    peakPricePaise: r.peakPricePaise,
    commissionBps: r.commissionBps,
});

export async function updateRules(adminId: number, rules: PricingRules) {
    const old = await pricingQueries.get(pool);
    await pricingQueries.update(pool, rules);
    log.info("pricing.updated", { adminId, before: numbers(old), after: numbers(rules) });
    return pricingQueries.get(pool);
}

// Quote for a start time, using the current rules. Bookings snapshot this same result.
export async function quote(startsAt: Date) {
    const price = computePrice(await pricingQueries.get(pool), startsAt);
    return { startsAt, ...price };
}
