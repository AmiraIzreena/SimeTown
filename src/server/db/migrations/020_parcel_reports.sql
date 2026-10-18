-- A household reports a problem with a locker parcel it was given (damaged,
-- wrong or missing contents, not for this home, or "we did not collect it").
-- Recorded as a security incident for staff, like the other incidents.
ALTER TABLE locker_incidents DROP CONSTRAINT locker_incidents_kind_check;
ALTER TABLE locker_incidents ADD CONSTRAINT locker_incidents_kind_check CHECK (kind IN (
  'BARCODE_REPLAY', 'SHIPMENT_IN_USE', 'SUSPENDED_COURIER', 'UNKNOWN_SHIPMENT', 'RECIPIENT_MISMATCH', 'PROVIDER_OUTAGE',
  'DOOR_FORCED', 'DOOR_LEFT_OPEN', 'UNLOCK_FAILED', 'COMMAND_REJECTED', 'KEYPAD_LOCKED', 'SUSPICIOUS_LOGIN',
  'NOT_COLLECTED_BY_ME', 'PARCEL_PROBLEM', 'STAFF_REPORT'));
