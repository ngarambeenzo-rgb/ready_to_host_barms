-- ============================================================
--  BarMS — Manager permissions expansion (2026-10-02)
--  Safe to run more than once.
--  New "already allowed" abilities default to 1 so managers keep
--  what they can do today; former Owner-only abilities default to 0.
-- ============================================================

ALTER TABLE mgr_permissions
  ADD COLUMN IF NOT EXISTS can_manage_items     TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS can_record_expenses  TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS can_void_expenses    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_approve_voids    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_delete_records   TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_pay_salaries     TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_manage_users     TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_edit_settings    TINYINT(1) NOT NULL DEFAULT 0;

INSERT IGNORE INTO mgr_permissions (id) VALUES (1);
