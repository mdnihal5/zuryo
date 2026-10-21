# Architecture

## Components

```
  Browser (React SPA, static files)
     |  HTTPS, Bearer JWT, Idempotency-Key on writes
     v
  Express API (Node 24, one process)
     |-- routes -> controllers -> services -> queries --> PostgreSQL (Supabase)
     |-- sweep timer (every 30 s): complete due sessions, expire payment holds
     |-- MockPay module (stand-in gateway, /mockpay)
     |        |  signed webhook, HTTP back into the same API
     |        v
     |   POST /v1/payments/webhook  (raw body, HMAC check)
     '-- OpenRouter (optional, server-side key) for workout recommendations
```

Everything is one deployable API plus static client files. State lives in Postgres only. The API keeps no in-memory state that matters, so a restart loses nothing.

## Request path and layering

A request goes through: request id and logging, helmet, CORS allowlist, rate limit, JSON parse (100 KB limit), auth, role check, zod validation, controller, service, query, error handler. The payment webhook is mounted before the JSON parser because the signature covers the raw bytes.

Layers only call downward: `routes > controllers > services > queries > db`.

- `routes/` method, path, middleware, schema.
- `controllers/` read validated input, call one service, pick the status code.
- `services/` business rules and transactions.
- `queries/` SQL only. Every booking lookup has its owner (customer or trainer) in the `WHERE`.
- `lib/` pure functions that are easy to unit test: pricing, assignment ranking, session phase, recommendation rules.

All errors share one shape: `{ error: { code, message, requestId }, serverNow }`. No stack traces leave the server.

## Data model

Defined in `api/migrations/001_schema.sql`. Money is integer paise everywhere.

| Table                                 | Purpose                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `zones`, `users`, `trainers`          | Service zones; users with role; trainers with zone, home coordinates, specialties                  |
| `trainer_hours`, `trainer_time_off`   | One weekday window per trainer (Asia/Kolkata local time); time-off ranges                          |
| `pricing_rules`                       | Single row (`id = 1` check): normal, peak, commission in basis points, peak windows as JSON        |
| `packages`                            | Sessions bought; `UNIQUE (customer_id, idempotency_key)`; `pending_payment` until the webhook      |
| `package_ledger`                      | Append-only +1 / -1 rows; `UNIQUE (booking_id, reason)`                                            |
| `bookings`                            | Times, status, price snapshot, timer fields, idempotency key, `assignment` JSON (candidates, rule) |
| `payment_orders`                      | One per booking or package; amount snapshot; `provider_order_id` and `provider_payment_id` unique  |
| `mockpay_orders`                      | The stand-in gateway's own records                                                                 |
| `fitness_profiles`, `session_records` | Assessment; per-session exercises, notes, rating, comment, suggested next workout                  |
| `notifications`                       | Per-user rows with `read_at`                                                                       |

Constraints that carry correctness:

- `bookings_trainer_no_overlap`: `EXCLUDE USING gist (trainer_id WITH =, tstzrange(starts_at, busy_until, '[)') WITH &&) WHERE status IN ('pending_payment','confirmed','in_progress')`. Needs `btree_gist`. Half-open ranges so 10:00-11:00 and 11:15-12:15 never clash. `busy_until` is the end plus a 15-minute buffer.
- `bookings_customer_no_overlap`: the same for `customer_id`, so two tabs cannot buy two trainers for one hour.
- `bookings_customer_idempotency_key`: `UNIQUE (customer_id, idempotency_key)`, with a stored request hash so the same key with a different body is rejected (`422`) instead of replayed.
- `package_ledger UNIQUE (booking_id, reason)`: one deduction and at most one refund per booking, enforced by the database.
- `payment_orders`: unique partial indexes give one order per booking and per package; `provider_payment_id UNIQUE` stops one payment settling two orders.
- Price columns are a snapshot on the booking. Changing `pricing_rules` never touches an existing booking.

## Booking flow

`POST /v1/bookings` with `Idempotency-Key`, mode, optional `startsAt`, optional preferred trainer, optional package id.

1. If the key already exists, return that booking (after checking the request hash).
2. Resolve the start. Instant: now plus 15 minutes of travel, rounded up to the minute. Scheduled: must be on the 30-minute grid, at least 15 minutes out, at most 14 days out.
3. Open one transaction. Compute the price on the server from `pricing_rules`. Take a transaction-level advisory lock for the customer's zone (`pg_advisory_xact_lock`). Expire stale payment holds.
4. If a package is used, lock the package row and check that sessions remain.
5. Find eligible trainers (below), rank them, and try to insert in rank order. Each insert that loses to the exclusion constraint (`23P01`) is skipped and the next trainer is tried, inside a savepoint because any SQL error aborts the transaction.
6. Package booking: status `confirmed`, ledger `-1`, trainer notified. Pay-now booking: status `pending_payment` with a 10-minute hold and a payment order for the server's total.
7. No trainer: `409 NO_TRAINER_AVAILABLE` with up to five alternative slots.

**Assignment rule** (`lib/assignment.ts`, one function). Eligible means: in the customer's zone, inside working hours that day, not on time off, no overlapping unfinished booking. Order: the preferred trainer if eligible, then fewest sessions that day, then nearest by straight-line distance from the customer's seeded coordinates, then lowest trainer id so results are reproducible. The booking stores every candidate considered and which rule picked the winner; the admin view shows it.

**Cancel and reschedule.** Cancel is one conditional `UPDATE ... WHERE status = 'confirmed'`. Only the request whose update changed the row issues the refund. Up to 2 hours before start the refund is a ledger `+1` or a simulated payment refund; later, nothing comes back. Reschedule cancels the old booking and creates the new one in one transaction; if no trainer is free, the old booking stays as it was.

