-- ============================================================
--  BarMS — Kitchen sales fix (2026-10-02)
--  Orders used to write each kitchen item TWICE into kitchen_revenue
--  (columns the reports never read), so food sold through orders was
--  missing from reports. This rebuilds those sales once, from the
--  order lines, into kitchen_sales and removes the duplicates.
--  Safe to run more than once.
-- ============================================================

INSERT INTO kitchen_sales (product_id, product_name, qty, unit_price, total, sold_by, order_id, sale_date, sale_time, created_at)
SELECT oi.product_id, oi.product_name, oi.qty, oi.unit_price, oi.total,
       COALESCE(o.validated_by, ''), o.id,
       COALESCE(kr.sale_date, DATE(o.validated_at)), COALESCE(kr.sale_time, TIME(o.validated_at)),
       COALESCE(o.validated_at, NOW())
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN (SELECT order_id, MIN(sale_date) AS sale_date, MIN(sale_time) AS sale_time
           FROM kitchen_revenue WHERE order_id IS NOT NULL GROUP BY order_id) kr ON kr.order_id = o.id
WHERE (oi.source_type = 'kitchen' OR LOWER(oi.category) = 'kitchen')
  AND o.status IN ('validated', 'paid')
  AND o.voided = 0
  AND NOT EXISTS (SELECT 1 FROM kitchen_sales ks WHERE ks.order_id = o.id);

DELETE FROM kitchen_revenue WHERE order_id IS NOT NULL;
