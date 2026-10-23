-- The station command log lists a station's latest messages by the time they arrived.
CREATE INDEX IF NOT EXISTS locker_device_events_station_time_idx ON locker_device_events (station_id, received_at DESC);
