/* ═══════════════════════════════════════════════════
   BARMS PRO — pwa.js
   Tasks 49-52: Install prompt, iOS tip, update notification
   Depends on: utils.js
═══════════════════════════════════════════════════ */

// ── Install prompt (Task 49) ──────────────────────
let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (localStorage.getItem('barms_install_dismissed')) return;
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'flex';
}

function installApp() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      console.log('[PWA] User installed the app');
      localStorage.setItem('barms_installed', '1');
    }
    dismissInstallBanner();
  });
}

function dismissInstallBanner() {
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
  localStorage.setItem('barms_install_dismissed', '1');
}

// ── iOS install tip (Task 50) ─────────────────────
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

function showIosTip() {
  if (!isIos()) return;
  if (isInStandaloneMode()) return;
  if (localStorage.getItem('barms_ios_tip_dismissed')) return;
  const tip = document.getElementById('pwaIosTip');
  if (tip) tip.style.display = 'flex';
}

function dismissIosTip() {
  const tip = document.getElementById('pwaIosTip');
  if (tip) tip.style.display = 'none';
  localStorage.setItem('barms_ios_tip_dismissed', '1');
}

// ── Service Worker registration (Tasks 51-52) ─────
// Registers sw.php instead of sw.js — InfinityFree's WAF intercepts
// .js files served as sub-resources and returns an HTML bot-challenge
// page with the wrong MIME type, causing registration to fail.
// PHP requests bypass this restriction entirely.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Relative path: /sw.php on the hosting domain, /barms/sw.php on localhost
    navigator.serviceWorker.register('sw.php', { scope: './' })
      .then(registration => {
        console.log('[PWA] Service Worker registered. Scope:', registration.scope);

        registration.update().catch(() => {});
        setInterval(() => registration.update().catch(() => {}), 60 * 1000);

        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] New version installed — activating automatically');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        localStorage.setItem('barms_last_sync', new Date().toISOString());
      })
      .catch(err => {
        console.error('[PWA] Service Worker registration failed:', err);
      });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    setTimeout(showIosTip, 3000);
  });
}

window.addEventListener('appinstalled', () => {
  dismissInstallBanner();
  console.log('[PWA] App was installed');
});
