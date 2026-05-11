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
    it.target = +(entry * (1 + ((settings.targetPct || 50) / 100))).toFixed(2);
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
    return `<div class="input-help" style="margin-top:8px;">Fill entry and stop to auto-size ${isOptions ? 'contracts' : 'shares'}.</div>`;
  }
  const manualQty = Number(it.contracts);
  const manualRisk = manualQty > 0 ? Math.round(manualQty * auto.stopDist * auto.mult) : null;
  const profileQty = manualQty > 0 ? manualQty : auto.qty;
  const qtyLine = manualQty > 0
    ? `${manualQty} ${auto.label}${manualQty === 1 ? '' : 's'} in the override field · estimated risk $${manualRisk}.`
    : `Blank quantity is fine: GO logs the suggested ${auto.qty} ${auto.label}${auto.qty === 1 ? '' : 's'}.`;
  const perUnit = auto.stopDist * auto.mult;
  const profileHtml = window.tfRenderRiskProfileHtml({ entry: it.entry, stop: it.stop, target: it.target, qty: profileQty, mult: auto.mult, unitLabel: auto.label, riskUnitDollars: auto.riskBudget });
  return `
    <div class="trade-output" style="margin-top:10px;">
      <div class="trade-output-title">Entry & risk unit</div>
      <div class="trade-output-main">${auto.qty} ${auto.label}${auto.qty === 1 ? '' : 's'} suggested</div>
      <div class="trade-output-rationale">Entry, stop, target, and quantity are tied to your $${auto.riskBudget} intraday risk unit. ${qtyLine}</div>
      <div class="trade-output-grid">
        <div class="trade-output-cell"><span class="trade-output-cell-label">Entry</span><span class="trade-output-cell-value">${window.tfMoneyText(it.entry)}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Stop</span><span class="trade-output-cell-value">${window.tfMoneyText(it.stop)}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Target</span><span class="trade-output-cell-value">${window.tfMoneyText(it.target)}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Risk unit</span><span class="trade-output-cell-value">$${auto.riskBudget}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Risk / ${isOptions ? 'ct' : 'share'}</span><span class="trade-output-cell-value">$${perUnit.toFixed(isOptions ? 0 : 2)}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Suggested risk</span><span class="trade-output-cell-value">$${Math.round(auto.risk)}</span></div>
      </div>
      ${profileHtml || '<div class="input-help" style="margin-top:10px;">Add a target to draw the visual risk profile.</div>'}
      <div class="trade-templates" style="margin-top:10px;">
        <button type="button" class="trade-template-btn" id="tf-i-use-risk-size">Use suggested size</button>
        <span class="trade-templates-label">Optional. Leaving the override blank already uses this size.</span>
      </div>
    </div>`;
}

function tfComputeIntradayRiskSize() {
  const it = state.intraday || {};
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const entry = Number(it.entry);
  const stop = Number(it.stop);
  if (!(entry > 0 && stop > 0)) return null;
  const stopDist = Math.abs(entry - stop);
  if (!(stopDist > 0)) return null;
  const mult = isOptions ? 100 : 1;
  const riskBudget = settings.intradayRiskPerTrade || 100;
  const qty = Math.max(1, Math.floor(riskBudget / Math.max(0.01, stopDist * mult)));
  return {
    qty,
    risk: qty * stopDist * mult,
    riskBudget,
    stopDist,
    mult,
    label: isOptions ? 'contract' : 'share',
  };
}

function tfApplyIntradayRiskSize() {
  const auto = window.tfComputeIntradayRiskSize();
  if (!auto) return null;
  if (!state.intraday) state.intraday = newIntradayTicket();
  state.intraday.contracts = auto.qty;
  if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
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
  window.tfBindMoonshotSliders();
}

// Intraday R-multiple block — surgical update on entry/stop/target change.
// Compact pill style matches the inline render in tfIntradayStep2.
function tfUpdateIntradayRMult() {
  const el = document.getElementById('tf-i-rmult');
  if (!el) return;
  const it = state.intraday || {};
  const r = (it.entry && it.stop && it.target)
    ? Math.abs((Number(it.target) - Number(it.entry)) / (Number(it.entry) - Number(it.stop)))
    : null;
  const rText = r !== null && isFinite(r) ? `${r.toFixed(2)}R reward / risk` : '—';
  const rGood = r !== null && isFinite(r) && r >= 1.5;
  const rOk = r !== null && isFinite(r);
  el.innerHTML = `
    <span class="trade-bracket ${rGood ? 'high' : (rOk ? 'mid' : 'low')}" style="font-size: 11px; padding: 5px 10px;">${rText}</span>
    <span class="input-help" style="margin:0;">Reward / risk · target ÷ stop distance.</span>`;
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
window.tfComputeIntradayRiskSize = tfComputeIntradayRiskSize;
window.tfApplyIntradayRiskSize = tfApplyIntradayRiskSize;
window.tfBindIntradayRiskSizeButton = tfBindIntradayRiskSizeButton;
window.tfUpdateIntradaySizing = tfUpdateIntradaySizing;
window.tfUpdateIntradayRMult = tfUpdateIntradayRMult;
window.tfSpreadBracket = tfSpreadBracket;
