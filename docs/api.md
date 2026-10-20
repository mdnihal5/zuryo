# Zuryo API reference

Base path `/v1`. JSON in, JSON out. This is the contract the client is built from.

## Conventions

- **Auth:** `Authorization: Bearer <token>` from `POST /v1/auth/login`. Tokens last 12 hours and stop working after `POST /v1/auth/logout`.
- **Success:** `{ "data": ..., "serverNow": "2026-10-19T04:42:23.920Z" }`
- **Error:** `{ "error": { "code": "BOOKING_NOT_FOUND", "message": "...", "requestId": "ab12cd34", "details": ... }, "serverNow": "..." }`. Branch on `code`, never on `message`. `details` appears only for `VALIDATION_ERROR` (list of `{field, message}`) and `NO_TRAINER_AVAILABLE`.
- **`serverNow` is on every JSON response**, errors included. Keep `offset = Date.parse(serverNow) - Date.now()` and compute countdowns from `Date.now() + offset`.
- **Money** is integer paise (`43890` = 438.90 rupees). The client never sends an amount; any amount field in a body is ignored.
- **Times** are ISO-8601 UTC strings. Send `startsAt` with a `Z` or offset. Slot dates (`date=YYYY-MM-DD`) are Asia/Kolkata calendar days.
- **Ids** are integers.
- **Lists** take `limit` (1-100, default 50) and `cursor`, and return `{ "items": [...], "nextCursor": string | null }`. Pass `nextCursor` back as `cursor`. `view=upcoming` sorts by start time ascending; everything else descending.
- **Unknown JSON fields in a request are ignored.** Clients must also ignore unknown fields in responses.
- **Ownership:** a customer only ever sees their own data, a trainer only their own sessions. Someone else's id returns `404`, not `403`.
- **Idempotency:** `POST /bookings`, `POST /bookings/:id/reschedule` and `POST /packages` require an `Idempotency-Key` header (8-100 chars: letters, digits, `-`, `_`). Make one key when checkout opens and resend it on every retry of that same attempt; make a new one only after success or when the customer changes the selection. A repeat returns the original result with the same `201`. Reusing a key with a different request body returns `422 IDEMPOTENCY_KEY_REUSED`.

## Booking object

Returned by every booking endpoint. Customers get this shape; trainers also get `customer: {id, name}`; admins also get `customer` and `assignment`.

```json
{
    "id": 6,
    "mode": "instant",
    "status": "confirmed",
    "phase": "upcoming",
    "startsAt": "...",
    "endsAt": "...",
    "trainer": { "id": 1, "name": "Kiran Patel" },
    "price": { "isPeak": false, "sessionPricePaise": 39900, "commissionPaise": 3990, "totalPaise": 43890 },
    "payment": {
        "method": "single",
        "packageId": null,
        "refunded": false,
        "status": "paid",
        "providerOrderId": "order_ab12...",
        "checkoutUrl": null,
        "holdExpiresAt": null
    },
    "session": { "startedAt": null, "endsAt": null, "warningAt": null, "completedAt": null },
    "cancellation": { "cancelledAt": null, "reason": null, "freeCancelUntil": "...", "canCancelFree": true },
    "feedback": null,
    "rescheduledFromId": null,
    "rescheduledToId": null,
    "createdAt": "..."
}
```

