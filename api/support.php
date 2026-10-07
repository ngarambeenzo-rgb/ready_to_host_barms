<?php
// ============================================================
//  api/support.php — "Help & support": the Owner writes to IMS from BarMS.
//  POST action=send   {category, subject, message, contact, clientId, deviceUuid}   Owner
//  POST action=resend {id, clientId, deviceUuid}                                   Owner
//  GET  action=list                                                                Owner
//
//  The message goes to the IMS server (ims_config.json → ims_url, api/support.php).
//  IMS decides who receives it: the addresses in IMS → Settings → Email & alerts.
//  Nothing about email is configured in BarMS, so changing addresses in IMS
//  applies to every bar at once. A copy is kept here with its delivery status.
// ============================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
$action = $_REQUEST['action'] ?? '';
$sess   = requireRole(['Owner']);
$db     = getDB();
$body   = $_SERVER['REQUEST_METHOD'] === 'POST' ? (json_decode(file_get_contents('php://input'), true) ?: []) : [];

const SUPPORT_CATEGORIES = ['problem' => 'Something is not working', 'question' => 'Question', 'licence' => 'Licence or payment', 'idea' => 'Idea / new feature', 'other' => 'Other'];
const SUPPORT_TO_IMS     = ['problem' => 'bug', 'question' => 'question', 'licence' => 'billing', 'idea' => 'feature', 'other' => 'question'];

// IMS address: environment (for testing) → ims_config.json
function supImsUrl(): string {
    $env = getenv('BARMS_IMS_URL');
    if ($env) return rtrim($env, '/');
    $cfg = @json_decode(@file_get_contents(__DIR__ . '/../ims_config.json'), true) ?: [];
    $url = rtrim(trim((string)($cfg['ims_url'] ?? '')), '/');
    // "/ims" works in a browser but not for the server: add this site's scheme and host
    if ($url !== '' && $url[0] === '/') {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
        $url = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $url;
    }
    return $url;
}

function supDeliver(PDO $db, int $id, int $clientId, string $deviceUuid): array {
    $st = $db->prepare('SELECT * FROM support_requests WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) return [false, 'Request not found'];
    $url = supImsUrl();
    if ($url === '') $res = [false, 'The IMS address is not set (ims_config.json)'];
    elseif (!$clientId || $deviceUuid === '') $res = [false, 'This BarMS is not activated with an IMS key'];
    elseif (!function_exists('curl_init')) $res = [false, 'cURL is not available on this server'];
    else {
        $ch = curl_init($url . '/api/support.php?action=submit');
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_POSTFIELDS => json_encode([
                'clientId' => $clientId, 'deviceUuid' => $deviceUuid,
                'category' => SUPPORT_TO_IMS[$r['category']] ?? 'question', 'subject' => $r['subject'], 'message' => $r['message'],
                'contact' => $r['contact'], 'sentBy' => $r['sent_by'], 'barName' => $r['bar_name'],
            ])]);
        $out = curl_exec($ch); $err = curl_error($ch);
        $j = $out ? json_decode($out, true) : null;
        if ($j && !empty($j['ok'])) {
            // IMS has the ticket; say so when IMS could not email it on to the support team
            $res = [true, empty($j['emailed']) ? 'IMS received it (ticket #' . (int)($j['ticketId'] ?? 0) . ') but could not email the support team: ' . ($j['emailError'] ?? 'unknown reason') : ''];
        } else {
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $res = [false, $j['error'] ?? ($err ? 'Could not reach IMS: ' . $err : "IMS did not answer correctly (HTTP $code at $url)")];
        }
        curl_close($ch);
    }
    $db->prepare('UPDATE support_requests SET email_status = ?, email_error = ? WHERE id = ?')
       ->execute([$res[0] ? 'sent' : 'failed', $res[1] === '' ? null : mb_substr($res[1], 0, 250), $id]);
    return $res;
}

if ($action === 'send') {
    $cat     = array_key_exists($body['category'] ?? '', SUPPORT_CATEGORIES) ? $body['category'] : 'other';
    $subject = mb_substr(trim($body['subject'] ?? ''), 0, 150);
    $message = mb_substr(trim($body['message'] ?? ''), 0, 5000);
    $contact = mb_substr(trim($body['contact'] ?? ''), 0, 150);
    if ($subject === '' || mb_strlen($message) < 10) jsonOut(['ok' => false, 'error' => 'Write a short subject and describe the issue (at least a sentence)'], 400);
    $recent = (int)$db->query("SELECT COUNT(*) FROM support_requests WHERE created_at > NOW() - INTERVAL 1 HOUR")->fetchColumn();
    if ($recent >= 10) jsonOut(['ok' => false, 'error' => 'Too many messages in the last hour. Please wait a little.'], 429);
    $bar = (string)($db->query('SELECT bar_name FROM settings LIMIT 1')->fetchColumn() ?: 'BarMS');
    $db->prepare('INSERT INTO support_requests (category, subject, message, contact, sent_by, bar_name) VALUES (?,?,?,?,?,?)')
       ->execute([$cat, $subject, $message, $contact ?: null, $sess['full_name'], $bar]);
    $id = (int)$db->lastInsertId();
    [$ok, $err] = supDeliver($db, $id, (int)($body['clientId'] ?? 0), trim($body['deviceUuid'] ?? ''));
    jsonOut(['ok' => true, 'id' => $id, 'emailed' => $ok, 'emailError' => $ok ? '' : $err]);
}

if ($action === 'resend') {
    [$ok, $err] = supDeliver($db, (int)($body['id'] ?? 0), (int)($body['clientId'] ?? 0), trim($body['deviceUuid'] ?? ''));
    jsonOut(['ok' => $ok, 'error' => $ok ? '' : $err]);
}

if ($action === 'list') {
    $rows = $db->query('SELECT id, category, subject, message, contact, sent_by, email_status, email_error, created_at FROM support_requests ORDER BY id DESC LIMIT 30')->fetchAll();
    jsonOut(['ok' => true, 'data' => $rows, 'configured' => supImsUrl() !== '', 'categories' => SUPPORT_CATEGORIES]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
