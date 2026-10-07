<?php
// ============================================================
//  api/stockcount.php — physical stock counts
//  GET  action=sheet  { area }       items to count with expected quantities
//  POST action=save   { area, date, note, lines:[{id, counted}], apply }
//  GET  action=list                  recent counts
//  GET  action=get    { id }         one count with its lines
//  area = bar_item | bar_ingredient | kitchen_ingredient
//  "apply" sets stock to the counted quantity through a recorded
//  'count' movement (never a silent change). Needs canEditStock.
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/report_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
$action = $_REQUEST['action'] ?? 'sheet';
$sess   = requireRole(['Owner', 'Manager', 'Kitchen']);
$db     = getDB();

const SC_AREAS = [
    'bar_item'           => ['table' => 'bar_items',           'qty' => 'stock',    'cost' => 'cost_price',    'where' => "type = 'direct' AND active = 1", 'unit' => "'pcs'"],
    'bar_ingredient'     => ['table' => 'bar_ingredients',     'qty' => 'quantity', 'cost' => 'cost_per_unit', 'where' => '1=1', 'unit' => 'unit'],
    'kitchen_ingredient' => ['table' => 'kitchen_ingredients', 'qty' => 'quantity', 'cost' => 'cost_per_unit', 'where' => '1=1', 'unit' => 'unit'],
];
$area = $_REQUEST['area'] ?? '';
if (in_array($action, ['sheet', 'save'], true)) {
    $body = $action === 'save' ? (json_decode(file_get_contents('php://input'), true) ?? []) : [];
    $area = $body['area'] ?? $area;
    if (!isset(SC_AREAS[$area])) jsonOut(['ok' => false, 'error' => 'Choose what to count'], 400);
    // the kitchen counts only kitchen ingredients
    if ($sess['role'] === 'Kitchen' && $area !== 'kitchen_ingredient') jsonOut(['ok' => false, 'error' => 'Access denied'], 403);
}

if ($action === 'sheet') {
    $a = SC_AREAS[$area];
    $rows = $db->query("SELECT id, name, {$a['qty']} AS expected, {$a['unit']} AS unit, {$a['cost']} AS unit_cost FROM {$a['table']} WHERE {$a['where']} ORDER BY name")->fetchAll();
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['expected'] = (float)$r['expected']; $r['unit_cost'] = (float)$r['unit_cost']; }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'save') {
    $a     = SC_AREAS[$area];
    $date  = trim($body['date'] ?? date('Y-m-d'));
    $note  = mb_substr(trim($body['note'] ?? ''), 0, 255);
    $apply = !empty($body['apply']);
    $lines = is_array($body['lines'] ?? null) ? $body['lines'] : [];
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) jsonOut(['ok' => false, 'error' => 'Enter a valid date'], 400);
    $lines = array_values(array_filter($lines, fn($l) => isset($l['counted']) && $l['counted'] !== '' && $l['counted'] !== null));
    if (!$lines) jsonOut(['ok' => false, 'error' => 'Enter at least one counted quantity'], 400);
    if ($apply && !hasPerm('canEditStock')) jsonOut(['ok' => false, 'error' => 'You can save the count, but only the Owner or a manager allowed to edit stock can apply it'], 403);

    $db->beginTransaction();
    try {
        $db->prepare('INSERT INTO stock_counts (area, count_date, counted_by, note, applied, applied_by) VALUES (?,?,?,?,?,?)')
           ->execute([$area, $date, $sess['full_name'], $note ?: null, $apply ? 1 : 0, $apply ? $sess['full_name'] : null]);
        $countId = (int)$db->lastInsertId();
        $get = $db->prepare("SELECT id, name, {$a['qty']} AS qty, {$a['unit']} AS unit, {$a['cost']} AS cost FROM {$a['table']} WHERE id = ? AND {$a['where']} FOR UPDATE");
        $totalVar = 0.0; $n = 0;
        foreach ($lines as $l) {
            $counted = round((float)$l['counted'], 3);
            if ($counted < 0) throw new RuntimeException('Counted quantities cannot be negative');
            $get->execute([(int)$l['id']]);
            $it = $get->fetch();
            if (!$it) throw new RuntimeException('An item on the count sheet was not found');
            $expected = (float)$it['qty'];
            $variance = round($counted - $expected, 3);
            $db->prepare('INSERT INTO stock_count_lines (count_id, item_id, item_name, unit, expected, counted, variance, unit_cost) VALUES (?,?,?,?,?,?,?,?)')
               ->execute([$countId, $it['id'], $it['name'], $it['unit'], $expected, $counted, $variance, $it['cost']]);
            $n++;
            $totalVar += $variance * (float)$it['cost'];
            if ($apply && abs($variance) > 0.0005) {
                $db->prepare("UPDATE {$a['table']} SET {$a['qty']} = ? WHERE id = ?")->execute([$counted, $it['id']]);
                $reason = "Stock count #$countId on $date";
                $cost = round(abs($variance) * (float)$it['cost'], 2);
                if ($area === 'kitchen_ingredient') {
                    $db->prepare('INSERT INTO kitchen_stock_movements (ingredient_id, qty, type, reason, amount, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?)')
                       ->execute([$it['id'], $variance, 'count', $reason, $cost, $it['cost'], $cost, $sess['full_name']]);
                } else {
                    $col = $area === 'bar_item' ? 'item_id' : 'ingredient_id';
                    $db->prepare("INSERT INTO bar_movements (item_name, $col, qty_change, type, reason, unit, unit_cost, total_cost, done_by) VALUES (?,?,?,?,?,?,?,?,?)")
                       ->execute([$it['name'], $it['id'], $variance, 'count', $reason, $it['unit'], $it['cost'], $cost, $sess['full_name']]);
                }
            }
        }
        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['STOCK_COUNT', "Stock count #$countId ($area, $n items, variance value RWF " . round($totalVar, 2) . ')' . ($apply ? ' — stock adjusted to the count' : ' — saved without adjusting stock'), $sess['full_name']]);
        $db->commit();
        jsonOut(['ok' => true, 'id' => $countId, 'items' => $n, 'varianceValue' => round($totalVar, 2), 'applied' => $apply]);
    } catch (RuntimeException $e) {
        $db->rollBack();
        jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e, 'The stock count');
    }
}

if ($action === 'status') {
    $status = rpStockCountStatus($db);
    if ($sess['role'] === 'Kitchen') $status = array_values(array_filter($status, fn($s) => $s['area'] === 'kitchen_ingredient'));
    jsonOut(['ok' => true, 'every' => rpStockCountInterval($db), 'data' => $status]);
}

if ($action === 'list') {
    $rows = $db->query('SELECT sc.*, COUNT(l.id) AS items, COALESCE(SUM(l.variance * l.unit_cost),0) AS variance_value,
            SUM(ABS(l.variance) > 0.0005) AS differing
        FROM stock_counts sc LEFT JOIN stock_count_lines l ON l.count_id = sc.id GROUP BY sc.id ORDER BY sc.id DESC LIMIT 50')->fetchAll();
    jsonOut(['ok' => true, 'data' => $rows]);
}

if ($action === 'get') {
    $id = (int)($_GET['id'] ?? 0);
    $st = $db->prepare('SELECT * FROM stock_count_lines WHERE count_id = ? ORDER BY item_name');
    $st->execute([$id]);
    jsonOut(['ok' => true, 'data' => $st->fetchAll()]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
