-- ============================================================
--  reliability-migration.sql
--  request_keys: one row per write request (idempotency key), so a retry
--  after a lost connection gets the first answer back instead of saving
--  a sale, payment, refund, purchase or expense twice.
--  Safe to run more than once. For every client:
--    php tools/migrate_all_clients.php reliability-migration.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS request_keys (
  idem_key    VARCHAR(64)  NOT NULL PRIMARY KEY,
  user_id     INT          NULL,
  endpoint    VARCHAR(80)  NOT NULL,
  status      VARCHAR(12)  NOT NULL DEFAULT 'processing',   -- processing | done
  http_code   SMALLINT     NULL,
  response    MEDIUMTEXT   NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rk_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- system_incidents: one row per distinct problem (repeats are counted, not duplicated)
CREATE TABLE IF NOT EXISTS system_incidents (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  ref           VARCHAR(24)  NULL,
  fingerprint   CHAR(40)     NOT NULL,
  category      VARCHAR(20)  NOT NULL,          -- server | database | network | sync | frontend | integrity | performance | security | device
  severity      VARCHAR(10)  NOT NULL,          -- info | warning | error | critical
  title         VARCHAR(200) NOT NULL,
  detail        TEXT         NULL,              -- technical detail for the Owner (secrets removed)
  source        VARCHAR(120) NULL,
  status        VARCHAR(12)  NOT NULL DEFAULT 'open',   -- open | recovering | recovered | resolved
  occurrences   INT          NOT NULL DEFAULT 1,
  devices       VARCHAR(500) NULL,
  users         VARCHAR(500) NULL,
  auto_action   VARCHAR(200) NULL,
  first_seen    DATETIME     NOT NULL,
  last_seen     DATETIME     NOT NULL,
  resolved_at   DATETIME     NULL,
  resolved_by   VARCHAR(100) NULL,
  resolved_note VARCHAR(255) NULL,
  app_version   VARCHAR(20)  NULL,
  KEY idx_si_fp (fingerprint, status),
  KEY idx_si_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- history of each incident (occurred, recovery attempted, recovered, escalated, resolved)
CREATE TABLE IF NOT EXISTS system_incident_events (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  incident_id INT          NOT NULL,
  kind        VARCHAR(20)  NOT NULL,
  note        VARCHAR(500) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sie_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- table-session items: the same tap (client_uuid) can only be stored once
ALTER TABLE table_session_items ADD UNIQUE INDEX IF NOT EXISTS uq_tsi_client_uuid (client_uuid);
