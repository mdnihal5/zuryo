export type Role = "customer" | "trainer" | "admin";
export type User = { id: number; name: string; email: string; role: Role };

export type Price = { isPeak: boolean; sessionPricePaise: number; commissionPaise: number; totalPaise: number };
export type Quote = Price & { mode: "instant" | "scheduled"; startsAt: string };
export type Alternative = Price & { startsAt: string };

export type Assignment = {
    preferredTrainerId: number | null;
    preferredEligible: boolean | null;
    rule: "preferred_trainer" | "fewest_sessions_then_nearest_then_id";
    candidates: { trainerId: number; name: string; sessionsThatDay: number; distanceKm: number }[];
    lostRaceTo: number[];
};

export type BookingStatus =
    "pending_payment" | "confirmed" | "in_progress" | "completed" | "cancelled" | "payment_failed" | "expired";

export type OrderStatus = "created" | "paid" | "failed" | "expired" | "refunded";

export type Booking = {
    id: number;
    mode: "instant" | "scheduled";
    status: BookingStatus;
    phase: "upcoming" | "running" | "warning" | "completed" | "cancelled";
    startsAt: string;
    endsAt: string;
    trainer: { id: number; name: string };
    customer?: { id: number; name: string };
    assignment?: Assignment;
    feedback: { rating: number; comment: string | null } | null;
    price: Price;
    payment: {
        method: "single" | "package";
        packageId: number | null;
        refunded: boolean;
        status: OrderStatus | null;
        providerOrderId: string | null;
        checkoutUrl: string | null;
        holdExpiresAt: string | null;
    };
    session: { startedAt: string | null; endsAt: string | null; warningAt: string | null; completedAt: string | null };
    cancellation: {
        cancelledAt: string | null;
        reason: "customer" | "rescheduled" | null;
        freeCancelUntil: string;
        canCancelFree: boolean;
    };
    rescheduledFromId: number | null;
    rescheduledToId: number | null;
    createdAt: string;
};

export type Page<T> = { items: T[]; nextCursor: string | null };
export type Pack = {
    id: number;
    status: "pending_payment" | "active";
    purchased: number;
    used: number;
    remaining: number;
    createdAt: string;
    providerOrderId: string | null;
    checkoutUrl: string | null;
};
export type TrainerCard = {
    id: number;
    name: string;
    specialties: string[];
    experienceYears: number;
    rating: { average: number | null; count: number };
    distanceKm: number;
    sessionsWithYou: number;
};
export type Slot = Price & { startsAt: string; trainers: TrainerCard[] };

export type Level = "beginner" | "intermediate" | "advanced";
export type Profile = {
    age: number;
    weightKg: number;
    goals: string[];
    level: Level;
    preferences: string[];
    updatedAt: string;
};

export type Focus = "upper" | "lower" | "core" | "cardio" | "mobility";
export type Exercise = { name: string; focus: Focus; sets?: number; reps?: number; minutes?: number };
export type SessionRecord = {
    bookingId: number;
    exercises: Exercise[];
    durationMinutes: number;
    trainerNotes: string | null;
    customerRating: number | null;
    customerComment: string | null;
    suggestedNextWorkout: string | null;
    updatedAt: string;
};

export type Recommendation = {
    engine: "rules" | "llm";
    model: string | null;
    recommendation: {
        title: string;
        focus: string[];
        durationMinutes: number;
        intensity: "light" | "moderate" | "hard";
        exercises: { name: string; detail: string }[];
        reasoning: string[];
    };
};

export type Notification = {
    id: number;
    kind: string;
    bookingId: number | null;
    message: string;
    createdAt: string;
    readAt: string | null;
};

export type Availability = {
    hours: { weekday: number; start: string; end: string }[];
    timeOff: { id: number; startsAt: string; endsAt: string; reason: string | null }[];
};

export type PricingRules = {
    normalPricePaise: number;
    peakPricePaise: number;
    commissionBps: number;
    peakWindows: { start: string; end: string }[];
    updatedAt?: string;
};
