/* ============================================================
   Sukrill's Pokémon Cards — vanilla JS
   Grid + search/filter/sort + card modal, wishlist (localStorage),
   share wishlist, message Sukrill, and GA4 event tracking.
   ============================================================ */
'use strict';

const PAGE_SIZE = 60;
const PLACEHOLDER = placeholderSVG();
const SHOP_URL = 'https://www.whatnot.com/user/sukrill/shop';
const WISH_KEY   = 'sukrill_wishlist_v1';   // LEGACY: array of inventory ids (migrated on load)
const WISH_KEY2  = 'sukrill_wishlist_v2';   // current: [{id, name, set}] — identity-aware
const LEGACY_NOTIFY_KEY = 'sukrill_notify_v1';   // removed feature — cleaned up on load

const state = {
  all: [],
  filtered: [],
  rendered: 0,
  byId: new Map(),          // id -> card
  direct: false,            // "Direct" toggle — knocks 5% off every shown price
};

// Direct-sale discount (buying directly, off Whatnot). Applied to display only.
const DIRECT_RATE = 0.05;
function shownPrice(c) {
  const p = Number(c && c.price) || 0;
  return state.direct ? p * (1 - DIRECT_RATE) : p;
}
function fmtUSD(n) { return '$' + (Number(n) || 0).toFixed(2); }

const els = {
  grid:        document.getElementById('grid'),
  empty:       document.getElementById('empty'),
  search:      document.getElementById('search'),
  searchClear: document.getElementById('search-clear'),
  filterSet:   document.getElementById('filter-set'),
  filterTag:   document.getElementById('filter-tag'),
  filterStock: document.getElementById('filter-instock'),
  sort:        document.getElementById('sort'),
  resultCount: document.getElementById('result-count'),
  resetBtn:    document.getElementById('reset-btn'),
  filtersToggle:  document.getElementById('filters-toggle'),
  filtersPanel:   document.getElementById('filters'),
  filtersBackdrop:document.getElementById('filters-backdrop'),
  filtersDone:    document.getElementById('filters-done'),
  filtersCount:   document.getElementById('filters-count'),
  statCount:   document.getElementById('stat-count'),
  syncDate:    document.getElementById('sync-date'),
  syncTime:    document.getElementById('sync-time'),
  sentinel:    document.getElementById('sentinel'),
  loadMoreWrap:document.getElementById('load-more-wrap'),
  loadMore:    document.getElementById('load-more'),
  toast:       document.getElementById('toast'),
  modal:       document.getElementById('modal'),
  // wishlist
  wishBtn:     document.getElementById('wishlist-btn'),
  wishCount:   document.getElementById('wishlist-count'),
  wishModal:   document.getElementById('wishlist-modal'),
  wishList:    document.getElementById('wl-list'),
  wishEmpty:   document.getElementById('wl-empty'),
  wishTitle:   document.getElementById('wl-title'),
  wishNote:    document.getElementById('wl-shared-note'),
  wishActions: document.getElementById('wl-actions'),
  wishShare:   document.getElementById('wl-share'),
  wishMessage: document.getElementById('wl-message'),
  wishTotals:  document.getElementById('wl-totals'),
  wishTotCount:document.getElementById('wl-total-count'),
  wishTotValue:document.getElementById('wl-total-value'),
  wishCopyNums:document.getElementById('wl-copy-nums'),
  wishClear:   document.getElementById('wl-clear'),
};

// Element to restore keyboard focus to when a modal/sheet closes.
let lastFocused = null;

/* ============================================================
   ANALYTICS — single reusable helper (never duplicate event code)
   Every event flows through track():
     1. sent to GA4 (gtag)
     2. appended to a local rolling buffer in localStorage
   The buffer future-proofs a later export to the "Website Analytics"
   Google Sheet tab (no Apps Script yet). Because every wishlist/view/buy
   action is captured uniformly with an inventory_id, the data can later be
   aggregated to answer: most wishlisted / viewed / shared / bought / searched.
   ============================================================ */
const EVENT_BUFFER_KEY = 'sukrill_events_v1';
const EVENT_BUFFER_MAX = 500;

// ── Interest collector (Google Apps Script Web App → "Website Analytics" sheet) ──
// Deployed Apps Script Web App URL (ends in /exec). Empty = off.
const ANALYTICS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwXmn59zzsVa-_UvPP8QDJWVVptzY-oPRJmNNTPi7e-y6WQa_21G7IpiE_TKP04OQ/exec';
// Only these "interest" events are sent to the sheet (search/filter/sort are noise).
const COLLECT_EVENTS = new Set(['wishlist_add', 'card_open', 'buy_click', 'message_sukrill', 'image_zoom']);

// Stable per-visitor id so the dashboard can count unique interest, not just hits.
function _sid() {
  try {
    let s = localStorage.getItem('sukrill_sid_v1');
    if (!s) { s = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); localStorage.setItem('sukrill_sid_v1', s); }
    return s;
  } catch (_) { return ''; }
}

function _sendInterest(name, params) {
  if (!ANALYTICS_ENDPOINT || !COLLECT_EVENTS.has(name)) return;
  const payload = JSON.stringify({
    event: name,
    inventory_id: params.inventory_id || '',
    card_name: params.card_name || '',
    set: params.set || '',
    price: (params.price != null ? params.price : ''),
    session: _sid(),
  });
  try {
    // text/plain avoids a CORS preflight Apps Script can't answer; fire-and-forget.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([payload], { type: 'text/plain' }));
    } else {
      fetch(ANALYTICS_ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true,
        headers: { 'Content-Type': 'text/plain' }, body: payload });
    }
  } catch (_) { /* never let analytics break the UI */ }
}

