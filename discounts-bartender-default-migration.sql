-- Discounts the Owner sets up are now usable by bartenders by default.
-- (The switch Settings -> Discounts -> "Bartenders may apply these discounts" used to start OFF,
--  so a new discount never appeared on the bartender's payment screen.)
-- The Owner can still switch it off at any time.
ALTER TABLE settings MODIFY COLUMN bartender_can_discount TINYINT(1) NOT NULL DEFAULT 1;
UPDATE settings SET bartender_can_discount = 1;