- `status`: `pending_payment` (created, waiting for the payment gateway; holds the slot for 10 minutes), `confirmed`, `in_progress`, `completed`, `cancelled`, `payment_failed` and `expired` (the slot was released; no session). Only a verified gateway webhook moves `pending_payment` to `confirmed`; the browser coming back from the payment page changes nothing.
- `phase` (what to show): `upcoming` (not started), `running`, `warning` (55 min reached, until 60), `completed`, `cancelled`.
- `feedback`: `null` until the customer rates the session, then `{ rating: 1-5, comment: string | null }`. Every role sees it.
- `payment.method`: `single` (paid through the gateway) or `package` (one session taken from a package, confirmed at once, no gateway). `refunded` is true when the money or the package session came back.
- `payment.status` is the payment order's status (`created`, `paid`, `failed`, `expired`, `refunded`), `null` for package bookings. `payment.checkoutUrl` and `providerOrderId` are set while the order is `created`: send the customer to the hosted checkout page (the web client opens `/pay/:providerOrderId`). `payment.holdExpiresAt` is set only while `pending_payment`; compute the countdown from `serverNow`.
- `cancellation.reason`: `customer` or `rescheduled`. `rescheduledToId` on a cancelled booking points at its replacement.
- `session.endsAt` and `warningAt` are server-set when the trainer starts. Use them for the timer; `endsAt - startedAt` is exactly 60 minutes.
- Admin `assignment`: `{ preferredTrainerId, preferredEligible, rule, candidates: [{trainerId, name, sessionsThatDay, distanceKm}], lostRaceTo: [trainerId] }`. `rule` is `preferred_trainer` or `fewest_sessions_then_nearest_then_id`. `candidates` is in ranked order.

## Auth (any role)

| Method | Path           | Body                  | Response                                                      |
| ------ | -------------- | --------------------- | ------------------------------------------------------------- |
| POST   | `/auth/login`  | `{ email, password }` | `{ token, user: {id, name, email, role} }`                    |
| GET    | `/auth/me`     |                       | `{ id, name, email, role, zoneId }`                           |
| POST   | `/auth/logout` |                       | `{ loggedOut: true }`. Invalidates every token issued so far. |

Errors: `401 INVALID_CREDENTIALS` (same message for a wrong password and an unknown email), `429 RATE_LIMITED` (10 attempts per 15 minutes per IP and email), `401 UNAUTHENTICATED` on any route when the token is missing, bad, expired or logged out.

## Notifications (any role, own only)

| Method | Path                  | Response                                                                                                                                                                                               |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/notifications`      | newest 50: `[{ id, kind, bookingId, message, createdAt, readAt }]`. `kind`: `booking_assigned`, `booking_cancelled`, `booking_rescheduled`, `session_completed`, `payment_failed`, `payment_refunded`. |
| POST   | `/notifications/read` | marks all read: `{ ok: true }`                                                                                                                                                                         |

Poll this (and the booking endpoints) every ~30 s to keep views in sync.

## Customer endpoints (role `customer`)

### Discovery and price

| Method | Path                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/trainers`                                             | Trainers in the customer's zone, as trainer cards (below). Use for the preferred-trainer picker.                                                                                                                                                                                                                                                                          |
| GET    | `/slots?date=YYYY-MM-DD`                                | `{ date, slots: [{ startsAt, isPeak, sessionPricePaise, commissionPaise, totalPaise, trainers: [trainer card] }] }`. 30-minute grid, only slots where at least one trainer is free for the whole hour plus buffer, and not earlier than now + 15 min. `trainers` lists who is free for that slot, as trainer cards. Errors: `422 DATE_TOO_FAR` (more than 14 days ahead). |
| GET    | `/quote?mode=instant` or `?mode=scheduled&startsAt=...` | Price breakdown before payment: `{ mode, startsAt, isPeak, sessionPricePaise, commissionPaise, totalPaise }`. For `instant`, `startsAt` is now + 15 min.                                                                                                                                                                                                                  |

**Trainer card:** `{ id, name, specialties: string[], experienceYears, rating: { average: number | null, count }, distanceKm, sessionsWithYou }`. `rating` is the mean (one decimal) of the ratings customers left on that trainer's sessions; `average` is `null` when `count` is 0. `distanceKm` is from your stored location to the trainer's home (one decimal). `sessionsWithYou` counts completed sessions between you and this trainer. Home coordinates, phone and email are never in a customer response.

Peak = the slot's start time falls in a configured window (default 06:00-09:00 and 18:00-21:00 Asia/Kolkata; start inclusive, end exclusive).

