<?php
// ============================================================
//  api/employees.php — Staff, Employee Debts, Salary
//  GET  action=list
//  POST action=save        { id?, fullName, position, phone, salary }
//  POST action=debt_save   { empId, amount, note }
//  GET  action=debt_list
//  POST action=debt_paid   { id }
//  POST action=salary_pay  { empId, amount, note }
//  GET  action=salary_list
// ============================================================
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/report_lib.php';
if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();

$action = $_REQUEST['action'] ?? 'list';
$db     = getDB();

// ── LIST EMPLOYEES ────────────────────────────────────────────
if ($action === 'list') {
    requireAuth();
    $stmt = $db->query('SELECT e.*, u.username, u.role AS user_role, u.full_name AS user_name, u.active AS user_active
                        FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.active = 1 ORDER BY e.full_name ASC');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['userId']   = $r['user_id'] ? (int)$r['user_id'] : null;
        $r['id']       = (int)$r['id'];
        $r['salary']   = (float)$r['salary'];
        $r['active']   = (bool)$r['active'];
        $r['fullName'] = $r['full_name'];
        $r['hireDate'] = $r['hire_date'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── SAVE EMPLOYEE ─────────────────────────────────────────────
// BarMS logins that can be linked to an employee
if ($action === 'linkable_users') {
    requirePerm('canViewEmployees');
    $rows = $db->query('SELECT u.id, u.full_name, u.username, u.role, e.id AS employee_id, e.full_name AS employee_name
                        FROM users u LEFT JOIN employees e ON e.user_id = u.id AND e.active = 1 WHERE u.active = 1 ORDER BY u.full_name')->fetchAll();
    jsonOut(['ok' => true, 'data' => $rows]);
}

// What a linked employee did in a period
if ($action === 'performance') {
    requirePerm('canViewEmployees');
    $empId = (int)($_GET['employeeId'] ?? 0);
    $st = $db->prepare('SELECT id, full_name, position, user_id FROM employees WHERE id = ?');
    $st->execute([$empId]);
    $emp = $st->fetch();
    if (!$emp) jsonOut(['ok' => false, 'error' => 'Employee not found'], 404);
    if (!$emp['user_id']) jsonOut(['ok' => false, 'error' => 'Link this employee to their BarMS account to see their performance'], 400);
    try { $P = rpPeriod($_GET['preset'] ?? 'this_month', $_GET['from'] ?? null, $_GET['to'] ?? null); }
    catch (InvalidArgumentException $e) { jsonOut(['ok' => false, 'error' => $e->getMessage()], 400); }
    $perf = rpStaffPerformance($db, $P, (int)$emp['user_id']);
    if (!$perf) jsonOut(['ok' => false, 'error' => 'The linked BarMS account no longer exists'], 400);
    jsonOut(['ok' => true, 'period' => $P, 'employee' => ['id' => (int)$emp['id'], 'name' => $emp['full_name'], 'position' => $emp['position']], 'data' => $perf]);
}

if ($action === 'save') {
    requirePerm('canViewEmployees');
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);

    $id       = (int)($body['id'] ?? 0);
    $fullName = trim($body['fullName'] ?? '');
    $position = trim($body['position'] ?? '');
    $phone    = trim($body['phone'] ?? '');
    $salary   = (float)($body['salary'] ?? 0);
    $userId   = (int)($body['userId'] ?? 0) ?: null;

    if (!$fullName) jsonOut(['ok' => false, 'error' => 'Name required'], 400);
    if ($userId) {
        $u = $db->prepare('SELECT id FROM users WHERE id = ? AND active = 1');
        $u->execute([$userId]);
        if (!$u->fetch()) jsonOut(['ok' => false, 'error' => 'That BarMS account does not exist'], 400);
        $taken = $db->prepare('SELECT full_name FROM employees WHERE user_id = ? AND id <> ? AND active = 1');
        $taken->execute([$userId, $id]);
        if ($other = $taken->fetchColumn()) jsonOut(['ok' => false, 'error' => "That account is already linked to $other"], 409);
        // a removed employee may still hold the link
        $db->prepare('UPDATE employees SET user_id = NULL WHERE user_id = ? AND id <> ? AND active = 0')->execute([$userId, $id]);
    }

    if ($id > 0) {
        $db->prepare('UPDATE employees SET full_name=?, position=?, phone=?, salary=?, user_id=? WHERE id=?')
           ->execute([$fullName, $position, $phone, $salary, $userId, $id]);
        jsonOut(['ok' => true, 'id' => $id]);
    } else {
        $db->prepare('INSERT INTO employees (full_name, position, phone, salary, hire_date, user_id) VALUES (?,?,?,?,?,?)')
           ->execute([$fullName, $position, $phone, $salary, date('Y-m-d'), $userId]);
        jsonOut(['ok' => true, 'id' => (int)$db->lastInsertId()]);
    }
}

// ── LIST EMPLOYEE DEBTS ───────────────────────────────────────
if ($action === 'debt_list') {
    requireAuth();
    // every unpaid advance, plus the settled ones of the last 12 months
    $stmt = $db->query("SELECT * FROM employee_debts WHERE status = 'Pending' OR debt_date >= CURDATE() - INTERVAL 12 MONTH ORDER BY id DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']         = (int)$r['id'];
        $r['employee_id']= (int)$r['employee_id'];
        $r['amount']     = (float)$r['amount'];
        $r['empId']      = $r['employee_id'];
        $r['empName']    = $r['emp_name'];
        $r['date']       = $r['debt_date'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

// ── SAVE DEBT ─────────────────────────────────────────────────
if ($action === 'debt_save') {
    requirePerm('canViewEmployees');
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);

    $empId  = (int)($body['empId'] ?? 0);
    $amount = (float)($body['amount'] ?? 0);
    $note   = trim($body['note'] ?? 'Advance');

    if (!$empId || $amount <= 0) jsonOut(['ok' => false, 'error' => 'Invalid data'], 400);

    $stmt = $db->prepare('SELECT full_name FROM employees WHERE id = ?');
    $stmt->execute([$empId]);
    $emp = $stmt->fetch();
    if (!$emp) jsonOut(['ok' => false, 'error' => 'Employee not found'], 404);

    $db->prepare('INSERT INTO employee_debts (employee_id, emp_name, amount, note, debt_date) VALUES (?,?,?,?,?)')
       ->execute([$empId, $emp['full_name'], $amount, $note, date('Y-m-d')]);

    jsonOut(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}

// ── MARK DEBT PAID ────────────────────────────────────────────
if ($action === 'debt_paid') {
    requirePerm('canViewEmployees');
    $body = json_decode(file_get_contents('php://input'), true);
    $id   = (int)($body['id'] ?? 0);
    if (!$id) jsonOut(['ok' => false, 'error' => 'Invalid id'], 400);
    $db->prepare("UPDATE employee_debts SET status='Paid' WHERE id=?")->execute([$id]);
    jsonOut(['ok' => true]);
}

// ── PAY SALARY ────────────────────────────────────────────────
if ($action === 'salary_pay') {
    requirePerm('canPaySalaries');
    $sess = $_SESSION;
    $body = json_decode(file_get_contents('php://input'), true);

    $empId = (int)($body['empId'] ?? 0);
    $gross = (float)($body['amount'] ?? 0);
    $note  = trim($body['note'] ?? 'Salary payment');

    if (!$empId || $gross <= 0) jsonOut(['ok' => false, 'error' => 'Invalid data'], 400);

    $stmt = $db->prepare('SELECT full_name FROM employees WHERE id = ?');
    $stmt->execute([$empId]);
    $emp = $stmt->fetch();
    if (!$emp) jsonOut(['ok' => false, 'error' => 'Employee not found'], 404);

    // Get unpaid debts
    $dStmt = $db->prepare("SELECT SUM(amount) AS total FROM employee_debts WHERE employee_id=? AND status='Pending'");
    $dStmt->execute([$empId]);
    $debtTotal = (float)($dStmt->fetch()['total'] ?? 0);
    $netPay    = max(0, $gross - $debtTotal);

    $db->beginTransaction();
    try {
        $db->prepare('INSERT INTO salary_payments (employee_id, emp_name, gross_amount, deducted_debt, net_amount, note, payment_date) VALUES (?,?,?,?,?,?,?)')
           ->execute([$empId, $emp['full_name'], $gross, $debtTotal, $netPay, $note, date('Y-m-d')]);

        if ($debtTotal > 0) {
            $db->prepare("UPDATE employee_debts SET status='Paid' WHERE employee_id=? AND status='Pending'")->execute([$empId]);
        }

        $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')
           ->execute(['SALARY', "Paid salary to {$emp['full_name']}: Gross RWF $gross, Deductions RWF $debtTotal, Net RWF $netPay", $sess['full_name']]);

        $db->commit();
        jsonOut(['ok' => true, 'netPay' => $netPay, 'debtTotal' => $debtTotal]);
    } catch (Exception $e) {
        $db->rollBack();
        serverFail($e);
    }
}

// ── SALARY HISTORY ────────────────────────────────────────────
if ($action === 'salary_list') {
    requireAuth();
    // the last 24 months of salary payments; older ones are in Reports
    $stmt = $db->query('SELECT * FROM salary_payments WHERE payment_date >= CURDATE() - INTERVAL 24 MONTH ORDER BY id DESC');
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']           = (int)$r['id'];
        $r['employee_id']  = (int)$r['employee_id'];
        $r['gross_amount'] = (float)$r['gross_amount'];
        $r['deducted_debt']= (float)$r['deducted_debt'];
        $r['net_amount']   = (float)$r['net_amount'];
        $r['empName']      = $r['emp_name'];
        $r['amount']       = $r['net_amount'];
        $r['deductedDebt'] = $r['deducted_debt'];
        $r['date']         = $r['payment_date'];
    }
    unset($r);
    jsonOut(['ok' => true, 'data' => $rows]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
