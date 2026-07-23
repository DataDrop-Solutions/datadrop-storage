-- ============================================================
-- DataDrop — Migration v7
-- ============================================================

-- Add razorpay_token_id to wallet_mandates for UPI recurring token storage
ALTER TABLE wallet_mandates ADD COLUMN razorpay_token_id TEXT;