### Bookings

| Method | Path                                            | Body                                                                                                                                                                                             | Response / errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/bookings`                                     | `{ mode: "instant" }` or `{ mode: "scheduled", startsAt }`, plus optional `preferredTrainerId`, optional `packageId` (pay with that package instead of paying online). Header `Idempotency-Key`. | `201` booking. With `packageId` it is `confirmed` at once. Without, it is `pending_payment` with a payment order and `payment.checkoutUrl`; the slot is held for 10 minutes and the booking confirms when the gateway's webhook arrives. A retry with the same key returns the same booking and the same order. `409 NO_TRAINER_AVAILABLE` with `details.alternatives: [{startsAt, isPeak, sessionPricePaise, commissionPaise, totalPaise}]` (up to 5 later slots). `409 CUSTOMER_ALREADY_BOOKED` (overlaps another of your sessions). `409 PACKAGE_EMPTY`. `404 PACKAGE_NOT_FOUND` (also for a package whose payment is still pending). `422 INVALID_SLOT` (off the 30-minute grid, sooner than 15 min, or more than 14 days ahead). `422 CUSTOMER_LOCATION_MISSING`. |
| GET    | `/bookings?view=upcoming\|history&limit&cursor` |                                                                                                                                                                                                  | page of bookings. `upcoming` = pending payment + confirmed + in progress; `history` = completed + cancelled + payment failed + expired.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/bookings/:id`                                 |                                                                                                                                                                                                  | booking. `404 BOOKING_NOT_FOUND`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/bookings/:id/cancel`                          |                                                                                                                                                                                                  | `200` booking. Free (the payment order becomes `refunded`, simulated) until 2 h before start; after that it still cancels but nothing comes back. Cancelling an already-cancelled booking returns it unchanged. `409 BOOKING_NOT_CANCELLABLE` once the session has started, and for a booking still waiting for payment (it expires on its own after 10 minutes).                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/bookings/:id/reschedule`                      | `{ startsAt, preferredTrainerId? }`, header `Idempotency-Key`                                                                                                                                    | `201` the **new** booking (`rescheduledFromId` set). The old one becomes `cancelled` with reason `rescheduled` and is refunded; the new one is priced at the new time and, unless it was paid with a package, is a new `pending_payment` booking with its own checkout (same flow as `POST /bookings`). All or nothing: on `409 NO_TRAINER_AVAILABLE` the old booking is untouched. `409 RESCHEDULE_TOO_LATE` inside 2 h. `409 BOOKING_NOT_RESCHEDULABLE`.                                                                                                                                                                                                                                                                                                             |
| GET    | `/bookings/:id/record`                          |                                                                                                                                                                                                  | session record or `null`: `{ bookingId, exercises, durationMinutes, trainerNotes, customerRating, customerComment, suggestedNextWorkout, updatedAt }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| PUT    | `/bookings/:id/feedback`                        | `{ rating: 1-5 (integer), comment?: string (up to 2000 chars) }`                                                                                                                                 | the record. Sending again replaces the earlier rating. `400 VALIDATION_ERROR` for a rating outside 1-5. `409 SESSION_NOT_COMPLETED` before the session is complete. `404` for someone else's booking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Packages

| Method | Path        | Body                                                    | Response                                                                                                                                                                                                                                                                                                                                    |
| ------ | ----------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/packages` |                                                         | Active packages only: `[{ id, status, purchased, used, remaining, createdAt, providerOrderId, checkoutUrl }]`. `used` = sessions booked from the package and not refunded.                                                                                                                                                                  |
| POST   | `/packages` | `{ sessions: 5 \| 10 \| 20 }`, header `Idempotency-Key` | `201` the package as `{ id, status: "pending_payment", purchased, used, remaining, createdAt, providerOrderId, checkoutUrl }`. The price is `sessions x` the normal all-in session price (no discount). It becomes `active` only when the gateway's webhook says it was paid. A retry with the same key returns the same package and order. |

