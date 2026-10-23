-- Approved trades for home service companies.
--
-- Township staff decide which kinds of home service each company may offer (a cleaning company is not sent
-- electrical jobs), and a company can list only those. Companies keep the trades they already list.

ALTER TABLE merchants
  ADD COLUMN service_trades text[] NOT NULL DEFAULT '{}'
    CHECK (service_trades <@ ARRAY['PLUMBING', 'ELECTRICAL', 'AIRCON', 'CLEANING', 'REPAIRS', 'RENOVATION']::text[]);

UPDATE merchants m
   SET service_trades = t.trades
  FROM (SELECT merchant_id, array_agg(DISTINCT category ORDER BY category) AS trades FROM service_listings GROUP BY merchant_id) t
 WHERE t.merchant_id = m.id;
