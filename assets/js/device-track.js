/* ═══════════════════════════════════════════════════
   BarMS — device-track.js
   Tells IMS (our company) where this device is, so a lost device can be
   found, and shows a lock message when the device is reported lost.

   • Only runs when the client has agreed to location sharing (IMS decides).
   • The browser asks the user for permission first; if it is refused,
     nothing about the position is sent.
   • Needs the device to be activated (client id + device id exist).
═══════════════════════════════════════════════════ */
(function () {
  'use strict';
  const LOST_KEY = 'barms_device_lost';
  const NOTICE_KEY = 'barms_track_notice';
  let timer = null, running = false, bgTicks = 0;

  async function call(action, extra) {
    const clientId = await getClientId();
    if (!clientId) return null;
    const imsUrl = normalizeImsUrl(await getImsUrl());
    const deviceUuid = await getDeviceUuid();
    const res = await fetch(`${imsUrl}/api/track.php?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ clientId, deviceUuid }, extra || {})),
    });
    if (!res.ok) return null;
    return res.json();
  }

  function position() {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy || 0) }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  }

  async function battery() {
    try {
      if (navigator.getBattery) {
        const b = await Promise.race([navigator.getBattery(), new Promise(r => setTimeout(() => r(null), 2000))]);
        if (b) return Math.round(b.level * 100);
      }
    } catch (e) {}
    return undefined;
  }

  // ── lost-device lock screen ──
  function showLost(note, contact) {
    localStorage.setItem(LOST_KEY, JSON.stringify({ note, contact }));
    let el = document.getElementById('lostLock');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lostLock';
      el.setAttribute('role', 'alertdialog');
      el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0b0d12;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:system-ui,sans-serif';
      document.body.appendChild(el);
    }
    const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    el.innerHTML = `<div style="max-width:420px">
      <div style="font-size:44px;margin-bottom:12px">&#128274;</div>
      <h1 style="font-size:22px;margin:0 0 10px">This device is locked</h1>
      <p style="font-size:16px;line-height:1.5;color:#cbd5e1;margin:0 0 18px">${esc(note)}</p>
      ${contact ? `<a href="tel:${esc(contact)}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Call ${esc(contact)}</a>` : ''}
    </div>`;
  }
  function hideLost() {
    localStorage.removeItem(LOST_KEY);
    const el = document.getElementById('lostLock');
    if (el) el.remove();
  }

  async function tick() {
    if (running || !navigator.onLine) return;
    running = true;
    try {
      const cfg = await call('config');
      if (!cfg || !cfg.ok) return;
      if (cfg.lost) showLost(cfg.lostNote, cfg.contact); else hideLost();

      const body = { appVersion: (typeof BARMS_CLIENT_VERSION !== 'undefined' ? BARMS_CLIENT_VERSION : '') };
      const bat = await battery();
      if (bat !== undefined) body.battery = bat;

      if (cfg.tracking) {
        if (!localStorage.getItem(NOTICE_KEY)) {
          localStorage.setItem(NOTICE_KEY, '1');
          if (typeof toast === 'function') toast('Your provider shares this device\'s location with IMS so a lost device can be found. Allow location when your browser asks.', 'info');
        }
        const p = await position();
        if (p) Object.assign(body, p, { source: p.accuracy && p.accuracy < 150 ? 'gps' : 'wifi' });
      }
      const r = await call('ping', body);
      if (r && r.ok) { if (r.lost) showLost(r.lostNote, r.contact); else hideLost(); }
    } catch (e) { /* offline or IMS unreachable: try again later */ }
    finally { running = false; }
  }

  function start() {
    // A device that was reported lost stays locked even before it reaches IMS again.
    try { const l = JSON.parse(localStorage.getItem(LOST_KEY) || 'null'); if (l) showLost(l.note, l.contact); } catch (e) {}
    setTimeout(tick, 12000);
    // Every minute while the app is open (so the map follows the device), every 5 minutes in the background
    timer = setInterval(() => { if (!document.hidden || ++bgTicks % 5 === 0) tick(); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(tick, 1500); });
    window.addEventListener('online', () => setTimeout(tick, 2000));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
