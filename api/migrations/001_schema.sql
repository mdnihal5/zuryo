-- btree_gist lets a plain "=" on trainer_id live in the same GiST index as a time range (see bookings_no_overlap).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE zones (
  id   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE users (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('customer', 'trainer', 'admin')),
  -- customers only: their service zone and simulated GPS position
  zone_id       int REFERENCES zones (id),
  lat           double precision,
  lng           double precision,
  -- bumping this invalidates every token issued before (logout everywhere)
  token_version int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trainers (
  id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id  int NOT NULL UNIQUE REFERENCES users (id),
  zone_id  int NOT NULL REFERENCES zones (id),
  home_lat double precision NOT NULL,
  home_lng double precision NOT NULL,
  specialties      text[] NOT NULL,
  experience_years smallint NOT NULL CHECK (experience_years >= 0)
);

-- One working window per weekday, in Asia/Kolkata local time. weekday: 1 = Monday ... 7 = Sunday (ISO).
CREATE TABLE trainer_hours (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trainer_id int NOT NULL REFERENCES trainers (id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time   time NOT NULL,
  CHECK (start_time < end_time),
  UNIQUE (trainer_id, weekday)
);

CREATE TABLE trainer_time_off (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trainer_id int NOT NULL REFERENCES trainers (id) ON DELETE CASCADE,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  reason     text,
  CHECK (ends_at > starts_at)
);

-- Exactly one row (id = 1). Admin edits it; bookings copy the numbers they used.
CREATE TABLE pricing_rules (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  normal_price_paise int NOT NULL CHECK (normal_price_paise > 0),
  peak_price_paise   int NOT NULL CHECK (peak_price_paise > 0),
  commission_bps     int NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  -- [{"start":"06:00","end":"09:00"}, ...] in Asia/Kolkata, start inclusive, end exclusive
  peak_windows       jsonb NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pricing_rules (normal_price_paise, peak_price_paise, commission_bps, peak_windows)
VALUES (39900, 49900, 1000, '[{"start":"06:00","end":"09:00"},{"start":"18:00","end":"21:00"}]');

CREATE TABLE packages (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id     int NOT NULL REFERENCES users (id),
  sessions_total  int NOT NULL CHECK (sessions_total > 0),
  idempotency_key text NOT NULL,
  request_hash    text NOT NULL, -- fingerprint of the request that used the key
  -- A package bought with money stays pending_payment until the gateway's webhook says it was paid.
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('pending_payment', 'active')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packages_customer_idempotency_key UNIQUE (customer_id, idempotency_key)
);

CREATE TABLE bookings (
  id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id         int NOT NULL REFERENCES users (id),
  trainer_id          int NOT NULL REFERENCES trainers (id),
  mode                text NOT NULL CHECK (mode IN ('instant', 'scheduled')),
  status              text NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('pending_payment', 'confirmed', 'in_progress', 'completed', 'cancelled',
                                        'payment_failed', 'expired')),
  -- pending_payment holds the slot until this time; after it the hold is released (status expired)
  hold_expires_at     timestamptz,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,        -- planned end: starts_at + 60 min
  busy_until          timestamptz NOT NULL,        -- ends_at + buffer; what the trainer is blocked for
  -- Timer fields set when the trainer presses Start. session_ends_at is separate from ends_at
  -- so a late start never moves the range the exclusion constraint guards.
  started_at          timestamptz,
  session_ends_at     timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text CHECK (cancel_reason IN ('customer', 'rescheduled')),
  rescheduled_from    int REFERENCES bookings (id),
  -- price snapshot: later rule changes never touch an existing booking
  is_peak             boolean NOT NULL,
  session_price_paise int NOT NULL,
  commission_paise    int NOT NULL,
  total_paise         int NOT NULL,
  package_id          int REFERENCES packages (id), -- null = paid as a single session
  idempotency_key     text NOT NULL,
  request_hash        text NOT NULL,                -- fingerprint of the request that used the key
  assignment          jsonb NOT NULL,               -- candidates considered and why this trainer
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CONSTRAINT bookings_customer_idempotency_key UNIQUE (customer_id, idempotency_key),
  -- Two requests can both pass an "is the trainer free?" check under READ COMMITTED. This makes the
  -- database reject the second one (SQLSTATE 23P01). Half-open range: 10-11 and 11-12 don't clash.
  CONSTRAINT bookings_trainer_no_overlap EXCLUDE USING gist
    (trainer_id WITH =, tstzrange(starts_at, busy_until, '[)') WITH &&)
    WHERE (status IN ('pending_payment', 'confirmed', 'in_progress')),
  -- Same idea for the customer: two tabs must not buy two trainers for the same hour.
  CONSTRAINT bookings_customer_no_overlap EXCLUDE USING gist
    (customer_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status IN ('pending_payment', 'confirmed', 'in_progress'))
);

CREATE INDEX bookings_customer_starts ON bookings (customer_id, starts_at DESC);
CREATE INDEX bookings_trainer_starts ON bookings (trainer_id, starts_at DESC);
CREATE INDEX bookings_running ON bookings (session_ends_at) WHERE status = 'in_progress';
CREATE INDEX bookings_holds ON bookings (hold_expires_at) WHERE status = 'pending_payment';

-- One row per attempt to collect money, for a booking or for a package. amount_paise is the server's
-- price snapshot; the webhook is checked against it. Only a verified webhook moves created -> paid.
CREATE TABLE payment_orders (
  id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purpose             text NOT NULL CHECK (purpose IN ('booking', 'package')),
  booking_id          int REFERENCES bookings (id),
  package_id          int REFERENCES packages (id),
  customer_id         int NOT NULL REFERENCES users (id),
  amount_paise        int NOT NULL CHECK (amount_paise > 0),
  currency            text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status              text NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'paid', 'failed', 'expired', 'refunded')),
  provider            text NOT NULL DEFAULT 'mockpay',
  provider_order_id   text NOT NULL UNIQUE,
  provider_payment_id text UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  CHECK ((purpose = 'booking' AND booking_id IS NOT NULL AND package_id IS NULL)
      OR (purpose = 'package' AND package_id IS NOT NULL AND booking_id IS NULL))
);
-- At most one order per booking and per package, so "exactly one paid order" can be checked in SQL.
CREATE UNIQUE INDEX payment_orders_booking ON payment_orders (booking_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX payment_orders_package ON payment_orders (package_id) WHERE package_id IS NOT NULL;

-- The mock gateway's own records (what MockPay would keep on its servers). Our code never reads this
-- table except through the mockpay module; payment_orders is the only table that says what was paid.
CREATE TABLE mockpay_orders (
  provider_order_id   text PRIMARY KEY,
  amount_paise        int NOT NULL,
  currency            text NOT NULL,
  return_path         text NOT NULL,
  outcome             text CHECK (outcome IN ('success', 'failure')),
  provider_payment_id text,
  completed_at        timestamptz
);

-- Append-only. Balance = packages.sessions_total + SUM(delta). The UNIQUE makes a second
-- deduction (or second refund) for the same booking impossible, even on a retry.
CREATE TABLE package_ledger (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id int NOT NULL REFERENCES packages (id),
  booking_id int NOT NULL REFERENCES bookings (id),
  delta      smallint NOT NULL CHECK (delta IN (-1, 1)),
  reason     text NOT NULL CHECK (reason IN ('booking', 'refund')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, reason)
);
CREATE INDEX package_ledger_package ON package_ledger (package_id);

CREATE TABLE fitness_profiles (
  customer_id int PRIMARY KEY REFERENCES users (id),
  age         smallint NOT NULL CHECK (age BETWEEN 10 AND 100),
  weight_kg   numeric(5, 1) NOT NULL CHECK (weight_kg > 0),
  goals       text[] NOT NULL,
  level       text NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  preferences text[] NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Trainer and customer write different columns of the same row, so each does an upsert of its own columns.
CREATE TABLE session_records (
  booking_id           int PRIMARY KEY REFERENCES bookings (id),
  exercises            jsonb NOT NULL DEFAULT '[]',
  duration_minutes     smallint,
  trainer_notes        text,
  customer_rating      smallint CHECK (customer_rating BETWEEN 1 AND 5),
  customer_comment     text,
  suggested_next_workout text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users (id),
  kind       text NOT NULL CHECK (kind IN ('booking_assigned', 'booking_cancelled', 'booking_rescheduled', 'session_completed',
                                 'payment_failed', 'payment_refunded')),
  booking_id int REFERENCES bookings (id),
  message    text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, id DESC);
