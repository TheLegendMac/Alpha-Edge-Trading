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

// ---------- Trade modal core ----------
function populateTradeModalSetups(mode) {
  const sel = document.getElementById('t-setup');
  if (!sel) return;
  const swing = ['21-EMA Pullback','Base Breakout','Breakout Retest','9-EMA Reclaim','Edge Reversal'];
  const intraday = ['ORB Break','ORB Retest','VWAP Reclaim','VWAP Loss','Momentum Edge','Trend Continuation'];
  const list = mode === 'intraday' ? intraday : swing;
  const current = sel.value;
  sel.innerHTML = '<option value="">Select...</option>' + list.map(s => `<option>${s}</option>`).join('');
  // Preserve current selection if still valid for the new mode
  if (list.includes(current)) sel.value = current;
}

// Stock vs Option toggle inside the Log Trade modal — updates labels and IVR visibility.
function setTradeInstrument(inst) {
  if (inst !== 'options' && inst !== 'stocks') return;
  const hidden = document.getElementById('t-instrument');
  if (hidden) hidden.value = inst;
  document.querySelectorAll('#t-instrument-row .flow-instrument-pill').forEach(b => {
    const a = b.dataset.tInstrument === inst;
    b.classList.toggle('active', a);
    b.setAttribute('aria-selected', a ? 'true' : 'false');
  });
  const isStocks = inst === 'stocks';
  const entryLabel = document.getElementById('t-entry-label');
  const ctrLabel = document.getElementById('t-contracts-label');
  const ivrGroup = document.getElementById('t-ivr-group');
  if (entryLabel) entryLabel.textContent = isStocks ? 'Entry Price (per share)' : 'Entry Premium';
  if (ctrLabel)   ctrLabel.textContent   = isStocks ? 'Shares' : 'Contracts';
  if (ivrGroup)   ivrGroup.style.display = isStocks ? 'none' : '';
}

function openTradeModal(trade) {
  const modal = document.getElementById('modal-add');
  const title = document.getElementById('modal-title');
  const subtitle = document.getElementById('modal-subtitle');
  const form = document.getElementById('trade-form');
  const deleteBtn = document.getElementById('btn-delete-trade');
  form.reset();
  document.getElementById('t-id').value = '';
  document.getElementById('t-status').value = 'open';
  document.getElementById('t-grade').value = '';

  // Populate setup dropdown based on mode (default swing). Function defined below.
  populateTradeModalSetups('swing');

  if (trade) {
    title.textContent = 'Edit Trade';
    subtitle.textContent = trade.status === 'open'
      ? 'Open position — switch to Review only when closed in your broker'
      : 'Closed position — adjust review fields below';
    deleteBtn.style.display = 'inline-block';
    document.getElementById('t-id').value = trade.id;
    document.getElementById('t-mode').value = trade.mode || 'swing';
    populateTradeModalSetups(trade.mode || 'swing');
    document.getElementById('t-date').value = trade.date || '';
    document.getElementById('t-ticker').value = trade.ticker || '';
    document.getElementById('t-setup').value = trade.setup || '';
    document.getElementById('t-direction').value = trade.direction || 'Long';
    document.getElementById('t-entry').value = trade.entry || '';
    document.getElementById('t-contracts').value = trade.contracts || '';
    document.getElementById('t-ivr').value = trade.ivr || '';
    document.getElementById('t-regime').value = trade.regime || 'RISK-ON';
    document.getElementById('t-thesis').value = trade.thesis || '';
    document.getElementById('t-premortem').value = trade.premortem || '';
    document.getElementById('t-stop').value = trade.stop || '';
    document.getElementById('t-status').value = trade.status || 'open';
    document.getElementById('t-exit').value = trade.exit || '';
    setTradeBias(_directionToBias(trade.bias || trade.direction));
    setTradeInstrument(trade.instrument || 'options');
  } else {
    title.textContent = 'Log Trade';
    subtitle.textContent = 'Capture the entry plan. Closing, scaling, and grading happen in the Position Editor.';
    deleteBtn.style.display = 'none';
    document.getElementById('t-date').value = new Date().toISOString().split('T')[0];

    // Default mode based on which tab the user is on right now
    const defaultMode = state.activeMode === 'intraday' ? 'intraday' : 'swing';
    document.getElementById('t-mode').value = defaultMode;
    populateTradeModalSetups(defaultMode);
    setTradeInstrument(state.instrument || 'options');
    setTradeBias(state.direction === 'short' ? 'bearish' : 'bullish');

    // Pre-fill from current flow state — saves the user from re-entering everything
    if (state.selectedSetup) document.getElementById('t-setup').value = state.selectedSetup;
    if (state.premium) document.getElementById('t-entry').value = state.premium;
    if (state.ivr !== null) document.getElementById('t-ivr').value = state.ivr;
    if (state.ticker) document.getElementById('t-ticker').value = state.ticker;
    document.getElementById('t-regime').value = REGIME_DATA[state.regime]?.text || 'RISK-ON';

    // Pre-fill stop from ATR + underlying price if both available (bias-aware)
    if (state.atr && state.atr > 0 && state.underlyingPrice && state.underlyingPrice > 0) {
      const distance = state.atr * 1.5;
      const isBullish = state.direction !== 'short';
      const volStop = (isBullish ? state.underlyingPrice - distance : state.underlyingPrice + distance).toFixed(2);
      document.getElementById('t-stop').value = volStop;
    }

    // Auto-compute contracts using same logic as the calculator
    if (state.premium && state.premium > 0) {
      const settings = state.settings;
      let riskPct = getRiskPctForRegime(state.regime);
      if (state.selectedSetup === 'Edge Reversal') riskPct = riskPct / 2;
      const riskDollars = settings.account * riskPct;
      const stopFraction = settings.stopPct / 100;
      const maxLossPerContract = state.premium * stopFraction * 100;
      const contracts = Math.floor(riskDollars / maxLossPerContract);
      if (contracts >= 1) {
        document.getElementById('t-contracts').value = contracts;
      }
    }
  }
  modal.classList.add('show');
}

