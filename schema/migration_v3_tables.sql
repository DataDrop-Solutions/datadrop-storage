-- CREATE TABLE IF NOT EXISTS only — always idempotent, no errors possible.
-- Run this before running individual ALTER TABLE commands.

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
