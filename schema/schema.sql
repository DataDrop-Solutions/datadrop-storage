-- ============================================================
-- DataDrop D1 Schema
-- All tables, indexes, and seed data for config
-- ============================================================

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  clerk_user_id         TEXT UNIQUE NOT NULL,
  email                 TEXT UNIQUE NOT NULL,
  phone                 TEXT UNIQUE,                        -- enforces one trial per number
  display_name          TEXT NOT NULL,
  username              TEXT UNIQUE NOT NULL,               -- @handle
  username_changed_at   INTEGER,                           -- epoch ms, enforce 90-day lock
  avatar_url            TEXT,

  -- ECDH public key (v2 vault / workspace encryption)
  public_key            TEXT,                              -- base64 SPKI of user's ECDH P-256 public key

  -- Vault (all vault crypto material stored here)
  vault_pin_hash        TEXT,                              -- PBKDF2 hash of PIN
  vault_salt            TEXT,                              -- salt for PIN → key derivation
  vault_phrase_salt     TEXT,                              -- salt for recovery phrase KDF
  vault_encrypted_key   TEXT,
  vault_phrase_hash     TEXT,
  vault_phrase_enc_key  TEXT,                              -- vault key encrypted with PIN-derived key
  vault_setup_at        INTEGER,                           -- epoch ms

  -- Wallet & billing
  wallet_balance        REAL NOT NULL DEFAULT 0,           -- ₹ balance remaining this month
  wallet_limit          REAL NOT NULL DEFAULT 0,           -- monthly committed amount
  wallet_next_bill_date INTEGER,                           -- epoch ms

  -- Trial
  trial_ends_at         INTEGER,                           -- epoch ms
  trial_phone_verified  INTEGER NOT NULL DEFAULT 0,        -- 0/1 boolean

  -- Add-ons
  adfree_active         INTEGER NOT NULL DEFAULT 0,        -- 0/1
  adfree_locked_price   REAL,                              -- ₹49 locked at signup time
  adfree_since          INTEGER,                           -- epoch ms

  -- Account state
  status                TEXT NOT NULL DEFAULT 'trial'
                          CHECK(status IN ('trial','active','suspended','deleted','read_only','pending_deletion')),
  suspension_reason     TEXT,
  deleted_at            INTEGER,                           -- epoch ms, soft delete
  deletion_scheduled_at INTEGER,                           -- epoch ms, pending deletion

  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================
-- FOLDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,   -- NULL = root
  name        TEXT NOT NULL,

  -- Backup auto-organisation metadata
  device_name TEXT,
  year        INTEGER,
  month       INTEGER,

  -- Vault folders are hidden from general storage browser
  is_vault    INTEGER NOT NULL DEFAULT 0,

  -- Team workspace folders
  team_id     TEXT REFERENCES teams(id) ON DELETE CASCADE,

  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================
