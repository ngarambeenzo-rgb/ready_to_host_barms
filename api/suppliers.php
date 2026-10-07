<?php
// ============================================================
//  api/suppliers.php — what each supplier is owed
//  GET  action=list                     balances per supplier
//  GET  action=history  { supplier }    purchases + payments for one supplier
//  POST action=pay      { supplier, amount, method, reference, note, date }
//  Balance = purchases − paid on delivery − later payments.
//  Purchases with no payment recorded (made before payments were tracked)
//  are treated as paid, never as a debt.
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/report_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
$action = $_REQUEST['action'] ?? 'list';
$sess   = requirePerm('canEditStock');
$db     = getDB();

if ($action === 'list') {
    jsonOut(['ok' => true, 'data' => rpSupplierBalances($db)]);
}

if ($action === 'history') {
    $name = trim($_GET['supplier'] ?? '');
    if ($name === '') jsonOut(['ok' => false, 'error' => 'supplier required'], 400);
    $purchases = rpRows($db, 'SELECT purchase_date AS date, item_name, quantity, unit, total_cost, amount_paid, payment_method, reference, recorded_by FROM inventory_purchases WHERE LOWER(TRIM(supplier)) = LOWER(?) ORDER BY purchase_date DESC, id DESC', [$name]);
    $payments  = rpRows($db, 'SELECT payment_date AS date, amount, method, reference, note, recorded_by FROM supplier_payments WHERE LOWER(TRIM(supplier)) = LOWER(?) ORDER BY payment_date DESC, id DESC', [$name]);
    jsonOut(['ok' => true, 'purchases' => $purchases, 'payments' => $payments]);
}

if ($action === 'pay') {
    requirePerm('canRecordExpenses'); // paying a supplier is money going out
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $supplier = trim($body['supplier'] ?? '');
    $amount   = round((float)($body['amount'] ?? 0), 2);
    $date     = trim($body['date'] ?? date('Y-m-d'));
    if ($supplier === '' || $amount <= 0) jsonOut(['ok' => false, 'error' => 'Supplier and amount are required'], 400);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) jsonOut(['ok' => false, 'error' => 'Enter a valid date'], 400);
    $owed = 0.0;
    foreach (rpSupplierBalances($db) as $b) if (strcasecmp($b['supplier'], $supplier) === 0) $owed = $b['balance'];
    if ($amount > $owed + 0.001) jsonOut(['ok' => false, 'error' => 'This is more than what is owed to ' . $supplier . ' (RWF ' . number_format($owed) . ')'], 400);
    $method = cleanMethod($body['method'] ?? 'Cash');
    $db->prepare('INSERT INTO supplier_payments (supplier, amount, method, reference, note, payment_date, shift_id, recorded_by) VALUES (?,?,?,?,?,?,?,?)')
       ->execute([$supplier, $amount, $method, trim($body['reference'] ?? '') ?: null, trim($body['note'] ?? '') ?: null, $date, currentShiftId(), $sess['full_name']]);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['SUPPLIER_PAYMENT', "Paid $supplier RWF $amount via $method", $sess['full_name']]);
    jsonOut(['ok' => true]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
