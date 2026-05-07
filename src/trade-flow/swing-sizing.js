// Swing trade sizing: render premium/sizing widgets, auto-fill from quote, structure/instrument toggles.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { TRADE_STRUCTURES } from '../config/constants.js';

function tfRenderSwingSizingHtml() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = state.instrument !== 'stocks';
  const premium = state.premium;
  if (!premium || premium <= 0) return '';
  const account = settings.account || 10000;
  const deployed = window.tfCapitalDeployed();
  const available = Math.max(0, account - deployed);
  const riskPct = (typeof getRiskPctForRegime === 'function') ? getRiskPctForRegime(state.regime || 'risk-on') : 0.02;
  const riskDollars = Math.round(available * riskPct);
  const deployedNote = deployed > 0
    ? ` Capital deployed in open positions $${Math.round(deployed).toLocaleString()} subtracted; available $${Math.round(available).toLocaleString()}.`
    : '';
  if (isOptions) {
    const stopFraction = (settings.stopPct || 50) / 100;
    const maxLossPerContract = premium * stopFraction * 100;
    const contracts = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerContract)));
    const totalRisk = contracts * maxLossPerContract;
    const totalPremium = contracts * premium * 100;
    const target = premium * (1 + (settings.targetPct || 50) / 100);
    const stopPrem = premium * (1 - stopFraction);
    const atr = state.atr; const upx = state.underlyingPrice;
    const stopDollar = (atr > 0 && upx > 0) ? `${(state.direction === 'short' ? upx + atr * 1.5 : upx - atr * 1.5).toFixed(2)}` : '—';
    return `
      <div class="trade-output">
        <div class="trade-output-title">Sizing (regime: ${(state.regime || 'risk-on').toUpperCase()})</div>
        <div class="trade-output-main">${contracts} contract${contracts === 1 ? '' : 's'} · risk $${Math.round(totalRisk)}</div>
        <div class="trade-output-rationale">Account $${account.toLocaleString()} × ${(riskPct * 100).toFixed(2)}% = $${riskDollars} risk per trade. Stop at ${(settings.stopPct || 50)}% of premium → max loss per contract $${maxLossPerContract.toFixed(0)}.${deployedNote}</div>
        <div class="trade-output-grid">
          <div class="trade-output-cell"><span class="trade-output-cell-label">Total premium</span><span class="trade-output-cell-value">$${Math.round(totalPremium)}</span></div>
          <div class="trade-output-cell"><span class="trade-output-cell-label">Profit target</span><span class="trade-output-cell-value">$${target.toFixed(2)} / ct</span></div>
          <div class="trade-output-cell"><span class="trade-output-cell-label">Premium stop</span><span class="trade-output-cell-value">$${stopPrem.toFixed(2)} / ct</span></div>
          <div class="trade-output-cell"><span class="trade-output-cell-label">Underlying stop</span><span class="trade-output-cell-value">$${stopDollar}</span></div>
        </div>
        ${window.tfRenderRiskProfileHtml({ entry: premium, stop: stopPrem, target, qty: contracts, mult: 100, unitLabel: 'contract', riskUnitDollars: riskDollars })}
      </div>`;
  }
  const stopPct = (settings.stopPct || 5) / 100;
  const maxLossPerShare = premium * stopPct;
  const shares = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerShare)));
  const targetPct = (settings.targetPct || 50) / 100;
  const stopPrice = state.direction === 'short' ? premium * (1 + stopPct) : premium * (1 - stopPct);
  const targetPrice = state.direction === 'short' ? premium * (1 - targetPct) : premium * (1 + targetPct);
  return `
    <div class="trade-output">
      <div class="trade-output-title">Sizing (regime: ${(state.regime || 'risk-on').toUpperCase()})</div>
      <div class="trade-output-main">${shares} shares · risk $${Math.round(shares * maxLossPerShare)}</div>
      <div class="trade-output-rationale">Stop at ${(settings.stopPct || 5)}% of price → max loss per share $${maxLossPerShare.toFixed(2)}.${deployedNote}</div>
      ${window.tfRenderRiskProfileHtml({ entry: premium, stop: stopPrice, target: targetPrice, qty: shares, mult: 1, unitLabel: 'share', riskUnitDollars: riskDollars })}
    </div>`;
}