function track(name, params) {
  params = params || {};
  // 1) Google Analytics 4
  try { if (typeof window.gtag === 'function') window.gtag('event', name, params); }
  catch (_) { /* never let analytics break the UI */ }
  // 2) Local rolling buffer for future export
  try {
    const arr = JSON.parse(localStorage.getItem(EVENT_BUFFER_KEY) || '[]');
    arr.push({ event: name, params, ts: Date.now() });
    if (arr.length > EVENT_BUFFER_MAX) arr.splice(0, arr.length - EVENT_BUFFER_MAX);
    localStorage.setItem(EVENT_BUFFER_KEY, JSON.stringify(arr));
  } catch (_) { /* private mode / quota — ignore */ }
  // 3) Interest collector → Google Sheet (only when configured)
  _sendInterest(name, params);
}

// Exposed for a future export routine (e.g. POST the buffer to a sheet endpoint).
window.getAnalyticsBuffer = function () {
  try { return JSON.parse(localStorage.getItem(EVENT_BUFFER_KEY) || '[]'); }
  catch (_) { return []; }
};

// Loading skeleton shown while inventory.json is being fetched.
function showSkeletons(n) {
  els.grid.innerHTML = Array.from({ length: n }, () =>
    '<div class="card skel" aria-hidden="true">' +
      '<div class="card-img-wrap"><div class="skel-box"></div></div>' +
      '<div class="card-body"><div class="skel-line"></div><div class="skel-line short"></div></div>' +
    '</div>').join('');
}

// ── Boot ──────────────────────────────────────────────────
const _splashStart = performance.now();
function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  const wait = Math.max(0, 2500 - (performance.now() - _splashStart));   // show ≥2.5s
  setTimeout(() => {
    s.classList.add('splash-hide');
    setTimeout(() => s.remove(), 550);   // remove after the fade
  }, wait);
}
init();

