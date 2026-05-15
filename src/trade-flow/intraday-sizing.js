// Intraday trade sizing: spread bracket, OR-derived auto-fill, R-multiple compute, structure/instrument.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS, newIntradayTicket } from '../config/constants.js';

function tfSetIntradayStructure(structure) {
  if (!state.intraday) state.intraday = newIntradayTicket();
  const s = structure === 'spread' ? 'spread' : structure === 'stocks' ? 'stocks' : 'options';
  state.intraday.structure = s;
  state.intraday.instrument = s === 'stocks' ? 'stocks' : 'options';
  window.tfDeriveIntradaySpread();
  window.tfAutoFillIntradayOptionBracket();
  window.tfAutoFillIntradayStockFromOR();
  saveState();
  window.tfRefreshAll();
}

function tfSetIntradayInstrument(instrument) {
  window.tfSetIntradayStructure(instrument === 'stocks' ? 'stocks' : 'options');
}

function tfIntradayInstrument() {
  const it = state.intraday || {};
  return it.instrument === 'stocks' ? 'stocks' : 'options';
}

function tfDeriveIntradaySpread() {
  const it = state.intraday || {};
  const bid = Number(it.bid);
  const ask = Number(it.ask);
  if (bid > 0 && ask > 0 && ask >= bid) {
    const mid = (bid + ask) / 2;
    it.mid = +mid.toFixed(2);
    it.spreadPct = +(((ask - bid) / mid) * 100).toFixed(1);
    return it.spreadPct;
  }
  it.mid = null;
  it.spreadPct = null;
  return null;
}

function tfAutoFillIntradayOptionBracket({ force = false } = {}) {
  const it = state.intraday || {};
  if ((it.instrument || 'options') === 'stocks') return;
  const settings = state.settings || DEFAULT_SETTINGS;
  const mid = Number(it.mid);
  if (mid > 0 && (force || !it.entry)) it.entry = mid;
  const entry = Number(it.entry);
  if (!(entry > 0)) return;
  if (force || !it.stop) {
    it.stop = +(entry * (1 - ((settings.stopPct || 50) / 100))).toFixed(2);
  }
  if (force || !it.target) {
    const targetR = Number(settings.targetRMultiple) > 0 ? Number(settings.targetRMultiple) : 2;
    const stopDist = Math.abs(entry - Number(it.stop));
    it.target = +(entry + targetR * stopDist).toFixed(2);
  }
}

function tfAutoFillIntradayStockFromOR({ force = false } = {}) {
  const it = state.intraday || {};
  if (it.instrument !== 'stocks') return;
  const hi = Number(it.orHi);
  const lo = Number(it.orLo);
  const rng = Number(it.orRng) || (hi > 0 && lo > 0 ? hi - lo : null);
  if (!(hi > 0 && lo > 0 && rng > 0)) return;
  if (it.setup === 'orb-up-break') {
    if (force || !it.entry) it.entry = +hi.toFixed(2);
    if (force || !it.stop) it.stop = +lo.toFixed(2);
    if (force || !it.target) it.target = +(hi + rng).toFixed(2);
  } else if (it.setup === 'orb-dn-break') {
    if (force || !it.entry) it.entry = +lo.toFixed(2);
    if (force || !it.stop) it.stop = +hi.toFixed(2);
    if (force || !it.target) it.target = +(lo - rng).toFixed(2);
  }
}

function tfRenderIntradaySizingHtml() {
  const it = state.intraday || {};
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const auto = window.tfComputeIntradayRiskSize();
  if (!auto) {
    return `<div class="input-help" style="margin-top:8px;">Enter a price to Smart-Size ${isOptions ? 'contracts' : 'shares'}.</div>`;
  }
  const manualQty = Number(it.contracts);
  const useQty = manualQty > 0 ? manualQty : auto.qty;
  const positionCost = Number(it.entry) > 0 ? Math.round(Number(it.entry) * useQty * auto.mult) : null;
  const profileHtml = window.tfRenderRiskProfileHtml({ entry: it.entry, stop: it.stop, target: it.target, qty: useQty, mult: auto.mult, unitLabel: auto.label, riskUnitDollars: auto.riskBudget });
  return `
    <div class="trade-output" style="margin-top:10px;">
      <div class="trade-output-title">Visual Risk Bar</div>
      <div class="trade-output-main">${useQty} ${auto.label}${useQty === 1 ? '' : 's'}${positionCost !== null ? ` for total cost of $${positionCost.toLocaleString()}` : ''}</div>
      ${profileHtml || ''}
    </div>`;
}

