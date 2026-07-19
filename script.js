/* ============================================================
   Sukrill's Pokémon Cards — vanilla JS
   Grid + search/filter/sort + card modal, wishlist (localStorage),
   share wishlist, message Sukrill, and GA4 event tracking.
   ============================================================ */
'use strict';

const PAGE_SIZE = 60;
const PLACEHOLDER = placeholderSVG();
const SHOP_URL = 'https://www.whatnot.com/user/sukrill/shop';
const WISH_KEY   = 'sukrill_wishlist_v1';   // array of inventory ids
const LEGACY_NOTIFY_KEY = 'sukrill_notify_v1';   // removed feature — cleaned up on load

const state = {
  all: [],
  filtered: [],
  rendered: 0,
  byId: new Map(),          // id -> card
};

const els = {
  grid:        document.getElementById('grid'),
  empty:       document.getElementById('empty'),
  search:      document.getElementById('search'),
  searchClear: document.getElementById('search-clear'),
  filterSet:   document.getElementById('filter-set'),
  filterCond:  document.getElementById('filter-condition'),
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
init();

async function init() {
  try {
    showSkeletons(12);
    const res = await fetch('inventory.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.all = (data.cards || []).map(normalize);
    state.byId = new Map(state.all.map(c => [c.id, c]));
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
    dateAdded: c.dateAdded || '',
    notes:     c.notes || '',
    listingUrl:c.listingUrl || '',
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
  const conds = [...new Set(state.all.map(c => c.condition).filter(Boolean))].sort();
  for (const s of sets)  els.filterSet.appendChild(new Option(s, s));
  for (const c of conds) els.filterCond.appendChild(new Option(c, c));
  if (conds.length <= 1) els.filterCond.style.display = 'none';
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
  els.filterCond.addEventListener('change', () => { apply(); track('filter', { filter_type: 'condition', value: els.filterCond.value || '(all)' }); });
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
  els.filterSet.value = ''; els.filterCond.value = '';
  els.filterStock.checked = false; els.sort.value = 'inv-asc';
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
  if (els.filterCond.value && els.filterCond.style.display !== 'none') n++;
  if (els.filterStock.checked) n++;
  if (els.sort.value !== 'inv-asc') n++;
  return n;
}

// ── Search + filter + sort ────────────────────────────────
function apply() {
  const q      = els.search.value.trim().toLowerCase();
  const fSet   = els.filterSet.value;
  const fCond  = els.filterCond.value;
  const inStock= els.filterStock.checked;
  const terms  = q.split(/\s+/).filter(Boolean);

  let list = state.all.filter(c => {
    if (fSet && c.set !== fSet) return false;
    if (fCond && c.condition !== fCond) return false;
    if (inStock && c.quantity <= 0) return false;
    if (terms.length) {
      const hay = (c.name + ' ' + c.set + ' ' + c.number + ' ' + c.id).toLowerCase();
      if (!terms.every(t => hay.includes(t))) return false;
    }
    return true;
  });

  list.sort(sorter(els.sort.value));
  state.filtered = list;

  const filtersActive = q || fSet || fCond || inStock || els.sort.value !== 'inv-asc';
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
        <span class="card-price">$${c.price.toFixed(2)}</span>
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
  if (c.image) { img.src = c.image; img.alt = c.name; img.style.display = ''; img.onerror = () => { img.style.display = 'none'; }; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }

  m.querySelector('#m-name').textContent  = c.name;
  m.querySelector('#m-price').textContent = '$' + c.price.toFixed(2);

  const rows = [
    ['Set', c.set], ['Card #', c.number], ['Condition', c.condition],
    ['Quantity', c.quantity > 0 ? c.quantity : 'Out of stock'],
    ['Inventory ID', '#' + c.id],
    ['Added', c.dateAdded ? formatDate(c.dateAdded) : ''],
  ].filter(([, v]) => v !== '' && v != null);
  m.querySelector('#m-details').innerHTML =
    rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('');

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
   WISHLIST
   ============================================================ */
function getWish() {
  try {
    const v = JSON.parse(localStorage.getItem(WISH_KEY));
    // Corrupt/legacy data → clean, de-duplicated array of non-empty id strings
    return Array.isArray(v)
      ? [...new Set(v.filter(x => x !== null && x !== undefined && x !== '').map(String))]
      : [];
  } catch (_) { return []; }
}
function saveWish(arr) { try { localStorage.setItem(WISH_KEY, JSON.stringify(arr)); } catch (_) {} }
function isWished(id) { return getWish().includes(String(id)); }

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
  const c = state.byId.get(id);
  let arr = getWish();
  if (arr.includes(id)) {
    arr = arr.filter(x => x !== id);
    saveWish(arr);
    track('wishlist_remove', { inventory_id: id });
    toast('Removed from wishlist');
  } else {
    arr.push(id);                       // dedup guaranteed (we only push when absent)
    saveWish(arr);
    track('wishlist_add', { inventory_id: id, card_name: c ? c.name : '', price: c ? c.price : 0 });
    showWantBubble(id);
  }
  updateWishUI();
}

function updateWishUI() {
  const arr = getWish();
  // Header badge — instant count + a subtle bounce when it changes
  if (els.wishCount.textContent !== String(arr.length)) {
    els.wishCount.textContent = arr.length;
    els.wishCount.classList.remove('bounce');
    void els.wishCount.offsetWidth;           // restart the animation
    els.wishCount.classList.add('bounce');
  }
  // sync any hearts currently in the grid (targeted, no full re-render).
  // Toggle class/aria only — the SVG stays; CSS handles outline↔filled.
  document.querySelectorAll('.card-heart').forEach(h => {
    const on = arr.includes(h.dataset.id);
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
  const ids = getWish();
  els.wishActions.querySelectorAll('button').forEach(b => b.disabled = ids.length === 0);
  if (!ids.length) {
    els.wishList.innerHTML = '';
    els.wishEmpty.hidden = false;
    els.wishTotals.hidden = true;
    return;
  }
  els.wishEmpty.hidden = true;
  els.wishList.innerHTML = ids.map(id => {
    const c = state.byId.get(id);
    if (!c) return wlMissingRow(id);
    return wlRow(c, `<button class="wl-rm" title="Remove ${escapeAttr(c.name)}" aria-label="Remove ${escapeAttr(c.name)}" data-rm="${escapeAttr(c.id)}">✕</button>`);
  }).join('');
  els.wishList.querySelectorAll('[data-rm]').forEach(b =>
    b.addEventListener('click', () => toggleWish(b.dataset.rm)));
  // Running total count + estimated value (only cards still in inventory)
  const totalValue = ids.reduce((s, id) => { const c = state.byId.get(id); return s + (c ? c.price : 0); }, 0);
  els.wishTotCount.textContent = ids.length;
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
    <div class="wl-price">$${c.price.toFixed(2)}</div>
    ${actionHtml}
  </div>`;
}
function wlMissingRow(id) {
  return `<div class="wl-item">
    <div class="wl-thumb-ph">✦</div>
    <div class="wl-info"><div class="wl-name">Card #${escapeHtml(id)}</div>
      <div class="wl-sub">No longer in inventory</div></div>
    <button class="wl-rm" data-rm="${escapeAttr(id)}" title="Remove">✕</button>
  </div>`;
}

// ── Share wishlist ────────────────────────────────────────
function shareWishlist() {
  const ids = getWish();
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

  // Automatically rebuild the viewer's wishlist by merging in the shared ids (dedup)
  const current = getWish();
  const merged = [...new Set([...current, ...ids])];
  saveWish(merged);
  updateWishUI();

  track('deep_link_open', { type: 'wishlist', number_of_cards: ids.length });
  openWishlist();
  toast('Wishlist loaded.');
}

// ── Message Sukrill ───────────────────────────────────────
// Builds a clean message (inventory numbers only) and copies it. We do NOT
// automate Whatnot messaging — the user pastes it into a Whatnot DM themselves.
function messageSukrill() {
  const ids = getWish();
  if (!ids.length) { toast('Your wishlist is empty'); return; }
  const msg =
    `Hi Sukrill!\n\n` +
    `I was browsing your inventory website and I'm interested in these cards:\n\n` +
    ids.join('\n') +
    `\n\nCould you let me know if they're still available?\n\nThanks!`;
  copyText(msg);
  track('message_sukrill', { number_of_cards: ids.length });
  toast('Message copied — paste it into a Whatnot DM to Sukrill 💬', 3500);
}

// ── Copy inventory numbers (numbers only, one per line) ──────
function copyInventoryNumbers() {
  const ids = getWish();
  if (!ids.length) { toast('Your wishlist is empty'); return; }
  copyText(ids.join('\n'));
  track('wishlist_copy', { type: 'inventory_numbers', number_of_cards: ids.length });
  toast('Inventory numbers copied');
}

// ── Clear wishlist (with confirmation) ──────────────────────
function clearWishlist() {
  const ids = getWish();
  if (!ids.length) { toast('Your wishlist is already empty'); return; }
  if (!window.confirm(`Clear all ${ids.length} card${ids.length === 1 ? '' : 's'} from your wishlist?`)) return;
  saveWish([]);
  track('wishlist_remove', { inventory_id: 'all', cleared: ids.length });
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
