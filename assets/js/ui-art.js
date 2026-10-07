/* ═══════════════════════════════════════════════════
   BARMS PRO — ui-art.js
   Drawn product stand-ins by TYPE (beer bottle, soda can,
   spirit bottle, wine, water, juice, hot drink, cocktail,
   local brew, dish, bowl, grill) until the owner uploads a
   real photo. They show the kind of product, never a brand.
   Colours are the existing BarMS palette.
   Loaded after ui.js; replaces its uiProductThumb.
═══════════════════════════════════════════════════ */

const UI_ART_RULES = [
  ['cocktail', /cocktail|mojito|margarita|daiquiri|martini|sangria|punch/i],
  ['local',    /urwagwa|ikigage|amarwa|kanyanga|banana beer|umusururu/i],
  ['water',    /\bwater\b|\beau\b|aquafina|\bnil\b/i],
  ['hot',      /coffee|caf[eé]|\btea\b|th[eé]\b|icyayi|ikawa|cappuccino|espresso|latte|chocolat/i],
  ['juice',    /juice|\bjus\b|smoothie|milk|lait|ikivuguto|yoghurt|yogurt|inyange|minute maid/i],
  ['wine',     /wine|\bvin\b|merlot|cabernet|champagne|prosecco|ros[eé]\b|sauvignon|chardonnay/i],
  ['spirits',  /whisk|walker|jameson|daniel|vodka|\bgin\b|\brum\b|brandy|cognac|hennessy|waragi|konyagi|tequila|liqu?eu?r|liqour|amarula|baileys|smirnoff|gordon|captain|chivas|ballantine/i],
  ['soda',     /fanta|coca|\bcoke\b|sprite|pepsi|mirinda|soda|tonic|novida|krest|schweppes|bitter lemon|ginger|stoney|7 ?up|red ?bull|monster|energy|malt/i],
  ['beer',     /beer|bi[eè]re|primus|m[uü]tzig|skol|heineken|amstel|guinness|turbo|virunga|legend|gatanu|savanna|stella|tusker|lager|stout|pils|castle|bock|radler/i],
  ['skewer',   /brochette|skewer|kebab|mishkaki/i],
  ['bowl',     /isombe|soup|sauce|ubugali|bowl|salad|beans|ibishyimbo|stew|pilau|rice/i],
];
const UI_FOOD_ONLY = ['skewer', 'bowl'];

// [main, dark, tile background]
const UI_ART_CLR = {
  beer: ['#C8931A', '#92650A', '#FEF7E8'], local: ['#C8931A', '#92650A', '#FEF7E8'],
  soda: ['#F05C7A', '#BE123C', '#FEE8ED'], spirits: ['#FF8C42', '#C2410C', '#FFF0E6'],
  juice: ['#FF8C42', '#C2410C', '#FFF0E6'], wine: ['#8B5CF6', '#6D28D9', '#F0EBFF'],
  water: ['#0BBCD4', '#0891B2', '#E0F8FC'], hot: ['#7C6FA0', '#2D1B69', '#F0EBFF'],
  cocktail: ['#EC4899', '#BE123C', '#FDE8F3'], dish: ['#0EA875', '#047857', '#E0FAF2'],
  bowl: ['#0EA875', '#047857', '#E0FAF2'], skewer: ['#0EA875', '#047857', '#E0FAF2'],
  bottle: ['#5B7CFA', '#2563EB', '#EEF1FF'],
};
const UI_ART_LABEL = {
  beer: 'Beer', local: 'Local brew', soda: 'Soft drink', spirits: 'Spirit', juice: 'Juice', wine: 'Wine', water: 'Water',
  hot: 'Hot drink', cocktail: 'Cocktail', dish: 'Dish', bowl: 'Dish', skewer: 'Grill', bottle: 'Drink',
};

