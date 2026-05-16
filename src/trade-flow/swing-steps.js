// Swing trade flow steps 1-4 with mount handlers + paste import helpers.

import { state, getRiskPctForRegime, getRegimeRiskMultiplier } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS, TRADE_SWING_SETUPS } from '../config/constants.js';
import { tfRefreshAll, tfRefreshHeaderOnly, tfStepCompletion, tfStepCount, renderTrade } from './stepper.js';
import { tfIvrBracket, tfEvaluateGates } from './gates.js';
import { getStrategyForIVR } from '../market/regime.js';
import { tfRenderStrategyOutHtml, tfUpdateSwingStrategyPreview } from './summary.js';
import { tfRenderSwingSizingHtml, tfUpdateSwingSizing, tfComputeSwingRiskBudget } from './swing-sizing.js';
import { toast } from '../modals/toast.js';
import { tfBindPriceLevelSliders } from './risk.js';
import { tfReadKeyNumber, tfGradePasses } from './intraday-steps.js';

export function tfSwingStep1() {
  const sel = state.selectedSetup;
  const dirKey = (state.direction || '').toString().toLowerCase().startsWith('s') ? 'short' : 'long';
  // Filter: hide setups whose bias doesn't match the active direction (either always shows).
  const visible = TRADE_SWING_SETUPS.filter(s => {
    const b = s.bias || 'either';
    return b === 'either' || b === dirKey;
  });
  const cards = visible.map(s => {
    const biasTag = s.bias === 'long'  ? '<span class="tf-bias-tag long">LONG</span>'
                  : s.bias === 'short' ? '<span class="tf-bias-tag short">SHORT</span>'
                                       : '<span class="tf-bias-tag neutral">EITHER</span>';
    return `
    <button class="trade-setup-card ${sel === s.id ? 'selected' : ''}" type="button" data-tf-setup="${s.id}">
      <span class="trade-setup-card-num">${s.num} · ${biasTag}${s.halfSize ? ' <span class="tf-bias-tag neutral" style="margin-left:4px;">½ SIZE</span>' : ''}</span>
      <span class="trade-setup-card-name">${s.name || s.id}</span>
      <span class="trade-setup-card-detail">${s.desc}</span>
    </button>`;
  }).join('');

  const empty = !visible.length
    ? `<div class="input-help">No setups match this direction. Switch direction in the header.</div>`
    : '';

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Pick setup</div>
          <div class="trade-section-subtitle">Choose the chart pattern.</div>
        </div>
        <div class="trade-section-counter ${sel ? 'complete' : ''}">${sel ? '1 selected' : 'pick 1'}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-setup-grid" id="tf-setup-grid">${cards}</div>
        ${empty}
      </div>
    </div>
  `;
}

export function tfMountSwingStep1() {
  // If the currently-selected setup doesn't match the active direction, clear it.
  if (state.selectedSetup) {
    const dirKey = (state.direction || '').toString().toLowerCase().startsWith('s') ? 'short' : 'long';
    const def = TRADE_SWING_SETUPS.find(s => s.id === state.selectedSetup);
    const bias = def ? (def.bias || 'either') : 'either';
    if (bias !== 'either' && bias !== dirKey) {
      state.selectedSetup = null;
      saveState();
    }
  }
  document.querySelectorAll('#panel-trade [data-tf-setup]').forEach(b => {
    b.addEventListener('click', () => {
      state.selectedSetup = b.dataset.tfSetup;
      // Auto-align direction if the setup has a specific bias.
      const def = TRADE_SWING_SETUPS.find(s => s.id === state.selectedSetup);
      if (def && def.bias && def.bias !== 'either') state.direction = def.bias;
      saveState();
      tfRefreshAll();
    });
  });
}

export function tfSwingContractSpecHtml() {
  const isOptions = state.instrument !== 'stocks';
  const ivr = state.ivr;
  const ivrValue = ivr !== null && ivr !== undefined ? Math.max(0, Math.min(100, Number(ivr))) : 0;
  const dir = state.direction;
  const bracket = tfIvrBracket(ivr);
  const sObj = (ivr !== null && ivr !== undefined && dir && isOptions)
    ? getStrategyForIVR(Number(ivr), dir) : null;
  const stratOut = `<div id="tf-strategy-preview">${sObj ? tfRenderStrategyOutHtml(sObj) : ''}</div>`;

  return isOptions ? `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> IV Rank</div>
          <div class="trade-section-subtitle">Set volatility before picking the contract.</div>
        </div>
        <div class="trade-section-counter ${ivr !== null && ivr !== undefined ? 'complete' : ''}">${ivr !== null && ivr !== undefined ? '1 set' : 'fill 1'}</div>
      </div>
      <div class="trade-section-body">
        <div class="tf-ivr-control">
          <div class="tf-ivr-control-head">
            <label class="input-label" for="tf-ivr">IV Rank (0-100)</label>
            <div class="tf-ivr-control-value">
              <input type="number" min="0" max="100" step="1" class="trade-input" id="tf-ivr"
                placeholder="IVR"
                value="${ivr !== null && ivr !== undefined ? ivr : ''}" />
              <div class="trade-bracket ${bracket.cls}" id="tf-ivr-bracket">${bracket.text}</div>
            </div>
          </div>
          <input type="range" min="0" max="100" step="1" class="sett-slider tf-ivr-slider" id="tf-ivr-slider" value="${ivrValue}" aria-label="Adjust IV Rank" />
          <div class="sett-slider-ticks tf-ivr-ticks"><span>0</span><span>30</span><span>50</span><span>70</span><span>100</span></div>
          <div class="input-help">Cheap below 30 · Moderate 30-50 · Rich 50+ · Skip if 70+</div>
        </div>
        ${stratOut}
      </div>
    </div>` : `
    <div class="trade-section muted">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> Stock mode</div>
          <div class="trade-section-subtitle">IV Rank is skipped for shares.</div>
        </div>
      </div>
    </div>`;
}

export function tfMountSwingContractSpec() {
  const ivrEl = document.getElementById('tf-ivr');
  const sliderEl = document.getElementById('tf-ivr-slider');
  if (!ivrEl || !sliderEl) return;

  const sliderFill = (value) => {
    const hasValue = value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const n = hasValue ? Math.max(0, Math.min(100, Number(value))) : 0;
    const b = tfIvrBracket(hasValue ? n : null);
    const color = b.cls === 'cheap' ? 'var(--green-bright)' : b.cls === 'mid' ? '#f59e0b' : b.cls === 'rich' ? 'var(--red-bright)' : 'var(--cyan)';
    sliderEl.style.background = `linear-gradient(90deg, ${color} ${n}%, rgba(255,255,255,0.08) ${n}%)`;
  };

  const applyIvr = (raw, source) => {
    const parsed = parseFloat(raw);
    const v = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
    state.ivr = v;
    if (source !== 'input') ivrEl.value = v === null ? '' : String(v);
    if (source !== 'slider') sliderEl.value = v === null ? '0' : String(v);
    sliderFill(v);
    saveState();
    tfRefreshHeaderOnly();
    const badge = document.getElementById('tf-ivr-bracket');
    if (badge) {
      const b = tfIvrBracket(state.ivr);
      badge.className = `trade-bracket ${b.cls}`;
      badge.textContent = b.text;
    }
    tfUpdateSwingStrategyPreview();
  };

  sliderFill(state.ivr);
  ivrEl.addEventListener('input', e => applyIvr(e.target.value, 'input'));
  sliderEl.addEventListener('input', e => applyIvr(e.target.value, 'slider'));
}

// ----- Swing quality — eligibility (SA quant, factor grades, earnings) -----
// "Quality" answers: is this name worth trading before we inspect the chart?

export function tfSwingStep2() {
  const gates = tfEvaluateGates();
  const passed = ['01','02','03','05'].filter(k => gates[k]).length;
  const ticker = state.ticker || '';
  const settingMinEarningsDays = Number(state.settings && state.settings.minDaysToEarnings);
  const minEarningsDays = Number.isFinite(settingMinEarningsDays) ? settingMinEarningsDays : DEFAULT_SETTINGS.minDaysToEarnings;

  const gateBadge = (k, isManual) => {
    const ok = gates[k];
    const cls = ok ? 'tight' : 'empty';
    const txt = ok ? 'PASS' : (isManual ? 'MARK' : 'FAIL');
    const cursor = isManual ? 'cursor: pointer;' : '';
    return `<div class="trade-bracket ${cls}" data-tf-gate-badge="${k}" style="margin: 0; min-width: 52px; text-align: center; ${cursor}" ${isManual ? `title="Click to manually override"` : ''}>${txt}</div>`;
  };

  const yesNoToggle = (key, stateVal) => `
    <div class="tf-dir-btns" style="width: 140px;">
      <button class="tf-dir-btn ${stateVal === true ? 'active' : ''}" data-tf-toggle="${key}" data-val="yes" type="button"
        style="${stateVal === true ? 'background:rgba(16,185,129,0.14);border-color:rgba(16,185,129,0.40);color:var(--green-bright)' : ''}">YES</button>
      <button class="tf-dir-btn ${stateVal === false ? 'active short' : ''}" data-tf-toggle="${key}" data-val="no" type="button"
        style="${stateVal === false ? 'background:rgba(248,113,113,0.14);border-color:rgba(248,113,113,0.40);color:var(--red-bright)' : ''}">NO</button>
    </div>
  `;

  const yesNoBadge = (key, stateVal) => {
    const ok = gates[key];
    const cls = ok ? 'tight' : stateVal === false ? 'wide' : 'empty';
    const txt = ok ? 'PASS' : stateVal === false ? 'FAIL' : 'MARK';
    return `<div class="trade-bracket ${cls}" data-tf-gate-badge="${key}" style="margin:0; min-width:52px; text-align:center;">${txt}</div>`;
  };

  const noTickerWarn = !ticker ? `
    <p class="trade-row-help" style="color: var(--amber-bright); margin-bottom: 10px;">
      Set a ticker in the header first — the SA factor-grade links need it.
    </p>` : '';

  // Smart paste — at the top of step 1 only. Mirrors intraday: parser
  // already understands the swing alert format. After apply, the mount
  // handler jumps the user as far ahead as the data lets it.
  const smartPaste = `
    <div class="trade-section tf-smart-paste-section" id="tf-s-paste-panel" hidden>
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title" style="display:flex; align-items:center; gap:8px;">
            <span style="color: var(--cyan); font-size: 16px;">⚡</span> Smart paste
          </div>
          <div class="trade-section-subtitle">Paste alert text to fill the flow.</div>
        </div>
      </div>
      <div class="trade-section-body" style="padding-top: 4px;">
        <div style="display:flex; gap:8px; align-items:stretch;">
          <textarea id="tf-s-paste" rows="2" class="trade-textarea" style="flex:1; min-height: 56px;" placeholder="Paste alert text here — auto-applies on paste"></textarea>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button type="button" id="tf-s-paste-apply" class="trade-template-btn" style="white-space:nowrap;">Apply</button>
          </div>
        </div>
        <div id="tf-s-paste-result" class="input-help" style="margin-top:6px; min-height:14px;"></div>
      </div>
    </div>`;

  return `
    ${smartPaste}
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Quality</div>
          <div class="trade-section-subtitle">Confirm SA rating and earnings risk.</div>
        </div>
        <div class="trade-section-counter ${passed === 4 ? 'complete' : ''}" id="tf-swing-gates-counter">${passed} of 4 passed</div>
      </div>
      <div class="trade-section-body">
        ${noTickerWarn}
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">SA Quant Rating</label>
              <div style="display: flex; gap: 12px; align-items: center;">
                <input type="number" min="1" max="5" step="0.01" class="trade-input" id="tf-sa-quant"
                  placeholder="1.00-5.00" value="${state.saQuant ?? ''}" />
                ${gateBadge('01', false)}
              </div>
              <div class="input-help">Need more than 3.50 (Buy or Strong Buy).</div>
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Days to earnings</label>
              <div style="display: flex; gap: 12px; align-items: center;">
                <input type="number" min="0" step="1" class="trade-input" id="tf-days-er"
                  placeholder="Days" value="${state.daysToEarnings ?? ''}" />
                ${gateBadge('05', false)}
              </div>
              <div class="input-help">Need more than ${minEarningsDays} days.</div>
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Profitability B- or better?</label>
              <div style="display: flex; gap: 12px; align-items: center; margin-top: 6px;">
                ${yesNoToggle('02', state.gateChecks['02'])}
                ${yesNoBadge('02', state.gateChecks['02'])}
              </div>
              <div class="input-help">Check SA Factor Grades.</div>
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Momentum B- or better?</label>
              <div style="display: flex; gap: 12px; align-items: center; margin-top: 6px;">
                ${yesNoToggle('03', state.gateChecks['03'])}
                ${yesNoBadge('03', state.gateChecks['03'])}
              </div>
              <div class="input-help">Check SA Factor Grades.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function tfMountSwingStep2() {
  // Smart paste — mirror intraday. Apply on paste event or click. After
  // apply, walk forward to the furthest step that's now complete so the
  // user lands on the first step that still needs work.
  const pasteEl = document.getElementById('tf-s-paste');
  const pasteBtn = document.getElementById('tf-s-paste-apply');
  const resultEl = document.getElementById('tf-s-paste-result');
  const applyPaste = (text) => {
    const raw = (text || '').trim();
    if (!raw) {
      if (resultEl) resultEl.textContent = '';
      return;
    }
    const parsed = tfParseSwingPaste(raw) || {};
    const isFilled = (v) => v !== undefined && v !== null && v !== '' && (typeof v !== 'object' || (v && Object.keys(v).length));
    const meaningful = Object.entries(parsed).filter(([, v]) => isFilled(v));
    if (!meaningful.length) {
      if (resultEl) {
        resultEl.style.color = 'var(--amber)';
        resultEl.textContent = 'No recognized labels found.';
      }
      return;
    }
    tfApplySwingPaste(parsed);
    // Walk forward: jump to the first incomplete step (cap at last step).
    const compl = tfStepCompletion();
    const max = tfStepCount();
    let target = 1;
    for (let i = 0; i < max; i++) {
      if (compl[i]) target = i + 2; else break;
    }
    if (target > max) target = max;
    state.tradeFlow.step = target;
    saveState();
    if (resultEl) {
      resultEl.style.color = 'var(--cyan)';
      resultEl.textContent = `Filled ${meaningful.length} field${meaningful.length === 1 ? '' : 's'} → step ${target}.`;
    }
    if (pasteEl) pasteEl.value = '';
    renderTrade();
  };
  if (pasteEl) {
    pasteEl.addEventListener('paste', () => setTimeout(() => applyPaste(pasteEl.value), 30));
  }
  if (pasteBtn) {
    pasteBtn.addEventListener('click', () => applyPaste(pasteEl ? pasteEl.value : ''));
  }

  const updateGateBadge = (gateKey, isManual) => {
    const badge = document.querySelector(`#panel-trade [data-tf-gate-badge="${gateKey}"]`);
    if (badge) {
      const ok = tfEvaluateGates()[gateKey];
      const stateVal = state.gateChecks && state.gateChecks[gateKey];
      const useYesNoState = gateKey === '02' || gateKey === '03';
      const failed = useYesNoState ? stateVal === false : !isManual;
      badge.className = `trade-bracket ${ok ? 'tight' : failed ? 'wide' : 'empty'}`;
      badge.textContent = ok ? 'PASS' : failed ? 'FAIL' : 'MARK';
    }
  };

  const updateCounters = () => {
    const gates = tfEvaluateGates();
    const passed = ['01','02','03','05'].filter(k => gates[k]).length;
    const gatesCounter = document.getElementById('tf-swing-gates-counter');
    if (gatesCounter) {
      gatesCounter.classList.toggle('complete', passed === 4);
      gatesCounter.textContent = `${passed} of 4 passed`;
    }
  };

  const sa = document.getElementById('tf-sa-quant');
  if (sa) {
    sa.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      state.saQuant = isNaN(v) ? null : v;
      saveState();
      tfRefreshHeaderOnly();
      updateGateBadge('01', false);
      updateCounters();
    });
  }
  const der = document.getElementById('tf-days-er');
  if (der) {
    der.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      state.daysToEarnings = isNaN(v) ? null : v;
      saveState();
      tfRefreshHeaderOnly();
      updateGateBadge('05', false);
      updateCounters();
    });
  }

  document.querySelectorAll('#panel-trade [data-tf-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.tfToggle;
      const val = btn.dataset.val === 'yes';
      state.gateChecks[k] = val;
      if (k === '02') state.saProfitGrade = val ? 'B-' : 'C';
      if (k === '03') state.saMomentumGrade = val ? 'B-' : 'C';
      saveState();
      tfRefreshHeaderOnly();
      updateGateBadge(k, false);
      updateCounters();
      
      const group = btn.closest('.tf-dir-btns');
      if (group) {
        group.querySelectorAll('.tf-dir-btn').forEach(b => {
          const isYes = b.dataset.val === 'yes';
          const isActive = (isYes && val) || (!isYes && !val);
          b.className = `tf-dir-btn ${isActive ? (isYes ? 'active' : 'active short') : ''}`;
          if (isActive) {
            b.style.cssText = isYes 
              ? 'background:rgba(16,185,129,0.14);border-color:rgba(16,185,129,0.40);color:var(--green-bright)'
              : 'background:rgba(248,113,113,0.14);border-color:rgba(248,113,113,0.40);color:var(--red-bright)';
          } else {
            b.style.cssText = '';
          }
        });
      }
    });
  });
}

