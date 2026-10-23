-- Guardhouse staff: a separate account for the parcel counter at the guardhouse.
--
-- Guards now look after the gate only (visitors, patrol rounds, SOS calls, flood and access tasks). Parcels kept at
-- the guardhouse and the smart locker counter move to the new GUARDHOUSE role. Township staff and admins still cover
-- both. Parcels guards logged before keep their history.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('RESIDENT', 'MERCHANT', 'SPONSOR', 'GUARD', 'GUARDHOUSE', 'COURIER', 'TOWNSHIP_STAFF', 'TOWNSHIP_ADMIN', 'HQ_ADMIN'));
