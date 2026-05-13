// Swing trade flow steps 1-4 with mount handlers + paste import helpers.

import { state, getRiskPctForRegime } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS, TRADE_SWING_SETUPS } from '../config/constants.js';

function tfSwingStep1() {
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

function tfMountSwingStep1() {
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
      window.tfRefreshAll();
    });
  });
}

function tfSwingContractSpecHtml() {
  const isOptions = state.instrument !== 'stocks';
  const ivr = state.ivr;
  const dir = state.direction;
  const bracket = window.tfIvrBracket(ivr);
  const sObj = (ivr !== null && ivr !== undefined && dir && isOptions)
    ? window.getStrategyForIVR(Number(ivr), dir) : null;
  const stratOut = `<div id="tf-strategy-preview">${sObj ? window.tfRenderStrategyOutHtml(sObj) : ''}</div>`;

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
        <div class="trade-input-row">
          <div>
            <label class="input-label">IV Rank (0-100)</label>
            <input type="number" min="0" max="100" step="1" class="trade-input" id="tf-ivr"
              placeholder="IV Rank 0-100"
              value="${ivr !== null && ivr !== undefined ? ivr : ''}" />
            <div class="input-help">Cheap below 30 · Moderate 30-50 · Rich 50+ · Skip if 70+</div>
          </div>
          <div class="trade-bracket ${bracket.cls}">${bracket.text}</div>
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

function tfMountSwingContractSpec() {
  const ivrEl = document.getElementById('tf-ivr');
  if (!ivrEl) return;
  ivrEl.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    state.ivr = isNaN(v) ? null : v;
    saveState();
    window.tfRefreshHeaderOnly();
    const wrap = ivrEl.parentElement && ivrEl.parentElement.parentElement;
    if (wrap) {
      const badge = wrap.querySelector('.trade-bracket');
      if (badge) {
        const b = window.tfIvrBracket(state.ivr);
        badge.className = `trade-bracket ${b.cls}`;
        badge.textContent = b.text;
      }
    }
    window.tfUpdateSwingStrategyPreview();
  });
}

// ----- Swing quality — eligibility (SA quant, factor grades, earnings) -----
// "Quality" answers: is this name worth trading before we inspect the chart?

