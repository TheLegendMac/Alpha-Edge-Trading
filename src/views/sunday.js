// Sunday prep tab — sector ratings, top/avoid lists, weekly checklist.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { SECTORS } from '../config/constants.js';
import { ratingToLabel, ratingToStatus } from '../models/trade.js';
import { touchMarketContext } from '../sync/merge.js';

function renderSunday() {
  document.querySelectorAll('.checklist-item').forEach(el => {
    const block = el.parentElement.dataset.block;
    const key = el.dataset.key;
    const fullKey = block + '_' + key;
    el.classList.toggle('done', !!state.sundayChecks[fullKey]);
  });
  renderSectors();
}

function toggleSunday(el) {
  const block = el.parentElement.dataset.block;
  const key = el.dataset.key;
  const fullKey = block + '_' + key;
  state.sundayChecks[fullKey] = !state.sundayChecks[fullKey];
  saveState();
  renderSunday();
}

// ---------- Sectors panel (Sunday Prep Block 02) ----------
function renderSectors() {
  const grid = document.getElementById('sector-grid');
  if (!grid) return;

  // Build sector cards
  grid.innerHTML = SECTORS.map(s => {
    const rating = state.sectorRatings[s.ticker] || '';
    const status = ratingToStatus(rating);
    const label = ratingToLabel(rating);
    const cardClass = status ? status.toLowerCase() : '';
    const statusClass = status ? status.toLowerCase() : 'unrated';
    const statusLabel = status
      ? (status === 'STRONG' ? '🟢 STRONG'
         : status === 'NEUTRAL' ? '🟡 NEUTRAL'
         : '🔴 WEAK')
      : '— UNRATED —';
    const labelText = label ? `${label}` : '— enter rating —';

    return `
      <div class="sector-card ${cardClass}" data-ticker="${s.ticker}">
        <div class="sector-card-header">
          <span class="sector-card-ticker">${s.ticker}</span>
          <span class="sector-card-name">${s.name}</span>
        </div>
        <div class="sector-card-row">
          <input
            type="number"
            class="sector-card-grade-select"
            data-ticker="${s.ticker}"
            placeholder="SA Quant rating"
            inputmode="decimal"
            min="1"
            max="5"
            step="0.01"
            value="${rating}"
          />
          <span class="sector-card-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="sector-card-label">${labelText}</div>
      </div>
    `;
  }).join('');

  // Wire decimal inputs (live update only — no blur re-render to avoid stealing focus)
  grid.querySelectorAll('input[data-ticker]').forEach(inp => {
    inp.addEventListener('input', e => {
      const ticker = e.target.dataset.ticker;
      const raw = e.target.value.trim();
      const num = parseFloat(raw);
      if (raw === '' || isNaN(num)) {
        delete state.sectorRatings[ticker];
      } else if (num < 1 || num > 5) {
        // Out of range — keep typing but don't persist yet
        return;
      } else {
        state.sectorRatings[ticker] = raw;
      }
      state.sectorRatedAt = new Date().toISOString();
      touchMarketContext();
      saveState();
      window.renderHome();
      // Update only the surrounding card classes + label without full re-render
      // (full re-render would steal focus while user types)
      updateSectorCardLive(ticker, raw);
      updateSectorSummary();
      renderSectorStatusMini();
    });
  });

  // Update Top 3 / Avoid summary
  const top3 = computeTop3();
  const avoid = computeAvoidList();

  const top3El = document.getElementById('sector-top3');
  const avoidEl = document.getElementById('sector-avoid');
  const ratedAtEl = document.getElementById('sector-rated-at');

  if (top3El) {
    top3El.textContent = top3.length
      ? top3.map(t => `${t.name} ${t.ticker}`).join(', ')
      : '— rate sectors below to populate —';
  }
  if (avoidEl) {
    avoidEl.textContent = avoid.length
      ? avoid.map(t => `${t.name} ${t.ticker}`).join(', ')
      : '— none —';
  }
  if (ratedAtEl) {
    ratedAtEl.textContent = state.sectorRatedAt
      ? formatRatedAt(state.sectorRatedAt)
      : '— never —';
  }

  // Stale warning
  const existingWarning = grid.parentElement.querySelector('.sector-stale-warning');
  if (existingWarning) existingWarning.remove();

  if (state.sectorRatedAt && isSectorRatingStale()) {
    const days = daysSinceSectorRating();
    const warning = document.createElement('div');
    warning.className = 'sector-stale-warning';
    warning.textContent = `⚠️  Sector grades are ${days} days old — re-rate before sizing new trades`;
    grid.parentElement.insertBefore(warning, grid);
  }
}

function computeTop3() {
  // Pick STRONG sectors (rating 3.5 or higher), highest decimal first
  const strong = SECTORS
    .map(s => ({ ...s, rating: state.sectorRatings[s.ticker] }))
    .filter(s => ratingToStatus(s.rating) === 'STRONG')
    .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
  return strong.slice(0, 3);
}

function computeAvoidList() {
  // Pick WEAK sectors (rating <2.5), lowest decimal first (worst at top)
  return SECTORS
    .map(s => ({ ...s, rating: state.sectorRatings[s.ticker] }))
    .filter(s => ratingToStatus(s.rating) === 'WEAK')
    .sort((a, b) => parseFloat(a.rating) - parseFloat(b.rating));
}

