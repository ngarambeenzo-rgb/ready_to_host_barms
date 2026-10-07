<?php
// ============================================================
//  BarMS Pro — barms_updater.php
//  Auto-updater: checks IMS, downloads and installs updates
//  NEVER DELETE THIS FILE
// ============================================================
header('Content-Type: application/json');

require_once __DIR__ . '/config/db.php';
requireAuth();

// ── READ CONFIG ───────────────────────────────────
$configFile = __DIR__ . '/ims_config.json';
if (!file_exists($configFile)) {
    die(json_encode(['ok' => false, 'error' => 'ims_config.json not found — run setup first']));
}

$config    = json_decode(file_get_contents($configFile), true);
$imsUrl    = rtrim($config['ims_url'] ?? '', '/');
$clientId  = (int)($config['client_id'] ?? 0);
$productId = (int)($config['product_id'] ?? 1);

if (!$imsUrl) {
    die(json_encode(['ok' => false, 'error' => 'IMS URL not configured in ims_config.json']));
}

if (strpos($imsUrl, '/') === 0) {
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $imsUrl = $scheme . '://' . $host . $imsUrl;
}

// ── READ CURRENT VERSION ──────────────────────────
$versionFile    = __DIR__ . '/version.txt';
$currentVersion = file_exists($versionFile) ? trim(file_get_contents($versionFile)) : '1.0.0';

// ── CHECK IMS FOR UPDATES ─────────────────────────
$checkUrl = "$imsUrl/api/updates.php?action=check"
    . "&productId=$productId"
    . "&currentVersion=" . urlencode($currentVersion)
    . "&clientId=$clientId";

$ctx = stream_context_create([
    'http' => ['timeout' => 15, 'ignore_errors' => true],
    'ssl'  => ['verify_peer' => false, 'verify_peer_name' => false],
]);

$response = @file_get_contents($checkUrl, false, $ctx);

if (!$response) {
    die(json_encode([
        'ok'      => false,
        'error'   => 'Cannot reach IMS server at: ' . $imsUrl,
        'current' => $currentVersion,
    ]));
}

$data = json_decode($response, true);

if (!$data || !isset($data['ok'])) {
    die(json_encode(['ok' => false, 'error' => 'Invalid response from IMS', 'current' => $currentVersion]));
}

if (!$data['ok']) {
    die(json_encode(['ok' => false, 'error' => 'IMS error: ' . ($data['error'] ?? 'unknown'), 'current' => $currentVersion]));
}

// ── NO UPDATE AVAILABLE ───────────────────────────
if (!$data['hasUpdate']) {
    die(json_encode([
        'ok'        => true,
        'hasUpdate' => false,
        'current'   => $currentVersion,
        'latest'    => $data['latestVersion'],
        'message'   => 'Already up to date',
    ]));
}

// ── UPDATE AVAILABLE ──────────────────────────────
$newVersion = $data['latestVersion'];
$updateFile = $data['updateFile'] ?? null;

if (!$updateFile) {
    die(json_encode([
        'ok'        => true,
        'hasUpdate' => true,
        'updated'   => false,
        'current'   => $currentVersion,
        'latest'    => $newVersion,
        'notes'     => $data['updateNotes'] ?? '',
        'message'   => 'Update v' . $newVersion . ' available — ZIP not uploaded yet. Contact IMS Company.',
    ]));
}

// ── DOWNLOAD ZIP FROM IMS ──────────────────────────
$downloadUrl = strpos($updateFile, 'http') === 0
    ? $updateFile
    : "$imsUrl/$updateFile";

$zipContent = @file_get_contents($downloadUrl, false, $ctx);

if (!$zipContent || strlen($zipContent) < 500) {
    die(json_encode(['ok' => false, 'error' => 'Failed to download update ZIP from IMS. Check IMS server.']));
}

// Save ZIP to temp
$tmpZip = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'barms_update_' . $newVersion . '_' . time() . '.zip';
if (!file_put_contents($tmpZip, $zipContent)) {
    die(json_encode(['ok' => false, 'error' => 'Cannot write to temp directory: ' . sys_get_temp_dir()]));
}

// ── CHECK ZIPARCHIVE AVAILABLE ────────────────────
if (!class_exists('ZipArchive')) {
    $savedPath = __DIR__ . '/barms_update_pending.zip';
    file_put_contents($savedPath, $zipContent);
    @unlink($tmpZip);
    die(json_encode([
        'ok'      => false,
        'error'   => 'ZipArchive not available on this server. Update saved as barms_update_pending.zip — extract manually.',
        'saved'   => $savedPath,
    ]));
}

