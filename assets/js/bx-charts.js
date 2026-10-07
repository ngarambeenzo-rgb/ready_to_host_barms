/* ═══════════════════════════════════════════════════
   BARMS PRO — bx-charts.js
   One chart kit for the whole app (dashboard, charts page,
   advanced reports, employee performance, printed report).
     bxColumns  – columns per category, 1–3 series, axis + gridlines
     bxRings    – concentric rings showing each part's share
     bxHBars    – ranked rows with a rounded bar
     bxStat     – figure card with icon and change pill
   Every chart is plain HTML/SVG + CSS, so it also prints.
   Hover / keyboard focus shows a tooltip with every value
   (values are also in the tables next to the charts).
═══════════════════════════════════════════════════ */

// Colours by job. Series: validated categorical slots (blue, orange, aqua);
// "muted" is the de-emphasis series (e.g. comparison / total behind a part).
const BX = {
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  muted: '#CBD5E1',
  good: '#0E9F6E', bad: '#E02D3C',
};

// 1,284 / 12.9K / 4.2M — for axis ticks and small labels
function bxCompact(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  const f = (n, u) => s + (+(n).toFixed(n < 10 ? 1 : 0)).toLocaleString('en-US') + u;
  if (a >= 1e9) return f(a / 1e9, 'B');
  if (a >= 1e6) return f(a / 1e6, 'M');
  if (a >= 1e3) return f(a / 1e3, 'K');
  return s + Math.round(a).toLocaleString('en-US');
}
// Round axis maximum + 4 clean steps (0 / 25K / 50K …)
// Round axis top with 3–5 clean steps, as close above the data as possible (483K → 500K, not 800K)
function bxNiceScale(max, whole = false) {
  if (!(max > 0)) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  // counts (tickets, orders) never get fractional steps such as 0.25
  if (whole && max <= 5) { const top = Math.ceil(max); return { max: top, ticks: Array.from({ length: top + 1 }, (_, i) => i) }; }
  let best = null;
  [4, 5, 3].forEach(n => {
    const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const top = step * Math.ceil(max / step - 1e-9);
    if (!best || top < best.top) best = { top, step };
  });
  const ticks = [];
  for (let t = 0; t <= best.top + 1e-9; t += best.step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { max: best.top, ticks };
}
const bxAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// tooltip payload: { t: title, r: [[name, value text, colour]] }
const bxTip = (title, rows) => bxAttr(JSON.stringify({ t: title, r: rows }));

/**
 * Columns per category.
 * opts: { categories:[label], series:[{name, values:[n], color?}], fmt?(n)->text, height?, emptyText? }
 * One series → no legend (the title names it). Two or more → legend.
 */
function bxColumns(opts) {
  const cats = opts.categories || [], series = opts.series || [], fmt = opts.fmt || (v => bxCompact(v));
  const all = series.flatMap(s => s.values.map(v => +v || 0));
  if (!cats.length || !all.some(v => v > 0)) return `<div class="bx-empty">${opts.emptyText || 'Nothing to show for this period'}</div>`;
  const sc = bxNiceScale(Math.max(...all), all.every(v => Number.isInteger(v)));
  const H = opts.height || 220;
  const color = (s, i) => s.color || (series.length > 1 && i === 0 && opts.mutedFirst ? BX.muted : BX.series[(opts.mutedFirst ? i - 1 : i) % 3]);
  const grid = sc.ticks.map(t => `<div class="bx-grid" style="bottom:${t / sc.max * 100}%"><span>${bxCompact(t)}</span></div>`).join('');
  const many = cats.length > 16;
  const colsHtml = cats.map((c, ci) => {
    const tip = bxTip(c, series.map((s, si) => [s.name, fmt(+s.values[ci] || 0), color(s, si)]));
    const bars = series.map((s, si) => {
      const v = Math.max(0, +s.values[ci] || 0);
      return `<span class="bx-col-bar" style="height:${v / sc.max * 100}%;background:${color(s, si)}"></span>`;
    }).join('');
    const showLabel = !many || ci % Math.ceil(cats.length / 12) === 0 || ci === cats.length - 1;
    return `<div class="bx-col" tabindex="0" data-bx-tip="${tip}"><div class="bx-col-bars">${bars}</div><div class="bx-col-x">${showLabel ? bxAttr(c) : ''}</div></div>`;
  }).join('');
  const legend = series.length > 1 ? `<div class="bx-legend">${series.map((s, i) => `<span><i style="background:${color(s, i)}"></i>${bxAttr(s.name)}</span>`).join('')}</div>` : '';
  return `<div class="bx bx-columns">${legend}<div class="bx-plot" style="height:${H}px">${grid}<div class="bx-cols">${colsHtml}</div></div></div>`;
}

/**
 * Concentric rings: each ring is one part's share of the total.
 * opts: { items:[{label, value}], fmt?, centerLabel?, centerValue?, max? (rings, rest folds into "Other") }
 */
// a long total (RWF 8,465,250) does not fit inside the ring: shorten the number, keep the unit
function bxShortTotal(text, total) { return String(text).length > 11 ? String(text).replace(/[\d][\d,.\s]*/, bxCompact(total)) : text; }
function bxRings(opts) {
  const fmt = opts.fmt || (v => bxCompact(v));
  let items = (opts.items || []).filter(i => +i.value > 0).sort((a, b) => b.value - a.value);
  if (!items.length) return `<div class="bx-empty">${opts.emptyText || 'Nothing to show for this period'}</div>`;
  const maxRings = opts.max || 3;
  if (items.length > maxRings) {
    const rest = items.slice(maxRings - 1);
    items = items.slice(0, maxRings - 1).concat([{ label: `Other (${rest.length})`, value: rest.reduce((a, r) => a + +r.value, 0), other: true }]);
  }
  const total = items.reduce((a, r) => a + +r.value, 0);
  const S = 180, c = S / 2, stroke = 12, gap = 7;
  const rings = items.map((it, i) => {
    const r = c - stroke / 2 - 4 - i * (stroke + gap);
    const len = 2 * Math.PI * r, share = it.value / total;
    const col = it.other ? '#94A3B8' : BX.series[i % 3];
    const tip = bxTip(it.label, [[`${(share * 100).toFixed(1)}% of total`, fmt(it.value), col]]);
    return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#EEF0F6" stroke-width="${stroke}"/>
      <circle class="bx-ring" data-bx-tip="${tip}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${Math.max(0.001, share * len - (share < 1 ? 0 : 0))} ${len}" transform="rotate(-90 ${c} ${c})"/>`;
  }).join('');
  const list = items.map((it, i) => {
    const col = it.other ? '#94A3B8' : BX.series[i % 3];
    const pct = (it.value / total * 100);
    return `<div class="bx-ring-row" tabindex="0" data-bx-tip="${bxTip(it.label, [[`${pct.toFixed(1)}% of total`, fmt(it.value), col]])}">
      <span class="bx-ring-dot" style="background:${col}"></span><span class="bx-ring-label">${bxAttr(it.label)}</span>
      <span class="bx-ring-val">${fmt(it.value)}</span><span class="bx-pill">${pct.toFixed(pct < 10 ? 1 : 0)}%</span></div>`;
  }).join('');
  return `<div class="bx bx-rings"><div class="bx-ring-chart"><svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" aria-hidden="true">${rings}</svg>
      <div class="bx-ring-center"><div class="bx-ring-cv">${opts.centerValue !== undefined ? opts.centerValue : bxShortTotal(fmt(total), total)}</div><div class="bx-ring-cl">${bxAttr(opts.centerLabel || 'Total')}</div></div></div>
    <div class="bx-ring-list">${list}</div></div>`;
}

/**
 * Ranked rows with a rounded bar.
 * opts: { items:[{label, value, sub?}], fmt?, limit? }
 */
function bxHBars(opts) {
  const fmt = opts.fmt || (v => bxCompact(v));
  const list = (opts.items || []).filter(i => +i.value > 0).sort((a, b) => b.value - a.value).slice(0, opts.limit || 8);
  if (!list.length) return `<div class="bx-empty">${opts.emptyText || 'Nothing to show for this period'}</div>`;
  const max = list[0].value, total = (opts.items || []).reduce((a, i) => a + Math.max(0, +i.value || 0), 0);
  return `<div class="bx bx-hbars">${list.map((r, i) => `<div class="bx-hrow" tabindex="0" data-bx-tip="${bxTip(r.label, [[total ? `${(r.value / total * 100).toFixed(1)}% of total` : '', fmt(r.value), BX.series[0]]])}">
      <div class="bx-hrow-top"><span class="bx-hrow-rank">${i + 1}</span><span class="bx-hrow-label">${bxAttr(r.label)}</span>${r.sub ? `<span class="bx-hrow-sub">${bxAttr(r.sub)}</span>` : ''}<span class="bx-hrow-val">${fmt(r.value)}</span></div>
      <div class="bx-hrow-track"><span style="width:${Math.max(2, r.value / max * 100)}%"></span></div></div>`).join('')}</div>`;
}

/**
 * Figure card. opts: { label, value, sub?, icon?, delta? (number %, signed), goodUp? (default true), hero?, tone?, click? }
 */
function bxStat(o) {
  const hasDelta = o.delta !== null && o.delta !== undefined && isFinite(o.delta);
  const good = hasDelta && ((o.goodUp === false) ? o.delta <= 0 : o.delta >= 0);
  const pill = hasDelta ? `<span class="bx-delta ${good ? 'up' : 'down'}">${o.delta >= 0 ? '+' : ''}${o.delta.toFixed(Math.abs(o.delta) < 10 ? 2 : 1)}%</span>` : '';
  return `<button class="bx-stat ${o.hero ? 'hero' : ''} ${o.tone || ''} ${o.click ? '' : 'static'}" ${o.click ? `onclick="${o.click}"` : 'tabindex="-1"'}>
    ${o.icon || pill ? `<div class="bx-stat-top">${o.icon ? `<span class="bx-stat-icon">${o.icon}</span>` : '<span></span>'}${pill}</div>` : ''}
    <div class="bx-stat-label">${o.label}</div>
    <div class="bx-stat-row"><span class="bx-stat-value">${o.value}</span>${o.sub ? `<span class="bx-stat-sub">${o.sub}</span>` : ''}</div>
  </button>`;
}
// signed % change, or null when there is nothing to compare with
function bxDelta(a, b) { return b === null || b === undefined || +b === 0 ? null : (a - b) / Math.abs(b) * 100; }

// ── tooltip (one for the whole app; text inserted with textContent) ─
(function bxTooltip() {
  if (typeof document === 'undefined' || window.__bxTip) return;
  window.__bxTip = true;
  let tip = null;
  const show = (el, x, y) => {
    let data; try { data = JSON.parse(el.getAttribute('data-bx-tip')); } catch (e) { return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'bx-tooltip'; document.body.appendChild(tip); }
    tip.textContent = '';
    const h = document.createElement('div'); h.className = 'bx-tt-title'; h.textContent = data.t; tip.appendChild(h);
    data.r.forEach(([name, val, col]) => {
      const row = document.createElement('div'); row.className = 'bx-tt-row';
      const key = document.createElement('i'); key.style.background = col;
      const v = document.createElement('strong'); v.textContent = val;
      const n = document.createElement('span'); n.textContent = name;
      row.append(key, v, n); tip.appendChild(row);
    });
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 10;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));   // never off a phone screen
    if (top < 8) top = y + 16;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  const hide = () => { if (tip) tip.style.display = 'none'; };
  document.addEventListener('pointermove', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;   // touch: handled on tap below
    const el = e.target.closest && e.target.closest('[data-bx-tip]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  }, { passive: true });
  // touch screens: a tap shows the values (a tap elsewhere hides them)
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const el = e.target.closest && e.target.closest('[data-bx-tip]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  }, { passive: true });
  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('[data-bx-tip]');
    if (el) { const b = el.getBoundingClientRect(); show(el, b.left + b.width / 2, b.top); }
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
})();

// Styles: shared by the app and the printed report (BX_CSS is injected into both)
const BX_CSS = `
.bx{font-family:inherit;color:#334155}
.bx-empty{color:#94A3B8;font-size:13px;text-align:center;padding:28px 0}
.bx-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#64748B;margin-bottom:10px}
.bx-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.bx-plot{position:relative;margin:4px 0 26px 44px}
.bx-grid{position:absolute;left:0;right:0;border-top:1px solid #EEF0F6}
.bx-grid span{position:absolute;left:-44px;width:38px;text-align:right;transform:translateY(-50%);font-size:11px;color:#94A3B8;font-variant-numeric:tabular-nums}
.bx-cols{position:absolute;inset:0;display:flex;align-items:stretch}
.bx-col{flex:1;min-width:0;position:relative;display:flex;flex-direction:column;justify-content:flex-end;border-radius:8px;outline:none;cursor:default}
.bx-col:hover,.bx-col:focus-visible{background:rgba(42,120,214,.06)}
.bx-col-bars{display:flex;align-items:flex-end;justify-content:center;gap:4px;height:100%}
.bx-col-bar{width:clamp(5px,30%,22px);border-radius:6px 6px 0 0;min-height:0;transition:filter .15s}
.bx-col:hover .bx-col-bar{filter:brightness(1.08)}
.bx-col-x{position:absolute;top:100%;left:50%;transform:translateX(-50%);text-align:center;font-size:11px;color:#64748B;padding-top:7px;white-space:nowrap}
.bx-columns{padding-right:6px}
.bx-rings{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.bx-ring-chart{position:relative;width:180px;height:180px;flex:0 0 auto}
.bx-ring{transition:stroke-width .15s;cursor:default}.bx-ring:hover{stroke-width:15}
.bx-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center}
.bx-ring-cv{font-size:17px;font-weight:800;color:#0F172A}
.bx-ring-cl{font-size:11px;color:#64748B;margin-top:2px}
.bx-ring-list{flex:1;min-width:200px;display:grid;gap:10px}
.bx-ring-row{display:flex;align-items:center;gap:10px;font-size:13px;outline:none;border-radius:8px;padding:2px 4px}
.bx-ring-row:hover,.bx-ring-row:focus-visible{background:#F1F5F9}
.bx-ring-dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto}
.bx-ring-label{flex:1;font-weight:600;color:#334155;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bx-ring-val{font-weight:800;color:#0F172A;white-space:nowrap}
.bx-pill{font-size:11px;font-weight:700;background:#EEF2FF;color:#3730A3;border-radius:999px;padding:2px 8px;white-space:nowrap}
.bx-hbars{display:grid;gap:12px}
.bx-hrow{outline:none;border-radius:8px;padding:2px 4px}
.bx-hrow:hover,.bx-hrow:focus-visible{background:#F8FAFC}
.bx-hrow-top{display:flex;align-items:baseline;gap:8px;font-size:13px;margin-bottom:5px}
.bx-hrow-rank{width:18px;height:18px;border-radius:6px;background:#EEF2FF;color:#3730A3;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.bx-hrow-label{font-weight:600;color:#334155;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bx-hrow-sub{font-size:11px;color:#94A3B8;white-space:nowrap}
.bx-hrow-val{font-weight:800;color:#0F172A;white-space:nowrap}
.bx-hrow-track{height:8px;border-radius:999px;background:#EEF0F6;overflow:hidden}
.bx-hrow-track span{display:block;height:100%;border-radius:999px;background:#2a78d6}
.bx-hrow:first-child .bx-hrow-track span{background:#1d5fb0}
.bx-stat{background:#fff;border:1px solid #E8EAF2;border-radius:18px;padding:16px 18px;text-align:left;font-family:inherit;color:#0F172A;cursor:pointer;min-width:0;box-shadow:0 1px 3px rgba(15,23,42,.04);transition:box-shadow .15s,transform .15s;display:flex;flex-direction:column}
.bx-stat:hover{box-shadow:0 8px 22px rgba(15,23,42,.08);transform:translateY(-1px)}
.bx-stat.static{cursor:default}.bx-stat.static:hover{transform:none;box-shadow:0 1px 3px rgba(15,23,42,.04)}
.bx-stat-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.bx-stat-icon{width:38px;height:38px;border-radius:12px;background:#F1F5F9;display:inline-flex;align-items:center;justify-content:center;font-size:18px}
.bx-delta{font-size:11px;font-weight:800;border-radius:999px;padding:3px 9px}
.bx-delta.up{background:#DCFCE7;color:#166534}.bx-delta.down{background:#FEE2E2;color:#B91C1C}
.bx-stat-label{font-size:13px;font-weight:600;color:#475569;margin:auto 0 4px}
.bx-stat-row{display:flex;flex-direction:column;gap:3px}
.bx-stat-value{font-size:24px;font-weight:800;letter-spacing:-.3px;overflow-wrap:anywhere}
.bx-stat-sub{font-size:12px;color:#64748B;line-height:1.35}
.bx-stat.good .bx-stat-value{color:#047857}.bx-stat.bad .bx-stat-value{color:#B91C1C}.bx-stat.warn .bx-stat-value{color:#C2410C}
.bx-stat.hero{background:linear-gradient(140deg,#3341d8,#2a78d6);border-color:transparent;color:#fff;box-shadow:0 10px 26px rgba(51,65,216,.28)}
.bx-stat.hero .bx-stat-icon{background:rgba(255,255,255,.18)}
.bx-stat.hero .bx-stat-label,.bx-stat.hero .bx-stat-sub{color:rgba(255,255,255,.82)}
.bx-stat.hero .bx-stat-value{color:#fff}
.bx-stat.hero .bx-delta.up{background:rgba(255,255,255,.22);color:#fff}.bx-stat.hero .bx-delta.down{background:#FEE2E2;color:#B91C1C}
.bx-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:16px}
.bx-tooltip{position:fixed;z-index:100000;display:none;pointer-events:none;background:#1E1B4B;color:#fff;border-radius:12px;padding:9px 12px;font-size:12px;box-shadow:0 10px 30px rgba(15,23,42,.3);max-width:260px}
.bx-tt-title{font-size:11px;color:#C7D2FE;margin-bottom:5px;font-weight:600}
.bx-tt-row{display:flex;align-items:center;gap:8px;margin:2px 0}
.bx-tt-row i{width:12px;height:3px;border-radius:2px;flex:0 0 auto}
.bx-tt-row strong{font-size:13px}.bx-tt-row span{color:#C7D2FE}
@media (max-width:1024px){.bx-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:520px){.bx-stat-value{font-size:20px}.bx-rings{justify-content:center}.bx-plot{margin-left:38px}.bx-grid span{left:-40px;width:34px}}
@media print{.bx-stat,.bx-stat.hero{box-shadow:none}.bx-col:hover{background:none}}
`;
(function bxInjectCss() {
  if (typeof document === 'undefined' || document.getElementById('bx-css')) return;
  const s = document.createElement('style'); s.id = 'bx-css'; s.textContent = BX_CSS; document.head.appendChild(s);
})();
