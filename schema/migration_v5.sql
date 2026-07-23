-- ============================================================
-- DataDrop — Migration v5
-- Architecture evolution: single bucket, no-trash, 15-day trial,
-- workspace key hierarchy, mandate wallet, unified permissions
-- ============================================================

-- ── Wallet mandates (UPI autopay spending protection) ─────────
CREATE TABLE IF NOT EXISTS wallet_mandates (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_mandate_id   TEXT UNIQUE NOT NULL,
  razorpay_customer_id  TEXT NOT NULL,
  protection_limit      REAL NOT NULL,
  status                TEXT NOT NULL DEFAULT 'created'
                          CHECK(status IN ('created','active','paused','cancelled','expired')),
  upi_vpa               TEXT,
  created_at            INTEGER NOT NULL,
  activated_at          INTEGER,
  cancelled_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mandates_user ON wallet_mandates(user_id);
CREATE INDEX IF NOT EXISTS idx_mandates_status ON wallet_mandates(status) WHERE status = 'active';

-- ── Workspace root keys (one per team member) ─────────────────
-- Replaces the flat team_keys concept with a properly named table.
-- team_keys rows are preserved as workspace_root_keys equivalents.
CREATE TABLE IF NOT EXISTS workspace_root_keys (
  id                    TEXT PRIMARY KEY,
  team_id               TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_root_key    TEXT NOT NULL,
  ephemeral_public_key  TEXT NOT NULL,
  key_nonce             TEXT NOT NULL,
  key_version           INTEGER NOT NULL DEFAULT 1,
  created_at            INTEGER NOT NULL,
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ws_root_keys_team ON workspace_root_keys(team_id);

-- ── Workspace folder keys (per-folder, encrypted with root key)
CREATE TABLE IF NOT EXISTS workspace_folder_keys (
  id                    TEXT PRIMARY KEY,
  folder_id             TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  team_id               TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  encrypted_folder_key  TEXT NOT NULL,
  key_nonce             TEXT NOT NULL,
  inherits_parent       INTEGER NOT NULL DEFAULT 1,
  created_at            INTEGER NOT NULL,
  UNIQUE(folder_id)
);

CREATE INDEX IF NOT EXISTS idx_ws_folder_keys_team ON workspace_folder_keys(team_id);

-- ── B2 deletion tracking on files ────────────────────────────
-- Prevents orphan objects: set to 1 before D1 delete, cleared after B2 delete
ALTER TABLE files ADD COLUMN b2_delete_queued INTEGER NOT NULL DEFAULT 0;

-- ── Password-protected share links ───────────────────────────
ALTER TABLE shares ADD COLUMN password_hash TEXT;

-- ── File key context (vault vs workspace) ────────────────────
ALTER TABLE file_keys ADD COLUMN context TEXT NOT NULL DEFAULT 'vault'
  CHECK(context IN ('vault','workspace'));
ALTER TABLE file_keys ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

-- ── New indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_billing_month ON billing(month);
CREATE INDEX IF NOT EXISTS idx_files_team_created ON files(team_id, created_at)
  WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_status_created ON billing(status, created_at)
  WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_files_b2_delete_queued ON files(b2_delete_queued)
  WHERE b2_delete_queued = 1;

-- ── Update trial to 15 days ───────────────────────────────────
INSERT OR REPLACE INTO config (key, value, updated_at) VALUES
  ('trial_days',               '15',   unixepoch() * 1000),
  ('trial_reminder_day',       '13',   unixepoch() * 1000),
  ('trial_read_only_day',      '15',   unixepoch() * 1000),
  ('trial_deletion_grace_days','30',   unixepoch() * 1000);
