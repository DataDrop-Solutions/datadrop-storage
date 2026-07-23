-- Migration v11: Billing v5 Payment Recovery
-- Adds payment tracking columns, daily retry support, and billing_reminders table

-- New payment tracking columns on billing
ALTER TABLE billing ADD COLUMN payment_method    TEXT;     -- AUTOPAY | UPI | CARD | NETBANKING | NETBANKING_etc
ALTER TABLE billing ADD COLUMN paid_at           INTEGER;  -- epoch ms — set when payment confirmed
ALTER TABLE billing ADD COLUMN first_failed_at   INTEGER;  -- epoch ms — when AutoPay first failed
ALTER TABLE billing ADD COLUMN retry_count       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing ADD COLUMN next_retry_at     INTEGER;  -- epoch ms — when next daily AutoPay retry runs
ALTER TABLE billing ADD COLUMN last_failure_reason TEXT;   -- last AutoPay decline reason
ALTER TABLE billing ADD COLUMN idempotency_key   TEXT;     -- prevents duplicate payments (set on creation)

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_idempotency
  ON billing(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Billing reminder log — one row per email sent
CREATE TABLE IF NOT EXISTS billing_reminders (
  id             TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id        TEXT    NOT NULL,
  billing_id     TEXT    REFERENCES billing(id) ON DELETE SET NULL,
  type           TEXT    NOT NULL,   -- autopay_fail | day_1 | day_7 | day_14 | day_21 | day_30 | day_34 | deleted
  reminder_day   INTEGER,            -- numeric day for day_N types
  sent_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  delivery_status TEXT   NOT NULL DEFAULT 'sent' CHECK(delivery_status IN ('sent','failed'))
);

CREATE INDEX IF NOT EXISTS idx_billing_reminders_user ON billing_reminders(user_id, type);