export function tfSwingLiquidityStep() {
  const isOptions = state.instrument !== 'stocks';
  const liq = state.liquidity || {};
  const gates = tfEvaluateGates();
  const liquidityInputs = [
    { key: 'stockVolPass',  label: 'Stock 30d avg volume',  rule: '>= 1,000,000' },
    { key: 'optionOIPass',  label: 'Option open interest',  rule: '>= 500' },
  ];
  const liqInputHtml = (f) => `
    <div class="trade-input-row" style="grid-template-columns: 1fr;">
      <div>
        <label class="input-label">${f.label} <span style="float:right; color:var(--ink-4); font-weight:400; font-size:10px;">need ${f.rule}</span></label>
        <div style="display:flex; gap:12px; align-items:center; margin-top:6px;">
          <div class="tf-dir-btns" style="width:140px;">
            <button class="tf-dir-btn ${liq[f.key] === true ? 'active' : ''}" data-tf-liq-toggle="${f.key}" data-val="yes" type="button"
              style="${liq[f.key] === true ? 'background:rgba(16,185,129,0.14);border-color:rgba(16,185,129,0.40);color:var(--green-bright)' : ''}">YES</button>
            <button class="tf-dir-btn ${liq[f.key] === false ? 'active short' : ''}" data-tf-liq-toggle="${f.key}" data-val="no" type="button"
              style="${liq[f.key] === false ? 'background:rgba(248,113,113,0.14);border-color:rgba(248,113,113,0.40);color:var(--red-bright)' : ''}">NO</button>
          </div>
          <div class="trade-bracket ${liq[f.key] === true ? 'tight' : liq[f.key] === false ? 'wide' : 'empty'}">${liq[f.key] === true ? 'PASS' : liq[f.key] === false ? 'FAIL' : 'MARK'}</div>
        </div>
      </div>
    </div>`;
  const visibleInputs = isOptions ? liquidityInputs : [liquidityInputs[0]];

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">C.</span> Liquidity</div>
          <div class="trade-section-subtitle">${isOptions ? 'Confirm volume and option activity.' : 'Confirm stock volume.'}</div>
        </div>
        <div class="trade-section-counter ${gates['04'] ? 'complete' : ''}" id="tf-swing-liq-counter">${gates['04'] ? 'pass' : (isOptions ? 'mark 2' : 'mark 1')}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">${visibleInputs.map(liqInputHtml).join('')}</div>
      </div>
    </div>`;
}

// ----- Swing size — entry / stop / limit -----
// Mirrors the intraday Entry, stop & limit card so both modes use the same
// mental model before review/log.

export function tfSwingStep3() {
  const isOptions = state.instrument !== 'stocks';
  const premium = state.premium;
  const swingStop    = state.swingStop;
  const swingTarget  = state.swingTarget;
  const swingQty     = state.swingQty;
  const filled = (v) => v !== null && v !== undefined && v !== '';
  const entryOk = filled(premium);
  const qtyOk = filled(swingQty);
  const reqN = [entryOk, qtyOk].filter(Boolean).length;

  const sizingHtml = (typeof tfRenderSwingSizingHtml === 'function')
    ? tfRenderSwingSizingHtml()
    : '';

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Entry, stop &amp; limit</div>
          <div class="trade-section-subtitle">Set prices and size.</div>
        </div>
        <div class="trade-section-counter required ${reqN === 2 ? 'complete' : ''}" id="tf-swing-risk-counter">${reqN === 2 ? 'ready' : `${reqN} of 2`}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">Entry Price $</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-premium" value="${premium ?? ''}" placeholder="${isOptions ? 'Avg Fill price' : 'Share entry'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">
              <span>Stop price $</span>
              <button type="button" class="tf-auto-chip" id="tf-swing-Smart-Stop">Smart-Stop</button>
            </label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-swing-stop" value="${swingStop ?? ''}" placeholder="${isOptions ? 'Take-loss fill' : 'Invalidation price'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">
              <span>Limit Price $</span>
              <button type="button" class="tf-auto-chip" id="tf-swing-Smart-Target">Smart-Limit</button>
            </label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-swing-target" value="${swingTarget ?? ''}" placeholder="${isOptions ? 'Take-profit fill' : 'Take-profit price'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">
              <span>${isOptions ? 'Contracts' : 'Shares'}</span>
              <button type="button" class="tf-auto-chip" id="tf-swing-Smart-Size">Smart-Size</button>
            </label>
            <input type="number" min="1" step="1" class="trade-input" id="tf-swing-qty" value="${swingQty ?? ''}" placeholder="Blank = smart-size" />
          </div></div>
        </div>
        <div id="tf-sizing-card" style="margin-top:14px;">${sizingHtml}</div>
      </div>
    </div>
  `;
}

