import { haversineKm } from "./geo.js";
import type { TrainerRow } from "../types/index.js";

// What a customer may know about a trainer. Home coordinates, phone and email never leave the server;
// only the distance from this customer does.
export function toTrainerCard(t: TrainerRow, from: { lat: number; lng: number }) {
    return {
        id: t.id,
        name: t.name,
        specialties: t.specialties,
        experienceYears: t.experience_years,
        rating: { average: t.rating_average, count: t.rating_count },
        distanceKm: Math.round(haversineKm(from.lat, from.lng, t.home_lat, t.home_lng) * 10) / 10,
        sessionsWithYou: t.sessions_with_customer,
    };
}
