// Trade-flow gate evaluation: status computation, IVR bracket, rolling-30d P/L.

import { state, getRiskPctForRegime } from '../state/store.js';
import { isClosedTrade, calcPL } from '../models/trade.js';
import { DEFAULT_SETTINGS, TRADE_CONFLUENCE_OPTIONS } from '../config/constants.js';
import { computeRollingPL } from '../intel/rolling.js';

function tfComputeRolling30dPL() {
  return (typeof computeRollingPL === 'function')
    ? computeRollingPL()
    : { totalPL: 0, pct: 0, days: (state.settings && state.settings.killSwitchDays) || 30 };
}

// Pure gate evaluation — doesn't mutate state
function tfEvaluateGates() {
  const liqOk = (typeof liquidityOK === 'function') ? window.liquidityOK() : !!state.gateChecks['04'];
  const isOptions = state.instrument !== 'stocks';
  return {
    '01': state.saQuant !== null && state.saQuant !== undefined && state.saQuant >= 3.5,
    '02': !!state.gateChecks['02'] || (typeof window.tfGradePasses === 'function' && window.tfGradePasses(state.saProfitGrade)),
    '03': !!state.gateChecks['03'] || (typeof window.tfGradePasses === 'function' && window.tfGradePasses(state.saMomentumGrade)),
    '04': liqOk,
    '05': state.daysToEarnings !== null && state.daysToEarnings !== undefined && state.daysToEarnings >= 8,
    '06': isOptions
      ? state.atr !== null && state.atr > 0 && state.underlyingPrice !== null && state.underlyingPrice > 0
      : state.premium !== null && state.premium > 0,
  };
}

// Live status: { tone, reason, step } — drives the sticky header status pill.
// `step` is the step number (1-based) where the user can fix the issue. The
// header pill uses this to show "Step N: <reason>" and to jump to that step
// when the user clicks it.
function tfComputeStatus() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const s = state.settings || DEFAULT_SETTINGS;

  // Universal kill-switch — hard block no matter the step. Surface it on
  // step 1 so the user lands somewhere when they click the pill.
  const ks = window.tfComputeRolling30dPL();
  if (ks.pct <= -7) {
    return { tone: 'blocked', reason: `Last ${ks.days}d down ${Math.abs(ks.pct).toFixed(1)}% — kill switch`, step: 1 };
  }

  if (m === 'swing') {
    // 1 Setup & Quality — ticker plus business/quality gates + Technicals.
    if (!state.ticker)        return { tone: 'progress', reason: 'Add ticker',        step: 1 };
    if (state.saQuant === null || state.saQuant === undefined) return { tone: 'progress', reason: 'Add SA Quant rating', step: 1 };
    if (state.daysToEarnings === null || state.daysToEarnings === undefined) return { tone: 'progress', reason: 'Add days to earnings', step: 1 };
    const g = window.tfEvaluateGates();
    if (!g['01']) return { tone: 'blocked',  reason: 'SA Quant < 3.50 — skip',         step: 1 };
    if (!g['02']) return { tone: 'progress', reason: 'Confirm profitability grade',    step: 1 };
    if (!g['03']) return { tone: 'progress', reason: 'Confirm momentum grade',         step: 1 };
    if (!g['05']) return { tone: 'blocked',  reason: 'Earnings within 7 days',         step: 1 };

    if (!state.direction)     return { tone: 'progress', reason: 'Pick direction',    step: 1 };
    if (!state.selectedSetup) return { tone: 'progress', reason: 'Pick a setup',      step: 1 };
    const isOptions = state.instrument !== 'stocks';
    if (isOptions && (state.ivr === null || state.ivr === undefined)) return { tone: 'progress', reason: 'Add IV Rank', step: 1 };
    if (isOptions && state.ivr >= 70) return { tone: 'blocked', reason: 'IVR ≥ 70 — too rich, skip', step: 1 };

    // 2 Size — liquidity, quote/entry, and risk sizing.
    if (!g['04']) return { tone: 'progress', reason: 'Liquidity inputs incomplete', step: 2 };
    if (state.premium === null || state.premium === undefined || state.premium <= 0) {
      return { tone: 'progress', reason: isOptions ? 'Review entry premium' : 'Add share price', step: 2 };
    }
    if (isOptions && (state.atr === null || state.atr === undefined || state.atr <= 0)) {
      return { tone: 'progress', reason: 'Add ATR(14)', step: 2 };
    }
    if (isOptions && (state.underlyingPrice === null || state.underlyingPrice === undefined || state.underlyingPrice <= 0)) {
      return { tone: 'progress', reason: 'Add underlying price', step: 2 };
    }
    if (!g['06']) return { tone: 'progress', reason: 'Stop level not set', step: 2 };
    // 3 Log — every gate green; ready to fire.
    return { tone: 'ready', reason: 'Ready to log', step: 3 };
  }

  if (m === 'intraday') {
    const it = state.intraday || {};
    const isOptions = (it.instrument || 'options') !== 'stocks';
    const setupDef = (typeof tfFindIntradaySetup === 'function') ? window.tfFindIntradaySetup(it.setup) : null;

    // 1 Setup — ticker / setup pattern / direction (+ direction-vs-setup-bias)
    if (!it.ticker)    return { tone: 'progress', reason: 'Add ticker',     step: 1 };
    if (!it.setup)     return { tone: 'progress', reason: 'Pick a setup',   step: 1 };
    if (!it.direction) return { tone: 'progress', reason: 'Pick direction', step: 1 };
    if (setupDef && setupDef.bias !== 'either' && it.direction !== setupDef.bias) {
      return { tone: 'blocked', reason: `${setupDef.name} expects ${setupDef.bias.toUpperCase()}`, step: 1 };
    }
    if (isOptions) {
      // Spread is informational only — checked if known, never blocks for missing bid/ask.
      const spreadPct = window.tfDeriveIntradaySpread();
      if (spreadPct !== null && spreadPct !== undefined && spreadPct !== '' && Number(spreadPct) > s.intradayMaxSpreadPct) {
        return { tone: 'blocked', reason: `Spread ${Number(spreadPct).toFixed(1)}% over ${s.intradayMaxSpreadPct}%`, step: 2 };
      }
    }
    // Only entry is required to fire — stop/limit are optional.
    if (!it.entry) return { tone: 'progress', reason: 'Add entry $', step: 2 };
    // 3 Context — confluence-vs-direction conflict (only when chip is set), loss budget
    if (it.confluence) {
      const confDef = TRADE_CONFLUENCE_OPTIONS.find(c => c.id === it.confluence) || null;
      if (confDef && confDef.bias !== 'either' && it.direction !== confDef.bias) {
        return { tone: 'blocked', reason: `Confluence is ${confDef.label} — ${confDef.bias.toUpperCase()} only`, step: 3 };
      }
    }
    const dayPL = window.tfComputeIntradayDayPL();
    const lossBudget = s.intradayMaxDailyLoss + dayPL;
    if (lossBudget <= 0) return { tone: 'blocked', reason: 'Daily loss budget reached', step: 3 };

    return { tone: 'ready', reason: 'Ready to log', step: 3 };
  }

  return { tone: 'progress', reason: 'Pick a setup', step: 1 };
}

