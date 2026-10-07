<?php
// ============================================================
//  api/product_images.php
//  Upload or remove the photo of a bar item or kitchen dish.
//  POST multipart: action=upload, kind=bar|kitchen, id, file
//  POST json:      action=remove, kind, id
//  Needs canManageItems. Only real JPEG/PNG/WebP images, max 3 MB.
// ============================================================
require_once __DIR__ . '/../config/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonOut(['ok' => false, 'error' => 'POST only'], 405);
requireCsrf();
$sess = requireAuth();
requirePerm('canManageItems');
$db = getDB();

$action = $_REQUEST['action'] ?? '';
$body   = json_decode(file_get_contents('php://input'), true) ?: [];
$kind   = $_POST['kind'] ?? $body['kind'] ?? '';
$id     = (int)($_POST['id'] ?? $body['id'] ?? 0);
$tables = ['bar' => 'bar_items', 'kitchen' => 'kitchen_menu'];
if (!isset($tables[$kind]) || $id <= 0) jsonOut(['ok' => false, 'error' => 'Unknown item'], 400);
$table = $tables[$kind];

$row = $db->prepare("SELECT id, name, image FROM $table WHERE id = ? LIMIT 1");
$row->execute([$id]);
$item = $row->fetch();
if (!$item) jsonOut(['ok' => false, 'error' => 'Item not found'], 404);

$dir = realpath(__DIR__ . '/..') . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'products';

// delete the previous file, but only if it is one of ours
function pimgDeleteOld($dir, $path) {
    if (!$path || !preg_match('#^uploads/products/([a-z]+-\d+-[a-f0-9]{12}\.(?:jpg|png|webp))$#', $path, $m)) return;
    $f = $dir . DIRECTORY_SEPARATOR . $m[1];
    if (is_file($f)) @unlink($f);
}

function pimgAudit($db, $sess, $text) {
    try { $db->prepare('INSERT INTO audit_log (action_type, details, done_by) VALUES (?,?,?)')->execute(['Product Photo', $text, $sess['full_name'] ?? $sess['username'] ?? '']); } catch (Exception $e) {}
}

if ($action === 'remove') {
    pimgDeleteOld($dir, $item['image']);
    $db->prepare("UPDATE $table SET image = NULL WHERE id = ?")->execute([$id]);
    pimgAudit($db, $sess, "Removed photo of {$item['name']}");
    jsonOut(['ok' => true]);
}

if ($action === 'upload') {
    $f = $_FILES['file'] ?? null;
    if (!$f || $f['error'] !== UPLOAD_ERR_OK) jsonOut(['ok' => false, 'error' => 'No image received'], 400);
    if ($f['size'] > 3 * 1024 * 1024) jsonOut(['ok' => false, 'error' => 'Image is larger than 3 MB'], 400);

    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
    $ext  = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$mime] ?? null;
    $info = @getimagesize($f['tmp_name']);
    if (!$ext || !$info || $info[0] < 32 || $info[1] < 32 || $info[0] > 6000 || $info[1] > 6000) {
        jsonOut(['ok' => false, 'error' => 'Use a JPG, PNG or WebP photo'], 400);
    }

    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) jsonOut(['ok' => false, 'error' => 'Could not create the uploads folder'], 500);
    $name = $kind . '-' . $id . '-' . bin2hex(random_bytes(6)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], $dir . DIRECTORY_SEPARATOR . $name)) jsonOut(['ok' => false, 'error' => 'Could not save the image'], 500);

    pimgDeleteOld($dir, $item['image']);
    $path = 'uploads/products/' . $name;
    $db->prepare("UPDATE $table SET image = ? WHERE id = ?")->execute([$path, $id]);
    pimgAudit($db, $sess, "New photo for {$item['name']}");
    jsonOut(['ok' => true, 'image' => $path]);
}

jsonOut(['ok' => false, 'error' => 'Unknown action'], 400);
