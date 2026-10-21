import type { Db } from "../db/pool.js";
import type { PricingRules } from "../lib/pricing.js";

const SELECT = `SELECT normal_price_paise AS "normalPricePaise", peak_price_paise AS "peakPricePaise", commission_bps AS "commissionBps", peak_windows AS "peakWindows", updated_at AS "updatedAt"
    FROM pricing_rules WHERE id = 1`;

export async function get(db: Db) {
    return (await db.query(SELECT)).rows[0] as PricingRules & { updatedAt: Date };
}

export async function update(db: Db, r: PricingRules) {
    await db.query(
        `UPDATE pricing_rules SET normal_price_paise = $1, peak_price_paise = $2, commission_bps = $3, peak_windows = $4, updated_at = now()
            WHERE id = 1`,
        [r.normalPricePaise, r.peakPricePaise, r.commissionBps, JSON.stringify(r.peakWindows)],
    );
}