export function tfMountSwingStep3() {
  // Liquidity yes/no checks — silent state writes + surgical header refresh only.
  document.querySelectorAll('#panel-trade [data-tf-liq-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.tfLiqToggle;
      const val = btn.dataset.val === 'yes';
      if (!state.liquidity) state.liquidity = { stockVolPass: null, optionOIPass: null, bid: null, ask: null, spreadPct: null };
      state.liquidity[k] = val;
      saveState();
      tfRefreshAll();
    });
  });
  // Entry / stop / target / size — surgical sizing-card updates, no rebuild.
  const wireNum = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (key === 'premium') {
        if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '' };
        state.tradeFlow.swingPremiumManual = !isNaN(v) && v > 0;
      }
      state[key] = isNaN(v) ? null : v;
      saveState();
      tfRefreshHeaderOnly();
      tfUpdateSwingSizing();
    });
  };
  wireNum('tf-premium', 'premium');
  wireNum('tf-swing-stop', 'swingStop');
  wireNum('tf-swing-target', 'swingTarget');
  wireNum('tf-swing-qty', 'swingQty');

  // AUTO stop — settings.stopPct of entry premium. Long: entry × (1 − stopPct). Short: × (1 + stopPct).
  const autoStopBtn = document.getElementById('tf-swing-Smart-Stop');
  if (autoStopBtn) {
    autoStopBtn.addEventListener('click', () => {
      const entry = Number(state.premium);
      if (!(entry > 0)) {
        if (typeof toast === 'function') toast('Enter the entry premium first.', true);
        return;
      }
      const baseStopPct = ((state.settings && state.settings.stopPct) || 50) / 100;
      const regimeMult  = (typeof getRegimeRiskMultiplier === 'function') ? getRegimeRiskMultiplier(state.regime) : 1;
      const stopPct = baseStopPct * regimeMult;
      const isShort = (state.direction || 'long').toLowerCase().startsWith('s');
      const stop = +(isShort ? entry * (1 + stopPct) : entry * (1 - stopPct)).toFixed(2);
      state.swingStop = stop;
      const el = document.getElementById('tf-swing-stop');
      if (el) el.value = stop;
      saveState();
      tfRefreshHeaderOnly();
      tfUpdateSwingSizing();
    });
  }
  // AUTO limit — entry ± N × stop distance (N = settings.targetRMultiple, default 2).
  const autoTargetBtn = document.getElementById('tf-swing-Smart-Target');
  if (autoTargetBtn) {
    autoTargetBtn.addEventListener('click', () => {
      const entry = Number(state.premium);
      const stop  = Number(state.swingStop);
      if (!(entry > 0 && stop > 0)) {
        if (typeof toast === 'function') toast('Fill entry and stop first.', true);
        return;
      }
      const targetR = Number(state.settings && state.settings.targetRMultiple) > 0
        ? Number(state.settings.targetRMultiple)
        : 2;
      const isOptions = state.instrument !== 'stocks';
      const isShort = (state.direction || 'long').toLowerCase().startsWith('s');
      const stopDist = Math.abs(entry - stop);
      if (!(stopDist > 0)) {
        if (typeof toast === 'function') toast('Stop must be different from entry.', true);
        return;
      }
      // Options: target is always above the entry premium (long-premium trade), regardless of underlying direction.
      const target = isOptions
        ? +(entry + targetR * stopDist).toFixed(2)
        : +(isShort ? entry - targetR * stopDist : entry + targetR * stopDist).toFixed(2);
      state.swingTarget = target;
      const el = document.getElementById('tf-swing-target');
      if (el) el.value = target;
      saveState();
      tfRefreshHeaderOnly();
      tfUpdateSwingSizing();
    });
  }
  // AUTO size — regime-frozen risk ÷ stop distance.
  const autoSizeBtn = document.getElementById('tf-swing-Smart-Size');
  if (autoSizeBtn) {
    autoSizeBtn.addEventListener('click', () => {
      const entry = Number(state.premium);
      const stop  = Number(state.swingStop);
      if (!(entry > 0 && stop > 0)) {
        if (typeof toast === 'function') toast('Fill entry and stop first.', true);
        return;
      }
      const isOptions = state.instrument !== 'stocks';
      const mult = isOptions ? 100 : 1;
      let riskDollars = (typeof tfComputeSwingRiskBudget === 'function')
        ? tfComputeSwingRiskBudget()
        : Math.round((Number(state.settings && state.settings.account) || DEFAULT_SETTINGS.account || 10000) * ((typeof getRiskPctForRegime === 'function') ? getRiskPctForRegime(state.regime || 'risk-on') : 0.02));
      if (state.selectedSetup === 'Edge Reversal' && typeof tfComputeSwingRiskBudget !== 'function') riskDollars = Math.round(riskDollars / 2);
      const stopDist = Math.abs(entry - stop);
      if (!(stopDist > 0)) {
        if (typeof toast === 'function') toast('Stop must be different from entry.', true);
        return;
      }
      const qty = Math.max(1, Math.floor(riskDollars / (stopDist * mult)));
      state.swingQty = qty;
      const el = document.getElementById('tf-swing-qty');
      if (el) el.value = qty;
      saveState();
      tfRefreshHeaderOnly();
      tfUpdateSwingSizing();
    });
  }
  // Bind sliders on initial render — tfUpdateSwingSizing handles rebinds after rebuilds.
  if (typeof tfBindPriceLevelSliders === 'function') tfBindPriceLevelSliders();
}