// ── BACKUP CURRENT FILES ──────────────────────────
$backupDir  = __DIR__ . '/backups/';
$backupFile = null;
if (!is_dir($backupDir)) @mkdir($backupDir, 0755, true);

if (is_dir($backupDir)) {
    $backupFile = $backupDir . 'barms_v' . $currentVersion . '_' . date('Ymd_His') . '.zip';
    $bz = new ZipArchive();
    if ($bz->open($backupFile, ZipArchive::CREATE) === true) {
        $important = ['ims_config.json', 'version.txt', 'config/db.php'];
        foreach ($important as $f) {
            if (file_exists(__DIR__ . '/' . $f)) $bz->addFile(__DIR__ . '/' . $f, $f);
        }
        $bz->close();
    }

    // Keep only last 5 backups
    $backups = glob($backupDir . '*.zip');
    if ($backups && count($backups) > 5) {
        usort($backups, fn($a, $b) => filemtime($a) - filemtime($b));
        while (count($backups) > 5) {
            @unlink(array_shift($backups));
        }
    }
}

// ── OPEN AND VALIDATE ZIP ─────────────────────────
$zip = new ZipArchive();
$res = $zip->open($tmpZip);
if ($res !== true) {
    @unlink($tmpZip);
    die(json_encode(['ok' => false, 'error' => 'Downloaded ZIP is invalid or corrupted. Code: ' . $res]));
}

// ── PROTECTED FILES — NEVER OVERWRITE ─────────────
$protected = [
    'ims_config.json',
    'ims_update_token.txt',
    'version.txt',          // Updated separately at end
    'barms_updater.php',    // This file itself
    'config/db.php',
    'generate_update_token.php',
    '.htaccess',
];

// ── EXTRACT FILES ─────────────────────────────────
$installed = 0;
$skipped   = 0;
$errors    = [];

for ($i = 0; $i < $zip->numFiles; $i++) {
    $name = $zip->getNameIndex($i);

    // Skip directories
    if (substr($name, -1) === '/') continue;

    // Strip root folder from ZIP if present (e.g. barms/index.php → index.php)
    $destPath = $name;
    if (preg_match('/^[^\/]+\/(.+)$/', $name, $m)) {
        $destPath = $m[1];
    }

    // Skip protected files
    $skip = false;
    foreach ($protected as $p) {
        if ($destPath === $p || strpos($destPath, $p) !== false) {
            $skip = true;
            $skipped++;
            break;
        }
    }
    if ($skip) continue;

    // Build full destination path
    $destFull = __DIR__ . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $destPath);
    $destDir  = dirname($destFull);

    // Create directory if needed
    if (!is_dir($destDir)) {
        if (!@mkdir($destDir, 0755, true)) {
            $errors[] = 'Cannot create dir: ' . $destDir;
            continue;
        }
    }

    // Write file
    $content = $zip->getFromIndex($i);
    if ($content === false) {
        $errors[] = 'Cannot read from ZIP: ' . $name;
        continue;
    }

    if (file_put_contents($destFull, $content) === false) {
        $errors[] = 'Cannot write: ' . $destPath;
    } else {
        $installed++;
    }
}

$zip->close();
@unlink($tmpZip);

// ── UPDATE VERSION FILE ───────────────────────────
file_put_contents($versionFile, $newVersion);

// ── CLEAR OPCACHE ─────────────────────────────────
if (function_exists('opcache_reset')) opcache_reset();

// ── LOG UPDATE ────────────────────────────────────
$log = date('Y-m-d H:i:s') . " | v$currentVersion → v$newVersion | Files: $installed | Skipped: $skipped | Errors: " . count($errors) . "\n";
@file_put_contents(__DIR__ . '/update_log.txt', $log, FILE_APPEND);

// ── REPORT TO IMS ─────────────────────────────────
if ($clientId) {
    @file_get_contents(
        "$imsUrl/api/updates.php?action=report_install&clientId=$clientId&version=" . urlencode($newVersion) . "&success=" . (count($errors) === 0 ? '1' : '0'),
        false, $ctx
    );
}

// ── DONE ──────────────────────────────────────────
echo json_encode([
    'ok'             => true,
    'hasUpdate'      => true,
    'updated'        => true,
    'fromVersion'    => $currentVersion,
    'toVersion'      => $newVersion,
    'filesInstalled' => $installed,
    'filesSkipped'   => $skipped,
    'errors'         => $errors,
    'notes'          => $data['updateNotes'] ?? '',
    'reloadRequired' => true,
    'message'        => count($errors) === 0
        ? "Successfully updated from v$currentVersion to v$newVersion. $installed files installed."
        : "Updated to v$newVersion with " . count($errors) . " errors. Check update_log.txt.",
]);