async function init() {
  try {
    showSkeletons(12);
    const res = await fetch('inventory.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.all = (data.cards || []).map(normalize);
    state.byId = new Map(state.all.map(c => [c.id, c]));
    // Identity index (name+set) — the reuse-proof way to match a saved wishlist
    // item to a current card. First card wins on the rare duplicate identity.
    state.byIdent = new Map();
    for (const c of state.all) {
      const k = identKey(c.name, c.set);
      if (!state.byIdent.has(k)) state.byIdent.set(k, c);
    }
    migrateWishlist();   // upgrade v1 number-only lists → v2 identity snapshots
    renderHeadline(data);
    buildFilterOptions();
    bindEvents();
    updateWishUI();
    try { localStorage.removeItem(LEGACY_NOTIFY_KEY); } catch (_) {}  // purge removed feature's storage
    apply();
    openFromURL();
    openSharedWishlistFromURL();
  } catch (err) {
    els.grid.innerHTML = '';
    els.empty.hidden = false;
    els.empty.querySelector('p').textContent = 'Inventory could not be loaded. Please refresh the page.';
    els.resultCount.textContent = 'Failed to load inventory';
    console.error(err);
  } finally {
    hideSplash();   // always clear the splash, even on error
  }
}

function normalize(c) {
  return {
    id:        String(c.id ?? ''),
    name:      c.name || 'Unknown Card',
    set:       c.set || '',
    number:    c.number || '',
    condition: c.condition || '',
    price:     Number(c.price) || 0,
    quantity:  Number(c.quantity) || 0,
    image:     c.image || '',
    imageFull: c.imageFull || c.image || '',   // high-res for the detail flyout + zoom
    dateAdded: c.dateAdded || '',
    notes:     c.notes || '',
    listingUrl:c.listingUrl || '',
    tags:      Array.isArray(c.tags) ? c.tags.map(String).filter(Boolean) : [],
  };
}

// ── Headline stats (Total Value intentionally NOT shown) ──
function renderHeadline(data) {
  const count = data.totalCards ?? state.all.length;
  els.statCount.textContent = count.toLocaleString();
  // "Inventory Last Synced" — date + time. Time comes from inventory.json's
  // lastUpdated when it includes a T<time> component; otherwise date only.
  const { date, time } = splitSync(data.lastUpdated || '');
  els.syncDate.textContent = date || '—';
  els.syncTime.textContent = time || '';
}

function splitSync(raw) {
  if (!raw) return { date: '', time: '' };
  const hasTime = String(raw).includes('T');
  const d = new Date(hasTime ? raw : raw + 'T00:00:00');
  if (isNaN(d)) return { date: String(raw), time: '' };
  // e.g. "July 12, 2026" · "7:04 PM CST" — time includes the local timezone
  const date = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const time = hasTime
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : '';
  return { date, time };
}

// ── Filter dropdowns ──────────────────────────────────────
function buildFilterOptions() {
  const sets  = [...new Set(state.all.map(c => c.set).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  for (const s of sets)  els.filterSet.appendChild(new Option(s, s));

  // Tag dropdown: only tags shared by 2+ cards, so one-off notes/typos don't
  // clutter it. (All tags remain searchable regardless — see apply().) Matched
  // case-insensitively; the most common casing is shown as the label.
  const counts = new Map();   // lowerKey -> {label, count}
  for (const c of state.all)
    for (const t of c.tags) {
      const k = t.toLowerCase();
      const e = counts.get(k) || { label: t, count: 0 };
      e.count++; counts.set(k, e);
    }
  const tags = [...counts.values()].filter(e => e.count >= 2)
                 .sort((a, b) => a.label.localeCompare(b.label));
  for (const { label } of tags) els.filterTag.appendChild(new Option(label, label.toLowerCase()));
  if (!tags.length) els.filterTag.style.display = 'none';
}

// ── Events ────────────────────────────────────────────────
function bindEvents() {
  els.search.addEventListener('input', debounce(() => {
    els.searchClear.hidden = !els.search.value;
    apply();
    const q = els.search.value.trim();
    if (q.length >= 2) track('search', { search_term: q.toLowerCase(), results: state.filtered.length });
  }, 300));
  els.searchClear.addEventListener('click', () => {
    els.search.value = ''; els.searchClear.hidden = true; apply(); els.search.focus();
  });
  els.filterSet.addEventListener('change', () => { apply(); track('filter', { filter_type: 'set', value: els.filterSet.value || '(all)' }); });
  els.filterTag.addEventListener('change', () => { apply(); track('filter', { filter_type: 'type', value: els.filterTag.value || '(all)' }); });
  els.filterStock.addEventListener('change', () => { apply(); track('filter', { filter_type: 'in_stock', value: els.filterStock.checked }); });
  els.sort.addEventListener('change', () => { apply(); track('sort', { sort_by: els.sort.value }); });
  els.resetBtn.addEventListener('click', resetFilters);
  els.loadMore.addEventListener('click', renderNextBatch);

  // Mobile filters bottom sheet
  els.filtersToggle.addEventListener('click', openFilters);
  els.filtersDone.addEventListener('click', closeFilters);
  els.filtersBackdrop.addEventListener('click', closeFilters);

  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) renderNextBatch();
  }, { rootMargin: '600px' });
  io.observe(els.sentinel);

  // Card modal close
  els.modal.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.filtersPanel.classList.contains('open')) closeFilters();
    else if (!els.wishModal.hidden) closeSheet(els.wishModal);
    else closeModal();
  });
  window.addEventListener('popstate', openFromURL);

  // "/" focuses the search field (unless already typing in a field)
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    const tag = el && el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
    e.preventDefault();
    els.search.focus();
  });

  // Subtle shadow under the sticky header once the page scrolls
  const stickyHeader = document.getElementById('sticky-header');
  if (stickyHeader) {
    const onScroll = () => stickyHeader.classList.toggle('scrolled', window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // "Direct" price toggle — 5% off every shown price when on
  const directSwitch = document.getElementById('direct-switch');
  if (directSwitch) {
    directSwitch.addEventListener('change', () => setDirect(directSwitch.checked));
  }

  // Wishlist header button
  els.wishBtn.addEventListener('click', openWishlist);
  els.wishModal.addEventListener('click', (e) => { if (e.target.dataset.closeWish !== undefined) closeSheet(els.wishModal); });
  els.wishShare.addEventListener('click', shareWishlist);
  els.wishMessage.addEventListener('click', messageSukrill);
  els.wishCopyNums.addEventListener('click', copyInventoryNumbers);
  els.wishClear.addEventListener('click', clearWishlist);
}

function resetFilters() {
  els.search.value = ''; els.searchClear.hidden = true;
  els.filterSet.value = ''; els.filterTag.value = '';
  els.filterStock.checked = false; els.sort.value = '';   // '' restores the "Sort order" label (sorts by inv#)
  apply();
}

// ── Mobile filters bottom sheet ───────────────────────────
function openFilters() {
  els.filtersPanel.classList.add('open');
  els.filtersBackdrop.hidden = false;
  els.filtersToggle.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}
function closeFilters() {
  els.filtersPanel.classList.remove('open');
  els.filtersBackdrop.hidden = true;
  els.filtersToggle.setAttribute('aria-expanded', 'false');
  if (allSheetsClosed()) document.body.style.overflow = '';
  els.filtersToggle.focus({ preventScroll: true });
}
function activeFilterCount() {
  let n = 0;
  if (els.filterSet.value) n++;
  if (els.filterTag.value && els.filterTag.style.display !== 'none') n++;
  if (els.filterStock.checked) n++;
  if (els.sort.value && els.sort.value !== 'inv-asc') n++;   // '' = default (inv#), not an active filter
  return n;
}

// ── Search + filter + sort ────────────────────────────────
function apply() {
  const q      = els.search.value.trim().toLowerCase();
  const fSet   = els.filterSet.value;
  const fTag   = els.filterTag.value;   // stored lower-case
  const inStock= els.filterStock.checked;
  const terms  = q.split(/\s+/).filter(Boolean);

  let list = state.all.filter(c => {
    if (fSet && c.set !== fSet) return false;
    if (fTag && !c.tags.some(t => t.toLowerCase() === fTag)) return false;
    if (inStock && c.quantity <= 0) return false;
    if (terms.length) {
      // tags (Cute, Pink, illustrator names…) are searchable even when not in the dropdown
      const hay = (c.name + ' ' + c.set + ' ' + c.number + ' ' + c.id + ' ' + c.tags.join(' ')).toLowerCase();
      if (!terms.every(t => hay.includes(t))) return false;
    }
    return true;
  });

  list.sort(sorter(els.sort.value));
  state.filtered = list;

  const filtersActive = q || fSet || fTag || inStock || (els.sort.value && els.sort.value !== 'inv-asc');
  els.resetBtn.hidden = !filtersActive;
  els.resultCount.textContent =
    `${list.length.toLocaleString()} card${list.length === 1 ? '' : 's'}` +
    (filtersActive ? ` (of ${state.all.length.toLocaleString()})` : '');

  // Filter-count badge on the mobile toggle (search is not counted here)
  const fc = activeFilterCount();
  els.filtersCount.textContent = fc;
  els.filtersCount.hidden = fc === 0;

  els.grid.innerHTML = '';
  state.rendered = 0;
  els.empty.hidden = list.length > 0;
  renderNextBatch();
}

// Flip the "Direct" 5%-off pricing on/off and refresh everything showing a price
function setDirect(on) {
  state.direct = !!on;
  document.body.classList.toggle('direct-on', state.direct);
  apply();                                   // redraw the grid at the new prices
  if (!els.wishModal.hidden) renderWishlist();  // wishlist rows + total
  // Live-update an open card modal
  if (!els.modal.hidden && els.modal.dataset.cardId) {
    const c = state.byId.get(String(els.modal.dataset.cardId));
    const mp = els.modal.querySelector('#m-price');
    if (c && mp) mp.textContent = fmtUSD(shownPrice(c));
  }
  track('direct_toggle', { on: state.direct });
}

function sorter(mode) {
  switch (mode) {
    case 'name-asc':  return (a, b) => a.name.localeCompare(b.name);
    case 'name-desc': return (a, b) => b.name.localeCompare(a.name);
    case 'price-asc': return (a, b) => a.price - b.price;
    case 'price-desc':return (a, b) => b.price - a.price;
    case 'inv-asc':
    default:          // default: ascending by inventory number
                      return (a, b) => (Number(a.id) - Number(b.id)) || a.id.localeCompare(b.id);
  }
}

// ── Rendering ─────────────────────────────────────────────
function renderNextBatch() {
  const next = state.filtered.slice(state.rendered, state.rendered + PAGE_SIZE);
  if (!next.length) { els.loadMoreWrap.hidden = true; return; }
  const frag = document.createDocumentFragment();
  for (const c of next) frag.appendChild(cardEl(c));
  els.grid.appendChild(frag);
  state.rendered += next.length;
  els.loadMoreWrap.hidden = state.rendered >= state.filtered.length;
}

function cardEl(c) {
  const el = document.createElement('article');
  el.className = 'card';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', c.name);

  const oos = c.quantity <= 0;
  const wished = isWished(c.id);
  el.innerHTML = `
    <div class="card-img-wrap">
      ${c.image
        ? `<img alt="${escapeHtml(c.name)}" loading="lazy" decoding="async" src="${escapeAttr(c.image)}"
               onload="this.classList.add('loaded')"
               onerror="this.replaceWith(makePlaceholder())">`
        : PLACEHOLDER}
      <span class="card-id">#${escapeHtml(c.id)}</span>
      ${oos ? '<span class="badge-oos">Sold</span>' : ''}
      <button class="card-heart${wished ? ' active' : ''}" data-id="${escapeAttr(c.id)}"
              title="${wished ? 'Remove from wishlist' : 'Add to wishlist'}"
              aria-label="${wished ? 'Remove ' + escapeAttr(c.name) + ' from wishlist' : 'Add ' + escapeAttr(c.name) + ' to wishlist'}"
              aria-pressed="${wished ? 'true' : 'false'}">
        <svg class="heart-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
      </button>
    </div>
    <div class="card-body">
      <div class="card-name">${escapeHtml(c.name)}</div>
      <div class="card-set">${escapeHtml(c.set || '—')}</div>
      <div class="card-meta">${escapeHtml([c.number, c.condition].filter(Boolean).join(' · ') || '')}</div>
      <div class="card-foot">
        <span class="card-price${state.direct ? ' direct' : ''}">${fmtUSD(shownPrice(c))}</span>
      </div>
    </div>`;
  el.addEventListener('click', () => openModal(c.id, true));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(c.id, true); } });
  const heart = el.querySelector('.card-heart');
  heart.addEventListener('click', (e) => {
    e.stopPropagation();
    const willAdd = !isWished(c.id);
    toggleWish(c.id);
    if (willAdd) { heart.classList.remove('pop'); void heart.offsetWidth; heart.classList.add('pop'); }
  });
  return el;
}