// Today's intraday P/L (negative on losing day) — copied semantics from existing intraday code.
function tfComputeIntradayDayPL() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();
  return (state.trades || [])
    .filter(t => t.mode === 'intraday' && isClosedTrade(t) && t.exit_date && new Date(t.exit_date).getTime() >= todayMs)
    .reduce((s, t) => s + (typeof calcPL === 'function' ? (calcPL(t) || 0) : 0), 0);
}

// Strategy label for the sticky header.
function tfComputeStrategyLabel() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') {
    if (!state.direction) return '—';
    if (state.instrument === 'stocks') return state.direction === 'long' ? 'LONG STOCK' : 'SHORT STOCK';
    if (window.tfStructureValue('swing') === 'spread') return state.direction === 'long' ? 'BULL DEBIT SPREAD' : 'BEAR DEBIT SPREAD';
    if (state.ivr === null || state.ivr === undefined) return state.direction === 'long' ? 'LONG (TBD)' : 'SHORT (TBD)';
    const sObj = (typeof getStrategyForIVR === 'function') ? window.getStrategyForIVR(state.ivr, state.direction) : null;
    if (!sObj) return state.direction === 'long' ? 'LONG' : 'SHORT';
    return (sObj.name || '').toUpperCase();
  }
  if (m === 'intraday') {
    const it = state.intraday || {};
    if (!it.direction) return '—';
    if ((it.instrument || 'options') === 'stocks') return it.direction === 'long' ? 'INTRADAY LONG STOCK' : 'INTRADAY SHORT STOCK';
    if (window.tfStructureValue('intraday') === 'spread') return it.direction === 'long' ? 'INTRADAY CALL SPREAD' : 'INTRADAY PUT SPREAD';
    return it.direction === 'long' ? 'INTRADAY CALL' : 'INTRADAY PUT';
  }
  return '—';
}

// IVR bracket for the input badge — single word, color tells the story.
function tfIvrBracket(ivr) {
  if (ivr === null || ivr === undefined || ivr === '') return { cls: 'empty', text: '—' };
  const v = Number(ivr);
  if (isNaN(v)) return { cls: 'empty', text: '—' };
  if (v < 30) return { cls: 'cheap', text: 'CHEAP' };
  if (v < 50) return { cls: 'mid',   text: 'MID' };
  if (v < 70) return { cls: 'rich',  text: 'RICH' };
  return                { cls: 'rich',  text: 'SKIP' };
}

// Strategy output card markup — used live by the plan/size step to surgically update
// the recommendation as IVR/direction changes. Defined once here so the
// step renderer and the live updater stay in sync.
// ----- Ticker history & autocomplete -----
// Read state.trades to surface "you've traded this name before — here's
// what worked." Anchored on the symbol the user is typing.

window.tfComputeRolling30dPL = tfComputeRolling30dPL;
window.tfEvaluateGates = tfEvaluateGates;
window.tfComputeStatus = tfComputeStatus;
window.tfComputeIntradayDayPL = tfComputeIntradayDayPL;
window.tfComputeStrategyLabel = tfComputeStrategyLabel;
window.tfIvrBracket = tfIvrBracket;
