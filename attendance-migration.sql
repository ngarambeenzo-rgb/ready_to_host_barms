-- ============================================================
--  attendance-migration.sql — work attendance ("Start work" / "End work")
--  attendance: one row each time a Manager, Bartender or Kitchen person
--    starts work. It is NOT tied to signing in (the app signs people out
--    after 10 idle minutes; their work goes on). The Owner sees who is on
--    duty, when each person started, who was late, and the hours worked.
--  users.expected_start: the time the Owner expects that person to start
--    (empty = no lateness check for that person).
--  notifications.for_roles: when set (e.g. 'Owner'), only those roles
--    see the notice — "Alice started work" is for the Owner, not for staff.
--  Safe to run more than once. For every client:
--    php tools/migrate_all_clients.php attendance-migration.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT          NOT NULL,
  user_name      VARCHAR(100) NOT NULL,
  role           VARCHAR(20)  NOT NULL,
  started_at     DATETIME     NOT NULL,
  ended_at       DATETIME     NULL,
  status         VARCHAR(10)  NOT NULL DEFAULT 'open',   -- open | closed | forgot (never ended: hours not counted)
  expected_start TIME         NULL,                      -- the person's expected start when they started
  late_minutes   INT          NULL,                      -- 0 = on time, NULL = not checked
  device         VARCHAR(120) NULL,
  start_note     VARCHAR(255) NULL,
  end_note       VARCHAR(255) NULL,
  ended_by       VARCHAR(100) NULL,                      -- set when someone else ended it (the Owner)
  client_uuid    VARCHAR(64)  NULL,                      -- offline: the device's id of this start
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_client_uuid (client_uuid),
  KEY idx_attendance_user (user_id, status),
  KEY idx_attendance_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE users ADD COLUMN IF NOT EXISTS expected_start TIME NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS for_roles VARCHAR(40) NULL;
