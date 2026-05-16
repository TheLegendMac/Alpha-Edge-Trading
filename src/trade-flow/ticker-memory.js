// Ticker memory + autocomplete suggestions for the trade flow ticker input.

import { state } from '../state/store.js';
import { saveState, setState } from '../state/persistence.js';
import { newIntradayTicket } from '../config/constants.js';
import { isClosedTrade, calcPL, calcR } from '../models/trade.js';

function tfTickerHistory(symbol) {
  if (!symbol) return null;
  const sym = String(symbol).toUpperCase();
  const trades = (state.trades || []).filter(t => (t.ticker || '').toUpperCase() === sym);
  if (!trades.length) return null;
  const closed = trades.filter(t => isClosedTrade(t));
  const wins   = closed.filter(t => (calcPL(t) || 0) > 0).length;
  const losses = closed.filter(t => (calcPL(t) || 0) < 0).length;
  const totalPL = closed.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const avgR    = closed.length ? closed.reduce((s, t) => s + (calcR(t) || 0), 0) / closed.length : 0;
  // Per-setup aggregate so we can surface the strongest pattern for this name.
  const setupMap = {};
  closed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { name: k, n: 0, pl: 0 };
    setupMap[k].n++;
    setupMap[k].pl += (calcPL(t) || 0);
  });
  const bestSetup = Object.values(setupMap).sort((a, b) => b.pl - a.pl)[0] || null;
  // Last trade (closed first, then any).
  const sorted = [...trades].sort((a, b) =>
    (b.exit_date || b.date || '').localeCompare(a.exit_date || a.date || ''));
  const lastTrade = sorted[0];
  return {
    sym, count: trades.length, closedCount: closed.length, wins, losses,
    winRate: closed.length ? Math.round(wins / closed.length * 100) : null,
    totalPL, avgR, bestSetup, lastTrade,
    openCount: trades.filter(t => t.status === 'open').length,
  };
}

