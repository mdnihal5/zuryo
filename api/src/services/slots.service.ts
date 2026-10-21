import { pool } from "../db/pool.js";
import { expireHolds } from "./payments.service.js";
import * as trainersQueries from "../queries/trainers.queries.js";
import * as pricingQueries from "../queries/pricing.queries.js";
import * as usersQueries from "../queries/users.queries.js";
import { MAX_ADVANCE_DAYS, SLOT_GRID_MINUTES } from "../config/constants.js";
import { addMinutes, istMidnight } from "../lib/ist.js";
import { alignUp, earliestStart, resolveStart } from "../lib/booking-time.js";
import { computePrice } from "../lib/pricing.js";
import { toTrainerCard } from "../lib/trainer.mapper.js";
import { unprocessable } from "../lib/http-error.js";
import type { AuthUser } from "../types/index.js";

async function customerPlace(customer: AuthUser) {
    const basics = await usersQueries.findProfileBasics(pool, customer.id);
    if (!basics || basics.zone_id === null || basics.lat === null || basics.lng === null) {
        throw unprocessable("CUSTOMER_LOCATION_MISSING", "Your account has no service zone or location yet.");
    }
    return { zoneId: basics.zone_id, lat: basics.lat, lng: basics.lng };
}

export async function listTrainers(customer: AuthUser) {
    const place = await customerPlace(customer);
    return (await trainersQueries.listZoneTrainers(pool, place.zoneId, customer.id)).map((t) =>
        toTrainerCard(t, place),
    );
}

export async function listSlots(customer: AuthUser, date: string) {
    const now = new Date();
    await expireHolds(pool, now);
    const place = await customerPlace(customer);
    const dayStart = istMidnight(date);
    const lastStart = addMinutes(dayStart, 24 * 60 - SLOT_GRID_MINUTES);
    if (dayStart > addMinutes(now, MAX_ADVANCE_DAYS * 24 * 60)) {
        throw unprocessable("DATE_TOO_FAR", `Bookings open up to ${MAX_ADVANCE_DAYS} days ahead.`);
    }
    const from = new Date(Math.max(dayStart.getTime(), alignUp(earliestStart(now)).getTime()));
    if (from > lastStart) return { date, slots: [] };

    const [rules, trainers, starts] = await Promise.all([
        pricingQueries.get(pool),
        trainersQueries.listZoneTrainers(pool, place.zoneId, customer.id),
        trainersQueries.listSlotStarts(pool, place.zoneId, from, lastStart, 100),
    ]);
    const byId = new Map(trainers.map((t) => [t.id, toTrainerCard(t, place)]));
    return {
        date,
        slots: starts.map((s) => ({
            startsAt: s.startsAt,
            ...computePrice(rules, s.startsAt),
            trainers: s.trainerIds.map((id) => byId.get(id)!),
        })),
    };
}

// Price breakdown shown before payment. For instant, startsAt is "now + travel time".
export async function quote(mode: "instant" | "scheduled", requested: Date | undefined) {
    const startsAt = resolveStart(mode, requested, new Date());
    return { mode, startsAt, ...computePrice(await pricingQueries.get(pool), startsAt) };
}
