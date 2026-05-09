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
  const data = REGIME_DATA[state.regime];
  const pct = (getRiskPctForRegime(state.regime) * 100).toFixed(2).replace(/\.?0+$/, '');

  // Regime buttons
  document.querySelectorAll('.ctx-regime-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ctxRegime === state.regime);
  });

  // Hero
  const heroKicker = document.getElementById('ctx-hero-kicker-text');
  if (heroKicker) {
    const days = state.sectorRatedAt && typeof window.daysSinceSectorRating === 'function'
      ? window.daysSinceSectorRating()
      : null;
    const ratedLabel = days === null ? 'NEVER RATED' : days === 0 ? 'RATED TODAY' : days === 1 ? 'RATED 1D AGO' : `RATED ${days}D AGO`;
    heroKicker.textContent = `MARKET CONTEXT · ${ratedLabel}`;
  }
  const heroRegime = document.getElementById('ctx-hero-regime');
  if (heroRegime) {
    const text = data.text.replace('-', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
    heroRegime.textContent = `${text}.`;
    heroRegime.className = 'accent ' + (state.regime === 'risk-on' ? 'on' : state.regime === 'neutral' ? 'neut' : 'off');
  }
  const heroMeta = document.getElementById('ctx-hero-meta');
  if (heroMeta) {
    const tag = state.regime === 'risk-on' ? 'Long full size · short blocked'
              : state.regime === 'neutral' ? 'Half size · both directions allowed'
              : 'Reduced size · longs blocked · puts only on weak sectors';
    heroMeta.innerHTML = `${tag} · sizing <strong style="color: var(--ink);">${pct}% / trade</strong>.`;
  }

  // Rules-in-effect grid (sidebar card)
  const rules = document.getElementById('ctx-rules');
  if (rules) {
    const intradayDollar = state.settings?.intradayRiskPerTrade || 0;
    const maxOpen = state.settings?.maxPositions || 0;
    const rows = [
      { l: 'Risk per swing',     v: `${pct}%`,           tone: 'cyan' },
      { l: 'Risk per intraday',  v: `$${intradayDollar}`, tone: 'magenta' },
      { l: 'Direction',          v: state.regime === 'risk-on' ? 'LONG · SHORT BLOCKED' : state.regime === 'risk-off' ? 'PUTS ONLY' : 'BOTH OK', tone: state.regime === 'risk-on' ? 'green' : state.regime === 'risk-off' ? 'red' : 'amber' },
      { l: 'Position cap',       v: `${maxOpen} OPEN`,    tone: 'ink' },
    ];
    rules.innerHTML = `
      <div class="ctx-rules-list">
        ${rows.map(r => `
          <div class="ctx-rules-row">
            <span>${r.l}</span>
            <strong class="${r.tone}">${r.v}</strong>
          </div>
        `).join('')}
      </div>`;
  }

  // Sector rated-at footer
  const ratedAtFoot = document.getElementById('ctx-rated-at-foot');
  if (ratedAtFoot) {
    if (state.sectorRatedAt && typeof window.daysSinceSectorRating === 'function') {
      const days = window.daysSinceSectorRating();
      ratedAtFoot.textContent = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
    } else {
      ratedAtFoot.textContent = 'never';
    }
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
  // computeTop3 + computeAvoidList still live in legacy.js (sunday view).
  const top3 = (typeof window.computeTop3 === 'function') ? window.computeTop3() : [];
  const avoid = (typeof window.computeAvoidList === 'function') ? window.computeAvoidList() : [];

  // Old summary line (kept for back-compat if still in DOM)
  const summary = document.getElementById('ctx-sector-summary');
  if (summary) {
    const topNames  = top3.length  ? top3.map(s => `${s.name} (${s.ticker})`).join(', ')  : '—';
    const avoidNames = avoid.length ? avoid.map(s => `${s.name} (${s.ticker})`).join(', ') : '—';
    summary.innerHTML = `<span class="cs-top">▲ Long: ${topNames}</span><br><span class="cs-avoid">▼ Avoid: ${avoidNames}</span>`;
  }

  // New: lean / avoid lists rendered in design sidebar
  const leanList = document.getElementById('ctx-lean-list');
  if (leanList) {
    leanList.innerHTML = top3.length
      ? top3.slice(0, 3).map(s => `
          <div class="ctx-lean-row">
            <div>
              <span class="ctx-lean-name">${s.name}</span>
              <span class="ctx-lean-ticker">${s.ticker}</span>
            </div>
            <span class="ctx-lean-rating green">${Number(s.rating).toFixed(1)}</span>
          </div>`).join('')
      : `<div class="ctx-lean-empty">No strong sectors yet. Rate sectors above.</div>`;
  }
  const avoidListEl = document.getElementById('ctx-avoid-list');
  if (avoidListEl) {
    avoidListEl.innerHTML = avoid.length
      ? avoid.slice(0, 5).map(s => `
          <div class="ctx-lean-row">
            <div>
              <span class="ctx-lean-name">${s.name}</span>
              <span class="ctx-lean-ticker">${s.ticker}</span>
            </div>
            <span class="ctx-lean-rating red">${Number(s.rating).toFixed(1)}</span>
          </div>`).join('')
      : `<div class="ctx-lean-empty">No weak sectors flagged.</div>`;
  }
}

// Bridge to legacy.js.
window.openContextPanel = openContextPanel;
window.closeContextPanel = closeContextPanel;
window.renderContextPanel = renderContextPanel;
window.updateCtxSectorSummary = updateCtxSectorSummary;