window.makePlaceholder = function () {
  const d = document.createElement('div');
  d.innerHTML = PLACEHOLDER;
  return d.firstElementChild;
};

// ── Card modal ────────────────────────────────────────────
function openModal(id, pushUrl) {
  const c = state.byId.get(String(id));
  if (!c) return;
  const m = els.modal;
  const img = m.querySelector('#m-img');
  const full = c.imageFull || c.image;
  if (c.image) {
    img.src = full; img.alt = c.name; img.style.display = '';
    img.onerror = () => { img.style.display = 'none'; };
    // Click the detail image to open the full-res zoom lightbox
    img.style.cursor = 'zoom-in';
    img.title = 'Click to zoom';
    img.onclick = () => openZoom(full, c.name, c.id);
  } else {
    img.removeAttribute('src'); img.style.display = 'none'; img.onclick = null; img.style.cursor = '';
  }

  m.dataset.cardId = c.id;   // let the Direct toggle re-price an open modal
  m.querySelector('#m-name').textContent  = c.name;
  m.querySelector('#m-price').textContent = fmtUSD(shownPrice(c));

  const rows = [
    ['Set', c.set], ['Card #', c.number], ['Condition', c.condition],
    ...(c.quantity <= 0 ? [['Status', 'Sold']] : []),   // qty is always 1 when in stock — omit it
    ['Inventory ID', '#' + c.id],
    ['Added', c.dateAdded ? formatDate(c.dateAdded) : ''],
  ].filter(([, v]) => v !== '' && v != null);
  m.querySelector('#m-details').innerHTML =
    rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');

  // Tag chips (Cute, Pink, illustrator…). Clicking one filters the grid by it.
  const tagsWrap = m.querySelector('#m-tags');
  if (c.tags.length) {
    tagsWrap.hidden = false;
    tagsWrap.innerHTML = c.tags.map(t =>
      `<button type="button" class="tag-chip" data-tag="${escapeAttr(t.toLowerCase())}">${escapeHtml(t)}</button>`
    ).join('');
    tagsWrap.querySelectorAll('.tag-chip').forEach(btn =>
      btn.addEventListener('click', () => {
        const val = btn.dataset.tag;
        const opt = [...els.filterTag.options].find(o => o.value === val);
        closeModal();
        if (opt) { els.filterTag.value = val; }        // dropdown-backed tag
        else { els.search.value = btn.textContent; els.searchClear.hidden = false; }  // rare tag → search
        apply();
        track('filter', { filter_type: 'type', value: val, source: 'chip' });
      }));
  } else {
    tagsWrap.hidden = true; tagsWrap.innerHTML = '';
  }

  const notesWrap = m.querySelector('#m-notes-wrap');
  if (c.notes) { notesWrap.hidden = false; m.querySelector('#m-notes').textContent = c.notes; }
  else notesWrap.hidden = true;

  const oos = c.quantity <= 0;

  // Buy button (routes to per-listing URL if present, else general shop)
  const buy = m.querySelector('#m-buy');
  const hasListing = !!c.listingUrl;
  buy.href = c.listingUrl || SHOP_URL;
  buy.hidden = oos;                          // no buy link for sold-out cards
  buy.onclick = () => {
    // Single buy_click event; destination preserves the shop-vs-listing distinction.
    track('buy_click', {
      inventory_id: c.id, card_name: c.name, price: c.price,
      destination: hasListing ? 'listing' : 'shop',
    });
  };

  // Wishlist toggle
  const wish = m.querySelector('#m-wish');
  syncWishBtn(wish, c);

  m.querySelector('#m-copy').onclick  = () => { copyText(cardText(c)); toast('Card info copied'); };
  m.querySelector('#m-share').onclick = () => { copyText(shareURL(c.id)); toast('Shareable link copied'); };

  lastFocused = document.activeElement;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  m.querySelector('.modal-close').focus({ preventScroll: true });
  if (pushUrl) history.pushState({ card: c.id }, '', shareURL(c.id, true));

  track('card_open', { inventory_id: c.id, card_name: c.name, price: c.price, set: c.set });
}

