# Zuryo API

Express 5 + TypeScript + PostgreSQL (`pg`, hand-written SQL). Endpoint reference: [`../docs/api.md`](../docs/api.md).

## Run it

Needs Node 24 (`nvm use`) and a Postgres 14+ database with the `btree_gist` extension (Supabase has it; the first migration enables it).

```bash
cp .env.example .env     # then set DATABASE_URL and JWT_SECRET
npm install
npm run migrate          # applies migrations/*.sql in order, once each
npm run seed             # demo data; add "-- --reset" to wipe and reseed
npm run dev              # http://localhost:4000
```

| Variable                                                     | Required | Meaning                                                                                                                                       |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                               | yes      | Postgres connection string                                                                                                                    |
| `DATABASE_SSL`                                               | no       | `true` for Supabase                                                                                                                           |
| `JWT_SECRET`                                                 | yes      | at least 32 characters                                                                                                                        |
| `CORS_ORIGINS`                                               | no       | comma-separated allowed browser origins (default `http://localhost:5173`)                                                                     |
| `PORT`, `JWT_EXPIRES_IN_HOURS`, `BCRYPT_COST`, `TRUST_PROXY` | no       | defaults 4000, 12, 12, 0 (set `TRUST_PROXY=1` behind Render)                                                                                  |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`                     | no       | both set = recommendations try the LLM first                                                                                                  |
| `LLM_TIMEOUT_MS`, `SWEEP_INTERVAL_SECONDS`, `LOG_LEVEL`      | no       | 8000, 30, `info`                                                                                                                              |
| `MOCKPAY_ENABLED`                                            | no       | `true`: serve the stand-in gateway under `/mockpay`. `false`: only the webhook exists (a real gateway posts to it)                            |
| `MOCKPAY_WEBHOOK_SECRET`                                     | prod     | 16+ characters, HMAC key for webhook signatures. Required in production; a fixed dev value is used otherwise                                  |
| `PUBLIC_API_URL`, `CLIENT_URL`                               | no       | where MockPay posts its webhook (default `http://localhost:PORT`) and where the hosted checkout page lives (default the first `CORS_ORIGINS`) |
| `MOCKPAY_WEBHOOK_DELAY_MS`                                   | no       | pause before MockPay calls the webhook, default 1500, so the "waiting" state is visible                                                       |

Config is parsed once in `src/config/index.ts`; a bad or missing value stops the server at boot.

`npm run stress` runs the load test and invariant checks on its own throwaway database (results in [`../docs/stress-results.md`](../docs/stress-results.md)). `npm run build && npm start` runs the compiled server. `npm run typecheck` type-checks.

## Demo accounts

Every seeded account uses the password **`Demo@12345`** (synthetic data only).

| Role     | Email                                                      | Notes                                                                            |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| customer | `asha@zuryo.test`                                          | zone Lakeview, 10-session package (4 used), profile, 3 past sessions, 1 upcoming |
| customer | `ravi@zuryo.test`                                          | zone Lakeview, no profile, no package                                            |
| customer | `meera@zuryo.test`                                         | zone Palm Grove                                                                  |
| trainer  | `kiran@zuryo.test`, `divya@zuryo.test`, `arjun@zuryo.test` | Lakeview                                                                         |
| trainer  | `sana@zuryo.test`                                          | Palm Grove                                                                       |
| admin    | `admin@zuryo.test`                                         |                                                                                  |

## Tests

```bash
npm test
```

Starts a throwaway Postgres 18 from `/usr/lib/postgresql/18/bin` in `.tmp/` on port 55432 (override with `PG_BIN`, `TEST_PG_PORT`), migrates, seeds, runs vitest, then stops it and deletes `.tmp/`. It ignores `DATABASE_URL` and `.env`, so it cannot touch a real database. Latest run (2026-10-21): 12 files, 115 tests, all passing, about 25 s.