function uiProductKind(p) {
  const chosen = p.productType || p.product_type;
  if (chosen && UI_ART_CLR[chosen]) return chosen;   // the owner picked it
  const text = `${p.name || ''} ${p.category || ''}`;
  const isFood = p.kind === 'kitchen' || p.sourceType === 'kitchen' || /food|kitchen|plate/i.test(p.category || '');
  for (const [k, re] of UI_ART_RULES) {
    if (isFood !== UI_FOOD_ONLY.includes(k)) continue;
    if (re.test(text)) return k;
  }
  if (isFood) return 'dish';
  if (p.itemType === 'recipe') return 'cocktail';
  if (/spirit/i.test(p.category || '')) return 'spirits';
  if (/soft/i.test(p.category || '')) return 'soda';
  return 'bottle';
}

function uiProductArt(kind) {
  const [c, d] = UI_ART_CLR[kind] || UI_ART_CLR.bottle;
  const W = '#fff';
  const bottle = `<rect x="21" y="3" width="6" height="3" rx="1" fill="${d}"/><path d="M21 6h6v6c0 2.5 3.5 4.5 3.5 9v21a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V21c0-4.5 3.5-6.5 3.5-9z" fill="${c}"/><rect x="18.5" y="25" width="11" height="10" rx="1.5" fill="${W}" opacity=".9"/><path d="M20.5 22v17" stroke="${W}" stroke-width="1.4" stroke-linecap="round" opacity=".35"/>`;
  const steam = y => `<path d="M18 ${y}c-1.5 2 1.5 3 0 5M24 ${y - 1}c-1.5 2 1.5 3 0 5M30 ${y}c-1.5 2 1.5 3 0 5" stroke="${c}" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".7"/>`;
  const art = {
    beer: bottle + `<rect x="20.5" y="28" width="7" height="1.6" rx=".8" fill="${d}" opacity=".6"/>`,
    bottle,
    local: `<rect x="21.5" y="3" width="5" height="3" rx="1" fill="${d}"/><path d="M22 6h4v5c6 2 10 7 10 15 0 10-5.5 18-12 18S12 36 12 26c0-8 4-13 10-15z" fill="${c}"/><path d="M17 26c0 5 1.5 9 4 12" stroke="${W}" stroke-width="1.6" stroke-linecap="round" fill="none" opacity=".4"/><rect x="21" y="10" width="6" height="2.4" rx="1" fill="${d}"/>`,
    soda: `<rect x="16" y="6" width="16" height="4" rx="1.6" fill="#CBD5E1"/><rect x="15" y="9" width="18" height="32" rx="3" fill="${c}"/><rect x="16" y="40" width="16" height="3" rx="1.4" fill="#CBD5E1"/><rect x="15" y="18" width="18" height="12" fill="${W}" opacity=".9"/><path d="M18.5 21h11M18.5 25h7" stroke="${d}" stroke-width="1.6" stroke-linecap="round" opacity=".6"/><path d="M18 11v5M18 33v5" stroke="${W}" stroke-width="1.4" stroke-linecap="round" opacity=".4"/>`,
    spirits: `<rect x="20.5" y="3" width="7" height="4" rx="1" fill="${d}"/><rect x="21.5" y="7" width="5" height="6" fill="${c}"/><rect x="14" y="13" width="20" height="31" rx="3" fill="${c}"/><rect x="17" y="23" width="14" height="12" rx="1.2" fill="${W}" opacity=".9"/><path d="M19.5 27h9M19.5 31h6" stroke="${d}" stroke-width="1.5" stroke-linecap="round" opacity=".6"/><path d="M16.5 16v24" stroke="${W}" stroke-width="1.4" stroke-linecap="round" opacity=".35"/>`,
    wine: `<rect x="21.5" y="2" width="5" height="6" rx="1" fill="${d}"/><path d="M22 8h4v6c0 2 5 4 5 9v19a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V23c0-5 5-7 5-9z" fill="${c}"/><rect x="19" y="26" width="10" height="10" rx="1.2" fill="${W}" opacity=".9"/><path d="M21 30h6" stroke="${d}" stroke-width="1.5" stroke-linecap="round" opacity=".6"/>`,
    water: `<rect x="20" y="3" width="8" height="4" rx="1.2" fill="${d}"/><path d="M19.5 7h9l2.5 6v29a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V13z" fill="${c}" opacity=".85"/><path d="M17 20h14M17 31h14" stroke="${W}" stroke-width="1.6" opacity=".55"/><rect x="17" y="23" width="14" height="6" fill="${W}" opacity=".85"/>`,
    juice: `<path d="M14 14h20l-3 28a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2z" fill="${c}"/><path d="M14 14h20l-.6 5H14.6z" fill="${W}" opacity=".45"/><path d="M27 14l3.5-9H34" stroke="${d}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="16" cy="13" r="3.2" fill="${d}" opacity=".85"/>`,
    hot: steam(6) + `<path d="M11 17h22v11a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9z" fill="${c}"/><path d="M33 20h2a4.5 4.5 0 0 1 0 9h-2" stroke="${c}" stroke-width="2.6" fill="none"/><rect x="8" y="38.5" width="29" height="3" rx="1.5" fill="${d}"/>`,
    cocktail: `<path d="M9 9h30L24 25z" fill="${c}"/><path d="M12 12h24" stroke="${W}" stroke-width="1.6" stroke-linecap="round" opacity=".5"/><rect x="23" y="24" width="2" height="14" fill="${d}"/><rect x="16.5" y="38" width="15" height="2.6" rx="1.3" fill="${d}"/><circle cx="34" cy="8" r="3.4" fill="#0EA875"/><path d="M31 5l-6 9" stroke="${d}" stroke-width="1.3" stroke-linecap="round"/>`,
    dish: `<ellipse cx="24" cy="34" rx="18" ry="5.5" fill="${d}" opacity=".9"/><path d="M8 32a16 15 0 0 1 32 0z" fill="${c}"/><path d="M14 27a10 10 0 0 1 7-7" stroke="${W}" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".45"/><circle cx="24" cy="15" r="2.6" fill="${d}"/>`,
    bowl: steam(9) + `<ellipse cx="24" cy="20" rx="16" ry="3.5" fill="${d}"/><path d="M8 20h32a16 16 0 0 1-32 0z" fill="${c}"/><path d="M13 24a11 11 0 0 0 6 8" stroke="${W}" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".45"/><rect x="18" y="35" width="12" height="3" rx="1.5" fill="${d}"/>`,
    skewer: `<path d="M8 40L40 8" stroke="${d}" stroke-width="2" stroke-linecap="round"/><rect x="13" y="27" width="8" height="8" rx="2.4" transform="rotate(-45 17 31)" fill="${c}"/><rect x="20" y="20" width="8" height="8" rx="2.4" transform="rotate(-45 24 24)" fill="#FF8C42"/><rect x="27" y="13" width="8" height="8" rx="2.4" transform="rotate(-45 31 17)" fill="${c}"/>`,
  };
  return `<svg class="part" viewBox="0 0 48 48" role="img" aria-label="${UI_ART_LABEL[kind] || 'Product'} (illustration)">${art[kind] || bottle}</svg>`;
}