function syncWishBtn(btn, c) {
  const on = isWished(c.id);
  btn.textContent = on ? '❤️ In Wishlist — Remove' : '＋ Add to Wishlist';
  btn.classList.toggle('active', on);
  btn.onclick = () => { toggleWish(c.id); syncWishBtn(btn, c); };
}

function closeModal() {
  if (els.modal.hidden) return;
  els.modal.hidden = true;
  if (allSheetsClosed()) document.body.style.overflow = '';
  // Robustly strip only the ?card param, preserving any other params
  const params = new URLSearchParams(location.search);
  if (params.has('card')) {
    params.delete('card');
    const qs = params.toString();
    history.pushState({}, '', location.pathname + (qs ? '?' + qs : ''));
  }
  restoreFocus();
}

function restoreFocus() {
  if (lastFocused && typeof lastFocused.focus === 'function') {
    lastFocused.focus({ preventScroll: true });
  }
  lastFocused = null;
}

function openFromURL(evt) {
  const id = new URLSearchParams(location.search).get('card');
  if (id) {
    if (state.byId.has(String(id))) {
      // Only count as a deep link on first load, not on back/forward (popstate)
      if (!evt || evt.type !== 'popstate') track('deep_link_open', { type: 'card', inventory_id: String(id) });
      openModal(id, false);
    } else {
      // Malformed / stale ?card= → clean it up instead of leaving a dead URL
      toast('That card is no longer available');
      const params = new URLSearchParams(location.search);
      params.delete('card');
      const qs = params.toString();
      history.replaceState({}, '', location.pathname + (qs ? '?' + qs : ''));
    }
  } else if (!els.modal.hidden) {
    closeModal();
  }
}

/* ============================================================
   IMAGE ZOOM LIGHTBOX  (wheel / pinch / drag-pan)
   ============================================================ */
const _z = { scale: 1, tx: 0, ty: 0, min: 1, max: 5 };
const _zPtrs = new Map();
let _zPinchDist = 0, _zLast = null;

function _zClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function _zApply() {
  const img = document.getElementById('zoom-img');
  if (!img) return;
  _z.scale = _zClamp(_z.scale, _z.min, _z.max);
  if (_z.scale <= 1.001) { _z.tx = 0; _z.ty = 0; }
  img.style.transform = `translate(${_z.tx}px, ${_z.ty}px) scale(${_z.scale})`;
  img.style.cursor = _z.scale > 1 ? 'grab' : 'zoom-in';
}
function _zBy(f) { _z.scale = _zClamp(_z.scale * f, _z.min, _z.max); if (_z.scale <= 1.001) { _z.tx = 0; _z.ty = 0; } _zApply(); }

function openZoom(src, alt, id) {
  const ov = document.getElementById('zoom-overlay');
  const img = document.getElementById('zoom-img');
  if (!ov || !img || !src) return;
  img.src = src; img.alt = alt || '';
  _z.scale = 1; _z.tx = 0; _z.ty = 0; _zApply();
  ov.hidden = false;
  document.body.style.overflow = 'hidden';
  try { track('image_zoom', { inventory_id: id || '' }); } catch (_) {}
}
function closeZoom() {
  const ov = document.getElementById('zoom-overlay');
  if (!ov || ov.hidden) return;
  ov.hidden = true;
  const img = document.getElementById('zoom-img');
  if (img) img.removeAttribute('src');
  _zPtrs.clear(); _zPinchDist = 0; _zLast = null;
  // keep the scroll lock if the card modal is still open behind the lightbox
  if (els.modal && els.modal.hidden && (typeof allSheetsClosed !== 'function' || allSheetsClosed()))
    document.body.style.overflow = '';
}