### Fitness profile and recommendation

| Method | Path                            | Body                                                                                                                                | Response                                                                                                                                                                                                                                                |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/profile`                      |                                                                                                                                     | `{ age, weightKg, goals, level, preferences, updatedAt }` or `null`                                                                                                                                                                                     |
| PUT    | `/profile`                      | `{ age (10-100), weightKg (20-300), goals: string[1-6], level: "beginner"\|"intermediate"\|"advanced", preferences: string[0-10] }` | the saved profile                                                                                                                                                                                                                                       |
| GET    | `/recommendations/next-workout` |                                                                                                                                     | `{ engine: "rules"\|"llm", model: string\|null, recommendation: { title, focus[], durationMinutes, intensity: "light"\|"moderate"\|"hard", exercises: [{name, detail}], reasoning[] } }`. `422 PROFILE_REQUIRED` without a profile. 6 calls per minute. |

Recognised goals for the rules engine: `weight loss`, `build muscle`, `strength`, `endurance`, `flexibility`, `stress relief` (others give a balanced plan).

## Trainer endpoints (role `trainer`, prefix `/trainer`)

| Method | Path                                                    | Body                                                                                                                                                                   | Response / errors                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/trainer/sessions?view=upcoming\|history&limit&cursor` |                                                                                                                                                                        | page of this trainer's bookings. A booking that is unpaid, failed or expired is never shown to the trainer (and is `404` by id).                                                                                                                                    |
| GET    | `/trainer/sessions/:id`                                 |                                                                                                                                                                        | booking (with `customer`). `404` if it is not yours.                                                                                                                                                                                                                |
| POST   | `/trainer/sessions/:id/start`                           |                                                                                                                                                                        | `200` booking with `session.startedAt/endsAt/warningAt` set from the server clock, `phase: running`. Allowed from 30 min before `startsAt`. Repeating it returns the running session unchanged. `409 TOO_EARLY`, `409 SESSION_NOT_STARTABLE` (cancelled/completed). |
| GET    | `/trainer/sessions/:id/record`                          |                                                                                                                                                                        | record or `null`                                                                                                                                                                                                                                                    |
| PUT    | `/trainer/sessions/:id/record`                          | `{ exercises: [{name, focus: "upper"\|"lower"\|"core"\|"cardio"\|"mobility", sets?, reps?, minutes?}] (1-30), durationMinutes, trainerNotes?, suggestedNextWorkout? }` | the record. `409 SESSION_NOT_COMPLETED` until the session is complete.                                                                                                                                                                                              |
| GET    | `/trainer/availability`                                 |                                                                                                                                                                        | `{ hours: [{weekday, start, end}], timeOff: [{id, startsAt, endsAt, reason}] }`. `weekday` 1 = Monday ... 7 = Sunday; `start`/`end` are `HH:MM` Kolkata time; future time off only.                                                                                 |
| PUT    | `/trainer/availability/hours`                           | `{ hours: [{weekday, start, end}] }` (one window per weekday, replaces all)                                                                                            | availability. Existing bookings are not touched.                                                                                                                                                                                                                    |
| POST   | `/trainer/time-off`                                     | `{ startsAt, endsAt, reason? }`                                                                                                                                        | `201` the time off. `409 TIME_OFF_HAS_BOOKINGS` if active sessions fall inside.                                                                                                                                                                                     |
| DELETE | `/trainer/time-off/:id`                                 |                                                                                                                                                                        | `{ removed: true }`                                                                                                                                                                                                                                                 |

### Timer behaviour for the client

Show `phase` and `session.endsAt` from the server. Run a local countdown against `Date.now() + offset` (see `serverNow`), and fire the 55-minute buzzer from `session.warningAt` on the client's own timer. A refresh or reopened app just re-reads the booking. If the client's timer and the server disagree, the server wins: past `session.endsAt` the booking is `completed` on the very next read, whether or not anyone was online.

## Admin endpoints (role `admin`, prefix `/admin`)

