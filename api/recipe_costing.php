<?php
// ============================================================
//  api/recipe_costing.php — shared recipe cost breakdown
//  Included by kitchen2.php (kitchen recipes) and
//  bar-inventory.php (bar recipe / cocktail items).
// ============================================================

/**
 * @param PDO    $db
 * @param array  $ingredients rows with ingredient_id, ingredient_name, unit, qty, cost_per_unit
 * @param string $inventoryType 'kitchen_ingredient' or 'bar_ingredient' (inventory_purchases.inventory_type)
 * @param float  $sellPrice
 * @param array  $sales ['month' => ['qty'=>..,'revenue'=>..], 'all' => [...]]
 */
function buildRecipeCosting(PDO $db, array $ingredients, string $inventoryType, float $sellPrice, array $sales): array {
    $lastStmt = $db->prepare('SELECT purchase_date, supplier, reference, quantity, unit_cost, total_cost
        FROM inventory_purchases WHERE inventory_type = ? AND inventory_id = ?
        ORDER BY purchase_date DESC, id DESC LIMIT 1');
    $sumStmt = $db->prepare('SELECT COALESCE(SUM(quantity),0) AS qty, COALESCE(SUM(total_cost),0) AS spent, COUNT(*) AS n
        FROM inventory_purchases WHERE inventory_type = ? AND inventory_id = ?');

    $rows = [];
    $recipeCost = 0.0;
    $missingCost = 0;
    foreach ($ingredients as $ing) {
        $ingId = (int)$ing['ingredient_id'];
        $qty   = (float)$ing['qty'];
        $avg   = (float)$ing['cost_per_unit'];
        $cost  = $qty * $avg;
        $recipeCost += $cost;
        if ($avg <= 0) $missingCost++;

        $lastStmt->execute([$inventoryType, $ingId]);
        $last = $lastStmt->fetch() ?: null;
        $sumStmt->execute([$inventoryType, $ingId]);
        $sum = $sumStmt->fetch();

        $rows[] = [
            'ingredientId'   => $ingId,
            'name'           => $ing['ingredient_name'],
            'unit'           => $ing['unit'],
            'qtyPerServing'  => $qty,
            'avgUnitCost'    => round($avg, 2),
            'costPerServing' => round($cost, 2),
            'lastPurchase'   => $last ? [
                'date'      => $last['purchase_date'],
                'supplier'  => $last['supplier'],
                'reference' => $last['reference'],
                'quantity'  => (float)$last['quantity'],
                'unitCost'  => (float)$last['unit_cost'],
                'totalCost' => (float)$last['total_cost'],
            ] : null,
            'purchasedQty'   => (float)$sum['qty'],
            'purchasedSpent' => (float)$sum['spent'],
            'purchaseCount'  => (int)$sum['n'],
        ];
    }

    foreach ($rows as &$r) {
        $r['shareOfCostPct']  = $recipeCost > 0 ? round($r['costPerServing'] / $recipeCost * 100, 1) : 0;
        $r['shareOfPricePct'] = $sellPrice > 0 ? round($r['costPerServing'] / $sellPrice * 100, 1) : 0;
    }
    unset($r);

    $profit = $sellPrice - $recipeCost;
    $salesOut = [];
    foreach ($sales as $period => $s) {
        $qty = (float)($s['qty'] ?? 0);
        $rev = (float)($s['revenue'] ?? 0);
        $cost = $qty * $recipeCost;
        $salesOut[$period] = [
            'qty'     => $qty,
            'revenue' => round($rev, 2),
            'cost'    => round($cost, 2),
            'profit'  => round($rev - $cost, 2),
        ];
    }

    return [
        'ingredients'      => $rows,
        'recipeCost'       => round($recipeCost, 2),
        'sellPrice'        => round($sellPrice, 2),
        'profitPerServing' => round($profit, 2),
        'marginPct'        => $sellPrice > 0 ? round($profit / $sellPrice * 100, 1) : 0,
        'missingCostCount' => $missingCost,
        'sales'            => $salesOut,
    ];
}

// Units sold and revenue for one product, this month and all time
function recipeSalesStats(PDO $db, string $table, int $productId): array {
    $stmt = $db->prepare("SELECT
            COALESCE(SUM(CASE WHEN sale_date >= ? THEN qty END),0)   AS m_qty,
            COALESCE(SUM(CASE WHEN sale_date >= ? THEN total END),0) AS m_rev,
            COALESCE(SUM(qty),0) AS a_qty, COALESCE(SUM(total),0) AS a_rev
        FROM $table WHERE product_id = ?");
    $month = date('Y-m-01');
    $stmt->execute([$month, $month, $productId]);
    $r = $stmt->fetch();
    return [
        'month' => ['qty' => $r['m_qty'], 'revenue' => $r['m_rev']],
        'all'   => ['qty' => $r['a_qty'], 'revenue' => $r['a_rev']],
    ];
}
