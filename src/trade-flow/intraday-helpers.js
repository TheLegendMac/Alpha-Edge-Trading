// Intraday-only helpers: today's intraday trades, in-window check, logging.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { todayISO } from '../models/formatters.js';
import { genTradeId, tradeBias } from '../models/trade.js';
import { newIntradayTicket } from '../config/constants.js';
import { deriveSpreadPct } from '../market/regime.js';
import { tfComputeIntradayRiskSize } from './intraday-sizing.js';
import { doPush, SYNC } from '../sync/supabase.js';
import { renderHome, renderUniversalSidebar } from '../views/home.js';
import { renderLogStats } from '../intel/alpha.js';
import { renderTrade } from './stepper.js';
import { toast } from '../modals/toast.js';

export function todayIntradayTrades() {
  return state.trades.filter(t => t.mode === "intraday" && t.date === todayISO());
}

export function isInIntradayWindow() {
  const now = new Date();
  const total = now.getHours() * 60 + now.getMinutes();
  const morning = total >= 9 * 60 + 35 && total <= 11 * 60 + 30;
  const afternoon = total >= 14 * 60 && total <= 15 * 60 + 30;
  return morning || afternoon;
}

export function logIntradayTrade() {
  const t = state.intraday;
  const instrument = t.instrument === 'stocks' ? 'stocks' : 'options';
  const multiplier = instrument === 'stocks' ? 1 : 100;
  const stopDist = Math.abs(t.entry - t.stop);
  // Size from the unified regime-aware risk budget (same logic as the live sizing widget).
  const auto = (typeof tfComputeIntradayRiskSize === 'function') ? tfComputeIntradayRiskSize() : null;
  const autoQty = auto && auto.qty > 0 ? auto.qty : 1;
  const qty = t.contracts || autoQty;
  const riskBudget = auto ? auto.riskBudget : 0;
  const bid = Number(t.bid);
  const ask = Number(t.ask);
  const mid = instrument === 'options'
    ? (Number(t.mid) || (bid > 0 && ask > 0 ? (bid + ask) / 2 : null))
    : null;
  const spreadPct = instrument === 'options' ? deriveSpreadPct(t) : null;
  const nowIso = new Date().toISOString();
  const trade = {
    id: 'i_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    mode: 'intraday',
    instrument,
    structure: t.structure || instrument,
    date: todayISO(),
    time: new Date().toTimeString().slice(0, 5),
    ticker: t.ticker,
    direction: t.direction === 'short' ? 'Short' : 'Long',
    setup: t.setup,
    entry: t.entry,
    stop: t.stop,
    target: t.target,
    contracts: qty,
    shares: instrument === 'stocks' ? qty : null,
    spreadPct,
    bid: t.bid ?? null,
    ask: t.ask ?? null,
    mid: mid ?? null,
    // Legacy field — kept for older trade rows that may still be pulling it.
    vwapRel: t.vwapRel || '',
    // ThinkScript-aligned context (recorded for review, not blocking GO).
    orbType:    t.orbType || null,
    orHi:       t.orHi    ?? null,
    orLo:       t.orLo    ?? null,
    orRng:      t.orRng   ?? null,
    confluence: t.confluence || '',
    breadth:    t.breadth    || '',
    vwapValue:  t.vwapValue  ?? null,
    notes: t.notes,
    riskDollars: riskBudget || Math.round(qty * stopDist * multiplier),
    setupSnapshot: {
      capturedAt: nowIso,
      mode: 'intraday',
      instrument,
      structure: t.structure || instrument,
      ticker: t.ticker,
      setup: t.setup,
      direction: t.direction === 'short' ? 'Short' : 'Long',
      entry: t.entry,
      stop: t.stop,
      limit: t.target,
      target: t.target,
      qty,
      riskDollars: riskBudget || Math.round(qty * stopDist * multiplier),
      regime: state.regime,
      regimeAtEntry: state.regime || null,
      bid: t.bid ?? null,
      ask: t.ask ?? null,
      mid: mid ?? null,
      spreadPct,
      orbType: t.orbType || null,
      orHi: t.orHi ?? null,
      orLo: t.orLo ?? null,
      orRng: t.orRng ?? null,
      confluence: t.confluence || '',
      breadth: t.breadth || '',
      vwapValue: t.vwapValue ?? null,
      notes: t.notes || '',
    },
    inWindow: isInIntradayWindow(),
    tradeNumOfDay: todayIntradayTrades().length + 1,
    regime: state.regime,
    regimeAtEntry: state.regime || null,
    openedAt: nowIso,
    ivr: null,
    thesis: t.notes,
    premortem: '',
    status: 'open',
    exit: null,
    grade: null,
    lesson: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  state.trades.push(trade);
  state.intraday = newIntradayTicket();
  state.intradayQuality.timeOverride = false;
  if (state.tradeFlow) state.tradeFlow.intradayDraft = {};
  saveState();
  // Force immediate push of the new trade
  if (typeof doPush === 'function') {
    if (SYNC && SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }
  renderHome();
  renderLogStats();
  if (typeof renderUniversalSidebar === 'function') renderUniversalSidebar();
  if (typeof renderTrade === 'function') renderTrade();
  toast('Intraday trade logged');
}

