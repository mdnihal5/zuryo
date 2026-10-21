# Submission

Answers follow the numbering of the brief. Details and code pointers are in [architecture.md](architecture.md); endpoint reference in [api.md](api.md). Implemented, partial and proposed features are listed in the [README](../README.md). A 5-minute walkthrough video: https://youtu.be/Z7haQ4hFmts.

## Section 6: architecture and engineering decisions

**1. Stack.** React, Vite and TypeScript for the client; Express 5 and TypeScript for the API; PostgreSQL on Supabase; the API on Render and the client on Vercel.

- The brief allows a responsive web app, so one client serves all three roles. React Native is the later evolution (below).
- Postgres because the core rules are database rules: no overlapping bookings, one ledger row per booking, unique payment ids. Those are exclusion and unique constraints, which a document store would make me rebuild in application code.
- Raw SQL with `pg` and numbered migrations instead of an ORM. The parts that matter (exclusion constraint, advisory lock, conditional updates) are SQL anyway.
- TanStack Query owns server data (polling, refetch after writes). Zustand holds the two client-only values: the token and the checkout draft with its idempotency key. A Redux store would manage almost nothing.
- Render free, Vercel hobby and Supabase free cost nothing, which the brief requires.

**2. Data model and key APIs.** Tables and constraints are in architecture.md. Key endpoints: `POST /auth/login`, `GET /slots`, `GET /quote`, `POST /bookings`, `POST /bookings/:id/cancel`, `POST /bookings/:id/reschedule`, `POST /packages`, `GET/PUT /profile`, `GET /recommendations/next-workout`, `POST /trainer/sessions/:id/start`, `PUT /trainer/sessions/:id/record`, `PUT /trainer/availability/hours`, `GET/PUT /admin/pricing-rules`, `POST /payments/webhook`.

**3. Trainer assignment.** Eligible: same zone as the customer, inside working hours, not on time off, no overlapping booking. Ranking: preferred trainer if eligible, then fewest sessions that day, then nearest (straight-line distance from seeded coordinates), then lowest id. The id tie-break makes the result reproducible in tests. Random order cannot be tested and id order alone piles every booking on one trainer. The choice and all candidates are stored on the booking.

**4. Double booking and simultaneous requests.** Three layers.

- A transaction-level advisory lock per zone makes bookings in a zone queue instead of waiting on each other's uncommitted rows. Without it, a herd of 100 requests produced 59 timeouts in the first stress run, because Postgres resolves each wait cycle one deadlock at a time.
- The application checks overlap under that lock.
- Exclusion constraints (trainer and customer) reject whatever slips through with `23P01`; the service then tries the next trainer.

The stress finding (a GiST index entry missing in some runs, cause unconfirmed) and the change it led to are in architecture.md. Honest status: the guarantee is "app check under lock, constraint as backstop", not "the constraint alone".

**5. Timers, reminders, status.** The server stores `started_at` and `session_ends_at`. Phase and completion are derived from those times on every read, so correctness does not depend on a worker running. A 30-second sweep makes the completion notification timely. Refresh and reopen just re-read the booking; device clock error is removed with a `serverNow` offset. Delayed notifications cannot change state because state is derived, not pushed. At 55 minutes the server writes a `session_warning` notification for the trainer and the customer (once per person, enforced by a unique index), and the open timer also sounds a buzzer. A closed app sees the notification on its next poll; real-time reminders to a closed app need push (item 7).

**6. Pricing, commission, package balance.** Price is computed on the server from the `pricing_rules` row, in integer paise with round-half-up commission, and snapshotted on the booking. The client never sends an amount; the webhook amount is compared with the stored order. Package balance is `sessions_total + SUM(ledger.delta)`, not a counter. `UNIQUE (booking_id, reason)` makes a second deduction impossible, even on a retry or two tabs. Cancelled sessions: cancel at least 2 hours before start adds a `+1` refund row (or refunds the payment); later cancels return nothing. Credit is taken at booking, otherwise someone with 8 credits could book 12 sessions.

**7. Notifications, GPS, live ETA in production.**