// ----- Swing step 4 — Review & log -----
// Compact confirmation card matching intraday's final review.

export function tfComputeSwingReviewPlan() {
  const isOptions = state.instrument !== 'stocks';
  const settings = state.settings || DEFAULT_SETTINGS;
  const entry = Number(state.premium);
  const atr = Number(state.atr);
  const upx = Number(state.underlyingPrice);
  const riskBudget = (typeof tfComputeSwingRiskBudget === 'function')
    ? tfComputeSwingRiskBudget()
    : Math.round((Number(settings.account) || DEFAULT_SETTINGS.account || 10000) * getRiskPctForRegime(state.regime || 'risk-on'));
  const normalizedRiskBudget = state.selectedSetup === 'Edge Reversal' && typeof tfComputeSwingRiskBudget !== 'function'
    ? Math.round(riskBudget / 2)
    : riskBudget;
  const direction = state.direction || 'long';
  const mult = isOptions ? 100 : 1;
  const stopFraction = ((settings.stopPct || (isOptions ? 50 : 5)) / 100);
  const targetR = Number(settings.targetRMultiple) > 0 ? Number(settings.targetRMultiple) : 2;

  let defaultQty = null;
  let defaultStopSell = null;
  let defaultLimitSell = null;
  let underlyingStop = null;

  // Prefer user-entered swing stop / target / qty when set; fall back to settings-derived defaults.
  const userStop   = Number(state.swingStop);
  const userTarget = Number(state.swingTarget);
  const userQty    = parseInt(state.swingQty, 10);

  if (entry > 0) {
    if (isOptions) {
      defaultStopSell  = userStop   > 0 ? userStop   : +(entry * (1 - stopFraction)).toFixed(2);
      const stopDist = Math.abs(entry - defaultStopSell);
      defaultLimitSell = userTarget > 0 ? userTarget : +(entry + targetR * stopDist).toFixed(2);
      const lossPerContract = stopDist * 100;
      const autoQty = lossPerContract > 0 ? Math.max(1, Math.floor(normalizedRiskBudget / lossPerContract)) : null;
      defaultQty = Number.isFinite(userQty) && userQty > 0 ? userQty : autoQty;
      if (atr > 0 && upx > 0) {
        const dist = atr * 1.5;
        underlyingStop = +(direction === 'short' ? upx + dist : upx - dist).toFixed(2);
      }
    } else {
      defaultStopSell  = userStop   > 0 ? userStop   : +(direction === 'short' ? entry * (1 + stopFraction) : entry * (1 - stopFraction)).toFixed(2);
      const stopDist = Math.abs(entry - defaultStopSell);
      defaultLimitSell = userTarget > 0 ? userTarget : +(direction === 'short' ? entry - targetR * stopDist : entry + targetR * stopDist).toFixed(2);
      const lossPerShare = stopDist;
      const autoQty = lossPerShare > 0 ? Math.max(1, Math.floor(normalizedRiskBudget / lossPerShare)) : null;
      defaultQty = Number.isFinite(userQty) && userQty > 0 ? userQty : autoQty;
    }
  }

  const scenarioEntry = entry;
  const qty = defaultQty;
  const stopSell = defaultStopSell;
  const limitSell = defaultLimitSell;
  const sign = !isOptions && direction === 'short' ? -1 : 1;
  const stopPL = (scenarioEntry > 0 && stopSell > 0 && qty > 0)
    ? sign * (stopSell - scenarioEntry) * mult * qty
    : null;
  const limitPL = (scenarioEntry > 0 && limitSell > 0 && qty > 0)
    ? sign * (limitSell - scenarioEntry) * mult * qty
    : null;
  const riskDollars = stopPL !== null && stopPL < 0 ? Math.round(Math.abs(stopPL)) : normalizedRiskBudget;
  const gainR = limitPL !== null && riskDollars > 0 ? limitPL / riskDollars : null;
  const lossR = stopPL !== null && riskDollars > 0 ? stopPL / riskDollars : null;

  return {
    isOptions,
    entry: scenarioEntry,
    defaultEntry: entry,
    qty,
    defaultQty,
    stopSell,
    defaultStopSell,
    limitSell,
    defaultLimitSell,
    underlyingStop,
    riskBudget: normalizedRiskBudget,
    riskDollars,
    stopPL,
    limitPL,
    lossR,
    gainR,
    mult,
  };
}

