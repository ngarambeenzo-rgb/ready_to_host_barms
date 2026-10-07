-- ============================================================
--  business-worth-migration.sql
--  Equipment and other things the business owns (fridges, furniture,
--  sound system…), so Advanced Reports → Business worth can show
--  everything the business owns and owes.
--  Safe to run more than once. For every client:
--    php tools/migrate_all_clients.php business-worth-migration.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS business_assets (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(150) NOT NULL,
  category         VARCHAR(50)  NOT NULL DEFAULT 'Equipment',
  value            DECIMAL(14,2) NOT NULL,
  acquired_date    DATE NOT NULL,
  -- 'owner'    = the owner brought it in (counts as capital put in)
  -- 'business' = bought with business money (a cash book entry takes the money out)
  funded_by        VARCHAR(10)  NOT NULL DEFAULT 'business',
  method           VARCHAR(20)  NULL,
  cash_movement_id INT NULL,
  note             VARCHAR(255) NULL,
  disposed_date    DATE NULL,
  disposed_reason  VARCHAR(255) NULL,
  recorded_by      VARCHAR(100) NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ba_dates (acquired_date, disposed_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
