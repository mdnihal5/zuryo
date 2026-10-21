ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('booking_assigned', 'booking_cancelled', 'booking_rescheduled',
  'session_completed', 'session_warning', 'payment_failed', 'payment_refunded'));
-- The 55-minute warning is written by whoever notices first (a read or the sweep); this makes "once per person per booking" a database fact.
CREATE UNIQUE INDEX notifications_session_warning_once ON notifications (user_id, booking_id) WHERE kind = 'session_warning';
