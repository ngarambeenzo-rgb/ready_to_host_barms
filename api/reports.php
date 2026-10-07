<?php
// ============================================================
//  api/reports.php — Advanced Reports
//  GET  action=overview|sales|products|stock|kitchen|purchases|expenses|worth|issues|quality
//       preset=today|yesterday|this_week|last_week|this_month|last_month|custom
//       from, to (custom), scope=all|bar|kitchen, staff (sales only)
//       detail=all → every record. Without it the long record lists are shortened for the screen
//       (totals and summaries always cover everything): sales lines are left out (the drill-down asks
//       for them), stock movement records and kitchen tickets are the newest REPORT_SCREEN_ROWS.
//       'limited' in the answer says which lists were shortened: {list: {shown, total}}.
//  POST action=issue_update { key, status, note }
//  All figures come from api/report_lib.php.
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/report_lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? 'overview';
$sess   = requirePerm('canViewReports');
$db     = getDB();

if ($action === 'issue_update') {
    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $key    = trim($body['key'] ?? '');
    $status = $body['status'] ?? '';
    $note   = trim($body['note'] ?? '');
    if ($key === '' || !in_array($status, ['open', 'review', 'resolved', 'dismissed'], true)) jsonOut(['ok' => false, 'error' => 'Invalid issue update'], 400);
    if (in_array($status, ['resolved', 'dismissed'], true) && $note === '') jsonOut(['ok' => false, 'error' => 'Write a note explaining the resolution'], 400);
    $db->prepare('INSERT INTO report_issues (issue_key, status, note, reviewed_by) VALUES (?,?,?,?)
                  ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), reviewed_by = VALUES(reviewed_by)')
       ->execute([mb_substr($key, 0, 191), $status, mb_substr($note, 0, 500), $sess['full_name']]);
    $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
       ->execute(['REPORT_ISSUE', "Issue $key marked $status" . ($note ? ": $note" : ''), $sess['full_name']]);
    jsonOut(['ok' => true]);
}

try {
    $P = rpPeriod($_GET['preset'] ?? 'today', $_GET['from'] ?? null, $_GET['to'] ?? null);
} catch (InvalidArgumentException $e) {
    jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
}
$scope = $_GET['scope'] ?? 'all';
if (!in_array($scope, ['all', 'bar', 'kitchen'], true)) $scope = 'all';
$staff = trim($_GET['staff'] ?? '') ?: null;

const REPORT_SCREEN_ROWS = 300;
$detailAll = ($_GET['detail'] ?? '') === 'all';
$limited = [];
// keep the first $n rows (the lists are newest first) and note how many there were
$shorten = function (array $rows, string $name, int $n) use (&$limited, $detailAll): array {
    if ($detailAll || count($rows) <= $n) return $rows;
    $limited[$name] = ['shown' => $n, 'total' => count($rows)];
    return array_slice($rows, 0, $n);
};

switch ($action) {
    case 'overview':  $data = rpOverview($db, $P, $scope, $staff); break;
    case 'sales':
        $data = rpSalesReport($db, $P, $scope, $staff);
        if (!$detailAll) { $limited['lines'] = ['shown' => 0, 'total' => count($data['lines'])]; $data['lines'] = []; }
        break;
    case 'products':  $data = rpProductReport($db, $P); break;
    case 'stock':
        $ledger = rpStockLedger($db, $P, $scope);
        $data = ['items' => $ledger, 'summary' => rpStockSummary($ledger), 'movements' => rpStockMovements($db, $P, $scope)];
        $data['movements']['rows'] = $shorten($data['movements']['rows'], 'movements', REPORT_SCREEN_ROWS);
        break;
    case 'kitchen':
        $data = rpKitchenReport($db, $P) + ['queue' => rpKitchenQueue($db, $P)];
        $data['queue']['rows'] = $shorten($data['queue']['rows'], 'queue', REPORT_SCREEN_ROWS);
        break;
    case 'purchases': $data = rpPurchaseReport($db, $P, $scope); break;
    case 'expenses':
        $data = rpExpenseReport($db, $P, $scope);
        // the cash book (capital, withdrawals, loans) is the owner's own money: Owner only
        $data['cashBook'] = $sess['role'] === 'Owner' ? rpCashBook($db, $P) : null;
        break;
    case 'worth':
        // what the business owns and owes is the owner's information
        if ($sess['role'] !== 'Owner') jsonOut(['ok' => false, 'error' => 'Only the Owner can see what the business is worth'], 403);
        $data = rpWorthReport($db, $P);
        break;
    case 'issues':    $data = ['issues' => rpIssues($db, $P)]; break;
    case 'quality':   $data = rpDataQuality($db, $P); break;
    default: jsonOut(['ok' => false, 'error' => 'Unknown report'], 400);
}
jsonOut(['ok' => true, 'period' => $P, 'scope' => $scope, 'generatedAt' => date('Y-m-d H:i:s'), 'data' => $data, 'limited' => $limited ?: (object)[]]);
