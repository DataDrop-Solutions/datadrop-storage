-- ============================================================
-- DataDrop D1 Migration v4 — Folder Trash Support
-- Run with:
--   npx wrangler d1 execute datadrop-db --remote --file=schema/migration_v4.sql
-- ============================================================

ALTER TABLE folders ADD COLUMN deleted_at INTEGER;
ALTER TABLE folders ADD COLUMN trash_expires_at INTEGER;
