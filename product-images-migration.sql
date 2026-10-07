-- ============================================================
--  product-images-migration.sql  (safe to run more than once)
--  Lets each bar item and kitchen dish carry a real product photo,
--  shown on the order screen, item lists and low-stock lists.
--  Files live in uploads/products/ (see api/product_images.php).
-- ============================================================
ALTER TABLE bar_items    ADD COLUMN IF NOT EXISTS image VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE kitchen_menu ADD COLUMN IF NOT EXISTS image VARCHAR(255) NULL DEFAULT NULL;

-- Product type chosen by the owner (drives the drawn stand-in picture).
-- NULL = let BarMS guess from the name.
ALTER TABLE bar_items    ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) NULL DEFAULT NULL;
ALTER TABLE kitchen_menu ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) NULL DEFAULT NULL;
