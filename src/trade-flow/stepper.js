// Stepper: step labels, completion, header/actions render, navigation + orchestration.
// Includes mount dispatch, refresh, continue/log handlers, confirm modal.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';

function tfStepCount() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  return m === 'swing' ? 4 : 3;
}
function tfStepNames() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') return ['Quality', 'Technicals', 'Size', 'Log'];
  return ['Setup', 'Plan & Size', 'Context'];
}
function tfIsSingleScreen() {
  return true; // Both swing and intraday use single-screen layout with side rail
}

// Determine which steps are "complete" — drives the stepper checkmarks.
// Each step is "complete" when its on-screen inputs are filled. The header
// status pill is still the source of truth for "OK to fire".
function tfStepCompletion() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const c = Array(window.tfStepCount()).fill(false);

  if (m === 'swing') {
    const isOptions = state.instrument !== 'stocks';
    const gates = window.tfEvaluateGates();

    // 1 Quality — ticker plus SA Quant, factor-grade gates, and earnings gap.
    const tickerReady = !!state.ticker;
    const qualityInputsDone = (state.saQuant !== null && state.saQuant !== undefined)
                           && (state.daysToEarnings !== null && state.daysToEarnings !== undefined);
    const qualityGatesOk = gates['01'] && gates['02'] && gates['03'] && gates['05'];
    c[0] = !!(tickerReady && qualityInputsDone && qualityGatesOk);

    // 2 Technicals — direction + approved setup + IV Rank contract read.
    const ivrOk = !isOptions || (state.ivr !== null && state.ivr !== undefined && Number(state.ivr) < 70);
    c[1] = !!(c[0] && state.direction && state.selectedSetup && ivrOk);

    // 3 Size — liquidity (Gate 04) + price/stop inputs (Gate 06).
    const sizingFilled = isOptions
      ? !!(state.premium > 0 && state.atr > 0 && state.underlyingPrice > 0)
      : !!(state.premium > 0);
    c[2] = !!(c[1] && gates['04'] && gates['06'] && sizingFilled);

    // 4 Log — flips green only when the whole swing ticket is ready.
    const st = window.tfComputeStatus();
    c[3] = c[0] && c[1] && c[2] && st.tone === 'ready';
    return c;
  }

  // Intraday — single-screen render. Completion still drives the header
  // status and guardrail jump targets.
  const it = state.intraday || {};
  const settings = state.settings || DEFAULT_SETTINGS;

  // 1 Setup — ticker + direction + setup pattern (header + setup-cards body).
  const headerReady = !!(it.ticker && it.setup && it.direction);
  c[0] = headerReady;

  const isOptions = (it.instrument || 'options') !== 'stocks';
  const levelsOk = !!(headerReady && it.entry && it.stop && it.target);
  if (isOptions) {
    // 2 Plan & Size — spread comes from bid/ask; levels and quantity derive from there.
    const spreadPct = window.tfDeriveIntradaySpread();
    const spreadOk = spreadPct !== null && spreadPct !== undefined
                  && Number(spreadPct) >= 0
                  && Number(spreadPct) <= settings.intradayMaxSpreadPct;
    c[1] = !!(headerReady && spreadOk && levelsOk);
  } else {
    // Share count itself is optional because it auto-sizes from entry/stop.
    c[1] = levelsOk;
  }

  // 3 Context — guardrails pass (status not blocked).
  const st = window.tfComputeStatus();
  c[2] = c[1] && st.tone !== 'blocked';
  return c;
}

function tfRenderStepper() {
  const stepper = document.getElementById('trade-stepper');
  const mob     = document.getElementById('trade-stepper-mobile');
  if (!stepper) return;
  // Single-screen mode: hide both stepper variants. Header still shows mode
  // toggle + summary row. Status pill remains the navigation cue.
  if (window.tfIsSingleScreen()) {
    stepper.innerHTML = '';
    stepper.style.display = 'none';
    if (mob) mob.style.display = 'none';
    return;
  }
  stepper.style.display = '';
  if (mob) mob.style.display = '';
  const names = window.tfStepNames();
  const compl = window.tfStepCompletion();
  const cur = state.tradeFlow.step || 1;
  stepper.innerHTML = names.map((n, i) => {
    const idx = i + 1;
    const isComplete = compl[i];
    const isActive = idx === cur;
    const cls = isComplete ? 'complete' : isActive ? 'active' : (idx < cur ? '' : (compl.slice(0, i).every(Boolean) ? '' : 'locked'));
    const inner = isComplete ? '✓' : idx;
    return `<button class="trade-step ${cls}" data-trade-step="${idx}" type="button">
      <span class="trade-step-node">${inner}</span>
      <span class="trade-step-label">${n}</span>
    </button>`;
  }).join('');
  if (stepper.dataset.tfBound !== '1') {
    stepper.dataset.tfBound = '1';
    stepper.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-trade-step]');
      if (!btn || !stepper.contains(btn)) return;
      const target = parseInt(btn.dataset.tradeStep, 10);
      const nowCur = state.tradeFlow.step || 1;
      if (target && target !== nowCur) window.tfGoToStep(target);
    });
  }
  if (mob) {
    // Mobile stepper — mirror desktop's clickable step pills in compact form
    // so the user can skip between steps on mobile too. Replaces the older
    // static "Step N · Name · count done" text-only readout.
    const pillsHtml = names.map((n, i) => {
      const idx = i + 1;
      const isComplete = compl[i];
      const isActive = idx === cur;
      const isLocked = !isActive && !isComplete && !compl.slice(0, i).every(Boolean);
      const cls = isComplete ? 'complete' : isActive ? 'active' : isLocked ? 'locked' : '';
      const inner = isComplete ? '✓' : idx;
      return `<button class="trade-step-mobile-pill ${cls}" data-trade-step-mobile="${idx}" type="button" aria-label="Step ${idx}: ${n}${isComplete ? ' (complete)' : isActive ? ' (current)' : ''}">
        <span class="trade-step-mobile-node">${inner}</span>
        <span class="trade-step-mobile-label">${n}</span>
      </button>`;
    }).join('');
    mob.innerHTML = pillsHtml;
    if (mob.dataset.tfBound !== '1') {
      mob.dataset.tfBound = '1';
      mob.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-trade-step-mobile]');
        if (!btn || !mob.contains(btn)) return;
        const target = parseInt(btn.dataset.tradeStepMobile, 10);
        const nowCur = state.tradeFlow.step || 1;
        if (target && target !== nowCur) window.tfGoToStep(target);
      });
    }
  }
}

