-- Tamu: visitor details for township security (BR26, revised).
--
-- A visit now records the visitor's citizenship, identity number, how they travel, their driving licence's expiry
-- when they drive, and the reason for the visit. On a pass the resident gives them, or the visitor on their pass
-- link, and the guard completes anything missing at the gate. An expired driving licence blocks entry by motor
-- vehicle. The identity number is stored encrypted (AES-256-GCM, key outside the database); only its last 4
-- characters are kept readable, for the household and the visitor's own page. Guards never hold the card itself.
-- Everything is deleted with the visit after 90 days, as before.
--
-- Every column is optional so passes SimeTown makes itself (a recycling collector, a home-service worker) and
-- passes made before this change still work: the guard fills in their details at the gate.

ALTER TABLE visitor_passes
  ADD COLUMN citizenship text CHECK (citizenship IN ('MALAYSIAN', 'NON_MALAYSIAN')),
  ADD COLUMN id_number_enc text,
  ADD COLUMN id_last4 text CHECK (id_last4 ~ '^[A-Z0-9]{1,4}$'),
  ADD COLUMN transport text CHECK (transport IN ('ON_FOOT', 'CAR', 'MOTORCYCLE', 'BICYCLE', 'VAN', 'LORRY', 'BUS', 'E_HAILING', 'OTHER')),
  ADD COLUMN licence_expiry date,
  ADD COLUMN reason text CHECK (reason IN ('VISITING', 'DELIVERY', 'CONTRACTOR', 'HELPER', 'CARER', 'EVENT', 'PROPERTY_VIEWING', 'MAINTENANCE', 'OTHER')),
  ADD COLUMN reason_other text CHECK (length(reason_other) <= 80),
  -- Who gave the identity: the host household, the visitor on their link, or the guard at the gate.
  ADD COLUMN details_by text CHECK (details_by IN ('HOST', 'VISITOR', 'GUARD')),
  ADD CONSTRAINT visitor_passes_identity_check CHECK ((id_number_enc IS NULL) = (id_last4 IS NULL) AND (id_number_enc IS NULL) = (citizenship IS NULL)),
  ADD CONSTRAINT visitor_passes_other_reason_check CHECK (reason_other IS NULL OR reason = 'OTHER');

ALTER TABLE visitor_entries
  ADD COLUMN citizenship text CHECK (citizenship IN ('MALAYSIAN', 'NON_MALAYSIAN')),
  ADD COLUMN id_number_enc text,
  ADD COLUMN id_last4 text CHECK (id_last4 ~ '^[A-Z0-9]{1,4}$'),
  ADD COLUMN transport text CHECK (transport IN ('ON_FOOT', 'CAR', 'MOTORCYCLE', 'BICYCLE', 'VAN', 'LORRY', 'BUS', 'E_HAILING', 'OTHER')),
  ADD COLUMN licence_expiry date,
  ADD COLUMN reason text CHECK (reason IN ('VISITING', 'DELIVERY', 'CONTRACTOR', 'HELPER', 'CARER', 'EVENT', 'PROPERTY_VIEWING', 'MAINTENANCE', 'OTHER')),
  ADD COLUMN reason_other text CHECK (length(reason_other) <= 80),
  ADD CONSTRAINT visitor_entries_identity_check CHECK ((id_number_enc IS NULL) = (id_last4 IS NULL) AND (id_number_enc IS NULL) = (citizenship IS NULL)),
  ADD CONSTRAINT visitor_entries_other_reason_check CHECK (reason_other IS NULL OR reason = 'OTHER');

-- Visitor emails to the household: on unless the resident switches them off in Account.
ALTER TABLE users ADD COLUMN visitor_emails boolean NOT NULL DEFAULT true;

ALTER TABLE email_outbox DROP CONSTRAINT email_outbox_kind_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_check
  CHECK (kind IN ('LOCKER_READY', 'COUNTER_READY', 'COUNTER_REMINDER', 'DOOR_FORCED', 'VISITOR_ARRIVED', 'VISITOR_AT_GATE'));