What is covered (real Postgres, real HTTP via supertest): 20 parallel bookings for one trainer and slot give exactly one success; losers fall through to the next trainer; idempotent retries (sequential and parallel) create and charge once; payments through the stand-in gateway (signature, tampered amount, five simultaneous identical webhooks, hold expiry, late success with the slot free or taken, failure, refund once, package activation only on the paid webhook); a package can never be deducted twice or go negative under parallel bookings; pricing (438.90, 548.90, peak boundaries, client-sent amounts ignored, rule changes do not touch old bookings); cancellation and refunds before and after the 2 h deadline, exactly once even with parallel cancels; reschedule is atomic and idempotent; session phase at 55 and 60 minutes and idempotent completion; trainer ranking and preferred trainer; role and ownership checks; the LLM path with a stubbed provider, including fallback to rules.

## How it is built

Layers, one-way (`server > app > routes > controllers > services > queries > db`), checked with the `backend-api` skill's `check-layers.mjs`:

- `routes/` method, path, middleware, schema. `schemas/` zod. `controllers/` read validated input, call one service, pick the status code.
- `services/` all business rules and transactions. `queries/` SQL only, one function per question; every booking lookup has its owner in the `WHERE`.
- `lib/` pure rules that are easy to test and explain: `pricing.ts` (price and peak), `assignment.ts` (trainer ranking), `session-phase.ts`, `recommend-rules.ts`, `booking.mapper.ts` (the only place a booking becomes JSON).

Where each rule lives:

| Rule                                                                                 | Where                                                                                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Price, commission, peak windows                                                      | `lib/pricing.ts` (numbers in the `pricing_rules` table)                                 |
| Which trainers are eligible for a time                                               | `queries/trainers.queries.ts` `eligibleWhere` (one SQL used for both slots and booking) |
| Trainer choice and tie-break                                                         | `lib/assignment.ts`                                                                     |
| Create / cancel / reschedule                                                         | `services/bookings.service.ts`                                                          |
| Timer, start, completion                                                             | `services/sessions.service.ts` + `queries/bookings.queries.ts` `completeDue`            |
| Fixed numbers (60 min, 55 min, 15 min travel/buffer, 2 h cancel window, 30 min grid) | `config/constants.ts`                                                                   |

### Decisions worth knowing

