-- ============================================================
--  BarMS — Refunds for paid orders (2026-10-02)
--  A refund gives money back to a customer for some or all items
--  of a paid order. Sealed bar items can be returned to stock.
--  Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS order_refunds (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_id      INT NOT NULL,
  order_number  VARCHAR(32) NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  reason        VARCHAR(255) NOT NULL,
  method        VARCHAR(30) NOT NULL DEFAULT 'Cash',
  refund_date   DATE NOT NULL,
  refunded_by   VARCHAR(100) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_refund_order (order_id),
  KEY idx_refund_date (refund_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_refund_items (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  refund_id      INT NOT NULL,
  order_item_id  INT NOT NULL,
  product_name   VARCHAR(150) NOT NULL,
  source_type    VARCHAR(20) NOT NULL DEFAULT 'bar',
  qty            INT NOT NULL,
  unit_price     DECIMAL(12,2) NOT NULL,
  total          DECIMAL(12,2) NOT NULL,
  restocked      TINYINT(1) NOT NULL DEFAULT 0,
  restock_cost   DECIMAL(12,2) NOT NULL DEFAULT 0,
  KEY idx_refund_items_refund (refund_id),
  KEY idx_refund_items_item (order_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Owner can let managers refund directly; others send a refund request
ALTER TABLE mgr_permissions ADD COLUMN IF NOT EXISTS can_give_refunds TINYINT(1) NOT NULL DEFAULT 0;
-- Refund requests keep the chosen items here (JSON)
ALTER TABLE void_requests ADD COLUMN IF NOT EXISTS details TEXT NULL;
