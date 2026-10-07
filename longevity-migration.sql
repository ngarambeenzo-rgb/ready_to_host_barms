-- ============================================================
--  longevity-migration.sql — BarMS database ready for 10+ years
--
--  1. Dates: every TIMESTAMP column becomes DATETIME.
--     TIMESTAMP cannot hold a moment after 2038-01-19 03:14:07 UTC: from then on
--     every new sale, order and log line would fail. DATETIME holds up to year 9999.
--     The stored values do not change (same date and time the app already shows).
--  2. Indexes for every search the app makes by date, shift, order or item,
--     so screens stay fast with years of records (measured on 10 years of data).
--  3. A duplicate index on kitchen_stock_movements is removed.
--
--  Safe to run more than once. Takes a few seconds per large table.
--  Back up the database first. For every client:
--    php tools/migrate_all_clients.php longevity-migration.sql
-- ============================================================
ALTER TABLE `api_tokens`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_at_expires` (expires_at);

ALTER TABLE `audit_log`
  MODIFY `time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  MODIFY `done_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_al_type` (action_type),
  ADD INDEX IF NOT EXISTS `idx_al_done` (done_at);

ALTER TABLE `bar_ingredients`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `bar_items`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `bar_movements`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_bm_order` (order_number, item_id),
  ADD INDEX IF NOT EXISTS `idx_bm_item` (item_id, created_at),
  ADD INDEX IF NOT EXISTS `idx_bm_ingredient` (ingredient_id, created_at),
  ADD INDEX IF NOT EXISTS `idx_bm_ledger` (item_id, ingredient_id, type, created_at, qty_change);

ALTER TABLE `bar_recipes`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `bar_sales`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_bs_product` (product_id, sale_date);

ALTER TABLE `barms_tenants`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `business_assets`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `cash_movements`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_cm_shift` (shift_id);

ALTER TABLE `customer_debts`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_cd_status` (status, paid_at),
  ADD INDEX IF NOT EXISTS `idx_cd_shift` (shift_id),
  ADD INDEX IF NOT EXISTS `idx_cd_date` (debt_date);

ALTER TABLE `discount_rules`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `employee_debts`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `employees`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `expenses`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_e_date` (expense_date),
  ADD INDEX IF NOT EXISTS `idx_e_shift` (shift_id);

ALTER TABLE `inventory_purchases`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_ip_shift` (shift_id);

ALTER TABLE `kitchen_deductions`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_kd_order` (order_id);

ALTER TABLE `kitchen_expenses`
  MODIFY `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_ke_date` (expense_date),
  ADD INDEX IF NOT EXISTS `idx_ke_shift` (shift_id);

ALTER TABLE `kitchen_ingredients`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `kitchen_menu`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `kitchen_order_items`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `kitchen_orders`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_ko_created` (created_at);

ALTER TABLE `kitchen_prep_history`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `kitchen_recipes`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `kitchen_revenue`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_kr_date` (revenue_date);

ALTER TABLE `kitchen_sales`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_ks_order` (order_id),
  ADD INDEX IF NOT EXISTS `idx_ks_product` (product_id, sale_date);

ALTER TABLE `kitchen_stock_movements`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_ksm_ledger` (ingredient_id, type, created_at, qty),
  DROP INDEX IF EXISTS `idx_ksm_created`;

ALTER TABLE `notifications`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_nt_read` (is_read);

ALTER TABLE `order_items`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_oi_source` (source_type, source_id);

ALTER TABLE `order_refunds`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_or_shift` (shift_id);

ALTER TABLE `orders`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_o_paid` (status, voided, paid_at, payment_method, total, discount),
  ADD INDEX IF NOT EXISTS `idx_o_shift` (shift_id),
  ADD INDEX IF NOT EXISTS `idx_o_created` (created_at),
  ADD INDEX IF NOT EXISTS `idx_o_paidby` (paid_by, paid_at);

ALTER TABLE `products`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `report_issues`
  MODIFY `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `request_keys`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `salary_payments`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_sal_date` (payment_date);

ALTER TABLE `sales`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `settings`
  MODIFY `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `shifts`
  ADD INDEX IF NOT EXISTS `idx_shifts_status` (status);

ALTER TABLE `stock_counts`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `stock_movements`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `supplier_payments`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD INDEX IF NOT EXISTS `idx_sup_shift` (shift_id);

ALTER TABLE `support_requests`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `system_incident_events`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `table_session_items`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `table_sessions`
  MODIFY `opened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  MODIFY `closed_at` DATETIME NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS `idx_ts_status` (status, closed_at);

ALTER TABLE `tables`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `users`
  MODIFY `last_login` DATETIME NULL DEFAULT NULL,
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `void_requests`
  MODIFY `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  MODIFY `reviewed_at` DATETIME NULL DEFAULT NULL,
  ADD INDEX IF NOT EXISTS `idx_vr_status` (status),
  ADD INDEX IF NOT EXISTS `idx_vr_ref` (type, ref_id),
  ADD INDEX IF NOT EXISTS `idx_vr_reviewed` (reviewed_at),
  ADD INDEX IF NOT EXISTS `idx_vr_created` (created_at);

-- Counters: the next order number (SO-0001 …) and takeaway number (TK-001 …).
-- Before, the number was "how many orders exist + 1": two tills creating an order at the same
-- moment got the same number (one of them failed), and every new order counted the whole table.
CREATE TABLE IF NOT EXISTS counters (
  name  VARCHAR(30) NOT NULL PRIMARY KEY,
  value BIGINT      NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO counters (name, value)
  SELECT 'order', COALESCE(MAX(CAST(SUBSTRING(order_number, 4) AS UNSIGNED)), 0) FROM orders WHERE order_number LIKE 'SO-%';

INSERT IGNORE INTO counters (name, value)
  SELECT 'takeaway', COALESCE(MAX(CAST(SUBSTRING(table_name, 4) AS UNSIGNED)), 0) FROM orders WHERE type = 'takeaway' AND table_name LIKE 'TK-%';
