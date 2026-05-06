// Trade-flow header summary controls + strategy preview.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { TRADE_SETUP_TEMPLATES, TRADE_INTRADAY_SETUPS } from '../config/constants.js';

function tfEnsureSummaryControls(mode) {
  const tickerEl = document.getElementById('trade-summary-ticker');
  const stratEl = document.getElementById('trade-summary-strategy');
  if (!tickerEl || !stratEl) return;
  if (tickerEl.dataset.summaryMode === mode && stratEl.dataset.summaryMode === mode) return;

  tickerEl.dataset.summaryMode = mode;
  tickerEl.innerHTML = `
    <div class="summary-ticker-wrap">
      <span class="trade-summary-label" style="margin:0;">Ticker</span>
      <input type="text" maxlength="20" class="summary-ticker-input" id="tf-summary-ticker-input" placeholder="—" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      <div class="summary-ticker-memory" id="tf-summary-ticker-memory"></div>
    </div>`;

  stratEl.dataset.summaryMode = mode;
  stratEl.innerHTML = `
    <div class="summary-strategy-wrap">
      <span class="trade-summary-label" style="margin:0;">Strategy</span>
      <div class="summary-strategy-row">
        <div class="summary-structure-pills" role="tablist" aria-label="Structure">
          <button type="button" class="summary-structure-pill" data-tf-structure="stocks" role="tab">Stock</button>
          <button type="button" class="summary-structure-pill" data-tf-structure="options" role="tab">Option</button>
          <button type="button" class="summary-structure-pill" data-tf-structure="spread" role="tab">Spread</button>
        </div>
        <div class="summary-direction-toggle" role="group" aria-label="Direction">
          <button type="button" class="summary-dir-btn long" data-tf-summary-dir="long" title="Long / call" aria-label="Bull / long">
            <span class="summary-dir-arrow">▲</span><span class="summary-dir-text">BULL</span>
          </button>
          <button type="button" class="summary-dir-btn short" data-tf-summary-dir="short" title="Short / put" aria-label="Bear / short">
            <span class="summary-dir-arrow">▼</span><span class="summary-dir-text">BEAR</span>
          </button>
        </div>
      </div>
    </div>`;

  window.tfBindSummaryControls();
}

function tfBindSummaryControls() {
  const tickerInput = document.getElementById('tf-summary-ticker-input');
  if (tickerInput) {
    tickerInput.addEventListener('input', e => {
      const sym = (e.target.value || '').toUpperCase();
      e.target.value = sym;
      const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
      if (m === 'intraday') {
        if (!state.intraday) state.intraday = newIntradayTicket();
        state.intraday.ticker = sym;
      } else {
        state.ticker = sym;
      }
      saveState();
      window.tfUpdateTickerMemory('tf-summary-ticker-memory', sym);
      window.tfRenderStepper();
      window.tfRenderActions();
      window.tfUpdateSummaryStatus();
    });
  }
  window.tfUpdateTickerMemory('tf-summary-ticker-memory',
    ((state.tradeFlow && state.tradeFlow.mode) || 'swing') === 'intraday'
      ? ((state.intraday && state.intraday.ticker) || '')
      : (state.ticker || ''));

  document.querySelectorAll('#trade-summary-strategy [data-tf-structure]').forEach(b => {
    b.addEventListener('click', () => {
      const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
      if (m === 'intraday') window.tfSetIntradayStructure(b.dataset.tfStructure);
      else window.tfSetSwingStructure(b.dataset.tfStructure);
    });
  });

  document.querySelectorAll('#trade-summary-strategy [data-tf-summary-dir]').forEach(b => {
    b.addEventListener('click', () => {
      const dir = b.dataset.tfSummaryDir;
      const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
      if (m === 'intraday') {
        if (!state.intraday) state.intraday = newIntradayTicket();
        state.intraday.direction = dir;
      } else {
        state.direction = dir;
      }
      saveState();
      window.tfRefreshAll();
    });
  });
}

function tfUpdateSummaryStatus() {
  const statusEl = document.getElementById('trade-summary-status');
  const cell = document.getElementById('trade-summary-status-cell');
  if (!statusEl || !cell) return;
  const st = window.tfComputeStatus();
  cell.classList.remove('ready', 'progress', 'blocked', 'clickable');
  cell.classList.add(st.tone);
  statusEl.textContent = st.tone === 'ready' ? 'Ready' : `Step ${st.step}: ${st.reason}`;
  if (st.tone !== 'ready') cell.classList.add('clickable');
  cell.dataset.tfStatusStep = st.step || '';
}

function tfRenderStrategyOutHtml(sObj) {
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

function tfUpdateSwingStrategyPreview() {
  const el = document.getElementById('tf-strategy-preview');
  if (!el) return;
  const isOptions = state.instrument !== 'stocks';
  if (!isOptions || state.ivr === null || state.ivr === undefined || !state.direction) { el.innerHTML = ''; return; }
  const sObj = (typeof getStrategyForIVR === 'function') ? window.getStrategyForIVR(Number(state.ivr), state.direction) : null;
  el.innerHTML = sObj ? window.tfRenderStrategyOutHtml(sObj) : '';
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


window.tfEnsureSummaryControls = tfEnsureSummaryControls;
window.tfBindSummaryControls = tfBindSummaryControls;
window.tfUpdateSummaryStatus = tfUpdateSummaryStatus;
window.tfRenderStrategyOutHtml = tfRenderStrategyOutHtml;
window.tfUpdateSwingStrategyPreview = tfUpdateSwingStrategyPreview;
window.tfCapitalDeployed = tfCapitalDeployed;