function closeTradeModal() {
  document.getElementById('modal-add').classList.remove('show');
}

// Bias (Bullish/Bearish) lives in #t-bias and is mirrored to the legacy #t-direction
// Long/Short field for back-compat with calcPL and stats.
function _directionToBias(d) {
  if (!d) return 'bullish';
  const s = String(d).toLowerCase();
  if (s === 'bearish' || s === 'short') return 'bearish';
  return 'bullish';
}
function _biasToDirection(b) { return b === 'bearish' ? 'Short' : 'Long'; }
function setTradeBias(bias) {
  const sel = document.getElementById('t-bias');
  const hidden = document.getElementById('t-direction');
  if (sel) sel.value = bias;
  if (hidden) hidden.value = _biasToDirection(bias);
}

function saveTrade() {
  const id = document.getElementById('t-id').value || genTradeId();
  const mode = document.getElementById('t-mode').value || 'swing';
  const existingTrade = state.trades.find(t => t.id === id);
  const nowIso = new Date().toISOString();
  // Entry-only modal — Position Editor owns close/scale/grade. Preserve closed state on edit.
  const status = existingTrade?.status || 'open';
  // Risk dollars: swing uses regime %, intraday uses fixed $
  const riskDollars = mode === 'intraday'
    ? state.settings.intradayRiskPerTrade
    : (state.settings.account || 10000) * getRiskPctForRegime(state.regime || 'risk-on');
  // Trade modal exposes its own instrument toggle. Falls back to the existing trade,
  // then to the active flow instrument, then to options.
  const modalInstrument = (document.getElementById('t-instrument')?.value || '').trim();
  const instrument = modalInstrument || existingTrade?.instrument || (state.instrument || 'options');
  const bias = document.getElementById('t-bias')?.value || 'bullish';
  const direction = _biasToDirection(bias);
  const qty = parseInt(document.getElementById('t-contracts').value) || 0;
  const trade = {
    ...(existingTrade || {}),
    id,
    mode,
    instrument,
    date: document.getElementById('t-date').value,
    ticker: document.getElementById('t-ticker').value.toUpperCase(),
    setup: document.getElementById('t-setup').value,
    bias,
    direction, // legacy mirror
    entry: parseFloat(document.getElementById('t-entry').value) || 0,
    qty,
    contracts: qty, // legacy mirror
    ivr: parseFloat(document.getElementById('t-ivr').value) || null,
    regime: document.getElementById('t-regime').value,
    thesis: document.getElementById('t-thesis').value,
    premortem: document.getElementById('t-premortem').value,
    stop: parseFloat(document.getElementById('t-stop').value) || null,
    riskDollars,
    status,
    created_at: existingTrade?.created_at || nowIso,
    updated_at: nowIso,
  };

  if (!trade.date || !trade.ticker || !trade.setup || !trade.entry || !trade.qty) {
    window.toast('Fill in all required fields', true);
    return;
  }

  const isEdit = !!existingTrade;
  const idx = state.trades.findIndex(t => t.id === id);
  if (idx >= 0) state.trades[idx] = trade;
  else state.trades.push(trade);
  if (state.deletedTradeIds) delete state.deletedTradeIds[id];

  saveState();
  // Trades are too important to wait the 1.5s debounce — push right now.
  // If the user closes the tab in the next 1.5s, debounced push could be lost.
  if (typeof doPush === 'function') {
    if (typeof SYNC !== 'undefined' && SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    window.doPush();
  }
  closeTradeModal();

  // Reset flow if this was a new trade entry from the GO button (not a manual edit)
  if (!isEdit && trade.status === 'open') {
    resetFlowSilent();
    window.toast('Trade logged. Flow reset for next decision.');
  } else {
    window.toast(isEdit ? 'Trade updated' : 'Trade logged');
  }

  window.renderLogStats();
  window.renderLogTable();
  window.renderPretradeCheck();  // recompute auto-detected checks
}

function deleteTrade() {
  const id = document.getElementById('t-id').value;
  if (!id) return;
  const trade = state.trades.find(t => t.id === id);
  if (!trade) return;
  if (!confirm(`Delete this trade?\n\n${trade.ticker} ${trade.setup} ${trade.date}\n\nThis cannot be undone.`)) return;
  if (!state.deletedTradeIds) state.deletedTradeIds = {};
  state.deletedTradeIds[id] = new Date().toISOString();
  state.trades = state.trades.filter(t => t.id !== id);
  saveState();
  // Force immediate push (same reason as saveTrade)
  if (typeof doPush === 'function') {
    if (typeof SYNC !== 'undefined' && SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    window.doPush();
  }
  closeTradeModal();
  window.renderHome();
  window.renderLogStats();
  window.renderLogTable();
  window.renderPretradeCheck();
  window.toast('Trade deleted');
}

function resetFlowSilent() {
  state.selectedSetup = null;
  state.ivr = null;
  state.premium = null;
  state.atr = null;
  state.underlyingPrice = null;
  state.ticker = null;
  state.saQuant = null;
  state.daysToEarnings = null;
  state.gateChecks = {};
  state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
  if (state.tradeFlow) {
    state.tradeFlow.swingPremiumManual = false;
    state.tradeFlow.moonshotR = 3;
  }
  saveState();
  if (typeof renderTrade === 'function') window.renderTrade();
}

window.editTrade = function(id) {
  const t = state.trades.find(t => t.id === id);
  if (t) window.openPositionEditor(t);
};

window.reviewTrade = function(id) {
  const t = state.trades.find(t => t.id === id);
  if (!t) return;
  window.openPositionEditor(t, 'journal');
};

// ---------- Position Editor (simplified Execution Manager + Journal) ----------

window.addTestTrades = addTestTrades;
// Onboarding shortcut — 30 trades, no confirm prompt.
window.loadDemoData = () => addTestTrades(30, true);
window.populateTradeModalSetups = populateTradeModalSetups;
window.setTradeInstrument = setTradeInstrument;
window.openTradeModal = openTradeModal;
window.closeTradeModal = closeTradeModal;
window.setTradeBias = setTradeBias;
window.saveTrade = saveTrade;
window.deleteTrade = deleteTrade;
window.resetFlowSilent = resetFlowSilent;
