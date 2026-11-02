-- ============================================================
--  offline-migration.sql — offline mode, stage 1
--  settings.offline_main_device / offline_owner_device: the two devices
--    the Owner lets keep working without internet (IMS device uuids).
--  api_tokens.device_uuid: one offline token per person per device, so
--    signing in on one device no longer cancels another device's token.
--  offline_rejects: offline records the server refused when they synced,
--    kept for the Owner (System Health) — nothing is silently dropped.
--  Safe to run more than once. For every client:
--    php tools/migrate_all_clients.php offline-migration.sql
-- ============================================================

ALTER TABLE settings ADD COLUMN IF NOT EXISTS offline_main_device  VARCHAR(64) NULL;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS offline_owner_device VARCHAR(64) NULL;

ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS device_uuid VARCHAR(64) NULL AFTER user_id;
ALTER TABLE api_tokens ADD INDEX IF NOT EXISTS idx_at_user_device (user_id, device_uuid);
-- old tokens had no device and were never used by the server: remove them
DELETE FROM api_tokens WHERE device_uuid IS NULL;

-- stage 2: orders made offline keep the device's id (sync is resumable) and its number
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_uuid VARCHAR(64) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offline_ref VARCHAR(20) NULL;
ALTER TABLE orders ADD UNIQUE INDEX IF NOT EXISTS uq_orders_client_uuid (client_uuid);

-- stage 3: a shift opened offline is found again by the device's id
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS client_uuid VARCHAR(64) NULL;
ALTER TABLE shifts ADD UNIQUE INDEX IF NOT EXISTS uq_shifts_client_uuid (client_uuid);

CREATE TABLE IF NOT EXISTS offline_rejects (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  idem_key     VARCHAR(64)  NULL,
  device_uuid  VARCHAR(64)  NOT NULL DEFAULT '',
  user_id      INT          NULL,
  user_name    VARCHAR(100) NULL,
  endpoint     VARCHAR(80)  NOT NULL,
  payload      TEXT         NULL,
  offline_at   DATETIME     NULL,              -- when the record was made on the device
  error        VARCHAR(255) NOT NULL,
  status       VARCHAR(10)  NOT NULL DEFAULT 'open',   -- open | resolved
  resolved_by  VARCHAR(100) NULL,
  resolved_at  DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_or_key (idem_key),
  KEY idx_or_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
