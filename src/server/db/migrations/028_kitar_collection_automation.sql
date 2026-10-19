-- Booked collections run themselves; staff only see exceptions.
-- A booking is confirmed at once. After the gate scans the collector in, the
-- resident types the weight. A small weight after a gate scan is credited
-- straight away; anything else waits here for staff. The nightly `recycling`
-- job closes the rest. No new status: a review sits on top of the status the
-- collection already has.
ALTER TABLE recycling_collections
  -- What the resident typed, kept even once accepted, so large weights can be counted per home.
  ADD COLUMN reported_weight_g integer CHECK (reported_weight_g BETWEEN 1 AND 500000),
  -- When the resident sent the weight, or said the collector came.
  ADD COLUMN reported_at timestamptz,
  -- Why staff must look: a weight over the automatic limit, a weight with no gate scan,
  -- or the resident says the collector came on a collection marked missed.
  ADD COLUMN review_reason text CHECK (review_reason IN ('OVER_LIMIT', 'NO_GATE_SCAN', 'COLLECTOR_CAME')),
  ADD COLUMN reviewed_at timestamptz,
  -- The household's daily or monthly recycling limit (BR6) stopped the reward.
  ADD COLUMN limit_hit text CHECK (limit_hit IN ('DAILY_LIMIT', 'MONTHLY_LIMIT')),
  ADD CHECK (reviewed_at IS NULL OR review_reason IS NOT NULL);

CREATE INDEX recycling_collections_review_idx ON recycling_collections (township_id, reported_at)
  WHERE review_reason IS NOT NULL AND reviewed_at IS NULL;