export function tfSwingStep4() {
  const isOptions = state.instrument !== 'stocks';

  const plan = tfComputeSwingReviewPlan();
  const premium = plan.entry;
  const qty = plan.qty;
  const premiumStop = plan.stopSell;
  const premiumTarget = plan.limitSell;
  const underlyingStop = plan.underlyingStop;
  const riskDollars = plan.riskDollars;
  const notes = (state.tradeFlow && state.tradeFlow.notes) || '';

  const ticker = (state.ticker || '').toUpperCase() || '—';
  const setupLabel = state.selectedSetup || '—';
  const dirRaw = state.direction || '';
  const dirLabel = dirRaw === 'short' ? 'SHORT' : dirRaw === 'long' ? 'LONG' : '—';
  const sizeUnit = isOptions ? (qty === 1 ? 'contract' : 'contracts') : (qty === 1 ? 'share' : 'shares');
  const fmtDollar = v => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : `$${Number(v).toFixed(2)}`;
  const totalCost = Number(premium) > 0 && qty > 0 ? Number(premium) * qty * plan.mult : null;
  const costText = totalCost !== null ? `$${Math.round(totalCost).toLocaleString()}` : '—';
  const setupDef = Array.isArray(TRADE_SWING_SETUPS)
    ? TRADE_SWING_SETUPS.find(s => s.id === state.selectedSetup)
    : null;
  const setupName = setupDef ? (setupDef.name || setupDef.id) : setupLabel;
  const reviewMessage = (() => {
    const entry = Number(premium);
    const stop = Number(premiumStop);
    const target = Number(premiumTarget);
    if (!(entry > 0 && stop > 0 && target > 0 && qty > 0)) return 'Verify entry, stop, target, size, and final checks before GO.';
    const risk = Math.abs(entry - stop) * qty * plan.mult;
    const reward = Math.abs(target - entry) * qty * plan.mult;
    const riskPct = Math.abs(entry - stop) / entry * 100;
    const rewardPct = Math.abs(target - entry) / entry * 100;
    return `Risking $${Math.round(risk).toLocaleString()} (${riskPct.toFixed(1)}%) to make $${Math.round(reward).toLocaleString()} (${rewardPct.toFixed(1)}%) profit with the ${setupName} setup.`;
  })();

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Review &amp; log</div>
          <div class="trade-section-subtitle">Verify the plan, then GO.</div>
        </div>
      </div>
      <div class="trade-section-body">
        <div class="trade-output" style="padding:14px 16px;">
          <div class="trade-output-main" style="font-size:14px;">
            <span style="color:var(--cyan);">${ticker}</span> · ${dirLabel} · ${setupLabel}
          </div>
          <div class="trade-output-rationale" style="font-size:12px; margin-top:6px; line-height:1.6;">
            ${reviewMessage}<br/>
            Entry <strong>${fmtDollar(premium)}</strong> · Stop <strong>${fmtDollar(premiumStop)}</strong> · Target <strong>${fmtDollar(premiumTarget)}</strong><br/>
            Size <strong>${qty || '—'} ${sizeUnit}</strong> · Total cost <strong>${costText}</strong> · Risk <strong>$${riskDollars || '—'}</strong>${isOptions && underlyingStop ? ` · Underlying stop <strong>${fmtDollar(underlyingStop)}</strong>` : ''}
          </div>
        </div>
        <div class="trade-input-row" style="grid-template-columns: 1fr; margin-top:14px;">
          <div>
            <label class="input-label">Final check notes</label>
            <textarea class="trade-textarea" id="tf-s-notes" rows="3" placeholder="Any additional notes...">${notes}</textarea>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function tfMountSwingStep4() {
  const t = document.getElementById('tf-s-notes');
  if (t) {
    t.addEventListener('input', e => {
      if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '' };
      state.tradeFlow.notes = e.target.value;
      saveState();
    });
  }
}