// Thumbnail: the real photo when there is one, otherwise the drawn stand-in for its type
function uiProductThumb(p, size) {
  const cls = `pthumb${size ? ' ' + size : ''}`;
  const kind = uiProductKind(p);
  const bg = (UI_ART_CLR[kind] || UI_ART_CLR.bottle)[2];
  if (p.image) {
    return `<span class="${cls}" data-art-kind="${kind}"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" onerror="uiArtFallback(this)"></span>`;
  }
  return `<span class="${cls} noimg art" style="background:${bg}" title="${UI_ART_LABEL[kind] || ''} — illustration; upload a real photo to replace">${uiProductArt(kind)}</span>`;
}
// Photo failed to load → show the illustration instead
function uiArtFallback(img) {
  const box = img.parentNode, kind = box.getAttribute('data-art-kind') || 'bottle';
  box.classList.add('noimg', 'art');
  box.style.background = (UI_ART_CLR[kind] || UI_ART_CLR.bottle)[2];
  box.innerHTML = uiProductArt(kind);
}

// ── TYPE PICKER (item forms) ───────────────────────
// uiTypePicker('bi', 'beer', 'bar', 'biName') → tiles; uiTypeValue('bi') → '' (auto) or a type
const UI_TYPE_CHOICES = {
  bar: ['beer', 'soda', 'spirits', 'wine', 'water', 'juice', 'hot', 'cocktail', 'local', 'bottle'],
  kitchen: ['dish', 'bowl', 'skewer', 'juice', 'hot'],
};
const UI_TYPE_NAMES = { bottle: 'Other drink', dish: 'Plate', bowl: 'Bowl / soup', skewer: 'Grill / skewer' };
function uiTypePicker(prefix, current, scope, nameInputId, extra) {
  const list = UI_TYPE_CHOICES[scope] || UI_TYPE_CHOICES.bar;
  const cur = list.includes(current) ? current : '';
  const tile = (val, kind, label) => `<button type="button" class="tp-opt${cur === val ? ' on' : ''}" data-val="${val}" onclick="uiTypePick('${prefix}',this)" aria-pressed="${cur === val}">
      <span class="tp-art" style="background:${(UI_ART_CLR[kind] || UI_ART_CLR.bottle)[2]}">${uiProductArt(kind)}</span><span class="tp-lbl">${label}</span></button>`;
  const guess = uiTypeGuess(prefix, scope, nameInputId, extra);
  setTimeout(() => {
    const inp = nameInputId && document.getElementById(nameInputId);
    if (inp && !inp._tpBound) { inp._tpBound = true; inp.addEventListener('input', () => uiTypeRefreshAuto(prefix, scope, nameInputId, extra)); }
    uiTypeRefreshAuto(prefix, scope, nameInputId, extra);
  }, 0);
  return `<div class="form-group"><label class="form-label">Picture type <span class="form-hint" style="display:inline;margin:0;font-weight:400">— shown until you upload a real photo</span></label>
    <div class="tp-grid" id="${prefix}TypePicker" data-scope="${scope}">
      ${tile('', guess, `Auto · ${UI_TYPE_NAMES[guess] || UI_ART_LABEL[guess]}`)}
      ${list.map(k => tile(k, k, UI_TYPE_NAMES[k] || UI_ART_LABEL[k])).join('')}
    </div><input type="hidden" id="${prefix}ProductType" value="${cur}"></div>`;
}
function uiTypeGuess(prefix, scope, nameInputId, extra) {
  const name = (nameInputId && document.getElementById(nameInputId)?.value) || '';
  return uiProductKind({ name, kind: scope === 'kitchen' ? 'kitchen' : 'bar', ...(typeof extra === 'function' ? extra() : (extra || {})) });
}
function uiTypeRefreshAuto(prefix, scope, nameInputId, extra) {
  const auto = document.querySelector(`#${prefix}TypePicker .tp-opt[data-val=""]`);
  if (!auto) return;
  const g = uiTypeGuess(prefix, scope, nameInputId, extra);
  auto.querySelector('.tp-art').innerHTML = uiProductArt(g);
  auto.querySelector('.tp-art').style.background = (UI_ART_CLR[g] || UI_ART_CLR.bottle)[2];
  auto.querySelector('.tp-lbl').textContent = `Auto · ${UI_TYPE_NAMES[g] || UI_ART_LABEL[g]}`;
}
function uiTypePick(prefix, btn) {
  document.querySelectorAll(`#${prefix}TypePicker .tp-opt`).forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', b === btn); });
  document.getElementById(`${prefix}ProductType`).value = btn.dataset.val;
}
function uiTypeValue(prefix) { return document.getElementById(`${prefix}ProductType`)?.value || ''; }