// ── Vertical step rail (left sidebar) ──────────────────────────
function tfRenderRail() {
  const rail = document.getElementById('trade-rail');
  const layout = document.querySelector('.trade-layout');
  if (!rail) return;
  // Both modes show the side rail — hide/show via CSS at mobile widths
  if (layout) layout.classList.remove('trade-layout--single');
  rail.style.display = '';
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const names = window.tfStepNames();
  const compl = window.tfStepCompletion();
  const cur = state.tradeFlow.step || 1;
  const accentColor = m === 'intraday' ? 'var(--magenta, #ec4899)' : 'var(--cyan)';
  const accentBg    = m === 'intraday' ? 'rgba(236,72,153,0.12)' : 'rgba(6,212,248,0.12)';
  const accentLine  = m === 'intraday' ? 'rgba(236,72,153,0.40)' : 'rgba(6,212,248,0.40)';

  rail.innerHTML = `
    <div class="trade-rail-inner">
      <div class="trade-rail-label">WIZARD · STEP ${cur}/${names.length}</div>
      <div class="trade-rail-steps">
        ${names.map((n, i) => {
          const idx = i + 1;
          const done   = compl[i];
          const active = idx === cur;
          const locked = !done && !active && !compl.slice(0, i).every(Boolean);
          const nodeStyle = active
            ? `background:${accentColor};border-color:${accentColor};color:#0a0e1a;font-weight:800;`
            : done
              ? `background:var(--green-bright);border-color:var(--green-bright);color:#0a0e1a;font-weight:800;`
              : `background:transparent;border-color:rgba(148,163,184,0.22);color:rgba(148,163,184,0.45);`;
          const labelStyle = active
            ? `color:${accentColor};font-weight:700;font-size:13px;`
            : done ? `color:#94a3b8;` : `color:rgba(148,163,184,0.45);`;
          return `<button class="trade-rail-step${active ? ' active' : done ? ' done' : locked ? ' locked' : ''}"
                    type="button" data-rail-step="${idx}">
            <span class="trade-rail-node" style="${nodeStyle}">${done ? '✓' : idx}</span>
            <span class="trade-rail-name" style="${labelStyle}">${n}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;

  if (rail.dataset.tfBound !== '1') {
    rail.dataset.tfBound = '1';
    rail.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rail-step]');
      if (!btn || !rail.contains(btn)) return;
      const target = parseInt(btn.dataset.railStep, 10);
      const nowCur = state.tradeFlow.step || 1;
      if (target && target !== nowCur) window.tfGoToStep(target);
    });
  }
}

function tfBindHeaderScroll() {
  const header = document.querySelector('#panel-trade .trade-header');
  if (!header || header.dataset.tfScrollBound === '1') return;
  header.dataset.tfScrollBound = '1';
  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    header.classList.toggle('collapsed', y > 24);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function tfRenderHeader() {
  const tickerEl = document.getElementById('trade-summary-ticker');
  const stratEl  = document.getElementById('trade-summary-strategy');
  if (!tickerEl || !stratEl) return;
  window.tfBindHeaderScroll();
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  window.tfEnsureSummaryControls(m);

  const ticker = m === 'swing' ? (state.ticker || '') : ((state.intraday && state.intraday.ticker) || '');
  const tickerInput = document.getElementById('tf-summary-ticker-input');
  if (tickerInput && document.activeElement !== tickerInput) tickerInput.value = ticker;
  window.tfUpdateTickerMemory('tf-summary-ticker-memory', ticker);

  const struct = window.tfStructureValue(m);
  document.querySelectorAll('#trade-summary-strategy [data-tf-structure]').forEach(b => {
    b.classList.toggle('active', b.dataset.tfStructure === struct);
  });
  const dir = m === 'intraday' ? ((state.intraday && state.intraday.direction) || '') : (state.direction || '');
  document.querySelectorAll('#trade-summary-strategy [data-tf-summary-dir]').forEach(b => {
    b.classList.toggle('selected', b.dataset.tfSummaryDir === dir);
  });

  window.tfUpdateSummaryStatus();
  // Mode toggle highlight
  document.querySelectorAll('#panel-trade [data-trade-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.tradeMode === m);
  });
  // Mode-tinted accent on the trade panel (swing = cyan, intraday = magenta)
  const panel = document.getElementById('panel-trade');
  if (panel) panel.classList.toggle('intraday-mode', m === 'intraday');

  // Update trade hero section
  const heroEyebrow = document.getElementById('trade-hero-eyebrow');
  const heroModeLabel = document.getElementById('trade-hero-mode-label');
  const heroHeading = document.getElementById('trade-hero-heading');
  const heroSub = document.getElementById('trade-hero-sub');
  if (heroEyebrow) {
    heroEyebrow.className = `trade-hero-eyebrow ${m}`;
    const dot = heroEyebrow.querySelector('span');
    if (dot) {
      dot.style.background = m === 'intraday' ? 'var(--magenta, #ec4899)' : 'var(--cyan)';
      dot.style.boxShadow = `0 0 6px ${m === 'intraday' ? 'var(--magenta, #ec4899)' : 'var(--cyan)'}`;
    }
  }
  if (heroModeLabel) heroModeLabel.textContent = m === 'intraday' ? 'INTRADAY MODE' : 'SWING MODE';
  if (heroHeading) {
    const ticker = m === 'swing' ? (state.ticker || '') : ((state.intraday && state.intraday.ticker) || '');
    const accentColor = m === 'intraday' ? 'var(--magenta, #ec4899)' : 'var(--cyan)';
    heroHeading.innerHTML = ticker
      ? (m === 'swing'
          ? `Build a swing on <span style="color:${accentColor}">${ticker}</span>.`
          : `Take an intraday on <span style="color:${accentColor}">${ticker}</span>.`)
      : (m === 'swing' ? 'Build a swing trade.' : 'Take an intraday trade.');
  }
  if (heroSub) {
    heroSub.textContent = m === 'swing'
      ? 'Hold target 3–10 days · max 4 swings open · risk 0.5% / trade.'
      : 'Same-day exit · max 2 intraday open · cut by 15:55 ET.';
  }
}

function tfRenderActions() {
  const backBtn = document.getElementById('trade-back-btn');
  const contBtn = document.getElementById('trade-continue-btn');
  const contLbl = document.getElementById('trade-continue-label');
  const reasonEl = document.getElementById('trade-action-reason');
  if (!backBtn || !contBtn) return;
  const cur = state.tradeFlow.step || 1;
  const max = window.tfStepCount();
  const compl = window.tfStepCompletion();
  const st = window.tfComputeStatus();
  if (reasonEl) reasonEl.textContent = '';

  // Single-screen (intraday): just GO. Back leaves the panel.
  if (window.tfIsSingleScreen()) {
    backBtn.disabled = false;
    backBtn.textContent = '← Home';
    contBtn.classList.add('go');
    contLbl.textContent = 'GO';
    contBtn.disabled = st.tone !== 'ready';
    return;
  }

  // Swing — paginated. Step 1's Back goes Home; later steps go back a step.
  backBtn.disabled = false;
  backBtn.textContent = cur <= 1 ? '← Home' : 'Back';

  const isLast = cur >= max;
  if (isLast) {
    contBtn.classList.add('go');
    contLbl.textContent = 'GO';
    contBtn.disabled = st.tone !== 'ready';
  } else {
    contBtn.classList.remove('go');
    contLbl.textContent = 'Continue';
    const stepOk = compl.slice(0, cur).every(Boolean);
    contBtn.disabled = !stepOk;
  }
}

function tfGoToStep(n) {
  // Both modes are single-screen — scroll to the section group anchor.
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const prefix = m === 'swing' ? 'tf-s-group' : 'tf-i-group';
  const target = document.getElementById(`${prefix}-${n}`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.remove('tf-flash');
    void target.offsetWidth;
    target.classList.add('tf-flash');
    const focusable = target.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    if (focusable) { try { focusable.focus({ preventScroll: true }); } catch(_) {} }
  }
  // Track step for rail highlight without re-rendering the whole body.
  const max = window.tfStepCount();
  state.tradeFlow.step = Math.max(1, Math.min(max, n));
  saveState();
  window.tfRenderRail();
}

function tfSetMode(mode) {
  if (mode !== 'swing' && mode !== 'intraday') return;
  if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
  state.tradeFlow.mode = mode;
  state.tradeFlow.step = 1;
  saveState();
  window.renderTrade();
}

function tfFocusSmartPaste() {
  const mode = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const focusPaste = () => {
    const id = mode === 'intraday' ? 'tf-i-paste' : 'tf-s-paste';
    const panelId = mode === 'intraday' ? 'tf-i-paste-panel' : 'tf-s-paste-panel';
    const panel = document.getElementById(panelId);
    if (panel) panel.hidden = false;
    const input = document.getElementById(id);
    if (!input) return;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => {
      try { input.focus({ preventScroll: true }); } catch (_) {}
    });
  };

  if (mode === 'swing' && (state.tradeFlow.step || 1) !== 1) {
    state.tradeFlow.step = 1;
    saveState();
    window.renderTrade();
    requestAnimationFrame(focusPaste);
    return;
  }

  focusPaste();
}

function tfReset() {
  const doReset = () => {
    const m = state.tradeFlow.mode;
    state.selectedSetup = null;
    if (m === 'swing') {
      state.ticker = '';
      state.direction = null;
      state.structure = 'options';
      state.instrument = 'options';
      state.ivr = null;
      state.saProfitGrade = '';
      state.saMomentumGrade = '';
      state.premium = null;
      state.atr = null;
      state.underlyingPrice = null;
      state.gateChecks = {};
      state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
      state.tradeFlow.swingPremiumManual = false;
    } else {
      state.intraday = newIntradayTicket();
      state.intradayQuality = { timeOverride: false };
    }
    state.tradeFlow.step = 1;
    state.tradeFlow.thesis = '';
    state.tradeFlow.preMortem = '';
    state.tradeFlow.intradayDraft = {};
    state.tradeFlow.moonshotR = 3;
    saveState();
    window.renderTrade();
  };
  window.tfShowConfirm({
    title: 'Reset trade?',
    okLabel: 'Clear fields',
    bodyHtml: '<p style="margin:0;">Clear all current analysis fields? Your trade log is unchanged.</p>',
    onConfirm: doReset,
  });
}

// ============== Step body renderers ==============

function tfStepBody(step) {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const names = window.tfStepNames();
  // Single-screen for both modes: wrap each section in a group anchor div.
  if (m === 'swing') {
    const wrap = (idx, html) => `
      <div class="trade-step-group" id="tf-s-group-${idx + 1}">
        <div class="trade-step-group-eyebrow"><span>${idx + 1}</span> ${names[idx]}</div>
        ${html}
      </div>`;
    return wrap(0, window.tfSwingStep2())
         + wrap(1, window.tfSwingStep1() + window.tfSwingContractSpecHtml())
         + wrap(2, window.tfSwingStep3())
         + wrap(3, window.tfSwingStep4());
  }
  // Intraday — single screen.
  const wrap = (idx, html) => `
    <div class="trade-step-group" id="tf-i-group-${idx + 1}">
      <div class="trade-step-group-eyebrow"><span>${idx + 1}</span> ${names[idx]}</div>
      ${html}
    </div>`;
  const planAndSize = window.tfIntradayStep2() + window.tfIntradayStep3();
  return wrap(0, window.tfIntradayStep1())
       + wrap(1, planAndSize)
       + wrap(2, window.tfIntradayStep4());
}

// ----- Swing technicals — pick one of 5 approved patterns -----
// Ticker, direction, and structure live in the sticky header. This screen is
// the chart/setup picker after the quality gates pass.

function tfMountStep(step) {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') {
    // Single-screen — every section is in the DOM, mount all of them.
    window.tfMountSwingStep2();
    window.tfMountSwingStep1();
    window.tfMountSwingContractSpec();
    window.tfMountSwingStep3();
    window.tfMountSwingStep4();
    return;
  }
  window.tfMountIntradayStep1();
  window.tfMountIntradayStep2();
  window.tfMountIntradayStep3();
  window.tfMountIntradayStep4();
}

function tfRefreshHeaderOnly() {
  window.tfRenderHeader();
  window.tfRenderStepper();
  window.tfRenderActions();
}

function tfRefreshAll() {
  // Re-renders step body too. Use only when input focus isn't an issue.
  window.renderTrade();
}

function tfContinue() {
  // Both modes are single-screen — GO button logs the trade.
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') window.tfLogSwingDirect();
  else               window.tfLogIntradayDirect();
}

// Styled confirm dialog. `bodyHtml` is trusted markup we build ourselves —
// not user input — so innerHTML is safe here. Calls onConfirm() if user
// clicks Confirm, drops if user cancels.
function tfShowConfirm({ title = 'Confirm', okLabel = 'Confirm', bodyHtml = '', onConfirm }) {
  const modal = document.getElementById('modal-tf-confirm');
  if (!modal) { if (onConfirm) onConfirm(); return; }
  document.getElementById('tf-confirm-title').textContent = title;
  document.getElementById('tf-confirm-body').innerHTML = bodyHtml;
  const okBtn = document.getElementById('tf-confirm-ok');
  okBtn.textContent = okLabel;

  const cancel = document.getElementById('tf-confirm-cancel');
  const xBtn   = document.getElementById('tf-confirm-x');

  // Replace the click handlers via clone so prior bindings don't pile up.
  const fresh = (el) => { const c = el.cloneNode(true); el.parentNode.replaceChild(c, el); return c; };
  const newOk = fresh(okBtn);
  const newCancel = fresh(cancel);
  const newX = fresh(xBtn);

  const close = () => modal.classList.remove('show');
  newOk.addEventListener('click', () => { close(); if (onConfirm) onConfirm(); });
  newCancel.addEventListener('click', close);
  newX.addEventListener('click', close);

  modal.classList.add('show');
  // Move focus to the OK button so Enter confirms, Esc cancels (browsers'
  // default behavior on dialogs).
  setTimeout(() => { try { newOk.focus(); } catch (_) {} }, 30);
}

// Build a swing trade record from current flow state and log it. Confirms
// first so the user can spot a wrong number before it lands in the journal.
function tfLogSwingDirect() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = state.instrument !== 'stocks';
  const reviewPlan = (typeof window.tfComputeSwingReviewPlan === 'function') ? window.tfComputeSwingReviewPlan() : null;
  const premium = reviewPlan ? Number(reviewPlan.entry) : Number(state.premium);
  const atr = Number(state.atr);
  const upx = Number(state.underlyingPrice);

  // Sizing: regime risk%, halved for Edge Reversal. Same math as the legacy
  // calc — we replicate it inline to avoid a dependency on the modal.
  let riskPct = (typeof getRiskPctForRegime === 'function')
    ? getRiskPctForRegime(state.regime || 'risk-on') : 0.02;
  if (state.selectedSetup === 'Edge Reversal') riskPct = riskPct / 2;
  let riskDollars = settings.account * riskPct;
  const stopFraction = (settings.stopPct || 50) / 100;
  const targetFraction = (settings.targetPct || 50) / 100;
  let contracts = reviewPlan && reviewPlan.qty ? reviewPlan.qty : 1;
  let stopPrice = null;
  let targetPrice = null;
  let stopUnderlying = null;
  let stopSell = null;
  if (isOptions) {
    const maxLossPerContract = premium * stopFraction * 100;
    if (!reviewPlan || !reviewPlan.qty) contracts = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerContract)));
    stopSell = reviewPlan ? reviewPlan.stopSell : +(premium * (1 - stopFraction)).toFixed(2);
    targetPrice = reviewPlan ? reviewPlan.limitSell : +(premium * (1 + targetFraction)).toFixed(2);
    if (atr > 0 && upx > 0) {
      const dist = atr * 1.5;
      stopUnderlying = +(state.direction === 'short' ? upx + dist : upx - dist).toFixed(2);
    }
  } else {
    const maxLossPerShare = premium * stopFraction;
    if (!reviewPlan || !reviewPlan.qty) contracts = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerShare)));
    stopPrice = reviewPlan ? reviewPlan.stopSell : +(state.direction === 'short' ? premium * (1 + stopFraction) : premium * (1 - stopFraction)).toFixed(2);
    targetPrice = reviewPlan ? reviewPlan.limitSell : +(state.direction === 'short' ? premium * (1 - targetFraction) : premium * (1 + targetFraction)).toFixed(2);
  }
  if (reviewPlan) riskDollars = reviewPlan.riskDollars;

  const ticker = (state.ticker || '').toUpperCase();
  const directionLabel = state.direction === 'short' ? 'Short' : 'Long';
  const regimeText = (typeof REGIME_DATA !== 'undefined' && REGIME_DATA[state.regime])
    ? REGIME_DATA[state.regime].text
    : (state.regime || 'risk-on').toUpperCase();

  if (!ticker || !state.selectedSetup || !premium || premium <= 0) {
    if (typeof toast === 'function') window.toast('Missing required field — go back and check the inputs.', true);
    return;
  }

  // Build a styled summary for the confirm modal.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const sizeLine = isOptions
    ? `${premium.toFixed(2)} premium × ${contracts} contract${contracts > 1 ? 's' : ''}`
    : `$${premium.toFixed(2)} × ${contracts} share${contracts > 1 ? 's' : ''}`;
  const thesisHtml = state.tradeFlow.thesis
    ? `<div class="tf-confirm-thesis">${esc(state.tradeFlow.thesis)}</div>`
    : `<div class="tf-confirm-thesis empty">Thesis is empty — log anyway?</div>`;
  const bodyHtml = `
    <p style="margin: 0 0 6px;">This trade will be added to the log as <strong>open</strong>.</p>
    <div class="tf-confirm-summary">
      <div class="row"><span class="k">Ticker</span><span>${esc(ticker)}</span></div>
      <div class="row"><span class="k">Setup</span><span>${esc(state.selectedSetup)}</span></div>
      <div class="row"><span class="k">Direction</span><span>${esc(directionLabel)}</span></div>
      <div class="row"><span class="k">Size</span><span>${esc(sizeLine)}</span></div>
      <div class="row"><span class="k">Risk</span><span>$${Math.round(riskDollars)} (${esc(regimeText)})</span></div>
      ${isOptions && stopSell ? `<div class="row"><span class="k">Stop sell</span><span>$${stopSell}</span></div>` : ''}
      ${stopPrice ? `<div class="row"><span class="k">Stop</span><span>$${stopPrice}</span></div>` : ''}
      ${targetPrice ? `<div class="row"><span class="k">Target</span><span>$${targetPrice}</span></div>` : ''}
      ${stopUnderlying ? `<div class="row"><span class="k">Underlying stop</span><span>$${stopUnderlying}</span></div>` : ''}
    </div>
    ${thesisHtml}
  `;

  // Capture values needed for the post-confirm path so the closure stays small.
  window.tfShowConfirm({
    title: `Log ${ticker} ${state.selectedSetup}?`,
    okLabel: 'Confirm & log',
    bodyHtml,
    onConfirm: () => window.tfLogSwingFinalize({ ticker, directionLabel, premium, contracts, isOptions, stopPrice, stopSell, targetPrice, stopUnderlying, riskDollars, regimeText }),
  });
}

function tfLogSwingFinalize({ ticker, directionLabel, premium, contracts, isOptions, stopPrice, stopSell, targetPrice, stopUnderlying, riskDollars, regimeText }) {
  const nowIso = new Date().toISOString();
  const liq = state.liquidity || {};
  const bid = Number(liq.bid);
  const ask = Number(liq.ask);
  const mid = isOptions && bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  const trade = {
    id: (typeof genTradeId === 'function') ? genTradeId() : ('s_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    mode: 'swing',
    instrument: isOptions ? 'options' : 'stocks',
    structure: state.structure || (isOptions ? 'options' : 'stocks'),
    date: new Date().toISOString().split('T')[0],
    ticker,
    setup: state.selectedSetup,
    direction: directionLabel,
    entry: premium,
    contracts,
    shares: isOptions ? null : contracts,
    ivr: (state.ivr === null || state.ivr === undefined) ? null : Number(state.ivr),
    saQuant: (state.saQuant === null || state.saQuant === undefined) ? null : Number(state.saQuant),
    saProfitGrade: state.saProfitGrade || null,
    saMomentumGrade: state.saMomentumGrade || null,
    bid: isOptions ? (liq.bid ?? null) : null,
    ask: isOptions ? (liq.ask ?? null) : null,
    mid,
    spreadPct: isOptions ? window.deriveSpreadPct(liq) : null,
    regime: regimeText,
    thesis: state.tradeFlow.thesis || '',
    premortem: state.tradeFlow.preMortem || '',
    stop: isOptions ? (stopSell || null) : stopPrice,
    stopUnderlying: isOptions ? (stopUnderlying || null) : null,
    target: targetPrice,
    riskDollars,
    status: 'open',
    exit: null, exit_date: null, grade: null, followed_plan: null,
    emotion: null, exit_reason: null, lesson: null,
    created_at: nowIso, updated_at: nowIso,
  };

  if (!Array.isArray(state.trades)) state.trades = [];
  state.trades.push(trade);
  saveState();
  // Trades are too important to wait the 1.5s debounce — push right now.
  if (typeof doPush === 'function') {
    if (typeof SYNC !== 'undefined' && SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }

  // Reset the flow and bounce the user to Home so they see the new trade.
  if (typeof resetFlowSilent === 'function') window.resetFlowSilent();
  state.tradeFlow.step = 1;
  state.tradeFlow.thesis = '';
  state.tradeFlow.preMortem = '';
  saveState();
  if (typeof toast === 'function') window.toast(`Logged ${ticker} ${state.selectedSetup || ''}`);
  if (typeof renderHome === 'function') window.renderHome();
  if (typeof renderLogStats === 'function') window.renderLogStats();
  if (typeof renderLogTable === 'function') window.renderLogTable();
  if (typeof setTab === 'function') window.setTab('home');
}

// Wrap the existing intraday logger with a styled confirm prompt, then reset
// the flow's step pointer afterward.
function tfLogIntradayDirect() {
  const it = state.intraday || {};
  const ticker = (it.ticker || '').toUpperCase();
  const st = window.tfComputeStatus();
  if (st.tone !== 'ready') {
    if (typeof toast === 'function') window.toast(st.reason || 'Intraday ticket is not ready yet.', true);
    return;
  }
  if (!ticker || !it.setup || !it.entry || !it.stop || !it.target) {
    if (typeof toast === 'function') window.toast('Missing required field — go back and check.', true);
    return;
  }
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const setupDef   = TRADE_INTRADAY_SETUPS.find(s => s.id === it.setup) || null;
  const setupLabel = setupDef ? setupDef.name : it.setup;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const dir = (it.direction || '').toUpperCase();
  const orRow = (setupDef && setupDef.isOrb && (it.orHi || it.orLo || it.orRng))
    ? `<div class="row"><span class="k">OR (${esc(it.orbType || '30')}-min)</span><span>HI ${esc(it.orHi || '—')} · LO ${esc(it.orLo || '—')} · RNG ${esc(it.orRng || '—')}</span></div>`
    : '';
  const confluenceLabel = ((TRADE_CONFLUENCE_OPTIONS.find(c => c.id === it.confluence) || {}).label) || '';
  const breadthLabel    = ((TRADE_BREADTH_OPTIONS.find(b => b.id === it.breadth) || {}).label) || '';
  const ctxRow = (confluenceLabel || breadthLabel || it.vwapValue)
    ? `<div class="row"><span class="k">Context</span><span>${[
        confluenceLabel,
        breadthLabel,
        it.vwapValue ? `VWAP ${esc(it.vwapValue)}` : ''
      ].filter(Boolean).map(esc).join(' · ') || '—'}</span></div>`
    : '';
  const optionRows = isOptions ? `
      <div class="row"><span class="k">Bid / Ask</span><span>${it.bid ? '$' + esc(it.bid) : '—'} / ${it.ask ? '$' + esc(it.ask) : '—'}${it.mid ? ` · mid $${esc(it.mid)}` : ''}</span></div>
      <div class="row"><span class="k">Spread</span><span>${it.spreadPct != null ? esc(it.spreadPct) + '%' : '—'}</span></div>
      <div class="row"><span class="k">Contracts</span><span>${it.contracts ? esc(it.contracts) : 'auto'}</span></div>`
    : `<div class="row"><span class="k">Shares</span><span>${it.contracts ? esc(it.contracts) : 'auto'}</span></div>`;
  const bodyHtml = `
    <p style="margin: 0 0 6px;">This intraday trade will be added to the log as <strong>open</strong>.</p>
    <div class="tf-confirm-summary">
      <div class="row"><span class="k">Ticker</span><span>${esc(ticker)}</span></div>
      <div class="row"><span class="k">Instrument</span><span>${isOptions ? 'Options' : 'Stock'}</span></div>
      <div class="row"><span class="k">Setup</span><span>${esc(setupLabel)}</span></div>
      <div class="row"><span class="k">Direction</span><span>${esc(dir)}</span></div>
      <div class="row"><span class="k">Entry</span><span>$${esc(it.entry)}</span></div>
      <div class="row"><span class="k">Stop</span><span>$${esc(it.stop)}</span></div>
      <div class="row"><span class="k">Target</span><span>$${esc(it.target)}</span></div>
      ${optionRows}
      ${orRow}
      ${ctxRow}
    </div>
  `;
  window.tfShowConfirm({
    title: `Log ${ticker} ${setupLabel}?`,
    okLabel: 'Confirm & log',
    bodyHtml,
    onConfirm: () => {
      if (typeof logIntradayTrade !== 'function') {
        if (typeof toast === 'function') window.toast('Intraday logging is unavailable.', true);
        return;
      }
      window.logIntradayTrade();
      state.tradeFlow.step = 1;
      saveState();
      if (typeof setTab === 'function') window.setTab('home');
    },
  });
}

// One-time wiring for the static buttons inside #panel-trade. The header,
// stepper, and step body all re-render through renderTrade(), but these
// controls live in the static markup so they only need to be bound once.
function tfBindTradePanelStaticOnce() {
  const panel = document.getElementById('panel-trade');
  if (!panel || panel.dataset.tfStaticBound === '1') return;
  panel.dataset.tfStaticBound = '1';

  panel.querySelectorAll('[data-trade-mode]').forEach(b => {
    b.addEventListener('click', () => window.tfSetMode(b.dataset.tradeMode));
  });

  document.getElementById('trade-reset-btn')?.addEventListener('click', () => window.tfReset());
  document.getElementById('trade-smart-paste-btn')?.addEventListener('click', () => window.tfFocusSmartPaste());
  document.getElementById('trade-hero-paste-btn')?.addEventListener('click', () => window.tfFocusSmartPaste());

  document.getElementById('trade-back-btn')?.addEventListener('click', () => {
    const cur = (state.tradeFlow && state.tradeFlow.step) || 1;
    if (window.tfIsSingleScreen() || cur <= 1) {
      if (typeof window.setTab === 'function') window.setTab('home');
    } else {
      window.tfGoToStep(cur - 1);
    }
  });

  document.getElementById('trade-continue-btn')?.addEventListener('click', () => window.tfContinue());

  document.getElementById('trade-summary-status-cell')?.addEventListener('click', e => {
    const cell = e.currentTarget;
    if (!cell.classList.contains('clickable')) return;
    const step = parseInt(cell.dataset.tfStatusStep, 10);
    if (step) window.tfGoToStep(step);
  });
}

// Mobile-only top progress bar (hidden on desktop via CSS)
function tfRenderMobileProgress() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const names  = window.tfStepNames();
  const compl  = window.tfStepCompletion();
  const done   = compl.filter(Boolean).length;
  const total  = names.length;
  const accent = m === 'intraday' ? 'var(--magenta,#ec4899)' : 'var(--cyan)';
  const segs   = names.map((_, i) => {
    const color = compl[i] ? 'var(--green-bright)' : (i === done ? accent : 'rgba(255,255,255,0.1)');
    return `<div class="tf-mob-seg" style="background:${color}"></div>`;
  }).join('');
  return `<div class="tf-mob-progress">
    <span class="tf-mob-label">STEP ${done}/${total} · ${m.toUpperCase()} MODE</span>
    <div class="tf-mob-segs">${segs}</div>
  </div>`;
}

// Scrollspy — keeps the rail highlight in sync as the user scrolls the page.
// Observes each step-group anchor and updates state.tradeFlow.step + re-renders
// the rail whenever the active group changes.
function tfBindScrollObserver() {
  if (window._tfScrollObs) { window._tfScrollObs.disconnect(); window._tfScrollObs = null; }
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const prefix = m === 'swing' ? 'tf-s-group' : 'tf-i-group';
  const count = window.tfStepCount();
  const groups = [];
  for (let i = 1; i <= count; i++) {
    const el = document.getElementById(`${prefix}-${i}`);
    if (el) groups.push({ el, idx: i });
  }
  if (!groups.length) return;

  let saveT = null;
  const recalc = () => {
    const cut = window.innerHeight * 0.35;
    let cur = groups[0].idx;
    for (const { el, idx } of groups) {
      if (el.getBoundingClientRect().top <= cut) cur = idx;
    }
    if (cur !== (state.tradeFlow.step || 1)) {
      state.tradeFlow.step = cur;
      window.tfRenderRail();
      if (saveT) clearTimeout(saveT);
      saveT = setTimeout(() => { saveState(); saveT = null; }, 400);
    }
  };

  window._tfScrollObs = new IntersectionObserver(recalc, {
    rootMargin: '-5% 0px -55% 0px',
    threshold: 0,
  });
  groups.forEach(({ el }) => window._tfScrollObs.observe(el));
}

// Top-level orchestrator: header + stepper + step body + actions, plus the
// step-body mount that wires every dynamic input. Every state mutation in the
// trade flow funnels back through here.
function tfRenderTickerCard() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const ticker  = m === 'swing' ? (state.ticker || '') : ((state.intraday && state.intraday.ticker) || '');
  const dir     = m === 'intraday' ? ((state.intraday && state.intraday.direction) || '') : (state.direction || '');
  const sa      = state.saQuant || {};
  const quant   = parseFloat(sa.quant || 0);
  const bias    = quant > 0 ? Math.round((quant / 5) * 100) : null;
  const sector  = sa.sector || '';
  const cap     = sa.capBracket || '';
  const meta    = [sector, cap].filter(Boolean).join(' · ');
  const accentColor = m === 'intraday' ? 'var(--magenta,#ec4899)' : 'var(--cyan)';
  const accentBg    = m === 'intraday' ? 'rgba(236,72,153,0.14)' : 'rgba(6,212,248,0.14)';
  const accentLine  = m === 'intraday' ? 'rgba(236,72,153,0.40)' : 'rgba(6,212,248,0.40)';

  const biasHtml = bias !== null ? `
    <div class="tf-bias-wrap">
      <span class="tf-card-lbl">BIAS SCORE</span>
      <div class="tf-bias-row">
        <div class="tf-bias-track"><div class="tf-bias-fill" style="width:${bias}%;background:${accentColor}"></div></div>
        <span class="tf-bias-val" style="color:${accentColor}">${bias}</span>
      </div>
    </div>` : '';

  const instrumentHtml = m === 'swing' ? (() => {
    const struct = state.structure || state.instrument || 'options';
    const isStock = struct === 'stocks';
    return `<div class="tf-pill-section">
      <span class="tf-card-lbl">INSTRUMENT</span>
      <div class="tf-dir-btns">
        <button class="tf-struct-btn${isStock?' active':''}" data-tf-struct="stocks" type="button"
          style="${isStock?'background:'+accentBg+';border-color:'+accentLine+';color:'+accentColor:''}">STOCK</button>
        <button class="tf-struct-btn${!isStock?' active':''}" data-tf-struct="options" type="button"
          style="${!isStock?'background:'+accentBg+';border-color:'+accentLine+';color:'+accentColor:''}">OPTION</button>
      </div>
    </div>`;
  })() : '';

  return `
    <div class="tf-ticker-card">
      <div class="tf-ticker-card-hdr">
        <span class="tf-card-lbl">TICKER${meta ? ' · <span class="tf-ticker-meta-inline">'+meta+'</span>' : ''}</span>
        <span class="tf-card-hint">ENTER OR PASTE</span>
      </div>
      <div class="tf-ticker-input-row">
        <input class="tf-ticker-main-input" id="tf-ticker-card-input"
          type="text" value="${ticker}" placeholder="—"
          autocomplete="off" spellcheck="false" maxlength="10"
          style="${ticker ? 'color:'+accentColor : ''}">
      </div>
      ${biasHtml}
      <div class="tf-pill-row">
        <div class="tf-pill-section">
          <span class="tf-card-lbl">DIRECTION</span>
          <div class="tf-dir-btns">
            <button class="tf-dir-btn${dir==='long'?' active':''}" data-tf-dir="long" type="button"
              style="${dir==='long'?'background:'+accentBg+';border-color:'+accentLine+';color:'+accentColor:''}">LONG</button>
            <button class="tf-dir-btn${dir==='short'?' active short':''}" data-tf-dir="short" type="button"
              style="${dir==='short'?'background:rgba(248,113,113,0.14);border-color:rgba(248,113,113,0.4);color:var(--red-bright)':''}">SHORT</button>
          </div>
        </div>
        ${instrumentHtml}
      </div>
    </div>`;
}

function tfMountTickerCard() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const inp = document.getElementById('tf-ticker-card-input');
  if (inp) {
    inp.addEventListener('input', () => {
      const v = inp.value.toUpperCase();
      inp.value = v;
      if (m === 'intraday') { if (!state.intraday) state.intraday = {}; state.intraday.ticker = v; }
      else { state.ticker = v; }
      window.tfRenderHeader();
    });
    inp.addEventListener('blur', () => {
      saveState();
    });
  }
  document.querySelectorAll('#trade-body [data-tf-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.tfDir;
      if (m === 'intraday') { if (!state.intraday) state.intraday = {}; state.intraday.direction = d; }
      else { state.direction = d; }
      saveState();
      window.renderTrade();
    });
  });
  document.querySelectorAll('#trade-body [data-tf-struct]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.tfStruct;
      state.structure = s;
      state.instrument = s;
      saveState();
      window.renderTrade();
    });
  });
}

function renderTrade() {
  if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
  tfBindTradePanelStaticOnce();
  const step = state.tradeFlow.step || 1;
  window.tfRenderHeader();
  window.tfRenderStepper();
  window.tfRenderRail();
  const body = document.getElementById('trade-body');
  if (body) body.innerHTML = tfRenderMobileProgress() + tfRenderTickerCard() + window.tfStepBody(step);
  window.tfMountStep(step);
  tfMountTickerCard();
  window.tfRenderActions();
  tfBindScrollObserver();
}

// setTab → kept in legacy.js (Phase 11 will move it to src/tabs.js)

window.tfBindScrollObserver = tfBindScrollObserver;
window.tfRenderMobileProgress = tfRenderMobileProgress;
window.tfStepCount = tfStepCount;
window.tfStepNames = tfStepNames;
window.tfIsSingleScreen = tfIsSingleScreen;
window.tfStepCompletion = tfStepCompletion;
window.tfRenderStepper = tfRenderStepper;
window.tfBindHeaderScroll = tfBindHeaderScroll;
window.tfRenderRail = tfRenderRail;
window.tfRenderHeader = tfRenderHeader;
window.tfRenderActions = tfRenderActions;
window.tfGoToStep = tfGoToStep;
window.tfSetMode = tfSetMode;
window.tfFocusSmartPaste = tfFocusSmartPaste;
window.tfReset = tfReset;
window.tfStepBody = tfStepBody;
window.tfMountStep = tfMountStep;
window.tfRefreshHeaderOnly = tfRefreshHeaderOnly;
window.tfRefreshAll = tfRefreshAll;
window.tfContinue = tfContinue;
window.tfShowConfirm = tfShowConfirm;
window.tfLogSwingDirect = tfLogSwingDirect;
window.tfLogSwingFinalize = tfLogSwingFinalize;
window.tfLogIntradayDirect = tfLogIntradayDirect;
window.renderTrade = renderTrade;
