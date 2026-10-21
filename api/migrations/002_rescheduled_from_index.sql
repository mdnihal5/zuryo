-- Every booking in a list looks up "the booking that replaced this one" by rescheduled_from. Without an index that is a scan of the whole table per row.
CREATE INDEX bookings_rescheduled_from ON bookings (rescheduled_from) WHERE rescheduled_from IS NOT NULL;
