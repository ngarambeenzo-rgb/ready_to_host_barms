-- Add order and kitchen-queue tables required by the current BarMS APIs.
-- Safe to run repeatedly; preserves any existing rows.

CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(32) NOT NULL,
  `type` VARCHAR(20) NOT NULL DEFAULT 'dinein',
  `table_id` INT NOT NULL DEFAULT 0,
  `table_name` VARCHAR(100) NOT NULL DEFAULT '',
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `total` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `note` TEXT,
  `created_by` VARCHAR(100) NOT NULL,
  `validated_by` VARCHAR(100),
  `validated_at` DATETIME NULL,
  `payment_method` VARCHAR(30),
  `customer_phone` VARCHAR(30),
  `paid_by` VARCHAR(100),
  `paid_at` DATETIME NULL,
  `voided` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_orders_order_number` (`order_number`),
  KEY `idx_orders_table_status` (`table_id`, `status`),
  KEY `idx_orders_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `qty` INT NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `source_type` VARCHAR(20) NOT NULL DEFAULT 'bar',
  `source_id` INT NOT NULL DEFAULT 0,
  `category` VARCHAR(50) NOT NULL DEFAULT 'Drink',
  `client_uuid` CHAR(36) NULL,
  `added_by` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_order_items_order` (`order_id`),
  UNIQUE KEY `uq_order_items_client_uuid` (`client_uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `order_number` VARCHAR(32) NOT NULL,
  `table_name` VARCHAR(100) NOT NULL DEFAULT '',
  `customer_note` TEXT,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `estimated_minutes` INT NOT NULL DEFAULT 10,
  `accepted_at` DATETIME NULL,
  `accepted_by` VARCHAR(100),
  `preparing_at` DATETIME NULL,
  `ready_at` DATETIME NULL,
  `served_at` DATETIME NULL,
  `served_by` VARCHAR(100),
  `reject_reason` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_kitchen_orders_status_created` (`status`, `created_at`),
  KEY `idx_kitchen_orders_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `kitchen_order_id` INT NOT NULL,
  `menu_item_id` INT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `qty` INT NOT NULL DEFAULT 1,
  `prep_minutes` INT NOT NULL DEFAULT 10,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_kitchen_order_items_order` (`kitchen_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_prep_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `menu_item_id` INT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `actual_minutes` DECIMAL(8,2) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_kitchen_prep_history_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `bar_recipes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `bar_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `cost_price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `type` VARCHAR(20) NOT NULL DEFAULT 'direct',
  `stock` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `min_stock` DECIMAL(12,2) NOT NULL DEFAULT 5,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `recipe_id` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_bar_items_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `bar_ingredients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `unit` VARCHAR(30) NOT NULL DEFAULT '',
  `cost_per_unit` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `min_stock` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `bar_recipe_ingredients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `recipe_id` INT NOT NULL,
  `ingredient_id` INT NOT NULL,
  `qty` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `unit` VARCHAR(30) NOT NULL DEFAULT '',
  KEY `idx_bar_recipe_ingredients_recipe` (`recipe_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `bar_movements` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `item_name` VARCHAR(150) NOT NULL,
  `item_id` INT NULL,
  `ingredient_id` INT NULL,
  `qty_change` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `type` VARCHAR(30) NOT NULL,
  `reason` VARCHAR(255),
  `unit` VARCHAR(30),
  `order_number` VARCHAR(32),
  `done_by` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_bar_movements_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `bar_sales` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `qty` INT NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `sold_by` VARCHAR(100) NOT NULL,
  `order_id` INT NOT NULL,
  `order_number` VARCHAR(32) NOT NULL,
  `sale_date` DATE NOT NULL,
  `sale_time` TIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_bar_sales_date` (`sale_date`),
  KEY `idx_bar_sales_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_recipes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `menu_item_id` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_menu` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `category` VARCHAR(50) NOT NULL DEFAULT 'Food',
  `price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `description` VARCHAR(255),
  `recipe_id` INT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `prep_minutes` INT NOT NULL DEFAULT 10,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_kitchen_menu_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_ingredients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `unit` VARCHAR(30) NOT NULL DEFAULT '',
  `cost_per_unit` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `min_stock` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `recipe_ingredients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `recipe_id` INT NOT NULL,
  `ingredient_id` INT NOT NULL,
  `qty` DECIMAL(12,3) NOT NULL DEFAULT 0,
  KEY `idx_recipe_ingredients_recipe` (`recipe_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_sales` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NULL,
  `product_name` VARCHAR(150) NOT NULL,
  `qty` INT NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `sold_by` VARCHAR(100) NOT NULL,
  `order_id` INT NOT NULL,
  `sale_date` DATE NOT NULL,
  `sale_time` TIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_kitchen_sales_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_deductions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `ingredient_id` INT NOT NULL,
  `qty` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `cost` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_kitchen_deductions_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `kitchen_stock_movements` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `ingredient_id` INT NOT NULL,
  `qty` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `type` VARCHAR(30) NOT NULL,
  `reason` VARCHAR(255),
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `done_by` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_kitchen_stock_movements_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `kitchen_revenue`
  MODIFY COLUMN `amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `product_id` INT NULL,
  ADD COLUMN IF NOT EXISTS `product_name` VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS `qty` INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS `unit_price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `total` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `sold_by` VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS `order_id` INT NULL,
  ADD COLUMN IF NOT EXISTS `sale_date` DATE NULL,
  ADD COLUMN IF NOT EXISTS `sale_time` TIME NULL;

INSERT INTO `bar_items` (`name`, `price`, `cost_price`, `type`, `stock`, `min_stock`, `active`)
SELECT p.`name`, p.`sell_price`, p.`cost_price`, 'direct', p.`stock`, p.`alert_level`, p.`active`
FROM `products` p
WHERE LOWER(p.`category`) NOT IN ('food', 'kitchen')
  AND NOT EXISTS (SELECT 1 FROM `bar_items` bi WHERE bi.`name` = p.`name`);

INSERT INTO `kitchen_menu` (`name`, `category`, `price`, `status`)
SELECT p.`name`, p.`category`, p.`sell_price`, 'active'
FROM `products` p
WHERE LOWER(p.`category`) IN ('food', 'kitchen')
  AND NOT EXISTS (SELECT 1 FROM `kitchen_menu` km WHERE km.`name` = p.`name`);

ALTER TABLE `tables`
  MODIFY COLUMN `status` ENUM('free','occupied','cleaning') NOT NULL DEFAULT 'free';
