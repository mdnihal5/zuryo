import { haversineKm } from "./geo.js";
import type { RankedTrainer } from "../types/index.js";

export type EligibleTrainer = { trainerId: number; name: string; sessionsThatDay: number; lat: number; lng: number };

// The whole assignment rule, in one place:
//   1. the preferred trainer, if eligible
//   2. fewest sessions that day (spreads the work)
//   3. nearest to the customer
//   4. lowest trainer id (so the result is reproducible)
export function rankTrainers(
    eligible: EligibleTrainer[],
    customer: { lat: number; lng: number },
    preferredTrainerId?: number,
): { ranked: RankedTrainer[]; preferredEligible: boolean } {
    const withDistance = eligible.map((t) => ({
        trainerId: t.trainerId,
        name: t.name,
        sessionsThatDay: t.sessionsThatDay,
        distanceKm: haversineKm(customer.lat, customer.lng, t.lat, t.lng),
    }));
    withDistance.sort(
        (a, b) =>
            Number(b.trainerId === preferredTrainerId) - Number(a.trainerId === preferredTrainerId) ||
            a.sessionsThatDay - b.sessionsThatDay ||
            a.distanceKm - b.distanceKm ||
            a.trainerId - b.trainerId,
    );
    return {
        ranked: withDistance.map((t) => ({ ...t, distanceKm: Math.round(t.distanceKm * 100) / 100 })),
        preferredEligible: preferredTrainerId !== undefined && eligible.some((t) => t.trainerId === preferredTrainerId),
    };
}
