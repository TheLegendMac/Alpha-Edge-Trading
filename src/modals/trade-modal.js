// Add Trade modal + lifecycle entry points (open/save/delete/edit/review/addTestTrades).

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { refreshAllUI } from '../state/store.js';
import {
  genTradeId,
  tradeBias,
  tradeInstrument,
  tradeMultiplier,
  tradeQty,
  isClosedTrade,
  calcPL,
} from '../models/trade.js';
import {
  DEFAULT_SETTINGS,
  TRADE_INTRADAY_SETUPS,
  REGIME_DATA,
} from '../config/constants.js';
import { formatDate, dateOffsetISO } from '../models/formatters.js';
import { getRiskPctForRegime } from '../state/store.js';

// addTestTrades is a dev/test utility — generates random trades. Count
// defaults to 25; loadDemoData calls it with 30. The skipConfirm flag lets
// in-app onboarding (Load Demo Data button) skip the prompt.
function addTestTrades(count = 25, skipConfirm = false) {
  if (!skipConfirm) {
    const ok = confirm(
      `Generate ${count} random test trades?\n\n` +
      'They will be saved locally and pushed to Supabase if you are signed in.'
    );
    if (!ok) return;
  }

  const batchId = Date.now().toString(36).toUpperCase();
  const nowIso = new Date().toISOString();
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const rand = (min, max, decimals = 2) => Number((min + Math.random() * (max - min)).toFixed(decimals));
  const swingSetups = ['21-EMA Pullback', 'Base Breakout', 'Breakout Retest', '9-EMA Reclaim', 'Edge Reversal'];
  const intradaySetups = TRADE_INTRADAY_SETUPS.map(s => s.id);
  const tickers = ['AAPL','MSFT','NVDA','TSLA','META','AMZN','AMD','AVGO','GOOGL','NFLX','SPY','QQQ','IWM','COIN','PLTR'];
  const regimes = ['RISK-ON', 'NEUTRAL', 'RISK-OFF'];
  const grades = ['clean', 'clean', 'mixed', 'broken'];
  const emotions = ['calm', 'focused', 'anxious', 'rushed', 'patient'];
  const exitReasons = ['target', 'stop', 'thesis-broke', 'discretionary', 'time'];

  const sampleTrades = Array.from({ length: count }, (_, i) => {
    const mode = Math.random() < 0.65 ? 'swing' : 'intraday';
    const instrument = Math.random() < 0.18 ? 'stocks' : 'options';
    const statusRoll = Math.random();
    const status = statusRoll < 0.14 ? 'open' : statusRoll < 0.62 ? 'win' : 'loss';
    const daysAgo = Math.floor(Math.random() * 75);
    const holdDays = mode === 'intraday' ? 0 : Math.max(1, Math.floor(Math.random() * 14));
    const setup = mode === 'intraday' ? pick(intradaySetups) : pick(swingSetups);
    const setupDef = mode === 'intraday' ? TRADE_INTRADAY_SETUPS.find(s => s.id === setup) : null;
    const direction = mode === 'intraday' && setupDef && setupDef.bias !== 'either'
      ? (setupDef.bias === 'short' ? 'Short' : 'Long')
      : pick(['Long', 'Short']);
    const dirKey = direction === 'Short' ? 'short' : 'long';
    const entry = instrument === 'stocks' ? rand(35, 420, 2) : rand(0.55, 8.5, 2);
    const qty = instrument === 'stocks' ? Math.floor(rand(5, 80, 0)) : Math.floor(rand(1, 6, 0));
    const riskDollars = instrument === 'stocks'
      ? Math.round(entry * qty * rand(0.015, 0.06, 3))
      : Math.round(entry * 100 * qty * rand(0.35, 0.7, 2));
    const plR = status === 'open' ? null : status === 'win' ? rand(0.45, 2.8, 2) : -rand(0.35, 1.35, 2);
    const multiplier = instrument === 'stocks' ? 1 : 100;
    const exit = status === 'open' ? null : Math.max(0.05, entry + ((riskDollars * plR) / (multiplier * qty)));
    const tradeDate = dateOffsetISO(daysAgo);
    const exitDate = status === 'open' ? null : dateOffsetISO(Math.max(0, daysAgo - holdDays));
    const time = mode === 'intraday' ? `${String(Math.floor(rand(9, 15, 0))).padStart(2, '0')}:${String(Math.floor(rand(0, 59, 0))).padStart(2, '0')}` : null;
    const spreadPct = mode === 'intraday' && instrument === 'options' ? rand(1.2, 6.5, 1) : null;
    const mid = spreadPct !== null ? Number((entry * rand(0.985, 1.015, 3)).toFixed(2)) : null;
    const halfSpread = mid && spreadPct !== null ? mid * (spreadPct / 100) / 2 : null;
    const bid = halfSpread !== null ? Math.max(0.01, Number((mid - halfSpread).toFixed(2))) : null;
    const ask = halfSpread !== null ? Number((mid + halfSpread).toFixed(2)) : null;
    const alignedConf = dirKey === 'short' ? 'short-bias' : 'long-bias';
    const oppositeConf = dirKey === 'short' ? 'long-bias' : 'short-bias';
    const confluence = mode === 'intraday' ? (Math.random() < 0.68 ? alignedConf : pick(['mixed', oppositeConf])) : '';
    const breadth = mode === 'intraday' ? (Math.random() < 0.65 ? (dirKey === 'short' ? 'down' : 'up') : pick(['flat', dirKey === 'short' ? 'up' : 'down'])) : '';
    const isOrb = mode === 'intraday' && setupDef && setupDef.isOrb;
    const orMid = isOrb ? rand(80, 520, 2) : null;
    const orRng = isOrb ? rand(0.35, 4.8, 2) : null;
    const orHi = isOrb ? Number((orMid + orRng / 2).toFixed(2)) : null;
    const orLo = isOrb ? Number((orMid - orRng / 2).toFixed(2)) : null;
    return {
      id: `test_${batchId}_${String(i + 1).padStart(2, '0')}_${Math.random().toString(36).slice(2, 6)}`,
      mode,
      instrument,
      date: tradeDate,
      time,
      ticker: pick(tickers),
      setup,
      direction,
      entry,
      stop: instrument === 'stocks' ? Number((entry * (direction === 'Long' ? 0.96 : 1.04)).toFixed(2)) : Number((entry * 0.55).toFixed(2)),
      target: status === 'open' ? null : Number((entry * (status === 'win' ? 1.55 : 0.75)).toFixed(2)),
      contracts: qty,
      shares: instrument === 'stocks' ? qty : null,
      ivr: mode === 'swing' && instrument !== 'stocks' ? Math.floor(rand(12, 78, 0)) : null,
      spreadPct,
      bid,
      ask,
      mid,
      confluence,
      breadth,
      orbType: isOrb ? pick(['5', '15', '30']) : null,
      orHi,
      orLo,
      orRng,
      vwapValue: mode === 'intraday' ? rand(80, 520, 2) : null,
      vwapRel: mode === 'intraday' ? (confluence === 'long-bias' ? 'above' : confluence === 'short-bias' ? 'below' : 'at') : '',
      regime: pick(regimes),
      thesis: `Random test ${mode} trade ${i + 1} from batch ${batchId}.`,
      premortem: 'Generated sample data for layout and stats testing.',
      notes: mode === 'intraday' ? `Random intraday sample ${i + 1}.` : '',
      riskDollars,
      inWindow: mode === 'intraday' ? Math.random() > 0.12 : null,
      tradeNumOfDay: mode === 'intraday' ? Math.floor(rand(1, 5, 0)) : null,
      status,
      exit: exit === null ? null : Number(exit.toFixed(2)),
      exit_date: exitDate,
      grade: status === 'open' ? null : pick(grades),
      followed_plan: status === 'open' ? null : pick(['yes', 'yes', 'partial', 'no']),
      emotion: status === 'open' ? null : pick(emotions),
      exit_reason: status === 'open' ? null : (status === 'win' ? pick(['target', 'discretionary', 'time']) : pick(exitReasons)),
      lesson: status === 'open' ? null : `Generated trade ${i + 1}: review stats, row layout, and filtering.`,
      created_at: nowIso,
      updated_at: nowIso,
    };
  });

  state.trades.push(...sampleTrades);
  saveState();
  if (typeof doPush === 'function') {
    if (typeof SYNC !== 'undefined' && SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    window.doPush();
  }
  window.renderHome();
  window.renderLogStats();
  window.renderLogTable();
  window.renderPretradeCheck();
  if (typeof renderTrade === 'function') window.renderTrade();
  window.toast(`Generated ${sampleTrades.length} random test trades`);
}

// Universal sidebar refresher - call from anywhere a trade lifecycle event happens

// ---------- Trade modal ----------

function resetFlowSilent() {
  state.selectedSetup = null;
  state.direction = null;
  state.structure = 'options';
  state.instrument = 'options';
  state.ivr = null;
  state.premium = null;
  state.swingStop = null;
  state.swingTarget = null;
  state.swingQty = null;
  state.atr = null;
  state.underlyingPrice = null;
  state.ticker = null;
  state.saQuant = null;
  state.daysToEarnings = null;
  state.saProfitGrade = '';
  state.saMomentumGrade = '';
  state.gateChecks = {};
  state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
  if (state.tradeFlow) {
    state.tradeFlow.swingPremiumManual = false;
    state.tradeFlow.swingScenario = {};
    state.tradeFlow.notes = '';
    state.tradeFlow.thesis = '';
    state.tradeFlow.preMortem = '';
    state.tradeFlow.visited = [];
  }
  saveState();
  if (typeof renderTrade === 'function') window.renderTrade();
}

window.editTrade = function(id) {
  if (typeof window.openEditTrade === 'function') {
    window.openEditTrade(id);
  }
};

window.reviewTrade = function(id) {
  if (typeof window.openEditTrade === 'function') {
    window.openEditTrade(id);
  }
};

// ---------- Position Editor (simplified Execution Manager + Journal) ----------

window.addTestTrades = addTestTrades;
// Onboarding shortcut — 30 trades, with confirm prompt.
window.loadDemoData = () => addTestTrades(30, false);
window.resetFlowSilent = resetFlowSilent;