(function initZoom() {
  const ov = document.getElementById('zoom-overlay');
  const img = document.getElementById('zoom-img');
  if (!ov || !img) return;
  ov.addEventListener('wheel', e => { e.preventDefault(); _zBy(e.deltaY < 0 ? 1.15 : 0.87); }, { passive: false });
  img.addEventListener('dblclick', e => { e.preventDefault(); _z.scale = _z.scale > 1 ? 1 : 2.5; if (_z.scale === 1) { _z.tx = 0; _z.ty = 0; } _zApply(); });
  img.addEventListener('pointerdown', e => {
    img.setPointerCapture(e.pointerId);
    _zPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (_zPtrs.size === 1) _zLast = { x: e.clientX, y: e.clientY };
  });
  img.addEventListener('pointermove', e => {
    if (!_zPtrs.has(e.pointerId)) return;
    _zPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [..._zPtrs.values()];
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (_zPinchDist) _zBy(d / _zPinchDist);
      _zPinchDist = d; _zLast = null;
    } else if (pts.length === 1 && _z.scale > 1 && _zLast) {
      _z.tx += e.clientX - _zLast.x; _z.ty += e.clientY - _zLast.y;
      _zLast = { x: e.clientX, y: e.clientY }; _zApply();
    }
  });
  const up = e => {
    _zPtrs.delete(e.pointerId);
    if (_zPtrs.size < 2) _zPinchDist = 0;
    _zLast = _zPtrs.size === 1 ? { ...[..._zPtrs.values()][0] } : null;
  };
  img.addEventListener('pointerup', up);
  img.addEventListener('pointercancel', up);
  ov.addEventListener('click', e => { if (e.target === ov) closeZoom(); });
  const closeBtn = document.getElementById('zoom-close');
  if (closeBtn) closeBtn.addEventListener('click', closeZoom);
  // Capture phase so Escape closes the lightbox BEFORE the card modal handler.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !ov.hidden) { e.stopPropagation(); closeZoom(); }
  }, true);
})();

/* ============================================================
   WISHLIST
   ============================================================ */
