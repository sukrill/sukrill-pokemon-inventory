/* ============================================================
   Sukrill Pokémon Cards — vanilla JS
   Grid + search/filter/sort + card modal (existing), plus:
   wishlist (localStorage), share wishlist, message Sukrill,
   notify-me waiting list, and GA4 event tracking.
   ============================================================ */
'use strict';

const PAGE_SIZE = 60;
const PLACEHOLDER = placeholderSVG();
const SHOP_URL = 'https://www.whatnot.com/user/sukrill/shop';
const WISH_KEY   = 'sukrill_wishlist_v1';   // array of inventory ids
const NOTIFY_KEY = 'sukrill_notify_v1';     // array of {id, name, date}

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
  // waiting / notify
  waitBtn:     document.getElementById('waiting-btn'),
  waitCount:   document.getElementById('waiting-count'),
  waitModal:   document.getElementById('waiting-modal'),
  waitList:    document.getElementById('wait-list'),
  waitEmpty:   document.getElementById('wait-empty'),
};

// ── Analytics (GA4) ───────────────────────────────────────
function track(name, params) {
  try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); }
  catch (_) { /* never let analytics break the UI */ }
}

// ── Boot ──────────────────────────────────────────────────
init();

async function init() {
  try {
    const res = await fetch('inventory.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.all = (data.cards || []).map(normalize);
    state.byId = new Map(state.all.map(c => [c.id, c]));
    renderHeadline(data);
    buildFilterOptions();
    bindEvents();
    updateWishUI();
    updateWaitingCount();
    apply();
    openFromURL();
    openSharedWishlistFromURL();
  } catch (err) {
    els.resultCount.textContent = 'Could not load inventory.json — ' + err.message;
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
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = hasTime ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
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
  }, 120));
  els.searchClear.addEventListener('click', () => {
    els.search.value = ''; els.searchClear.hidden = true; apply(); els.search.focus();
  });
  els.filterSet.addEventListener('change', apply);
  els.filterCond.addEventListener('change', apply);
  els.filterStock.addEventListener('change', apply);
  els.sort.addEventListener('change', apply);
  els.resetBtn.addEventListener('click', resetFilters);
  els.loadMore.addEventListener('click', renderNextBatch);

  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) renderNextBatch();
  }, { rootMargin: '600px' });
  io.observe(els.sentinel);

  // Card modal close
  els.modal.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.waitModal.hidden) closeSheet(els.waitModal);
    else if (!els.wishModal.hidden) closeSheet(els.wishModal);
    else closeModal();
  });
  window.addEventListener('popstate', openFromURL);

  // Wishlist / waiting header buttons
  els.wishBtn.addEventListener('click', openWishlist);
  els.waitBtn.addEventListener('click', openWaiting);
  els.wishModal.addEventListener('click', (e) => { if (e.target.dataset.closeWish !== undefined) closeSheet(els.wishModal); });
  els.waitModal.addEventListener('click', (e) => { if (e.target.dataset.closeWait !== undefined) closeSheet(els.waitModal); });
  els.wishShare.addEventListener('click', shareWishlist);
  els.wishMessage.addEventListener('click', messageSukrill);
}

