export type Role = "customer" | "trainer" | "admin";

// Set by the auth middleware from the verified token + a fresh DB read.
export type AuthUser = { id: number; role: Role; name: string; trainerId: number | null };

export type RankedTrainer = { trainerId: number; name: string; sessionsThatDay: number; distanceKm: number };

export type AssignmentDecision = {
    preferredTrainerId: number | null;
    preferredEligible: boolean;
    rule: "preferred_trainer" | "fewest_sessions_then_nearest_then_id";
    candidates: RankedTrainer[]; // in the order they were tried
    lostRaceTo: number[]; // candidates that were free when ranked but taken by a concurrent booking
};

export type BookingRow = {
    id: number;
    customer_id: number;
    customer_name: string;
    trainer_id: number;
    trainer_user_id: number;
    trainer_name: string;
    mode: "instant" | "scheduled";
    status: "pending_payment" | "confirmed" | "in_progress" | "completed" | "cancelled" | "payment_failed" | "expired";
    hold_expires_at: Date | null;
    order_status: "created" | "paid" | "failed" | "expired" | "refunded" | null;
    provider_order_id: string | null;
    starts_at: Date;
    ends_at: Date;
    busy_until: Date;
    started_at: Date | null;
    session_ends_at: Date | null;
    completed_at: Date | null;
    cancelled_at: Date | null;
    cancel_reason: "customer" | "rescheduled" | null;
    rescheduled_from: number | null;
    rescheduled_to: number | null;
    is_peak: boolean;
    session_price_paise: number;
    commission_paise: number;
    total_paise: number;
    package_id: number | null;
    refunded: boolean;
    customer_rating: number | null;
    customer_comment: string | null;
    request_hash: string;
    assignment: AssignmentDecision;
    created_at: Date;
};

export type Exercise = {
    name: string;
    focus: "upper" | "lower" | "core" | "cardio" | "mobility";
    sets?: number;
    reps?: number;
    minutes?: number;
};

export type FitnessProfile = {
    age: number;
    weight_kg: number;
    goals: string[];
    level: "beginner" | "intermediate" | "advanced";
    preferences: string[];
};

export type SessionHistoryItem = { startsAt: Date; durationMinutes: number | null; exercises: Exercise[] };

export type Recommendation = {
    title: string;
    focus: string[];
    durationMinutes: number;
    intensity: "light" | "moderate" | "hard";
    exercises: { name: string; detail: string }[];
    reasoning: string[];
};

export type TrainerRow = {
    id: number;
    name: string;
    specialties: string[];
    experience_years: number;
    home_lat: number;
    home_lng: number;
    rating_average: number | null;
    rating_count: number;
    sessions_with_customer: number;
};
