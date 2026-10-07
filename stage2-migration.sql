-- ============================================================
--  BarMS — Stage 2: records the Advanced Reports need (2026-10-02)
--  Safe to run more than once. Nothing existing is changed.
-- ============================================================

-- 1. Discounts given at payment
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount        DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_reason VARCHAR(255) NULL AFTER discount;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shift_id        INT NULL AFTER paid_at;
ALTER TABLE mgr_permissions ADD COLUMN IF NOT EXISTS can_give_discounts TINYINT(1) NOT NULL DEFAULT 0;

-- 2. Shifts and cash handover
CREATE TABLE IF NOT EXISTS shifts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  user_name       VARCHAR(100) NOT NULL,
  device          VARCHAR(120) NULL,
  opening_float   DECIMAL(12,2) NOT NULL DEFAULT 0,
  opened_at       DATETIME NOT NULL,
  closed_at       DATETIME NULL,
  expected_cash   DECIMAL(12,2) NULL,
  counted_cash    DECIMAL(12,2) NULL,
  difference      DECIMAL(12,2) NULL,
  close_note      VARCHAR(255) NULL,
  status          VARCHAR(10) NOT NULL DEFAULT 'open',
  KEY idx_shifts_user (user_id, status),
  KEY idx_shifts_opened (opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. How each expense was paid (cash expenses come out of the drawer)
ALTER TABLE expenses         ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NULL AFTER amount;
ALTER TABLE expenses         ADD COLUMN IF NOT EXISTS shift_id INT NULL;
ALTER TABLE kitchen_expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NULL AFTER amount;
ALTER TABLE kitchen_expenses ADD COLUMN IF NOT EXISTS shift_id INT NULL;

-- 4. Suppliers: what was paid when stock arrived, and later payments
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS amount_paid    DECIMAL(14,2) NULL AFTER total_cost;
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NULL AFTER amount_paid;
CREATE TABLE IF NOT EXISTS supplier_payments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  supplier      VARCHAR(150) NOT NULL,
  amount        DECIMAL(14,2) NOT NULL,
  method        VARCHAR(20) NOT NULL DEFAULT 'Cash',
  reference     VARCHAR(100) NULL,
  note          VARCHAR(255) NULL,
  payment_date  DATE NOT NULL,
  shift_id      INT NULL,
  recorded_by   VARCHAR(100) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sp_supplier (supplier),
  KEY idx_sp_date (payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Crates / cartons: each drink has its own pack size
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS pack_name      VARCHAR(30) NULL;
ALTER TABLE bar_items ADD COLUMN IF NOT EXISTS units_per_pack INT NULL;
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS pack_qty       DECIMAL(14,3) NULL;
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS pack_name      VARCHAR(30) NULL;
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS units_per_pack INT NULL;

-- 6. Physical stock counts
CREATE TABLE IF NOT EXISTS stock_counts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  area         VARCHAR(30) NOT NULL,           -- bar_item | bar_ingredient | kitchen_ingredient
  count_date   DATE NOT NULL,
  counted_by   VARCHAR(100) NOT NULL,
  note         VARCHAR(255) NULL,
  applied      TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = stock was adjusted to the count
  applied_by   VARCHAR(100) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sc_date (count_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS stock_count_lines (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  count_id    INT NOT NULL,
  item_id     INT NOT NULL,
  item_name   VARCHAR(150) NOT NULL,
  unit        VARCHAR(30) NOT NULL,
  expected    DECIMAL(14,3) NOT NULL,
  counted     DECIMAL(14,3) NOT NULL,
  variance    DECIMAL(14,3) NOT NULL,
  unit_cost   DECIMAL(14,2) NOT NULL DEFAULT 0,
  KEY idx_scl_count (count_id),
  KEY idx_scl_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Cash book: money that is not sales or expenses
CREATE TABLE IF NOT EXISTS cash_movements (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  type          VARCHAR(30) NOT NULL,  -- owner_withdrawal | capital | loan_in | loan_repayment | transfer | other_in | other_out
  amount        DECIMAL(14,2) NOT NULL,
  method        VARCHAR(20) NOT NULL DEFAULT 'Cash',
  to_method     VARCHAR(20) NULL,      -- transfers: where the money went
  note          VARCHAR(255) NULL,
  movement_date DATE NOT NULL,
  shift_id      INT NULL,
  recorded_by   VARCHAR(100) NOT NULL,
  voided        TINYINT(1) NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cm_date (movement_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. When and how a customer paid their debt
ALTER TABLE customer_debts ADD COLUMN IF NOT EXISTS paid_at        DATETIME NULL;
ALTER TABLE customer_debts ADD COLUMN IF NOT EXISTS paid_method    VARCHAR(20) NULL;
ALTER TABLE customer_debts ADD COLUMN IF NOT EXISTS paid_by        VARCHAR(100) NULL;
ALTER TABLE customer_debts ADD COLUMN IF NOT EXISTS shift_id       INT NULL;

-- Cash refunds come out of the drawer of the shift that paid them
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS shift_id INT NULL;

-- Cash paid to a supplier on delivery comes out of the drawer of that shift
ALTER TABLE inventory_purchases ADD COLUMN IF NOT EXISTS shift_id INT NULL;

-- How often a physical stock count is due (days). The Owner can change it in Settings.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS stock_count_days INT NOT NULL DEFAULT 7;

-- An employee can be linked to their BarMS login so their work is tracked automatically
ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id INT NULL;
ALTER TABLE employees ADD UNIQUE INDEX IF NOT EXISTS uq_employees_user (user_id);