// Live gain/loss estimate card — $ + % + R for both outcomes.
// Reads from state.intraday and refreshes whenever a level changes.
function tfRenderIntradayEstimatesHtml() {
  const it = state.intraday || {};
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const entry  = Number(it.entry);
  const stop   = Number(it.stop);
  const target = Number(it.target);
  if (!(entry > 0 && stop > 0)) {
    return `<div class="input-help">Enter entry and stop to see live gain / loss estimates.</div>`;
  }
  const auto = window.tfComputeIntradayRiskSize();
  const manualQty = Number(it.contracts);
  const qty  = manualQty > 0 ? manualQty : (auto ? auto.qty : 0);
  const mult = isOptions ? 100 : 1;
  const direction = window.tfRiskDirection({ entry, stop, target });
  const stopStat = window.tfRiskLevelStat({ entry, price: stop, qty, mult, rBase: Math.abs(entry - stop) * mult * qty, direction });
  const targetStat = target > 0 ? window.tfRiskLevelStat({ entry, price: target, qty, mult, rBase: Math.abs(entry - stop) * mult * qty, direction }) : null;
  const lossDollar = Math.round(Math.abs(stopStat ? stopStat.pnl : 0));
  const gainDollar = targetStat ? Math.round(targetStat.pnl) : 0;
  const lossPct = stopStat ? stopStat.pct : 0;
  const gainPct = targetStat ? targetStat.pct : 0;
  const rValue  = targetStat ? targetStat.r : null;
  const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  return `
    <div class="tf-i-est">
      <div class="tf-i-est-cell tf-i-est-loss">
        <div class="tf-i-est-label">Closing @ Stop</div>
        <div class="tf-i-est-val">−$${lossDollar.toLocaleString()}</div>
        <div class="tf-i-est-sub">${fmtPct(lossPct)} · −1.00R</div>
      </div>
      <div class="tf-i-est-cell tf-i-est-gain">
        <div class="tf-i-est-label">Closing @ Target</div>
        <div class="tf-i-est-val">${target > 0 ? window.tfSignedMoneyText(gainDollar, 0) : '—'}</div>
        <div class="tf-i-est-sub">${target > 0 ? `${fmtPct(gainPct)} · ${rValue !== null ? (rValue >= 0 ? '+' : '') + rValue.toFixed(2) + 'R' : '—'}` : 'add a limit price'}</div>
      </div>
      <div class="tf-i-est-cell">
        <div class="tf-i-est-label">Size</div>
        <div class="tf-i-est-val">${qty || '—'}</div>
        <div class="tf-i-est-sub">${auto ? auto.label + (qty === 1 ? '' : 's') : ''}</div>
      </div>
    </div>`;
}

function tfComputeIntradayRiskSize() {
  const it = state.intraday || {};
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const entry = Number(it.entry);
  if (!(entry > 0)) return null;
  const mult = isOptions ? 100 : 1;
  // 1R = account × regime risk% (pure R-unit, independent of deployed capital).
  const account = settings.account || 10000;
  const riskPct = (typeof window.getRiskPctForRegime === 'function')
    ? window.getRiskPctForRegime(state.regime || 'risk-on')
    : 0.02;
  const riskBudget = Math.round(account * riskPct);
  // Stop is optional — derive a default from settings.stopPct × regime
  // multiplier when missing so Smart-Size can still compute.
  let stop = Number(it.stop);
  let stopDist = stop > 0 ? Math.abs(entry - stop) : 0;
  let derivedStop = false;
  if (!(stopDist > 0)) {
    const baseStopPct = ((settings.stopPct || 50) / 100);
    const regimeMult = (typeof window.getRegimeRiskMultiplier === 'function')
      ? window.getRegimeRiskMultiplier(state.regime)
      : 1;
    const effStopPct = baseStopPct * regimeMult;
    stopDist = entry * effStopPct;
    derivedStop = true;
  }
  if (!(stopDist > 0)) return null;
  const qty = Math.max(1, Math.floor(riskBudget / Math.max(0.01, stopDist * mult)));
  return {
    qty,
    risk: qty * stopDist * mult,
    riskBudget,
    stopDist,
    mult,
    derivedStop,
    label: isOptions ? 'contract' : 'share',
  };
}

