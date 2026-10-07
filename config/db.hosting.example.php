<?php
// ============================================================
//  config/db.hosting.example.php — template of the LIVE server settings.
//  Copy to config/db.hosting.php on the hosting and fill in the real values.
//  config/db.hosting.php is never committed (it holds the database password).
// ============================================================
define('DB_HOST', 'sqlXXX.infinityfree.com');
define('DB_USER', 'if0_XXXXXXXX');
define('DB_PASS', 'your-database-password');
define('DB_NAME', 'if0_XXXXXXXX_db_barms');
// IMS client id that owns the data already on the hosting (set before the first sign-in after this update)
// define('BARMS_LEGACY_CLIENT', 0);
// Secret key for running migrations from the browser (tools/migrate_all_clients.php?file=…&key=…)
// define('MIGRATE_KEY', 'put-a-long-random-text-here');