function tfSwingStep2() {
  const gates = window.tfEvaluateGates();
  const passed = ['01','02','03','05'].filter(k => gates[k]).length;
  const ticker = state.ticker || '';

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
              <div class="input-help">Need ≥ 3.50 (Buy or Strong Buy).</div>
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
              <div class="input-help">Need ≥ 8 days.</div>
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Profitability B- or better?</label>
              <div style="display: flex; gap: 12px; align-items: center; margin-top: 6px;">
                ${yesNoToggle('02', state.gateChecks['02'])}
                ${gateBadge('02', false)}
              </div>
              <div class="input-help">Check SA Factor Grades.</div>
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Momentum B- or better?</label>
              <div style="display: flex; gap: 12px; align-items: center; margin-top: 6px;">
                ${yesNoToggle('03', state.gateChecks['03'])}
                ${gateBadge('03', false)}
              </div>
              <div class="input-help">Check SA Factor Grades.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function tfMountSwingStep2() {
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
    const parsed = window.tfParseSwingPaste(raw) || {};
    const isFilled = (v) => v !== undefined && v !== null && v !== '' && (typeof v !== 'object' || (v && Object.keys(v).length));
    const meaningful = Object.entries(parsed).filter(([, v]) => isFilled(v));
    if (!meaningful.length) {
      if (resultEl) {
        resultEl.style.color = 'var(--amber)';
        resultEl.textContent = 'No recognized labels found.';
      }
      return;
    }
    window.tfApplySwingPaste(parsed);
    // Walk forward: jump to the first incomplete step (cap at last step).
    const compl = window.tfStepCompletion();
    const max = window.tfStepCount();
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
    window.renderTrade();
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
      const ok = window.tfEvaluateGates()[gateKey];
      badge.className = `trade-bracket ${ok ? 'tight' : 'empty'}`;
      badge.textContent = ok ? 'PASS' : (isManual ? 'MARK' : 'FAIL');
    }
  };

  const updateCounters = () => {
    const gates = window.tfEvaluateGates();
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
      window.tfRefreshHeaderOnly();
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
      window.tfRefreshHeaderOnly();
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
      window.tfRefreshHeaderOnly();
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

function tfSwingLiquidityStep() {
  const isOptions = state.instrument !== 'stocks';
  const liq = state.liquidity || {};
  const gates = window.tfEvaluateGates();
  const liquidityInputs = [
    { key: 'stockVol',  label: 'Stock 30d avg volume',  rule: '>= 1,000,000', step: '1' },
    { key: 'optionOI',  label: 'Option open interest',  rule: '>= 500',       step: '1' },
    { key: 'optionVol', label: 'Option volume today',   rule: '>= 100',       step: '1' },
  ];
  const liqInputHtml = (f) => `
    <div class="trade-input-row" style="grid-template-columns: 1fr;">
      <div>
        <label class="input-label">${f.label} <span style="float:right; color:var(--ink-4); font-weight:400; font-size:10px;">need ${f.rule}</span></label>
        <input type="number" min="0" step="${f.step}" class="trade-input" data-tf-liq="${f.key}"
          value="${liq[f.key] ?? ''}" />
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
        <div class="trade-section-counter ${gates['04'] ? 'complete' : ''}" id="tf-swing-liq-counter">${gates['04'] ? 'pass' : (isOptions ? 'fill 3' : 'fill 1')}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">${visibleInputs.map(liqInputHtml).join('')}</div>
      </div>
    </div>`;
}

// ----- Swing size — entry / stop / limit -----
// Mirrors the intraday Entry, stop & limit card so both modes use the same
// mental model before review/log.

function tfSwingStep3() {
  const isOptions = state.instrument !== 'stocks';
  const premium = state.premium;
  const swingStop    = state.swingStop;
  const swingTarget  = state.swingTarget;
  const swingQty     = state.swingQty;

  // Sizing card — surgically updated by window.tfUpdateSwingSizing().
  const sizingCard = `<div id="tf-sizing-card">${window.tfRenderSwingSizingHtml()}</div>`;
  const entryReady = premium > 0 && swingStop > 0 && swingTarget > 0;
  const entryFields = `
    <div class="trade-section-grid-2">
      <div class="trade-input-row" style="grid-template-columns: 1fr;">
        <div>
          <label class="input-label">Entry Price $</label>
          <input type="number" min="0" step="0.01" class="trade-input" id="tf-premium"
            placeholder="${isOptions ? 'Fill price' : 'Share entry'}" value="${premium ?? ''}" />
        </div>
      </div>
      <div class="trade-input-row" style="grid-template-columns: 1fr;">
        <div>
          <label class="input-label">
            <span>Stop price $</span>
            <button type="button" class="tf-auto-chip" id="tf-swing-Smart-Stop">Smart-Stop</button>
          </label>
          <input type="number" min="0" step="0.01" class="trade-input" id="tf-swing-stop"
            placeholder="${isOptions ? 'Stop fill' : 'Invalidation price'}" value="${swingStop ?? ''}" />
        </div>
      </div>
      <div class="trade-input-row" style="grid-template-columns: 1fr;">
        <div>
          <label class="input-label">
            <span>Limit Price $</span>
            <button type="button" class="tf-auto-chip" id="tf-swing-Smart-Target">Smart-Limit</button>
          </label>
          <input type="number" min="0" step="0.01" class="trade-input" id="tf-swing-target"
            placeholder="${isOptions ? 'Take-profit fill' : 'Take-profit price'}" value="${swingTarget ?? ''}" />
        </div>
      </div>
      <div class="trade-input-row" style="grid-template-columns: 1fr;">
        <div>
          <label class="input-label">
            <span>${isOptions ? 'Contracts' : 'Shares'}</span>
            <button type="button" class="tf-auto-chip" id="tf-swing-Smart-Size">Smart-Size</button>
          </label>
          <input type="number" min="1" step="1" class="trade-input" id="tf-swing-qty"
            placeholder="Blank = auto from risk" value="${swingQty ?? ''}" />
        </div>
      </div>
    </div>
    <div id="tf-swing-sizing-card" style="margin-top:14px;">${sizingCard}</div>`;

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Entry, stop &amp; limit</div>
          <div class="trade-section-subtitle">Set prices and size.</div>
        </div>
        <div class="trade-section-counter required ${entryReady ? 'complete' : ''}" id="tf-swing-risk-counter">${entryReady ? 'ready' : `${[premium > 0, swingStop > 0, swingTarget > 0].filter(Boolean).length} of 3`}</div>
      </div>
      <div class="trade-section-body">
        ${entryFields}
      </div>
    </div>
  `;
}

function tfMountSwingStep3() {
  // Liquidity inputs — silent state writes + surgical header refresh only.
  document.querySelectorAll('#panel-trade [data-tf-liq]').forEach(el => {
    el.addEventListener('input', e => {
      const k = e.target.dataset.tfLiq;
      const v = parseFloat(e.target.value);
      if (!state.liquidity) state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
      state.liquidity[k] = isNaN(v) ? null : v;
      saveState();
      window.tfUpdateSwingLiquidityCounter();
      window.tfUpdateSwingSizing();
      window.tfRefreshHeaderOnly();
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
      window.tfRefreshHeaderOnly();
      window.tfUpdateSwingSizing();
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
        if (typeof window.toast === 'function') window.toast('Enter the entry premium first.', true);
        return;
      }
      const baseStopPct = ((state.settings && state.settings.stopPct) || 50) / 100;
      const regimeMult  = (typeof window.getRegimeRiskMultiplier === 'function') ? window.getRegimeRiskMultiplier(state.regime) : 1;
      const stopPct = baseStopPct * regimeMult;
      const isShort = (state.direction || 'long').toLowerCase().startsWith('s');
      const stop = +(isShort ? entry * (1 + stopPct) : entry * (1 - stopPct)).toFixed(2);
      state.swingStop = stop;
      const el = document.getElementById('tf-swing-stop');
      if (el) el.value = stop;
      saveState();
      window.tfRefreshHeaderOnly();
      window.tfUpdateSwingSizing();
    });
  }
  // AUTO limit — entry ± N × stop distance (N = settings.targetRMultiple, default 2).
  const autoTargetBtn = document.getElementById('tf-swing-Smart-Target');
  if (autoTargetBtn) {
    autoTargetBtn.addEventListener('click', () => {
      const entry = Number(state.premium);
      const stop  = Number(state.swingStop);
      if (!(entry > 0 && stop > 0)) {
        if (typeof window.toast === 'function') window.toast('Fill entry and stop first.', true);
        return;
      }
      const targetR = Number(state.settings && state.settings.targetRMultiple) > 0
        ? Number(state.settings.targetRMultiple)
        : 2;
      const isOptions = state.instrument !== 'stocks';
      const isShort = (state.direction || 'long').toLowerCase().startsWith('s');
      const stopDist = Math.abs(entry - stop);
      // Options: target is always above the entry premium (long-premium trade), regardless of underlying direction.
      const target = isOptions
        ? +(entry + targetR * stopDist).toFixed(2)
        : +(isShort ? entry - targetR * stopDist : entry + targetR * stopDist).toFixed(2);
      state.swingTarget = target;
      const el = document.getElementById('tf-swing-target');
      if (el) el.value = target;
      saveState();
      window.tfRefreshHeaderOnly();
      window.tfUpdateSwingSizing();
    });
  }
  // AUTO size — regime-frozen risk ÷ stop distance.
  const autoSizeBtn = document.getElementById('tf-swing-Smart-Size');
  if (autoSizeBtn) {
    autoSizeBtn.addEventListener('click', () => {
      const entry = Number(state.premium);
      const stop  = Number(state.swingStop);
      if (!(entry > 0 && stop > 0)) {
        if (typeof window.toast === 'function') window.toast('Fill entry and stop first.', true);
        return;
      }
      const isOptions = state.instrument !== 'stocks';
      const mult = isOptions ? 100 : 1;
      let riskDollars = (typeof window.tfComputeSwingRiskBudget === 'function')
        ? window.tfComputeSwingRiskBudget()
        : Math.round((Number(state.settings && state.settings.account) || DEFAULT_SETTINGS.account || 10000) * ((typeof getRiskPctForRegime === 'function') ? getRiskPctForRegime(state.regime || 'risk-on') : 0.02));
      if (state.selectedSetup === 'Edge Reversal' && typeof window.tfComputeSwingRiskBudget !== 'function') riskDollars = Math.round(riskDollars / 2);
      const stopDist = Math.abs(entry - stop);
      const qty = Math.max(1, Math.floor(riskDollars / Math.max(0.01, stopDist * mult)));
      state.swingQty = qty;
      const el = document.getElementById('tf-swing-qty');
      if (el) el.value = qty;
      saveState();
      window.tfRefreshHeaderOnly();
      window.tfUpdateSwingSizing();
    });
  }
  // Bind sliders on initial render — tfUpdateSwingSizing handles rebinds after rebuilds.
  if (typeof window.tfBindPriceLevelSliders === 'function') window.tfBindPriceLevelSliders();
}

// ----- Swing step 4 — Review & log -----
// Compact confirmation card matching intraday's final review.

function tfComputeSwingReviewPlan() {
  const isOptions = state.instrument !== 'stocks';
  const settings = state.settings || DEFAULT_SETTINGS;
  const entry = Number(state.premium);
  const atr = Number(state.atr);
  const upx = Number(state.underlyingPrice);
  const riskBudget = (typeof window.tfComputeSwingRiskBudget === 'function')
    ? window.tfComputeSwingRiskBudget()
    : Math.round((Number(settings.account) || DEFAULT_SETTINGS.account || 10000) * getRiskPctForRegime(state.regime || 'risk-on'));
  const normalizedRiskBudget = state.selectedSetup === 'Edge Reversal' && typeof window.tfComputeSwingRiskBudget !== 'function'
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
      const autoQty = Math.max(1, Math.floor(normalizedRiskBudget / Math.max(0.01, lossPerContract)));
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
      const autoQty = Math.max(1, Math.floor(normalizedRiskBudget / Math.max(0.01, lossPerShare)));
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

function tfSwingStep4() {
  const isOptions = state.instrument !== 'stocks';

  const plan = window.tfComputeSwingReviewPlan();
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
            Entry <strong>${fmtDollar(premium)}</strong> · Stop <strong>${fmtDollar(premiumStop)}</strong> · Target <strong>${fmtDollar(premiumTarget)}</strong><br/>
            Size <strong>${qty || '—'} ${sizeUnit}</strong> · Risk <strong>$${riskDollars || '—'}</strong>${isOptions && underlyingStop ? ` · Underlying stop <strong>${fmtDollar(underlyingStop)}</strong>` : ''}
          </div>
        </div>
        <div class="trade-input-row" style="grid-template-columns: 1fr; margin-top:14px;">
          <div>
            <label class="input-label">Notes</label>
            <textarea class="trade-textarea" id="tf-s-notes" rows="3" placeholder="Trigger, invalidation, anything to remember">${notes}</textarea>
          </div>
        </div>
      </div>
    </div>
  `;
}

function tfMountSwingStep4() {
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


function tfNormalizeSwingSetup(raw) {
  const s = String(raw || '').toUpperCase().replace(/[_-]+/g, ' ').trim();
  if (!s) return null;
  if (/21/.test(s) && /EMA|PULL/.test(s)) return '21-EMA Pullback';
  if (/BASE|BO|BREAKOUT/.test(s) && !/RETEST/.test(s)) return 'Base Breakout';
  if (/RETEST/.test(s)) return 'Breakout Retest';
  if (/9/.test(s) && /EMA|RECLAIM/.test(s)) return '9-EMA Reclaim';
  if (/EDGE|REVERS/.test(s)) return 'Edge Reversal';
  return null;
}

function tfParseSwingPaste(text) {
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
  if (setupMatch) out.setup = window.tfNormalizeSwingSetup(setupMatch[1]);
  else out.setup = window.tfNormalizeSwingSetup(raw);

  const regimeMatch = raw.match(/\bREGIME\s*(?:=|:)\s*(RISK[-\s]?ON|NEUTRAL|RISK[-\s]?OFF)\b/i);
  if (regimeMatch) {
    const r = regimeMatch[1].toUpperCase().replace(/\s+/g, '-');
    out.regime = r === 'RISK-ON' ? 'risk-on' : r === 'RISK-OFF' ? 'risk-off' : 'neutral';
  }

  const ivr = window.tfReadKeyNumber(raw, ['IVR', 'IV\\s*RANK']);
  const atr = window.tfReadKeyNumber(raw, ['ATR']);
  const px = window.tfReadKeyNumber(raw, ['PX', 'PRICE', 'UNDERLYING']);
  const premium = window.tfReadKeyNumber(raw, ['PREM', 'PREMIUM', 'MID', 'DEBIT', 'ENTRY']);
  const quant = window.tfReadKeyNumber(raw, ['QUANT', 'SA\\s*QUANT']);
  const earnings = window.tfReadKeyNumber(raw, ['EARNINGS', 'ER', 'DTE\\s*ER']);
  if (ivr !== null) out.ivr = ivr;
  if (atr !== null) out.atr = atr;
  if (px !== null) out.underlyingPrice = px;
  if (premium !== null) out.premium = premium;
  if (quant !== null) out.saQuant = quant;
  if (earnings !== null) out.daysToEarnings = earnings;

  const stockVol = window.tfReadKeyNumber(raw, ['VOL', 'AVG\\s*VOL', 'STOCK\\s*VOL']);
  const optionOI = window.tfReadKeyNumber(raw, ['OI', 'OPEN\\s*INTEREST']);
  const optionVol = window.tfReadKeyNumber(raw, ['OVOL', 'OPT\\s*VOL', 'OPTION\\s*VOL']);
  if (stockVol !== null) out.liquidity.stockVol = stockVol;
  if (optionOI !== null) out.liquidity.optionOI = optionOI;
  if (optionVol !== null) out.liquidity.optionVol = optionVol;

  const strength = window.tfReadKeyNumber(raw, ['STRENGTH']);
  const stack = raw.match(/\bSTACK\s*(?:=|:)\s*(BULLISH|BEARISH|MIXED)\b/i);
  const rvol = window.tfReadKeyNumber(raw, ['RVOL']);
  const rsmkPositive = /\bRSMK\s*(?:=|:)\s*(?:\+|POS|POSITIVE|LEADER)/i.test(raw);
  if (strength !== null && strength >= 2) out.gates['03'] = true;
  if (stack && stack[1].toUpperCase() !== 'MIXED') out.gates['03'] = true;
  if (rvol !== null && rvol >= 1 && rsmkPositive) out.gates['03'] = true;

  const prof = raw.match(/\b(?:PROFITABILITY|PROFIT)\s*(?:=|:)\s*([A-F][+-]?)\b/i);
  const momo = raw.match(/\b(?:MOMENTUM|MOMO)\s*(?:=|:)\s*([A-F][+-]?)\b/i);
  if (prof) {
    out.saProfitGrade = prof[1].toUpperCase();
    if (window.tfGradePasses(prof[1])) out.gates['02'] = true;
  }
  if (momo) {
    out.saMomentumGrade = momo[1].toUpperCase();
    if (window.tfGradePasses(momo[1])) out.gates['03'] = true;
  }

  return out;
}

function tfApplySwingPaste(parsed) {
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
  if (!state.liquidity) state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
  Object.assign(state.liquidity, parsed.liquidity || {});
  if (!state.gateChecks) state.gateChecks = {};
  Object.entries(parsed.gates || {}).forEach(([k, v]) => { if (v) state.gateChecks[k] = true; });
  saveState();
}

// Smart paste — parses TOS alert text from the user's MAC_Intraday_*
// scripts. Each regex matches one of the labels those studies emit.

// Dev utility — populate the swing flow with realistic random data so the
// rest of the UI can be exercised without typing every field.
function tfDemoFillSwing() {
  const tickers = ['AAPL','MSFT','NVDA','TSLA','META','AMZN','AMD','AVGO','COIN'];
  const setups = ['21-EMA Pullback','Base Breakout','Breakout Retest','9-EMA Reclaim'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (min, max, dec = 2) => +(min + Math.random() * (max - min)).toFixed(dec);
  const isOptions = Math.random() < 0.7;
  const dir = Math.random() < 0.7 ? 'long' : 'short';
  const upx = rand(80, 480, 2);
  state.ticker = pick(tickers);
  state.direction = dir;
  state.instrument = isOptions ? 'options' : 'stocks';
  state.structure = isOptions ? 'options' : 'stocks';
  state.selectedSetup = pick(setups);
  state.saQuant = rand(3.5, 4.8, 2);
  state.daysToEarnings = Math.floor(rand(8, 60, 0));
  state.ivr = isOptions ? Math.floor(rand(15, 65, 0)) : null;
  if (!state.gateChecks) state.gateChecks = {};
  state.gateChecks['02'] = true;
  state.gateChecks['03'] = true;
  state.underlyingPrice = upx;
  state.atr = rand(1.5, 8.5, 2);
  if (isOptions) {
    state.liquidity = {
      stockVol: Math.floor(rand(2_000_000, 50_000_000, 0)),
      optionOI: Math.floor(rand(800, 8000, 0)),
      optionVol: Math.floor(rand(200, 2000, 0)),
      bid: null,
      ask: null,
      spreadPct: null,
    };
    state.premium = rand(2.5, 7.5, 2);
  } else {
    state.liquidity = {
      stockVol: Math.floor(rand(2_000_000, 50_000_000, 0)),
      optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null,
    };
    state.premium = upx;
  }
  // Land the user on the last step so they can verify the review card.
  if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '' };
  state.tradeFlow.step = window.tfStepCount();
  saveState();
  if (typeof window.toast === 'function') window.toast('Demo trade filled');
  window.renderTrade();
}

window.tfDemoFillSwing = tfDemoFillSwing;
window.tfComputeSwingReviewPlan = tfComputeSwingReviewPlan;
window.tfSwingStep1 = tfSwingStep1;
window.tfMountSwingStep1 = tfMountSwingStep1;
window.tfSwingContractSpecHtml = tfSwingContractSpecHtml;
window.tfMountSwingContractSpec = tfMountSwingContractSpec;
window.tfSwingLiquidityStep = tfSwingLiquidityStep;
window.tfSwingStep2 = tfSwingStep2;
window.tfMountSwingStep2 = tfMountSwingStep2;
window.tfSwingStep3 = tfSwingStep3;
window.tfMountSwingStep3 = tfMountSwingStep3;
window.tfSwingStep4 = tfSwingStep4;
window.tfMountSwingStep4 = tfMountSwingStep4;
window.tfNormalizeSwingSetup = tfNormalizeSwingSetup;
window.tfParseSwingPaste = tfParseSwingPaste;
window.tfApplySwingPaste = tfApplySwingPaste;