function tfApplyIntradayRiskSize() {
  const auto = window.tfComputeIntradayRiskSize();
  if (!auto) return null;
  if (!state.intraday) state.intraday = newIntradayTicket();
  state.intraday.contracts = auto.qty;
  if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '' };
  if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
  state.tradeFlow.intradayDraft.contracts = String(auto.qty);
  return auto.qty;
}

function tfBindIntradayRiskSizeButton() {
  const btn = document.getElementById('tf-i-use-risk-size');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const qty = window.tfApplyIntradayRiskSize();
    if (!qty) {
      if (typeof toast === 'function') window.toast('Fill entry and stop first.', true);
      return;
    }
    const el = document.getElementById('tf-i-contracts');
    if (el) el.value = qty;
    saveState();
    window.tfRefreshHeaderOnly();
    window.tfUpdateIntradaySizing();
  });
}

function tfUpdateIntradaySizing() {
  const card = document.getElementById('tf-i-sizing-card');
  if (card) card.innerHTML = window.tfRenderIntradaySizingHtml();
  window.tfBindIntradayRiskSizeButton();
  window.tfBindPriceLevelSliders();
}

// Live gain/loss estimates — surgical refresh on entry/stop/target change.
function tfUpdateIntradayRMult() {
  const el = document.getElementById('tf-i-estimates');
  if (!el) return;
  el.innerHTML = window.tfRenderIntradayEstimatesHtml();
}

// Spread bracket for intraday — single word.
function tfSpreadBracket(spread, maxOverride = null) {
  const override = Number(maxOverride);
  const max = override > 0 ? override : ((state.settings && state.settings.intradayMaxSpreadPct) || 5);
  if (spread === null || spread === undefined || spread === '') return { cls: 'empty', text: '—' };
  const v = Number(spread);
  if (isNaN(v)) return { cls: 'empty', text: '—' };
  if (v <= max * 0.6) return { cls: 'tight', text: 'TIGHT' };
  if (v <= max)       return { cls: 'mid',   text: 'OK' };
  return                       { cls: 'wide',  text: 'WIDE' };
}

// ----- Rendering -----

// The sticky header owns ticker, structure, and direction.
// Swing starts with quality gates, then technicals, sizing, and log. Intraday stays compact.

window.tfSetIntradayStructure = tfSetIntradayStructure;
window.tfSetIntradayInstrument = tfSetIntradayInstrument;
window.tfIntradayInstrument = tfIntradayInstrument;
window.tfDeriveIntradaySpread = tfDeriveIntradaySpread;
window.tfAutoFillIntradayOptionBracket = tfAutoFillIntradayOptionBracket;
window.tfAutoFillIntradayStockFromOR = tfAutoFillIntradayStockFromOR;
window.tfRenderIntradaySizingHtml = tfRenderIntradaySizingHtml;
window.tfRenderIntradayEstimatesHtml = tfRenderIntradayEstimatesHtml;
window.tfComputeIntradayRiskSize = tfComputeIntradayRiskSize;
window.tfApplyIntradayRiskSize = tfApplyIntradayRiskSize;
window.tfBindIntradayRiskSizeButton = tfBindIntradayRiskSizeButton;
window.tfUpdateIntradaySizing = tfUpdateIntradaySizing;
window.tfUpdateIntradayRMult = tfUpdateIntradayRMult;
window.tfSpreadBracket = tfSpreadBracket;
