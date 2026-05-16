// Sector ratings helpers — pure compute + stale checks used by Home,
// Context Panel, Settings. The DOM rendering for sector ratings lives in
// market/context-panel.js; this module just exposes the data helpers.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { SECTORS } from '../config/constants.js';
import { ratingToStatus } from '../models/trade.js';
import { touchMarketContext } from '../sync/merge.js';
import { renderHome } from './home.js';
import { renderContextPanel } from '../market/context-panel.js';
import { toast } from '../modals/toast.js';

export function computeTop3(ratings = state.sectorRatings) {
  return SECTORS
    .map(s => ({ ...s, rating: (ratings || {})[s.ticker] }))
    .filter(s => ratingToStatus(s.rating) === 'STRONG')
    .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
    .slice(0, 3);
}

export function computeAvoidList(ratings = state.sectorRatings) {
  return SECTORS
    .map(s => ({ ...s, rating: (ratings || {})[s.ticker] }))
    .filter(s => ratingToStatus(s.rating) === 'WEAK')
    .sort((a, b) => parseFloat(a.rating) - parseFloat(b.rating));
}

export function daysSinceSectorRating() {
  if (!state.sectorRatedAt) return null;
  const ratedAt = new Date(state.sectorRatedAt);
  const now = new Date();
  return Math.floor((now - ratedAt) / (1000 * 60 * 60 * 24));
}

export function isSectorRatingStale() {
  const days = daysSinceSectorRating();
  return days !== null && days > 7;
}

function clearSectors() {
  if (!confirm('Clear all sector ratings? This cannot be undone.')) return;
  state.sectorRatings = {};
  state.sectorRatedAt = null;
  touchMarketContext();
  saveState();
  if (typeof renderHome === 'function') renderHome();
  if (typeof renderContextPanel === 'function') renderContextPanel();
  if (typeof toast === 'function') toast('Sector grades cleared');
}

