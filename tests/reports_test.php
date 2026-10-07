<?php
// ============================================================
//  tests/reports_test.php — Advanced Reports calculation tests
//  Run:  php tests/reports_test.php
//  Loads a small hand-calculated business into the real database
//  for dates in January 2037, checks every figure, then ROLLS BACK.
//  Nothing is left behind.
// ============================================================
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$_SERVER['HTTP_HOST'] = 'localhost';
require __DIR__ . '/../config/db.php';
require __DIR__ . '/../api/report_lib.php';
require __DIR__ . '/../api/refund_lib.php';
error_reporting(E_ALL); ini_set('display_errors', '1');

$db = getDB();
$pass = 0; $fail = 0;
function check(string $name, $actual, $expected, float $tol = 0.01): void {
    global $pass, $fail;
    $ok = (is_numeric($actual) && is_numeric($expected)) ? abs((float)$actual - (float)$expected) <= $tol : $actual === $expected;
    if ($ok) { $pass++; echo "  ok   $name\n"; }
    else { $fail++; echo "  FAIL $name — expected " . json_encode($expected) . ', got ' . json_encode($actual) . "\n"; }
}
function ins(PDO $db, string $table, array $row): int {
    $cols = array_keys($row);
    $db->prepare("INSERT INTO $table (" . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')')->execute(array_values($row));
    return (int)$db->lastInsertId();
}

echo "== Periods\n";
$p = rpPeriod('last_week', null, null, '2026-10-02');
check('last week from', $p['from'], '2026-09-21'); check('last week to', $p['to'], '2026-09-27');
check('last week previous from', $p['prevFrom'], '2026-09-14'); check('last week previous to', $p['prevTo'], '2026-09-20');
$p = rpPeriod('this_month', null, null, '2026-10-02');
check('this month', $p['from'] . '..' . $p['to'], '2026-10-01..2026-10-02');
check('this month previous = same days last month', $p['prevFrom'] . '..' . $p['prevTo'], '2026-09-01..2026-09-02');
$p = rpPeriod('last_month', null, null, '2026-03-15');
check('last month (Feb)', $p['from'] . '..' . $p['to'], '2026-02-01..2026-02-28');
check('last month previous (Jan)', $p['prevFrom'] . '..' . $p['prevTo'], '2026-01-01..2026-01-31');
$p = rpPeriod('custom', '2026-05-10', '2026-05-01');
check('custom range is put in order', $p['from'] . '..' . $p['to'], '2026-05-01..2026-05-10');
$threw = false; try { rpPeriod('custom', 'bad', '2026-01-01'); } catch (InvalidArgumentException $e) { $threw = true; }
check('custom range rejects a bad date', $threw, true);

echo "== Unit conversions\n";
check('250 g = 0.25 kg', rpConvert(250, 'g', 'kg'), 0.25, 0.0000001);
check('1.5 L = 1500 ml', rpConvert(1.5, 'L', 'ml'), 1500, 0.0000001);
check('kg to L is refused', rpConvert(1, 'kg', 'L'), null);
check('pcs to kg is refused', rpConvert(1, 'pcs', 'kg'), null);
$tot = rpQuantityTotals([
    ['unit' => 'kg', 'expectedClosing' => 2.0], ['unit' => 'g', 'expectedClosing' => 500.0],
    ['unit' => 'pcs', 'expectedClosing' => 10.0], ['unit' => 'ml', 'expectedClosing' => 750.0],
]);
$byUnit = array_column($tot, 'quantity', 'unit');
check('kg and g are added together (2 kg + 500 g)', $byUnit['kg'] ?? null, 2.5);
check('pcs are kept separate', $byUnit['pcs'] ?? null, 10.0);
check('ml are converted to litres', $byUnit['L'] ?? null, 0.75);

