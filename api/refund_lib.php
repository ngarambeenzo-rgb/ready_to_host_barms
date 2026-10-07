<?php
// ============================================================
//  api/refund_lib.php — shared refund logic
//  Used by orders.php (direct refund / refund request) and
//  misc.php (Owner approving a refund request).
//  Callers own the DB transaction.
// ============================================================

const REFUND_METHODS = ['Cash', 'MoMo', 'Card', 'Other'];

/**
 * Check a refund against the order and return the plan.
 * Throws RuntimeException with a message for the user when it is not allowed.
 * @param array $lines [['orderItemId'=>, 'qty'=>, 'restock'=>bool], ...]
 */
function planRefund(PDO $db, int $orderId, array $lines, bool $lock = false): array {
    $oStmt = $db->prepare('SELECT * FROM orders WHERE id = ? LIMIT 1' . ($lock ? ' FOR UPDATE' : ''));
    $oStmt->execute([$orderId]);
    $order = $oStmt->fetch();
    if (!$order) throw new RuntimeException('Order not found');
    if ($order['status'] !== 'paid' || (int)$order['voided']) throw new RuntimeException('Only paid orders can be refunded');

    $itemStmt = $db->prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ? LIMIT 1');
    $doneStmt = $db->prepare('SELECT COALESCE(SUM(ri.qty),0) FROM order_refund_items ri JOIN order_refunds r ON r.id = ri.refund_id WHERE ri.order_item_id = ?');
    $plan = []; $amount = 0.0;
    foreach ($lines as $line) {
        $qty = (int)($line['qty'] ?? 0);
        if ($qty <= 0) continue;
        $itemStmt->execute([(int)($line['orderItemId'] ?? 0), $orderId]);
        $item = $itemStmt->fetch();
        if (!$item) throw new RuntimeException('Item not found on this order');
        $doneStmt->execute([$item['id']]);
        $left = (int)$item['qty'] - (int)$doneStmt->fetchColumn();
        if ($qty > $left) throw new RuntimeException("Only $left x {$item['product_name']} can still be refunded");
        $lineTotal = round($qty * (float)$item['unit_price'], 2);
        $amount += $lineTotal;
        $plan[] = ['item' => $item, 'qty' => $qty, 'total' => $lineTotal, 'restock' => !empty($line['restock'])];
    }
    if (!$plan) throw new RuntimeException('Choose at least one item to refund');
    // with a discount the customer paid less than the item prices: never give back more than was paid
    $paid = (float)$order['total'] - (float)($order['discount'] ?? 0);
    $already = (float)rpRefundedSoFar($db, (int)$order['id']);
    if ($amount > $paid - $already + 0.001) {
        throw new RuntimeException('This refund (RWF ' . number_format($amount) . ') is more than what is left of the amount paid (RWF ' . number_format(max(0, $paid - $already)) . ')' . ((float)($order['discount'] ?? 0) > 0 ? ' because a discount was given' : ''));
    }
    return ['order' => $order, 'lines' => $plan, 'amount' => round($amount, 2)];
}

function rpRefundedSoFar(PDO $db, int $orderId): float {
    $st = $db->prepare('SELECT COALESCE(SUM(amount),0) FROM order_refunds WHERE order_id = ?');
    $st->execute([$orderId]);
    return (float)$st->fetchColumn();
}

// Short text like "2x Primus (back in stock), 1x Brochettes"
function describeRefundPlan(array $plan): string {
    return implode(', ', array_map(fn($p) => "{$p['qty']}x {$p['item']['product_name']}" . ($p['restock'] ? ' (back in stock)' : ''), $plan['lines']));
}

/** Record the refund and put sealed bar items back in stock. Returns [refundId, amount]. */
function performRefund(PDO $db, array $plan, string $reason, string $method, string $byName, string $date): array {
    $order = $plan['order'];
    if (!in_array($method, REFUND_METHODS, true)) $method = 'Other';

    $db->prepare('INSERT INTO order_refunds (order_id, order_number, amount, reason, method, refund_date, refunded_by, shift_id) VALUES (?,?,?,?,?,?,?,?)')
       ->execute([$order['id'], $order['order_number'], $plan['amount'], $reason, $method, $date, $byName, currentShiftId()]);
    $refundId = (int)$db->lastInsertId();

    foreach ($plan['lines'] as $p) {
        $item = $p['item'];
        $sourceType = $item['source_type'] ?? 'bar';
        $restocked = 0; $restockCost = 0.0;
        // Only sealed direct bar items can go back on the shelf; food and cocktails are consumed
        if ($p['restock'] && $sourceType === 'bar' && (int)$item['source_id'] > 0) {
            $biStmt = $db->prepare("SELECT * FROM bar_items WHERE id = ? AND type = 'direct' LIMIT 1");
            $biStmt->execute([(int)$item['source_id']]);
            if ($bi = $biStmt->fetch()) {
                $restocked = 1;
                $restockCost = round($p['qty'] * (float)$bi['cost_price'], 2);
                $db->prepare('UPDATE bar_items SET stock = stock + ? WHERE id = ?')->execute([$p['qty'], $bi['id']]);
                $db->prepare('INSERT INTO bar_movements (item_name, item_id, qty_change, type, reason, unit, order_number, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
                   ->execute([$bi['name'], $bi['id'], $p['qty'], 'refund', "Refund on order {$order['order_number']}: $reason", 'pcs', $order['order_number'], $bi['cost_price'], $restockCost, $byName]);
            }
        }
        $db->prepare('INSERT INTO order_refund_items (refund_id, order_item_id, product_name, source_type, qty, unit_price, total, restocked, restock_cost) VALUES (?,?,?,?,?,?,?,?,?)')
           ->execute([$refundId, $item['id'], $item['product_name'], $sourceType, $p['qty'], $item['unit_price'], $p['total'], $restocked, $restockCost]);
    }

    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['REFUND', "Refunded RWF {$plan['amount']} on order {$order['order_number']} via $method: $reason", $byName]);
    return [$refundId, $plan['amount']];
}
