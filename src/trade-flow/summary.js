// Trade-flow strategy preview & capital deployed.

import { state } from '../state/store.js';
import { tradeQty, tradeMultiplier } from '../models/trade.js';
import { getStrategyForIVR } from '../market/regime.js';

export function tfRenderStrategyOutHtml(sObj) {
  if (!sObj) return '';
  return `
    <div class="trade-output">
      <div class="trade-output-title">Recommended structure</div>
      <div class="trade-output-main">${sObj.name}</div>
      <div class="trade-output-rationale">${sObj.rationale}</div>
      <div class="trade-output-grid">
        <div class="trade-output-cell"><span class="trade-output-cell-label">Delta</span><span class="trade-output-cell-value">${sObj.delta}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">DTE</span><span class="trade-output-cell-value">${sObj.dte}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Spread Width</span><span class="trade-output-cell-value">${sObj.width}</span></div>
      </div>
    </div>`;
}

export function tfUpdateSwingStrategyPreview() {
  const el = document.getElementById('tf-strategy-preview');
  if (!el) return;
  const isOptions = state.instrument !== 'stocks';
  if (!isOptions || state.ivr === null || state.ivr === undefined || !state.direction) { el.innerHTML = ''; return; }
  const sObj = (typeof getStrategyForIVR === 'function') ? getStrategyForIVR(Number(state.ivr), state.direction) : null;
  el.innerHTML = sObj ? tfRenderStrategyOutHtml(sObj) : '';
}

// Sizing card markup for swing plan/size — also rendered surgically on input.
// Sum of capital tied up in open positions: options = entry × qty × 100,
// stocks = entry × qty. Used to reduce sizing's effective account size.
function tfCapitalDeployed() {
  const trades = (state.trades || []).filter(t => t && t.status === 'open');
  return trades.reduce((sum, t) => {
    const entry = Number(t.entry);
    const qty = (typeof tradeQty === 'function') ? tradeQty(t) : Number(t.qty ?? t.contracts ?? t.shares ?? 0);
    if (!Number.isFinite(entry) || !Number.isFinite(qty) || entry <= 0 || qty <= 0) return sum;
    return sum + (entry * qty * tradeMultiplier(t));
  }, 0);
}