function resetFilters() {
  els.search.value = ''; els.searchClear.hidden = true;
  els.filterSet.value = ''; els.filterCond.value = '';
  els.filterStock.checked = false; els.sort.value = 'newest';
  apply();
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

  const filtersActive = q || fSet || fCond || inStock || els.sort.value !== 'newest';
  els.resetBtn.hidden = !filtersActive;
  els.resultCount.textContent =
    `${list.length.toLocaleString()} card${list.length === 1 ? '' : 's'}` +
    (filtersActive ? ` (of ${state.all.length.toLocaleString()})` : '');

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
    case 'qty-desc':  return (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name);
    case 'newest':
    default:          return (a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '')
                                       || (Number(b.id) - Number(a.id));
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
        ? `<img alt="${escapeHtml(c.name)}" loading="lazy" src="${escapeAttr(c.image)}"
               onload="this.classList.add('loaded')"
               onerror="this.replaceWith(makePlaceholder())">`
        : PLACEHOLDER}
      <span class="card-id">#${escapeHtml(c.id)}</span>
      ${oos ? '<span class="badge-oos">Sold</span>' : ''}
      <button class="card-heart${wished ? ' active' : ''}" data-id="${escapeAttr(c.id)}"
              title="${wished ? 'Remove from wishlist' : 'Add to wishlist'}"
              aria-label="Toggle wishlist">${wished ? '❤️' : '🤍'}</button>
    </div>
    <div class="card-body">
      <div class="card-name">${escapeHtml(c.name)}</div>
      <div class="card-set">${escapeHtml(c.set || '—')}</div>
      <div class="card-meta">${escapeHtml([c.number, c.condition].filter(Boolean).join(' · ') || '')}</div>
      <div class="card-foot">
        <span class="card-price">$${c.price.toFixed(2)}</span>
        <span class="card-qty">${oos ? 'Out of stock' : 'Qty ' + c.quantity}</span>
      </div>
    </div>`;
  el.addEventListener('click', () => openModal(c.id, true));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(c.id, true); } });
  const heart = el.querySelector('.card-heart');
  heart.addEventListener('click', (e) => { e.stopPropagation(); toggleWish(c.id); });
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
    if (hasListing) track('whatnot_listing_click', { inventory_id: c.id, card_name: c.name, price: c.price });
    else            track('whatnot_shop_click',    { source: 'inventory_site', inventory_id: c.id, card_name: c.name });
  };

  // Notify-me (sold cards only)
  const notify = m.querySelector('#m-notify');
  notify.hidden = !oos;
  if (oos) syncNotifyBtn(notify, c);

  // Wishlist toggle
  const wish = m.querySelector('#m-wish');
  syncWishBtn(wish, c);

  m.querySelector('#m-copy').onclick  = () => { copyText(cardText(c)); toast('Card info copied'); };
  m.querySelector('#m-share').onclick = () => { copyText(shareURL(c.id)); toast('Shareable link copied'); };

  m.hidden = false;
  document.body.style.overflow = 'hidden';
  if (pushUrl) history.pushState({ card: c.id }, '', shareURL(c.id, true));

  track('card_view', { inventory_id: c.id, card_name: c.name, price: c.price, set: c.set });
}

function syncWishBtn(btn, c) {
  const on = isWished(c.id);
  btn.textContent = on ? '❤️ In Wishlist — Remove' : '＋ Add to Wishlist';
  btn.classList.toggle('active', on);
  btn.onclick = () => { toggleWish(c.id); syncWishBtn(btn, c); };
}
function syncNotifyBtn(btn, c) {
  const on = isNotifying(c.id);
  btn.textContent = on ? '✓ You’ll be notified' : '🔔 Notify Me If Available';
  btn.classList.toggle('active', on);
  btn.onclick = () => { toggleNotify(c.id); syncNotifyBtn(btn, c); };
}

function closeModal() {
  if (els.modal.hidden) return;
  els.modal.hidden = true;
  if (allSheetsClosed()) document.body.style.overflow = '';
  if (location.search.includes('card=')) history.pushState({}, '', location.pathname + location.search.replace(/([?&])card=[^&]*&?/, '$1').replace(/[?&]$/, ''));
}

function openFromURL() {
  const id = new URLSearchParams(location.search).get('card');
  if (id) openModal(id, false);
  else if (!els.modal.hidden) closeModal();
}

/* ============================================================
   WISHLIST
   ============================================================ */
function getWish() {
  try { return JSON.parse(localStorage.getItem(WISH_KEY)) || []; }
  catch (_) { return []; }
}
function saveWish(arr) { try { localStorage.setItem(WISH_KEY, JSON.stringify(arr)); } catch (_) {} }
function isWished(id) { return getWish().includes(String(id)); }

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
    toast('Added to wishlist ❤️');
  }
  updateWishUI();
}

function updateWishUI() {
  const arr = getWish();
  els.wishCount.textContent = arr.length;
  // sync any hearts currently in the grid
  document.querySelectorAll('.card-heart').forEach(h => {
    const on = arr.includes(h.dataset.id);
    h.classList.toggle('active', on);
    h.textContent = on ? '❤️' : '🤍';
    h.title = on ? 'Remove from wishlist' : 'Add to wishlist';
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
  if (!ids.length) { els.wishList.innerHTML = ''; els.wishEmpty.hidden = false; return; }
  els.wishEmpty.hidden = true;
  els.wishList.innerHTML = ids.map(id => {
    const c = state.byId.get(id);
    if (!c) return wlMissingRow(id);
    return wlRow(c, `<button class="wl-rm" title="Remove" data-rm="${escapeAttr(c.id)}">✕</button>`);
  }).join('');
  els.wishList.querySelectorAll('[data-rm]').forEach(b =>
    b.addEventListener('click', () => toggleWish(b.dataset.rm)));
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
  if (!raw) return;
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return;
  els.wishModal.dataset.mode = 'shared';
  els.wishTitle.textContent = '🎁 Shared Wishlist';
  els.wishNote.hidden = false;
  els.wishNote.textContent = `Someone shared ${ids.length} card${ids.length === 1 ? '' : 's'} with you. Add any to your own wishlist.`;
  els.wishActions.hidden = true;
  els.wishEmpty.hidden = true;
  els.wishList.innerHTML = ids.map(id => {
    const c = state.byId.get(id);
    if (!c) return wlMissingRow(id);
    const added = isWished(id);
    return wlRow(c, `<button class="wl-add${added ? ' added' : ''}" data-add="${escapeAttr(id)}">${added ? '❤️ Added' : '＋ Add'}</button>`);
  }).join('');
  els.wishList.querySelectorAll('[data-add]').forEach(b =>
    b.addEventListener('click', () => {
      const id = b.dataset.add;
      if (!isWished(id)) toggleWish(id);
      b.classList.add('added'); b.textContent = '❤️ Added';
    }));
  openSheet(els.wishModal);
}

// ── Message Sukrill ───────────────────────────────────────
function messageSukrill() {
  const ids = getWish();
  if (!ids.length) { toast('Your wishlist is empty'); return; }
  const lines = ids.map(id => {
    const c = state.byId.get(id);
    return c ? `#${c.id} - ${c.name} - $${c.price.toFixed(2)}` : `#${id}`;
  });
  const msg =
    `Hey Sukrill! I'm interested in these Pokémon cards:\n\n` +
    lines.join('\n') +
    `\n\nCan you let me know availability and shipping?`;
  copyText(msg);
  track('contact_request', { number_of_cards: ids.length });
  toast('Message copied — opening Whatnot…');
  setTimeout(() => window.open(SHOP_URL, '_blank', 'noopener'), 600);
}

