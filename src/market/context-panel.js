// Context Panel: regime + sector ratings overlay (cmdbar shortcut).

import { state, getRiskPctForRegime } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { REGIME_DATA, SECTORS } from '../config/constants.js';
import { ratingToStatus } from '../models/trade.js';
import { touchMarketContext } from '../sync/merge.js';

export function openContextPanel() {
  document.getElementById('ctx-panel').classList.add('open');
  document.getElementById('ctx-backdrop').classList.add('open');
  renderContextPanel();
}

export function closeContextPanel() {
  document.getElementById('ctx-panel').classList.remove('open');
  document.getElementById('ctx-backdrop').classList.remove('open');
}

export function renderContextPanel() {
  // Regime buttons
  document.querySelectorAll('.ctx-regime-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ctxRegime === state.regime);
  });
  // Rules text
  const rules = document.getElementById('ctx-rules');
  if (rules) {
    const data = REGIME_DATA[state.regime];
    const pct = (getRiskPctForRegime(state.regime) * 100).toFixed(2).replace(/\.?0+$/, '');
    rules.innerHTML = data.rulesTemplate.replace('{pct}', pct);
  }
  // Rated-at
  const ratedAtEl = document.getElementById('ctx-rated-at');
  if (ratedAtEl && state.sectorRatedAt) {
    const days = (typeof window.daysSinceSectorRating === 'function') ? window.daysSinceSectorRating() : 0;
    const label = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
    ratedAtEl.textContent = `· ${label}`;
    ratedAtEl.className = 'ctx-rated-at' + (days > 7 ? ' stale' : '');
  } else if (ratedAtEl) {
    ratedAtEl.textContent = '· never rated';
    ratedAtEl.className = 'ctx-rated-at';
  }
  // Sector grid
  const grid = document.getElementById('ctx-sector-grid');
  if (grid) {
    grid.innerHTML = SECTORS.map(s => {
      const rating = state.sectorRatings[s.ticker] || '';
      const status = ratingToStatus(rating);
      const rowClass = status ? status.toLowerCase() : '';
      return `
        <div class="ctx-sector-row ${rowClass}" data-ctx-ticker="${s.ticker}">
          <span class="ctx-sector-ticker" title="${s.name}">${s.ticker}</span>
          <span class="ctx-sector-name" title="${s.name}">${s.name}</span>
          <input class="ctx-sector-input" type="text"
                 placeholder="—" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*"
                 data-ctx-ticker="${s.ticker}"
                 value="${rating}" />
        </div>`;
    }).join('');
    // Wire inputs
    grid.querySelectorAll('.ctx-sector-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const ticker = e.target.dataset.ctxTicker;
        const raw = e.target.value.trim();
        const num = parseFloat(raw);
        if (raw === '' || isNaN(num)) delete state.sectorRatings[ticker];
        else if (num >= 1 && num <= 5) state.sectorRatings[ticker] = raw;
        else return;
        state.sectorRatedAt = new Date().toISOString();
        touchMarketContext();
        saveState();
        // Update row class live
        const row = e.target.closest('.ctx-sector-row');
        if (row) {
          const st = ratingToStatus(raw);
          row.classList.remove('strong', 'neutral', 'weak');
          if (st) row.classList.add(st.toLowerCase());
        }
        updateCtxSectorSummary();
        if (typeof window.renderHome === 'function') window.renderHome();
        if (typeof window.renderSectors === 'function') window.renderSectors();
        if (typeof window.renderSectorStatusMini === 'function') window.renderSectorStatusMini();
      });
    });
  }
  updateCtxSectorSummary();
}

export function updateCtxSectorSummary() {
  const summary = document.getElementById('ctx-sector-summary');
  if (!summary) return;
  // computeTop3 + computeAvoidList still live in legacy.js (sunday view).
  const top3 = (typeof window.computeTop3 === 'function') ? window.computeTop3() : [];
  const avoid = (typeof window.computeAvoidList === 'function') ? window.computeAvoidList() : [];
  const topNames  = top3.length  ? top3.map(s => `${s.name} (${s.ticker})`).join(', ')  : '—';
  const avoidNames = avoid.length ? avoid.map(s => `${s.name} (${s.ticker})`).join(', ') : '—';
  summary.innerHTML = `<span class="cs-top">▲ Long: ${topNames}</span><br><span class="cs-avoid">▼ Avoid: ${avoidNames}</span>`;
}

// Bridge to legacy.js.
window.openContextPanel = openContextPanel;
window.closeContextPanel = closeContextPanel;
window.renderContextPanel = renderContextPanel;
window.updateCtxSectorSummary = updateCtxSectorSummary;
