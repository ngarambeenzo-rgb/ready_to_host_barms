-- ============================================================
--  legacy-retire-migration.sql
--  The old item list ("products": old Quick Sale and old table sessions) is
--  retired. Everything is sold from the current Items list (bar_items) and the
--  kitchen Menu. Old items are switched off, not deleted, so past sales keep
--  their names and stay correct in reports. Safe to run more than once:
--    php tools/migrate_all_clients.php legacy-retire-migration.sql
-- ============================================================
UPDATE products SET active = 0 WHERE active = 1;
