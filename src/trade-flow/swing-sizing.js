// Swing trade sizing: render premium/sizing widgets and structure/instrument toggles.

import { state, getRiskPctForRegime } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS } from '../config/constants.js';

function tfComputeSwingRiskBudget() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const account = Number(settings.account) || DEFAULT_SETTINGS.account || 10000;
  let riskPct = (typeof getRiskPctForRegime === 'function')
    ? getRiskPctForRegime(state.regime || 'risk-on')
    : ((settings.riskOn || DEFAULT_SETTINGS.riskOn || 2) / 100);
  if (state.selectedSetup === 'Edge Reversal') riskPct = riskPct / 2;
  return Math.round(account * riskPct);
}

function tfRenderSwingSizingHtml() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = state.instrument !== 'stocks';
  const premium = state.premium;
  if (!premium || premium <= 0) return '';
  const manualStop = Number(state.swingStop);
  const manualTarget = Number(state.swingTarget);
  const manualQty = Number(state.swingQty);
  const riskDollars = window.tfComputeSwingRiskBudget();
  const targetR = Number(settings.targetRMultiple) > 0 ? Number(settings.targetRMultiple) : 2;
  if (isOptions) {
    const stopFraction = (settings.stopPct || 50) / 100;
    const defaultStopPrem = premium * (1 - stopFraction);
    const stopPrem = manualStop > 0 ? manualStop : defaultStopPrem;
    const maxLossPerContract = Math.abs(premium - stopPrem) * 100;
    const autoContracts = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerContract)));
    const contracts = manualQty > 0 ? Math.max(1, Math.floor(manualQty)) : autoContracts;
    const totalCost = contracts * premium * 100;
    const stopDistPrem = Math.abs(premium - stopPrem);
    const defaultTarget = +(premium + targetR * stopDistPrem).toFixed(2);
    const target = manualTarget > 0 ? manualTarget : defaultTarget;
    return `
      <div class="trade-output">
        <div class="trade-output-title">Visual Risk Bar</div>
        <div class="trade-output-main">${contracts} contract${contracts === 1 ? '' : 's'} for total cost of $${Math.round(totalCost).toLocaleString()}</div>
        ${window.tfRenderRiskProfileHtml({ entry: premium, stop: stopPrem, target, qty: contracts, mult: 100, unitLabel: 'contract', riskUnitDollars: riskDollars })}
      </div>`;
  }
  const stopPct = (settings.stopPct || 5) / 100;
  const defaultStopPrice = state.direction === 'short' ? premium * (1 + stopPct) : premium * (1 - stopPct);
  const stopPrice = manualStop > 0 ? manualStop : defaultStopPrice;
  const stopDistShares = Math.abs(premium - stopPrice);
  const defaultTargetPrice = state.direction === 'short'
    ? +(premium - targetR * stopDistShares).toFixed(2)
    : +(premium + targetR * stopDistShares).toFixed(2);
  const targetPrice = manualTarget > 0 ? manualTarget : defaultTargetPrice;
  const maxLossPerShare = Math.abs(premium - stopPrice);
  const autoShares = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerShare)));
  const shares = manualQty > 0 ? Math.max(1, Math.floor(manualQty)) : autoShares;
  const totalCost = shares * premium;
  return `
    <div class="trade-output">
      <div class="trade-output-title">Visual Risk Bar</div>
      <div class="trade-output-main">${shares} shares for total cost of $${Math.round(totalCost).toLocaleString()}</div>
      ${window.tfRenderRiskProfileHtml({ entry: premium, stop: stopPrice, target: targetPrice, qty: shares, mult: 1, unitLabel: 'share', riskUnitDollars: riskDollars })}
    </div>`;
}

function tfUpdateSwingLiquidityCounter() {
  const liqCounter = document.getElementById('tf-swing-liq-counter');
  if (liqCounter) {
    const ok = window.tfEvaluateGates()['04'];
    liqCounter.classList.toggle('complete', !!ok);
    liqCounter.textContent = ok ? 'pass' : (state.instrument === 'stocks' ? 'fill 1' : 'fill 3');
  }
}

function tfUpdateSwingSizing() {
  const card = document.getElementById('tf-sizing-card');
  if (card) card.innerHTML = window.tfRenderSwingSizingHtml();
  window.tfBindPriceLevelSliders();
  const riskCounter = document.getElementById('tf-swing-risk-counter');
  if (riskCounter) {
    const fields = [Number(state.premium) > 0, Number(state.swingQty) > 0];
    const ready = fields.every(Boolean);
    riskCounter.classList.toggle('complete', !!ready);
    riskCounter.textContent = ready ? 'ready' : `${fields.filter(Boolean).length} of 2`;
  }
  // Legacy Gate 06 row may be absent; refresh it in place when present.
  const gateRow = document.getElementById('tf-stop-gate');
  if (gateRow) {
    const gates = window.tfEvaluateGates();
    const ok = gates['06'];
    gateRow.classList.toggle('checked', !!ok);
    gateRow.classList.toggle('fail', !ok);
    const check = gateRow.querySelector('.trade-row-check');
    if (check) check.textContent = ok ? '✓' : '';
    const pill = gateRow.querySelector('.trade-row-pill');
    if (pill) pill.textContent = ok ? 'PASS' : 'FAIL';
  }
}

function tfInstrumentToggleHtml(current, attrName) {
  const cur = current === 'stocks' ? 'stocks' : 'options';
  return `
    <div class="flow-instrument-row" style="margin-bottom: 12px;">
      <span class="flow-instrument-label">Trading</span>
      <div class="flow-instrument-pills">
        <button type="button" class="flow-instrument-pill ${cur === 'options' ? 'active' : ''}" ${attrName}="options">
          <span class="flow-instrument-pill-name">Options</span>
          <span class="flow-instrument-pill-detail">Calls / puts</span>
        </button>
        <button type="button" class="flow-instrument-pill ${cur === 'stocks' ? 'active' : ''}" ${attrName}="stocks">
          <span class="flow-instrument-pill-name">Stock</span>
          <span class="flow-instrument-pill-detail">Shares</span>
        </button>
      </div>
    </div>`;
}

function tfStructureValue(mode = ((state.tradeFlow && state.tradeFlow.mode) || 'swing')) {
  if (mode === 'intraday') {
    const it = state.intraday || {};
    if (it.structure) return it.structure;
    return it.instrument === 'stocks' ? 'stocks' : 'options';
  }
  if (state.structure) return state.structure;
  return state.instrument === 'stocks' ? 'stocks' : 'options';
}

function tfSetSwingStructure(structure) {
  const s = structure === 'spread' ? 'spread' : structure === 'stocks' ? 'stocks' : 'options';
  state.structure = s;
  state.instrument = s === 'stocks' ? 'stocks' : 'options';
  saveState();
  window.tfRefreshAll();
}

function tfSetSwingInstrument(instrument) {
  window.tfSetSwingStructure(instrument === 'stocks' ? 'stocks' : 'options');
}

window.tfRenderSwingSizingHtml = tfRenderSwingSizingHtml;
window.tfComputeSwingRiskBudget = tfComputeSwingRiskBudget;
window.tfUpdateSwingLiquidityCounter = tfUpdateSwingLiquidityCounter;
window.tfUpdateSwingSizing = tfUpdateSwingSizing;
window.tfInstrumentToggleHtml = tfInstrumentToggleHtml;
window.tfStructureValue = tfStructureValue;
window.tfSetSwingStructure = tfSetSwingStructure;
window.tfSetSwingInstrument = tfSetSwingInstrument;