- Built: notification rows for assigned, cancelled, rescheduled, 55-minute warning, completed and payment events, shown to both trainer and customer and polled every 30 s.
- Production notifications: write the notification and an outbox row in the same transaction; a worker sends through FCM and APNs (and SMS for reminders), retries, and drops dead tokens. Reminders (for example 1 hour before) are rows in a scheduled-jobs table processed by the worker.
- Location: the trainer app sends its position every 5 to 10 seconds while a session is within, say, 45 minutes. The API validates and keeps only the latest point per trainer (a small table or Redis), not a full trail.
- ETA: ask a routing API (Google Distance Matrix, or self-hosted OSRM) from the trainer's last point to the customer, no more than once per 30 seconds per booking, and push the result to the customer over SSE or WebSocket. Straight-line distance times a speed factor is the fallback when the routing call fails.
- Privacy: share location only from "on the way" until arrival; delete points after the session.
- Today coordinates are seeded and only used for the distance tie-break.

**8. Authentication, authorization, secrets, privacy.** Bearer JWT with roles, ownership in every query, `token_version` logout, rate-limited login, bcrypt. Secrets come from environment variables validated at boot; none are in the repository. Only synthetic data is stored. The LLM gets structured fields only. Details in the architecture security section. Not done: refresh tokens, email verification, password reset, an audit log for admin edits.

**9. Scaling.** See "Cost and scale" below.

**10. Cost.** See "Cost and scale" below.

## Section 3 explain-asks

