// Sector ratings helpers — pure compute + stale checks used by Home,
// Context Panel, Settings. The DOM rendering for sector ratings lives in
// market/context-panel.js; this module just exposes the data helpers.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { SECTORS } from '../config/constants.js';
import { ratingToStatus } from '../models/trade.js';
import { touchMarketContext } from '../sync/merge.js';

function computeTop3() {
  return SECTORS
    .map(s => ({ ...s, rating: state.sectorRatings[s.ticker] }))
    .filter(s => ratingToStatus(s.rating) === 'STRONG')
    .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
    .slice(0, 3);
}

function computeAvoidList() {
  return SECTORS
    .map(s => ({ ...s, rating: state.sectorRatings[s.ticker] }))
    .filter(s => ratingToStatus(s.rating) === 'WEAK')
    .sort((a, b) => parseFloat(a.rating) - parseFloat(b.rating));
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
  if (typeof window.renderHome === 'function') window.renderHome();
  if (typeof window.renderContextPanel === 'function') window.renderContextPanel();
  if (typeof window.toast === 'function') window.toast('Sector grades cleared');
}

window.computeTop3 = computeTop3;
window.computeAvoidList = computeAvoidList;
window.daysSinceSectorRating = daysSinceSectorRating;
window.isSectorRatingStale = isSectorRatingStale;
window.clearSectors = clearSectors;