## Payment: hold and webhook

1. The booking exists as `pending_payment` and holds the slot (it is inside the exclusion constraint).
2. The client opens the hosted MockPay page (`/pay/:providerOrderId`). The page talks only to MockPay.
3. MockPay posts `PAYMENT_SUCCESS_WEBHOOK` or `PAYMENT_FAILED_WEBHOOK` to `/v1/payments/webhook`, signed with HMAC-SHA256 over the raw body (`x-mockpay-signature`), compared with `timingSafeEqual`.
4. Order of checks: signature (before reading the body), order exists, amount and currency equal the stored snapshot (`422` otherwise), then one transaction with conditional updates (`created -> paid`, `pending_payment -> confirmed`).
5. A repeated or concurrent event gets `200 replay` and changes nothing. A browser redirect never confirms anything.
6. Holds not paid within 10 minutes become `expired`, on any read that shows bookings or slots, before every booking, and in the sweep. A late success re-confirms if the slot is still free (under the zone lock) and otherwise auto-refunds.

Swapping to a real sandbox (Cashfree, Razorpay) replaces order creation, the hosted page and the signature scheme; the order table, states and webhook handler stay. Steps are in `docs/api.md`.

## Session timer

- The trainer's `POST /trainer/sessions/:id/start` stores `started_at = now` and `session_ends_at = now + 60 min` on the server. The trainer may start up to 30 minutes before `starts_at`. A second tap returns the running session.
- Phase is derived from stored times and the server clock: `upcoming`, `running`, `warning` (from `started_at + 55 min`), `completed`. There is no client-supplied time.
- Completion is derived. Every read that shows bookings first runs a conditional `UPDATE ... WHERE status = 'in_progress' AND session_ends_at <= now`. The sweep (every 30 s) runs the same statement so the "completed" notification is not late. Two racing callers cannot complete twice or notify twice, because only the row-changing update proceeds.
- `session_ends_at` is separate from the booked `ends_at`, so a late start never moves the range the exclusion constraint guards.
- Package credit was taken at booking, so completion never touches money.
- Every response carries `serverNow`. The client keeps `offset = serverNow - Date.now()` and counts down against `Date.now() + offset`, so a wrong device clock does not matter. A refresh re-reads the booking. The 55-minute buzzer fires from the client's timer using the server's `warningAt`; if the app is closed, nothing sounds (push is the production answer).

## Pricing

`lib/pricing.ts`. Session price is 39,900 paise (normal) or 49,900 (peak). Commission is `floor((price * bps + 5000) / 10000)` with `bps = 1000`, integer arithmetic with round half up: 399.00 + 39.90 = 438.90, and 499.00 + 49.90 = 548.90. A slot is peak when its start time, in Asia/Kolkata, falls in a configured window (seeded: 06:00-09:00 and 18:00-21:00; start inclusive, end exclusive). Rules live in the `pricing_rules` row and `PUT /admin/pricing-rules` changes them for new bookings. The client sends no amount; `GET /quote` shows the breakdown, and the server recomputes at booking and stores the snapshot. A package costs the normal all-in price times the session count, no discount.

## Security baseline

- Auth: bcrypt (cost 12) passwords, a dummy hash compared when the email is unknown, JWT HS256 with 12 h expiry and a `token_version` claim so logout invalidates all earlier tokens. Role checks in middleware and an owner id in every booking query.
- Limits: global 300 requests/min per IP, login 10 per 15 min per IP and email, recommendations 6 per minute.
- helmet, CORS allowlist from env, zod on every input, 100 KB body limit.
- Secrets only from environment, parsed once at boot with zod (missing or short values stop the server). `.env` is git-ignored; Render generates the JWT and webhook secrets.
- The LLM receives only age, weight, goals, level, preferences and recent exercises. No name, email or id.
- The token is kept in `sessionStorage`. That is readable by script injected into the page; an httpOnly cookie would avoid that but is awkward for a later React Native client. Accepted for the MVP.

## Logging

One line per meaningful event (`booking.created`, `payment.webhook`, `session.completed`, `ledger.debit`), written after the transaction commits so a rolled-back booking never logs a charge. Text in development, JSON in production, a request id on every line and in the `X-Request-Id` header. Keys matching password, token, secret, authorization, api key or database url are redacted.

## Double-booking stress finding

The load test (`npm run stress`) checks invariants in SQL after a run. After payment holds were added, some runs ended with two confirmed bookings overlapping for one trainer, which the exclusion constraint should make impossible.

What was established: the rows were real; a table scan found the older confirmed booking, but a forced scan of the GiST index did not, and `pageinspect` showed the index had no entry for that live row. B-tree indexes were intact. It was seen on local Postgres 16.15 and 18.6 builds, always with the older row having gone `pending_payment -> confirmed` by update. I could not reproduce it with SQL alone (several runs on 14, 16 and 18), so the cause is unconfirmed. I suspected a GiST bug fixed upstream in 2026, but the evidence for that is weak.

What changed: the application's own overlap checks (`findEligible`, the time-off check, the late-payment re-confirm) now say "not finished" instead of listing the active states. That form is answered from the B-tree path, not from the exclusion index, and the checks run under the zone lock. The constraints stay as a backstop. After the change the full test suite and two stress runs passed. This hides no bug in the application that I know of, but it does not explain the missing index entry either; run the stress test on the database version you deploy.

Related numbers (laptop, one API process, same machine as Postgres and load generator, so a floor): 150 to 160 requests/s mixed load, zero 5xx, `POST /bookings` p95 about 1.3 to 1.9 s because bookings in one zone run one after another. Details in `docs/stress-results.md`.
