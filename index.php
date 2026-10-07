<?php
require_once __DIR__ . '/config/db.php';
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="csrf-token" content="<?php echo htmlspecialchars($_SESSION['csrf'], ENT_QUOTES); ?>" />
  <!-- the version of the files in this page, from version.txt (the only place it is set) -->
  <meta name="barms-version" content="<?php echo htmlspecialchars(barmsAppVersion(), ENT_QUOTES); ?>" />

  <!-- Task 21: Web App Manifest -->
 <link rel="manifest" href="manifest.php" />

  <!-- Task 22: Theme color -->
  <meta name="theme-color" content="#1E3A8A" />

  <!-- Task 23: iOS PWA meta tags -->
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="BarMS Pro" />
  <link rel="apple-touch-icon" href="assets/icons/icon-192.png" />
  <link rel="icon" type="image/png" sizes="192x192" href="assets/icons/icon-192.png" />

  <script>try{if(localStorage.getItem('barms_theme')==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}</script>
  <title>BarMS Pro — Bar Management System by IMS</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="assets/css/main.css?v=2" />
  <link rel="stylesheet" href="assets/css/components.css?v=4" />
  <link rel="stylesheet" href="assets/css/dashboard.css?v=3" />
  <link rel="stylesheet" href="assets/css/reports.css?v=2" />
  <link rel="stylesheet" href="assets/css/advanced-reports.css?v=6" />
  <link rel="stylesheet" href="assets/css/kitchen-queue.css?v=3" />
  <link rel="stylesheet" href="assets/css/responsive.css?v=4" />
  <link rel="stylesheet" href="assets/css/ui.css?v=27" />
  <link rel="stylesheet" href="assets/css/pos.css?v=8" />
  <link rel="stylesheet" href="assets/css/dark.css?v=12" />
</head>

<body>
  <script>window.__bootT0 = performance.now();</script>
  <!-- BOOT (short start-up; ui.js removes it) -->
  <div id="boot" aria-hidden="true">
    <div class="boot-inner">
      <div class="boot-mark">
        <svg class="brand-mark" viewBox="0 0 44 44"><rect class="lv" x="11" y="20" width="5" height="13" rx="1.5" fill="#fff" opacity=".55"/><rect class="lv" x="19.5" y="14" width="5" height="19" rx="1.5" fill="#fff" opacity=".8"/><rect class="lv" x="28" y="9" width="5" height="24" rx="1.5" fill="#fff"/></svg>
        <div class="boot-word">BarMS <span>Pro</span></div>
      </div>
      <div class="boot-line"><i></i></div>
      <div class="boot-status">Starting</div>
      <div class="boot-ims"><span>by</span><span class="ims-logo on-dark" role="img" aria-label="IMS — Integrated Management Solutions"></span></div>
    </div>
  </div>
  <script src="assets/js/ui-icons.js?v=4"></script>

  <!-- LOGIN -->
  <div class="login-wrap" id="loginWrap" style="display:none">
    <div class="login-card">
      <div class="login-top">
        <button class="tb-btn theme-toggle" onclick="uiToggleTheme(event)" title="Dark mode" aria-label="Dark mode"></button>
        <button class="btn btn-quiet btn-sm" onclick="toggleLangLogin()" id="loginLangBtn">Français</button>
      </div>
      <div class="login-logo">
        <svg class="brand-mark" viewBox="0 0 44 44"><rect x="11" y="20" width="5" height="13" rx="1.5" fill="#fff" opacity=".55"/><rect x="19.5" y="14" width="5" height="19" rx="1.5" fill="#fff" opacity=".8"/><rect x="28" y="9" width="5" height="24" rx="1.5" fill="#fff"/></svg>
        <h1>BarMS Pro</h1>
        <p id="loginSubtitle">Bar Management System — Rwanda</p>
      </div>
      <div class="form-group">
        <label class="form-label" id="loginUserLabel">Username</label>
        <input class="form-input" id="loginUser" name="barms-username" placeholder="Enter your username" value="" autocomplete="off" autocapitalize="none" spellcheck="false" readonly onfocus="this.removeAttribute('readonly')" onpointerdown="this.removeAttribute('readonly')" data-lpignore="true" data-1p-ignore="true" />
      </div>
      <div class="form-group">
        <label class="form-label" id="loginPassLabel">Password</label>
        <input class="form-input" type="password" id="loginPass" name="barms-current-password" placeholder="Enter your password" value="" autocomplete="new-password" readonly onfocus="this.removeAttribute('readonly')" onpointerdown="this.removeAttribute('readonly')" data-lpignore="true" data-1p-ignore="true"
          onkeydown="if(event.key==='Enter')doLogin()" />
      </div>
      <div id="loginErr" class="form-error" style="margin:-4px 0 12px;display:none"><i data-ic="alertcircle"></i><span
          id="loginErrMsg">Invalid credentials. Try again.</span></div>
      <button class="btn btn-primary btn-lg btn-block" onclick="doLogin()" id="loginBtn">Sign In →</button>
      <div class="ims-by login-ims"><span>A product of</span><span class="ims-logo" role="img" aria-label="IMS — Integrated Management Solutions"></span></div>
    </div>
  </div>

  <!-- APP SHELL -->
  <div class="app" id="appShell" style="display:none">
    <!-- Mobile sidebar overlay -->
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>

    <!-- SIDEBAR -->
    <nav class="sidebar" aria-label="Main navigation">
      <div class="sb-logo">
        <svg class="brand-mark" viewBox="0 0 44 44"><rect x="11" y="20" width="5" height="13" rx="1.5" fill="#fff" opacity=".55"/><rect x="19.5" y="14" width="5" height="19" rx="1.5" fill="#fff" opacity=".8"/><rect x="28" y="9" width="5" height="24" rx="1.5" fill="#fff"/></svg>
        <div class="brand-text">
          <h1>BarMS</h1>
          <p>RWANDA BAR MANAGEMENT</p>
        </div>
        <button class="sb-collapse tb-hide-sm" onclick="uiToggleSidebarMin()" title="Collapse sidebar" aria-label="Collapse sidebar"><i data-ic="chevleft"></i></button>
      </div>
      <div class="sidebar-nav">
        <div class="nav-indicator" id="navIndicator"></div>
        <div class="sb-section">
          <div class="sb-label">Main</div>
          <div class="nav-item active" id="nav-dashboard" onclick="showPage('dashboard')" title="Dashboard"><span class="nav-icon" data-ic="dashboard"></span><span class="nav-label">Dashboard</span></div>
          <div class="nav-item" id="nav-order-creation" onclick="showPage('order-creation')" title="Order Creation"><span class="nav-icon" data-ic="plus"></span><span class="nav-label">Order Creation</span></div>
          <div class="nav-item" id="nav-order-management" onclick="loadAllOrders()" title="Order Management"><span class="nav-icon" data-ic="orders"></span><span class="nav-label">Order Management</span></div>
          <div class="nav-item" id="nav-payment-invoice" onclick="showPage('payment-invoice')" title="Payment & Invoice"><span class="nav-icon" data-ic="card"></span><span class="nav-label">Payment & Invoice</span></div>
          <div class="nav-item" id="nav-bar-sales" onclick="showPage('bar-sales')" title="Bar Sales"><span class="nav-icon" data-ic="receipt"></span><span class="nav-label">Bar Sales</span></div>
        </div>
        <div class="sb-section">
          <div class="sb-label">Bar inventory</div>
          <div class="nav-item" id="nav-bar-items" onclick="showPage('bar-items')" title="Items"><span class="nav-icon" data-ic="beer"></span><span class="nav-label">Items</span></div>
          <div class="nav-item" id="nav-bar-ingredients" onclick="showPage('bar-ingredients')" title="Ingredients"><span class="nav-icon" data-ic="flask"></span><span class="nav-label">Ingredients</span></div>
          <div class="nav-item" id="nav-bar-movements" onclick="showPage('bar-movements')" title="Stock Movements"><span class="nav-icon" data-ic="swap"></span><span class="nav-label">Stock Movements</span></div>
          <div class="nav-item" id="nav-stock-count" onclick="showPage('stock-count')" title="Stock Count"><span class="nav-icon" data-ic="clipcheck"></span><span class="nav-label">Stock Count</span></div>
          <div class="nav-item" id="nav-suppliers" onclick="showPage('suppliers')" title="Suppliers"><span class="nav-icon" data-ic="truck"></span><span class="nav-label">Suppliers</span></div>
        </div>
        <div class="sb-section">
          <div class="sb-label">Kitchen</div>
          <div class="nav-item" id="nav-kitchen-queue" onclick="showPage('kitchen-queue')" title="Kitchen Queue"><span class="nav-icon" data-ic="flame"></span><span class="nav-label">Kitchen Queue</span></div>
          <div class="nav-item" id="nav-kitchen-dashboard" onclick="showPage('kitchen-dashboard')" title="Kitchen Dashboard"><span class="nav-icon" data-ic="chef"></span><span class="nav-label">Kitchen Dashboard</span></div>
          <div class="nav-item" id="nav-kitchen-menu" onclick="showPage('kitchen-menu')" title="Menu"><span class="nav-icon" data-ic="utensils"></span><span class="nav-label">Menu</span></div>
          <div class="nav-item" id="nav-kitchen-recipes" onclick="showPage('kitchen-recipes')" title="Recipes"><span class="nav-icon" data-ic="bookopen"></span><span class="nav-label">Recipes</span></div>
          <div class="nav-item" id="nav-kitchen-ingredients" onclick="showPage('kitchen-ingredients')" title="Kitchen ingredients"><span class="nav-icon" data-ic="basket"></span><span class="nav-label">Ingredients</span></div>
        </div>
        <div class="sb-section">
          <div class="sb-label">Money & reports</div>
          <div class="nav-item" id="nav-expenses" onclick="showPage('expenses')" title="Expenses"><span class="nav-icon" data-ic="wallet"></span><span class="nav-label">Expenses</span></div>
          <div class="nav-item" id="nav-cashbook" onclick="showPage('cashbook')" title="Cash Book"><span class="nav-icon" data-ic="book"></span><span class="nav-label">Cash Book</span></div>
          <div class="nav-item" id="nav-assets" onclick="showPage('assets')" title="Assets &amp; Worth"><span class="nav-icon" data-ic="store"></span><span class="nav-label">Assets &amp; Worth</span></div>
          <div class="nav-item" id="nav-advanced-reports" onclick="showPage('advanced-reports')" title="Advanced Reports"><span class="nav-icon" data-ic="barchart"></span><span class="nav-label">Advanced Reports</span></div>
          <div class="nav-item" id="nav-reports" onclick="showPage('reports')" title="Reports"><span class="nav-icon" data-ic="report"></span><span class="nav-label">Reports</span></div>
          <div class="nav-item" id="nav-charts" onclick="showPage('charts')" title="Charts"><span class="nav-icon" data-ic="linechart"></span><span class="nav-label">Charts</span></div>
          <div class="nav-item" id="nav-custdebts" onclick="showPage('custdebts')" title="Customer Debts"><span class="nav-icon" data-ic="coins"></span><span class="nav-label">Customer Debts</span></div>
          <div class="nav-item" id="nav-voidreqs" onclick="showPage('voidreqs')" title="Requests"><span class="nav-icon" data-ic="ban"></span><span class="nav-label">Requests</span><span class="nav-badge" id="voidReqBadge" style="display:none">0</span></div>
        </div>
        <div class="sb-section">
          <div class="sb-label">People & admin</div>
          <div class="nav-item" id="nav-employees" onclick="showPage('employees')" title="Employees"><span class="nav-icon" data-ic="users"></span><span class="nav-label">Employees</span></div>
          <div class="nav-item" id="nav-audit" onclick="showPage('audit')" title="Audit Log"><span class="nav-icon" data-ic="history"></span><span class="nav-label">Audit Log</span></div>
          <div class="nav-item" id="nav-system-health" onclick="showPage('system-health')" title="System Health"><span class="nav-icon" data-ic="checkcircle"></span><span class="nav-label">System Health</span></div>
          <div class="nav-item" id="nav-settings" onclick="showPage('settings')" title="Settings"><span class="nav-icon" data-ic="settings"></span><span class="nav-label">Settings</span></div>
          <div class="nav-item" id="nav-support" onclick="showPage('support')" title="Help & support"><span class="nav-icon" data-ic="help"></span><span class="nav-label">Help &amp; support</span></div>
        </div>
      </div>
      <div class="sb-bottom">
        <div class="sb-user" onclick="showUserAccessInfo()" title="Your access">
          <div class="sb-avatar" id="avatarTxt">OW</div>
          <div class="sb-user-info">
            <p id="sidebarName">Owner</p>
            <span id="sidebarRole">Owner</span>
          </div>
        </div>
        <div class="nav-item-logout" onclick="doLogout()" title="Logout"><span class="nav-icon" data-ic="logout"></span><span class="logout-label">Gusohoka / Logout</span></div>
        <div class="sb-ims" title="BarMS is a product of IMS — Integrated Management Solutions"><span>by</span><span class="ims-logo on-dark" role="img" aria-label="IMS"></span></div>
      </div>
    </nav>

    <!-- MAIN -->
    <div class="main">
      <!-- TOPBAR -->
      <div class="topbar">
        <div class="topbar-left" style="display:flex;align-items:center;gap:12px">
          <div class="hamburger" onclick="event.stopPropagation();toggleSidebar()" id="hamburgerBtn" role="button" aria-label="Open menu">
            <span></span><span></span><span></span>
          </div>
          <div style="min-width:0">
            <h2 id="pageTitle">Dashboard</h2>
            <p id="pageDate"></p>
          </div>
        </div>
        <div class="topbar-right" style="position:relative">
          <button class="tb-btn" onclick="showSearch()" title="Search (/)" aria-label="Search"><i data-ic="search"></i></button>
          <button class="tb-btn" onclick="showShiftModal()" id="shiftBtn" style="display:none">Shift</button>
          <!-- Task 73: Sync status badge -->
          <span id="syncBadge" style="display:none;font-size:11px;font-weight:600;padding:3px 8px;border-radius:12px;color:#fff;cursor:pointer" onclick="updateSyncBadge()"></span>
          <button class="tb-btn sh-dot-btn" id="healthBtn" onclick="showPage('system-health')" title="System health" aria-label="System health" style="display:none"><span class="sh-dot" id="healthDot"></span></button>
          <button class="tb-btn" id="notifBtn" onclick="toggleNotif()" title="Notifications" aria-label="Notifications"><i data-ic="bell"></i>
            <span class="notif-dot" id="notifDot"></span>
          </button>
          <button class="tb-btn theme-toggle" id="themeBtn" onclick="uiToggleTheme(event)" title="Dark mode" aria-label="Dark mode"></button>
          <button class="tb-btn" onclick="toggleLanguage()" id="langBtn" title="Language" style="font-weight:600;letter-spacing:.03em">FR</button>
          <div class="tb-more">
            <button class="tb-btn" id="tbMoreBtn" onclick="uiToggleTbMenu(event)" title="More" aria-label="More" aria-haspopup="true" aria-expanded="false"><i data-ic="dots"></i></button>
            <div class="tb-menu" id="tbMenu" role="menu">
              <button class="tb-mi" role="menuitem" onclick="uiCloseTbMenu();showSummary()" id="topbarEndOfDay"><i data-ic="clipcheck"></i><span data-i18n="endOfDay">End of Day</span></button>
              <button class="tb-mi" role="menuitem" id="backdateBtn" onclick="uiCloseTbMenu();showBackdateModal()" style="display:none"><i data-ic="calendar"></i><span>Change Date</span></button>
              <button class="tb-mi" role="menuitem" id="soundBtn" onclick="uiSetSound(!uiSoundOn())"></button>
              <!-- on phones these three leave the top bar (room for the page title) and live here -->
              <button class="tb-mi tb-mi-phone" role="menuitem" onclick="uiCloseTbMenu();uiToggleTheme(event)"><i data-ic="moon"></i><span>Light / dark mode</span></button>
              <button class="tb-mi tb-mi-phone" role="menuitem" onclick="uiCloseTbMenu();toggleLanguage()"><i data-ic="globe"></i><span>Français / English</span></button>
              <button class="tb-mi tb-mi-phone" role="menuitem" id="healthMi" style="display:none" onclick="uiCloseTbMenu();showPage('system-health')"><i data-ic="checkcircle"></i><span>System health</span></button>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="newOrderBtn" onclick="showPage('order-creation')" style="margin-left:4px"><i data-ic="plus"></i><span class="tb-hide-sm">New order</span></button>


          <!-- NOTIF PANEL -->
          <div class="notif-panel" id="notifPanel">
            <div class="notif-head">
              <span>Notifications</span>
              <button id="markAllReadBtn" class="btn btn-quiet btn-sm" onclick="markAllRead()">Mark all read</button>
            </div>
            <div id="notifList"></div>
          </div>
        </div>
      </div>

      <!-- CONTENT — one PHP include per page -->
      <div class="content" id="mainContent">

        <?php include 'pages/dashboard.html'; ?>
        <?php include 'pages/order-creation.html'; ?>
        <?php include 'pages/order-management.html'; ?>
        <?php include 'pages/payment-invoice.html'; ?>
        <?php include 'pages/bar-sales.html'; ?>
        <?php include 'pages/tables.html'; ?>
        <?php include 'pages/bar-items.html'; ?>
        <?php include 'pages/bar-ingredients.html'; ?>
        <?php include 'pages/bar-movements.html'; ?>
        <?php include 'pages/kitchen-queue.html'; ?>
        <?php include 'pages/kitchen-dashboard.html'; ?>
        <?php include 'pages/kitchen-menu.html'; ?>
        <?php include 'pages/kitchen-recipes.html'; ?>
        <?php include 'pages/kitchen-ingredients.html'; ?>
        <?php include 'pages/reports.html'; ?>
        <?php include 'pages/advanced-reports.html'; ?>
        <?php include 'pages/suppliers.html'; ?>
        <?php include 'pages/stock-count.html'; ?>
        <?php include 'pages/cashbook.html'; ?>
        <?php include 'pages/assets.html'; ?>
        <?php include 'pages/system-health.html'; ?>
        <?php include 'pages/charts.html'; ?>
        <?php include 'pages/employees.html'; ?>
        <?php include 'pages/settings.html'; ?>
        <?php include 'pages/support.html'; ?>
        <?php include 'pages/custdebts.html'; ?>
        <?php include 'pages/voidreqs.html'; ?>
        <?php include 'pages/audit.html'; ?>
        <?php include 'pages/quicksale.html'; ?>
        <?php include 'pages/sales.html'; ?>
        <?php include 'pages/expenses.html'; ?>
        <?php include 'pages/products.html'; ?>
        <?php include 'pages/stock.html'; ?>

        <footer class="app-foot"><span><b>BarMS Pro</b> is a product of</span><span class="ims-logo" role="img" aria-label="IMS — Integrated Management Solutions"></span></footer>

      </div><!-- /content -->
    </div><!-- /main -->
  </div><!-- /app -->

  <!-- MODAL -->
  <div class="overlay" id="modalOverlay">
    <div class="modal" id="modalBox" role="dialog" aria-modal="true">
      <button class="modal-close" onclick="closeModal()" aria-label="Close"><i data-ic="x"></i></button>
      <div id="modalContent"></div>
    </div>
  </div>

  <!-- Task 72: Offline banner -->
  <div id="offlineBanner" style="display:none;position:fixed;top:0;left:0;right:0;background:#F05C7A;color:#fff;padding:8px 16px;align-items:center;gap:10px;z-index:10000;font-size:13px;font-weight:600">
    <span>You are offline — showing last saved data</span>
    <span style="margin-left:auto;font-size:11px;opacity:0.8">Data will refresh when connection returns</span>
  </div>

  <!-- Backdate mode banner -->
  <div id="backdateBanner" style="display:none;position:fixed;top:0;left:0;right:0;background:#D97706;color:#fff;padding:8px 16px;align-items:center;gap:10px;z-index:10001;font-size:13px;font-weight:600">
    <span>BACKDATE MODE</span>
    <span style="font-weight:400">Working in: <strong id="bdBannerDate"></strong></span>
    <span style="font-weight:400;font-size:11px;opacity:0.85">Reason: <span id="bdBannerReason"></span></span>
    <button onclick="deactivateBackdate()" style="margin-left:auto;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✕ Return to Today</button>
  </div>

  <!-- JS — load order matters: db-local first, then utils, api, auth, navigation, then page modules -->
  <script src="assets/js/db-local.js?v=2"></script>
  <script src="assets/js/license.js?v=2.7"></script>
  <script src="assets/js/tenant.js?v=1"></script>
  <script src="assets/js/data-limit.js?v=2.3"></script>
  <script src="assets/js/utils.js?v=7"></script>
  <script src="assets/js/bx-charts.js?v=8"></script>
  <script src="assets/js/api.js?v=8"></script>
  <script src="assets/js/health.js?v=3"></script>
  <script src="assets/js/system-health.js?v=4"></script>
  <script src="assets/js/perf.js?v=2"></script>
  <script src="assets/js/auth.js?v=14"></script>
  <script src="assets/js/navigation.js?v=10"></script>
  <script src="assets/js/ui.js?v=13"></script>
  <script src="assets/js/ui-art.js?v=3"></script>
  <script src="assets/js/perms.js?v=2"></script>
  <script src="assets/js/i18n-fr.js?v=6"></script>
  <script src="assets/js/dashboard.js?v=10"></script>
  <script src="assets/js/kitchen-new.js?v=9"></script>
  <script src="assets/js/recipe-costing.js?v=2"></script>
  <script src="assets/js/kitchen-queue.js?v=4"></script>
  <script src="assets/js/reports.js?v=8"></script>
  <script src="assets/js/advanced-reports.js?v=17"></script>
  <script src="assets/js/ar-export.js?v=11"></script>
  <script src="assets/js/suppliers.js?v=3"></script>
  <script src="assets/js/stock-ops.js?v=7"></script>
  <script src="assets/js/shifts.js?v=4"></script>
  <script src="assets/js/charts.js?v=3"></script>
  <script src="assets/js/employees.js?v=6"></script>
  <script src="assets/js/misc.js?v=8"></script>
  <script src="assets/js/settings.js?v=9"></script>
  <script src="assets/js/support.js?v=3"></script>
  <script src="assets/js/offline-ui.js?v=2"></script>
  <script src="assets/js/sync.js?v=2.5"></script>
<script src="assets/js/bar-inventory.js?v=11"></script>
<script src="assets/js/bar-sales.js?v=94"></script>
  <!-- PWA: Install banner (Android/Desktop) -->
  <div id="pwaInstallBanner" style="display:none;position:fixed;bottom:0;left:0;right:0;background:#1E3A8A;color:#fff;padding:12px 16px;align-items:center;gap:12px;z-index:9999;box-shadow:0 -4px 16px rgba(0,0,0,0.2)">
    <span style="font-size:22px"></span>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700">Install BarMS Pro</div>
      <div style="font-size:11px;opacity:0.8">Add to home screen for quick access</div>
    </div>
    <button id="pwaInstallBtn" onclick="installApp()" style="background:#fff;color:#1E3A8A;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Install</button>
    <button onclick="dismissInstallBanner()" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:4px">×</button>
  </div>

  <!-- PWA: iOS install tip -->
  <div id="pwaIosTip" style="display:none;position:fixed;bottom:0;left:0;right:0;background:#1E3A8A;color:#fff;padding:12px 16px;align-items:center;gap:12px;z-index:9999;box-shadow:0 -4px 16px rgba(0,0,0,0.2)">
    <span style="font-size:22px"></span>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700">Install BarMS Pro</div>
      <div style="font-size:11px;opacity:0.8">Tap <strong>Share ↑</strong> then <strong>Add to Home Screen</strong></div>
    </div>
    <button onclick="dismissIosTip()" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:4px">×</button>
  </div>

  <!-- PWA: Update available banner -->
  <div id="pwaUpdateBanner" style="display:none;position:fixed;top:0;left:0;right:0;background:#0EA875;color:#fff;padding:10px 16px;align-items:center;gap:12px;z-index:9999">
    <span style="flex:1;font-size:13px;font-weight:600">Update available — tap to refresh</span>
    <button onclick="applyUpdate()" style="background:#fff;color:#0EA875;border:none;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Refresh</button>
  </div>

  <!-- Task 24 & 52: Service worker registration + pwa.js -->
  <script src="assets/js/pwa.js?v=4"></script>
<script src="assets/js/backdate.js?v=3"></script>
  <script>
    // ── INIT ──────────────────────────────────────────────────
    document.addEventListener('click', closeNotifOutside);
    document.getElementById('modalOverlay').addEventListener('click', function(e) {
      if (e.target === document.getElementById('modalOverlay')) closeModal();
    });
    document.querySelectorAll('.nav-item,.nav-item-logout').forEach(function(el) {
      el.addEventListener('click', function() { if (window.innerWidth <= 768) closeSidebar(); });
    });

    // Language (from localStorage)
    // Initialize license system FIRST before anything else
  openDB().then(() => initLicenseSystem());
  currentLang = localStorage.getItem('barms_lang') || 'en';
    applyLanguage();
    document.getElementById('pageDate').textContent = new Date().toLocaleDateString(
      currentLang === 'fr' ? 'fr-FR' : 'en-RW',
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    );

    // Periodic checks
    setInterval(checkLowStock, 5 * 60 * 1000);
    setInterval(runPeriodicFraudCheck, 300000);
  </script>

<script>
// Close sidebar when clicking outside
document.addEventListener('click', function(e) {
  const sidebar = document.querySelector('.sidebar');
  const hamburger = document.getElementById('hamburgerBtn');
  if (!sidebar || !hamburger) return;
  if (sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !hamburger.contains(e.target)) {
    closeSidebar();
  }
});
</script>
<script src="assets/js/order-creation.js?v=3"></script>
<script src="assets/js/order-management.js?v=11"></script>
<script src="assets/js/refunds.js?v=5"></script>
<script src="assets/js/payment-invoice.js?v=12"></script>
<script src="assets/js/tables.js?v=7"></script>
    <script src="assets/js/sales.js?v=4"></script>
    <script src="assets/js/expenses.js?v=6"></script>
    <script src="assets/js/products.js?v=3"></script>
    <script src="assets/js/stock.js?v=3"></script></body>
</html>