- **Double booking:** an exclusion constraint on `(trainer_id, tstzrange(starts_at, busy_until))` for active bookings, `busy_until = end + 15 min buffer`. The database rejects the loser (`23P01`) and the service tries the next candidate trainer, else returns `409` with alternative slots. A second constraint stops one customer holding two overlapping sessions. Bookings (and trainer time off) in one zone queue on a transaction-level advisory lock (`lockZone`), released by Postgres at commit or rollback: without any lock, a herd of concurrent inserts deadlocked one victim per second (`40P01`) and timed out (found by `npm run stress`, covered by `concurrency.test.ts`). The constraint stays the guarantee; a `40P01` is still treated as losing the race.
- **Idempotency:** `UNIQUE (customer_id, idempotency_key)` plus a lookup first. If a request fails, the service checks whether another request with the same key already won and returns that booking instead of the error. A hash of the normalized request is stored with the key; reusing a key with a different request is `422 IDEMPOTENCY_KEY_REUSED`. Package purchase works the same way.
- **Package balance:** `sessions_total + SUM(ledger.delta)`. The package row is locked (`FOR UPDATE`) while checking and deducting, and `UNIQUE (booking_id, reason)` makes a repeat deduction or refund impossible.
- **Refunds:** cancel is one conditional `UPDATE ... WHERE status = 'confirmed'`; only the request that changed the row refunds. A refund is a payment order `paid -> refunded` (simulated) or a ledger `+1`.
- **Online payment:** a pay-now booking is `pending_payment` with a payment order and a 10 minute hold; `pending_payment` is in the exclusion constraints, so the slot cannot be sold twice while the customer pays. Only the signed webhook (`POST /v1/payments/webhook`, HMAC-SHA256 over the raw body, constant-time compare) confirms it: it checks amount and currency against the stored order, then in one transaction locks the booking then the order and does conditional updates, so a replayed or simultaneous webhook changes nothing twice. Holds that run out are released on any read and by the sweep; a late success re-confirms if the exclusion constraint still allows it, else the order is marked `refunded`. MockPay (`services/mockpay.service.ts`, `/mockpay` routes, `mockpay_orders` table) is the stand-in provider; swapping notes are in [`../docs/api.md`](../docs/api.md).
- **Why the trainer-free check avoids the exclusion index:** `findEligible` says `status NOT IN (completed, cancelled, payment_failed, expired)` instead of listing the active states. Listing them lets Postgres answer from the partial exclusion index, and `npm run stress` showed that index sometimes missing a booking that had just been confirmed (a btree scan saw it, the GiST scan did not; seen on Postgres 16.15 and 18.6, cause not found). The check runs inside the zone lock, so by itself it keeps one zone from double-booking a trainer. Six full stress runs in a row passed after the change; about half failed before it.
- **Session timer:** `started_at` and `session_ends_at` are set by the server when the trainer starts. They are separate from the booked `ends_at` so a late start never moves the range the exclusion constraint guards. Status is derived: every read first completes sessions past their end with a conditional `UPDATE ... RETURNING` that also writes the "completed" notifications in the same statement, so a read and the 30 s sweep racing produce one completion and one set of notifications. The sweep only makes notifications timely.
- **Trainer start window:** from 30 minutes before `starts_at` (so an instant booking, which starts 15 min out, can be started at once in a demo).
- **Auth:** JWT (HS256, 12 h) as a bearer header, as the project decisions chose, so the same API serves a web and a later React Native client. The trade-off against an httpOnly cookie: any XSS can read the token, so the client must keep it in memory or tightly controlled storage. Logout bumps `users.token_version`, which invalidates all earlier tokens. Passwords: bcrypt cost 12. No self-registration (demo accounts only).
- **Security baseline:** helmet, CORS allowlist, 100 KB body limit, rate limits (global, login keyed by IP + email, recommendations), zod on every input, one error shape with no stack traces, secrets redacted from logs. `npm audit`: 0 vulnerabilities at the time of writing.

## AI recommendation

`GET /v1/recommendations/next-workout` builds the next workout from the fitness profile and the last 5 recorded sessions.

- **Rules engine (always available, `engine: "rules"`):** maps the customer's goals to body areas, picks the two least recently trained, scales sets and intensity by level, uses low-impact variants for age 50+ or a "low impact" preference. Deterministic.
- **LLM path (optional, `engine: "llm"`):** when `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are set, the server asks that model first. The call is server-side only, has a timeout (`LLM_TIMEOUT_MS`), and the JSON answer is validated with zod; any failure (network, HTTP error, timeout, malformed answer) falls back to the rules. The prompt is a short system instruction plus a JSON payload of age, weight, goals, level, preferences and the last sessions' dates, durations and exercises. No name, email, id or free-text note is sent.
- **Model:** `dots-studio/dots-3-note-preview:free`, a reasoning model. The request sets `reasoning: { enabled: false }`; with reasoning on it used the whole 700-token budget thinking and returned empty content.
- **Cost and latency (measured 2026-10-21, 5 calls):** about 444 input and 210 to 290 output tokens, 3.9 to 5.6 s. The model is free, so cost is 0; on a paid model it is `444 x input price + 260 x output price` per call. The 8 s timeout bounds the worst case.
- **Limitations:** general fitness suggestions, not medical advice; the model sees only the last 5 sessions; the rules engine knows a small exercise library and six goals.

## Known limits

- Payment is simulated by MockPay; no real provider is wired. A booking waiting for payment cannot be cancelled by the customer, it expires after 10 minutes. Rescheduling a paid booking refunds the old one and asks for a new payment at the new time; if that payment fails the old booking is already refunded and cancelled. Packages bought online are not refunded on failure (they never become active).
- Working hours are one window per weekday inside a single day (no overnight shifts); changing hours does not move existing bookings.
- A confirmed session that is never started stays `confirmed` (no no-show state).
- No push notifications: notifications are rows read by polling.
