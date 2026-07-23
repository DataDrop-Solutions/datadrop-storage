-- DataDrop — Migration v9
-- Add superseded_at to wallet_mandates for graceful mandate replacement.
-- When a mandate is superseded during an upgrade, superseded_at is set immediately.
-- cancelled_at remains NULL until the cleanup worker confirms the Razorpay token deletion.
-- This lets us keep the old token alive for a configurable grace period (default 48 h)
-- so Razorpay issues and deployment rollbacks don't interrupt billing.
ALTER TABLE wallet_mandates ADD COLUMN superseded_at INTEGER;