// Top tickers by trade count — used for the "Recent" pills row.
function tfTopTickers(limit = 8) {
  const counts = {};
  (state.trades || []).forEach(t => {
    const sym = (t.ticker || '').toUpperCase();
    if (!sym) return;
    counts[sym] = (counts[sym] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([sym, n]) => ({ sym, n }));
}

// Match recent tickers against the user's prefix. Empty prefix returns the
// top traded list. Used by both swing and intraday step 1 pills.
function tfTickerSuggestions(prefix, limit = 8) {
  const all = window.tfTopTickers(50);
  const p = (prefix || '').toUpperCase().trim();
  if (!p) return all.slice(0, limit);
  return all.filter(t => t.sym.startsWith(p)).slice(0, limit);
}

// HTML for the ticker memory block (Recent pills + history snapshot).
// Container id = tf-ticker-memory (swing) or tf-i-ticker-memory (intraday).
function tfRenderTickerMemoryHtml(currentTicker) {
  const hasInput = !!(currentTicker || '').trim();
  const matches = window.tfTickerSuggestions(currentTicker, hasInput ? 8 : 3);
  const hist = currentTicker ? window.tfTickerHistory(currentTicker) : null;
  const fmtMoney = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(Math.round(v)).toLocaleString()}`;
  const snapClass = hist ? (hist.totalPL >= 0 ? 'pos' : 'neg') : '';

  const pills = matches.length ? `
    <div class="tf-ticker-pills">
      <span class="tf-ticker-pills-label">${(currentTicker || '').trim() ? 'Match' : 'Recent'}:</span>
      ${matches.map(t => `<button type="button" class="tf-ticker-pill ${currentTicker === t.sym ? 'active' : ''}" data-tf-ticker-pick="${t.sym}">${t.sym}<span class="tf-ticker-pill-n">${t.n}</span></button>`).join('')}
    </div>` : '';

  const snap = hist ? `
    <div class="tf-ticker-snap ${snapClass}">
      <div class="tf-ticker-snap-head">
        <strong>${hist.sym}</strong> · ${hist.count} prior trade${hist.count === 1 ? '' : 's'}${hist.openCount ? ` · ${hist.openCount} open` : ''}${hist.winRate !== null ? ` · ${hist.winRate}% wins` : ''}${hist.closedCount ? ` · <span class="${hist.totalPL >= 0 ? 'pl-positive' : 'pl-negative'}">${fmtMoney(hist.totalPL)}</span>` : ''}
      </div>
      <div class="tf-ticker-snap-body">
        ${hist.bestSetup ? `<div class="tf-ticker-snap-row"><span class="k">Best setup</span><span class="v">${hist.bestSetup.name} (${fmtMoney(hist.bestSetup.pl)} · ${hist.bestSetup.n} trade${hist.bestSetup.n === 1 ? '' : 's'})</span></div>` : ''}
        ${hist.closedCount ? `<div class="tf-ticker-snap-row"><span class="k">Avg R</span><span class="v">${hist.avgR >= 0 ? '+' : ''}${hist.avgR.toFixed(2)}R</span></div>` : ''}
        ${hist.lastTrade ? `<div class="tf-ticker-snap-row"><span class="k">Last</span><span class="v">${hist.lastTrade.setup || '—'} · ${hist.lastTrade.direction || '—'} · ${hist.lastTrade.exit_date || hist.lastTrade.date || '—'}${hist.lastTrade.status === 'open' ? ' (open)' : ''}</span></div>` : ''}
      </div>
    </div>` : '';

  return pills + snap;
}

// Surgical updater — replaces only the memory div, preserves input focus.
function tfUpdateTickerMemory(containerId, currentTicker) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = window.tfRenderTickerMemoryHtml(currentTicker);
  // Re-bind pill clicks against the *appropriate* state path.
  el.querySelectorAll('[data-tf-ticker-pick]').forEach(b => {
    b.addEventListener('click', () => {
      const sym = b.dataset.tfTickerPick;
      // Detect which mode by the container id; updates the right state field.
      if (containerId === 'tf-i-ticker-memory') {
        state.intraday.ticker = sym;
        const input = document.getElementById('tf-i-ticker');
        if (input) input.value = sym;
      } else if (containerId === 'tf-summary-ticker-memory') {
        const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
        if (m === 'intraday') {
          if (!state.intraday) state.intraday = newIntradayTicket();
          state.intraday.ticker = sym;
        } else {
          state.ticker = sym;
        }
        const input = document.getElementById('tf-summary-ticker-input');
        if (input) input.value = sym;
      } else {
        state.ticker = sym;
        const input = document.getElementById('tf-ticker');
        if (input) input.value = sym;
        const li = document.getElementById('ticker-input');
        if (li) li.value = sym;
      }
      saveState();
      window.tfRefreshHeaderOnly();
      window.tfUpdateTickerMemory(containerId, sym);
    });
  });
}


export function _buildTickerHistory() {
  // Aggregate from trades + recent
  const map = new Map();
  (state.trades || []).forEach(t => {
    const sym = (t.ticker || '').toUpperCase();
    if (!sym) return;
    const e = map.get(sym) || { sym, count: 0, lastDate: 0, totalPL: 0 };
    e.count += 1;
    const d = t.exit_date || t.date || t.updated_at;
    const ts = d ? new Date(d).getTime() : 0;
    if (ts > e.lastDate) e.lastDate = ts;
    const pl = (typeof calcPL === 'function') ? calcPL(t) : null;
    if (pl != null) e.totalPL += pl;
    map.set(sym, e);
  });
  (state.recentTickers || []).forEach(sym => {
    if (!map.has(sym)) map.set(sym, { sym, count: 0, lastDate: Date.now(), totalPL: 0 });
  });
  return Array.from(map.values()).sort((a, b) => {
    // Most-traded first, then most-recent
    if (b.count !== a.count) return b.count - a.count;
    return b.lastDate - a.lastDate;
  });
}

export function rememberTicker(sym) {
  const s = (sym || '').toUpperCase().trim();
  if (!s || s.length > 6) return;
  if (!Array.isArray(state.recentTickers)) state.recentTickers = [];
  // Move-to-front, dedupe, cap at 30
  setState({ recentTickers: [s, ...state.recentTickers.filter(x => x !== s)].slice(0, 30) });
}

// Wire an input to show ticker autocomplete suggestions. Dropdown is rendered as a
// fixed-position element appended to <body>, anchored to the input via getBoundingClientRect.
// This avoids fighting the input's parent layout (flex columns, modals, etc.).

window.tfTickerHistory = tfTickerHistory;
window.tfTopTickers = tfTopTickers;
window.tfTickerSuggestions = tfTickerSuggestions;
window.tfRenderTickerMemoryHtml = tfRenderTickerMemoryHtml;
window.tfUpdateTickerMemory = tfUpdateTickerMemory;
window._buildTickerHistory = _buildTickerHistory;
window.rememberTicker = rememberTicker;