// ----- Intraday steps (single-screen) -----
// Four groups rendered on one page; user Tabs through every input. Layout aligned
// with the user's ThinkScript outputs so chart labels map 1:1 to fields.


export function tfNormalizeSwingSetup(raw) {
  const s = String(raw || '').toUpperCase().replace(/[_-]+/g, ' ').trim();
  if (!s) return null;
  if (/21/.test(s) && /EMA|PULL/.test(s)) return '21-EMA Pullback';
  if (/BASE|BO|BREAKOUT/.test(s) && !/RETEST/.test(s)) return 'Base Breakout';
  if (/RETEST/.test(s)) return 'Breakout Retest';
  if (/9/.test(s) && /EMA|RECLAIM/.test(s)) return '9-EMA Reclaim';
  if (/EDGE|REVERS/.test(s)) return 'Edge Reversal';
  return null;
}

export function tfParseSwingPaste(text) {
  const out = { gates: {}, liquidity: {} };
  const raw = text || '';
  const upper = raw.toUpperCase();

  const explicitTicker = raw.match(/(?:TICKER|SYMBOL|SYM)\s*(?:=|:)\s*([A-Z0-9.\s]+?)(?=\s*\||\s+[A-Z]+[=:]|$)/i);
  const firstToken = raw.trim().match(/^([A-Z]{1,6})(?=\s|$)/);
  const skipFirst = /^(REGIME|FIRE|IVR|RSMK|RVOL|STACK|SETUP|SA|LIQ)$/i;
  
  if (explicitTicker) {
    let clean = explicitTicker[1].replace(/\s+/g, '').toUpperCase();
    const optMatch = clean.match(/^\.?([A-Z]+)\d/);
    if (optMatch) clean = optMatch[1];
    out.ticker = clean.slice(0, 6);
  } else if (firstToken && !skipFirst.test(firstToken[1])) {
    out.ticker = firstToken[1].toUpperCase();
  }

  if (/\b(STOCK|SHARES?)\b/.test(upper)) out.instrument = 'stocks';
  if (/\b(OPTION|OPTIONS|CALL|PUT|CONTRACTS?)\b/.test(upper)) out.instrument = 'options';
  if (/\b(SHORT|PUT|BEARISH)\b/.test(upper)) out.direction = 'short';
  if (/\b(LONG|CALL|BULLISH)\b/.test(upper)) out.direction = out.direction || 'long';

  const setupMatch = raw.match(/\b(?:SETUP|FIRE)\s*(?:=|:)\s*([A-Z0-9 _-]+)/i);
  if (setupMatch) out.setup = tfNormalizeSwingSetup(setupMatch[1]);
  else out.setup = tfNormalizeSwingSetup(raw);

  const regimeMatch = raw.match(/\bREGIME\s*(?:=|:)\s*(RISK[-\s]?ON|NEUTRAL|RISK[-\s]?OFF)\b/i);
  if (regimeMatch) {
    const r = regimeMatch[1].toUpperCase().replace(/\s+/g, '-');
    out.regime = r === 'RISK-ON' ? 'risk-on' : r === 'RISK-OFF' ? 'risk-off' : 'neutral';
  }

  const ivr = tfReadKeyNumber(raw, ['IVR', 'IV\\s*RANK']);
  const atr = tfReadKeyNumber(raw, ['ATR']);
  const px = tfReadKeyNumber(raw, ['PX', 'PRICE', 'UNDERLYING']);
  const premium = tfReadKeyNumber(raw, ['PREM', 'PREMIUM', 'MID', 'DEBIT', 'ENTRY']);
  const quant = tfReadKeyNumber(raw, ['QUANT', 'SA\\s*QUANT']);
  const earnings = tfReadKeyNumber(raw, ['EARNINGS', 'ER', 'DTE\\s*ER']);
  if (ivr !== null) out.ivr = ivr;
  if (atr !== null) out.atr = atr;
  if (px !== null) out.underlyingPrice = px;
  if (premium !== null) out.premium = premium;
  if (quant !== null) out.saQuant = quant;
  if (earnings !== null) out.daysToEarnings = earnings;

  const stockVol = tfReadKeyNumber(raw, ['VOL', 'AVG\\s*VOL', 'STOCK\\s*VOL']);
  const optionOI = tfReadKeyNumber(raw, ['OI', 'OPEN\\s*INTEREST']);
  if (stockVol !== null) out.liquidity.stockVolPass = stockVol >= 1000000;
  if (optionOI !== null) out.liquidity.optionOIPass = optionOI >= 500;

  const strength = tfReadKeyNumber(raw, ['STRENGTH']);
  const stack = raw.match(/\bSTACK\s*(?:=|:)\s*(BULLISH|BEARISH|MIXED)\b/i);
  const rvol = tfReadKeyNumber(raw, ['RVOL']);
  const rsmkPositive = /\bRSMK\s*(?:=|:)\s*(?:\+|POS|POSITIVE|LEADER)/i.test(raw);
  if (strength !== null && strength >= 2) out.gates['03'] = true;
  if (stack && stack[1].toUpperCase() !== 'MIXED') out.gates['03'] = true;
  if (rvol !== null && rvol >= 1 && rsmkPositive) out.gates['03'] = true;

  const prof = raw.match(/\b(?:PROFITABILITY|PROFIT)\s*(?:=|:)\s*([A-F][+-]?)\b/i);
  const momo = raw.match(/\b(?:MOMENTUM|MOMO)\s*(?:=|:)\s*([A-F][+-]?)\b/i);
  if (prof) {
    out.saProfitGrade = prof[1].toUpperCase();
    if (tfGradePasses(prof[1])) out.gates['02'] = true;
  }
  if (momo) {
    out.saMomentumGrade = momo[1].toUpperCase();
    if (tfGradePasses(momo[1])) out.gates['03'] = true;
  }

  return out;
}

