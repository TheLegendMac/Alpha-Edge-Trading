// Tab routing + ticker autocomplete UI. Owns setTab (the view switcher) and
// attachTickerAutocomplete (history-aware dropdown for the trade ticker input).

import { state } from './state/store.js';
import { saveState } from './state/persistence.js';
import { normalizeActiveMode } from './config/constants.js';
import { renderRegime } from './market/regime.js';
import { renderHome } from './views/home.js';
import { renderReference } from './views/reference.js';
import { renderLogTable } from './views/log.js';
import { renderStats } from './views/stats.js';
import { _buildTickerHistory, rememberTicker } from './trade-flow/ticker-memory.js';

export function setTab(name, opts = {}) {
  name = normalizeActiveMode(name);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  document.querySelectorAll('.cmdbar-menu-item').forEach(t => t.classList.toggle('active', t.dataset.menuTab === name));
  state.activeMode = name;
  saveState();
  // Mirror tab into history so the native browser back button navigates
  // between tabs instead of leaving the app (which would 404 on mobile).
  if (!opts.fromPopstate && typeof window !== 'undefined' && window.history) {
    const url = '#' + name;
    const cur = (window.history.state && window.history.state.tab) || null;
    if (cur === null) window.history.replaceState({ tab: name }, '', url);
    else if (cur !== name) window.history.pushState({ tab: name }, '', url);
  }
  // Refresh regime banner so its rules text matches the active mode.
  renderRegime();
  // Refresh dynamic content when navigating.
  if (name === 'home') renderHome();
  if (name === 'reference') renderReference();
  if (name === 'log') {
    if (typeof window.renderLogStats === 'function') window.renderLogStats();
    if (typeof window.renderLogHero === 'function') window.renderLogHero();
    renderLogTable();
  }
  if (name === 'stats') {
    if (typeof window.renderStats === 'function') window.renderStats();
  }
  if (name === 'trade' && typeof window.renderTrade === 'function') window.renderTrade();
}

// Ticker autocomplete — fixed-position dropdown anchored to the input via
// getBoundingClientRect. Pulls suggestions from the trade-flow ticker-memory module.
export function attachTickerAutocomplete(input, opts = {}) {
  if (!input || input.dataset.acAttached === '1') return;
  input.dataset.acAttached = '1';

  const list = document.createElement('div');
  list.className = 'ticker-ac-list';
  document.body.appendChild(list);

  let activeIdx = -1;
  let items = [];

  function position() {
    const r = input.getBoundingClientRect();
    list.style.left = r.left + 'px';
    list.style.top = (r.bottom + 4) + 'px';
    list.style.minWidth = Math.max(240, r.width) + 'px';
  }
  function show() { position(); list.classList.add('show'); }
  function hide() { list.classList.remove('show'); activeIdx = -1; }

  function renderList(query) {
    const q = (query || '').toUpperCase().trim();
    const all = _buildTickerHistory();
    items = q
      ? all.filter(e => e.sym.startsWith(q)).slice(0, 8)
      : all.slice(0, 8);
    if (!items.length) {
      list.innerHTML = `<div class="ticker-ac-empty">No prior trades${q ? ' for "' + q + '"' : ''} yet.</div>`;
      return;
    }
    const heading = q ? 'Matches' : 'Recent tickers';
    list.innerHTML = `<div class="ticker-ac-section">${heading}</div>` + items.map((e, i) => {
      const plClass = e.totalPL > 0 ? 'pl-pos' : e.totalPL < 0 ? 'pl-neg' : '';
      const plStr = e.count ? `<span class="${plClass}">${e.totalPL >= 0 ? '+' : '-'}$${Math.abs(e.totalPL).toFixed(0)}</span>` : '';
      return `<div class="ticker-ac-item ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
        <span class="ticker-ac-symbol">${e.sym}</span>
        <span class="ticker-ac-meta">
          ${e.count ? `<span>${e.count} trade${e.count === 1 ? '' : 's'}</span>` : '<span>recent</span>'}
          ${plStr}
        </span>
      </div>`;
    }).join('');
  }

  function pick(sym) {
    input.value = sym;
    rememberTicker(sym);
    hide();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof opts.onPick === 'function') opts.onPick(sym);
  }

  // Reposition while shown — covers scroll inside modals, window resize, etc.
  const repos = () => { if (list.classList.contains('show')) position(); };
  window.addEventListener('scroll', repos, true);
  window.addEventListener('resize', repos);

  input.addEventListener('focus', () => { renderList(input.value); show(); });
  input.addEventListener('click', () => { renderList(input.value); show(); });
  input.addEventListener('input', () => { renderList(input.value); show(); });
  input.addEventListener('keydown', e => {
    if (!list.classList.contains('show') || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); renderList(input.value); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderList(input.value); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(items[activeIdx].sym); }
    else if (e.key === 'Escape') hide();
  });
  input.addEventListener('blur', () => {
    setTimeout(hide, 150);
    rememberTicker(input.value);
  });
  list.addEventListener('mousedown', e => {
    const it = e.target.closest('.ticker-ac-item');
    if (it) { e.preventDefault(); pick(items[parseInt(it.dataset.idx, 10)].sym); }
  });
}

// Bridge to inline onclick handlers in markup that still reference setTab().
window.setTab = setTab;
window.attachTickerAutocomplete = attachTickerAutocomplete;

// Native browser back/forward — route to the appropriate tab without
// leaving the SPA (which would 404 on hosts that don't fall back to /).
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const tab = (e.state && e.state.tab)
      || (window.location.hash || '').replace(/^#/, '')
      || 'home';
    setTab(tab, { fromPopstate: true });
  });
}