| Method | Path                   | Notes                                                                                                                                                                      |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/bookings`      | Filters: `status`, `mode`, `from`, `to` (range on `startsAt`), `trainerId`, `customerId`, `limit`, `cursor`. Newest first. Each item includes `customer` and `assignment`. |
| GET    | `/admin/bookings/:id`  | One booking with `assignment`.                                                                                                                                             |
| GET    | `/admin/pricing-rules` | `{ normalPricePaise, peakPricePaise, commissionBps, peakWindows: [{start, end}], updatedAt }`                                                                              |
| PUT    | `/admin/pricing-rules` | Same fields without `updatedAt`; replaces all. Applies to new bookings only; existing bookings keep the price they were made with.                                         |

## Payments (gateway and webhook)

Online payment works like Cashfree, Razorpay or Paytm. The gateway here is **MockPay**, a local stand-in (`api/src/services/mockpay.service.ts`).

1. `POST /bookings` (or `/packages`) creates the booking as `pending_payment` and a payment order. The amount is the server's price snapshot (`payment_orders.amount_paise`); nothing about money comes from the client.
2. The client sends the customer to the hosted checkout page (`payment.checkoutUrl`, client route `/pay/:providerOrderId`).
3. The customer pays or fails on that page. The page talks only to MockPay.
4. MockPay calls our webhook. Only that call confirms anything. The page's redirect back to the app never does, so closing the tab after paying still ends in a confirmed booking.
5. The client polls `GET /bookings/:id` (every 2 s while `pending_payment`) and shows the result.

### `POST /v1/payments/webhook` (called by the gateway, no bearer token)

Header `x-mockpay-signature`: hex HMAC-SHA256 of the **raw request body** with `MOCKPAY_WEBHOOK_SECRET`, compared in constant time. Body (amounts in paise):

```json
{
    "type": "PAYMENT_SUCCESS_WEBHOOK",
    "event_time": "2026-10-19T10:00:00.000Z",
    "data": {
        "order": { "order_id": "order_ab12", "order_amount_paise": 54890, "order_currency": "INR" },
        "payment": {
            "payment_id": "pay_cd34",
            "payment_status": "SUCCESS",
            "payment_amount_paise": 54890,
            "payment_currency": "INR"
        }
    }
}
```

`PAYMENT_FAILED_WEBHOOK` has `payment_status: "FAILED"`. Handling, in this order:

- Signature missing or wrong: `401 INVALID_SIGNATURE`, nothing read, nothing changed. Not JSON or not this shape: `400`.
- Unknown order id: `200`, `result: "ignored"` (a retry cannot make it known).
- Amount or currency different from the stored order: `422 PAYMENT_MISMATCH`, logged at error level, nothing changed.
- Otherwise one transaction locks the booking then the order and answers `200` with `result`:
    - `confirmed`: order `created` to `paid`, booking `pending_payment` to `confirmed` (conditional updates), trainer and customer notified. A package order activates the package.
    - `failed`: order `failed`, booking `payment_failed`, slot released, customer notified.
    - `replay`: the order was already settled (same or repeated event). Nothing changes, so five simultaneous copies give one `confirmed` and four `replay`.
    - `refunded`: money arrived for a hold that had already expired and the slot cannot be kept (someone else took it, or the session already started). The order becomes `refunded` (simulated automatic refund) and the customer is notified. If the slot is still free, an expired booking is confirmed instead.

Holds past `hold_expires_at` become `expired` (booking and order) on any read that shows bookings or slots, before every booking, and in the sweep.

### MockPay (only when `MOCKPAY_ENABLED=true`)

No login, like a real gateway's hosted page. Base path `/mockpay`, not `/v1`.

| Method | Path                                        | Body                                  | Response                                                                                                                                                                                             |
| ------ | ------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/mockpay/orders/:providerOrderId`          |                                       | `{ providerOrderId, merchant: "Zuryo", amountPaise, currency, returnPath, status: "pending" \| "paid" \| "failed" }`. `404 MOCKPAY_ORDER_NOT_FOUND`.                                                 |
| POST   | `/mockpay/orders/:providerOrderId/complete` | `{ outcome: "success" \| "failure" }` | the same object. Only the first completion counts. After `MOCKPAY_WEBHOOK_DELAY_MS` (default 1500) MockPay posts the signed webhook to `PUBLIC_API_URL`, retrying up to 3 times on a non-2xx answer. |