/* ============================================================
   NOTIFY / WAITING LIST
   ============================================================ */
function getNotify() {
  try { return JSON.parse(localStorage.getItem(NOTIFY_KEY)) || []; }
  catch (_) { return []; }
}
function saveNotify(arr) { try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(arr)); } catch (_) {} }
function isNotifying(id) { return getNotify().some(x => x.id === String(id)); }

function toggleNotify(id) {
  id = String(id);
  const c = state.byId.get(id);
  let arr = getNotify();
  if (arr.some(x => x.id === id)) {
    arr = arr.filter(x => x.id !== id);
    saveNotify(arr);
    toast('Removed from your waiting list');
  } else {
    arr.push({ id, name: c ? c.name : '', date: new Date().toISOString().slice(0, 10) });
    saveNotify(arr);
    track('notify_request', { inventory_id: id, card_name: c ? c.name : '' });
    toast('We saved it — you’re on the waiting list 🔔');
  }
  updateWaitingCount();
  if (!els.waitModal.hidden) renderWaiting();
}

function updateWaitingCount() { els.waitCount.textContent = getNotify().length; }

function openWaiting() { renderWaiting(); openSheet(els.waitModal); }

function renderWaiting() {
  const arr = getNotify();
  if (!arr.length) { els.waitList.innerHTML = ''; els.waitEmpty.hidden = false; return; }
  els.waitEmpty.hidden = true;
  els.waitList.innerHTML = arr.map(w => {
    const c = state.byId.get(w.id);
    const inStock = c && c.quantity > 0;
    const price = c ? `$${c.price.toFixed(2)}` : '';
    const thumb = c && c.image
      ? `<img class="wl-thumb" src="${escapeAttr(c.image)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'wl-thumb-ph\\'>✦</div>'">`
      : `<div class="wl-thumb-ph">✦</div>`;
    return `<div class="wl-item">
      ${thumb}
      <div class="wl-info">
        <div class="wl-name">${escapeHtml(w.name || (c ? c.name : 'Card #' + w.id))}</div>
        <div class="wl-sub">#${escapeHtml(w.id)} · added ${escapeHtml(formatDate(w.date))}</div>
        <div class="wl-avail ${inStock ? 'in' : 'out'}">${inStock ? 'Back in stock!' : 'Still waiting'}</div>
      </div>
      <div class="wl-price">${price}</div>
      <button class="wl-rm" data-rmn="${escapeAttr(w.id)}" title="Remove">✕</button>
    </div>`;
  }).join('');
  els.waitList.querySelectorAll('[data-rmn]').forEach(b =>
    b.addEventListener('click', () => toggleNotify(b.dataset.rmn)));
}

/* ============================================================
   Sheet open/close helpers
   ============================================================ */
function openSheet(sheet) { sheet.hidden = false; document.body.style.overflow = 'hidden'; }
function closeSheet(sheet) {
  sheet.hidden = true;
  if (sheet === els.wishModal) delete els.wishModal.dataset.mode;
  if (allSheetsClosed()) document.body.style.overflow = '';
}
function allSheetsClosed() { return els.modal.hidden && els.wishModal.hidden && els.waitModal.hidden; }

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
function toast(msg) {
  els.toast.textContent = msg; els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => { els.toast.hidden = true; }, 250);
  }, 1800);
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
  return `<div class="img-placeholder"><span class="ph-glyph">✦</span><span>No image</span></div>`;
}
