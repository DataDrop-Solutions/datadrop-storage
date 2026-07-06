-- ============================================================
-- DataDrop D1 Migration v2
-- NOTE: If this is the first migration you're running, use v3 instead:
--   npx wrangler d1 execute datadrop-db --remote --file=schema/migration_v3.sql
-- migration_v3.sql is a superset that includes all v2 changes plus
-- the critical team_id + team_invites fixes needed for upload to work.
-- ============================================================

-- Add ECDH public key to users
ALTER TABLE users ADD COLUMN public_key TEXT;

-- Add thumbnail data column to files (stores base64 WebP ≤15 KB)
ALTER TABLE files ADD COLUMN thumb_data TEXT;

-- Add team workspace column to files (NULL = personal, non-NULL = team workspace file)
ALTER TABLE files ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;

-- Pending uploads fallback table (used when KV is unavailable during init)
CREATE TABLE IF NOT EXISTS pending_uploads (
  file_id    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_uploads_user ON pending_uploads(user_id);

-- ECDH vault config (v2 vault system)
CREATE TABLE IF NOT EXISTS vault_config (
  user_id                    TEXT PRIMARY KEY,
  encrypted_private_key      TEXT NOT NULL,
  private_key_iv             TEXT NOT NULL,
  private_key_salt           TEXT NOT NULL,
  pin_hash                   TEXT NOT NULL,
  pin_salt                   TEXT NOT NULL,
  phrase_hash                TEXT,
  phrase_salt                TEXT,
  recovery_phrase_encrypted  TEXT,
  recovery_phrase_salt       TEXT,
  recovery_phrase_iv         TEXT,
  created_at                 INTEGER NOT NULL
);

-- Per-file DEK encrypted with user's ECDH public key
CREATE TABLE IF NOT EXISTS file_keys (
  id                   TEXT PRIMARY KEY,
  file_id              TEXT NOT NULL,
  user_id              TEXT NOT NULL,
  encrypted_dek        TEXT NOT NULL,
  dek_nonce            TEXT NOT NULL,
  ephemeral_public_key TEXT NOT NULL,
  created_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_keys_file ON file_keys(file_id, user_id);

-- Per-member Team Key encrypted with member's ECDH public key
CREATE TABLE IF NOT EXISTS team_keys (
  id                   TEXT PRIMARY KEY,
  team_id              TEXT NOT NULL,
  user_id              TEXT NOT NULL,
  encrypted_team_key   TEXT NOT NULL,
  ephemeral_public_key TEXT NOT NULL,
  key_nonce            TEXT NOT NULL,
  created_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_keys_team ON team_keys(team_id, user_id);

-- Additional performance indexes
CREATE INDEX IF NOT EXISTS idx_storage_usage_user ON storage_usage(user_id);
