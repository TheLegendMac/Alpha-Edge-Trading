// localStorage persistence + Supabase push hook. The cloud sync layer
// (schedulePush) still lives in legacy.js and is reached via window.

import { schedulePush } from '../sync/supabase.js';
import { state } from './store.js';
import {
  STORAGE_KEY,
  DEFAULT_SETTINGS,
  newIntradayTicket,
  TRADE_INTRADAY_LEGACY_MAP,
  normalizeActiveMode,
} from '../config/constants.js';

// Bump when the on-disk shape changes. Skipping migrations on stamped state
// shaves the per-field shape-up off every cold start.
const STATE_SCHEMA_VERSION = 1;

function migrateState() {
  if (!state.sectorRatings) state.sectorRatings = {};
  if (!state.sectorRatedAt) state.sectorRatedAt = null;
  if (!state.marketContextUpdatedAt) state.marketContextUpdatedAt = state.sectorRatedAt || null;
  if (!state.liquidity) state.liquidity = { stockVolPass: null, optionOIPass: null, bid: null, ask: null, spreadPct: null };
  if (state.liquidity.stockVolPass === undefined) {
    state.liquidity.stockVolPass = state.liquidity.stockVol === null || state.liquidity.stockVol === undefined
      ? null
      : Number(state.liquidity.stockVol) >= 1000000;
  }
  if (state.liquidity.optionOIPass === undefined) {
    state.liquidity.optionOIPass = state.liquidity.optionOI === null || state.liquidity.optionOI === undefined
      ? null
      : Number(state.liquidity.optionOI) >= 500;
  }
  delete state.liquidity.stockVol;
  delete state.liquidity.optionOI;
  if (state.liquidity.bid === undefined) state.liquidity.bid = null;
  if (state.liquidity.ask === undefined) state.liquidity.ask = null;
  if (!state.intraday) state.intraday = newIntradayTicket();

  if (state.intraday) {
    const it = state.intraday;
    if (it.setup && TRADE_INTRADAY_LEGACY_MAP[it.setup]) {
      it.setup = TRADE_INTRADAY_LEGACY_MAP[it.setup];
    }
    if (it.orbType    === undefined) it.orbType    = '30';
    if (it.orHi       === undefined) it.orHi       = null;
    if (it.orLo       === undefined) it.orLo       = null;
    if (it.orRng      === undefined) it.orRng      = null;
    if (it.confluence === undefined) it.confluence = '';
    if (it.breadth    === undefined) it.breadth    = '';
    if (it.vwapValue  === undefined) it.vwapValue  = null;
    if (it.vwapRel    === undefined) it.vwapRel    = '';
    if (!it.instrument) it.instrument = 'options';
    if (!it.structure) it.structure = it.instrument === 'stocks' ? 'stocks' : 'options';
    if (it.bid        === undefined) it.bid        = null;
    if (it.ask        === undefined) it.ask        = null;
    if (it.mid        === undefined) it.mid        = null;
  }
  if (!state.instrument) state.instrument = 'options';
  if (!state.structure) state.structure = state.instrument === 'stocks' ? 'stocks' : 'options';
  if (!state.intradayQuality) state.intradayQuality = { timeOverride: false };
  if (!state.logModeFilter) state.logModeFilter = 'all';
  if (state.logSearch === undefined) state.logSearch = '';
  if (state.logSetupFilter === undefined) state.logSetupFilter = '';
  if (!state.homePortfolioView) state.homePortfolioView = 'recent';
  state.activeMode = normalizeActiveMode(state.activeMode);
  if (!state.deletedTradeIds) state.deletedTradeIds = {};
  if (!Array.isArray(state.backtestReports)) state.backtestReports = [];
  if (!Array.isArray(state.recentTickers)) state.recentTickers = [];
  if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '' };
  if (!state.tradeFlow.mode) state.tradeFlow.mode = 'swing';
  if (!state.tradeFlow.step) state.tradeFlow.step = 1;
  if (state.tradeFlow.thesis === undefined) state.tradeFlow.thesis = '';
  if (state.tradeFlow.preMortem === undefined) state.tradeFlow.preMortem = '';
  if (state.tradeFlow.moonshotR !== undefined) delete state.tradeFlow.moonshotR;
  delete state.sundayChecks;

  state.schemaVersion = STATE_SCHEMA_VERSION;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const loaded = JSON.parse(raw);

    // Mutate `state` in place (preserves the shared object identity).
    Object.assign(state, loaded);
    state.settings = { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) };

    // Skip the per-field reshape when the on-disk version matches.
    if (loaded.schemaVersion === STATE_SCHEMA_VERSION) {
      state.activeMode = normalizeActiveMode(state.activeMode);
      state.homePortfolioView = 'recent';
      return;
    }
    migrateState();
    state.homePortfolioView = 'recent';
  } catch (e) {
    console.warn('Load failed:', e);
  }
}

export function saveStateLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem('mac_cockpit_local_save_ts', String(Date.now()));
  } catch (e) {
    console.warn('Save failed:', e);
  }
}

export function saveState() {
  saveStateLocal();
  // schedulePush is still in legacy.js (sync layer) — extracted in Phase 5.
  if (typeof schedulePush === 'function') schedulePush();
}

// Safer alternative to `state.x = v; saveState()` for top-level field
// updates: serialize the *candidate* state first; if the write fails,
// the in-memory `state` is left untouched so we don't end up with
// ghost state that won't survive a reload. Shallow patch only — for
// deep mutations (state.tradeFlow.step = 2, etc.) use saveState().
export function setState(patch) {
  if (!patch || typeof patch !== 'object') return true;
  const candidate = { ...state, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
    localStorage.setItem('mac_cockpit_local_save_ts', String(Date.now()));
  } catch (e) {
    console.warn('setState: persist failed, in-memory state unchanged', e);
    return false;
  }
  Object.assign(state, patch);
  if (typeof schedulePush === 'function') schedulePush();
  return true;
}

// Bridge to legacy.js.
