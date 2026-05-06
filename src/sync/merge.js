// Cross-device merge helpers + market-context cloud reconciliation.
// Pure-ish: read state but don't perform IO.

import { state } from '../state/store.js';

export function tradeFieldScore(trade) {
  if (!trade) return 0;
  return Object.values(trade).reduce((score, value) => {
    if (value === null || value === undefined || value === '') return score;
    if (Array.isArray(value) && value.length === 0) return score;
    return score + 1;
  }, 0);
}

export function tradeUpdatedTime(trade) {
  const stamp = trade?.updated_at || trade?.updatedAt || trade?.modified_at || trade?.created_at;
  const time = stamp ? new Date(stamp).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function chooseTradeVersion(localTrade, cloudTrade) {
  const localTime = tradeUpdatedTime(localTrade);
  const cloudTime = tradeUpdatedTime(cloudTrade);

  if (localTime && cloudTime && localTime !== cloudTime) {
    return localTime > cloudTime ? localTrade : cloudTrade;
  }
  if (cloudTrade?.status !== 'open' && localTrade?.status === 'open') return cloudTrade;
  if (localTrade?.status !== 'open' && cloudTrade?.status === 'open') return localTrade;
  if (localTime && !cloudTime) return localTrade;
  if (cloudTime && !localTime) return cloudTrade;

  const localScore = tradeFieldScore(localTrade);
  const cloudScore = tradeFieldScore(cloudTrade);
  if (cloudScore > localScore) return cloudTrade;
  return localTrade;
}

export function mergeDeletedTradeIds(localDeleted, cloudDeleted) {
  const merged = { ...(cloudDeleted || {}) };
  Object.entries(localDeleted || {}).forEach(([id, stamp]) => {
    if (!merged[id] || new Date(stamp).getTime() > new Date(merged[id]).getTime()) {
      merged[id] = stamp;
    }
  });
  return merged;
}

// Merge two trade arrays by ID. If the same ID exists in both places, keep
// the newest version of that trade so cross-device edits like win/loss,
// exit premium, grade, and lesson are not overwritten by an older local copy.
export function mergeTradesArrays(localTrades, cloudTrades, deletedTradeIds = state.deletedTradeIds || {}) {
  const byId = new Map();
  for (const t of cloudTrades) {
    if (t && t.id) byId.set(t.id, t);
  }
  for (const t of localTrades) {
    if (!t || !t.id) continue;
    if (byId.has(t.id)) {
      byId.set(t.id, chooseTradeVersion(t, byId.get(t.id)));
    } else {
      byId.set(t.id, t);
    }
  }
  return Array.from(byId.values()).filter(t => !deletedTradeIds[t.id]);
}

// ---------- Market context (regime + sectors) cloud reconciliation ----------

export function touchMarketContext() {
  state.marketContextUpdatedAt = new Date().toISOString();
}

export function marketContextTime(ctx, fallbackUpdatedAt) {
  const stamp = ctx?.marketContextUpdatedAt || ctx?.sectorRatedAt || fallbackUpdatedAt;
  const time = stamp ? new Date(stamp).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function shouldAdoptCloudMarketContext(cloudState, cloudUpdatedAt, sameDevice) {
  if (!cloudState || sameDevice) return false;
  const localCtx = {
    regime: state.regime,
    sectorRatings: state.sectorRatings || {},
    sectorRatedAt: state.sectorRatedAt || null,
  };
  const cloudCtx = {
    regime: cloudState.regime,
    sectorRatings: cloudState.sectorRatings || {},
    sectorRatedAt: cloudState.sectorRatedAt || null,
  };
  if (JSON.stringify(localCtx) === JSON.stringify(cloudCtx)) return false;
  return marketContextTime(cloudState, cloudUpdatedAt) > marketContextTime(state, 0);
}

export function adoptCloudMarketContext(cloudState) {
  state.regime = cloudState.regime || state.regime;
  state.sectorRatings = { ...(cloudState.sectorRatings || {}) };
  state.sectorRatedAt = cloudState.sectorRatedAt || null;
  state.marketContextUpdatedAt = cloudState.marketContextUpdatedAt || cloudState.sectorRatedAt || state.marketContextUpdatedAt || null;
}

// Bridge to legacy.js.
window.tradeFieldScore = tradeFieldScore;
window.tradeUpdatedTime = tradeUpdatedTime;
window.chooseTradeVersion = chooseTradeVersion;
window.mergeDeletedTradeIds = mergeDeletedTradeIds;
window.mergeTradesArrays = mergeTradesArrays;
window.touchMarketContext = touchMarketContext;
window.marketContextTime = marketContextTime;
window.shouldAdoptCloudMarketContext = shouldAdoptCloudMarketContext;
window.adoptCloudMarketContext = adoptCloudMarketContext;