echo "== Business fixture (January 2037, rolled back afterwards)\n";
$db->beginTransaction();
try {
    // ---- bar item: bought 24 @ 800 and 12 @ 1000 → weighted average 31200 / 36 = 866.6667
    $A = ins($db, 'bar_items', ['name' => 'TEST Beer', 'price' => 1500, 'cost_price' => 866.6667, 'type' => 'direct', 'stock' => 25, 'min_stock' => 5, 'active' => 1]);
    ins($db, 'inventory_purchases', ['inventory_type' => 'bar_item', 'inventory_id' => $A, 'item_name' => 'TEST Beer', 'quantity' => 24, 'unit' => 'pcs', 'unit_cost' => 800, 'total_cost' => 19200, 'supplier' => 'S1', 'reference' => 'INV-1', 'purchase_date' => '2037-01-10', 'recorded_by' => 'test']);
    ins($db, 'inventory_purchases', ['inventory_type' => 'bar_item', 'inventory_id' => $A, 'item_name' => 'TEST Beer', 'quantity' => 12, 'unit' => 'pcs', 'unit_cost' => 1000, 'total_cost' => 12000, 'supplier' => 'S1', 'reference' => 'INV-2', 'purchase_date' => '2037-01-12', 'recorded_by' => 'test']);
    $mv = fn($q, $type, $at, $cost = null) => ins($db, 'bar_movements', ['item_name' => 'TEST Beer', 'item_id' => $A, 'qty_change' => $q, 'type' => $type, 'reason' => 'test', 'unit' => 'pcs', 'order_number' => 'T-1', 'total_cost' => $cost, 'done_by' => 'test', 'created_at' => $at]);
    $mv(24, 'purchase', '2037-01-10 10:00:00', 19200);
    $mv(12, 'purchase', '2037-01-12 10:00:00', 12000);
    $mv(-10, 'sale', '2037-01-13 20:00:00');
    $mv(-1, 'breakage', '2037-01-14 21:00:00', 866.67);
    $mv(-2, 'sale', '2037-01-20 20:00:00'); // after the period
    // movements add up to 23, but stock is 25 → 2 bottles unexplained

    // ---- bar sales: 10 with cost recorded (850), 2 without (estimated at 866.6667)
    ins($db, 'bar_sales', ['product_id' => $A, 'product_name' => 'TEST Beer', 'qty' => 10, 'unit_price' => 1500, 'total' => 15000, 'unit_cost' => 850, 'sold_by' => 'Ann', 'order_id' => 0, 'order_number' => 'T-1', 'sale_date' => '2037-01-13', 'sale_time' => '20:00:00']);
    ins($db, 'bar_sales', ['product_id' => $A, 'product_name' => 'TEST Beer', 'qty' => 2, 'unit_price' => 1500, 'total' => 3000, 'unit_cost' => null, 'sold_by' => 'Bob', 'order_id' => 0, 'order_number' => 'T-2', 'sale_date' => '2037-01-11', 'sale_time' => '19:00:00']);
    // ---- refund: 1 beer, put back in stock (cost 850)
    $R = ins($db, 'order_refunds', ['order_id' => 0, 'order_number' => 'T-1', 'amount' => 1500, 'reason' => 'test', 'method' => 'Cash', 'refund_date' => '2037-01-14', 'refunded_by' => 'Owner']);
    ins($db, 'order_refund_items', ['refund_id' => $R, 'order_item_id' => 0, 'product_name' => 'TEST Beer', 'source_type' => 'bar', 'qty' => 1, 'unit_price' => 1500, 'total' => 1500, 'restocked' => 1, 'restock_cost' => 850]);

    // ---- kitchen: dish = 0.25 kg meat @ 6000 + 0.05 L oil @ 2000 = 1600 per portion
    $K1 = ins($db, 'kitchen_ingredients', ['name' => 'TEST Meat', 'quantity' => 9.25, 'unit' => 'kg', 'cost_per_unit' => 6000, 'min_stock' => 1]);
    $K2 = ins($db, 'kitchen_ingredients', ['name' => 'TEST Oil', 'quantity' => 4.85, 'unit' => 'L', 'cost_per_unit' => 2000, 'min_stock' => 1]);
    $REC = ins($db, 'kitchen_recipes', ['name' => 'TEST Dish recipe']);
    ins($db, 'recipe_ingredients', ['recipe_id' => $REC, 'ingredient_id' => $K1, 'qty' => 0.25]);
    ins($db, 'recipe_ingredients', ['recipe_id' => $REC, 'ingredient_id' => $K2, 'qty' => 0.05]);
    $M  = ins($db, 'kitchen_menu', ['name' => 'TEST Dish', 'category' => 'Kitchen', 'price' => 5000, 'recipe_id' => $REC, 'status' => 'available', 'prep_minutes' => 10]);
    $M2 = ins($db, 'kitchen_menu', ['name' => 'TEST Plain', 'category' => 'Kitchen', 'price' => 2000, 'recipe_id' => null, 'status' => 'available', 'prep_minutes' => 5]);
    ins($db, 'kitchen_sales', ['product_id' => $M, 'product_name' => 'TEST Dish', 'qty' => 3, 'unit_price' => 5000, 'total' => 15000, 'unit_cost' => 1600, 'sold_by' => 'Ann', 'order_id' => 0, 'sale_date' => '2037-01-13', 'sale_time' => '20:00:00']);
    ins($db, 'kitchen_sales', ['product_id' => $M2, 'product_name' => 'TEST Plain', 'qty' => 1, 'unit_price' => 2000, 'total' => 2000, 'unit_cost' => null, 'sold_by' => 'Ann', 'order_id' => 0, 'sale_date' => '2037-01-13', 'sale_time' => '20:05:00']);
    ins($db, 'kitchen_deductions', ['order_id' => 0, 'menu_item_id' => $M, 'ingredient_id' => $K1, 'qty' => 0.75, 'cost' => 4500, 'created_at' => '2037-01-13 20:00:00']);
    ins($db, 'kitchen_deductions', ['order_id' => 0, 'menu_item_id' => $M, 'ingredient_id' => $K2, 'qty' => 0.15, 'cost' => 300, 'created_at' => '2037-01-13 20:00:00']);
    ins($db, 'inventory_purchases', ['inventory_type' => 'kitchen_ingredient', 'inventory_id' => $K1, 'item_name' => 'TEST Meat', 'quantity' => 10, 'unit' => 'kg', 'unit_cost' => 6000, 'total_cost' => 60000, 'supplier' => 'Butcher', 'reference' => 'B-1', 'purchase_date' => '2037-01-10', 'recorded_by' => 'test']);
    $km = fn($ing, $q, $type, $at, $cost) => ins($db, 'kitchen_stock_movements', ['ingredient_id' => $ing, 'qty' => $q, 'type' => $type, 'reason' => 'test', 'amount' => $cost, 'total_cost' => $cost, 'done_by' => 'test', 'created_at' => $at]);
    $km($K1, 10, 'purchase', '2037-01-10 09:00:00', 60000);
    $km($K1, -0.75, 'auto_deduction', '2037-01-13 20:00:00', 4500);
    $km($K2, 5, 'purchase', '2037-01-10 09:00:00', 10000);
    $km($K2, -0.15, 'auto_deduction', '2037-01-13 20:00:00', 300);

    // ---- expenses: 2 identical (duplicate), 1 that looks like stock, kitchen expense, salary
    ins($db, 'expenses', ['description' => 'TEST Electricity', 'category' => 'Utilities', 'amount' => 5000, 'expense_date' => '2037-01-11', 'recorded_by' => 'test', 'voided' => 0]);
    ins($db, 'expenses', ['description' => 'TEST Electricity', 'category' => 'Utilities', 'amount' => 5000, 'expense_date' => '2037-01-11', 'recorded_by' => 'test', 'voided' => 0]);
    ins($db, 'expenses', ['description' => 'TEST Crate of beer', 'category' => 'General', 'amount' => 12000, 'expense_date' => '2037-01-12', 'recorded_by' => 'test', 'voided' => 0]);
    ins($db, 'expenses', ['description' => 'TEST voided', 'category' => 'General', 'amount' => 99999, 'expense_date' => '2037-01-12', 'recorded_by' => 'test', 'voided' => 1]);
    ins($db, 'kitchen_expenses', ['description' => 'TEST Gas', 'category' => 'Kitchen', 'amount' => 2000, 'expense_date' => '2037-01-12', 'recorded_by' => 'test']);
    $EMP = ins($db, 'employees', ['full_name' => 'TEST Worker', 'position' => 'Waiter', 'salary' => 30000, 'active' => 1]);
    ins($db, 'salary_payments', ['employee_id' => $EMP, 'emp_name' => 'TEST Worker', 'gross_amount' => 30000, 'deducted_debt' => 0, 'net_amount' => 30000, 'payment_date' => '2037-01-15']);

    // ---- a cash shift: float 5000
    $SH = ins($db, 'shifts', ['user_id' => 999999, 'user_name' => 'TEST Cashier', 'device' => 'test', 'opening_float' => 5000, 'opened_at' => '2037-01-13 08:00:00', 'status' => 'open']);
    $db->prepare('UPDATE order_refunds SET shift_id = ? WHERE id = ?')->execute([$SH, $R]);
    $db->prepare("UPDATE expenses SET payment_method = 'Cash', shift_id = ? WHERE description = 'TEST Electricity' LIMIT 1")->execute([$SH]);
    // supplier: INV-2 (12000) only 5000 paid in cash on delivery, then 2000 paid later in cash
    $db->prepare("UPDATE inventory_purchases SET amount_paid = 5000, payment_method = 'Cash', shift_id = ? WHERE reference = 'INV-2'")->execute([$SH]);
    $db->prepare("UPDATE inventory_purchases SET amount_paid = 19200, payment_method = 'Bank', pack_qty = 2, pack_name = 'Crate', units_per_pack = 12 WHERE reference = 'INV-1'")->execute();
    ins($db, 'supplier_payments', ['supplier' => 'S1', 'amount' => 2000, 'method' => 'Cash', 'payment_date' => '2037-01-14', 'shift_id' => $SH, 'recorded_by' => 'test']);
    // cash book: owner took 1000, put 500 in, moved 700 from cash to MoMo
    ins($db, 'cash_movements', ['type' => 'owner_withdrawal', 'amount' => 1000, 'method' => 'Cash', 'note' => 'test', 'movement_date' => '2037-01-14', 'shift_id' => $SH, 'recorded_by' => 'test']);
    ins($db, 'cash_movements', ['type' => 'capital', 'amount' => 500, 'method' => 'Cash', 'note' => 'test', 'movement_date' => '2037-01-14', 'shift_id' => $SH, 'recorded_by' => 'test']);
    ins($db, 'cash_movements', ['type' => 'transfer', 'amount' => 700, 'method' => 'Cash', 'to_method' => 'MoMo', 'note' => 'test', 'movement_date' => '2037-01-14', 'shift_id' => $SH, 'recorded_by' => 'test']);
    ins($db, 'cash_movements', ['type' => 'loan_in', 'amount' => 99999, 'method' => 'Cash', 'note' => 'voided', 'movement_date' => '2037-01-14', 'shift_id' => $SH, 'recorded_by' => 'test', 'voided' => 1]);
    // a customer debt collected in cash during the shift
    ins($db, 'customer_debts', ['customer_name' => 'TEST Client', 'amount' => 800, 'debt_date' => '2037-01-02', 'status' => 'Paid', 'recorded_by' => 'test', 'paid_at' => '2037-01-14 12:00:00', 'paid_method' => 'Cash', 'paid_by' => 'test', 'shift_id' => $SH]);
    // physical count of the beer on the 15th: expected 25, counted 24
    $SC = ins($db, 'stock_counts', ['area' => 'bar_item', 'count_date' => '2037-01-15', 'counted_by' => 'test', 'applied' => 0]);
    ins($db, 'stock_count_lines', ['count_id' => $SC, 'item_id' => $A, 'item_name' => 'TEST Beer', 'unit' => 'pcs', 'expected' => 25, 'counted' => 24, 'variance' => -1, 'unit_cost' => 866.67]);

    // ---- payments received (T-1 paid in cash in the shift with a 1000 discount)
    ins($db, 'orders', ['order_number' => 'T-1', 'type' => 'takeaway', 'table_id' => 0, 'table_name' => 'TK', 'status' => 'paid', 'total' => 15000, 'discount' => 1000, 'discount_reason' => 'test', 'shift_id' => $SH, 'created_by' => 'test', 'payment_method' => 'Cash', 'paid_at' => '2037-01-13 21:00:00', 'voided' => 0]);
    ins($db, 'orders', ['order_number' => 'T-2', 'type' => 'takeaway', 'table_id' => 0, 'table_name' => 'TK', 'status' => 'paid', 'total' => 3000, 'created_by' => 'test', 'payment_method' => 'MoMo', 'paid_at' => '2037-01-11 21:00:00', 'voided' => 0]);

    $P = rpPeriod('custom', '2037-01-10', '2037-01-16');

    echo "== Sales, refunds, cost of goods sold, profit (combined)\n";
    $s = rpSummary($db, $P, 'all');
    check('gross sales = 15000 + 3000 + 15000 + 2000', $s['grossSales'], 35000);
    check('refunds', $s['refunds'], 1500);
    check('discounts recorded', $s['discounts'], 1000);
    check('net sales = gross − discounts − refunds', $s['netSales'], 32500);
    // 10×850 (recorded) + 2×866.6667 (estimated) − 850 (restocked refund) + 3×1600 (kitchen) ; TEST Plain has no cost
    check('cost of goods sold (stored average cost 866.67)', $s['cogs'], 8500 + 1733.34 - 850 + 4800);
    check('gross profit = net sales − COGS', $s['grossProfit'], 32500 - (8500 + 1733.34 - 850 + 4800));
    check('gross margin %', $s['grossMargin'], round((32500 - 14183.34) / 32500 * 100, 1), 0.05);
    check('operating expenses exclude voided, include kitchen + salary (5000+5000+12000+2000+30000)', $s['operatingExpenses'], 54000);
    check('net operating profit = gross profit − expenses', $s['netOperatingProfit'], 18316.66 - 54000);
    check('one line costed by estimate', $s['costEstimatedLines'], 1);
    check('one line with no cost', $s['costUnknownLines'], 1);

    echo "== Scopes do not double count\n";
    $bar = rpSummary($db, $P, 'bar'); $kit = rpSummary($db, $P, 'kitchen');
    check('bar gross', $bar['grossSales'], 18000);
    check('kitchen gross', $kit['grossSales'], 17000);
    check('bar + kitchen = combined gross', $bar['grossSales'] + $kit['grossSales'], $s['grossSales']);
    check('bar + kitchen COGS = combined COGS', $bar['cogs'] + $kit['cogs'], $s['cogs']);
    check('bar refunds only bar', $bar['refunds'], 1500);
    check('kitchen expenses only kitchen expense', $kit['operatingExpenses'], 2000);
    check('salaries only in combined view', $bar['operatingExpenses'] + $kit['operatingExpenses'] + 30000, $s['operatingExpenses']);

    echo "== Collections (cash) are separate from revenue\n";
    $c = rpCollections($db, $P);
    $m = array_column($c['byMethod'], null, 'method');
    check('cash received = bill − discount', $m['Cash']['received'] ?? null, 14000);
    check('cash refunded', $m['Cash']['refunded'] ?? null, 1500);
    check('MoMo received', $m['MoMo']['received'] ?? null, 3000);
    check('net collections', $c['net'], 15500);

    echo "== Stock ledger and valuation\n";
    $L = array_values(array_filter(rpStockLedger($db, $P, 'all'), fn($i) => $i['kind'] === 'bar_item' && $i['id'] === $A))[0];
    check('expected closing at period end (25 now, −2 sold after)', $L['expectedClosing'], 27);
    check('opening = closing − movements in period (27 − 25)', $L['opening'], 2);
    check('purchased in period', $L['flows']['purchased'], 36);
    check('sold in period', $L['flows']['sold'], 10);
    check('wasted in period', $L['flows']['wasted'], 1);
    check('unexplained stock (25 − 23)', $L['unexplained'], 2);
    check('closing value = 27 × 866.67', $L['closingValue'], round(27 * 866.67, 2));
    check('potential selling value = 27 × 1500', $L['sellValue'], 40500);
    check('potential profit = 27 × (1500 − 866.67)', $L['potentialProfit'], round(27 * (1500 - 866.67), 2));
    $K = array_values(array_filter(rpStockLedger($db, $P, 'kitchen'), fn($i) => $i['id'] === $K1))[0];
    check('meat closing 9.25 kg', $K['expectedClosing'], 9.25);
    check('meat used in recipes 0.75 kg', $K['flows']['usedInRecipes'], 0.75);
    check('meat value 9.25 × 6000', $K['closingValue'], 55500);
    check('meat fully explained by movements', $K['unexplained'], 0);
    check('ingredients have no selling value (raw stock)', $K['sellValue'], null);

    echo "== Product profitability\n";
    $prod = array_values(array_filter(rpProductReport($db, $P)['products'], fn($x) => $x['id'] === $A))[0];
    check('purchased qty in period', $prod['purchasedQty'], 36);
    check('purchased cost in period', $prod['purchasedCost'], 31200);
    check('weighted average cost = 31200 / 36', $prod['avgCost'], 866.67);
    check('cheapest cost', $prod['minCost'], 800);
    check('highest cost', $prod['maxCost'], 1000);
    check('profit per unit = 1500 − 866.67', $prod['profitPerUnit'], 633.33);
    check('margin % = 633.33 / 1500', $prod['margin'], 42.2, 0.05);
    check('qty sold', $prod['qtySold'], 12);
    check('net revenue = 18000 − 1500', $prod['netRevenue'], 16500);
    check('realized profit = 16500 − (8500 + 1733.34 − 850)', $prod['realizedProfit'], 16500 - 9383.34);
    check('cost increase is flagged', in_array('Cost increased', $prod['flags'], true), true);

    echo "== Kitchen and ingredient profitability\n";
    $k = rpKitchenReport($db, $P);
    $dish = array_values(array_filter($k['menu'], fn($x) => $x['id'] === $M))[0];
    check('portion cost = 0.25×6000 + 0.05×2000', $dish['portionCost'], 1600);
    check('profit per portion', $dish['profitPerPortion'], 3400);
    check('portion margin %', $dish['portionMargin'], 68.0);
    check('meat share of portion cost', array_column($dish['breakdown'], 'share', 'ingredient')['TEST Meat'] ?? null, 93.8, 0.05);
    check('ingredient cost booked against the dish (4500 + 300)', $dish['ingredientCost'], 4800);
    check('dish gross profit = 15000 − 4800', $dish['grossProfit'], 10200);
    $plain = array_values(array_filter($k['menu'], fn($x) => $x['id'] === $M2))[0];
    check('dish without recipe has unknown cost (not zero)', $plain['ingredientCost'], null);
    $meat = array_values(array_filter($k['ingredients'], fn($x) => $x['id'] === $K1))[0];
    check('meat used qty', $meat['usedQty'], 0.75);
    check('meat used cost', $meat['usedCost'], 4500);
    check('meat used in the dish recipe', in_array('TEST Dish', $meat['usedInRecipes'], true), true);
    check('ingredients do not get revenue (no revenue key)', array_key_exists('revenue', $meat), false);

    echo "== Purchases and expenses kept apart\n";
    $pr = rpPurchaseReport($db, $P);
    check('purchase total (bar 31200 + kitchen 60000) is not an expense', array_sum(array_map(fn($l) => str_starts_with($l['name'], 'TEST') ? $l['total'] : 0, $pr['lines'])), 91200);
    $ex = rpExpenseReport($db, $P);
    check('crate of beer flagged as possible stock purchase', count(array_filter($ex['possibleDoubleCount'], fn($e) => $e['description'] === 'TEST Crate of beer')), 1);
    check('expected cash from sales = cash received − cash refunds', $ex['cash']['expectedCashFromSales'], 12500);

    echo "== Discrepancies\n";
    $keys = array_column(rpIssues($db, $P), 'type', 'key');
    check('unexplained stock issue raised', isset($keys["unexplained:bar_item:$A"]), true);
    check('duplicate expense raised', in_array('Possible duplicate expense', $keys, true), true);
    check('dish without recipe raised', isset($keys["norecipe:$M2"]), true);
    check('stock-like expense raised', in_array('Stock bought as an expense?', $keys, true), true);
    $issue = array_values(array_filter(rpIssues($db, $P), fn($i) => $i['key'] === "unexplained:bar_item:$A"))[0];
    check('issue wording makes no accusation', (bool)preg_match('/theft|stole|fraud/i', $issue['evidence'] . $issue['title']), false);

    echo "== Overview figures match the detailed reports\n";
    $ov = rpOverview($db, $P, 'all');
    check('overview net sales = summary', $ov['current']['netSales'], $s['netSales']);
    check('overview COGS = summary', $ov['current']['cogs'], $s['cogs']);
    $salesRep = rpSalesReport($db, $P, 'all');
    check('sum of daily net sales = overview net sales', array_sum(array_column($salesRep['days'], 'net')), $ov['current']['netSales']);
    check('sum of daily cost = overview COGS', array_sum(array_column($salesRep['days'], 'cost')), $ov['current']['cogs']);
    check('overview supplier debts include S1 (12000 − 5000 − 2000)', $ov['supplierDebts'] >= 5000, true);

    echo "== Stage 2: shift cash, suppliers, counts, cash flow, refund limit\n";
    $shiftRow = rpRows($db, 'SELECT * FROM shifts WHERE id = ?', [$SH])[0];
    $cash = rpShiftCash($db, $shiftRow);
    check('shift cash sales (15000 − 1000 discount)', $cash['cashSales'], 14000);
    check('shift cash refunds', $cash['refunds'], 1500);
    check('shift cash expenses', $cash['expenses'], 5000);
    check('shift supplier cash (5000 on delivery + 2000 later)', $cash['supplierPayments'], 7000);
    check('shift cash out (1000 withdrawal + 700 moved to MoMo)', $cash['cashOut'], 1700);
    check('shift cash in (500 capital; voided loan ignored)', $cash['cashIn'], 500);
    check('shift debt collected in cash', $cash['debtCollections'], 800);
    // 5000 + 14000 + 800 + 500 − 1500 − 5000 − 7000 − 1700
    check('expected cash in the drawer', $cash['expected'], 5100);
    $db->prepare("UPDATE shifts SET status = 'closed', closed_at = '2037-01-14 23:00:00', expected_cash = ?, counted_cash = 5000, difference = -100, close_note = 'test' WHERE id = ?")->execute([$cash['expected'], $SH]);
    $ho = rpCashHandover(rpShifts($db, $P));
    check('handover expected', $ho['expected'], 5100);
    check('handover counted', $ho['counted'], 5000);
    check('handover difference (short 100)', $ho['difference'], -100);
    $keys = array_column(rpIssues($db, $P), 'type', 'key');
    check('cash difference raised as an issue', isset($keys["shiftdiff:$SH"]), true);

    $bal = array_column(rpSupplierBalances($db), null, 'supplier')['S1'] ?? null;
    check('supplier bought 31200', $bal['bought'] ?? null, 31200);
    check('supplier paid on delivery 24200', $bal['paidOnDelivery'] ?? null, 24200);
    check('supplier paid later 2000', $bal['paidLater'] ?? null, 2000);
    check('supplier balance owed 5000', $bal['balance'] ?? null, 5000);
    $pl = array_column(rpPurchaseLines($db, $P), null, 'reference');
    check('purchase owed on INV-2', $pl['INV-2']['owed'] ?? null, 7000);
    check('crate purchase shown in packs', $pl['INV-1']['packs'] ?? null, '2 Crate × 12');

    $L2 = array_values(array_filter(rpStockLedger($db, $P, 'all'), fn($i) => $i['kind'] === 'bar_item' && $i['id'] === $A))[0];
    check('physical count shown in ledger', $L2['physicalCount'], 24);
    check('count variance', $L2['variance'], -1);
    check('count variance value', $L2['varianceValue'], -866.67);

    $cf = rpCashFlow($db, $P);
    $cfm = array_column($cf['byMethod'], null, 'method');
    // cash in: 14000 sales + 800 debt + 500 capital ; cash out: 1500 refund + 5000 expense + 5000 + 2000 suppliers + 1000 withdrawal + 700 transfer
    check('cash flow: cash in', $cfm['Cash']['in'] ?? null, 15300);
    check('cash flow: cash out', $cfm['Cash']['out'] ?? null, 15200);
    check('cash flow: MoMo in includes the transfer (3000 sales + 700)', $cfm['MoMo']['in'] ?? null, 3700);
    check('cash flow total net = in − out', $cf['net'], round($cf['in'] - $cf['out'], 2));
    check('owner withdrawal does not change profit', rpSummary($db, $P)['netOperatingProfit'], 18316.66 - 54000);

    echo "== Stock movement records, kitchen queue, cash book\n";
    $mv = array_values(array_filter(rpStockMovements($db, $P, 'all')['rows'], fn($r) => $r['kind'] === 'Drink' && $r['name'] === 'TEST Beer'));
    check('movement records add up to the ledger change', round(array_sum(array_column($mv, 'qty')), 3), round($L2['expectedClosing'] - $L2['opening'], 3));
    $k1 = ins($db, 'kitchen_orders', ['order_id' => 0, 'order_number' => 'TQ-1', 'status' => 'served', 'estimated_minutes' => 10, 'created_at' => '2037-01-15 12:00:00',
        'accepted_at' => '2037-01-15 12:02:00', 'preparing_at' => '2037-01-15 12:03:00', 'ready_at' => '2037-01-15 12:09:00', 'served_at' => '2037-01-15 12:10:00']);
    ins($db, 'kitchen_orders', ['order_id' => 0, 'order_number' => 'TQ-2', 'status' => 'served', 'estimated_minutes' => 10, 'created_at' => '2037-01-15 13:00:00',
        'accepted_at' => '2037-01-15 13:01:00', 'preparing_at' => '2037-01-15 13:01:00', 'ready_at' => '2037-01-15 13:25:00', 'served_at' => '2037-01-15 13:30:00']);
    ins($db, 'kitchen_orders', ['order_id' => 0, 'order_number' => 'TQ-3', 'status' => 'rejected', 'estimated_minutes' => 10, 'created_at' => '2037-01-15 13:30:00', 'reject_reason' => 'no gas']);
    ins($db, 'kitchen_order_items', ['kitchen_order_id' => $k1, 'product_name' => 'TEST Dish', 'qty' => 2]);
    $q = rpKitchenQueue($db, $P)['summary'];
    check('queue: tickets', $q['tickets'], 3);
    check('queue: rejected', $q['rejected'], 1);
    check('queue: typical time to ready = median of 9 and 25', $q['avgReadyIn'], 17);
    check('queue: one of two ready late', $q['late'], 1);
    check('queue: on time %', $q['onTimePct'], 50);
    $cbk = rpCashBook($db, $P)['totals'];
    check('cash book: capital', $cbk['capital'], 500);
    check('cash book: voided loan not counted', $cbk['loansIn'], 0);
    check('cash book: voided entries counted', $cbk['voided'], 1);

    echo "== Business worth\n";
    $wd = '2037-01-20';
    $w0 = rpBusinessWorth($db, $wd);
    ins($db, 'cash_movements', ['type' => 'capital', 'amount' => 80000, 'method' => 'Bank', 'note' => 'test', 'movement_date' => $wd, 'recorded_by' => 'test']);
    $w1 = rpBusinessWorth($db, $wd);
    check('new capital raises the worth by its amount', $w1['worth'] - $w0['worth'], 80000);
    check('new capital counts as put in by the owner', $w1['owner']['putIn'] - $w0['owner']['putIn'], 80000);
    ins($db, 'cash_movements', ['type' => 'loan_in', 'amount' => 60000, 'method' => 'Bank', 'note' => 'test', 'movement_date' => $wd, 'recorded_by' => 'test']);
    $w2 = rpBusinessWorth($db, $wd);
    check('a loan adds money', $w2['money'] - $w1['money'], 60000);
    check('a loan does not change the worth', $w2['worth'] - $w1['worth'], 0);
    ins($db, 'cash_movements', ['type' => 'asset_purchase', 'amount' => 30000, 'method' => 'Cash', 'note' => 'test', 'movement_date' => $wd, 'recorded_by' => 'test']);
    ins($db, 'business_assets', ['name' => 'TEST fridge', 'value' => 30000, 'acquired_date' => $wd, 'funded_by' => 'business', 'method' => 'Cash', 'recorded_by' => 'test']);
    $w3 = rpBusinessWorth($db, $wd);
    check('equipment bought with business money: worth unchanged', $w3['worth'] - $w2['worth'], 0);
    check('equipment bought with business money: cash down', $w3['money'] - $w2['money'], -30000);
    ins($db, 'business_assets', ['name' => 'TEST chairs', 'value' => 20000, 'acquired_date' => $wd, 'funded_by' => 'owner', 'recorded_by' => 'test']);
    $w4 = rpBusinessWorth($db, $wd);
    check('equipment brought in by the owner raises the worth', $w4['worth'] - $w3['worth'], 20000);
    ins($db, 'cash_movements', ['type' => 'opening_balance', 'amount' => 5000, 'method' => 'MoMo', 'note' => 'test', 'movement_date' => $wd, 'recorded_by' => 'test']);
    $w5 = rpBusinessWorth($db, $wd);
    check('starting balance adds to money', $w5['money'] - $w4['money'], 5000);
    check('starting balance is not cash flow', rpCashFlow($db, ['from' => $wd, 'to' => $wd])['in'], 60000 + 80000);
    ins($db, 'cash_movements', ['type' => 'owner_withdrawal', 'amount' => 7000, 'method' => 'Cash', 'note' => 'test', 'movement_date' => $wd, 'recorded_by' => 'test']);
    $w6 = rpBusinessWorth($db, $wd);
    check('owner withdrawal lowers the worth', $w6['worth'] - $w5['worth'], -7000);
    check('what the business kept is unchanged by owner money', $w6['owner']['keptByBusiness'], $w0['owner']['keptByBusiness']);
    check('worth = owns − owes', $w6['worth'], round($w6['owns'] - $w6['owes'], 2));

    // refunds can never exceed what was paid after the discount (15000 − 1000 − 1500 already refunded = 12500 left)
    $T1 = (int)rpVal($db, "SELECT id FROM orders WHERE order_number = 'T-1' AND table_name = 'TK' ORDER BY id DESC LIMIT 1");
    $db->prepare('UPDATE order_refunds SET order_id = ? WHERE id = ?')->execute([$T1, $R]);
    $OI = ins($db, 'order_items', ['order_id' => $T1, 'product_id' => $A, 'product_name' => 'TEST Beer', 'qty' => 10, 'unit_price' => 1500, 'total' => 15000, 'source_type' => 'bar', 'source_id' => $A, 'category' => 'Drink', 'added_by' => 'test']);
    $threw = ''; try { planRefund($db, $T1, [['orderItemId' => $OI, 'qty' => 9]]); } catch (RuntimeException $e) { $threw = $e->getMessage(); }
    check('refund of 13500 refused (only 12500 left after discount)', str_contains($threw, 'more than what is left'), true);
    $ok = planRefund($db, $T1, [['orderItemId' => $OI, 'qty' => 8]]);
    check('refund of 12000 allowed', $ok['amount'], 12000);
} finally {
    $db->rollBack();
}
$left = (int)rpVal($db, "SELECT (SELECT COUNT(*) FROM bar_items WHERE name LIKE 'TEST %') + (SELECT COUNT(*) FROM kitchen_ingredients WHERE name LIKE 'TEST %') + (SELECT COUNT(*) FROM expenses WHERE description LIKE 'TEST %') + (SELECT COUNT(*) FROM business_assets WHERE name LIKE 'TEST %') + (SELECT COUNT(*) FROM kitchen_orders WHERE order_number LIKE 'TQ-%')");
check('fixture fully rolled back', $left, 0);

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
