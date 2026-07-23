-- ============================================================
-- DataDrop — Migration v6
-- ============================================================

-- M-7: Add soft-delete columns to folders
-- The code in files.js uses these columns for deleteFolder / restoreFolder / trash view.
-- SQLite silently ignores ADD COLUMN if the column already exists via "IF NOT EXISTS"
-- (not supported in all versions), so run these statements only once.
ALTER TABLE folders ADD COLUMN deleted_at INTEGER;
ALTER TABLE folders ADD COLUMN trash_expires_at INTEGER;

-- L-1 (application-side): The files.bucket CHECK constraint accepts
-- ('r2_hot','b2_cold','b2_vault'). resolveUploadBucket() returns 'b2_main',
-- but the queue consumer (migration/index.js insertFile) normalises it to
-- 'b2_cold' before inserting — so new rows never violate the constraint.
--
-- Clean up any existing rows that have bucket='b2_main' from before this fix:
UPDATE files SET bucket = 'b2_cold' WHERE bucket = 'b2_main';

-- Index on folders.deleted_at for trash queries
CREATE INDEX IF NOT EXISTS idx_folders_deleted_at ON folders(deleted_at);
