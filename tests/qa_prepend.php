<?php
// ============================================================
//  tests/qa_prepend.php — TEST ONLY (reliability_test.php)
//  Runs one BarMS endpoint against the throwaway test database as a
//  signed-in user. It refuses to run unless started by the test runner
//  from the command line (php-cgi with BARMS_QA_RUN set, no web client).
// ============================================================
if (getenv('BARMS_QA_RUN') !== '1' || !empty($_SERVER['REMOTE_ADDR']) || !empty($_SERVER['HTTP_HOST'])) { http_response_code(403); exit('Forbidden'); }
define('DB_NAME', getenv('QA_DB'));
session_id('qarun' . preg_replace('/\W/', '', getenv('QA_SID') ?: '1'));
session_start();
$_SESSION = ['user_id' => (int)(getenv('QA_UID') ?: 1), 'username' => 'qa', 'full_name' => getenv('QA_NAME') ?: ('QA ' . (getenv('QA_ROLE') ?: 'Owner')), 'role' => getenv('QA_ROLE') ?: 'Owner',
             'tenant_client' => 5, 'tenant_prefix' => '', 'tenant_name' => 'qa', 'last_activity' => time(), 'csrf' => 'qa-token'];
if (getenv('QA_NO_CSRF') !== '1') $_SERVER['HTTP_X_CSRF_TOKEN'] = 'qa-token';
// a record made offline at a past time (ms since 1970): barmsActionTime() then gives that time, like a real offline token request
if (getenv('QA_OFFLINE_AT')) { $_SESSION['offline'] = true; $_SERVER['HTTP_X_BARMS_OFFLINE_AT'] = getenv('QA_OFFLINE_AT'); }
