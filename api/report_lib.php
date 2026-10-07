<?php
// ============================================================
//  api/report_lib.php — Advanced Reports calculation layer
//
//  Every Advanced Reports screen, export and test uses these
//  functions, so a figure is calculated in exactly one place.
//
//  Rules followed throughout:
//   • Revenue is recognised on the sale date; cash on the payment date.
//   • Refunds reduce revenue on the refund date.
//   • Cost of goods sold = cost of what was actually sold or consumed,
//     never the value of purchases.
//   • Purchases of stock are not operating expenses.
//   • Potential profit on remaining stock is shown separately and is
//     never added to earned profit.
//   • A figure BarMS does not record is returned as null with a reason,
//     never as an invented number.
// ============================================================

const RP_NOT_RECORDED = [
    'historicalCost'   => 'Stock values for past dates use today\'s average cost, because BarMS keeps only the current average cost.',
    'taxes'            => 'Taxes (VAT, income tax) are not recorded in BarMS, so net operating profit is before tax.',
    'mixedPayments'    => '"Mixed" payments are not split into cash and other methods, so they are not counted as cash in the drawer.',
    'olderRecords'     => 'Records made before stage 2 (2 Oct 2026) have no discount, shift, expense payment method or supplier payment details.',
];

// ── small helpers ─────────────────────────────────────────────
function rpRows(PDO $db, string $sql, array $params = []): array {
    $st = $db->prepare($sql);
    $st->execute($params);
    return $st->fetchAll(PDO::FETCH_ASSOC);
}
function rpVal(PDO $db, string $sql, array $params = []) {
    $st = $db->prepare($sql);
    $st->execute($params);
    return $st->fetchColumn();
}
function rpMoney($v): float { return round((float)$v, 2); }
function rpQty($v): float   { return round((float)$v, 3); }
function rpPct($part, $whole): ?float {
    return (float)$whole != 0.0 ? round((float)$part / (float)$whole * 100, 1) : null;
}
function rpTableExists(PDO $db, string $table): bool {
    static $cache = [];
    if (!isset($cache[$table])) {
        $cache[$table] = (bool)rpVal($db, 'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [method_exists($db, 'tbl') ? $db->tbl($table) : $table]);
    }
    return $cache[$table];
}

// ── periods ───────────────────────────────────────────────────
/**
 * Resolve a preset or custom range into inclusive dates, plus the
 * previous period of the same kind (used for comparisons).
 */
function rpPeriod(string $preset, ?string $from = null, ?string $to = null, ?string $today = null): array {
    $t = new DateTimeImmutable($today ?: date('Y-m-d'));
    $valid = fn($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && checkdate((int)substr($d, 5, 2), (int)substr($d, 8, 2), (int)substr($d, 0, 4));
    switch ($preset) {
        case 'yesterday': $f = $e = $t->modify('-1 day'); $label = 'Yesterday'; break;
        case 'this_week': $f = $t->modify('monday this week'); $e = $t; $label = 'This week'; break;
        case 'last_week': $f = $t->modify('monday last week'); $e = $f->modify('+6 days'); $label = 'Last week'; break;
        case 'this_month': $f = $t->modify('first day of this month'); $e = $t; $label = 'This month'; break;
        case 'last_month': $f = $t->modify('first day of last month'); $e = $t->modify('last day of last month'); $label = 'Last month'; break;
        case 'custom':
            if (!$valid($from) || !$valid($to)) throw new InvalidArgumentException('Enter a valid start and end date');
            $f = new DateTimeImmutable($from); $e = new DateTimeImmutable($to);
            if ($e < $f) [$f, $e] = [$e, $f];
            $label = $f->format('Y-m-d') . ' → ' . $e->format('Y-m-d');
            break;
        default: $f = $e = $t; $label = 'Today'; $preset = 'today';
    }
    // previous period: same length, immediately before (calendar months for month presets)
    if ($preset === 'this_month' || $preset === 'last_month') {
        $pf = $f->modify('first day of last month');
        $pe = $preset === 'this_month' ? min($pf->modify('+' . ((int)$e->format('j') - 1) . ' days'), $pf->modify('last day of this month')) : $pf->modify('last day of this month');
    } else {
        $days = (int)$f->diff($e)->days + 1;
        $pe = $f->modify('-1 day');
        $pf = $pe->modify('-' . ($days - 1) . ' days');
    }
    return [
        'preset' => $preset, 'label' => $label,
        'from' => $f->format('Y-m-d'), 'to' => $e->format('Y-m-d'),
        'prevFrom' => $pf->format('Y-m-d'), 'prevTo' => $pe->format('Y-m-d'),
        'days' => (int)$f->diff($e)->days + 1,
    ];
}
function rpStart(array $P): string { return $P['from'] . ' 00:00:00'; }
function rpEnd(array $P): string   { return $P['to'] . ' 23:59:59'; }
function rpPrev(array $P): array    { return ['from' => $P['prevFrom'], 'to' => $P['prevTo']] + $P; }

// ── catalogues (current cost and price of everything sellable) ─
function rpBarItems(PDO $db): array {
    $rows = rpRows($db, "SELECT bi.*, COALESCE((SELECT SUM(bri.qty * bing.cost_per_unit) FROM bar_recipe_ingredients bri
                JOIN bar_ingredients bing ON bing.id = bri.ingredient_id WHERE bri.recipe_id = bi.recipe_id), 0) AS recipe_cost
            FROM bar_items bi ORDER BY bi.name");
    $out = [];
    foreach ($rows as $r) {
        $isRecipe = $r['type'] === 'recipe';
        $out[(int)$r['id']] = [
            'id' => (int)$r['id'], 'name' => $r['name'], 'type' => $r['type'], 'active' => (int)$r['active'],
            'price' => (float)$r['price'], 'stock' => (float)$r['stock'], 'minStock' => (float)$r['min_stock'],
            'unitCost' => $isRecipe ? (float)$r['recipe_cost'] : (float)$r['cost_price'],
            'unit' => 'pcs', 'createdAt' => $r['created_at'],
        ];
    }
    return $out;
}
function rpKitchenMenu(PDO $db): array {
    $rows = rpRows($db, "SELECT km.*, COALESCE((SELECT SUM(ri.qty * ki.cost_per_unit) FROM recipe_ingredients ri
                JOIN kitchen_ingredients ki ON ki.id = ri.ingredient_id WHERE ri.recipe_id = km.recipe_id), 0) AS recipe_cost
            FROM kitchen_menu km ORDER BY km.name");
    $out = [];
    foreach ($rows as $r) {
        $out[(int)$r['id']] = [
            'id' => (int)$r['id'], 'name' => $r['name'], 'category' => $r['category'] ?: 'Kitchen',
            'price' => (float)$r['price'], 'recipeId' => $r['recipe_id'] ? (int)$r['recipe_id'] : null,
            'unitCost' => $r['recipe_id'] ? (float)$r['recipe_cost'] : null,
        ];
    }
    return $out;
}

// ── sales lines ───────────────────────────────────────────────
/**
 * Every sold line in the period, from all sales tables, without double counting:
 *  bar_sales (orders), kitchen_sales (orders), sales (old Quick Sale system),
 *  kitchen_revenue (manually typed kitchen income, no items).
 * cost = qty × cost recorded at the sale; if not recorded, today's cost (estimated).
 */
function rpSalesLines(PDO $db, array $P, string $scope = 'all', ?string $staff = null): array {
    $lines = [];
    $range = [$P['from'], $P['to']];
    if ($scope !== 'kitchen') {
        $bar = rpBarItems($db);
        foreach (rpRows($db, 'SELECT * FROM bar_sales WHERE sale_date BETWEEN ? AND ? ORDER BY sale_date, sale_time, id', $range) as $r) {
            $est = $bar[(int)$r['product_id']]['unitCost'] ?? null;
            $lines[] = rpLine('bar', $r, $r['unit_cost'], $est, $r['order_number']);
        }
        foreach (rpRows($db, 'SELECT s.*, p.cost_price FROM sales s LEFT JOIN products p ON p.id = s.product_id WHERE s.voided = 0 AND s.sale_date BETWEEN ? AND ?', $range) as $r) {
            $lines[] = rpLine('bar', $r, null, $r['cost_price'] !== null ? (float)$r['cost_price'] : null, 'Quick sale', true);
        }
    }
    if ($scope !== 'bar') {
        $menu = rpKitchenMenu($db);
        foreach (rpRows($db, 'SELECT ks.*, o.order_number FROM kitchen_sales ks LEFT JOIN orders o ON o.id = ks.order_id WHERE ks.sale_date BETWEEN ? AND ? ORDER BY ks.sale_date, ks.sale_time, ks.id', $range) as $r) {
            $est = $menu[(int)$r['product_id']]['unitCost'] ?? null;
            $lines[] = rpLine('kitchen', $r, $r['unit_cost'], $est, $r['order_number']);
        }
        foreach (rpRows($db, 'SELECT * FROM kitchen_revenue WHERE order_id IS NULL AND amount > 0 AND revenue_date BETWEEN ? AND ?', $range) as $r) {
            $lines[] = [
                'source' => 'kitchen', 'date' => $r['revenue_date'], 'time' => '', 'order' => 'Manual entry',
                'productId' => null, 'name' => 'Kitchen revenue (typed manually' . ($r['note'] ? ': ' . $r['note'] : '') . ')',
                'qty' => 0.0, 'unitPrice' => 0.0, 'total' => rpMoney($r['amount']), 'staff' => $r['recorded_by'],
                'unitCost' => null, 'cost' => null, 'costStatus' => 'unknown', 'legacy' => true,
            ];
        }
    }
    if ($staff !== null && $staff !== '') {
        $lines = array_values(array_filter($lines, fn($l) => $l['staff'] === $staff));
    }
    return $lines;
}
function rpLine(string $source, array $r, $recordedCost, $estimatedCost, ?string $order, bool $legacy = false): array {
    $qty = (float)$r['qty'];
    if ($recordedCost !== null) { $unit = (float)$recordedCost; $status = 'recorded'; }
    elseif ($estimatedCost !== null && (float)$estimatedCost > 0) { $unit = (float)$estimatedCost; $status = 'estimated'; }
    else { $unit = null; $status = 'unknown'; }
    return [
        'source' => $source, 'date' => $r['sale_date'], 'time' => substr((string)($r['sale_time'] ?? ''), 0, 5),
        'order' => $order ?: '', 'productId' => (int)$r['product_id'], 'name' => $r['product_name'],
        'qty' => $qty, 'unitPrice' => (float)$r['unit_price'], 'total' => rpMoney($r['total']),
        'staff' => $r['sold_by'] ?? '', 'unitCost' => $unit, 'cost' => $unit === null ? null : rpMoney($qty * $unit),
        'costStatus' => $status, 'legacy' => $legacy,
    ];
}

// ── refunds and voids ─────────────────────────────────────────
function rpRefundLines(PDO $db, array $P, string $scope = 'all'): array {
    if (!rpTableExists($db, 'order_refunds')) return [];
    $sql = 'SELECT r.id AS refund_id, r.order_number, r.reason, r.method, r.refund_date, r.refunded_by, ri.*
            FROM order_refunds r JOIN order_refund_items ri ON ri.refund_id = r.id WHERE r.refund_date BETWEEN ? AND ?';
    $out = [];
    foreach (rpRows($db, $sql, [$P['from'], $P['to']]) as $r) {
        $src = $r['source_type'] === 'kitchen' ? 'kitchen' : 'bar';
        if ($scope !== 'all' && $scope !== $src) continue;
        $out[] = [
            'refundId' => (int)$r['refund_id'], 'date' => $r['refund_date'], 'order' => $r['order_number'], 'source' => $src,
            'name' => $r['product_name'], 'qty' => (float)$r['qty'], 'total' => rpMoney($r['total']),
            'restocked' => (bool)$r['restocked'], 'restockCost' => rpMoney($r['restock_cost']),
            'method' => $r['method'], 'reason' => $r['reason'], 'by' => $r['refunded_by'],
        ];
    }
    return $out;
}
function rpVoids(PDO $db, array $P): array {
    return array_map(fn($r) => [
        'id' => (int)$r['id'], 'type' => $r['type'], 'label' => $r['label'], 'amount' => rpMoney($r['amount']),
        'reason' => $r['reason'], 'requestedBy' => $r['requested_by'], 'reviewedBy' => $r['reviewed_by'],
        'date' => substr((string)$r['reviewed_at'], 0, 10),
    ], rpRows($db, "SELECT * FROM void_requests WHERE status = 'Approved' AND type <> 'refund' AND reviewed_at >= ? AND reviewed_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY reviewed_at", [$P['from'], $P['to']]));
}

