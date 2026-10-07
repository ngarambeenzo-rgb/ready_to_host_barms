-- Purchase history shared by legacy products, bar items, and ingredients.
-- Safe to run repeatedly; does not modify or infer historical purchase costs.

CREATE TABLE IF NOT EXISTS `inventory_purchases` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `inventory_type` VARCHAR(32) NOT NULL,
  `inventory_id` INT NOT NULL,
  `item_name` VARCHAR(150) NOT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `unit` VARCHAR(30) NOT NULL DEFAULT '',
  `unit_cost` DECIMAL(14,2) NOT NULL,
  `total_cost` DECIMAL(14,2) NOT NULL,
  `supplier` VARCHAR(150) NULL,
  `reference` VARCHAR(100) NULL,
  `purchase_date` DATE NOT NULL,
  `recorded_by` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_inventory_purchases_date` (`purchase_date`),
  KEY `idx_inventory_purchases_item` (`inventory_type`, `inventory_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `stock_movements`
  ADD COLUMN IF NOT EXISTS `supplier` VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS `reference` VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS `cost_per_unit` DECIMAL(14,2) NULL,
  ADD COLUMN IF NOT EXISTS `total_cost` DECIMAL(14,2) NULL DEFAULT 0;

ALTER TABLE `bar_movements`
  ADD COLUMN IF NOT EXISTS `supplier` VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS `reference` VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS `unit_cost` DECIMAL(14,2) NULL,
  ADD COLUMN IF NOT EXISTS `total_cost` DECIMAL(14,2) NULL DEFAULT 0;

ALTER TABLE `kitchen_stock_movements`
  ADD COLUMN IF NOT EXISTS `supplier` VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS `reference` VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS `unit_cost` DECIMAL(14,2) NULL,
  ADD COLUMN IF NOT EXISTS `total_cost` DECIMAL(14,2) NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `purchase_date` DATE NULL;
