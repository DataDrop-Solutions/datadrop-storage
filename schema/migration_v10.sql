-- Migration v10: Fix config keys required for billing + business rule corrections
-- 1. Add storage_price_per_gb_month (flat ₹1.49/GB/month — required by billing + getStorageCapacity)
-- 2. Add mandate_supersede_grace_hours (default 48h — makes grace period explicitly configurable)
-- 3. Fix retention_days_unpaid: was 90, business rule is 35 days
INSERT OR REPLACE INTO config (key, value) VALUES
  ('storage_price_per_gb_month',    '1.49'),
  ('mandate_supersede_grace_hours', '48'),
  ('retention_days_unpaid',         '35');
