-- Kitar: points per kg for each material, and one material per bin.
--
-- Rates follow IPC where IPC has one; glass, e-waste and used cooking oil are
-- placeholders until Nurin confirms them. Only a signed machine session may use
-- these rates (BR23). The KITAR_DROPOFF row in activity_rules is left as it is.
CREATE TABLE kitar_material_rates (
  material text PRIMARY KEY CHECK (material IN ('PLASTIC_PET', 'PLASTIC_OTHER', 'PAPER', 'GLASS', 'ALUMINIUM', 'E_WASTE', 'TEXTILE', 'COOKING_OIL')),
  points_per_kg integer NOT NULL CHECK (points_per_kg BETWEEN 0 AND 1000), -- 0: Impact XP only for this material
  placeholder boolean NOT NULL DEFAULT false,                              -- not yet confirmed
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id)
);
INSERT INTO kitar_material_rates (material, points_per_kg, placeholder) VALUES
  ('PLASTIC_PET', 10, false),
  ('PLASTIC_OTHER', 10, false),
  ('PAPER', 10, false),
  ('ALUMINIUM', 20, false), -- "Aluminium and tins": one material, one rate
  ('TEXTILE', 5, false),
  ('GLASS', 10, true),
  ('E_WASTE', 20, true),
  ('COOKING_OIL', 20, true);

-- A bin takes one material; NULL means it accepts any material (existing machines).
ALTER TABLE kitar_machines
  ADD COLUMN material text CHECK (material IS NULL OR material IN ('PLASTIC_PET', 'PLASTIC_OTHER', 'PAPER', 'GLASS', 'ALUMINIUM', 'E_WASTE', 'TEXTILE', 'COOKING_OIL'));
