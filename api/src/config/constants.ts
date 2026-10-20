// Business numbers in one place. Prices live in the pricing_rules table, not here.
export const TIME_ZONE = "Asia/Kolkata";
// India has no daylight saving, so a fixed offset is exact. Used for peak windows and "which day".
export const IST_OFFSET_MINUTES = 330;

export const SESSION_MINUTES = 60;
export const WARNING_MINUTES = 55;
export const TRAVEL_MINUTES = 15; // instant booking starts this far from now
export const BUFFER_MINUTES = 15; // trainer is busy this long after a session ends
export const EARLY_START_MINUTES = 30; // trainer may start this long before starts_at (so an instant booking is startable at once)
export const SLOT_GRID_MINUTES = 30;
export const MAX_ADVANCE_DAYS = 14;
export const FREE_CANCEL_HOURS = 2;

// Active = pending_payment, confirmed, in_progress (pending on purpose: an unpaid hold keeps the slot from being
// sold twice). Overlap checks in our own queries say "not finished" instead of "active": "active" matches the
// partial exclusion index, so Postgres answers it from that GiST index, and stress runs caught that index missing
// a confirmed booking that a table scan found (cause unconfirmed). These checks run inside the zone lock and must
// not depend on it; the exclusion constraints stay as the backstop.
export const FINISHED_STATUSES = ["completed", "cancelled", "payment_failed", "expired"] as const;
export const HOLD_MINUTES = 10; // how long a booking waits for the gateway before the slot is released

export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 100;
export const ALTERNATIVE_SLOTS = 5;