function tfSwingQuoteMid(liq = (state.liquidity || {})) {
  const bid = Number(liq.bid);
  const ask = Number(liq.ask);
  if (!(bid > 0 && ask > 0 && ask >= bid)) return null;
  return +(((bid + ask) / 2).toFixed(2));
}

function tfCanAutoFillSwingPremium(previousMid = null) {
  if (state.tradeFlow && state.tradeFlow.swingPremiumManual) return false;
  const premium = Number(state.premium);
  if (!(premium > 0)) return true;
  return previousMid !== null && Math.abs(premium - previousMid) < 0.005;
}

function tfAutoFillSwingPremiumFromQuote(previousMid = null) {
  if (state.instrument === 'stocks') return false;
  const mid = window.tfSwingQuoteMid();
  if (mid === null || !window.tfCanAutoFillSwingPremium(previousMid)) return false;
  state.premium = mid;
  if (state.tradeFlow) state.tradeFlow.swingPremiumManual = false;
  return true;
}

function tfSetSwingPremiumFromQuote() {
  const mid = window.tfSwingQuoteMid();
  if (mid === null) return null;
  state.premium = mid;
  if (state.tradeFlow) state.tradeFlow.swingPremiumManual = false;
  return mid;
}

function tfUpdateSwingSpreadLine() {
  const quote = window.tfOptionSpreadFromBidAsk((state.liquidity || {}).bid, (state.liquidity || {}).ask);
  const spreadRead = document.querySelector('#panel-trade [data-tf-liq="bid"]')?.closest('.trade-section')?.querySelector('[data-tf-spread-read]');
  if (spreadRead) spreadRead.innerHTML = quote ? window.tfSpreadReadHtml(quote.spreadPct, 5) : '';
  const badge = document.querySelector('#panel-trade [data-tf-liq="bid"]')?.closest('.trade-input-row')?.querySelector('.trade-bracket');
  if (badge) {
    const b = quote ? window.tfSpreadBracket(quote.spreadPct, 5) : { cls: 'empty', text: '—' };
    badge.className = `trade-bracket ${b.cls}`;
    badge.textContent = b.text;
  }
  const liqCounter = document.getElementById('tf-swing-liq-counter');
  if (liqCounter) {
    const ok = window.tfEvaluateGates()['04'];
    liqCounter.classList.toggle('complete', !!ok);
    liqCounter.textContent = ok ? 'pass' : 'fill quote';
  }
}

function tfUpdateSwingSizing() {
  const card = document.getElementById('tf-sizing-card');
  if (card) card.innerHTML = window.tfRenderSwingSizingHtml();
  window.tfBindMoonshotSliders();
  const premiumCounter = document.getElementById('tf-premium-counter');
  if (premiumCounter) {
    const ok = Number(state.premium) > 0;
    premiumCounter.classList.toggle('complete', ok);
    premiumCounter.textContent = ok ? '1 set' : 'fill 1';
  }
  const riskCounter = document.getElementById('tf-swing-risk-counter');
  if (riskCounter) {
    const isOptions = state.instrument !== 'stocks';
    const gates = window.tfEvaluateGates();
    const ready = isOptions
      ? Number(state.premium) > 0 && Number(state.atr) > 0 && Number(state.underlyingPrice) > 0
      : gates['04'] && Number(state.premium) > 0;
    riskCounter.classList.toggle('complete', !!ready);
    riskCounter.textContent = ready ? 'ready' : (isOptions ? 'fill 3' : 'fill 2');
  }
  // Gate 06 row also reflects ATR + underlying — refresh in place.
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
window.tfSwingQuoteMid = tfSwingQuoteMid;
window.tfCanAutoFillSwingPremium = tfCanAutoFillSwingPremium;
window.tfAutoFillSwingPremiumFromQuote = tfAutoFillSwingPremiumFromQuote;
window.tfSetSwingPremiumFromQuote = tfSetSwingPremiumFromQuote;
window.tfUpdateSwingSpreadLine = tfUpdateSwingSpreadLine;
window.tfUpdateSwingSizing = tfUpdateSwingSizing;
window.tfInstrumentToggleHtml = tfInstrumentToggleHtml;
window.tfStructureValue = tfStructureValue;
window.tfSetSwingStructure = tfSetSwingStructure;
window.tfSetSwingInstrument = tfSetSwingInstrument;
