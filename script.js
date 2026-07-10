/* ============================================================
   Pokémon Card Inventory — vanilla JS
   Loads inventory.json, renders a filterable/sortable grid with
   lazy images, infinite scroll, a detail modal, copy + share.
   ============================================================ */
'use strict';

const PAGE_SIZE = 60;          // cards rendered per infinite-scroll batch
const PLACEHOLDER = placeholderSVG();

const state = {
  all: [],                     // every card
  filtered: [],                // after search + filters + sort
  rendered: 0,                 // how many of `filtered` are in the DOM
};

const els = {
  grid:       document.getElementById('grid'),
  empty:      document.getElementById('empty'),
  search:     document.getElementById('search'),
  searchClear:document.getElementById('search-clear'),
  filterSet:  document.getElementById('filter-set'),
  filterCond: document.getElementById('filter-condition'),
  filterStock:document.getElementById('filter-instock'),
  sort:       document.getElementById('sort'),
  resultCount:document.getElementById('result-count'),
  resetBtn:   document.getElementById('reset-btn'),
  statCount:  document.getElementById('stat-count'),
  statValue:  document.getElementById('stat-value'),
  statUpdated:document.getElementById('stat-updated'),
  sentinel:   document.getElementById('sentinel'),
  loadMoreWrap:document.getElementById('load-more-wrap'),
  loadMore:   document.getElementById('load-more'),
  toast:      document.getElementById('toast'),
  modal:      document.getElementById('modal'),
};

// ── Boot ──────────────────────────────────────────────────
init();

async function init() {
  try {
    const res = await fetch('inventory.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.all = (data.cards || []).map(normalize);
    renderHeadline(data);
    buildFilterOptions();
    bindEvents();
    apply();
    openFromURL();
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
  };
}

// ── Headline stats ────────────────────────────────────────
function renderHeadline(data) {
  const count = data.totalCards ?? state.all.length;
  const value = data.totalValue ?? state.all.reduce((s, c) => s + c.price * c.quantity, 0);
  els.statCount.textContent   = count.toLocaleString();
  els.statValue.textContent   = '$' + Math.round(value).toLocaleString();
  els.statUpdated.textContent = data.lastUpdated ? formatDate(data.lastUpdated) : '—';
}

// ── Filter dropdowns ──────────────────────────────────────
function buildFilterOptions() {
  const sets  = [...new Set(state.all.map(c => c.set).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const conds = [...new Set(state.all.map(c => c.condition).filter(Boolean))].sort();
  for (const s of sets)  els.filterSet.appendChild(new Option(s, s));
  for (const c of conds) els.filterCond.appendChild(new Option(c, c));
  // If only one condition exists, hide the filter to reduce clutter
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

  // Infinite scroll
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) renderNextBatch();
  }, { rootMargin: '600px' });
  io.observe(els.sentinel);

  // Modal close
  els.modal.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('popstate', openFromURL);
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

  // Reset grid + render first batch
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

// ── Rendering (batched for performance) ───────────────────
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
  el.innerHTML = `
    <div class="card-img-wrap">
      ${c.image
        ? `<img alt="${escapeHtml(c.name)}" loading="lazy" src="${escapeAttr(c.image)}"
               onload="this.classList.add('loaded')"
               onerror="this.replaceWith(makePlaceholder())">`
        : PLACEHOLDER}
      <span class="card-id">#${escapeHtml(c.id)}</span>
      ${oos ? '<span class="badge-oos">Sold</span>' : ''}
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
  return el;
}

// expose for inline onerror handler
window.makePlaceholder = function () {
  const d = document.createElement('div');
  d.innerHTML = PLACEHOLDER;
  return d.firstElementChild;
};

// ── Modal ─────────────────────────────────────────────────
function openModal(id, pushUrl) {
  const c = state.all.find(x => x.id === String(id));
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

  m.querySelector('#m-copy').onclick  = () => { copyText(cardText(c)); toast('Card info copied'); };
  m.querySelector('#m-share').onclick = () => { copyText(shareURL(c.id)); toast('Shareable link copied'); };

  m.hidden = false;
  document.body.style.overflow = 'hidden';
  if (pushUrl) history.pushState({ card: c.id }, '', shareURL(c.id, true));
}

function closeModal() {
  if (els.modal.hidden) return;
  els.modal.hidden = true;
  document.body.style.overflow = '';
  if (location.search.includes('card=')) history.pushState({}, '', location.pathname);
}

function openFromURL() {
  const id = new URLSearchParams(location.search).get('card');
  if (id) openModal(id, false);
  else if (!els.modal.hidden) closeModal();
}

// ── Copy / share helpers ──────────────────────────────────
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
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function escapeAttr(s) { return escapeHtml(s); }
function placeholderSVG() {
  return `<div class="img-placeholder">
    <span class="pokeball big" aria-hidden="true"></span>
    <span>No image</span>
  </div>`;
}
