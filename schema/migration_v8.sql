-- DataDrop — Migration v8
-- Add is_active flag to wallet_mandates for historical mandate tracking.
-- After an upgrade, the old mandate gets is_active=0 (kept for history).
-- The new mandate gets is_active=1 (current billing mandate).
ALTER TABLE wallet_mandates ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
