-- ============================================================
--  measured-drinks-migration.sql  (safe to run more than once)
--  Sell a bottle by the shot or glass.
--
--  A bottle item (type 'direct') keeps counting SEALED bottles in `stock`.
--  The bottle that is already opened is tracked in `open_amount`, in the
--  unit the owner chose (ml, cl, oz or g). Shots and glasses are their own
--  sellable rows (type 'portion') that point at the bottle through parent_id.
--
--  Run for every client:  php tools/migrate_all_clients.php measured-drinks-migration.sql
-- ============================================================
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS parent_id     INT NULL DEFAULT NULL;
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS portion_size  DECIMAL(12,3) NULL DEFAULT NULL;
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS measure_unit  VARCHAR(10) NULL DEFAULT NULL;
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS bottle_size   DECIMAL(12,3) NULL DEFAULT NULL;
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS open_amount   DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS empty_weight  DECIMAL(12,3) NULL DEFAULT NULL;
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS density       DECIMAL(6,3) NULL DEFAULT NULL;
