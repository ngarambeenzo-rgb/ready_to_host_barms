<?php
// ============================================================
//  api/discount_lib.php — shared discount rules (used by discounts.php and orders.php pay)
// ============================================================

function bartenderCanDiscount(PDO $db): bool {
    try { return (bool)$db->query('SELECT bartender_can_discount FROM settings LIMIT 1')->fetchColumn(); }
    catch (Exception $e) { return false; }
}

// Owner always; managers with canGiveDiscounts; bartenders only when the Owner switched it on
function canApplyDiscounts(PDO $db, array $sess): bool {
    $role = $sess['role'] ?? '';
    if ($role === 'Owner') return true;
    if ($role === 'Manager') return hasPerm('canGiveDiscounts');
    if ($role === 'Bartender') return bartenderCanDiscount($db);
    return false;
}

// Active rules that match this order's items, each with the money it takes off.
// One rule per item line: if several match the same item, the largest wins.
function discountOptionsForOrder(PDO $db, int $orderId): array {
    if (!$orderId) return [];
    $items = $db->prepare('SELECT id, source_type, source_id, product_name, qty, unit_price, total FROM order_items WHERE order_id = ?');
    $items->execute([$orderId]);
    $items = $items->fetchAll();
    if (!$items) return [];
    $rules = $db->query('SELECT * FROM discount_rules WHERE active = 1')->fetchAll();
    $out = [];
    foreach ($rules as $r) {
        $amount = 0; $lines = [];
        foreach ($items as $it) {
            $type = ($it['source_type'] === 'kitchen') ? 'kitchen' : 'bar';
            if ($type !== $r['source_type'] || (int)$it['source_id'] !== (int)$r['source_id']) continue;
            $lineTotal = (float)$it['total'];
            $off = $r['kind'] === 'percent'
                ? round($lineTotal * (float)$r['value'] / 100, 2)
                : min($lineTotal, round((float)$r['value'] * (float)$it['qty'], 2));
            if ($off <= 0) continue;
            $amount += $off; $lines[] = (int)$it['id'];
        }
        if ($amount > 0) $out[] = ['id' => (int)$r['id'], 'name' => $r['name'], 'kind' => $r['kind'], 'value' => (float)$r['value'],
                                   'amount' => round($amount, 2), 'lines' => $lines, 'item' => $items[0]['product_name'] ?? ''];
    }
    // keep only the best rule for each order line
    usort($out, fn($a, $b) => $b['amount'] <=> $a['amount']);
    $used = []; $final = [];
    foreach ($out as $o) {
        if (array_intersect($o['lines'], $used)) continue;
        $used = array_merge($used, $o['lines']);
        $final[] = $o;
    }
    return $final;
}

// Server-side total for the rule ids the cashier ticked (never trusts a client amount)
function discountFromRules(PDO $db, int $orderId, array $ruleIds): array {
    $ruleIds = array_map('intval', $ruleIds);
    $total = 0; $names = [];
    foreach (discountOptionsForOrder($db, $orderId) as $o) {
        if (!in_array($o['id'], $ruleIds, true)) continue;
        $total += $o['amount']; $names[] = $o['name'];
    }
    return [round($total, 2), $names];
}
