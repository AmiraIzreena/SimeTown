-- Addresses as Sime Darby Property townships write them, mandatory contact
-- details, and a record of which Terms and Privacy Notice each person accepted.

-- Homes: house (or high-rise unit and building), street, precinct or phase,
-- postcode, city and state. `unit_code` stays as the property-record reference
-- staff match against; residents now choose their address instead of typing it.
ALTER TABLE homes
  ADD COLUMN property_type text NOT NULL DEFAULT 'LANDED' CHECK (property_type IN ('LANDED', 'HIGHRISE')),
  ADD COLUMN precinct text,
  ADD COLUMN house_no text,
  ADD COLUMN building text,
  ADD COLUMN postcode text CHECK (postcode ~ '^[0-9]{5}$'),
  ADD COLUMN city text,
  ADD COLUMN state text CHECK (state IN (
    'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak',
    'Selangor', 'Terengganu', 'Wilayah Persekutuan Kuala Lumpur', 'Wilayah Persekutuan Labuan', 'Wilayah Persekutuan Putrajaya')),
  ADD CONSTRAINT homes_building_for_highrise CHECK (property_type = 'LANDED' OR building IS NOT NULL);

-- One home per postal address inside a township.
CREATE UNIQUE INDEX homes_address_idx ON homes (township_id, lower(coalesce(building, '')), lower(street), lower(house_no)) WHERE house_no IS NOT NULL;
CREATE INDEX homes_picker_idx ON homes (township_id, precinct, street);

-- A shop's business address, shown to residents and needed for approval.
ALTER TABLE merchants
  ADD COLUMN address_line text,
  ADD COLUMN postcode text CHECK (postcode ~ '^[0-9]{5}$'),
  ADD COLUMN city text,
  ADD COLUMN state text;

-- Consent: the version of the Terms of Use and Privacy Notice accepted, and when.
ALTER TABLE users
  ADD COLUMN terms_version text,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD CONSTRAINT users_terms_pair CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));
