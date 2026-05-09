// Trade log tab — log toolbar + table + setup filters + stats container.
// renderLogStats came in via Phase 7's alpha extraction; lives here now.

import { state } from '../state/store.js';
import {
  isClosedTrade,
  calcPL,
  tradeBias,
  tradeQty,
  tradeInstrument,
  normalizeProcessQuality,
  processQualityLabel,
} from '../models/trade.js';
import { formatDate } from '../models/formatters.js';
import { saveState } from '../state/persistence.js';
import { buildTradeIndex, filterLogTrades } from '../models/trade-index.js';
import { esc, attr } from '../dom/html.js';

function setLogSetupFilter(setup) {
  state.logSetupFilter = setup || '';
  saveState();
  window.renderLogStats();
  renderLogTable();
  const search = document.getElementById('log-trade-search');
  if (search) search.placeholder = state.logSetupFilter ? `Filtered: ${state.logSetupFilter}` : 'Filter ticker, setup…';
}

function clearLogSetupFilter() {
  setLogSetupFilter('');
}

export function renderLogHero() {
  const trades = state.trades || [];
  const closed = trades.filter(isClosedTrade);
  const open = trades.filter(t => t.status === 'open');
  const wins = closed.filter(t => (calcPL(t) || 0) > 0);
  const losses = closed.filter(t => (calcPL(t) || 0) < 0);
  const totalPL = closed.reduce((s, t) => s + (calcPL(t) || 0), 0);

  const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  const kicker = document.getElementById('log-hero-kicker-text');
  if (kicker) kicker.textContent = `TRADE LOG · ${monthName}`;

  const countEl = document.getElementById('log-hero-count');
  if (countEl) countEl.textContent = trades.length;

  const plEl = document.getElementById('log-hero-pl');
  if (plEl) {
    const v = `${totalPL >= 0 ? '+$' : '-$'}${Math.abs(Math.round(totalPL)).toLocaleString()}`;
    plEl.textContent = v;
    plEl.className = totalPL >= 0 ? 'pos' : 'neg';
  }

  const meta = document.getElementById('log-hero-meta');
  if (meta) {
    if (trades.length === 0) {
      meta.innerHTML = `No trades logged yet. Click <strong>+ Add Trade</strong> to start.`;
    } else {
      meta.innerHTML = `<strong>${wins.length} wins / ${losses.length} losses</strong> closed · <strong>${open.length} open</strong> · sorted newest first.`;
    }
  }
}

export function renderLogTable() {
  const container = document.getElementById('log-table-container');
  const filter = state.logModeFilter || 'all';
  const setupFilter = state.logSetupFilter || '';
  const search = (state.logSearch || '').trim().toLowerCase();
  const tradeIndex = buildTradeIndex(state.trades || []);
  const filtered = filterLogTrades(tradeIndex, { mode: filter, setup: setupFilter, search });
  if (container && container.dataset.logWired !== '1') {
    container.dataset.logWired = '1';
    container.addEventListener('click', e => {
      const row = e.target.closest('[data-edit-trade]');
      if (row) window.editTrade(row.dataset.editTrade);
    });
  }
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">${search ? 'No matching trades' : setupFilter ? 'No trades for this setup' : (filter === 'all' ? 'No trades logged yet' : 'No ' + filter + ' trades')}</div>
        <div>${search ? 'Clear the search or try a different ticker/setup.' : setupFilter ? 'Choose another setup or clear the setup filter.' : (filter === 'all' ? 'Click "Add Trade" when you take your first entry, or log one from the Intraday tab.' : 'Switch the filter or log a new ' + filter + ' trade.')}</div>
      </div>
    `;
    return;
  }

  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const formatMoney = value => `${value >= 0 ? '+$' : '-$'}${Math.abs(value || 0).toFixed(0)}`;
  const formatR = r => r !== null && Number.isFinite(r)
    ? `${r >= 0 ? '+' : '-'}${Math.abs(r).toFixed(2)}R`
    : '—';

  container.innerHTML = `
    <div class="log-trade-list">
      <div class="log-trade-header" aria-hidden="true">
        <span></span>
        <span>Trade</span>
        <span>Setup</span>
        <span>Risk</span>
        <span>P/L</span>
        <span>Action</span>
      </div>
      ${sorted.map(t => {
        const pl = calcPL(t);
        const r = window.calcR(t);
        const mode = t.mode || 'swing';
        const statusClass = t.status === 'open' ? 'open' : pl >= 0 ? 'win' : 'loss';
        const sizeUnit = tradeInstrument(t) === 'stocks' ? 'sh' : 'ctr';
        const entry = Number(t.entry || 0);
        const exit = t.exit ? Number(t.exit) : null;
        const risk = Number(t.riskDollars) || window.tradeRiskDollars(t) || 0;
        const valueText = t.status === 'open' ? `$${Math.round(risk)}` : formatMoney(pl || 0);
        const processLabel = processQualityLabel(t.grade);
        const valueDetail = t.status === 'open'
          ? 'risk open'
          : `${formatR(r)}${processLabel ? ` · ${processLabel}` : ''}`;
        return `
          <button class="home-trade-row log-trade-row" type="button" data-edit-trade="${attr(t.id)}">
            <span class="home-trade-stripe ${attr(statusClass)}"></span>
            <span class="home-trade-main">
              <span class="home-trade-ticker">${esc(t.ticker || '—')} <span class="status ${attr(t.status)}" style="font-size:9px; padding:2px 6px;">${t.status === 'open' ? 'Open' : t.status === 'win' ? 'Win' : 'Loss'}</span></span>
              <span class="home-trade-meta">${formatDate(t.date)} · ${esc(mode)} · ${esc(t.direction || '—')}</span>
            </span>
            <span class="home-trade-setup">
              ${esc(t.setup || 'No setup')}
              <span class="home-trade-detail">Entry $${entry.toFixed(2)} · Exit ${exit !== null ? '$' + exit.toFixed(2) : '—'} · ${t.contracts || 0} ${sizeUnit}</span>
            </span>
            <span class="log-trade-risk">
              ${formatR(r)}
              <span class="home-trade-detail">Risk $${Math.round(risk)}</span>
            </span>
            <span class="home-trade-value ${attr(statusClass)}">
              ${valueText}
              <span class="home-trade-detail">${valueDetail}</span>
            </span>
            <span class="log-trade-action-btn">Edit</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

// formatDate → src/models/formatters.js


window.setLogSetupFilter = setLogSetupFilter;
window.clearLogSetupFilter = clearLogSetupFilter;
window.renderLogTable = renderLogTable;
window.renderLogHero = renderLogHero;