// ── discounts (counted on the payment date, split by bar/kitchen share of the order) ─
function rpDiscountLines(PDO $db, array $P, string $scope = 'all'): array {
    $out = [];
    foreach (rpRows($db, "SELECT o.id, o.order_number, o.total, o.discount, o.discount_reason, o.paid_by, DATE(o.paid_at) AS d,
                COALESCE((SELECT SUM(oi.total) FROM order_items oi WHERE oi.order_id = o.id AND (oi.source_type = 'kitchen' OR LOWER(oi.category) = 'kitchen')), 0) AS kitchen_total
            FROM orders o WHERE o.status = 'paid' AND o.voided = 0 AND o.discount > 0 AND o.paid_at >= ? AND o.paid_at < DATE_ADD(?, INTERVAL 1 DAY)", [$P['from'], $P['to']]) as $r) {
        $total = (float)$r['total']; $disc = (float)$r['discount'];
        $kShare = $total > 0 ? (float)$r['kitchen_total'] / $total : 0;
        $part = $scope === 'all' ? $disc : ($scope === 'kitchen' ? $disc * $kShare : $disc * (1 - $kShare));
        if ($part <= 0) continue;
        $out[] = ['date' => $r['d'], 'order' => $r['order_number'], 'orderTotal' => rpMoney($total), 'discount' => rpMoney($part),
                  'barPart' => $scope === 'kitchen' ? 0.0 : rpMoney($disc * (1 - $kShare)), 'kitchenPart' => $scope === 'bar' ? 0.0 : rpMoney($disc * $kShare),
                  'pct' => rpPct($disc, $total), 'reason' => $r['discount_reason'], 'by' => $r['paid_by']];
    }
    return $out;
}

// ── expenses ──────────────────────────────────────────────────
// Expense categories/descriptions that look like stock purchases (possible double count with purchases)
const RP_STOCK_WORDS = '/\b(beer|beers|drink|drinks|crate|crates|stock|primus|mutzig|skol|heineken|fanta|coca|soda|wine|whisky|spirits?|bottles?|meat|flour|rice|vegetables?|ingredients?)\b/i';

function rpExpenseLines(PDO $db, array $P, string $scope = 'all'): array {
    $out = [];
    $range = [$P['from'], $P['to']];
    if ($scope !== 'kitchen') {
        foreach (rpRows($db, 'SELECT * FROM expenses WHERE voided = 0 AND expense_date BETWEEN ? AND ?', $range) as $r) {
            $out[] = ['source' => 'bar', 'kind' => 'operating', 'id' => (int)$r['id'], 'date' => $r['expense_date'], 'category' => $r['category'] ?: 'General',
                      'description' => $r['description'], 'amount' => rpMoney($r['amount']), 'by' => $r['recorded_by'], 'method' => $r['payment_method'] ?? null,
                      'looksLikeStock' => (bool)preg_match(RP_STOCK_WORDS, $r['description'] . ' ' . $r['category'])];
        }
    }
    if ($scope !== 'bar') {
        foreach (rpRows($db, 'SELECT * FROM kitchen_expenses WHERE expense_date BETWEEN ? AND ?', $range) as $r) {
            $out[] = ['source' => 'kitchen', 'kind' => 'operating', 'id' => (int)$r['id'], 'date' => $r['expense_date'], 'category' => $r['category'] ?: 'Kitchen',
                      'description' => $r['description'], 'amount' => rpMoney($r['amount']), 'by' => $r['recorded_by'], 'method' => $r['payment_method'] ?? null,
                      'looksLikeStock' => (bool)preg_match(RP_STOCK_WORDS, $r['description'] . ' ' . $r['category'])];
        }
    }
    // Salaries are a business-wide cost, shown only in the combined view
    if ($scope === 'all') {
        foreach (rpRows($db, 'SELECT * FROM salary_payments WHERE payment_date BETWEEN ? AND ?', $range) as $r) {
            $out[] = ['source' => 'all', 'kind' => 'salary', 'id' => (int)$r['id'], 'date' => $r['payment_date'], 'category' => 'Salaries',
                      'description' => 'Salary — ' . $r['emp_name'], 'amount' => rpMoney($r['gross_amount']), 'by' => '', 'method' => null,
                      'looksLikeStock' => false];
        }
    }
    return $out;
}

// ── purchases ─────────────────────────────────────────────────
const RP_INV_TYPES = ['bar_item' => 'Bar item', 'bar_ingredient' => 'Bar ingredient', 'kitchen_ingredient' => 'Kitchen ingredient', 'product' => 'Old product list'];

function rpPurchaseLines(PDO $db, array $P, string $scope = 'all'): array {
    $types = $scope === 'bar' ? ['bar_item', 'bar_ingredient', 'product'] : ($scope === 'kitchen' ? ['kitchen_ingredient'] : array_keys(RP_INV_TYPES));
    $in = implode(',', array_fill(0, count($types), '?'));
    $rows = rpRows($db, "SELECT * FROM inventory_purchases WHERE purchase_date BETWEEN ? AND ? AND inventory_type IN ($in) ORDER BY purchase_date, id",
                   array_merge([$P['from'], $P['to']], $types));
    return array_map(fn($r) => [
        'id' => (int)$r['id'], 'date' => $r['purchase_date'], 'type' => $r['inventory_type'], 'typeLabel' => RP_INV_TYPES[$r['inventory_type']] ?? $r['inventory_type'],
        'itemId' => (int)$r['inventory_id'], 'name' => $r['item_name'], 'qty' => rpQty($r['quantity']), 'unit' => $r['unit'] ?: 'pcs',
        'unitCost' => rpMoney($r['unit_cost']), 'total' => rpMoney($r['total_cost']), 'supplier' => $r['supplier'] ?: '',
        'reference' => $r['reference'] ?: '', 'by' => $r['recorded_by'], 'recordedAt' => $r['created_at'],
        'amountPaid' => $r['amount_paid'] === null ? null : rpMoney($r['amount_paid']),
        'owed' => $r['amount_paid'] === null ? 0.0 : rpMoney((float)$r['total_cost'] - (float)$r['amount_paid']),
        'paymentMethod' => $r['payment_method'],
        'packs' => $r['pack_qty'] !== null ? rpQty($r['pack_qty']) . ' ' . $r['pack_name'] . ' × ' . (int)$r['units_per_pack'] : null,
    ], $rows);
}

// ── supplier balances (money owed to suppliers, as of now) ────
function rpSupplierBalances(PDO $db): array {
    $s = [];
    foreach (rpRows($db, "SELECT TRIM(supplier) AS name, SUM(total_cost) AS bought,
                SUM(CASE WHEN amount_paid IS NULL THEN total_cost ELSE amount_paid END) AS paid_on_delivery,
                SUM(CASE WHEN amount_paid IS NULL THEN 1 ELSE 0 END) AS untracked, COUNT(*) AS n, MAX(purchase_date) AS last
            FROM inventory_purchases WHERE supplier IS NOT NULL AND TRIM(supplier) <> '' GROUP BY LOWER(TRIM(supplier)), TRIM(supplier)") as $r) {
        $k = strtolower($r['name']);
        $s[$k] ??= ['supplier' => $r['name'], 'bought' => 0.0, 'paidOnDelivery' => 0.0, 'paidLater' => 0.0, 'purchases' => 0, 'untracked' => 0, 'lastPurchase' => null, 'lastPayment' => null];
        $s[$k]['bought'] += (float)$r['bought']; $s[$k]['paidOnDelivery'] += (float)$r['paid_on_delivery'];
        $s[$k]['purchases'] += (int)$r['n']; $s[$k]['untracked'] += (int)$r['untracked'];
        $s[$k]['lastPurchase'] = max($s[$k]['lastPurchase'] ?? '', $r['last']);
    }
    if (rpTableExists($db, 'supplier_payments')) {
        foreach (rpRows($db, 'SELECT TRIM(supplier) AS name, SUM(amount) AS paid, MAX(payment_date) AS last FROM supplier_payments GROUP BY LOWER(TRIM(supplier)), TRIM(supplier)') as $r) {
            $k = strtolower($r['name']);
            $s[$k] ??= ['supplier' => $r['name'], 'bought' => 0.0, 'paidOnDelivery' => 0.0, 'paidLater' => 0.0, 'purchases' => 0, 'untracked' => 0, 'lastPurchase' => null, 'lastPayment' => null];
            $s[$k]['paidLater'] += (float)$r['paid']; $s[$k]['lastPayment'] = $r['last'];
        }
    }
    $out = array_values(array_map(fn($x) => $x + ['balance' => rpMoney($x['bought'] - $x['paidOnDelivery'] - $x['paidLater'])], $s));
    foreach ($out as &$o) foreach (['bought', 'paidOnDelivery', 'paidLater'] as $k) $o[$k] = rpMoney($o[$k]);
    unset($o);
    usort($out, fn($a, $b) => $b['balance'] <=> $a['balance']);
    return $out;
}

// ── collections (money actually received) ────────────────────
function rpCollections(PDO $db, array $P): array {
    $byMethod = [];
    foreach (rpRows($db, "SELECT COALESCE(NULLIF(payment_method,''),'Not recorded') AS m, COUNT(*) AS n, SUM(total - discount) AS t
                          FROM orders WHERE status = 'paid' AND voided = 0 AND paid_at >= ? AND paid_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY m", [$P['from'], $P['to']]) as $r) {
        $byMethod[$r['m']] = ['method' => $r['m'], 'orders' => (int)$r['n'], 'received' => rpMoney($r['t']), 'refunded' => 0.0];
    }
    // old table-session system
    foreach (rpRows($db, "SELECT COALESCE(NULLIF(payment_method,''),'Not recorded') AS m, COUNT(*) AS n, SUM(total) AS t
                          FROM table_sessions WHERE status = 'closed' AND closed_at >= ? AND closed_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY m", [$P['from'], $P['to']]) as $r) {
        $byMethod[$r['m']] ??= ['method' => $r['m'], 'orders' => 0, 'received' => 0.0, 'refunded' => 0.0];
        $byMethod[$r['m']]['orders']   += (int)$r['n'];
        $byMethod[$r['m']]['received'] = rpMoney($byMethod[$r['m']]['received'] + $r['t']);
    }
    if (rpTableExists($db, 'order_refunds')) {
        foreach (rpRows($db, 'SELECT method AS m, SUM(amount) AS t FROM order_refunds WHERE refund_date BETWEEN ? AND ? GROUP BY m', [$P['from'], $P['to']]) as $r) {
            $byMethod[$r['m']] ??= ['method' => $r['m'], 'orders' => 0, 'received' => 0.0, 'refunded' => 0.0];
            $byMethod[$r['m']]['refunded'] = rpMoney($r['t']);
        }
    }
    foreach ($byMethod as &$m) $m['net'] = rpMoney($m['received'] - $m['refunded']);
    unset($m);
    $received = array_sum(array_column($byMethod, 'received'));
    $refunded = array_sum(array_column($byMethod, 'refunded'));
    return ['byMethod' => array_values($byMethod), 'received' => rpMoney($received), 'refunded' => rpMoney($refunded), 'net' => rpMoney($received - $refunded)];
}

// ── shifts: expected cash in the drawer ───────────────────────
const RP_CASH_IN_TYPES  = ['capital', 'loan_in', 'other_in'];
const RP_CASH_OUT_TYPES = ['owner_withdrawal', 'loan_repayment', 'other_out', 'asset_purchase'];
/**
 * Expected cash for one shift, from records linked to that shift:
 *   opening float + cash sales (after discount) + cash debt collections + cash put in
 *   − cash refunds − cash expenses − cash supplier payments − cash taken out
 *   ± transfers between cash and other accounts.
 * "Mixed" payments cannot be split, so they are listed but not counted as cash.
 */
function rpShiftCash(PDO $db, array $shift): array {
    $id = (int)$shift['id'];
    $sum = fn(string $sql) => (float)rpVal($db, $sql, [$id]);
    $b = [
        'openingFloat'    => (float)$shift['opening_float'],
        'cashSales'       => $sum("SELECT COALESCE(SUM(total - discount),0) FROM orders WHERE shift_id = ? AND status = 'paid' AND voided = 0 AND payment_method = 'Cash'"),
        'debtCollections' => $sum("SELECT COALESCE(SUM(amount),0) FROM customer_debts WHERE shift_id = ? AND status = 'Paid' AND paid_method = 'Cash'"),
        'cashIn'          => $sum("SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE shift_id = ? AND voided = 0 AND method = 'Cash' AND type IN ('" . implode("','", RP_CASH_IN_TYPES) . "')")
                           + $sum("SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE shift_id = ? AND voided = 0 AND type = 'transfer' AND to_method = 'Cash'"),
        'refunds'         => $sum("SELECT COALESCE(SUM(amount),0) FROM order_refunds WHERE shift_id = ? AND method = 'Cash'"),
        'expenses'        => $sum("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE shift_id = ? AND voided = 0 AND payment_method = 'Cash'")
                           + $sum("SELECT COALESCE(SUM(amount),0) FROM kitchen_expenses WHERE shift_id = ? AND payment_method = 'Cash'"),
        'supplierPayments'=> $sum("SELECT COALESCE(SUM(amount),0) FROM supplier_payments WHERE shift_id = ? AND method = 'Cash'")
                           + $sum("SELECT COALESCE(SUM(amount_paid),0) FROM inventory_purchases WHERE shift_id = ? AND payment_method = 'Cash'"),
        'cashOut'         => $sum("SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE shift_id = ? AND voided = 0 AND method = 'Cash' AND type IN ('" . implode("','", RP_CASH_OUT_TYPES) . "')")
                           + $sum("SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE shift_id = ? AND voided = 0 AND type = 'transfer' AND method = 'Cash'"),
        'mixedPayments'   => $sum("SELECT COALESCE(SUM(total - discount),0) FROM orders WHERE shift_id = ? AND status = 'paid' AND voided = 0 AND payment_method = 'Mixed'"),
        'otherPayments'   => $sum("SELECT COALESCE(SUM(total - discount),0) FROM orders WHERE shift_id = ? AND status = 'paid' AND voided = 0 AND payment_method NOT IN ('Cash','Mixed')"),
        'orders'          => (int)rpVal($db, "SELECT COUNT(*) FROM orders WHERE shift_id = ? AND status = 'paid' AND voided = 0", [$id]),
    ];
    $expected = $b['openingFloat'] + $b['cashSales'] + $b['debtCollections'] + $b['cashIn']
              - $b['refunds'] - $b['expenses'] - $b['supplierPayments'] - $b['cashOut'];
    foreach ($b as $k => $v) if (is_float($v)) $b[$k] = rpMoney($v);
    $b['expected'] = rpMoney($expected);
    return $b;
}

function rpShifts(PDO $db, array $P): array {
    $out = [];
    foreach (rpRows($db, 'SELECT * FROM shifts WHERE opened_at >= ? AND opened_at < DATE_ADD(?, INTERVAL 1 DAY) OR (status = \'open\' AND opened_at < DATE_ADD(?, INTERVAL 1 DAY)) ORDER BY opened_at DESC', [$P['from'], $P['to'], $P['to']]) as $s) {
        $live = rpShiftCash($db, $s);
        $closed = $s['status'] === 'closed';
        $out[] = [
            'id' => (int)$s['id'], 'user' => $s['user_name'], 'device' => $s['device'], 'status' => $s['status'],
            'openedAt' => $s['opened_at'], 'closedAt' => $s['closed_at'], 'openingFloat' => rpMoney($s['opening_float']),
            // a closed shift keeps the figures fixed at closing time
            'expected' => $closed ? rpMoney($s['expected_cash']) : $live['expected'],
            'counted' => $closed ? rpMoney($s['counted_cash']) : null,
            'difference' => $closed ? rpMoney($s['difference']) : null,
            'note' => $s['close_note'], 'breakdown' => $live,
        ];
    }
    return $out;
}

// ── cash flow: every movement of money in the period, by method ─
function rpCashFlow(PDO $db, array $P): array {
    $rows = [];
    $add = function (string $dir, string $what, ?string $method, $amount) use (&$rows) {
        $amount = (float)$amount;
        if ($amount == 0.0) return;
        $rows[] = ['direction' => $dir, 'what' => $what, 'method' => $method ?: 'Not recorded', 'amount' => rpMoney($amount)];
    };
    $r = [$P['from'], $P['to']];
    foreach (rpCollections($db, $P)['byMethod'] as $m) { $add('in', 'Sales collected', $m['method'], $m['received']); $add('out', 'Refunds paid', $m['method'], $m['refunded']); }
    foreach (rpRows($db, "SELECT paid_method AS m, SUM(amount) AS t FROM customer_debts WHERE status = 'Paid' AND paid_at >= ? AND paid_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY m", $r) as $x) $add('in', 'Customer debts collected', $x['m'], $x['t']);
    foreach (rpRows($db, 'SELECT payment_method AS m, SUM(amount) AS t FROM expenses WHERE voided = 0 AND expense_date BETWEEN ? AND ? GROUP BY m', $r) as $x) $add('out', 'Expenses', $x['m'], $x['t']);
    foreach (rpRows($db, 'SELECT payment_method AS m, SUM(amount) AS t FROM kitchen_expenses WHERE expense_date BETWEEN ? AND ? GROUP BY m', $r) as $x) $add('out', 'Kitchen expenses', $x['m'], $x['t']);
    $add('out', 'Salaries', null, rpVal($db, 'SELECT COALESCE(SUM(net_amount),0) FROM salary_payments WHERE payment_date BETWEEN ? AND ?', $r));
    foreach (rpRows($db, 'SELECT payment_method AS m, SUM(amount_paid) AS t FROM inventory_purchases WHERE amount_paid IS NOT NULL AND purchase_date BETWEEN ? AND ? GROUP BY m', $r) as $x) $add('out', 'Suppliers paid on delivery', $x['m'], $x['t']);
    foreach (rpRows($db, 'SELECT method AS m, SUM(amount) AS t FROM supplier_payments WHERE payment_date BETWEEN ? AND ? GROUP BY m', $r) as $x) $add('out', 'Supplier payments', $x['m'], $x['t']);
    $labels = ['owner_withdrawal' => 'Owner withdrawals', 'capital' => 'Capital put in', 'loan_in' => 'Loans received', 'loan_repayment' => 'Loan repayments', 'other_in' => 'Other money in', 'other_out' => 'Other money out', 'asset_purchase' => 'Equipment bought'];
    foreach (rpRows($db, "SELECT type, method AS m, to_method, SUM(amount) AS t FROM cash_movements WHERE voided = 0 AND movement_date BETWEEN ? AND ? GROUP BY type, method, to_method", $r) as $x) {
        if ($x['type'] === 'opening_balance') continue; // a starting balance, not money moving (Business worth adds it)
        if ($x['type'] === 'transfer') { $add('out', 'Transfer out', $x['m'], $x['t']); $add('in', 'Transfer in', $x['to_method'], $x['t']); }
        else $add(in_array($x['type'], RP_CASH_IN_TYPES, true) ? 'in' : 'out', $labels[$x['type']] ?? $x['type'], $x['m'], $x['t']);
    }
    $byMethod = [];
    foreach ($rows as $x) {
        $byMethod[$x['method']] ??= ['method' => $x['method'], 'in' => 0.0, 'out' => 0.0];
        $byMethod[$x['method']][$x['direction']] += $x['amount'];
    }
    $byMethod = array_values(array_map(fn($m) => ['method' => $m['method'], 'in' => rpMoney($m['in']), 'out' => rpMoney($m['out']), 'net' => rpMoney($m['in'] - $m['out'])], $byMethod));
    $in = array_sum(array_column(array_filter($rows, fn($x) => $x['direction'] === 'in'), 'amount'));
    $out = array_sum(array_column(array_filter($rows, fn($x) => $x['direction'] === 'out'), 'amount'));
    return ['rows' => $rows, 'byMethod' => $byMethod, 'in' => rpMoney($in), 'out' => rpMoney($out), 'net' => rpMoney($in - $out)];
}

// ── stock ledger: opening → movements → closing, per item ─────
/**
 * Rebuild each stock item's quantities for the period from its movement records.
 *   closing (end of period) = current quantity − movements after the period
 *   opening                 = closing − movements inside the period
 *   unexplained             = current quantity − sum of ALL movements ever
 *                             (stock that changed without any movement record)
 * Values use today's average cost (BarMS keeps no cost history).
 */
function rpStockLedger(PDO $db, array $P, string $scope = 'all'): array {
    $items = [];
    $start = rpStart($P); $end = rpEnd($P);

    $bucket = function (string $type, float $q): string {
        switch ($type) {
            case 'purchase': case 'receive': case 'received': return 'purchased';
            case 'sale': return 'sold';
            case 'auto_deduction': return 'usedInRecipes';
            case 'void': case 'void_restore': return 'voidReturned';
            case 'refund': return 'refundReturned';
            case 'breakage': case 'waste': case 'spoilage': case 'expired': case 'damaged': return 'wasted';
            case 'count': return 'countAdjusted';
            default: return 'adjusted';
        }
    };
    $blank = fn() => ['purchased' => 0.0, 'sold' => 0.0, 'usedInRecipes' => 0.0, 'voidReturned' => 0.0, 'refundReturned' => 0.0, 'wasted' => 0.0, 'adjusted' => 0.0, 'countAdjusted' => 0.0];

    $counts = [];
    if (rpTableExists($db, 'stock_counts')) {
        foreach (rpRows($db, 'SELECT sc.area, l.item_id, l.counted, l.variance, sc.count_date, sc.applied FROM stock_count_lines l JOIN stock_counts sc ON sc.id = l.count_id
                WHERE sc.count_date BETWEEN ? AND ? ORDER BY sc.count_date, sc.id', [$P['from'], $P['to']]) as $c) {
            $counts[$c['area'] . ':' . $c['item_id']] = $c; // latest wins
        }
    }
    // $moves: one row per movement type of this item, already summed by the database (rpMoveSums)
    $build = function (string $kind, int $id, string $name, string $unit, float $current, float $unitCost, ?float $price, float $min, array $moves) use ($bucket, $blank, $counts) {
        $after = 0.0; $inPeriod = 0.0; $all = 0.0; $flows = $blank(); $wasteCost = 0.0; $lastMove = null;
        foreach ($moves as $m) {
            $all += (float)$m['all_q'];
            $after += (float)$m['after_q'];
            $q = (float)$m['in_q'];
            $inPeriod += $q;
            $b = $bucket((string)$m['type'], $q);
            // recipes/sales/waste are shown as positive "used" quantities
            $flows[$b] += in_array($b, ['sold', 'usedInRecipes', 'wasted'], true) ? -$q : $q;
            if ($b === 'wasted') $wasteCost += (float)$m['in_cost'] + (float)$m['in_q_nocost'] * $unitCost;
            if ($m['last_at'] !== null) $lastMove = max($lastMove ?? '', $m['last_at']);
        }
        $closing = $current - $after;
        $opening = $closing - $inPeriod;
        $unexplained = $current - $all;
        return [
            'kind' => $kind, 'id' => $id, 'name' => $name, 'unit' => $unit,
            'opening' => rpQty($opening), 'flows' => array_map('rpQty', $flows), 'expectedClosing' => rpQty($closing),
            'physicalCount' => isset($counts["$kind:$id"]) ? rpQty($counts["$kind:$id"]['counted']) : null,
            'variance' => isset($counts["$kind:$id"]) ? rpQty($counts["$kind:$id"]['variance']) : null,
            'varianceValue' => isset($counts["$kind:$id"]) ? rpMoney((float)$counts["$kind:$id"]['variance'] * $unitCost) : null,
            'countDate' => $counts["$kind:$id"]['count_date'] ?? null, 'countApplied' => isset($counts["$kind:$id"]) ? (bool)$counts["$kind:$id"]['applied'] : null,
            'current' => rpQty($current),
            'unitCost' => rpMoney($unitCost), 'openingValue' => rpMoney(max(0, $opening) * $unitCost),
            'closingValue' => rpMoney(max(0, $closing) * $unitCost), 'price' => $price,
            'sellValue' => $price !== null ? rpMoney(max(0, $closing) * $price) : null,
            'potentialProfit' => $price !== null ? rpMoney(max(0, $closing) * ($price - $unitCost)) : null,
            'wastedValue' => rpMoney($wasteCost), 'minStock' => $min,
            'status' => $current < 0 ? 'negative' : ($current <= 0 ? 'out' : ($current <= $min ? 'low' : 'ok')),
            'missingCost' => $current > 0 && $unitCost <= 0,
            'unexplained' => rpQty($unexplained), 'unexplainedValue' => rpMoney($unexplained * $unitCost),
            'lastMovement' => $lastMove,
        ];
    };

    if ($scope !== 'kitchen') {
        $moves = [];
        foreach (rpMoveSums($db, 'bar_movements', 'item_id, ingredient_id', 'qty_change', $start, $end) as $m) {
            if ($m['item_id']) $moves['bi' . $m['item_id']][] = $m;
            elseif ($m['ingredient_id']) $moves['bg' . $m['ingredient_id']][] = $m;
        }
        foreach (rpBarItems($db) as $bi) {
            if ($bi['type'] !== 'direct') continue; // recipe items hold no stock of their own
            if (!$bi['active'] && $bi['stock'] == 0.0) continue;
            $items[] = $build('bar_item', $bi['id'], $bi['name'], 'pcs', $bi['stock'], $bi['unitCost'], $bi['price'], $bi['minStock'], $moves['bi' . $bi['id']] ?? []);
        }
        foreach (rpRows($db, 'SELECT * FROM bar_ingredients ORDER BY name') as $g) {
            $items[] = $build('bar_ingredient', (int)$g['id'], $g['name'], $g['unit'] ?: 'units', (float)$g['quantity'], (float)$g['cost_per_unit'], null, (float)$g['min_stock'], $moves['bg' . $g['id']] ?? []);
        }
    }
    if ($scope !== 'bar') {
        $moves = [];
        foreach (rpMoveSums($db, 'kitchen_stock_movements', 'ingredient_id', 'qty', $start, $end) as $m) {
            $moves[(int)$m['ingredient_id']][] = $m;
        }
        foreach (rpRows($db, 'SELECT * FROM kitchen_ingredients ORDER BY name') as $k) {
            $items[] = $build('kitchen_ingredient', (int)$k['id'], $k['name'], $k['unit'] ?: 'units', (float)$k['quantity'], (float)$k['cost_per_unit'], null, (float)$k['min_stock'], $moves[(int)$k['id']] ?? []);
        }
    }
    return $items;
}

/**
 * Movements summed per item and type, split into: all time, after the period, inside the period.
 * in_cost = recorded cost of the movements inside the period; in_q_nocost = their quantity where no cost was recorded.
 */
function rpMoveSums(PDO $db, string $table, string $keys, string $qtyCol, string $start, string $end): array {
    // the same answer is reused within one request (a report asks for it several times);
    // the newest movement id is part of the key, so a new movement is always seen
    static $cache = [];
    $ck = "$table|$start|$end|" . rpVal($db, "SELECT COALESCE(MAX(id), 0) FROM $table");
    if (isset($cache[$ck])) return $cache[$ck];
    $keyCols = array_map('trim', explode(',', $keys));
    $rows = [];
    // 1. all-time totals per item and type (read from the index idx_*_ledger, not the table)
    foreach (rpRows($db, "SELECT $keys, type, SUM($qtyCol) AS all_q, MAX(created_at) AS last_at FROM $table GROUP BY $keys, type") as $r) {
        $k = implode('|', array_map(fn($c) => $r[$c], $keyCols)) . '|' . $r['type'];
        $rows[$k] = $r + ['after_q' => 0, 'in_q' => 0, 'in_cost' => 0, 'in_q_nocost' => 0];
    }
    // 2. the period and after it: only movements from the start of the period (date index)
    foreach (rpRows($db, "SELECT $keys, type,
            SUM(CASE WHEN created_at > ? THEN $qtyCol ELSE 0 END) AS after_q,
            SUM(CASE WHEN created_at <= ? THEN $qtyCol ELSE 0 END) AS in_q,
            SUM(CASE WHEN created_at <= ? AND total_cost IS NOT NULL THEN ABS(total_cost) ELSE 0 END) AS in_cost,
            SUM(CASE WHEN created_at <= ? AND total_cost IS NULL THEN ABS($qtyCol) ELSE 0 END) AS in_q_nocost
        FROM $table WHERE created_at >= ? GROUP BY $keys, type", [$end, $end, $end, $end, $start]) as $r) {
        $k = implode('|', array_map(fn($c) => $r[$c], $keyCols)) . '|' . $r['type'];
        if (!isset($rows[$k])) continue;   // cannot happen: every movement is in the all-time totals
        foreach (['after_q', 'in_q', 'in_cost', 'in_q_nocost'] as $f) $rows[$k][$f] = $r[$f];
    }
    if (count($cache) > 20) $cache = [];
    return $cache[$ck] = array_values($rows);
}

/** Physical units that can be added together; anything else is kept separate. */
function rpUnitFamily(string $unit): array {
    $u = strtolower(trim($unit));
    $map = [
        'kg' => ['mass', 1.0], 'kgs' => ['mass', 1.0], 'kilogram' => ['mass', 1.0], 'kilograms' => ['mass', 1.0],
        'g' => ['mass', 0.001], 'gr' => ['mass', 0.001], 'gram' => ['mass', 0.001], 'grams' => ['mass', 0.001],
        'l' => ['volume', 1.0], 'litre' => ['volume', 1.0], 'liter' => ['volume', 1.0], 'litres' => ['volume', 1.0], 'liters' => ['volume', 1.0],
        'ml' => ['volume', 0.001], 'cl' => ['volume', 0.01],
    ];
    if (isset($map[$u])) return ['family' => $map[$u][0], 'factor' => $map[$u][1], 'base' => $map[$u][0] === 'mass' ? 'kg' : 'L'];
    return ['family' => 'count:' . ($u ?: 'units'), 'factor' => 1.0, 'base' => $u ?: 'units'];
}
/** Convert a quantity between compatible units; null when they are not compatible. */
function rpConvert(float $qty, string $fromUnit, string $toUnit): ?float {
    $a = rpUnitFamily($fromUnit); $b = rpUnitFamily($toUnit);
    if ($a['family'] !== $b['family']) return null;
    return $qty * $a['factor'] / $b['factor'];
}
function rpQuantityTotals(array $items): array {
    $tot = [];
    foreach ($items as $it) {
        $f = rpUnitFamily($it['unit']);
        $key = $f['family'];
        $tot[$key] ??= ['unit' => $f['base'], 'quantity' => 0.0, 'items' => 0];
        $tot[$key]['quantity'] += max(0, $it['expectedClosing']) * $f['factor'];
        $tot[$key]['items']++;
    }
    return array_values(array_map(fn($t) => ['unit' => $t['unit'], 'quantity' => rpQty($t['quantity']), 'items' => $t['items']], $tot));
}

// ── headline figures (used by the overview and every comparison) ─
function rpSummary(PDO $db, array $P, string $scope = 'all', ?string $staff = null): array {
    $lines   = rpSalesLines($db, $P, $scope, $staff);
    $refunds = $staff ? [] : rpRefundLines($db, $P, $scope);
    $expense = $staff ? [] : rpExpenseLines($db, $P, $scope);

    $gross = 0.0; $cogs = 0.0; $estimated = 0; $unknown = 0; $tx = [];
    foreach ($lines as $l) {
        $gross += $l['total'];
        if ($l['cost'] !== null) $cogs += $l['cost'];
        if ($l['costStatus'] === 'estimated') $estimated++;
        if ($l['costStatus'] === 'unknown' && $l['total'] > 0) $unknown++;
        $tx[$l['order'] . '|' . $l['date']] = true;
    }
    $refundTotal = array_sum(array_column($refunds, 'total'));
    $restock     = array_sum(array_column($refunds, 'restockCost'));
    $discounts   = $staff ? 0.0 : array_sum(array_column(rpDiscountLines($db, $P, $scope), 'discount'));
    $cogs -= $restock; // drinks put back on the shelf are no longer a cost
    $net   = $gross - $discounts - $refundTotal;
    $gp    = $net - $cogs;
    $opex  = array_sum(array_column($expense, 'amount'));
    return [
        'grossSales' => rpMoney($gross), 'discounts' => rpMoney($discounts), 'refunds' => rpMoney($refundTotal),
        'netSales' => rpMoney($net), 'cogs' => rpMoney($cogs), 'grossProfit' => rpMoney($gp),
        'grossMargin' => rpPct($gp, $net), 'operatingExpenses' => rpMoney($opex),
        'netOperatingProfit' => rpMoney($gp - $opex), 'transactions' => count($tx), 'lines' => count($lines),
        'costEstimatedLines' => $estimated, 'costUnknownLines' => $unknown,
    ];
}

function rpStockSummary(array $ledger): array {
    $s = ['costValue' => 0.0, 'drinkValue' => 0.0, 'barIngredientValue' => 0.0, 'kitchenIngredientValue' => 0.0,
          'sellValue' => 0.0, 'potentialProfit' => 0.0, 'low' => 0, 'out' => 0, 'negative' => 0, 'missingCost' => 0,
          'wastedValue' => 0.0, 'unexplainedValue' => 0.0, 'unexplainedItems' => 0];
    foreach ($ledger as $it) {
        $s['costValue'] += $it['closingValue'];
        if ($it['kind'] === 'bar_item') { $s['drinkValue'] += $it['closingValue']; $s['sellValue'] += $it['sellValue'] ?? 0; $s['potentialProfit'] += $it['potentialProfit'] ?? 0; }
        if ($it['kind'] === 'bar_ingredient') $s['barIngredientValue'] += $it['closingValue'];
        if ($it['kind'] === 'kitchen_ingredient') $s['kitchenIngredientValue'] += $it['closingValue'];
        if ($it['status'] === 'low') $s['low']++;
        if ($it['status'] === 'out') $s['out']++;
        if ($it['status'] === 'negative') $s['negative']++;
        if ($it['missingCost']) $s['missingCost']++;
        $s['wastedValue'] += $it['wastedValue'];
        if (abs($it['unexplained']) > 0.0005) { $s['unexplainedItems']++; $s['unexplainedValue'] += abs($it['unexplainedValue']); }
    }
    foreach ($s as $k => $v) if (is_float($v)) $s[$k] = rpMoney($v);
    $s['quantities'] = rpQuantityTotals($ledger);
    return $s;
}

function rpCustomerDebts(PDO $db): array {
    $r = rpRows($db, "SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS t FROM customer_debts WHERE status = 'Pending'")[0];
    return ['count' => (int)$r['n'], 'outstanding' => rpMoney($r['t'])];
}

function rpCashHandover(array $shifts): array {
    $closed = array_filter($shifts, fn($s) => $s['status'] === 'closed');
    return [
        'shifts' => count($shifts), 'closed' => count($closed), 'open' => count($shifts) - count($closed),
        'expected' => rpMoney(array_sum(array_column($closed, 'expected'))), 'counted' => rpMoney(array_sum(array_column($closed, 'counted'))),
        'difference' => rpMoney(array_sum(array_column($closed, 'difference'))),
    ];
}

function rpOverview(PDO $db, array $P, string $scope = 'all', ?string $staff = null): array {
    $cur  = rpSummary($db, $P, $scope, $staff);
    $prev = rpSummary($db, rpPrev($P), $scope, $staff);
    $ledger = rpStockLedger($db, $P, $scope);
    $stock = rpStockSummary($ledger);
    $col = rpCollections($db, $P);
    $issues = rpIssues($db, $P);
    $issueImpact = array_sum(array_map(fn($i) => abs((float)($i['impact'] ?? 0)), array_filter($issues, fn($i) => in_array($i['status'], ['open', 'review'], true))));
    return [
        'period' => $P, 'scope' => $scope, 'current' => $cur, 'previous' => $prev,
        'collections' => $scope === 'all' ? $col : null,
        'stock' => $stock,
        'customerDebts' => rpCustomerDebts($db),
        'supplierDebts' => rpMoney(array_sum(array_map(fn($b) => max(0, $b['balance']), rpSupplierBalances($db)))),
        'cashHandover' => rpCashHandover(rpShifts($db, $P)),
        'issues' => ['open' => count(array_filter($issues, fn($i) => $i['status'] === 'open')), 'impact' => rpMoney($issueImpact)],
        'insights' => rpInsights($db, $P, $scope, $cur, $prev, $ledger),
        'notRecorded' => RP_NOT_RECORDED,
    ];
}

// ── sales report ──────────────────────────────────────────────
function rpSalesReport(PDO $db, array $P, string $scope = 'all', ?string $staff = null): array {
    $lines = rpSalesLines($db, $P, $scope, $staff);
    $refunds = rpRefundLines($db, $P, $scope);
    $days = []; $staffRows = []; $byItem = [];
    foreach ($lines as $l) {
        $d = &$days[$l['date'] . '|' . $l['source']];
        $d ??= ['date' => $l['date'], 'source' => $l['source'], 'orders' => [], 'gross' => 0.0, 'refunds' => 0.0, 'cost' => 0.0, 'qty' => 0.0, 'staff' => []];
        if ($l['cost'] === null && $l['total'] > 0) $d['unknownCost'] = ($d['unknownCost'] ?? 0) + $l['total'];
        $d['orders'][$l['order']] = true; $d['gross'] += $l['total']; $d['cost'] += $l['cost'] ?? 0; $d['qty'] += $l['qty'];
        $d['staff'][$l['staff']] = true;
        unset($d);
        $s = &$staffRows[$l['staff'] . '|' . $l['source']];
        $s ??= ['staff' => $l['staff'] ?: 'Not recorded', 'source' => $l['source'], 'orders' => [], 'gross' => 0.0, 'qty' => 0.0];
        $s['orders'][$l['order'] . $l['date']] = true; $s['gross'] += $l['total']; $s['qty'] += $l['qty'];
        unset($s);
        $i = &$byItem[$l['source'] . '|' . $l['name']];
        $i ??= ['source' => $l['source'], 'name' => $l['name'], 'qty' => 0.0, 'gross' => 0.0, 'cost' => 0.0];
        $i['qty'] += $l['qty']; $i['gross'] += $l['total']; $i['cost'] += $l['cost'] ?? 0;
        unset($i);
    }
    foreach ($refunds as $r) {
        $d = &$days[$r['date'] . '|' . $r['source']];
        $d ??= ['date' => $r['date'], 'source' => $r['source'], 'orders' => [], 'gross' => 0.0, 'refunds' => 0.0, 'cost' => 0.0, 'qty' => 0.0, 'staff' => []];
        $d['refunds'] += $r['total']; $d['cost'] -= $r['restockCost'];
        unset($d);
    }
    foreach ($staff ? [] : rpDiscountLines($db, $P, $scope) as $x) {
        foreach (['bar' => $x['barPart'], 'kitchen' => $x['kitchenPart']] as $src => $amt) {
            if ($amt <= 0) continue;
            $d = &$days[$x['date'] . '|' . $src];
            $d ??= ['date' => $x['date'], 'source' => $src, 'orders' => [], 'gross' => 0.0, 'refunds' => 0.0, 'cost' => 0.0, 'qty' => 0.0, 'staff' => []];
            $d['discounts'] = ($d['discounts'] ?? 0) + $amt;
            unset($d);
        }
    }
    $dayRows = array_values(array_map(fn($d) => [
        'date' => $d['date'], 'source' => $d['source'], 'transactions' => count($d['orders']), 'itemsSold' => rpQty($d['qty']),
        'gross' => rpMoney($d['gross']), 'discounts' => rpMoney($d['discounts'] ?? 0), 'refunds' => rpMoney($d['refunds']),
        'net' => rpMoney($d['gross'] - ($d['discounts'] ?? 0) - $d['refunds']),
        'cost' => rpMoney($d['cost']), 'grossProfit' => rpMoney($d['gross'] - ($d['discounts'] ?? 0) - $d['refunds'] - $d['cost']),
        // sales whose cost is unknown would make the margin look better than it is
        'unknownCostSales' => rpMoney($d['unknownCost'] ?? 0),
        'margin' => !empty($d['unknownCost']) ? null : rpPct($d['gross'] - ($d['discounts'] ?? 0) - $d['refunds'] - $d['cost'], $d['gross'] - ($d['discounts'] ?? 0) - $d['refunds']),
        'staff' => implode(', ', array_filter(array_keys($d['staff']))),
    ], $days));
    usort($dayRows, fn($a, $b) => strcmp($b['date'], $a['date']) ?: strcmp($a['source'], $b['source']));
    return [
        'summary' => rpSummary($db, $P, $scope, $staff), 'days' => $dayRows,
        'staff' => array_values(array_map(fn($s) => ['staff' => $s['staff'], 'source' => $s['source'], 'transactions' => count($s['orders']), 'itemsSold' => rpQty($s['qty']), 'gross' => rpMoney($s['gross'])], $staffRows)),
        'items' => array_values(array_map(fn($i) => $i + ['grossProfit' => rpMoney($i['gross'] - $i['cost'])], $byItem)),
        'collections' => rpCollections($db, $P), 'refunds' => $refunds, 'voids' => rpVoids($db, $P), 'lines' => $lines,
        'discounts' => rpDiscountLines($db, $P, $scope), 'shifts' => rpShifts($db, $P),
        'staffList' => array_values(array_unique(array_filter(array_column($staff ? rpSalesLines($db, $P, $scope) : $lines, 'staff')))),
    ];
}

// ── product profitability (bar) ───────────────────────────────
function rpProductReport(PDO $db, array $P): array {
    $items = rpBarItems($db);
    $lines = rpSalesLines($db, $P, 'bar');
    $prevLines = rpSalesLines($db, rpPrev($P), 'bar');
    $refunds = rpRefundLines($db, $P, 'bar');
    $ledger = []; foreach (rpStockLedger($db, $P, 'bar') as $l) if ($l['kind'] === 'bar_item') $ledger[$l['id']] = $l;

    $purch = []; foreach (rpRows($db, "SELECT inventory_id, quantity, unit_cost, total_cost, purchase_date FROM inventory_purchases WHERE inventory_type = 'bar_item' ORDER BY purchase_date, id") as $p) $purch[(int)$p['inventory_id']][] = $p;
    $lastSale = []; foreach (rpRows($db, 'SELECT product_id, MAX(sale_date) AS d FROM bar_sales GROUP BY product_id') as $r) $lastSale[(int)$r['product_id']] = $r['d'];

    $sold = []; foreach ($lines as $l) if (!$l['legacy']) { $s = &$sold[$l['productId']]; $s ??= ['qty' => 0.0, 'rev' => 0.0, 'cost' => 0.0]; $s['qty'] += $l['qty']; $s['rev'] += $l['total']; $s['cost'] += $l['cost'] ?? 0; unset($s); }
    $prevSold = []; foreach ($prevLines as $l) if (!$l['legacy']) $prevSold[$l['productId']] = ($prevSold[$l['productId']] ?? 0) + $l['qty'];
    $ref = []; foreach ($refunds as $r) { $x = &$ref[$r['name']]; $x ??= ['rev' => 0.0, 'restock' => 0.0]; $x['rev'] += $r['total']; $x['restock'] += $r['restockCost']; unset($x); }

    $rows = [];
    foreach ($items as $id => $it) {
        $ps = $purch[$id] ?? [];
        $inPeriod = array_filter($ps, fn($p) => $p['purchase_date'] >= $P['from'] && $p['purchase_date'] <= $P['to']);
        $costs = array_map(fn($p) => (float)$p['unit_cost'], $ps);
        $s = $sold[$id] ?? ['qty' => 0.0, 'rev' => 0.0, 'cost' => 0.0];
        $r = $ref[$it['name']] ?? ['rev' => 0.0, 'restock' => 0.0];
        $netRev = $s['rev'] - $r['rev']; $cogs = $s['cost'] - $r['restock'];
        $gpUnit = $it['price'] - $it['unitCost'];
        $margin = rpPct($gpUnit, $it['price']);
        $lg = $ledger[$id] ?? null;
        $lastTwo = array_slice($costs, -2);
        $flags = [];
        if ($it['unitCost'] <= 0) $flags[] = 'No cost';
        elseif ($gpUnit < 0) $flags[] = 'Negative margin';
        elseif ($margin !== null && $margin < 20) $flags[] = 'Low margin';
        if (count($lastTwo) === 2 && $lastTwo[1] > $lastTwo[0]) $flags[] = 'Cost increased';
        if (($prevSold[$id] ?? 0) > 0 && $s['qty'] < $prevSold[$id]) $flags[] = 'Sales falling';
        $ls = $lastSale[$id] ?? null;
        if ($it['type'] === 'direct' && $it['stock'] > 0 && (!$ls || $ls < date('Y-m-d', strtotime($P['to'] . ' -30 days')))) $flags[] = 'No sales in 30 days';
        $rows[] = [
            'id' => $id, 'name' => $it['name'], 'type' => $it['type'], 'category' => $it['type'] === 'recipe' ? 'Cocktail / recipe' : 'Drink',
            'purchasedQty' => rpQty(array_sum(array_column($inPeriod, 'quantity'))), 'purchasedCost' => rpMoney(array_sum(array_column($inPeriod, 'total_cost'))),
            'avgCost' => rpMoney($it['unitCost']), 'minCost' => $costs ? rpMoney(min($costs)) : null, 'maxCost' => $costs ? rpMoney(max($costs)) : null,
            'price' => rpMoney($it['price']), 'profitPerUnit' => rpMoney($gpUnit), 'margin' => $margin,
            'qtySold' => rpQty($s['qty']), 'netRevenue' => rpMoney($netRev), 'cogs' => rpMoney($cogs), 'realizedProfit' => rpMoney($netRev - $cogs),
            'remaining' => $it['type'] === 'direct' ? rpQty($lg['expectedClosing'] ?? $it['stock']) : null,
            'remainingCost' => $lg ? $lg['closingValue'] : null, 'remainingSellValue' => $lg ? $lg['sellValue'] : null, 'potentialProfit' => $lg ? $lg['potentialProfit'] : null,
            'lastPurchase' => $ps ? end($ps)['purchase_date'] : null, 'lastSale' => $ls, 'flags' => $flags,
        ];
    }
    usort($rows, fn($a, $b) => $b['realizedProfit'] <=> $a['realizedProfit']);
    return ['products' => $rows, 'legacyLines' => count(array_filter($lines, fn($l) => $l['legacy']))];
}

// ── kitchen and ingredient profitability ──────────────────────
function rpKitchenReport(PDO $db, array $P): array {
    $menu = rpKitchenMenu($db);
    $lines = rpSalesLines($db, $P, 'kitchen');
    $refunds = rpRefundLines($db, $P, 'kitchen');
    $ings = []; foreach (rpRows($db, 'SELECT * FROM kitchen_ingredients') as $k) $ings[(int)$k['id']] = $k;

    // recipe lines per menu item
    $recipeLines = [];
    foreach (rpRows($db, 'SELECT km.id AS menu_id, ri.ingredient_id, ri.qty FROM kitchen_menu km JOIN recipe_ingredients ri ON ri.recipe_id = km.recipe_id') as $r) {
        $recipeLines[(int)$r['menu_id']][] = $r;
    }
    // actual ingredient cost booked against each dish (new sales); older sales are estimated
    $actual = [];
    foreach (rpRows($db, 'SELECT kd.menu_item_id, SUM(kd.cost) AS c FROM kitchen_deductions kd WHERE kd.menu_item_id IS NOT NULL AND kd.created_at >= ? AND kd.created_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY kd.menu_item_id', [$P['from'], $P['to']]) as $r) {
        $actual[(int)$r['menu_item_id']] = (float)$r['c'];
    }

    $sold = []; $manual = 0.0;
    foreach ($lines as $l) {
        if ($l['legacy']) { $manual += $l['total']; continue; }
        $s = &$sold[$l['productId']]; $s ??= ['qty' => 0.0, 'rev' => 0.0, 'cost' => 0.0, 'unknown' => 0]; $s['qty'] += $l['qty']; $s['rev'] += $l['total'];
        if ($l['cost'] !== null) $s['cost'] += $l['cost']; else $s['unknown']++;
        unset($s);
    }
    $ref = []; foreach ($refunds as $r) $ref[$r['name']] = ($ref[$r['name']] ?? 0) + $r['total'];

    $menuRows = [];
    foreach ($menu as $id => $m) {
        $breakdown = [];
        foreach ($recipeLines[$id] ?? [] as $rl) {
            $k = $ings[(int)$rl['ingredient_id']] ?? null; if (!$k) continue;
            $c = (float)$rl['qty'] * (float)$k['cost_per_unit'];
            $breakdown[] = ['ingredient' => $k['name'], 'qty' => rpQty($rl['qty']), 'unit' => $k['unit'], 'unitCost' => rpMoney($k['cost_per_unit']), 'cost' => rpMoney($c)];
        }
        $portion = $m['unitCost'];
        foreach ($breakdown as &$b) $b['share'] = rpPct($b['cost'], $portion);
        unset($b);
        $s = $sold[$id] ?? ['qty' => 0.0, 'rev' => 0.0, 'cost' => 0.0, 'unknown' => 0];
        $netRev = $s['rev'] - ($ref[$m['name']] ?? 0);
        $ingCost = $actual[$id] ?? $s['cost'];
        $flags = [];
        if (!$m['recipeId']) $flags[] = 'No recipe — cost unknown';
        elseif ($portion !== null && $m['price'] > 0 && ($m['price'] - $portion) < 0) $flags[] = 'Negative margin';
        elseif ($portion !== null && rpPct($m['price'] - $portion, $m['price']) < 30) $flags[] = 'Low margin';
        $menuRows[] = [
            'id' => $id, 'name' => $m['name'], 'category' => $m['category'], 'price' => rpMoney($m['price']),
            'portionCost' => $portion === null ? null : rpMoney($portion), 'profitPerPortion' => $portion === null ? null : rpMoney($m['price'] - $portion),
            'portionMargin' => $portion === null ? null : rpPct($m['price'] - $portion, $m['price']),
            'qtySold' => rpQty($s['qty']), 'netRevenue' => rpMoney($netRev),
            'ingredientCost' => $m['recipeId'] ? rpMoney($ingCost) : null, 'costSource' => isset($actual[$id]) ? 'recorded' : ($m['recipeId'] ? 'estimated' : 'unknown'),
            'grossProfit' => $m['recipeId'] ? rpMoney($netRev - $ingCost) : null, 'margin' => $m['recipeId'] ? rpPct($netRev - $ingCost, $netRev) : null,
            'breakdown' => $breakdown, 'flags' => $flags,
        ];
    }

    // ingredient analysis
    $ledger = []; foreach (rpStockLedger($db, $P, 'kitchen') as $l) $ledger[$l['id']] = $l;
    $used = []; foreach (rpRows($db, 'SELECT ingredient_id, SUM(qty) AS q, SUM(cost) AS c FROM kitchen_deductions WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY ingredient_id', [$P['from'], $P['to']]) as $r) $used[(int)$r['ingredient_id']] = $r;
    $purchases = []; foreach (rpRows($db, "SELECT inventory_id, quantity, unit_cost, total_cost, purchase_date FROM inventory_purchases WHERE inventory_type = 'kitchen_ingredient' ORDER BY purchase_date, id") as $p) $purchases[(int)$p['inventory_id']][] = $p;
    $usedIn = []; foreach (rpRows($db, 'SELECT ri.ingredient_id, km.name FROM recipe_ingredients ri JOIN kitchen_menu km ON km.recipe_id = ri.recipe_id') as $r) $usedIn[(int)$r['ingredient_id']][] = $r['name'];

    $ingRows = [];
    foreach ($ings as $id => $k) {
        $ps = $purchases[$id] ?? [];
        $inPeriod = array_values(array_filter($ps, fn($p) => $p['purchase_date'] >= $P['from'] && $p['purchase_date'] <= $P['to']));
        $costs = array_map(fn($p) => (float)$p['unit_cost'], $ps);
        $lastTwo = array_slice($costs, -2);
        $priceChange = count($lastTwo) === 2 ? rpMoney($lastTwo[1] - $lastTwo[0]) : null;
        $qUsed = (float)($used[$id]['q'] ?? 0);
        $lg = $ledger[$id] ?? null;
        $ingRows[] = [
            'id' => $id, 'name' => $k['name'], 'unit' => $k['unit'], 'avgCost' => rpMoney($k['cost_per_unit']),
            'opening' => $lg['opening'] ?? null, 'purchased' => rpQty(array_sum(array_column($inPeriod, 'quantity'))), 'purchaseValue' => rpMoney(array_sum(array_column($inPeriod, 'total_cost'))),
            'usedQty' => rpQty($qUsed), 'usedCost' => rpMoney($used[$id]['c'] ?? 0), 'wasted' => $lg['flows']['wasted'] ?? 0, 'wastedValue' => $lg['wastedValue'] ?? 0,
            'expectedClosing' => $lg['expectedClosing'] ?? (float)$k['quantity'], 'closingValue' => $lg['closingValue'] ?? 0, 'openingValue' => $lg['openingValue'] ?? 0,
            'minStock' => rpQty($k['min_stock']), 'status' => $lg['status'] ?? 'ok', 'unexplained' => $lg['unexplained'] ?? 0,
            'usedInRecipes' => $usedIn[$id] ?? [], 'lastPriceChange' => $priceChange,
            // cost of the latest price change on what was used this period
            'priceImpact' => $priceChange !== null ? rpMoney($priceChange * $qUsed) : null,
        ];
    }
    usort($ingRows, fn($a, $b) => $b['usedCost'] <=> $a['usedCost']);

    $rev = array_sum(array_column($menuRows, 'netRevenue')) + $manual;
    $cost = array_sum(array_map(fn($r) => (float)($r['ingredientCost'] ?? 0), $menuRows));
    $ranked = array_values(array_filter($menuRows, fn($r) => $r['grossProfit'] !== null));
    usort($ranked, fn($a, $b) => $b['grossProfit'] <=> $a['grossProfit']);
    return [
        'summary' => [
            'revenue' => rpMoney($rev), 'manualRevenue' => rpMoney($manual), 'ingredientCost' => rpMoney($cost), 'grossProfit' => rpMoney($rev - $cost),
            'margin' => rpPct($rev - $cost, $rev), 'ingredientStockValue' => rpMoney(array_sum(array_column($ingRows, 'closingValue'))),
            'wastedValue' => rpMoney(array_sum(array_column($ingRows, 'wastedValue'))),
            'dishesWithoutRecipe' => count(array_filter($menuRows, fn($r) => in_array('No recipe — cost unknown', $r['flags'], true))),
            'lowIngredients' => count(array_filter($ingRows, fn($r) => in_array($r['status'], ['low', 'out', 'negative'], true))),
        ],
        'menu' => $menuRows, 'ingredients' => $ingRows,
        'mostProfitable' => array_slice($ranked, 0, 5), 'leastProfitable' => array_slice(array_reverse($ranked), 0, 5),
    ];
}

// ── purchases report ──────────────────────────────────────────
function rpPurchaseReport(PDO $db, array $P, string $scope = 'all'): array {
    $lines = rpPurchaseLines($db, $P, $scope);
    $group = function (string $key) use ($lines) {
        $g = [];
        foreach ($lines as $l) { $k = $l[$key] ?: 'Not recorded'; $g[$k] ??= ['key' => $k, 'count' => 0, 'total' => 0.0]; $g[$k]['count']++; $g[$k]['total'] += $l['total']; }
        $g = array_values(array_map(fn($x) => ['key' => $x['key'], 'count' => $x['count'], 'total' => rpMoney($x['total'])], $g));
        usort($g, fn($a, $b) => $b['total'] <=> $a['total']);
        return $g;
    };
    // unit cost range for each item across all recorded purchases
    $ranges = [];
    foreach (rpRows($db, 'SELECT inventory_type, inventory_id, item_name, unit, MIN(unit_cost) AS mn, MAX(unit_cost) AS mx, SUM(quantity) AS q, SUM(total_cost) AS t, COUNT(*) AS n, MAX(purchase_date) AS last FROM inventory_purchases GROUP BY inventory_type, inventory_id, item_name, unit') as $r) {
        $ranges[] = ['type' => RP_INV_TYPES[$r['inventory_type']] ?? $r['inventory_type'], 'name' => $r['item_name'], 'unit' => $r['unit'],
                     'cheapest' => rpMoney($r['mn']), 'highest' => rpMoney($r['mx']), 'weightedAvg' => (float)$r['q'] > 0 ? rpMoney($r['t'] / $r['q']) : null,
                     'purchases' => (int)$r['n'], 'last' => $r['last']];
    }
    return [
        'total' => rpMoney(array_sum(array_column($lines, 'total'))), 'count' => count($lines), 'lines' => $lines,
        'bySupplier' => $group('supplier'), 'byItem' => $group('name'), 'byType' => $group('typeLabel'), 'byDate' => $group('date'),
        'costRanges' => $ranges,
        'paidNow' => rpMoney(array_sum(array_map(fn($l) => $l['amountPaid'] ?? $l['total'], $lines))),
        'owedFromPeriod' => rpMoney(array_sum(array_column($lines, 'owed'))),
        'suppliers' => rpSupplierBalances($db),
    ];
}

// ── expenses and cash ─────────────────────────────────────────
function rpExpenseReport(PDO $db, array $P, string $scope = 'all'): array {
    $lines = rpExpenseLines($db, $P, $scope);
    $byCat = [];
    foreach ($lines as $l) { $byCat[$l['category']] = ($byCat[$l['category']] ?? 0) + $l['amount']; }
    arsort($byCat);
    $sum = rpSummary($db, $P, $scope);
    $col = rpCollections($db, $P);
    $cashSales = 0.0; $cashRefunds = 0.0;
    foreach ($col['byMethod'] as $m) if (strcasecmp($m['method'], 'Cash') === 0) { $cashSales = $m['received']; $cashRefunds = $m['refunded']; }
    return [
        'lines' => $lines, 'byCategory' => array_map(fn($k, $v) => ['category' => $k, 'total' => rpMoney($v)], array_keys($byCat), $byCat),
        'total' => rpMoney(array_sum(array_column($lines, 'amount'))),
        'operating' => rpMoney(array_sum(array_column(array_filter($lines, fn($l) => $l['kind'] === 'operating'), 'amount'))),
        'salaries' => rpMoney(array_sum(array_column(array_filter($lines, fn($l) => $l['kind'] === 'salary'), 'amount'))),
        'inventoryPurchases' => rpMoney(array_sum(array_column(rpPurchaseLines($db, $P, $scope), 'total'))),
        'possibleDoubleCount' => array_values(array_filter($lines, fn($l) => $l['looksLikeStock'])),
        'profit' => ['grossProfit' => $sum['grossProfit'], 'operatingExpenses' => $sum['operatingExpenses'], 'netOperatingProfit' => $sum['netOperatingProfit']],
        'cash' => [
            'collections' => $col, 'cashSales' => rpMoney($cashSales), 'cashRefunds' => rpMoney($cashRefunds),
            'expectedCashFromSales' => rpMoney($cashSales - $cashRefunds), 'handover' => rpCashHandover(rpShifts($db, $P)),
            'note' => RP_NOT_RECORDED['mixedPayments'],
        ],
        'shifts' => rpShifts($db, $P),
        'cashFlow' => rpCashFlow($db, $P),
        'notRecorded' => ['taxes' => RP_NOT_RECORDED['taxes']],
    ];
}

// ── discrepancies and data quality ────────────────────────────
/**
 * Issues worth a look. Each has a stable key so its review status survives
 * between reports. Wording states facts only — no accusations.
 */
function rpIssues(PDO $db, array $P): array {
    $issues = [];
    $add = function (string $key, string $type, string $severity, string $title, string $evidence, ?string $date, ?float $impact, string $tab) use (&$issues) {
        $issues[$key] = compact('key', 'type', 'severity', 'title', 'evidence', 'date', 'impact', 'tab');
    };

    foreach (rpStockLedger($db, $P) as $it) {
        $label = RP_INV_TYPES[$it['kind']] ?? $it['kind'];
        if (abs($it['unexplained']) > 0.0005) {
            $add("unexplained:{$it['kind']}:{$it['id']}", 'Unexplained stock', abs($it['unexplainedValue']) >= 10000 ? 'high' : 'medium',
                "{$it['name']}: stock not explained by movement records",
                "Current stock is {$it['current']} {$it['unit']}, but recorded movements add up to " . rpQty($it['current'] - $it['unexplained']) . " {$it['unit']} (difference " . ($it['unexplained'] > 0 ? '+' : '') . "{$it['unexplained']}). This happens when stock is typed in or edited without a purchase/adjustment record, or when a sale was blocked from going below zero.",
                $it['lastMovement'] ? substr($it['lastMovement'], 0, 10) : null, $it['unexplainedValue'], 'stock');
        }
        if ($it['status'] === 'negative') $add("negative:{$it['kind']}:{$it['id']}", 'Negative stock', 'high', "{$it['name']}: negative stock", "$label shows {$it['current']} {$it['unit']}.", null, null, 'stock');
        if ($it['missingCost']) $add("nocost:{$it['kind']}:{$it['id']}", 'Missing cost', 'medium', "{$it['name']}: in stock without a purchase cost", "{$it['current']} {$it['unit']} in stock but cost per unit is 0, so its value and profit cannot be calculated.", null, null, 'stock');
    }

    // sales that did not deduct stock
    foreach (rpRows($db, "SELECT bs.order_number, bs.product_name, bs.product_id, bs.qty, bs.sale_date FROM bar_sales bs
            JOIN bar_items bi ON bi.id = bs.product_id AND bi.type = 'direct'
            LEFT JOIN bar_movements bm ON bm.order_number = bs.order_number AND bm.item_id = bs.product_id AND bm.type = 'sale'
            WHERE bs.sale_date BETWEEN ? AND ? AND bm.id IS NULL", [$P['from'], $P['to']]) as $r) {
        $add("nodeduct:bar:{$r['order_number']}:{$r['product_id']}", 'Sale without stock deduction', 'medium', "{$r['product_name']} sold on {$r['order_number']} without a stock deduction",
            "{$r['qty']} sold on {$r['sale_date']} but no matching stock movement exists.", $r['sale_date'], null, 'sales');
    }
    foreach (rpRows($db, "SELECT ks.product_name, ks.product_id, SUM(ks.qty) AS q, SUM(ks.total) AS t, MAX(ks.sale_date) AS d FROM kitchen_sales ks
            JOIN kitchen_menu km ON km.id = ks.product_id WHERE km.recipe_id IS NULL AND ks.sale_date BETWEEN ? AND ? GROUP BY ks.product_id, ks.product_name", [$P['from'], $P['to']]) as $r) {
        $add("norecipe:{$r['product_id']}", 'Dish without recipe', 'medium', "{$r['product_name']} has no recipe",
            "{$r['q']} sold (RWF " . number_format((float)$r['t']) . ") with no ingredients deducted, so kitchen stock and ingredient cost are not tracked for this dish.", $r['d'], null, 'kitchen');
    }

    // duplicates
    foreach (rpRows($db, 'SELECT expense_date, description, amount, COUNT(*) AS n FROM expenses WHERE voided = 0 AND expense_date BETWEEN ? AND ? GROUP BY expense_date, description, amount HAVING n > 1', [$P['from'], $P['to']]) as $r) {
        $add('dupexp:' . md5($r['expense_date'] . $r['description'] . $r['amount']), 'Possible duplicate expense', 'medium', "Expense \"{$r['description']}\" recorded {$r['n']} times on {$r['expense_date']}",
            "{$r['n']} × RWF " . number_format((float)$r['amount']) . ' with the same date and description.', $r['expense_date'], (float)$r['amount'] * ((int)$r['n'] - 1), 'expenses');
    }
    foreach (rpRows($db, "SELECT supplier, reference, COUNT(*) AS n, SUM(total_cost) AS t, MAX(purchase_date) AS d FROM inventory_purchases
            WHERE reference IS NOT NULL AND reference <> '' GROUP BY supplier, reference HAVING COUNT(DISTINCT CONCAT(inventory_type, inventory_id)) < COUNT(*)") as $r) {
        $add('dupref:' . md5($r['supplier'] . $r['reference']), 'Possible duplicate receipt', 'medium', "Receipt {$r['reference']} used {$r['n']} times for the same item",
            'Supplier: ' . ($r['supplier'] ?: 'not recorded') . '. Check whether the same invoice was entered twice.', $r['d'], null, 'purchases');
    }
    // stock received with no purchase record
    foreach (rpRows($db, "SELECT bm.id, bm.item_name, bm.qty_change, bm.unit, bm.created_at FROM bar_movements bm WHERE bm.type = 'purchase' AND (bm.total_cost IS NULL OR bm.total_cost = 0) AND bm.created_at >= ? AND bm.created_at < DATE_ADD(?, INTERVAL 1 DAY)", [$P['from'], $P['to']]) as $r) {
        $add("nopurchase:bm:{$r['id']}", 'Stock received without purchase cost', 'low', "{$r['item_name']}: +{$r['qty_change']} {$r['unit']} received with no purchase price",
            'This stock receipt has no cost, so it is missing from purchase totals.', substr($r['created_at'], 0, 10), null, 'purchases');
    }
    // inventory bought through the expenses screen
    foreach (rpExpenseLines($db, $P) as $e) {
        if ($e['looksLikeStock']) $add("stockexpense:{$e['source']}:{$e['id']}", 'Stock bought as an expense?', 'low', "Expense \"{$e['description']}\" looks like a stock purchase",
            'If these goods went into stock, record them as a stock purchase instead, otherwise they are counted as an expense and not as stock (and may be counted twice if also received).', $e['date'], $e['amount'], 'expenses');
    }
    // many refunds/voids by one person (shown for review only)
    $byPerson = [];
    foreach (rpRefundLines($db, $P) as $r) { $byPerson[$r['by']]['refunds'][$r['refundId']] = $r['total'] + ($byPerson[$r['by']]['refunds'][$r['refundId']] ?? 0); }
    foreach (rpVoids($db, $P) as $v) { $byPerson[$v['requestedBy']]['voids'][$v['id']] = $v['amount']; }
    foreach ($byPerson as $who => $x) {
        $n = count($x['refunds'] ?? []) + count($x['voids'] ?? []);
        if ($n >= 3) $add('manyvoids:' . md5($who . $P['from'] . $P['to']), 'Many refunds/voids', 'low', "$n refunds/voids linked to $who in this period",
            'Not necessarily wrong — review the reasons in the Sales tab.', null, array_sum($x['refunds'] ?? []) + array_sum($x['voids'] ?? []), 'sales');
    }
    // high wastage
    $ledger = rpStockLedger($db, $P);
    $waste = array_sum(array_column($ledger, 'wastedValue'));
    $cogs = rpSummary($db, $P)['cogs'];
    if ($waste > 0 && $cogs > 0 && $waste / $cogs > 0.05) {
        $add('highwaste:' . $P['from'] . ':' . $P['to'], 'High wastage', 'medium', 'Wastage is ' . rpPct($waste, $cogs) . '% of cost of goods sold',
            'RWF ' . number_format($waste) . ' wasted/broken against RWF ' . number_format($cogs) . ' cost of goods sold.', null, $waste, 'stock');
    }

    foreach (rpShifts($db, $P) as $sh) {
        if ($sh['status'] === 'closed' && abs((float)$sh['difference']) >= 1) {
            $add("shiftdiff:{$sh['id']}", 'Cash count difference', abs($sh['difference']) >= 5000 ? 'high' : 'medium',
                "Shift of {$sh['user']}: cash " . ($sh['difference'] < 0 ? 'short' : 'over') . ' by RWF ' . number_format(abs($sh['difference'])),
                'Expected RWF ' . number_format($sh['expected']) . ', counted RWF ' . number_format($sh['counted']) . '.' . ($sh['note'] ? " Note at closing: {$sh['note']}" : ' No note given.') . ' Common causes: a payment recorded with the wrong method, change given wrongly, or an expense paid in cash but not recorded.',
                substr($sh['closedAt'], 0, 10), $sh['difference'], 'expenses');
        }
    }
    foreach (rpDiscountLines($db, $P) as $d) {
        if (($d['pct'] ?? 0) >= 20) $add("bigdiscount:{$d['order']}", 'Large discount', 'low', "{$d['pct']}% discount on {$d['order']}",
            'RWF ' . number_format($d['discount']) . ' off RWF ' . number_format($d['orderTotal']) . " by {$d['by']}. Reason: " . ($d['reason'] ?: 'none'), $d['date'], $d['discount'], 'sales');
    }
    foreach (rpStockCountStatus($db, min($P['to'], date('Y-m-d'))) as $c) {
        if (!in_array($c['status'], ['overdue', 'never'], true)) continue;
        $add("nocount:{$c['area']}:{$c['dueOn']}", 'Stock count overdue', $c['status'] === 'never' || $c['daysSince'] > 2 * $c['every'] ? 'medium' : 'low',
            "{$c['label']}: stock count " . ($c['status'] === 'never' ? 'never done' : "overdue by " . ($c['daysSince'] - $c['every']) . ' day(s)'),
            "Counts are due every {$c['every']} days (set by the Owner in Settings). " . ($c['lastCount'] ? "Last count: {$c['lastCount']}." : 'No count has been recorded yet.') . ' A count confirms the stock figures and settles unexplained differences.',
            null, null, 'stock');
    }

    // attach saved review status
    if ($issues && rpTableExists($db, 'report_issues')) {
        $keys = array_keys($issues);
        $in = implode(',', array_fill(0, count($keys), '?'));
        foreach (rpRows($db, "SELECT * FROM report_issues WHERE issue_key IN ($in)", $keys) as $s) {
            $issues[$s['issue_key']]['status'] = $s['status'];
            $issues[$s['issue_key']]['note'] = $s['note'];
            $issues[$s['issue_key']]['reviewedBy'] = $s['reviewed_by'];
            $issues[$s['issue_key']]['reviewedAt'] = $s['updated_at'];
        }
    }
    foreach ($issues as &$i) { $i['status'] ??= 'open'; $i['impact'] = $i['impact'] === null ? null : rpMoney($i['impact']); }
    unset($i);
    $order = ['high' => 0, 'medium' => 1, 'low' => 2];
    $list = array_values($issues);
    usort($list, fn($a, $b) => ($order[$a['severity']] <=> $order[$b['severity']]) ?: (abs($b['impact'] ?? 0) <=> abs($a['impact'] ?? 0)));
    return $list;
}

function rpDataQuality(PDO $db, array $P): array {
    $sum = rpSummary($db, $P);
    $lines = rpSalesLines($db, $P);
    return [
        'notRecorded' => RP_NOT_RECORDED,
        'checks' => [
            ['label' => 'Sale lines with cost recorded at the moment of sale', 'value' => count(array_filter($lines, fn($l) => $l['costStatus'] === 'recorded')) . ' of ' . count($lines)],
            ['label' => 'Sale lines costed at today\'s average cost (estimated)', 'value' => $sum['costEstimatedLines']],
            ['label' => 'Sale lines with no cost at all (profit overstated)', 'value' => $sum['costUnknownLines']],
            ['label' => 'Sales from the old Quick Sale system in this period', 'value' => count(array_filter($lines, fn($l) => $l['legacy'] && $l['order'] === 'Quick sale'))],
            ['label' => 'Manually typed kitchen revenue entries in this period', 'value' => count(array_filter($lines, fn($l) => $l['order'] === 'Manual entry'))],
            ['label' => 'Orders paid without an open shift (not in any cash count)', 'value' => (int)rpVal($db, "SELECT COUNT(*) FROM orders WHERE status = 'paid' AND voided = 0 AND shift_id IS NULL AND paid_at >= ? AND paid_at < DATE_ADD(?, INTERVAL 1 DAY)", [$P['from'], $P['to']])],
            ['label' => 'Shifts still open', 'value' => (int)rpVal($db, "SELECT COUNT(*) FROM shifts WHERE status = 'open'")],
            ['label' => 'Expenses with no payment method', 'value' => (int)rpVal($db, 'SELECT COUNT(*) FROM expenses WHERE voided = 0 AND payment_method IS NULL AND expense_date BETWEEN ? AND ?', [$P['from'], $P['to']])],
            ['label' => 'Purchases with no payment recorded (treated as paid)', 'value' => (int)rpVal($db, 'SELECT COUNT(*) FROM inventory_purchases WHERE amount_paid IS NULL AND purchase_date BETWEEN ? AND ?', [$P['from'], $P['to']])],
            ['label' => 'Last physical stock count', 'value' => rpVal($db, 'SELECT MAX(count_date) FROM stock_counts') ?: 'Never'],
        ],
    ];
}

// ── staff performance (employee linked to a BarMS login) ──────
/**
 * Everything a user did in the period. BarMS stores who did what by the
 * user's full name (and shifts by user id), so both are used.
 */
function rpStaffPerformance(PDO $db, array $P, int $userId): ?array {
    $u = rpRows($db, 'SELECT id, full_name, username, role FROM users WHERE id = ?', [$userId])[0] ?? null;
    if (!$u) return null;
    $name = $u['full_name'];
    $r = [$P['from'], $P['to']];
    $lines = array_values(array_filter(rpSalesLines($db, $P), fn($l) => $l['staff'] === $name));
    $orders = []; $items = []; $byDay = [];
    foreach ($lines as $l) {
        if ($l['order']) $orders[$l['order'] . '|' . $l['date']] = true;
        $i = &$items[$l['name']]; $i ??= ['name' => $l['name'], 'qty' => 0.0, 'total' => 0.0]; $i['qty'] += $l['qty']; $i['total'] += $l['total']; unset($i);
        $byDay[$l['date']] = ($byDay[$l['date']] ?? 0) + $l['total'];
    }
    usort($items, fn($a, $b) => $b['total'] <=> $a['total']);
    $sales = array_sum(array_column($lines, 'total'));
    $paid = rpRows($db, "SELECT COALESCE(NULLIF(payment_method,''),'Not recorded') AS method, COUNT(*) AS n, SUM(total - discount) AS t, SUM(discount) AS d, SUM(discount > 0) AS nd
                         FROM orders WHERE status = 'paid' AND voided = 0 AND paid_by = ? AND paid_at >= ? AND paid_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY method", array_merge([$name], $r));
    $refunds = rpRows($db, 'SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS t FROM order_refunds WHERE refunded_by = ? AND refund_date BETWEEN ? AND ?', array_merge([$name], $r))[0];
    $voidReq = rpRows($db, "SELECT type, status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS t FROM void_requests WHERE requested_by = ? AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY type, status", array_merge([$name], $r));
    $shifts = rpRows($db, "SELECT COUNT(*) AS n, SUM(status = 'closed') AS closed, COALESCE(SUM(difference),0) AS diff, COALESCE(SUM(ABS(difference) >= 1),0) AS off
                           FROM shifts WHERE user_id = ? AND opened_at >= ? AND opened_at < DATE_ADD(?, INTERVAL 1 DAY)", array_merge([$userId], $r))[0];
    $expenses = (float)rpVal($db, 'SELECT COALESCE(SUM(amount),0) FROM expenses WHERE voided = 0 AND recorded_by = ? AND expense_date BETWEEN ? AND ?', array_merge([$name], $r));
    $kitchen = rpRows($db, "SELECT SUM(accepted_by = ?) AS accepted, SUM(served_by = ?) AS served,
                AVG(CASE WHEN accepted_by = ? AND ready_at IS NOT NULL AND accepted_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, accepted_at, ready_at) END) AS prep
            FROM kitchen_orders WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)", array_merge([$name, $name, $name], $r))[0];
    ksort($byDay);
    return [
        'user' => ['id' => (int)$u['id'], 'name' => $name, 'username' => $u['username'], 'role' => $u['role']],
        'sales' => ['total' => rpMoney($sales), 'orders' => count($orders), 'items' => rpQty(array_sum(array_column($lines, 'qty'))),
                    'avgOrder' => count($orders) ? rpMoney($sales / count($orders)) : 0.0, 'activeDays' => count($byDay)],
        'payments' => array_map(fn($p) => ['method' => $p['method'], 'orders' => (int)$p['n'], 'amount' => rpMoney($p['t'])], $paid),
        'paymentsTotal' => rpMoney(array_sum(array_column($paid, 't'))),
        'discounts' => ['count' => (int)array_sum(array_column($paid, 'nd')), 'amount' => rpMoney(array_sum(array_column($paid, 'd')))],
        'refunds' => ['count' => (int)$refunds['n'], 'amount' => rpMoney($refunds['t'])],
        'voidRequests' => array_map(fn($v) => ['type' => $v['type'], 'status' => $v['status'], 'count' => (int)$v['n'], 'amount' => rpMoney($v['t'])], $voidReq),
        'shifts' => ['count' => (int)$shifts['n'], 'closed' => (int)$shifts['closed'], 'difference' => rpMoney($shifts['diff']), 'withDifference' => (int)$shifts['off']],
        'expensesRecorded' => rpMoney($expenses),
        'kitchen' => ['accepted' => (int)$kitchen['accepted'], 'served' => (int)$kitchen['served'], 'avgPrepMinutes' => $kitchen['prep'] !== null ? round((float)$kitchen['prep'], 1) : null],
        'topItems' => array_map(fn($i) => ['name' => $i['name'], 'qty' => rpQty($i['qty']), 'total' => rpMoney($i['total'])], array_slice($items, 0, 10)),
        'byDay' => array_map(fn($d, $t) => ['date' => $d, 'sales' => rpMoney($t)], array_keys($byDay), $byDay),
    ];
}

// ── stock count schedule ──────────────────────────────────────
const RP_COUNT_AREAS = ['bar_item' => 'Drinks', 'bar_ingredient' => 'Bar ingredients', 'kitchen_ingredient' => 'Kitchen ingredients'];
function rpStockCountInterval(PDO $db): int {
    try { $d = (int)rpVal($db, 'SELECT stock_count_days FROM settings LIMIT 1'); } catch (Exception $e) { $d = 0; }
    return $d > 0 ? $d : 7;
}
/** Per area: when it was last counted and whether a count is due (counts are due every N days, set by the Owner). */
function rpStockCountStatus(PDO $db, ?string $asOf = null): array {
    $asOf = $asOf ?: date('Y-m-d');
    $every = rpStockCountInterval($db);
    $out = [];
    foreach (RP_COUNT_AREAS as $area => $label) {
        $hasStock = (int)rpVal($db, $area === 'bar_item'
            ? "SELECT COUNT(*) FROM bar_items WHERE type = 'direct' AND active = 1"
            : 'SELECT COUNT(*) FROM ' . ($area === 'bar_ingredient' ? 'bar_ingredients' : 'kitchen_ingredients'));
        if (!$hasStock) continue;
        $last = rpTableExists($db, 'stock_counts') ? rpVal($db, 'SELECT MAX(count_date) FROM stock_counts WHERE area = ? AND count_date <= ?', [$area, $asOf]) : null;
        $since = $last ? (int)(new DateTimeImmutable($last))->diff(new DateTimeImmutable($asOf))->days : null;
        $dueOn = $last ? (new DateTimeImmutable($last))->modify("+$every days")->format('Y-m-d') : $asOf;
        $out[] = [
            'area' => $area, 'label' => $label, 'every' => $every, 'lastCount' => $last ?: null, 'daysSince' => $since,
            'dueOn' => $dueOn, 'status' => !$last ? 'never' : ($since > $every ? 'overdue' : ($since === $every ? 'due' : 'ok')),
            'daysLeft' => $last ? $every - $since : 0,
        ];
    }
    return $out;
}

// ── rule-based insights (every sentence is backed by figures) ──
function rpInsights(PDO $db, array $P, string $scope, array $cur, array $prev, array $ledger): array {
    $out = [];
    $chg = fn($a, $b) => $b != 0 ? round(($a - $b) / abs($b) * 100, 1) : null;
    $salesChg = $chg($cur['netSales'], $prev['netSales']);
    if ($salesChg !== null) {
        $out[] = ['tab' => 'sales', 'level' => $salesChg >= 0 ? 'good' : 'warn',
                  'text' => 'Net sales ' . ($salesChg >= 0 ? 'rose' : 'fell') . " $salesChg% (RWF " . number_format($cur['netSales']) . ' vs RWF ' . number_format($prev['netSales']) . ' in the previous period).'];
    }
    if ($cur['grossMargin'] !== null && $prev['grossMargin'] !== null && $cur['netSales'] > $prev['netSales'] && $cur['grossMargin'] < $prev['grossMargin']) {
        $out[] = ['tab' => 'products', 'level' => 'warn', 'text' => "Sales grew but gross margin dropped from {$prev['grossMargin']}% to {$cur['grossMargin']}%."];
    }
    $expChg = $chg($cur['operatingExpenses'], $prev['operatingExpenses']);
    if ($expChg !== null && $salesChg !== null && $expChg > $salesChg && $cur['operatingExpenses'] > 0) {
        $out[] = ['tab' => 'expenses', 'level' => 'warn', 'text' => "Expenses changed $expChg% while sales changed $salesChg% — expenses are growing faster than sales."];
    }
    if ($scope !== 'kitchen') {
        $prod = rpProductReport($db, $P)['products'];
        $top = array_values(array_filter($prod, fn($p) => $p['realizedProfit'] > 0));
        if ($top) $out[] = ['tab' => 'products', 'level' => 'good', 'text' => "{$top[0]['name']} earned the most gross profit: RWF " . number_format($top[0]['realizedProfit']) . " from {$top[0]['qtySold']} sold."];
        $neg = array_filter($prod, fn($p) => in_array('Negative margin', $p['flags'], true));
        if ($neg) $out[] = ['tab' => 'products', 'level' => 'bad', 'text' => count($neg) . ' product(s) sell below cost: ' . implode(', ', array_slice(array_column($neg, 'name'), 0, 3)) . '.'];
        $slow = array_filter($prod, fn($p) => in_array('No sales in 30 days', $p['flags'], true));
        if ($slow) $out[] = ['tab' => 'stock', 'level' => 'warn', 'text' => 'RWF ' . number_format(array_sum(array_column($slow, 'remainingCost'))) . ' of stock is tied up in ' . count($slow) . ' product(s) with no sales in 30 days.'];
    }
    if ($scope !== 'bar') {
        $k = rpKitchenReport($db, $P);
        $ingTop = array_values(array_filter($k['ingredients'], fn($i) => $i['usedCost'] > 0));
        if ($ingTop) $out[] = ['tab' => 'kitchen', 'level' => 'info', 'text' => "{$ingTop[0]['name']} cost the kitchen the most this period: RWF " . number_format($ingTop[0]['usedCost']) . " for {$ingTop[0]['usedQty']} {$ingTop[0]['unit']}."];
        if ($k['summary']['dishesWithoutRecipe'] > 0) $out[] = ['tab' => 'kitchen', 'level' => 'warn', 'text' => "{$k['summary']['dishesWithoutRecipe']} dish(es) have no recipe, so their ingredient cost and profit cannot be calculated."];
    }
    $unexp = array_sum(array_map(fn($i) => abs($i['unexplainedValue']), $ledger));
    if ($unexp > 0) $out[] = ['tab' => 'discrepancies', 'level' => 'warn', 'text' => 'RWF ' . number_format($unexp) . ' of stock value is not explained by recorded stock movements.'];
    if ($cur['costEstimatedLines'] + $cur['costUnknownLines'] > 0) {
        $out[] = ['tab' => 'quality', 'level' => 'info', 'text' => ($cur['costEstimatedLines'] + $cur['costUnknownLines']) . ' sale line(s) in this period have no cost recorded at the moment of sale; their cost is estimated or unknown.'];
    }
    return $out;
}

// ── record lists: every stock movement, kitchen ticket, cash book entry ──
const RP_MOVE_LABELS = [
    'purchase' => 'Bought', 'receive' => 'Bought', 'received' => 'Bought', 'sale' => 'Sold', 'auto_deduction' => 'Used in a dish',
    'void' => 'Returned (void)', 'void_restore' => 'Returned (void)', 'refund' => 'Returned (refund)',
    'breakage' => 'Broken', 'waste' => 'Wasted', 'spoilage' => 'Spoiled', 'expired' => 'Expired', 'damaged' => 'Damaged',
    'count' => 'Stock count', 'adjust' => 'Adjusted', 'adjustment' => 'Adjusted',
];
/**
 * Every stock movement record in the period, bar and kitchen, newest first.
 * value = cost saved on the record; when none was saved, quantity × today's
 * average cost (marked as estimated). In-movements are positive, out negative.
 */
function rpStockMovements(PDO $db, array $P, string $scope = 'all'): array {
    $rows = []; $r = [rpStart($P), rpEnd($P)];
    $push = function (array $m, string $area, string $kind, float $avgCost) use (&$rows) {
        $q = (float)$m['q'];
        $saved = $m['cost'] !== null && (float)$m['cost'] != 0.0;
        $value = $saved ? abs((float)$m['cost']) : abs($q) * $avgCost;
        $rows[] = [
            'id' => $area . (int)$m['id'], 'at' => $m['at'], 'date' => substr($m['at'], 0, 10), 'time' => substr($m['at'], 11, 5),
            'area' => $area, 'kind' => $kind, 'name' => $m['name'], 'type' => $m['type'],
            'typeLabel' => RP_MOVE_LABELS[$m['type']] ?? ucfirst(str_replace('_', ' ', $m['type'])),
            'qty' => rpQty($q), 'unit' => $m['unit'] ?: 'units',
            'value' => rpMoney($q < 0 ? -$value : $value), 'valueEstimated' => !$saved && $value > 0,
            'reason' => $m['reason'] ?? '', 'order' => $m['order_number'] ?? null, 'supplier' => $m['supplier'] ?? null, 'by' => $m['by'],
        ];
    };
    if ($scope !== 'kitchen') {
        $cost = [];
        foreach (rpRows($db, 'SELECT id, cost_price FROM bar_items') as $x) $cost['i' . $x['id']] = (float)$x['cost_price'];
        foreach (rpRows($db, 'SELECT id, cost_per_unit FROM bar_ingredients') as $x) $cost['g' . $x['id']] = (float)$x['cost_per_unit'];
        foreach (rpRows($db, 'SELECT id, item_name AS name, item_id, ingredient_id, qty_change AS q, type, reason, unit, order_number, supplier, total_cost AS cost, done_by AS `by`, created_at AS at
                FROM bar_movements WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC, id DESC', $r) as $m) {
            $isItem = (bool)$m['item_id'];
            $push($m, 'bar', $isItem ? 'Drink' : 'Bar ingredient', $cost[($isItem ? 'i' . $m['item_id'] : 'g' . $m['ingredient_id'])] ?? 0.0);
        }
    }
    if ($scope !== 'bar') {
        foreach (rpRows($db, "SELECT m.id, COALESCE(k.name, CONCAT('Ingredient #', m.ingredient_id)) AS name, m.qty AS q, m.type, m.reason, k.unit, NULL AS order_number, m.supplier,
                    m.total_cost AS cost, m.done_by AS `by`, m.created_at AS at, COALESCE(k.cost_per_unit, 0) AS avg
                FROM kitchen_stock_movements m LEFT JOIN kitchen_ingredients k ON k.id = m.ingredient_id
                WHERE m.created_at BETWEEN ? AND ? ORDER BY m.created_at DESC, m.id DESC", $r) as $m) {
            if (preg_match('/^Order (\S+)/', (string)$m['reason'], $mm)) $m['order_number'] = $mm[1];
            $push($m, 'kitchen', 'Kitchen ingredient', (float)$m['avg']);
        }
    }
    usort($rows, fn($a, $b) => strcmp($b['at'], $a['at']));
    $byType = [];
    foreach ($rows as $x) {
        $t = &$byType[$x['typeLabel']];
        $t ??= ['type' => $x['typeLabel'], 'records' => 0, 'in' => 0.0, 'out' => 0.0];
        $t['records']++;
        if ($x['value'] >= 0) $t['in'] += $x['value']; else $t['out'] += -$x['value'];
        unset($t);
    }
    $byType = array_values(array_map(fn($t) => ['type' => $t['type'], 'records' => $t['records'], 'in' => rpMoney($t['in']), 'out' => rpMoney($t['out'])], $byType));
    usort($byType, fn($a, $b) => ($b['in'] + $b['out']) <=> ($a['in'] + $a['out']));
    return [
        'rows' => $rows, 'byType' => $byType, 'count' => count($rows),
        'valueIn' => rpMoney(array_sum(array_column($byType, 'in'))), 'valueOut' => rpMoney(array_sum(array_column($byType, 'out'))),
        'estimated' => count(array_filter($rows, fn($x) => $x['valueEstimated'])),
    ];
}

/** Minutes between two datetimes, or null when either is missing or the order is reversed. */
function rpMinutes(?string $from, ?string $to): ?float {
    if (!$from || !$to) return null;
    $d = (strtotime($to) - strtotime($from)) / 60;
    return $d < 0 ? null : round($d, 1);
}
/**
 * Kitchen queue: every kitchen ticket created in the period and how long each stage took.
 *   waited   = received → accepted by the kitchen
 *   cooking  = started (or accepted) → ready
 *   handover = ready → served to the customer
 *   readyIn  = received → ready (compared with the estimate given to the customer)
 *   total    = received → served (or → ready when not served yet)
 */
function rpKitchenQueue(PDO $db, array $P): array {
    $range = [rpStart($P), rpEnd($P)];
    $items = [];
    foreach (rpRows($db, 'SELECT i.kitchen_order_id, i.product_name, i.qty FROM kitchen_order_items i JOIN kitchen_orders ko ON ko.id = i.kitchen_order_id
            WHERE ko.created_at BETWEEN ? AND ?', $range) as $i) {
        $items[(int)$i['kitchen_order_id']][] = $i;
    }
    $status = ['pending' => 'Waiting', 'accepted' => 'Accepted', 'preparing' => 'Cooking', 'ready' => 'Ready', 'served' => 'Served', 'rejected' => 'Rejected'];
    $rows = [];
    foreach (rpRows($db, 'SELECT * FROM kitchen_orders WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC, id DESC', $range) as $k) {
        $its = $items[(int)$k['id']] ?? [];
        $readyIn = rpMinutes($k['created_at'], $k['ready_at']);
        $rows[] = [
            'id' => (int)$k['id'], 'order' => $k['order_number'], 'table' => $k['table_name'], 'date' => substr($k['created_at'], 0, 10), 'time' => substr($k['created_at'], 11, 5),
            'dishes' => implode(', ', array_map(fn($i) => ((int)$i['qty'] > 1 ? $i['qty'] . '× ' : '') . $i['product_name'], $its)),
            'portions' => array_sum(array_map(fn($i) => (int)$i['qty'], $its)),
            'status' => $k['status'], 'statusLabel' => $status[$k['status']] ?? ucfirst($k['status']),
            'estimated' => (int)$k['estimated_minutes'],
            'waited' => rpMinutes($k['created_at'], $k['accepted_at']),
            'cooking' => rpMinutes($k['preparing_at'] ?: $k['accepted_at'], $k['ready_at']),
            'handover' => rpMinutes($k['ready_at'], $k['served_at']),
            'readyIn' => $readyIn,
            'total' => rpMinutes($k['created_at'], $k['served_at'] ?: $k['ready_at']),
            'late' => $readyIn !== null && $readyIn > (int)$k['estimated_minutes'],
            'acceptedBy' => $k['accepted_by'], 'servedBy' => $k['served_by'], 'rejectReason' => $k['reject_reason'],
        ];
    }
    // typical time = median, so one ticket forgotten overnight does not distort it
    $avg = function (string $k) use ($rows) {
        $v = array_values(array_filter(array_column($rows, $k), fn($x) => $x !== null)); sort($v); $n = count($v);
        return $n ? round($n % 2 ? $v[intdiv($n, 2)] : ($v[$n / 2 - 1] + $v[$n / 2]) / 2, 1) : null;
    };
    $timed = array_filter($rows, fn($r) => $r['readyIn'] !== null);
    $late = array_filter($timed, fn($r) => $r['late']);
    $byHour = [];
    foreach ($rows as $r) { $h = substr($r['time'], 0, 2) . ':00'; $byHour[$h] = ($byHour[$h] ?? 0) + 1; }
    ksort($byHour);
    $byDish = [];
    foreach ($rows as $r) foreach ($items[$r['id']] ?? [] as $i) {
        $d = &$byDish[$i['product_name']];
        $d ??= ['dish' => $i['product_name'], 'portions' => 0, 'tickets' => 0, 'readySum' => 0.0, 'readyN' => 0];
        $d['portions'] += (int)$i['qty']; $d['tickets']++;
        if ($r['readyIn'] !== null) { $d['readySum'] += $r['readyIn']; $d['readyN']++; }
        unset($d);
    }
    $byDish = array_values(array_map(fn($d) => ['dish' => $d['dish'], 'portions' => $d['portions'], 'tickets' => $d['tickets'], 'avgReadyIn' => $d['readyN'] ? round($d['readySum'] / $d['readyN'], 1) : null], $byDish));
    usort($byDish, fn($a, $b) => $b['portions'] <=> $a['portions']);
    $staff = [];
    foreach ($rows as $r) if ($r['acceptedBy']) $staff[$r['acceptedBy']] = ($staff[$r['acceptedBy']] ?? 0) + 1;
    arsort($staff);
    return [
        'rows' => $rows,
        'summary' => [
            'tickets' => count($rows), 'portions' => array_sum(array_column($rows, 'portions')),
            'served' => count(array_filter($rows, fn($r) => $r['status'] === 'served')),
            'rejected' => count(array_filter($rows, fn($r) => $r['status'] === 'rejected')),
            'open' => count(array_filter($rows, fn($r) => in_array($r['status'], ['pending', 'accepted', 'preparing', 'ready'], true))),
            'avgWaited' => $avg('waited'), 'avgCooking' => $avg('cooking'), 'avgHandover' => $avg('handover'), 'avgReadyIn' => $avg('readyIn'), 'avgTotal' => $avg('total'),
            'late' => count($late), 'onTimePct' => $timed ? rpPct(count($timed) - count($late), count($timed)) : null,
            'busiestHour' => $byHour ? array_search(max($byHour), $byHour, true) : null,
        ],
        'byHour' => array_map(fn($h, $n) => ['hour' => $h, 'tickets' => $n], array_keys($byHour), array_values($byHour)),
        'byDish' => $byDish,
        'byStaff' => array_map(fn($n, $c) => ['staff' => $n, 'tickets' => $c], array_keys($staff), array_values($staff)),
    ];
}

const RP_CASHBOOK_LABELS = [
    'owner_withdrawal' => 'Owner withdrawal', 'capital' => 'Capital put in', 'loan_in' => 'Loan received', 'loan_repayment' => 'Loan repayment',
    'transfer' => 'Transfer between accounts', 'other_in' => 'Other money in', 'other_out' => 'Other money out', 'opening_balance' => 'Starting balance',
    'asset_purchase' => 'Equipment bought',
];
/** Every cash book entry in the period (capital, withdrawals, loans, transfers); voided entries are kept and marked. */
function rpCashBook(PDO $db, array $P): array {
    $rows = [];
    foreach (rpRows($db, 'SELECT * FROM cash_movements WHERE movement_date BETWEEN ? AND ? ORDER BY movement_date DESC, id DESC', [$P['from'], $P['to']]) as $c) {
        $dir = $c['type'] === 'transfer' ? 'move' : ($c['type'] === 'opening_balance' ? 'start' : (in_array($c['type'], RP_CASH_IN_TYPES, true) ? 'in' : 'out'));
        $rows[] = [
            'id' => (int)$c['id'], 'date' => $c['movement_date'], 'type' => $c['type'], 'typeLabel' => RP_CASHBOOK_LABELS[$c['type']] ?? $c['type'], 'direction' => $dir,
            'amount' => rpMoney($c['amount']), 'method' => $c['method'], 'toMethod' => $c['to_method'], 'note' => $c['note'] ?? '',
            'by' => $c['recorded_by'], 'voided' => (bool)$c['voided'], 'recordedAt' => $c['created_at'],
        ];
    }
    $live = array_filter($rows, fn($r) => !$r['voided']);
    $sum = fn(array $types) => rpMoney(array_sum(array_column(array_filter($live, fn($r) => in_array($r['type'], $types, true)), 'amount')));
    return [
        'rows' => $rows,
        'totals' => [
            'capital' => $sum(['capital']), 'withdrawals' => $sum(['owner_withdrawal']), 'loansIn' => $sum(['loan_in']), 'loanRepayments' => $sum(['loan_repayment']),
            'otherIn' => $sum(['other_in']), 'otherOut' => $sum(['other_out']), 'transfers' => $sum(['transfer']),
            'startingBalances' => $sum(['opening_balance']), 'equipmentBought' => $sum(['asset_purchase']),
            'moneyIn' => rpMoney(array_sum(array_column(array_filter($live, fn($r) => $r['direction'] === 'in'), 'amount'))),
            'moneyOut' => rpMoney(array_sum(array_column(array_filter($live, fn($r) => $r['direction'] === 'out'), 'amount'))),
            'voided' => count($rows) - count($live),
        ],
    ];
}

// ── business worth: everything the business owns and owes on a date ──
/**
 * Worth on a date = what the business owns − what it owes.
 *   Owns:  money in each account (starting balance + every recorded movement since),
 *          stock at cost, money customers owe, equipment.
 *   Owes:  suppliers (bought − paid), loans (received − repaid).
 * Owner's side: money and equipment the owner put in − withdrawals
 *   + what the business kept (the rest: profit kept, plus anything not recorded).
 */
function rpBusinessWorth(PDO $db, string $asOf): array {
    $P = ['from' => $asOf, 'to' => $asOf, 'prevFrom' => $asOf, 'prevTo' => $asOf, 'preset' => 'custom', 'label' => $asOf, 'days' => 1];
    $all = ['from' => '2000-01-01', 'to' => $asOf] + $P;

    // money in each account
    $acc = [];
    foreach (rpRows($db, "SELECT method, SUM(amount) AS t FROM cash_movements WHERE type = 'opening_balance' AND voided = 0 AND movement_date <= ? GROUP BY method", [$asOf]) as $r) {
        $acc[$r['method']] = ['account' => $r['method'], 'starting' => (float)$r['t'], 'in' => 0.0, 'out' => 0.0];
    }
    foreach (rpCashFlow($db, $all)['byMethod'] as $m) {
        $acc[$m['method']] ??= ['account' => $m['method'], 'starting' => 0.0, 'in' => 0.0, 'out' => 0.0];
        $acc[$m['method']]['in'] += $m['in']; $acc[$m['method']]['out'] += $m['out'];
    }
    $accounts = array_values(array_map(fn($a) => [
        'account' => $a['account'], 'starting' => rpMoney($a['starting']), 'in' => rpMoney($a['in']), 'out' => rpMoney($a['out']),
        'balance' => rpMoney($a['starting'] + $a['in'] - $a['out']),
    ], $acc));
    usort($accounts, fn($a, $b) => $b['balance'] <=> $a['balance']);
    $money = array_sum(array_column($accounts, 'balance'));

    $stock = rpStockSummary(rpStockLedger($db, $P, 'all'));

    $debts = rpRows($db, "SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS t FROM customer_debts
            WHERE debt_date <= ? AND (status = 'Pending' OR paid_at > ?)", [$asOf, $asOf . ' 23:59:59'])[0];

    $equipment = rpTableExists($db, 'business_assets')
        ? rpRows($db, 'SELECT id, name, category, value, acquired_date, funded_by, note FROM business_assets
                WHERE acquired_date <= ? AND (disposed_date IS NULL OR disposed_date > ?) ORDER BY value DESC', [$asOf, $asOf])
        : [];
    $equipmentValue = array_sum(array_map(fn($e) => (float)$e['value'], $equipment));

    // owed to suppliers on that date, supplier by supplier (an overpaid supplier is not a debt)
    $sup = [];
    foreach (rpRows($db, "SELECT LOWER(TRIM(COALESCE(supplier,''))) AS k, MAX(TRIM(COALESCE(supplier,''))) AS name,
                SUM(total_cost - COALESCE(amount_paid, total_cost)) AS owed FROM inventory_purchases WHERE purchase_date <= ? GROUP BY k", [$asOf]) as $r) {
        $sup[$r['k']] = ['supplier' => $r['name'] !== '' ? $r['name'] : 'No supplier named', 'owed' => (float)$r['owed']];
    }
    if (rpTableExists($db, 'supplier_payments')) {
        foreach (rpRows($db, "SELECT LOWER(TRIM(supplier)) AS k, MAX(TRIM(supplier)) AS name, SUM(amount) AS paid FROM supplier_payments WHERE payment_date <= ? GROUP BY k", [$asOf]) as $r) {
            $sup[$r['k']] ??= ['supplier' => $r['name'], 'owed' => 0.0];
            $sup[$r['k']]['owed'] -= (float)$r['paid'];
        }
    }
    $suppliers = array_values(array_filter(array_map(fn($s) => ['supplier' => $s['supplier'], 'owed' => rpMoney($s['owed'])], $sup), fn($s) => $s['owed'] > 0));
    usort($suppliers, fn($a, $b) => $b['owed'] <=> $a['owed']);
    $supplierDebt = array_sum(array_column($suppliers, 'owed'));

    $cb = [];
    foreach (rpRows($db, 'SELECT type, SUM(amount) AS t FROM cash_movements WHERE voided = 0 AND movement_date <= ? GROUP BY type', [$asOf]) as $r) $cb[$r['type']] = (float)$r['t'];
    $loans = max(0, ($cb['loan_in'] ?? 0) - ($cb['loan_repayment'] ?? 0));

    $owns = $money + $stock['costValue'] + (float)$debts['t'] + $equipmentValue;
    $owes = $supplierDebt + $loans;
    $worth = $owns - $owes;

    $ownerEquipment = array_sum(array_map(fn($e) => (float)$e['value'], array_filter($equipment, fn($e) => $e['funded_by'] === 'owner')));
    $putIn = ($cb['capital'] ?? 0) + ($cb['opening_balance'] ?? 0) + $ownerEquipment;
    $takenOut = $cb['owner_withdrawal'] ?? 0;
    // stock entered with no payment from any account (opening stock, older purchases): its value came from outside the records
    $unpaidStock = (float)rpVal($db, 'SELECT COALESCE(SUM(total_cost),0) FROM inventory_purchases WHERE amount_paid IS NULL AND purchase_date <= ?', [$asOf]);

    return [
        'asOf' => $asOf,
        'worth' => rpMoney($worth), 'owns' => rpMoney($owns), 'owes' => rpMoney($owes),
        'money' => rpMoney($money), 'accounts' => $accounts,
        'stock' => ['value' => $stock['costValue'], 'drinks' => $stock['drinkValue'], 'barIngredients' => $stock['barIngredientValue'], 'kitchenIngredients' => $stock['kitchenIngredientValue'], 'sellValue' => $stock['sellValue']],
        'customerDebts' => ['count' => (int)$debts['n'], 'amount' => rpMoney($debts['t'])],
        'equipment' => array_map(fn($e) => ['id' => (int)$e['id'], 'name' => $e['name'], 'category' => $e['category'], 'value' => rpMoney($e['value']),
            'acquired' => $e['acquired_date'], 'fundedBy' => $e['funded_by'], 'note' => $e['note']], $equipment),
        'equipmentValue' => rpMoney($equipmentValue),
        'suppliers' => $suppliers, 'supplierDebt' => rpMoney($supplierDebt), 'loans' => rpMoney($loans),
        'owner' => [
            'capital' => rpMoney($cb['capital'] ?? 0), 'startingBalances' => rpMoney($cb['opening_balance'] ?? 0), 'equipmentBroughtIn' => rpMoney($ownerEquipment),
            'putIn' => rpMoney($putIn), 'stockWithoutPayment' => rpMoney($unpaidStock), 'withdrawals' => rpMoney($takenOut),
            'keptByBusiness' => rpMoney($worth - $putIn - $unpaidStock + $takenOut),
        ],
        'hasStartingBalances' => isset($cb['opening_balance']),
        'negativeAccounts' => array_values(array_column(array_filter($accounts, fn($a) => $a['balance'] < 0 && !in_array($a['account'], ['Not recorded', 'Mixed'], true)), 'account')),
    ];
}

/** Worth at the start and end of the period, and what changed it. */
function rpWorthReport(PDO $db, array $P): array {
    $startDate = (new DateTimeImmutable($P['from']))->modify('-1 day')->format('Y-m-d');
    $start = rpBusinessWorth($db, $startDate);
    $end = rpBusinessWorth($db, $P['to']);
    $cb = [];
    foreach (rpRows($db, 'SELECT type, SUM(amount) AS t FROM cash_movements WHERE voided = 0 AND movement_date BETWEEN ? AND ? GROUP BY type', [$P['from'], $P['to']]) as $r) $cb[$r['type']] = (float)$r['t'];
    $ownerEquipment = rpTableExists($db, 'business_assets')
        ? (float)rpVal($db, "SELECT COALESCE(SUM(value),0) FROM business_assets WHERE funded_by = 'owner' AND acquired_date BETWEEN ? AND ?", [$P['from'], $P['to']]) : 0.0;
    $putIn = ($cb['capital'] ?? 0) + ($cb['opening_balance'] ?? 0) + $ownerEquipment;
    $takenOut = $cb['owner_withdrawal'] ?? 0;
    $unpaidStock = (float)rpVal($db, 'SELECT COALESCE(SUM(total_cost),0) FROM inventory_purchases WHERE amount_paid IS NULL AND purchase_date BETWEEN ? AND ?', [$P['from'], $P['to']]);
    $change = $end['worth'] - $start['worth'];
    $profit = rpSummary($db, $P)['netOperatingProfit'];
    return [
        'start' => $start, 'end' => $end, 'change' => rpMoney($change),
        'explained' => [
            'capital' => rpMoney($cb['capital'] ?? 0), 'startingBalances' => rpMoney($cb['opening_balance'] ?? 0), 'equipmentBroughtIn' => rpMoney($ownerEquipment),
            'stockWithoutPayment' => rpMoney($unpaidStock), 'withdrawals' => rpMoney($takenOut), 'profit' => rpMoney($profit),
            // stock counts, cost changes, things not recorded
            'other' => rpMoney($change - $putIn - $unpaidStock + $takenOut - $profit),
        ],
    ];
}
