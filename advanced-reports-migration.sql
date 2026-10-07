-- ============================================================
--  BarMS — Advanced Reports support (2026-10-02)
--  Safe to run more than once. Existing rows are kept; older
--  sales keep unit_cost NULL and are reported as "estimated".
-- ============================================================

-- Cost of one unit at the moment it was sold (for accurate cost of goods sold)
ALTER TABLE bar_sales     ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(14,4) NULL AFTER total;
ALTER TABLE kitchen_sales ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(14,4) NULL AFTER total;

-- Which dish used the ingredient (ingredient cost per menu item)
ALTER TABLE kitchen_deductions ADD COLUMN IF NOT EXISTS menu_item_id  INT NULL AFTER order_id;
ALTER TABLE kitchen_deductions ADD COLUMN IF NOT EXISTS order_item_id INT NULL AFTER menu_item_id;

-- Review status for issues found by the Stock Discrepancies report
CREATE TABLE IF NOT EXISTS report_issues (
  issue_key    VARCHAR(191) NOT NULL PRIMARY KEY,
  status       VARCHAR(20)  NOT NULL DEFAULT 'open',   -- open | review | resolved | dismissed
  note         VARCHAR(500) NULL,
  reviewed_by  VARCHAR(100) NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Speed up period queries
ALTER TABLE bar_sales     ADD INDEX IF NOT EXISTS idx_bar_sales_date (sale_date);
ALTER TABLE kitchen_sales ADD INDEX IF NOT EXISTS idx_kitchen_sales_date (sale_date);
ALTER TABLE bar_movements ADD INDEX IF NOT EXISTS idx_bar_movements_created (created_at);
ALTER TABLE kitchen_stock_movements ADD INDEX IF NOT EXISTS idx_ksm_created (created_at);