export function tfApplySwingPaste(parsed) {
  if (!parsed) return;
  if (parsed.ticker) state.ticker = parsed.ticker;
  if (parsed.instrument) {
    state.instrument = parsed.instrument;
    state.structure = parsed.instrument === 'stocks' ? 'stocks' : (state.structure === 'spread' ? 'spread' : 'options');
  }
  if (parsed.direction) state.direction = parsed.direction;
  if (parsed.setup) state.selectedSetup = parsed.setup;
  if (parsed.regime) state.regime = parsed.regime;
  ['ivr', 'atr', 'underlyingPrice', 'premium', 'saQuant', 'daysToEarnings', 'saProfitGrade', 'saMomentumGrade'].forEach(k => {
    if (parsed[k] !== undefined && parsed[k] !== null) state[k] = parsed[k];
  });
  if (!state.liquidity) state.liquidity = { stockVolPass: null, optionOIPass: null, bid: null, ask: null, spreadPct: null };
  Object.assign(state.liquidity, parsed.liquidity || {});
  delete state.liquidity.stockVol;
  delete state.liquidity.optionOI;
  delete state.liquidity['option' + 'Vol'];
  if (!state.gateChecks) state.gateChecks = {};
  Object.entries(parsed.gates || {}).forEach(([k, v]) => { if (v) state.gateChecks[k] = true; });
  saveState();
}