// Identity key — how a saved card is matched to a live one. Inventory numbers get
// REUSED, so we key wishlist items by name+set instead. Kept forgiving (case /
// whitespace) since both sides come from the same generator.
function identKey(name, set) {
  return ((name || '') + '||' + (set || '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Canonical wishlist = array of {id, name, set}. Reads v2; if absent, migrates a
// legacy v1 number-only list (name/set filled in later by migrateWishlist()).
function getWish() {
  try {
    const v2 = JSON.parse(localStorage.getItem(WISH_KEY2));
    if (Array.isArray(v2)) {
      const seen = new Set(), out = [];
      for (const e of v2) {
        const id = String((e && e.id != null ? e.id : e) || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, name: String((e && e.name) || ''), set: String((e && e.set) || '') });
      }
      return out;
    }
  } catch (_) {}
  try {
    const v1 = JSON.parse(localStorage.getItem(WISH_KEY));   // legacy: ["0202", …]
    if (Array.isArray(v1)) {
      const seen = new Set(), out = [];
      for (const x of v1) {
        const id = String(x || '').trim();
        if (id && !seen.has(id)) { seen.add(id); out.push({ id, name: '', set: '' }); }
      }
      return out;
    }
  } catch (_) {}
  return [];
}
function saveWish(entries) { try { localStorage.setItem(WISH_KEY2, JSON.stringify(entries)); } catch (_) {} }
function getWishIds() { return getWish().map(e => e.id); }

// Resolve a saved entry to the CURRENT live card. With a saved identity we match
// by name+set and NEVER by number — that's what stops a reused number from
// swapping in a different card, and it re-links a card that returned under a new #.
function resolveWish(e) {
  if (e.name || e.set) return state.byIdent.get(identKey(e.name, e.set)) || null;
  return state.byId.get(String(e.id)) || null;   // legacy id-only entry
}

// Current inventory ids that are wished (for grid hearts / buttons).
function wishedIdSet() {
  const s = new Set();
  for (const e of getWish()) { const c = resolveWish(e); if (c) s.add(c.id); }
  return s;
}

// Is the card currently at inventory #id on the wishlist? (identity-aware)
function isWished(id) {
  const c = state.byId.get(String(id));
  const entries = getWish();
  if (c) {
    const key = identKey(c.name, c.set);
    return entries.some(e => (e.name || e.set) ? identKey(e.name, e.set) === key : String(e.id) === String(c.id));
  }
  return entries.some(e => String(e.id) === String(id));
}

// One-time upgrade: fill name/set on any id-only entries from current inventory,
// then persist as v2. Best-effort — a number already reused can only snapshot
// whatever it points to now, but every future add stores identity at add-time.
function migrateWishlist() {
  const entries = getWish();
  for (const e of entries) {
    if (!e.name && !e.set) {
      const c = state.byId.get(String(e.id));
      if (c) { e.name = c.name; e.set = c.set; }
    }
  }
  saveWish(entries);
}

// Playful "I want that!" bubble popped above the clicked heart (or the modal add button)
function showWantBubble(id) {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    toast('Added to wishlist ❤️');
    return;
  }
  const mWish = document.getElementById('m-wish');
  const modalOpen = mWish && mWish.offsetParent !== null;   // card modal is showing
  let anchor = mWish;
  if (!modalOpen) {
    try {
      const sel = '.card-heart[data-id="' + (window.CSS && CSS.escape ? CSS.escape(String(id)) : id) + '"]';
      anchor = document.querySelector(sel) || mWish;
    } catch (_) { anchor = mWish; }
  }
  if (!anchor) { toast('Added to wishlist ❤️'); return; }
  const r = anchor.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'want-bubble';
  b.textContent = 'I want that!';
  b.style.left = (r.left + r.width / 2) + 'px';
  b.style.top  = r.top + 'px';
  document.body.appendChild(b);
  b.addEventListener('animationend', () => b.remove());
  setTimeout(() => { if (b.parentNode) b.remove(); }, 1400);   // safety cleanup
}

function toggleWish(id) {
  id = String(id);
  const c = state.byId.get(id);          // the live card at this number (may be null if gone)
  let entries = getWish();
  if (isWished(id)) {
    // Remove by identity when we have a card; otherwise by the saved number.
    if (c) {
      const key = identKey(c.name, c.set);
      entries = entries.filter(e => (e.name || e.set) ? identKey(e.name, e.set) !== key : String(e.id) !== id);
    } else {
      entries = entries.filter(e => String(e.id) !== id);
    }
    saveWish(entries);
    track('wishlist_remove', { inventory_id: id });
    toast('Removed from wishlist');
  } else {
    // Store a name+set snapshot so a future number reuse can never swap the card.
    entries.push(c ? { id: c.id, name: c.name, set: c.set } : { id, name: '', set: '' });
    saveWish(entries);
    track('wishlist_add', { inventory_id: id, card_name: c ? c.name : '', price: c ? c.price : 0 });
    showWantBubble(id);
  }
  updateWishUI();
}

function updateWishUI() {
  const entries = getWish();
  // Header badge — instant count + a subtle bounce when it changes
  if (els.wishCount.textContent !== String(entries.length)) {
    els.wishCount.textContent = entries.length;
    els.wishCount.classList.remove('bounce');
    void els.wishCount.offsetWidth;           // restart the animation
    els.wishCount.classList.add('bounce');
  }
  // sync any hearts currently in the grid (targeted, no full re-render).
  // Toggle class/aria only — the SVG stays; CSS handles outline↔filled.
  const wished = wishedIdSet();
  document.querySelectorAll('.card-heart').forEach(h => {
    const on = wished.has(h.dataset.id);
    h.classList.toggle('active', on);
    h.title = on ? 'Remove from wishlist' : 'Add to wishlist';
    h.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  // if the wishlist sheet is open (own list), re-render it
  if (!els.wishModal.hidden && els.wishModal.dataset.mode !== 'shared') renderWishlist();
}

function openWishlist() {
  els.wishModal.dataset.mode = 'own';
  els.wishTitle.textContent = '❤️ My Wishlist';
  els.wishNote.hidden = true;
  els.wishActions.hidden = false;
  renderWishlist();
  openSheet(els.wishModal);
}

function renderWishlist() {
  const entries = getWish();
  els.wishActions.querySelectorAll('button').forEach(b => b.disabled = entries.length === 0);
  if (!entries.length) {
    els.wishList.innerHTML = '';
    els.wishEmpty.hidden = false;
    els.wishTotals.hidden = true;
    return;
  }
  els.wishEmpty.hidden = true;
  els.wishList.innerHTML = entries.map(e => {
    const c = resolveWish(e);          // match by identity, not by number
    if (!c) return wlMissingRow(e);    // saved card not currently in inventory
    return wlRow(c, `<button class="wl-rm" title="Remove ${escapeAttr(c.name)}" aria-label="Remove ${escapeAttr(c.name)}" data-rm="${escapeAttr(c.id)}">✕</button>`);
  }).join('');
  els.wishList.querySelectorAll('[data-rm]').forEach(b =>
    b.addEventListener('click', () => toggleWish(b.dataset.rm)));
  // Running total count + estimated value (only cards still available)
  const totalValue = entries.reduce((s, e) => { const c = resolveWish(e); return s + (c ? shownPrice(c) : 0); }, 0);
  els.wishTotCount.textContent = entries.length;
  els.wishTotValue.textContent = '$' + totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  els.wishTotals.hidden = false;
}

function wlRow(c, actionHtml) {
  const inStock = c.quantity > 0;
  const thumb = c.image
    ? `<img class="wl-thumb" src="${escapeAttr(c.image)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'wl-thumb-ph\\'>✦</div>'">`
    : `<div class="wl-thumb-ph">✦</div>`;
  return `<div class="wl-item">
    ${thumb}
    <div class="wl-info">
      <div class="wl-name">${escapeHtml(c.name)}</div>
      <div class="wl-sub">#${escapeHtml(c.id)}${c.set ? ' · ' + escapeHtml(c.set) : ''}</div>
      <div class="wl-avail ${inStock ? 'in' : 'out'}">${inStock ? 'In stock' : 'Sold out'}</div>
    </div>
    <div class="wl-price">${fmtUSD(shownPrice(c))}</div>
    ${actionHtml}
  </div>`;
}
function wlMissingRow(e) {
  // Show the SAVED card (name/set) — not a bare, possibly-reused number.
  const label = e.name ? escapeHtml(e.name) : ('Card #' + escapeHtml(e.id));
  const sub   = e.name
    ? (e.set ? escapeHtml(e.set) + ' · Not currently available' : 'Not currently available')
    : 'No longer in inventory';
  return `<div class="wl-item">
    <div class="wl-thumb-ph">✦</div>
    <div class="wl-info"><div class="wl-name">${label}</div>
      <div class="wl-sub wl-avail out">${sub}</div></div>
    <button class="wl-rm" data-rm="${escapeAttr(e.id)}" title="Remove">✕</button>
  </div>`;
}

// ── Share wishlist ────────────────────────────────────────
function shareWishlist() {
  const ids = getWishIds();
  if (!ids.length) { toast('Your wishlist is empty'); return; }
  const url = `${location.origin}${location.pathname}?wishlist=${ids.join(',')}`;
  copyText(url);
  track('wishlist_share', { number_of_cards: ids.length });
  toast('Wishlist link copied — share it anywhere');
}

function openSharedWishlistFromURL() {
  const raw = new URLSearchParams(location.search).get('wishlist');
  if (raw == null) return;
  // Parse + sanitize ids (tolerate malformed URLs: junk, spaces, dupes)
  const ids = [...new Set(
    raw.split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9-]+$/.test(s))
  )];
  // Clean the param from the URL so a refresh won't re-merge and links stay tidy
  const params = new URLSearchParams(location.search);
  params.delete('wishlist');
  const qs = params.toString();
  history.replaceState({}, '', location.pathname + (qs ? '?' + qs : ''));

  if (!ids.length) { toast('That shared wishlist link was empty or invalid'); return; }

  // Merge shared ids into the viewer's wishlist. Snapshot identity from the
  // viewer's current inventory so shared items get the same reuse protection;
  // dedup by identity (falling back to number for cards not currently listed).
  const current = getWish();
  const haveIds   = new Set(current.map(e => e.id));
  const haveIdent = new Set(current.filter(e => e.name || e.set).map(e => identKey(e.name, e.set)));
  for (const id of ids) {
    const c = state.byId.get(String(id));
    if (c) {
      const k = identKey(c.name, c.set);
      if (haveIdent.has(k)) continue;
      current.push({ id: c.id, name: c.name, set: c.set });
      haveIdent.add(k); haveIds.add(c.id);
    } else {
      if (haveIds.has(String(id))) continue;
      current.push({ id: String(id), name: '', set: '' });
      haveIds.add(String(id));
    }
  }
  saveWish(current);
  updateWishUI();

  track('deep_link_open', { type: 'wishlist', number_of_cards: ids.length });
  openWishlist();
  toast('Wishlist loaded.');
}

// ── Message Sukrill ───────────────────────────────────────
// Builds a clean message and copies it. Each line is "id · Name - Set" when the
// card is still in inventory, falling back to the bare inventory number if not.
// We do NOT automate Whatnot messaging — the user pastes it into a DM themselves.
function messageSukrill() {
  const entries = getWish();
  if (!entries.length) { toast('Your wishlist is empty'); return; }
  const lines = entries.map(e => {
    const c = resolveWish(e);                       // current card by identity
    const id = c ? c.id : e.id;                      // current # if available, else saved #
    const name = c ? c.name : e.name, set = c ? c.set : e.set;
    return name ? `${id} · ${name}${set ? ' - ' + set : ''}` : `${id}`;
  });
  const msg =
    `Hi Suk!\n\n` +
    `I was browsing your inventory website and I'm interested in these cards:\n\n` +
    lines.join('\n') +
    `\n\nCould you let me know if they're still available?\n\nThanks!`;
  copyText(msg);
  track('message_sukrill', { number_of_cards: ids.length });
  toast('Message copied! DM it to Sukrill on Whatnot, Instagram, or TikTok 💬', 4000);
}

// ── Copy inventory numbers (numbers only, one per line) ──────
function copyInventoryNumbers() {
  const entries = getWish();
  if (!entries.length) { toast('Your wishlist is empty'); return; }
  // Prefer the card's CURRENT number when it's still (or again) in inventory.
  const nums = entries.map(e => { const c = resolveWish(e); return c ? c.id : e.id; });
  copyText(nums.join('\n'));
  track('wishlist_copy', { type: 'inventory_numbers', number_of_cards: nums.length });
  toast('Inventory numbers copied');
}

// ── Clear wishlist (with confirmation) ──────────────────────
function clearWishlist() {
  const entries = getWish();
  if (!entries.length) { toast('Your wishlist is already empty'); return; }
  if (!window.confirm(`Clear all ${entries.length} card${entries.length === 1 ? '' : 's'} from your wishlist?`)) return;
  saveWish([]);
  track('wishlist_remove', { inventory_id: 'all', cleared: entries.length });
  updateWishUI();
  renderWishlist();
  toast('Wishlist cleared');
}

/* ============================================================
   Sheet open/close helpers
   ============================================================ */
function openSheet(sheet) {
  lastFocused = document.activeElement;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  const close = sheet.querySelector('.modal-close');
  if (close) close.focus({ preventScroll: true });
}
function closeSheet(sheet) {
  sheet.hidden = true;
  if (sheet === els.wishModal) delete els.wishModal.dataset.mode;
  if (allSheetsClosed()) document.body.style.overflow = '';
  restoreFocus();
}
function allSheetsClosed() { return els.modal.hidden && els.wishModal.hidden; }

/* ============================================================
   Copy / share helpers
   ============================================================ */
function cardText(c) {
  return [
    c.name,
    c.set && `Set: ${c.set}`,
    c.number && `Card #: ${c.number}`,
    c.condition && `Condition: ${c.condition}`,
    `Price: $${c.price.toFixed(2)}`,
    `Quantity: ${c.quantity > 0 ? c.quantity : 'Out of stock'}`,
    `Inventory ID: #${c.id}`,
    c.notes && `Notes: ${c.notes}`,
    shareURL(c.id),
  ].filter(Boolean).join('\n');
}
function shareURL(id, relative) {
  const base = relative ? location.pathname : location.origin + location.pathname;
  return `${base}?card=${encodeURIComponent(id)}`;
}
function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  ta.remove();
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer;
function toast(msg, duration) {
  els.toast.textContent = msg; els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 250);
  }, duration || 1800);
}

// ── Utilities ─────────────────────────────────────────────
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function escapeAttr(s) { return escapeHtml(s); }
function placeholderSVG() {
  return `<div class="img-placeholder"><img class="ph-logo" src="logo.png" alt="" aria-hidden="true"><span>Photo Coming Soon</span></div>`;
}
