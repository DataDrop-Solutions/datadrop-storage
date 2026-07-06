-- ============================================================
-- DataDrop D1 Migration v3 — Upload Fix + Schema Gaps
-- Run with:
--   npx wrangler d1 execute datadrop-db --remote --file=schema/migration_v3.sql
--
-- SAFE TO RUN even if migration_v2.sql was previously run.
-- Some ALTER TABLE statements below may produce a
-- "duplicate column name" error — that is expected and harmless
-- (it means migration_v2 already added that column).
-- Wrangler continues past those errors; all other statements execute.
--
-- ORDER: CREATE TABLE IF NOT EXISTS first (always idempotent),
-- then ALTER TABLE (may error on duplicates — OK).
-- ============================================================

-- ── 1. New tables (CREATE TABLE IF NOT EXISTS — always safe) ──

CREATE TABLE IF NOT EXISTS team_invites (
  id               TEXT PRIMARY KEY,
  team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_email    TEXT,
  invited_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  invited_by       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token            TEXT UNIQUE NOT NULL,
  role             TEXT NOT NULL DEFAULT 'upload',
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','accepted','declined','expired')),
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team   ON team_invites(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invites_user   ON team_invites(invited_user_id) WHERE invited_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_invites_token  ON team_invites(token);
CREATE INDEX IF NOT EXISTS idx_team_invites_email  ON team_invites(invited_email) WHERE invited_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS pending_uploads (
  file_id    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_uploads_user ON pending_uploads(user_id);

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

-- ── 2. New columns on existing tables (ALTER TABLE) ──────────
-- Each may produce "duplicate column name" if already added —
-- that is NOT an error, just a sign the column already exists.

-- CRITICAL: files.team_id — listFiles queries AND f.team_id IS NULL;
-- insertFile INSERT includes team_id. Both fail if column is missing.
ALTER TABLE files ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;

-- CRITICAL: folders.team_id — listFiles queries AND team_id IS NULL
-- for the folder list inside the same request as the file list.
ALTER TABLE folders ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

-- teams.key_salt — createTeam inserts this value.
ALTER TABLE teams ADD COLUMN key_salt TEXT;

-- users.public_key — vault v2 ECDH public key for team key distribution.
ALTER TABLE users ADD COLUMN public_key TEXT;

-- files.thumb_data — thumbnail stored in D1 (≤ 15 KB base64 WebP).
ALTER TABLE files ADD COLUMN thumb_data TEXT;