### Swapping MockPay for Cashfree sandbox

What changes; the webhook handler, order table and booking states stay.

- **Order creation.** Replace `mockpay.registerOrder` (called from `payments.service.createOrder`) with an HTTPS call to Cashfree's create-order endpoint, sending our `order_id`, amount and currency, the customer's id, and a `return_url`. Cashfree answers with a `payment_session_id`. That call cannot sit inside our database transaction, so create the booking and order first, then call the gateway, and mark the order failed if the call fails.
- **Hosted page.** Instead of our `/pay/:id` route the client starts Cashfree's checkout with the `payment_session_id` (their JS SDK or a redirect). `payment.checkoutUrl` would carry what the client needs. Delete `pages/Pay.tsx`, `lib/mockpay.ts`, `routes/mockpay.routes.ts` and the `mockpay_orders` table.
- **Webhook signature.** Replace `lib/mockpay.ts`. Cashfree sends `x-webhook-signature` and `x-webhook-timestamp`; the signature is base64 of HMAC-SHA256 over the timestamp followed by the raw body, keyed with the client secret (unverified against their current docs, check before building). The raw-body requirement is the same.
- **Payload.** Map their field names in `schemas/payments.schema.ts`. Their amounts are decimal rupees (unverified), so convert to integer paise with exact arithmetic before comparing with `amount_paise`; never compare floats.
- **Source of truth.** Keep treating the webhook as the confirmation. Optionally add a "fetch order status" call for orders that stay `created` too long, which Cashfree supports (unverified).
- **Config.** `MOCKPAY_*` become provider keys; the webhook URL must be reachable from the internet (a tunnel for local work).

## Operational

- `GET /healthz` returns `{ ok: true }` without touching the database. `GET /readyz` checks the database (`503` if down). Neither needs auth.

## Error codes

| Status | Codes                                                                                                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`, `INVALID_JSON`                                                                                                                                                                                                        |
| 401    | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_SIGNATURE` (webhook)                                                                                                                                                                   |
| 403    | `FORBIDDEN` (wrong role)                                                                                                                                                                                                                  |
| 404    | `BOOKING_NOT_FOUND`, `PACKAGE_NOT_FOUND`, `TIME_OFF_NOT_FOUND`, `ROUTE_NOT_FOUND`, `MOCKPAY_ORDER_NOT_FOUND`                                                                                                                              |
| 409    | `NO_TRAINER_AVAILABLE`, `CUSTOMER_ALREADY_BOOKED`, `PACKAGE_EMPTY`, `BOOKING_NOT_CANCELLABLE`, `BOOKING_NOT_RESCHEDULABLE`, `RESCHEDULE_TOO_LATE`, `TOO_EARLY`, `SESSION_NOT_STARTABLE`, `SESSION_NOT_COMPLETED`, `TIME_OFF_HAS_BOOKINGS` |
| 413    | `BODY_TOO_LARGE` (over 100 KB)                                                                                                                                                                                                            |
| 422    | `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_MISMATCH` (webhook), `INVALID_SLOT`, `DATE_TOO_FAR`, `INVALID_RANGE`, `PROFILE_REQUIRED`, `CUSTOMER_LOCATION_MISSING`                                                                                  |
| 429    | `RATE_LIMITED` (300 requests per minute per IP overall)                                                                                                                                                                                   |
| 500    | `INTERNAL_ERROR` (generic; the cause is only in the server log, quote `requestId`)                                                                                                                                                        |
