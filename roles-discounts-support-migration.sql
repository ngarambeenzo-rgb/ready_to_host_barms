-- ============================================================
--  roles-discounts-support-migration.sql  (safe to run more than once)
--  1. Kitchen staff accounts: the role column did not allow 'Kitchen',
--     so new kitchen accounts were saved with an empty role.
--  2. Owner-defined discounts on chosen items (staff can only apply these).
--  3. Support requests sent from BarMS to IMS (kept here even if email fails).
-- ============================================================

-- 1. roles
ALTER TABLE users MODIFY role ENUM('Owner','Manager','Bartender','Kitchen') NOT NULL DEFAULT 'Bartender';
-- accounts that lost their role because of the old column were kitchen accounts
UPDATE users SET role = 'Kitchen' WHERE role = '' OR role IS NULL;

-- 2. discounts the Owner sets up
CREATE TABLE IF NOT EXISTS discount_rules (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(80)  NOT NULL,
  source_type  VARCHAR(10)  NOT NULL,            -- 'bar' | 'kitchen'
  source_id    INT          NOT NULL,            -- bar_items.id or kitchen_menu.id
  kind         VARCHAR(10)  NOT NULL DEFAULT 'percent', -- 'percent' | 'amount' (per unit)
  value        DECIMAL(12,2) NOT NULL,
  active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_by   VARCHAR(100) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dr_item (source_type, source_id, active)
);

-- who may apply them: managers use the existing canGiveDiscounts permission;
-- bartenders need this switch (Owner only, off by default)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS bartender_can_discount TINYINT(1) NOT NULL DEFAULT 0;
-- the Owner can still type any discount amount; staff only pick rules
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_rules VARCHAR(255) NULL;

-- 3. support requests
CREATE TABLE IF NOT EXISTS support_requests (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  category     VARCHAR(30)  NOT NULL,
  subject      VARCHAR(150) NOT NULL,
  message      TEXT         NOT NULL,
  contact      VARCHAR(150) NULL,
  sent_by      VARCHAR(100) NULL,
  bar_name     VARCHAR(150) NULL,
  email_status VARCHAR(20)  NOT NULL DEFAULT 'pending',  -- sent | failed | pending
  email_error  VARCHAR(255) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
