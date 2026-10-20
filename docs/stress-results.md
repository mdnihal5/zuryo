# Stress test results

Run with `npm run stress` in `api/`. It starts its own throwaway Postgres (18 by default, `PG_BIN` to change; port 55490) and the API (port 4500), seeds 3 zones, 30 trainers (open 24 h) and 300 customers (half with a 20-session package), runs the three scenarios, checks the invariants in SQL, then stops both and deletes `api/.tmp-stress/`. Rate limits are off for this run only (`RATE_LIMIT_ENABLED=false` in the API's environment, set inside `scripts/stress.ts`); production keeps them on.

Machine: low-power laptop, one API process, Postgres and the load generator on the same machine, so the numbers are a floor, not a capacity claim. `pg` pool of 20 connections.

## Results (2026-10-19, after the correctness review)

Same machine, but a second agent was recording a demo on it at the same time, so treat differences under about 20% as noise. "Before" is the first run of the day (session-level per-trainer advisory lock); "after" uses a transaction-level per-zone lock, an index on `bookings.rescheduled_from` and one INSERT for all notifications of an event (see `correctness-review.md`).

**A. Thundering herd.** 200 customers, one zone of 10 trainers, 100 instant and 100 scheduled at the same moment.
10 + 10 bookings succeeded (one per trainer per mode), 180 got `409 NO_TRAINER_AVAILABLE` with alternative slots, zero 5xx. Before: slowest reply 3.2 s. After: 6-7 s, because requests for one zone now run one after another (each holds the zone lock until its commit), and the 200 also queue behind 20 connections.

**B. Retry storm.** 50 customers x 5 concurrent identical requests, one Idempotency-Key each: all 250 replies `201` with the same booking id, one booking and one charge per customer. Before p50 1.1 s, after 2.3 s (same queueing).

**C. Mixed load.** 60 s, 50 concurrent workers, zero 5xx.

| Endpoint                  | before p50 / p95 ms | after p50 / p95 ms |
| ------------------------- | ------------------- | ------------------ |
| GET /slots                | 344 / 591           | 246 / 352          |
| GET /quote                | 160 / 287           | 140 / 216          |
| GET /bookings             | 235 / 393           | 212 / 315          |
| POST /bookings            | 420 / 875           | 793 / 1314         |
| POST /bookings/:id/cancel | 302 / 479           | 229 / 335          |
| throughput                | 154 req/s           | 157 req/s          |

Reads got a little faster (the index, less contention); `POST /bookings` got slower on purpose: it now holds a zone lock for its whole transaction. That is the price of removing a leaked-lock hazard, the deadlocks of falling through several trainers, and the time-off race. Query times are not the bottleneck: `EXPLAIN ANALYZE` on 30 trainers and 1,800 bookings showed 18 ms for a whole day of slots and about 1 ms for the other hot queries, all on indexes. The latencies above are mostly the load generator, Node, and Postgres sharing one laptop.

## After online payment (2026-10-19, evening)

Bookings without a package now go `pending_payment` -> webhook -> `confirmed`. The harness pays every winning booking through MockPay's real HTTP endpoint, which calls the API's webhook back over HTTP; mixed load pays 70%, fails 15% and abandons 15%. Postgres 18.6, same laptop.

- **Herd:** 10 + 10 successes (one per trainer per mode), 180 clean 409s, zero 5xx. All 20 payments settled by webhook.
- **Retry storm:** 250 replies, all `201`, all five replies per customer carry the same booking and the same payment order. Then 5 simultaneous signed copies of the same success webhook per order (25 orders): every reply 200, exactly one `confirmed`, four `replay`, 2 notifications per booking.
- **Mixed load, 60 s:** 8,157 requests, 136 req/s, zero 5xx. `POST /bookings` p50 904 ms / p95 1,865 ms (slower than before, the machine was also running Postgres, the API and 50 workers; payments add a second write per booking), `POST /mockpay complete` p50 129 / p95 269 ms, 763 completions all settled by their webhook.
- **Invariants:** all PASS, including the new ones (every pay-now booking has exactly one order that matches its status, no paid order behind an unconfirmed booking, no payment id on two orders, no trainer told about an unpaid booking).

Before the fix described in `correctness-review.md` ("Found and fixed while adding payments") roughly half of the runs failed the per-trainer overlap invariant; after it, 7 consecutive full runs passed (6 on Postgres 16.15, the last on 18.6).

## Invariants after the run: all PASS

No overlapping active bookings per trainer (`busy_until`) or per customer; every booking has exactly one payment or one ledger -1; no package balance below zero; no duplicate `(booking_id, reason)` in the ledger; refunds exist only for cancellations at least 2 h before the start, and every such cancellation was refunded; no error-level line in the API log.

## What the first run found

The first run failed: in the herd, 59 of 100 scheduled requests returned `500` (`57014 statement timeout`) and replies took up to 60 s.

Root cause: concurrent inserts for the same trainer and time each find the others' uncommitted rows and wait for each other. Postgres breaks each such cycle with a deadlock error after `deadlock_timeout` (1 s), one victim at a time, so a herd of 100 resolved at about one request per second and the rest hit the 10 s statement timeout.

Fix: bookings in a zone queue on a transaction-level advisory lock (`lockZone`), so a loser sees the winner's committed row and gets a clean `409`. The exclusion constraint is still what guarantees correctness; the lock only removes the waiting cycle. The first version of this fix used a per-trainer session-level lock released right after the insert; the correctness review replaced it (see `correctness-review.md`). Regression test: "a herd of 100 for 10 trainers" in `api/test/concurrency.test.ts`.

## Not covered

Reschedule under load, trainer start/record endpoints, more than one zone busy at once beyond the 3 seeded, multiple API processes, a remote database (Supabase adds network latency to every query), and a run longer than 60 s.

## Postgres version note

Overlap finding: in some runs (seen on local Postgres 16.15 and 18.6) two active bookings overlapped for one trainer. A table scan found the older confirmed booking but a scan of the GiST exclusion index did not; the index had lost the entry for that live row (details and status in `architecture.md`, cause unconfirmed). Since then the app's own overlap checks avoid that index and run under the zone lock, with the constraints as the backstop. After the change: 112/112 tests and 2/2 full stress runs passed at the hour that used to fail (21:20 IST, Postgres 18.6).