- **Peak slots.** A slot is peak when its start time in Asia/Kolkata falls inside a configured window (seeded 06:00-09:00 and 18:00-21:00, end exclusive). Windows are data in `pricing_rules`, editable by the admin, and applied to new bookings only.
- **Production location tracking and live ETA.** Item 7 above.
- **Refresh, closure, clock difference, delayed notification.** Item 5 above.
- **Cancelled sessions and refunds on package balance.** Item 6 above.
- **AI feature.** `GET /recommendations/next-workout` builds a plan from the profile and the last five session records.
    - Rules baseline: goals map to body areas, the two areas trained least recently are chosen, sets and intensity follow the level, low-impact variants for age 50+ or a stated preference. Same input gives the same output.
    - Model: `dots-studio/dots-3-note-preview:free` through OpenRouter, chosen because it is free and returns JSON. It is a reasoning model, and with reasoning on it spent the whole 700-token budget thinking and returned empty content (the app then quietly used the rules). The request sends `reasoning: { enabled: false }`, so the answer comes back directly. Any OpenRouter model works by changing `OPENROUTER_MODEL`; free preview models can disappear, which is one more reason the rules fallback exists.
    - LLM path: when `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are set, the server calls that model first (temperature 0.3, JSON response, 700 max tokens, 8 s timeout). The output is validated with zod; any failure falls back to the rules. The response says which `engine` produced it.
    - Prompt: a system message limiting the answer to general fitness with no medical advice, and a JSON user message with age, weight, goals, level, preferences and recent exercises. Credentials stay on the server.
    - Cost and latency, measured on 2026-10-21 with 5 calls of a realistic payload (profile plus five sessions): about 444 input and 210 to 290 output tokens, 3.9 to 5.6 s end to end (median 4.7 s). The demo model is free on OpenRouter, so the cost is 0. On a paid small model the cost per call is `444 x input price + 260 x output price`; at an assumed 0.15 USD per million input and 0.60 USD per million output tokens that is about 0.0002 USD, so 10,000 recommendations cost about 2 USD. The 8 s timeout bounds the worst case, after which the rules answer instantly.
    - Limits: general suggestions, no injury or medical awareness, sees only five sessions, the rules library has five areas and six known goals.
- **Evolving to React Native.** The API is already client-agnostic: bearer tokens, no cookies, JSON only, `serverNow` on every response. A new Expo client reuses the endpoints and the types. The client's `api.ts`, query hooks and clock-offset logic carry over; screens are rewritten. Needed additions: push tokens endpoint, secure token storage, background location for trainers.

## Section 7: design proposals

**Surge pricing by demand and lead time (detailed).**

- Idea: multiply the base price by a factor from fill rate for that zone and hour and from lead time (a same-day slot costs more than one booked a week out). Keep fixed peak windows as the floor.
- Data: `pricing_rules` gets a `surge_curve` JSON (fill-rate bands to multiplier, lead-time bands to multiplier) and a hard cap. `bookings` already snapshots the price; add `surge_multiplier` and `pricing_version` for audit.
- API: `GET /quote` returns the multiplier and a reason string ("busy evening"); `PUT /admin/pricing-rules` edits the curve. The quote carries an expiry (for example 5 minutes) and `POST /bookings` rejects an expired quote with `409 QUOTE_EXPIRED` and the new price, so the customer never pays an amount they did not see.
- Dependencies: a fill-rate query per zone and hour (trainers free divided by trainers working), cached for a few seconds.
- Edge cases: price changing between quote and pay; rescheduling into a surge slot (charge or refund the difference, or keep the old price); a cap so a bug cannot charge 10x; a package credit used in a surge slot (credit is flat, so surge must be capped or excluded); fairness and disclosure.

**Live trainer location and arrival ETA (detailed).**

- Flow: when a booking is confirmed and within 45 minutes of start, the trainer app shows "I'm on my way". That starts location posts, the customer screen shows a moving marker and ETA, and arrival is detected by a geofence (for example 100 m) or a manual "arrived" button.
- Data: `trainer_locations (trainer_id PK, lat, lng, accuracy_m, heading, recorded_at)` holding the latest point only; `bookings` gets `en_route_at` and `arrived_at`.
- API: `POST /trainer/location` (rate limited, accepted only when the trainer has a booking in the window); `GET /bookings/:id/live` (SSE) streams position and ETA to the owning customer only; `POST /trainer/sessions/:id/en-route` and `/arrived`.
- Dependencies: a routing/ETA provider (billed per request, so cache and throttle), mobile background-location permission, an SSE or WebSocket path, which does not fit Render free sleeping and needs a paid always-on instance.
- Edge cases: no GPS signal (show last point and its age); trainer stationary or lying about being en route; battery use (adaptive update rate); permission denied (fall back to a manual status); stale points after the session; location privacy and deletion; ETA later than the booked start (notify the customer, let them cancel free).

**Others (short).**

- Push, reminders and offers: outbox plus worker as in item 7. Offers need a `campaigns` table, per-user frequency caps and an opt-out. Dependency: FCM/APNs.
- Preferred trainer selection and availability: built (preferred id on booking, availability editor, time off). Next: a "favorite trainers" list and showing each trainer's free slots in the picker.
- Feedback and ratings: customer rating and comment are built; trainer cards show the average. Next: trainer's private rating of the customer, one rating per session, moderation of comments, and minimum counts before showing an average.
- Workout recommendations on non-booking days: the existing endpoint plus a daily scheduled job writing a suggestion row and a push; lighter, equipment-free plans.
- Nutrition chatbot: a scoped chat endpoint with a fixed system prompt, refusal rules for medical advice, per-user rate limits and cost caps. Highest risk of the set; needs a content policy first.
- Progress tracking: repeat assessments stored as dated rows (weight, goals, level) instead of one overwritten profile, then charts from assessments plus session records.

## Cost and scale

Prices below are approximate; check the vendors' current pricing pages before relying on them.

| Setup                                                            | Monthly cost (approximate) | Limits                                                                      |
| ---------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| This demo: Render free + Vercel hobby + Supabase free            | 0                          | API sleeps when idle (slow first request); small database; no SSE/WebSocket |
| Pilot: always-on Render instance + Supabase paid                 | about 30 to 40 USD         | No cold starts, backups, more connections                                   |
| Growth: 2 API instances, pooler, one read replica, push provider | a few hundred USD          | Depends on traffic and routing API volume                                   |

Cost drivers in order: database size and connections, always-on compute, routing/ETA API calls (per request), push and SMS volume, LLM tokens, payment gateway fees (a percentage per transaction, usually the largest cost once revenue exists).

**What breaks first, and the fix.**

| Load  | First problem                                                                                                                                                   | Fix                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10x   | Every booking list or slot read also runs the completion and hold-expiry updates, so reads write. Polling every 30 s from every open client adds constant load. | Rely on the sweep for expiry, keep read-time derivation as a cheap `SELECT`; move to SSE or push instead of polling.                                                |
| 10x   | Connection count: pool of 20 per API instance against a small database.                                                                                         | Supabase pooler in transaction mode (the advisory lock is transaction-level, so it is safe); keep transactions short.                                               |
| 10x   | Bookings in one busy zone run one after another (measured: p95 over 1 s at 50 concurrent on a laptop).                                                          | Shorten the transaction; zones are already independent locks.                                                                                                       |
| 100x  | One primary handles reads and writes; slot search scans trainers per time step.                                                                                 | Read replicas for lists and slots (accept small lag), cache slot availability per zone for a few seconds.                                                           |
| 100x  | Notifications as rows polled by clients; in-process sweep on every instance (safe, since updates are conditional, but wasteful).                                | Outbox plus a queue and a worker for notifications; one scheduled worker instead of a timer per instance.                                                           |
| 100x+ | `bookings` grows without bound.                                                                                                                                 | Archive completed rows (hot/cold split or monthly partitions); I have not checked how exclusion constraints behave on partitioned tables, so test before promising. |
| 100x+ | One database for all cities.                                                                                                                                    | Shard by city or zone: a trainer belongs to one zone, so no booking crosses shards.                                                                                 |

The measured numbers are in stress-results.md. They come from one laptop running everything, so they show relative behavior, not capacity.

## Assumptions

- Free cancel or reschedule until 2 hours before start (not specified in the brief; configurable in `config/constants.ts`). Later cancels get no refund.
- "UPI payment" is a simulated gateway (MockPay) with a signed webhook, as the brief allows. No real credentials.
- Instant booking means a session starting 15 minutes from now (travel estimate); a 15-minute buffer after each session blocks the trainer.
- Slots are on a 30-minute grid, up to 14 days ahead; customers and trainers belong to one zone each; one working window per weekday.
- Price per session in a package is the normal all-in price with no discount; packages of 5, 10 or 20.
- Demo notifications are in-app only. India has no daylight saving, so the zone offset is fixed at +05:30.

## Known limitations

- Customers cannot cancel a booking that is still waiting for payment; it expires after 10 minutes.
- Rescheduling a paid booking refunds the old one and asks for a new payment; if that payment fails, the old booking is already cancelled.
- A confirmed session that is never started stays `confirmed` (no no-show state). Trainers cannot cancel or reschedule a booking.
- Packages bought online are not refunded on a failed payment because they never activate. No package expiry.
- No overnight trainer shifts; changing hours does not move existing bookings.
- Tests and the stress run were done on local Postgres, not on Supabase; the stress finding above is unresolved.
- Trainers cannot end a session early or mark a no-show: the server ends every session at 60 minutes. Ending early is a product rule (refund or partial credit?) that the brief does not settle.
- Landing-page prices are fixed in the page (the API has no public pricing endpoint); checkout always uses the live server price.
- Not built: push, email, SMS, live location, surge pricing, chatbot, trainer ratings of customers, charts.

## Tests

`cd api && npm test` starts a throwaway Postgres, migrates, seeds and runs vitest against real HTTP. Run on 2026-10-21: 12 files, 115 tests, all passing; the client suite has 14 tests, all passing. It covers 20 parallel bookings for one slot, idempotent retries, webhook signature, tampered amount and duplicate webhooks, hold expiry, package balance under parallel bookings, price examples (438.90, 548.90), cancel and refund timing, session phase at 55 and 60 minutes, the 55-minute warning written once per person, assignment order, role checks and the LLM fallback. `cd client && npm test` runs the client unit tests.

## What I would build next, and why

1. Run the stress test against the deployed Supabase database, because the open index finding is the biggest unanswered correctness question.
2. A real gateway sandbox (Cashfree or Razorpay) behind the same webhook, since the money path is the part users trust most.
3. Push notifications through an outbox, because a timer that only sounds in an open tab is the weakest part of the session experience.
4. Trainer cancellation and a no-show state, which operations will hit in week one.
5. Live location and ETA, the feature that most separates this from a booking form.