// Update a single sector card's classes + label without re-rendering whole grid
// (avoids stealing focus from the input while user types)
function updateSectorCardLive(ticker, rawValue) {
  const card = document.querySelector(`.sector-card[data-ticker="${ticker}"]`);
  if (!card) return;
  const status = ratingToStatus(rawValue);
  const label = ratingToLabel(rawValue);
  card.classList.remove('strong', 'neutral', 'weak');
  if (status) card.classList.add(status.toLowerCase());

  const statusEl = card.querySelector('.sector-card-status');
  statusEl.classList.remove('strong', 'neutral', 'weak', 'unrated');
  if (status) {
    statusEl.classList.add(status.toLowerCase());
    statusEl.textContent = status === 'STRONG' ? '🟢 STRONG'
      : status === 'NEUTRAL' ? '🟡 NEUTRAL' : '🔴 WEAK';
  } else {
    statusEl.classList.add('unrated');
    statusEl.textContent = '— UNRATED —';
  }

  const labelEl = card.querySelector('.sector-card-label');
  if (labelEl) {
    labelEl.textContent = label || '— enter rating —';
  }
}

// Refresh the Top 3 / Avoid summary text only (no input re-render)
function updateSectorSummary() {
  const top3 = computeTop3();
  const avoid = computeAvoidList();
  const top3El = document.getElementById('sector-top3');
  const avoidEl = document.getElementById('sector-avoid');
  const ratedAtEl = document.getElementById('sector-rated-at');

  if (top3El) {
    top3El.textContent = top3.length
      ? top3.map(t => `${t.name} ${t.ticker}`).join(', ')
      : '— rate sectors below to populate —';
  }
  if (avoidEl) {
    avoidEl.textContent = avoid.length
      ? avoid.map(t => `${t.name} ${t.ticker}`).join(', ')
      : '— none —';
  }
  if (ratedAtEl) {
    ratedAtEl.textContent = state.sectorRatedAt
      ? formatRatedAt(state.sectorRatedAt)
      : '— never —';
  }
}

function formatRatedAt(iso) {
  const d = new Date(iso);
  const days = daysSinceSectorRating();
  const label = days === 0 ? 'today'
    : days === 1 ? 'yesterday'
    : `${days} days ago`;
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dateStr} (${label})`;
}

function daysSinceSectorRating() {
  if (!state.sectorRatedAt) return null;
  const ratedAt = new Date(state.sectorRatedAt);
  const now = new Date();
  return Math.floor((now - ratedAt) / (1000 * 60 * 60 * 24));
}

function isSectorRatingStale() {
  const days = daysSinceSectorRating();
  return days !== null && days > 7;
}

function clearSectors() {
  if (!confirm('Clear all sector ratings? This cannot be undone.')) return;
  state.sectorRatings = {};
  state.sectorRatedAt = null;
  touchMarketContext();
  saveState();
  window.renderHome();
  renderSectors();
  renderSectorStatusMini();
  window.toast('Sector grades cleared');
}

// ---------- Sector Status mini-card (New Trade tab) ----------
function renderSectorStatusMini() {
  const card = document.getElementById('sector-status-mini');
  if (!card) return;

  const top3 = computeTop3();
  const avoid = computeAvoidList();
  const hasRatings = Object.keys(state.sectorRatings).length > 0;

  if (!hasRatings) {
    card.querySelector('.sector-status-mini-list').innerHTML =
      '<span class="sector-status-mini-empty">No sector ratings set yet — head to Sunday Prep tab to rate sectors</span>';
    card.querySelector('.sector-status-mini-rated').textContent = '';
    return;
  }

  const days = daysSinceSectorRating();
  const ratedLabel = days === 0 ? 'rated today'
    : days === 1 ? 'rated yesterday'
    : `rated ${days}d ago${isSectorRatingStale() ? ' ⚠️' : ''}`;
  card.querySelector('.sector-status-mini-rated').textContent = ratedLabel;

  const pills = [];
  top3.forEach(s => {
    pills.push(`<span class="sector-status-mini-pill strong">🟢 ${s.name} <span style="opacity:0.7;font-weight:600;">${s.ticker}</span></span>`);
  });
  avoid.forEach(s => {
    pills.push(`<span class="sector-status-mini-pill weak">🔴 ${s.name} <span style="opacity:0.7;font-weight:600;">${s.ticker}</span></span>`);
  });
  if (pills.length === 0) {
    pills.push('<span class="sector-status-mini-empty">All sectors rated NEUTRAL — broad market, no edge</span>');
  }

  card.querySelector('.sector-status-mini-list').innerHTML = pills.join('');
}

// ---------- Settings ----------

window.renderSunday = renderSunday;
window.toggleSunday = toggleSunday;
window.renderSectors = renderSectors;
window.computeTop3 = computeTop3;
window.computeAvoidList = computeAvoidList;
window.updateSectorCardLive = updateSectorCardLive;
window.updateSectorSummary = updateSectorSummary;
window.formatRatedAt = formatRatedAt;
window.daysSinceSectorRating = daysSinceSectorRating;
window.isSectorRatingStale = isSectorRatingStale;
window.clearSectors = clearSectors;
window.renderSectorStatusMini = renderSectorStatusMini;
