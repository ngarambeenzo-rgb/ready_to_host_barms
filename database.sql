-- ============================================================
--  BarMS — complete database (version 1.0.0)
--
--  A NEW installation needs only this file:
--    1. Create an empty database (utf8mb4).
--    2. Import this file (phpMyAdmin → Import, or: mysql -u USER -p DBNAME < database.sql).
--    3. Open BarMS: the first sign-in screen asks to create the Owner account.
--  It already contains every change of the *-migration.sql files (those are only for
--  upgrading an existing database). Safe to import again: nothing is replaced.
--
--  Built for 10+ years of records: dates are DATETIME (valid to year 9999, not only to
--  2038), every search by date, shift, order and item has its index.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `api_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `token` varchar(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `user_id` (`user_id`),
  KEY `idx_at_expires` (`expires_at`),
  CONSTRAINT `api_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `action_type` varchar(50) NOT NULL,
  `details` text DEFAULT NULL,
  `done_by` varchar(100) NOT NULL,
  `role` varchar(30) DEFAULT NULL,
  `time` datetime NOT NULL DEFAULT current_timestamp(),
  `done_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_al_type` (`action_type`),
  KEY `idx_al_done` (`done_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `bar_ingredients` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `quantity` decimal(12,3) NOT NULL DEFAULT 0.000,
  `unit` varchar(30) NOT NULL DEFAULT '',
  `cost_per_unit` decimal(12,2) NOT NULL DEFAULT 0.00,
  `min_stock` decimal(12,3) NOT NULL DEFAULT 0.000,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `bar_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `cost_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `type` varchar(20) NOT NULL DEFAULT 'direct',
  `stock` decimal(12,2) NOT NULL DEFAULT 0.00,
  `min_stock` decimal(12,2) NOT NULL DEFAULT 5.00,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `recipe_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `pack_name` varchar(30) DEFAULT NULL,
  `units_per_pack` int(11) DEFAULT NULL,
  `image` varchar(255) DEFAULT NULL,
  `product_type` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bar_items_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `bar_movements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_name` varchar(150) NOT NULL,
  `item_id` int(11) DEFAULT NULL,
  `ingredient_id` int(11) DEFAULT NULL,
  `qty_change` decimal(12,3) NOT NULL DEFAULT 0.000,
  `type` varchar(30) NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `unit` varchar(30) DEFAULT NULL,
  `order_number` varchar(32) DEFAULT NULL,
  `done_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `supplier` varchar(150) DEFAULT NULL,
  `reference` varchar(100) DEFAULT NULL,
  `unit_cost` decimal(14,2) DEFAULT NULL,
  `total_cost` decimal(14,2) DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_bar_movements_created` (`created_at`),
  KEY `idx_bm_order` (`order_number`,`item_id`),
  KEY `idx_bm_item` (`item_id`,`created_at`),
  KEY `idx_bm_ingredient` (`ingredient_id`,`created_at`),
  KEY `idx_bm_ledger` (`item_id`,`ingredient_id`,`type`,`created_at`,`qty_change`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `bar_recipe_ingredients` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `recipe_id` int(11) NOT NULL,
  `ingredient_id` int(11) NOT NULL,
  `qty` decimal(12,3) NOT NULL DEFAULT 0.000,
  `unit` varchar(30) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_bar_recipe_ingredients_recipe` (`recipe_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `bar_recipes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `bar_sales` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `product_name` varchar(150) NOT NULL,
  `qty` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `unit_cost` decimal(14,4) DEFAULT NULL,
  `sold_by` varchar(100) NOT NULL,
  `order_id` int(11) NOT NULL,
  `order_number` varchar(32) NOT NULL,
  `sale_date` date NOT NULL,
  `sale_time` time NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bar_sales_date` (`sale_date`),
  KEY `idx_bar_sales_order` (`order_id`),
  KEY `idx_bs_product` (`product_id`,`sale_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `barms_tenants` (
  `client_id` int(11) NOT NULL,
  `prefix` varchar(20) NOT NULL,
  `legacy` tinyint(1) NOT NULL DEFAULT 0,
  `bar_name` varchar(150) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `business_assets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `category` varchar(50) NOT NULL DEFAULT 'Equipment',
  `value` decimal(14,2) NOT NULL,
  `acquired_date` date NOT NULL,
  `funded_by` varchar(10) NOT NULL DEFAULT 'business',
  `method` varchar(20) DEFAULT NULL,
  `cash_movement_id` int(11) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `disposed_date` date DEFAULT NULL,
  `disposed_reason` varchar(255) DEFAULT NULL,
  `recorded_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ba_dates` (`acquired_date`,`disposed_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `cash_movements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(30) NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `method` varchar(20) NOT NULL DEFAULT 'Cash',
  `to_method` varchar(20) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `movement_date` date NOT NULL,
  `shift_id` int(11) DEFAULT NULL,
  `recorded_by` varchar(100) NOT NULL,
  `voided` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cm_date` (`movement_date`),
  KEY `idx_cm_shift` (`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `counters` (
  `name` varchar(30) NOT NULL,
  `value` bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `customer_debts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customer_name` varchar(100) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `debt_date` date NOT NULL,
  `status` enum('Pending','Paid') NOT NULL DEFAULT 'Pending',
  `recorded_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `paid_at` datetime DEFAULT NULL,
  `paid_method` varchar(20) DEFAULT NULL,
  `paid_by` varchar(100) DEFAULT NULL,
  `shift_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cd_status` (`status`,`paid_at`),
  KEY `idx_cd_shift` (`shift_id`),
  KEY `idx_cd_date` (`debt_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `discount_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  `source_type` varchar(10) NOT NULL,
  `source_id` int(11) NOT NULL,
  `kind` varchar(10) NOT NULL DEFAULT 'percent',
  `value` decimal(12,2) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_dr_item` (`source_type`,`source_id`,`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `employee_debts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `emp_name` varchar(100) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `note` varchar(255) DEFAULT 'Advance',
  `debt_date` date NOT NULL,
  `status` enum('Pending','Paid') NOT NULL DEFAULT 'Pending',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `employee_id` (`employee_id`),
  CONSTRAINT `employee_debts_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `employees` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) NOT NULL,
  `position` varchar(80) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `salary` decimal(12,2) NOT NULL DEFAULT 0.00,
  `hire_date` date NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `user_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employees_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `client_uuid` char(36) DEFAULT NULL,
  `description` varchar(255) NOT NULL,
  `category` varchar(50) NOT NULL DEFAULT 'General',
  `amount` decimal(12,2) NOT NULL,
  `payment_method` varchar(20) DEFAULT NULL,
  `expense_date` date NOT NULL,
  `recorded_by` varchar(100) NOT NULL,
  `voided` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `shift_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_uuid` (`client_uuid`),
  KEY `idx_e_date` (`expense_date`),
  KEY `idx_e_shift` (`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `inventory_purchases` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `inventory_type` varchar(32) NOT NULL,
  `inventory_id` int(11) NOT NULL,
  `item_name` varchar(150) NOT NULL,
  `quantity` decimal(14,3) NOT NULL,
  `unit` varchar(30) NOT NULL DEFAULT '',
  `unit_cost` decimal(14,2) NOT NULL,
  `total_cost` decimal(14,2) NOT NULL,
  `amount_paid` decimal(14,2) DEFAULT NULL,
  `payment_method` varchar(20) DEFAULT NULL,
  `supplier` varchar(150) DEFAULT NULL,
  `reference` varchar(100) DEFAULT NULL,
  `purchase_date` date NOT NULL,
  `recorded_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `pack_qty` decimal(14,3) DEFAULT NULL,
  `pack_name` varchar(30) DEFAULT NULL,
  `units_per_pack` int(11) DEFAULT NULL,
  `shift_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_purchases_date` (`purchase_date`),
  KEY `idx_inventory_purchases_item` (`inventory_type`,`inventory_id`),
  KEY `idx_ip_shift` (`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_deductions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` int(11) NOT NULL,
  `menu_item_id` int(11) DEFAULT NULL,
  `order_item_id` int(11) DEFAULT NULL,
  `ingredient_id` int(11) NOT NULL,
  `qty` decimal(12,3) NOT NULL DEFAULT 0.000,
  `cost` decimal(12,2) NOT NULL DEFAULT 0.00,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_kitchen_deductions_created` (`created_at`),
  KEY `idx_kd_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_expenses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `description` varchar(255) NOT NULL,
  `category` varchar(50) NOT NULL DEFAULT 'General',
  `amount` decimal(12,2) NOT NULL,
  `payment_method` varchar(20) DEFAULT NULL,
  `expense_date` date NOT NULL,
  `recorded_by` varchar(100) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `shift_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ke_date` (`expense_date`),
  KEY `idx_ke_shift` (`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_ingredients` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `quantity` decimal(12,3) NOT NULL DEFAULT 0.000,
  `unit` varchar(30) NOT NULL DEFAULT '',
  `cost_per_unit` decimal(12,2) NOT NULL DEFAULT 0.00,
  `min_stock` decimal(12,3) NOT NULL DEFAULT 0.000,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_menu` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `category` varchar(50) NOT NULL DEFAULT 'Food',
  `price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `description` varchar(255) DEFAULT NULL,
  `recipe_id` int(11) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `prep_minutes` int(11) NOT NULL DEFAULT 10,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `image` varchar(255) DEFAULT NULL,
  `product_type` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_kitchen_menu_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_order_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `kitchen_order_id` int(11) NOT NULL,
  `menu_item_id` int(11) DEFAULT NULL,
  `product_name` varchar(150) NOT NULL,
  `qty` int(11) NOT NULL DEFAULT 1,
  `prep_minutes` int(11) NOT NULL DEFAULT 10,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_kitchen_order_items_order` (`kitchen_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` int(11) NOT NULL,
  `order_number` varchar(32) NOT NULL,
  `table_name` varchar(100) NOT NULL DEFAULT '',
  `customer_note` text DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `estimated_minutes` int(11) NOT NULL DEFAULT 10,
  `accepted_at` datetime DEFAULT NULL,
  `accepted_by` varchar(100) DEFAULT NULL,
  `preparing_at` datetime DEFAULT NULL,
  `ready_at` datetime DEFAULT NULL,
  `served_at` datetime DEFAULT NULL,
  `served_by` varchar(100) DEFAULT NULL,
  `reject_reason` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_kitchen_orders_status_created` (`status`,`created_at`),
  KEY `idx_kitchen_orders_order` (`order_id`),
  KEY `idx_ko_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_prep_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `menu_item_id` int(11) DEFAULT NULL,
  `product_name` varchar(150) NOT NULL,
  `actual_minutes` decimal(8,2) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_kitchen_prep_history_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_recipes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `menu_item_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_revenue` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `note` varchar(255) DEFAULT 'Daily revenue',
  `revenue_date` date NOT NULL,
  `recorded_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `product_id` int(11) DEFAULT NULL,
  `product_name` varchar(150) DEFAULT NULL,
  `qty` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `sold_by` varchar(100) DEFAULT NULL,
  `order_id` int(11) DEFAULT NULL,
  `sale_date` date DEFAULT NULL,
  `sale_time` time DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_kr_date` (`revenue_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_sales` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) DEFAULT NULL,
  `product_name` varchar(150) NOT NULL,
  `qty` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `unit_cost` decimal(14,4) DEFAULT NULL,
  `sold_by` varchar(100) NOT NULL,
  `order_id` int(11) NOT NULL,
  `sale_date` date NOT NULL,
  `sale_time` time NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_kitchen_sales_created` (`created_at`),
  KEY `idx_kitchen_sales_date` (`sale_date`),
  KEY `idx_ks_order` (`order_id`),
  KEY `idx_ks_product` (`product_id`,`sale_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `kitchen_stock_movements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ingredient_id` int(11) NOT NULL,
  `qty` decimal(12,3) NOT NULL DEFAULT 0.000,
  `type` varchar(30) NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `done_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `supplier` varchar(150) DEFAULT NULL,
  `reference` varchar(100) DEFAULT NULL,
  `unit_cost` decimal(14,2) DEFAULT NULL,
  `total_cost` decimal(14,2) DEFAULT 0.00,
  `purchase_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_kitchen_stock_movements_created` (`created_at`),
  KEY `idx_ksm_ledger` (`ingredient_id`,`type`,`created_at`,`qty`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `mgr_permissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `can_view_reports` tinyint(1) NOT NULL DEFAULT 1,
  `can_edit_stock` tinyint(1) NOT NULL DEFAULT 1,
  `can_edit_products` tinyint(1) NOT NULL DEFAULT 1,
  `can_view_employees` tinyint(1) NOT NULL DEFAULT 1,
  `can_view_audit` tinyint(1) NOT NULL DEFAULT 0,
  `can_manage_items` tinyint(1) NOT NULL DEFAULT 1,
  `can_record_expenses` tinyint(1) NOT NULL DEFAULT 1,
  `can_void_expenses` tinyint(1) NOT NULL DEFAULT 0,
  `can_approve_voids` tinyint(1) NOT NULL DEFAULT 0,
  `can_delete_records` tinyint(1) NOT NULL DEFAULT 0,
  `can_pay_salaries` tinyint(1) NOT NULL DEFAULT 0,
  `can_manage_users` tinyint(1) NOT NULL DEFAULT 0,
  `can_edit_settings` tinyint(1) NOT NULL DEFAULT 0,
  `can_give_refunds` tinyint(1) NOT NULL DEFAULT 0,
  `can_give_discounts` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `message` varchar(255) NOT NULL,
  `text` varchar(255) DEFAULT NULL,
  `read` tinyint(1) NOT NULL DEFAULT 0,
  `type` enum('info','warning','success','error') NOT NULL DEFAULT 'info',
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_nt_read` (`is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `order_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `product_name` varchar(150) NOT NULL,
  `qty` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `source_type` varchar(20) NOT NULL DEFAULT 'bar',
  `source_id` int(11) NOT NULL DEFAULT 0,
  `category` varchar(50) NOT NULL DEFAULT 'Drink',
  `client_uuid` char(36) DEFAULT NULL,
  `added_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_items_client_uuid` (`client_uuid`),
  KEY `idx_order_items_order` (`order_id`),
  KEY `idx_oi_source` (`source_type`,`source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `order_refund_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `refund_id` int(11) NOT NULL,
  `order_item_id` int(11) NOT NULL,
  `product_name` varchar(150) NOT NULL,
  `source_type` varchar(20) NOT NULL DEFAULT 'bar',
  `qty` int(11) NOT NULL,
  `unit_price` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `restocked` tinyint(1) NOT NULL DEFAULT 0,
  `restock_cost` decimal(12,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_refund_items_refund` (`refund_id`),
  KEY `idx_refund_items_item` (`order_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `order_refunds` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` int(11) NOT NULL,
  `order_number` varchar(32) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `method` varchar(30) NOT NULL DEFAULT 'Cash',
  `refund_date` date NOT NULL,
  `refunded_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `shift_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_refund_order` (`order_id`),
  KEY `idx_refund_date` (`refund_date`),
  KEY `idx_or_shift` (`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_number` varchar(32) NOT NULL,
  `type` varchar(20) NOT NULL DEFAULT 'dinein',
  `table_id` int(11) NOT NULL DEFAULT 0,
  `table_name` varchar(100) NOT NULL DEFAULT '',
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount_reason` varchar(255) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `created_by` varchar(100) NOT NULL,
  `validated_by` varchar(100) DEFAULT NULL,
  `validated_at` datetime DEFAULT NULL,
  `payment_method` varchar(30) DEFAULT NULL,
  `customer_phone` varchar(30) DEFAULT NULL,
  `paid_by` varchar(100) DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `shift_id` int(11) DEFAULT NULL,
  `voided` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `discount_rules` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_order_number` (`order_number`),
  KEY `idx_orders_table_status` (`table_id`,`status`),
  KEY `idx_orders_status_created` (`status`,`created_at`),
  KEY `idx_o_paid` (`status`,`voided`,`paid_at`,`payment_method`,`total`,`discount`),
  KEY `idx_o_shift` (`shift_id`),
  KEY `idx_o_created` (`created_at`),
  KEY `idx_o_paidby` (`paid_by`,`paid_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `category` varchar(50) NOT NULL DEFAULT 'General',
  `unit` varchar(30) NOT NULL DEFAULT 'Unit',
  `sell_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `cost_price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `stock` int(11) NOT NULL DEFAULT 0,
  `alert_level` int(11) NOT NULL DEFAULT 5 COMMENT 'Low stock warning threshold',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `recipe_ingredients` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `recipe_id` int(11) NOT NULL,
  `ingredient_id` int(11) NOT NULL,
  `qty` decimal(12,3) NOT NULL DEFAULT 0.000,
  PRIMARY KEY (`id`),
  KEY `idx_recipe_ingredients_recipe` (`recipe_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `report_issues` (
  `issue_key` varchar(191) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'open',
  `note` varchar(500) DEFAULT NULL,
  `reviewed_by` varchar(100) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`issue_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `request_keys` (
  `idem_key` varchar(64) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `endpoint` varchar(80) NOT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'processing',
  `http_code` smallint(6) DEFAULT NULL,
  `response` mediumtext DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`idem_key`),
  KEY `idx_rk_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `salary_payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL,
  `emp_name` varchar(100) NOT NULL,
  `gross_amount` decimal(12,2) NOT NULL,
  `deducted_debt` decimal(12,2) NOT NULL DEFAULT 0.00,
  `net_amount` decimal(12,2) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `payment_date` date NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `employee_id` (`employee_id`),
  KEY `idx_sal_date` (`payment_date`),
  CONSTRAINT `salary_payments_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `sales` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `client_uuid` char(36) DEFAULT NULL,
  `sync_status` enum('synced','pending','conflict') NOT NULL DEFAULT 'synced',
  `product_id` int(11) NOT NULL,
  `product_name` varchar(100) NOT NULL,
  `qty` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `sold_by` varchar(100) NOT NULL,
  `sale_date` date NOT NULL,
  `sale_time` time NOT NULL,
  `client_created_at` datetime DEFAULT NULL,
  `voided` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_client_uuid` (`client_uuid`),
  KEY `product_id` (`product_id`),
  KEY `idx_sale_date` (`sale_date`),
  KEY `idx_sync_status` (`sync_status`),
  CONSTRAINT `sales_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `bar_name` varchar(100) NOT NULL DEFAULT 'BarMS Pro',
  `location` varchar(100) NOT NULL DEFAULT 'Kigali, Rwanda',
  `currency` varchar(10) NOT NULL DEFAULT 'RWF',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `stock_count_days` int(11) NOT NULL DEFAULT 7,
  `bartender_can_discount` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `shifts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `user_name` varchar(100) NOT NULL,
  `device` varchar(120) DEFAULT NULL,
  `opening_float` decimal(12,2) NOT NULL DEFAULT 0.00,
  `opened_at` datetime NOT NULL,
  `closed_at` datetime DEFAULT NULL,
  `expected_cash` decimal(12,2) DEFAULT NULL,
  `counted_cash` decimal(12,2) DEFAULT NULL,
  `difference` decimal(12,2) DEFAULT NULL,
  `close_note` varchar(255) DEFAULT NULL,
  `status` varchar(10) NOT NULL DEFAULT 'open',
  PRIMARY KEY (`id`),
  KEY `idx_shifts_user` (`user_id`,`status`),
  KEY `idx_shifts_opened` (`opened_at`),
  KEY `idx_shifts_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `stock_count_lines` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `count_id` int(11) NOT NULL,
  `item_id` int(11) NOT NULL,
  `item_name` varchar(150) NOT NULL,
  `unit` varchar(30) NOT NULL,
  `expected` decimal(14,3) NOT NULL,
  `counted` decimal(14,3) NOT NULL,
  `variance` decimal(14,3) NOT NULL,
  `unit_cost` decimal(14,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_scl_count` (`count_id`),
  KEY `idx_scl_item` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `stock_counts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `area` varchar(30) NOT NULL,
  `count_date` date NOT NULL,
  `counted_by` varchar(100) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `applied` tinyint(1) NOT NULL DEFAULT 0,
  `applied_by` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_sc_date` (`count_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `stock_movements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `product_name` varchar(100) NOT NULL,
  `type` enum('IN','OUT') NOT NULL,
  `qty` int(11) NOT NULL,
  `cost` decimal(12,2) DEFAULT 0.00,
  `note` varchar(255) DEFAULT NULL,
  `move_date` date NOT NULL,
  `moved_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `supplier` varchar(150) DEFAULT NULL,
  `reference` varchar(100) DEFAULT NULL,
  `cost_per_unit` decimal(14,2) DEFAULT NULL,
  `total_cost` decimal(14,2) DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `stock_movements_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `supplier_payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `supplier` varchar(150) NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `method` varchar(20) NOT NULL DEFAULT 'Cash',
  `reference` varchar(100) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `payment_date` date NOT NULL,
  `shift_id` int(11) DEFAULT NULL,
  `recorded_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_sp_supplier` (`supplier`),
  KEY `idx_sp_date` (`payment_date`),
  KEY `idx_sup_shift` (`shift_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `support_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category` varchar(30) NOT NULL,
  `subject` varchar(150) NOT NULL,
  `message` text NOT NULL,
  `contact` varchar(150) DEFAULT NULL,
  `sent_by` varchar(100) DEFAULT NULL,
  `bar_name` varchar(150) DEFAULT NULL,
  `email_status` varchar(20) NOT NULL DEFAULT 'pending',
  `email_error` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `system_incident_events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `incident_id` int(11) NOT NULL,
  `kind` varchar(20) NOT NULL,
  `note` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_sie_incident` (`incident_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `system_incidents` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ref` varchar(24) DEFAULT NULL,
  `fingerprint` char(40) NOT NULL,
  `category` varchar(20) NOT NULL,
  `severity` varchar(10) NOT NULL,
  `title` varchar(200) NOT NULL,
  `detail` text DEFAULT NULL,
  `source` varchar(120) DEFAULT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'open',
  `occurrences` int(11) NOT NULL DEFAULT 1,
  `devices` varchar(500) DEFAULT NULL,
  `users` varchar(500) DEFAULT NULL,
  `auto_action` varchar(200) DEFAULT NULL,
  `first_seen` datetime NOT NULL,
  `last_seen` datetime NOT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `resolved_by` varchar(100) DEFAULT NULL,
  `resolved_note` varchar(255) DEFAULT NULL,
  `app_version` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_si_fp` (`fingerprint`,`status`),
  KEY `idx_si_seen` (`last_seen`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `table_session_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `session_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `product_name` varchar(100) NOT NULL,
  `qty` int(11) NOT NULL DEFAULT 1,
  `unit_price` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `client_uuid` char(36) DEFAULT NULL,
  `added_by` varchar(100) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tsi_client_uuid` (`client_uuid`),
  KEY `session_id` (`session_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `table_session_items_ibfk_1` FOREIGN KEY (`session_id`) REFERENCES `table_sessions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `table_session_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `table_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `table_id` int(11) NOT NULL,
  `table_name` varchar(50) NOT NULL,
  `opened_by` varchar(100) NOT NULL,
  `closed_by` varchar(100) DEFAULT NULL,
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `payment_method` varchar(20) DEFAULT 'Cash',
  `customer_phone` varchar(20) DEFAULT NULL,
  `opened_at` datetime NOT NULL DEFAULT current_timestamp(),
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `table_id` (`table_id`),
  KEY `idx_ts_status` (`status`,`closed_at`),
  CONSTRAINT `table_sessions_ibfk_1` FOREIGN KEY (`table_id`) REFERENCES `tables` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `tables` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `capacity` int(11) NOT NULL DEFAULT 4,
  `status` enum('free','occupied','cleaning') NOT NULL DEFAULT 'free',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL COMMENT 'bcrypt hashed',
  `role` enum('Owner','Manager','Bartender','Kitchen') NOT NULL DEFAULT 'Bartender',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `last_login` datetime DEFAULT NULL,
  `login_attempts` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
CREATE TABLE IF NOT EXISTS `void_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` varchar(30) NOT NULL COMMENT 'sale, expense, kitrev',
  `ref_id` int(11) NOT NULL,
  `label` varchar(255) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `reason` text DEFAULT NULL,
  `requested_by` varchar(100) NOT NULL,
  `status` enum('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  `reviewed_by` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `reviewed_at` datetime DEFAULT NULL,
  `details` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vr_status` (`status`),
  KEY `idx_vr_ref` (`type`,`ref_id`),
  KEY `idx_vr_reviewed` (`reviewed_at`),
  KEY `idx_vr_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- starting rows ----------------------------------------------
INSERT INTO `settings` (`id`, `bar_name`, `location`, `currency`) SELECT 1, 'BarMS Pro', 'Kigali, Rwanda', 'RWF' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `settings`);
INSERT INTO `mgr_permissions` (`id`) SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `mgr_permissions`);
INSERT IGNORE INTO `counters` (`name`, `value`) VALUES ('order', 0), ('takeaway', 0);