-- FILES
-- ============================================================
CREATE TABLE IF NOT EXISTS files (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id        TEXT REFERENCES folders(id) ON DELETE SET NULL,

  -- Team workspace (NULL = personal storage)
  team_id          TEXT REFERENCES teams(id) ON DELETE SET NULL,

  -- Identity
  filename         TEXT NOT NULL,
  original_name    TEXT NOT NULL,
  mime_type        TEXT,
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  size_gb          REAL    NOT NULL DEFAULT 0,              -- pre-computed for billing

  -- Storage routing (silent, never shown to users)
  bucket           TEXT NOT NULL DEFAULT 'b2_cold'
                     CHECK(bucket IN ('r2_hot','b2_cold','b2_vault')),
  storage_key      TEXT NOT NULL,                           -- internal key in bucket

  -- Access tracking (for hot-promotion logic)
  access_count     INTEGER NOT NULL DEFAULT 0,
  last_accessed    INTEGER,                                 -- epoch ms
  migration_queued INTEGER NOT NULL DEFAULT 0,              -- 0/1, dedup guard

  -- Thumbnail
  thumb_key        TEXT,                                          -- R2 key for generated thumbnail
  thumb_data       TEXT,                                          -- base64 WebP thumbnail stored in D1 (≤15 KB)

  -- Vault
  is_vault         INTEGER NOT NULL DEFAULT 0,              -- 0/1
  is_encrypted     INTEGER NOT NULL DEFAULT 0,              -- 0/1 (E2E encrypted)

  -- Media / backup metadata
  hash_sha256      TEXT,                                    -- dedup hash
  taken_at         INTEGER,                                 -- epoch ms, EXIF date
  quality          TEXT CHECK(quality IN ('original','high','saver')),

  -- Versioning
  version_of       TEXT REFERENCES files(id) ON DELETE SET NULL,
  version_number   INTEGER NOT NULL DEFAULT 1,

  -- Sharing / reporting
  accessible       INTEGER NOT NULL DEFAULT 1,              -- 0 = hidden by report

  -- Version history enabled per file
  version_history  INTEGER NOT NULL DEFAULT 0,              -- 0/1

  -- Trash
  deleted_at       INTEGER,                                 -- epoch ms, soft delete
  trash_expires_at INTEGER,                                 -- epoch ms, hard delete after 30 days

  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================
-- SHARES
-- ============================================================
CREATE TABLE IF NOT EXISTS shares (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  file_id             TEXT REFERENCES files(id) ON DELETE CASCADE,
  folder_id           TEXT REFERENCES folders(id) ON DELETE CASCADE,
  owner_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Recipient (one of the three sharing methods)
  recipient_email     TEXT,
  recipient_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  invite_link_token   TEXT UNIQUE,                          -- one-time token
  invite_claimed      INTEGER NOT NULL DEFAULT 0,           -- 0/1

  -- Permissions
  can_view            INTEGER NOT NULL DEFAULT 1,
  can_download        INTEGER NOT NULL DEFAULT 0,
  can_save            INTEGER NOT NULL DEFAULT 0,

  -- Expiry
  expires_at          INTEGER,                              -- epoch ms

  -- View limits
  max_views           INTEGER,
  views_used          INTEGER NOT NULL DEFAULT 0,

  -- Watermark
  watermark           INTEGER NOT NULL DEFAULT 0,           -- 0/1

  -- Auto-deletion triggers
  delete_after_days   INTEGER,
  delete_on_confirm   INTEGER NOT NULL DEFAULT 0,           -- 0/1
  confirmed_at        INTEGER,                              -- epoch ms, recipient confirmed receipt

  -- Ownership transfer
  ownership_transfer  INTEGER NOT NULL DEFAULT 0,           -- 0/1
  transfer_completed  INTEGER NOT NULL DEFAULT 0,           -- 0/1
  original_owner_retains_access INTEGER NOT NULL DEFAULT 0, -- 0/1

  -- Status
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','expired','revoked','completed')),

  created_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

  -- at least one of file or folder must be set
  CHECK(file_id IS NOT NULL OR folder_id IS NOT NULL)
);

-- ============================================================
-- BILLING
-- ============================================================
CREATE TABLE IF NOT EXISTS billing (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Period
  month                 TEXT NOT NULL,                      -- 'YYYY-MM'
  billing_date          INTEGER,                            -- epoch ms

  -- Amounts
  committed_amount      REAL NOT NULL DEFAULT 0,            -- what user committed upfront
  actual_usage_gb       REAL NOT NULL DEFAULT 0,
  actual_usage_amount   REAL NOT NULL DEFAULT 0,            -- ₹ based on tiered pricing
  adfree_amount         REAL NOT NULL DEFAULT 0,
  teams_amount          REAL NOT NULL DEFAULT 0,
  total_charged         REAL NOT NULL DEFAULT 0,

  -- Payment
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','paid','failed','refunded','waived')),
  razorpay_order_id     TEXT,
  razorpay_payment_id   TEXT,
  razorpay_signature    TEXT,
  failure_reason        TEXT,

  -- Refund
  refund_amount         REAL,
  refund_at             INTEGER,                            -- epoch ms

  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

  -- Byte-second billing columns (added 2026-06-29)
  gb_months                REAL DEFAULT 0,                   -- GB-months billed this period
  accumulated_byte_seconds REAL DEFAULT 0,                   -- raw byte-seconds snapshot at billing

  UNIQUE(user_id, month)
);

-- ============================================================
-- STORAGE USAGE (byte-second accumulation)
-- ============================================================
CREATE TABLE IF NOT EXISTS storage_usage (
  user_id                  TEXT PRIMARY KEY,
  current_bytes            INTEGER NOT NULL DEFAULT 0,        -- live bytes (mirrors KV counter)
  accumulated_byte_seconds REAL NOT NULL DEFAULT 0,          -- byte-seconds since month start
  last_updated_at          INTEGER NOT NULL,                  -- epoch ms of last accumulation
  billing_month            TEXT NOT NULL                      -- 'YYYY-MM' — reset on billing
);

-- ============================================================
-- VAULT CONFIG (ECDH P-256 keypair, per-user, v2 vault system)
-- ============================================================
CREATE TABLE IF NOT EXISTS vault_config (
  user_id                    TEXT PRIMARY KEY,
  encrypted_private_key      TEXT NOT NULL,    -- AES-GCM(PIN-derived-key, private_key_pkcs8)
  private_key_iv             TEXT NOT NULL,    -- base64 12-byte IV
  private_key_salt           TEXT NOT NULL,    -- base64 32-byte PBKDF2 salt for PIN → wrapping key
  pin_hash                   TEXT NOT NULL,    -- PBKDF2(PIN, pin_salt) → SHA-256 → base64
  pin_salt                   TEXT NOT NULL,    -- base64 32-byte salt for pin_hash
  phrase_hash                TEXT,            -- PBKDF2(phrase, phrase_salt) → SHA-256 → base64
  phrase_salt                TEXT,            -- base64 32-byte salt for phrase_hash
  recovery_phrase_encrypted  TEXT,            -- AES-GCM(phrase-derived-key, private_key_pkcs8)
  recovery_phrase_salt       TEXT,            -- base64 32-byte salt for phrase derivation
  recovery_phrase_iv         TEXT,            -- base64 12-byte IV for phrase encryption
  created_at                 INTEGER NOT NULL
);

-- ============================================================
-- FILE KEYS (per-file DEK encrypted with user's ECDH public key)
-- ============================================================
CREATE TABLE IF NOT EXISTS file_keys (
  id                   TEXT PRIMARY KEY,
  file_id              TEXT NOT NULL,
  user_id              TEXT NOT NULL,
  encrypted_dek        TEXT NOT NULL,          -- AES-GCM(KEK, DEK) base64
  dek_nonce            TEXT NOT NULL,          -- base64 12-byte IV
  ephemeral_public_key TEXT NOT NULL,          -- base64 SPKI of ephemeral key used in ECDH
  created_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_keys_file ON file_keys(file_id, user_id);

-- ============================================================
-- TEAM KEYS (per-member Team Key encrypted with member's ECDH public key)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_keys (
  id                   TEXT PRIMARY KEY,
  team_id              TEXT NOT NULL,
  user_id              TEXT NOT NULL,
  encrypted_team_key   TEXT NOT NULL,          -- AES-GCM(KEK, team_key) base64
  ephemeral_public_key TEXT NOT NULL,          -- base64 SPKI of ephemeral key used in ECDH
  key_nonce            TEXT NOT NULL,          -- base64 12-byte IV
  created_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_keys_team ON team_keys(team_id, user_id);

-- ============================================================
-- PENDING UPLOADS (KV fallback; entries cleaned up by confirm/abort)
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_uploads (
  file_id    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  data       TEXT NOT NULL,    -- JSON blob matching KV pending_upload:{fileId}
  expires_at INTEGER NOT NULL  -- epoch ms; stale entries pruned by reconcile
);

CREATE INDEX IF NOT EXISTS idx_pending_uploads_user ON pending_uploads(user_id);

-- ============================================================
-- ADMIN LOGS (drift tracking, alerts)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_logs (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,                               -- 'storage_drift', etc.
  user_id        TEXT,
  expected_bytes INTEGER,
  actual_bytes   INTEGER,
  created_at     INTEGER NOT NULL
);

-- ============================================================
-- TEAMS
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name              TEXT NOT NULL,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- E2EE workspace passphrase salt (used for PBKDF2 key derivation)
  key_salt          TEXT,

  -- E2E workspace (Phase 3)
  e2e_enabled       INTEGER NOT NULL DEFAULT 0,

  created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================
-- TEAM MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS team_members (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',

  -- Phase 3 E2E: team key encrypted with this member's public key
  encrypted_team_key TEXT,

  joined_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  status     TEXT DEFAULT 'active',
  invited_by TEXT,

  UNIQUE(team_id, user_id)
);

-- ============================================================
-- TEAM INVITES
-- ============================================================
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

-- ============================================================
-- TEAM BILLING (seat charges, tracked separately)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_billing (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  billing_id   TEXT REFERENCES billing(id) ON DELETE SET NULL,
  month        TEXT NOT NULL,                               -- 'YYYY-MM'
  seat_count   INTEGER NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,                    -- ₹99 × seats
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),

  UNIQUE(team_id, month)
);

-- ============================================================
-- ACCESS LOGS  (team workspace only)
-- ============================================================
CREATE TABLE IF NOT EXISTS access_logs (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  file_id    TEXT REFERENCES files(id) ON DELETE SET NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL
               CHECK(action IN ('view','download','upload','delete','share','restore')),
  ip_hash    TEXT,                                          -- hashed for privacy
  timestamp  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================
-- REPORTS
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  file_id           TEXT REFERENCES files(id) ON DELETE SET NULL,
  share_id          TEXT REFERENCES shares(id) ON DELETE SET NULL,
  reporter_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uploader_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason            TEXT NOT NULL,
  evidence_url      TEXT NOT NULL,                          -- mandatory screenshot in B2
  admin_notes       TEXT,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK(status IN ('open','reviewing','resolved_restored',
                                       'resolved_deleted','resolved_suspended')),
  resolved_at       INTEGER,                                -- epoch ms
  resolved_by       TEXT,                                   -- admin identifier
  created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================
-- CONFIG  (all runtime-tunable values, editable from admin panel)
-- ============================================================
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ============================================================
-- NOTIFICATIONS  (for 80%/100% wallet, trial reminders etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                                -- 'wallet_80', 'wallet_100', 'trial_day6' etc.
  sent_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  metadata    TEXT                                          -- JSON blob
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Core query patterns per scalability rules
CREATE INDEX IF NOT EXISTS idx_files_user_folder       ON files(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_files_user_accessed     ON files(user_id, last_accessed);
CREATE INDEX IF NOT EXISTS idx_files_user_trash        ON files(user_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_hash              ON files(user_id, hash_sha256);
CREATE INDEX IF NOT EXISTS idx_files_version_of        ON files(version_of) WHERE version_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_accessible        ON files(accessible) WHERE accessible = 0;
CREATE INDEX IF NOT EXISTS idx_files_team_folder       ON files(team_id, folder_id) WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shares_recipient_user   ON shares(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_shares_file_id          ON shares(file_id);
CREATE INDEX IF NOT EXISTS idx_shares_folder_id        ON shares(folder_id);
CREATE INDEX IF NOT EXISTS idx_shares_invite_token     ON shares(invite_link_token) WHERE invite_link_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shares_owner            ON shares(owner_id);

CREATE INDEX IF NOT EXISTS idx_folders_user_parent     ON folders(user_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_billing_user_month      ON billing(user_id, month);

CREATE INDEX IF NOT EXISTS idx_team_members_team       ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user       ON team_members(user_id);

CREATE INDEX IF NOT EXISTS idx_team_invites_team   ON team_invites(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invites_user   ON team_invites(invited_user_id) WHERE invited_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_invites_token  ON team_invites(token);
CREATE INDEX IF NOT EXISTS idx_team_invites_email  ON team_invites(invited_email) WHERE invited_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_uploads_user ON pending_uploads(user_id);

CREATE INDEX IF NOT EXISTS idx_access_logs_team        ON access_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_file        ON access_logs(file_id);

CREATE INDEX IF NOT EXISTS idx_reports_status          ON reports(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_reports_file            ON reports(file_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user      ON notifications(user_id, type);

CREATE INDEX IF NOT EXISTS idx_storage_usage_user      ON storage_usage(user_id);

CREATE INDEX IF NOT EXISTS idx_users_clerk             ON users(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_users_phone             ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_status            ON users(status);

-- ============================================================
-- CONFIG SEED DATA
-- ============================================================
INSERT OR REPLACE INTO config (key, value) VALUES
  ('price_tier_0_30',         '1.89'),
  ('price_tier_31_100',       '1.49'),
  ('price_tier_101_200',      '1.29'),
  ('price_tier_201_500',      '1.09'),
  ('price_tier_501_2000',     '0.99'),
  ('price_tier_2000_plus',    '0.89'),
  ('price_floor',             '0.89'),
  ('price_adfree_monthly',    '49'),
  ('price_team_per_seat',     '99'),
  ('trial_days',              '7'),
  ('trial_gb_limit',          '5'),
  ('wallet_min_refund',       '50'),
  ('retention_days_unpaid',   '90'),
  ('trash_retention_days',    '30'),
  ('founding_members_max',    '500'),
  ('r2_promotion_threshold',  '2'),
  ('billing_day',             '1'),
  ('wallet_alert_pct_80',     '80'),
  ('wallet_alert_pct_100',    '100'),
  ('backup_retention_count',  '90'),
  ('session_token_ttl_sec',   '3600'),
  ('stream_token_ttl_sec',    '60'),
  ('username_change_days',    '90'),
  ('share_max_views_default', '0'),
  ('maintenance_mode',        '0');

