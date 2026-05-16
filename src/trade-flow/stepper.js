// Stepper: step labels, completion, header/actions render, navigation + orchestration.
// Includes mount dispatch, refresh, continue/log handlers, confirm modal.

import { tfEvaluateGates, tfComputeStatus } from './gates.js';
import { tfDeriveIntradaySpread, tfComputeIntradayRiskSize, tfIntradayInstrument, tfSetIntradayStructure } from './intraday-sizing.js';
import { TRADE_SWING_SETUPS } from '../config/constants.js';
import { tfComputeSwingRiskBudget, tfSetSwingStructure } from './swing-sizing.js';
import { tfSwingStep2, tfSwingStep1, tfSwingContractSpecHtml, tfSwingLiquidityStep, tfSwingStep3, tfSwingStep4, tfMountSwingStep2, tfMountSwingStep1, tfMountSwingContractSpec, tfMountSwingStep3, tfMountSwingStep4, tfComputeSwingReviewPlan } from './swing-steps.js';
import { tfIntradayStep1, tfIntradayStep2, tfIntradayStep4, tfMountIntradayStep1, tfMountIntradayStep2, tfMountIntradayStep3, tfMountIntradayStep4 } from './intraday-steps.js';
import { toast } from '../modals/toast.js';
import { buildTradeFlowEdgeIntel, renderLogStats } from '../intel/alpha.js';
import { resetFlowSilent } from '../modals/trade-modal.js';
import { renderHome } from '../views/home.js';
import { renderLogTable } from '../views/log.js';
import { setTab } from '../tabs.js';
import { logIntradayTrade } from './intraday-helpers.js';
import { tfRiskRailHtml } from './risk.js';
import { state, getRiskPctForRegime } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { genTradeId, isClosedTrade, calcPL, calcR } from '../models/trade.js';
import {
  DEFAULT_SETTINGS,
  newIntradayTicket,
  TRADE_INTRADAY_SETUPS,
  TRADE_CONFLUENCE_OPTIONS,
  TRADE_BREADTH_OPTIONS,
  REGIME_DATA
} from '../config/constants.js';

export function tfStepCount() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  return m === 'swing' ? 4 : 3;
}
export function tfStepNames() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') return ['Quality', 'Setup', 'Size', 'Review'];
  return ['Setup', 'Size', 'Review'];
}
export function tfIsSingleScreen() {
  return true; // Both swing and intraday use single-screen layout with side rail
}

// Determine which steps are "complete" — drives the stepper checkmarks.
// Each step is "complete" when its on-screen inputs are filled. The header
// status pill is still the source of truth for "OK to fire".
export function tfStepCompletion() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const c = Array(tfStepCount()).fill(false);

  if (m === 'swing') {
    const isOptions = state.instrument !== 'stocks';
    const gates = tfEvaluateGates();

    // 1 Quality — ticker plus SA Quant, factor-grade gates, and earnings gap.
    const tickerReady = !!state.ticker;
    const qualityInputsDone = (state.saQuant !== null && state.saQuant !== undefined)
                           && (state.daysToEarnings !== null && state.daysToEarnings !== undefined);
    const qualityGatesOk = gates['01'] && gates['02'] && gates['03'] && gates['05'];
    c[0] = !!(tickerReady && qualityInputsDone && qualityGatesOk);

    // 2 Setup — direction, setup, IVR, and liquidity/quote.
    const ivrOk = !isOptions || (state.ivr !== null && state.ivr !== undefined && Number(state.ivr) < 70);
    c[1] = !!(c[0] && state.direction && state.selectedSetup && ivrOk && gates['04']);

    // 3 Size — entry/stop/target inputs.
    const sizingFilled = !!(state.premium > 0 && state.swingStop > 0 && state.swingTarget > 0);
    c[2] = !!(c[1] && sizingFilled);

    // 4 Review — flips green only when the whole swing ticket is ready.
    const st = tfComputeStatus();
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

  const levelsOk = !!(headerReady && it.entry);
  // Plan & Size completes on entry/stop/target alone — spread (from bid/ask)
  // is informational and only blocks when a known spread exceeds the cap.
  const spreadPct = tfDeriveIntradaySpread();
  const spreadBlocks = spreadPct !== null && spreadPct !== undefined && spreadPct !== ''
    && Number(spreadPct) > settings.intradayMaxSpreadPct;
  c[1] = !!(headerReady && levelsOk && !spreadBlocks);

  // 3 Context — guardrails pass (status not blocked).
  const st = tfComputeStatus();
  c[2] = c[1] && st.tone !== 'blocked';
  return c;
}

// ── Vertical step rail (left sidebar) ──────────────────────────
export function tfRenderRail() {
  const rail = document.getElementById('trade-rail');
  const layout = document.querySelector('.trade-layout');
  if (!rail) return;
  // Both modes show the side rail — hide/show via CSS at mobile widths
  if (layout) layout.classList.remove('trade-layout--single');
  rail.style.display = '';
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const names = tfStepNames();
  const complRaw = tfStepCompletion();
  const cur = state.tradeFlow.step || 1;
  // Track visited steps so the rail only marks green for steps the user has
  // actually navigated to. The current step counts as visited.
  if (!Array.isArray(state.tradeFlow.visited) || state.tradeFlow.visited.length !== names.length) {
    state.tradeFlow.visited = Array(names.length).fill(false);
  }
  state.tradeFlow.visited[cur - 1] = true;
  const visited = state.tradeFlow.visited;
  const compl = complRaw.map((ok, i) => ok && !!visited[i]);
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
          const nodeStyle = active
            ? `background:${accentColor};border-color:${accentColor};color:#0a0e1a;font-weight:800;`
            : done
              ? `background:var(--green-bright);border-color:var(--green-bright);color:#0a0e1a;font-weight:800;`
              : `background:transparent;border-color:rgba(148,163,184,0.22);color:rgba(148,163,184,0.45);`;
          const labelStyle = active
            ? `color:${accentColor};font-weight:700;font-size:13px;`
            : done ? `color:#94a3b8;` : `color:rgba(148,163,184,0.45);`;
          return `<button class="trade-rail-step${active ? ' active' : done ? ' done' : ''}"
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
      if (target && target !== nowCur) tfGoToStep(target);
    });
  }
}

export function tfRenderHeader() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
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
          ? `Build a swing trade on <span style="color:${accentColor}">${ticker}</span>.`
          : `Build an intraday trade on <span style="color:${accentColor}">${ticker}</span>.`)
      : (m === 'swing' ? 'Build a swing trade.' : 'Build an intraday trade.');
  }
  const heroPnl = document.getElementById('trade-hero-pnl');
  if (heroPnl) {
    heroPnl.classList.toggle('swing', m === 'swing');
    heroPnl.classList.toggle('intraday', m === 'intraday');
    const p = tfComputeHeroPnl ? tfComputeHeroPnl() : null;
    if (p && p.risk > 0 && p.reward > 0) {
      let setupName = '';
      if (m === 'swing') {
        const swingId = state.selectedSetup;
        const swingDef = swingId && Array.isArray(TRADE_SWING_SETUPS)
          ? TRADE_SWING_SETUPS.find(s => s.id === swingId)
          : null;
        setupName = swingDef ? (swingDef.name || swingDef.id) : (swingId || '');
      } else {
        const setupId = state.intraday && state.intraday.setup;
        const def = setupId ? TRADE_INTRADAY_SETUPS.find(s => s.id === setupId) : null;
        setupName = def ? def.name : '';
      }
      const setupSuffix = setupName ? ` with the <span style="color:var(--cyan);font-weight:700;">${setupName}</span> setup` : '';
      heroPnl.innerHTML = `Risking <span style="color:var(--red-bright);font-weight:700;">$${Math.round(p.risk).toLocaleString()}</span> to make <span style="color:var(--green-bright);font-weight:700;">$${Math.round(p.reward).toLocaleString()}</span> profit${setupSuffix}.`;
    } else {
      heroPnl.textContent = 'Fill entry, stop, and limit to see win / loss.';
    }
  }
}

// Compute risk + reward + size for the sub-hero P/L line. Mode-aware.
export function tfComputeHeroPnl() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'intraday') {
    const it = state.intraday || {};
    const entry = Number(it.entry);
    const stop = Number(it.stop);
    const target = Number(it.target);
    if (!(entry > 0 && stop > 0 && target > 0)) return null;
    const auto = (typeof tfComputeIntradayRiskSize === 'function') ? tfComputeIntradayRiskSize() : null;
    const manualQty = Number(it.contracts);
    const qty = manualQty > 0 ? manualQty : (auto ? auto.qty : 0);
    const mult = auto ? auto.mult : ((it.instrument === 'stocks') ? 1 : 100);
    const label = auto ? auto.label : ((it.instrument === 'stocks') ? 'share' : 'contract');
    if (!(qty > 0)) return null;
    return {
      risk: Math.abs(entry - stop) * qty * mult,
      reward: Math.abs(target - entry) * qty * mult,
      qty, label,
    };
  }
  // Swing
  const premium = Number(state.premium);
  const stop = Number(state.swingStop);
  const target = Number(state.swingTarget);
  if (!(premium > 0 && stop > 0 && target > 0)) return null;
  const isOptions = state.instrument !== 'stocks';
  const mult = isOptions ? 100 : 1;
  const label = isOptions ? 'contract' : 'share';
  let riskDollars = (typeof tfComputeSwingRiskBudget === 'function')
    ? tfComputeSwingRiskBudget()
    : Math.round((Number(state.settings && state.settings.account) || DEFAULT_SETTINGS.account || 10000) * ((typeof getRiskPctForRegime === 'function') ? getRiskPctForRegime(state.regime || 'risk-on') : 0.02));
  if (state.selectedSetup === 'Edge Reversal' && typeof tfComputeSwingRiskBudget !== 'function') riskDollars = Math.round(riskDollars / 2);
  const perUnitRisk = Math.abs(premium - stop) * mult;
  const autoQty = Math.max(1, Math.floor(riskDollars / Math.max(0.01, perUnitRisk)));
  const manualQty = Number(state.swingQty);
  const qty = manualQty > 0 ? Math.max(1, Math.floor(manualQty)) : autoQty;
  return {
    risk: perUnitRisk * qty,
    reward: Math.abs(target - premium) * mult * qty,
    qty, label,
  };
}

export function tfRenderActions() {
  const backBtn = document.getElementById('trade-back-btn');
  const contBtn = document.getElementById('trade-continue-btn');
  const contLbl = document.getElementById('trade-continue-label');
  const reasonEl = document.getElementById('trade-action-reason');
  if (!backBtn || !contBtn) return;
  const cur = state.tradeFlow.step || 1;
  const max = tfStepCount();
  const compl = tfStepCompletion();
  const st = tfComputeStatus();
  if (reasonEl) reasonEl.textContent = '';

  // Single-screen (intraday): just GO. Back leaves the panel.
  if (tfIsSingleScreen()) {
    backBtn.disabled = false;
    backBtn.textContent = '← Home';
    contBtn.classList.add('go');
    contLbl.textContent = 'GO';
    contBtn.disabled = false;
    return;
  }

  // Swing — paginated. Step 1's Back goes Home; later steps go back a step.
  backBtn.disabled = false;
  backBtn.textContent = cur <= 1 ? '← Home' : 'Back';

  const isLast = cur >= max;
  if (isLast) {
    contBtn.classList.add('go');
    contLbl.textContent = 'GO';
    contBtn.disabled = false;
  } else {
    contBtn.classList.remove('go');
    contLbl.textContent = 'Continue';
    contBtn.disabled = false;
  }
}

export function tfGoToStep(n) {
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
  const max = tfStepCount();
  state.tradeFlow.step = Math.max(1, Math.min(max, n));
  // Mark visited — only steps the user has explicitly navigated to count.
  if (!Array.isArray(state.tradeFlow.visited) || state.tradeFlow.visited.length !== max) {
    state.tradeFlow.visited = Array(max).fill(false);
  }
  state.tradeFlow.visited[state.tradeFlow.step - 1] = true;
  saveState();
  tfRenderRail();
}

export function tfSetMode(mode) {
  if (mode !== 'swing' && mode !== 'intraday') return;
  if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '' };
  state.tradeFlow.mode = mode;
  state.tradeFlow.step = 1;
  saveState();
  renderTrade();
}

export function tfFocusSmartPaste() {
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
    renderTrade();
    requestAnimationFrame(focusPaste);
    return;
  }

  focusPaste();
}

export function tfReset() {
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
      state.saQuant = null;
      state.daysToEarnings = null;
      state.swingStop = null;
      state.swingTarget = null;
      state.swingQty = null;
      state.gateChecks = {};
      state.liquidity = { stockVolPass: null, optionOIPass: null, bid: null, ask: null, spreadPct: null };
      state.tradeFlow.swingPremiumManual = false;
    } else {
      state.intraday = newIntradayTicket();
      state.intradayQuality = { timeOverride: false };
    }
    state.tradeFlow.step = 1;
    state.tradeFlow.thesis = '';
    state.tradeFlow.preMortem = '';
    state.tradeFlow.notes = '';
    state.tradeFlow.swingScenario = {};
    state.tradeFlow.visited = Array(tfStepCount()).fill(false);
    state.tradeFlow.intradayDraft = {};
    saveState();
    renderTrade();
  };
  tfShowConfirm({
    title: 'Reset trade?',
    okLabel: 'Clear fields',
    bodyHtml: '<p style="margin:0;">Clear all current analysis fields? Your trade log is unchanged.</p>',
    onConfirm: doReset,
  });
}

// ============== Step body renderers ==============

export function tfStepBody(step) {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const names = tfStepNames();
  // Single-screen for both modes: wrap each section in a group anchor div.
  if (m === 'swing') {
    const wrap = (idx, html) => `
      <div class="trade-step-group" id="tf-s-group-${idx + 1}">
        <div class="trade-step-group-eyebrow"><span>${idx + 1}</span> ${names[idx]}</div>
        ${html}
      </div>`;
    return wrap(0, tfSwingStep2())
         + wrap(1, tfSwingStep1() + tfSwingContractSpecHtml() + tfSwingLiquidityStep())
         + wrap(2, tfSwingStep3())
         + wrap(3, tfSwingStep4());
  }
  // Intraday — single screen.
  const wrap = (idx, html) => `
    <div class="trade-step-group" id="tf-i-group-${idx + 1}">
      <div class="trade-step-group-eyebrow"><span>${idx + 1}</span> ${names[idx]}</div>
      ${html}
    </div>`;
  return wrap(0, tfIntradayStep1())
       + wrap(1, tfIntradayStep2())
       + wrap(2, tfIntradayStep4());
}

// ----- Swing technicals — pick one of 5 approved patterns -----
// Ticker, direction, and structure live in the sticky header. This screen is
// the chart/setup picker after the quality gates pass.

export function tfMountStep(step) {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') {
    // Single-screen — every section is in the DOM, mount all of them.
    tfMountSwingStep2();
    tfMountSwingStep1();
    tfMountSwingContractSpec();
    tfMountSwingStep3();
    tfMountSwingStep4();
    return;
  }
  tfMountIntradayStep1();
  tfMountIntradayStep2();
  tfMountIntradayStep3();
  tfMountIntradayStep4();
}

export function tfRefreshHeaderOnly() {
  tfRenderHeader();
  tfRenderActions();
}

export function tfRefreshAll() {
  // Re-renders step body too. Use only when input focus isn't an issue.
  renderTrade();
}

export function tfContinue() {
  const st = tfComputeStatus();
  if (st.tone !== 'ready' && st.step) {
    if (typeof toast === 'function') toast(st.reason || 'Missing required fields.', true);
    tfGoToStep(st.step);
    return;
  }

  // Both modes are single-screen — GO button logs the trade.
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') tfLogSwingDirect();
  else               tfLogIntradayDirect();
}

// Styled confirm dialog. `bodyHtml` is trusted markup we build ourselves —
// not user input — so innerHTML is safe here. Calls onConfirm() if user
// clicks Confirm, drops if user cancels. The optional `mode` / `chipLabel` /
// `meta` / `subHtml` switch the modal into the styled trade-confirmation look
// (mode-colored chip and Confirm button); omitting them keeps the legacy
// header for prompts like Reset trade?
export function tfShowConfirm({ title = 'Confirm', okLabel = 'Confirm', bodyHtml = '', onConfirm, mode = '', chipLabel = '', meta = '', subHtml = '' }) {
  const modal = document.getElementById('modal-tf-confirm');
  if (!modal) { if (onConfirm) onConfirm(); return; }
  const card = document.getElementById('tf-confirm-modal');
  if (card) card.dataset.mode = mode || '';
  document.getElementById('tf-confirm-title').textContent = title;
  document.getElementById('tf-confirm-body').innerHTML = bodyHtml;
  const chipEl = document.getElementById('tf-confirm-chip');
  if (chipEl) {
    if (chipLabel) { chipEl.textContent = chipLabel; chipEl.hidden = false; }
    else { chipEl.textContent = ''; chipEl.hidden = true; }
  }
  const metaEl = document.getElementById('tf-confirm-meta');
  if (metaEl) metaEl.textContent = meta || '';
  const subEl = document.getElementById('tf-confirm-sub');
  if (subEl) subEl.innerHTML = subHtml || '';
  const okBtn = document.getElementById('tf-confirm-ok');
  okBtn.textContent = okLabel;

  const cancel = document.getElementById('tf-confirm-cancel');
  const xBtn   = document.getElementById('tf-confirm-x');

  // Replace the click handlers via clone so prior bindings don't pile up.
  const fresh = (el) => { const c = el.cloneNode(true); el.parentNode.replaceChild(c, el); return c; };
  const newOk = fresh(okBtn);
  const newCancel = fresh(cancel);
  const newX = fresh(xBtn);

  // Esc closes; Enter is handled by the focused OK button's default behavior.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  const close = () => {
    modal.classList.remove('show');
    document.removeEventListener('keydown', onKey);
  };
  newOk.addEventListener('click', () => { close(); if (onConfirm) onConfirm(); });
  newCancel.addEventListener('click', close);
  newX.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  modal.classList.add('show');
  // Move focus to the OK button so Enter confirms (browsers'
  // default behavior on dialogs).
  setTimeout(() => { try { newOk.focus(); } catch (_) {} }, 30);
}

// Build the structured body for the trade confirmation modal: ticker block,
// stop/entry/target bar, four stat cards, and the Edge Intelligence card.
// Pure HTML construction — caller is responsible for wiring tfShowConfirm.
export function tfBuildConfirmTradeBody({
  mode,          // 'intraday' | 'swing'
  ticker,
  directionLabel,
  setupLabel,
  instrumentLabel,
  qty,
  qtyUnit,       // 'contracts' | 'shares'
  entry,
  stop,
  target,
  riskDollars,
  rewardDollars,
  rMultiple,
  equity,
  edgeIntelHtml = '',
} = {}) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const money = (v) => `$${Math.abs(Math.round(Number(v) || 0)).toLocaleString()}`;
  const price = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return `$${n.toFixed(2)}`;
  };
  const pct = (num, den) => {
    if (!den || !isFinite(num) || !isFinite(den)) return '';
    return `${((num / den) * 100).toFixed(2)}%`;
  };
  const dirKey = (directionLabel || '').toLowerCase().startsWith('s') ? 'short' : 'long';
  const dirClass = dirKey === 'short' ? 'short' : 'long';
  const unitWord = (() => {
    const u = qtyUnit || 'contracts';
    if (qty === 1) return u.replace(/s$/, '');
    return u;
  })();
  const qtyText = qty ? `${qty} ${unitWord}` : '';
  const riskPct  = equity ? pct(riskDollars, equity)  : '';
  const rewardPct = equity ? pct(rewardDollars, equity) : '';
  const riskEach = (qty && qty > 0 && riskDollars) ? money(riskDollars / qty) : '';
  const rText = (rMultiple != null && isFinite(rMultiple)) ? `${rMultiple.toFixed(2)}R` : '—';
  const rPerOne = (rMultiple != null && isFinite(rMultiple)) ? `$${rMultiple.toFixed(2)} / $1` : '';
  const mult = (qtyUnit === 'contracts') ? 100 : 1;
  const barHtml = `<div class="tf-conf-rail">${tfRiskRailHtml({ entry, stop, target, qty, mult })}</div>`;
  const statsHtml = `
    <div class="tf-conf-stats">
      <div class="tf-conf-stat">
        <div class="tf-conf-stat-k">RISK</div>
        <div class="tf-conf-stat-v tone-bad">${money(riskDollars)}</div>
        <div class="tf-conf-stat-sub">${riskPct ? esc(riskPct) + ' of equity' : ''}</div>
      </div>
      <div class="tf-conf-stat">
        <div class="tf-conf-stat-k">REWARD</div>
        <div class="tf-conf-stat-v tone-good">${money(rewardDollars)}</div>
        <div class="tf-conf-stat-sub">${rewardPct ? esc(rewardPct) + ' gain' : ''}</div>
      </div>
      <div class="tf-conf-stat">
        <div class="tf-conf-stat-k">R-MULTIPLE</div>
        <div class="tf-conf-stat-v tf-conf-accent">${esc(rText)}</div>
        <div class="tf-conf-stat-sub">${esc(rPerOne)}</div>
      </div>
      <div class="tf-conf-stat">
        <div class="tf-conf-stat-k">${esc((qtyUnit || 'CONTRACTS').toUpperCase())}</div>
        <div class="tf-conf-stat-v">${qty || '—'}</div>
        <div class="tf-conf-stat-sub">${riskEach ? esc(riskEach) + ' risk each' : ''}</div>
      </div>
    </div>`;
  const headerLine = `
    <div class="tf-conf-trade">
      <div class="tf-conf-trade-l">
        <span class="tf-conf-ticker">${esc(ticker || '')}</span>
        <span class="tf-conf-dir-pill tf-conf-dir-${dirClass}">${esc((directionLabel || '').toUpperCase())}</span>
        <span class="tf-conf-setup-pill">${esc((setupLabel || '').toUpperCase())}</span>
      </div>
      <div class="tf-conf-trade-r">${esc(instrumentLabel || '')}${qtyText ? ' · ' + esc(qtyText) : ''}</div>
    </div>`;
  return `
    <div class="tf-conf-card" data-mode="${esc(mode || '')}">
      ${headerLine}
      ${barHtml}
      ${statsHtml}
      <div class="tf-conf-intel">${edgeIntelHtml}</div>
    </div>
  `;
}

// Compose the "WED · 14:23 ET" meta string shown beside the mode chip.
function tfConfirmMetaNow() {
  const d = new Date();
  const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const dow = dows[d.getDay()];
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${dow} · ${h}:${m} ET`;
}

// Build a swing trade record from current flow state and log it. Confirms
// first so the user can spot a wrong number before it lands in the journal.
export function tfLogSwingDirect() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = state.instrument !== 'stocks';
  const reviewPlan = (typeof tfComputeSwingReviewPlan === 'function') ? tfComputeSwingReviewPlan() : null;
  const premium = reviewPlan ? Number(reviewPlan.entry) : Number(state.premium);
  const atr = Number(state.atr);
  const upx = Number(state.underlyingPrice);

  let riskDollars = (typeof tfComputeSwingRiskBudget === 'function')
    ? tfComputeSwingRiskBudget()
    : Math.round((Number(settings.account) || DEFAULT_SETTINGS.account || 10000) * getRiskPctForRegime(state.regime || 'risk-on'));
  if (state.selectedSetup === 'Edge Reversal' && typeof tfComputeSwingRiskBudget !== 'function') riskDollars = Math.round(riskDollars / 2);
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
  const regimeText = REGIME_DATA[state.regime] ? REGIME_DATA[state.regime].text : (state.regime || 'risk-on').toUpperCase();

  if (!ticker || !state.selectedSetup || !premium || premium <= 0) {
    if (typeof toast === 'function') toast('Missing required field — go back and check the inputs.', true);
    return;
  }

  // Build the styled trade-confirmation card.
  const edgeIntelHtml = (typeof buildTradeFlowEdgeIntel === 'function')
    ? buildTradeFlowEdgeIntel({
        mode: 'swing',
        setup: state.selectedSetup,
        direction: state.direction,
        instrument: state.instrument,
        inModal: true,
      })
    : '';
  const stopForBar = isOptions ? Number(stopSell) : Number(stopPrice);
  const entryForBar = Number(premium);
  const targetForBar = Number(targetPrice);
  const perUnit = isOptions ? 100 : 1;
  const rewardDollars = (isFinite(entryForBar) && isFinite(targetForBar) && contracts)
    ? Math.abs(targetForBar - entryForBar) * contracts * perUnit
    : 0;
  const rMultiple = (riskDollars > 0 && rewardDollars > 0) ? rewardDollars / riskDollars : null;
  const equity = Number((state.settings || {}).account) || 0;
  const bodyHtml = tfBuildConfirmTradeBody({
    mode: 'swing',
    ticker,
    directionLabel,
    setupLabel: state.selectedSetup || '',
    instrumentLabel: isOptions ? 'Options' : 'Stock',
    qty: contracts,
    qtyUnit: isOptions ? 'contracts' : 'shares',
    entry: entryForBar,
    stop: stopForBar,
    target: targetForBar,
    riskDollars,
    rewardDollars,
    rMultiple,
    equity,
    edgeIntelHtml,
  });

  // Capture values needed for the post-confirm path so the closure stays small.
  tfShowConfirm({
    title: 'Confirm trade',
    okLabel: 'Confirm & log →',
    bodyHtml,
    mode: 'swing',
    chipLabel: 'SWING',
    meta: tfConfirmMetaNow(),
    subHtml: 'Will be added to the log as <strong>open</strong>.',
    onConfirm: () => tfLogSwingFinalize({ ticker, directionLabel, premium, contracts, isOptions, stopPrice, stopSell, targetPrice, stopUnderlying, riskDollars, regimeText }),
  });
}

export function tfLogSwingFinalize({ ticker, directionLabel, premium, contracts, isOptions, stopPrice, stopSell, targetPrice, stopUnderlying, riskDollars, regimeText }) {
  const nowIso = new Date().toISOString();
  const setupLabel = state.selectedSetup || '';
  const trade = {
    id: genTradeId ? genTradeId() : ('s_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    mode: 'swing',
    instrument: isOptions ? 'options' : 'stocks',
    structure: state.structure || (isOptions ? 'options' : 'stocks'),
    date: new Date().toISOString().split('T')[0],
    ticker,
    setup: setupLabel,
    direction: directionLabel,
    entry: premium,
    contracts,
    shares: isOptions ? null : contracts,
    ivr: (state.ivr === null || state.ivr === undefined) ? null : Number(state.ivr),
    saQuant: (state.saQuant === null || state.saQuant === undefined) ? null : Number(state.saQuant),
    saProfitGrade: state.saProfitGrade || null,
    saMomentumGrade: state.saMomentumGrade || null,
    regime: regimeText,
    regimeAtEntry: state.regime || null,
    openedAt: nowIso,
    notes: state.tradeFlow.notes || '',
    thesis: state.tradeFlow.notes || '',
    premortem: '',
    stop: isOptions ? (stopSell || null) : stopPrice,
    stopUnderlying: isOptions ? (stopUnderlying || null) : null,
    target: targetPrice,
    riskDollars,
    setupSnapshot: {
      capturedAt: nowIso,
      mode: 'swing',
      instrument: isOptions ? 'options' : 'stocks',
      structure: state.structure || (isOptions ? 'options' : 'stocks'),
      ticker,
      setup: setupLabel,
      direction: directionLabel,
      entry: premium,
      stop: isOptions ? (stopSell || null) : stopPrice,
      limit: targetPrice,
      target: targetPrice,
      qty: contracts,
      riskDollars,
      regime: regimeText,
      regimeAtEntry: state.regime || null,
      ivr: (state.ivr === null || state.ivr === undefined) ? null : Number(state.ivr),
      saQuant: (state.saQuant === null || state.saQuant === undefined) ? null : Number(state.saQuant),
      saProfitGrade: state.saProfitGrade || null,
      saMomentumGrade: state.saMomentumGrade || null,
      stopUnderlying: isOptions ? (stopUnderlying || null) : null,
      notes: state.tradeFlow.notes || '',
    },
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
  if (typeof resetFlowSilent === 'function') resetFlowSilent();
  state.tradeFlow.step = 1;
  state.tradeFlow.thesis = '';
  state.tradeFlow.preMortem = '';
  state.tradeFlow.notes = '';
  state.tradeFlow.visited = Array(tfStepCount()).fill(false);
  saveState();
  if (typeof toast === 'function') toast(`Logged ${ticker} ${setupLabel}`);
  if (typeof renderHome === 'function') renderHome();
  if (typeof renderLogStats === 'function') renderLogStats();
  if (typeof renderLogTable === 'function') renderLogTable();
  if (typeof setTab === 'function') setTab('home');
}

// Wrap the existing intraday logger with a styled confirm prompt, then reset
// the flow's step pointer afterward.
export function tfLogIntradayDirect() {
  const it = state.intraday || {};
  const ticker = (it.ticker || '').toUpperCase();
  const st = tfComputeStatus();
  if (st.tone !== 'ready') {
    if (typeof toast === 'function') toast(st.reason || 'Intraday ticket is not ready yet.', true);
    return;
  }
  if (!ticker || !it.setup || !it.entry) {
    if (typeof toast === 'function') toast('Missing required field — go back and check.', true);
    return;
  }
  const isOptions = tfIntradayInstrument() !== 'stocks';
  const setupDef   = TRADE_INTRADAY_SETUPS.find(s => s.id === it.setup) || null;
  const setupLabel = setupDef ? setupDef.name : it.setup;
  const directionLabel = (it.direction || 'long').toLowerCase() === 'short' ? 'Short' : 'Long';
  const edgeIntelHtml = (typeof buildTradeFlowEdgeIntel === 'function')
    ? buildTradeFlowEdgeIntel({ mode: 'intraday', setup: it.setup, direction: it.direction, instrument: it.instrument, inModal: true })
    : '';

  const entryForBar = Number(it.entry);
  const stopForBar = Number(it.stop);
  const targetForBar = Number(it.target);
  const auto = (typeof tfComputeIntradayRiskSize === 'function') ? tfComputeIntradayRiskSize() : null;
  const qty = Number(it.contracts) || (auto ? auto.qty : 0) || 0;
  const perUnit = isOptions ? 100 : 1;
  const stopDist = (isFinite(entryForBar) && isFinite(stopForBar)) ? Math.abs(entryForBar - stopForBar) : 0;
  const riskDollars = (qty && stopDist) ? qty * stopDist * perUnit : (auto ? auto.risk : 0);
  const rewardDollars = (isFinite(entryForBar) && isFinite(targetForBar) && qty)
    ? Math.abs(targetForBar - entryForBar) * qty * perUnit
    : 0;
  const rMultiple = (riskDollars > 0 && rewardDollars > 0) ? rewardDollars / riskDollars : null;
  const equity = Number((state.settings || {}).account) || 0;

  const bodyHtml = tfBuildConfirmTradeBody({
    mode: 'intraday',
    ticker,
    directionLabel,
    setupLabel,
    instrumentLabel: isOptions ? 'Options' : 'Stock',
    qty,
    qtyUnit: isOptions ? 'contracts' : 'shares',
    entry: entryForBar,
    stop: stopForBar,
    target: targetForBar,
    riskDollars,
    rewardDollars,
    rMultiple,
    equity,
    edgeIntelHtml,
  });
  tfShowConfirm({
    title: 'Confirm trade',
    okLabel: 'Confirm & log →',
    bodyHtml,
    mode: 'intraday',
    chipLabel: 'INTRADAY',
    meta: tfConfirmMetaNow(),
    subHtml: 'Will be added to the log as <strong>open</strong>.',
    onConfirm: () => {
      if (typeof logIntradayTrade !== 'function') {
        if (typeof toast === 'function') toast('Intraday logging is unavailable.', true);
        return;
      }
      logIntradayTrade();
      state.tradeFlow.step = 1;
      saveState();
      if (typeof setTab === 'function') setTab('home');
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
    b.addEventListener('click', () => tfSetMode(b.dataset.tradeMode));
  });

  document.getElementById('trade-reset-btn')?.addEventListener('click', () => tfReset());
  document.getElementById('trade-smart-paste-btn')?.addEventListener('click', () => tfFocusSmartPaste());
  document.getElementById('trade-hero-paste-btn')?.addEventListener('click', () => tfFocusSmartPaste());

  document.getElementById('trade-back-btn')?.addEventListener('click', () => {
    const cur = (state.tradeFlow && state.tradeFlow.step) || 1;
    if (tfIsSingleScreen() || cur <= 1) {
      if (typeof setTab === 'function') setTab('home');
    } else {
      tfGoToStep(cur - 1);
    }
  });

  document.getElementById('trade-continue-btn')?.addEventListener('click', () => tfContinue());

  document.getElementById('trade-summary-status-cell')?.addEventListener('click', e => {
    const cell = e.currentTarget;
    if (!cell.classList.contains('clickable')) return;
    const step = parseInt(cell.dataset.tfStatusStep, 10);
    if (step) tfGoToStep(step);
  });
}

// Mobile-only top progress bar (hidden on desktop via CSS)
function tfRenderMobileProgress() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const names  = tfStepNames();
  const compl  = tfStepCompletion();
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
  const count = tfStepCount();
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
      tfRenderRail();
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

  const instrumentHtml = (() => {
    const struct = m === 'intraday'
      ? ((state.intraday && state.intraday.instrument) === 'stocks' ? 'stocks' : 'options')
      : (state.instrument === 'stocks' ? 'stocks' : 'options');
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
  })();

  return `
    <div class="tf-ticker-card">
      <div class="tf-ticker-card-hdr">
        <span class="tf-card-lbl">TICKER${meta ? ' · <span class="tf-ticker-meta-inline">'+meta+'</span>' : ''}</span>
      </div>
      <div class="tf-ticker-input-row">
        <input class="tf-ticker-main-input" id="tf-ticker-card-input"
          type="text" value="${ticker}" placeholder="—"
          autocomplete="off" spellcheck="false" maxlength="10"
          style="${ticker ? 'color:'+accentColor : ''}">
        <a href="https://seekingalpha.com/symbol/${ticker}" id="tf-card-sa-link" target="_blank" rel="noopener noreferrer" style="display:${ticker ? 'inline-flex' : 'none'}; align-items:center; padding:6px 12px; border-radius:8px; border:1px solid ${accentLine}; background:${accentBg}; color:${accentColor}; font-family:var(--mono); font-size:11px; font-weight:800; letter-spacing:0.1em; text-decoration:none; transition:opacity 0.15s; white-space:nowrap;" onmouseover="this.style.opacity=0.7" onmouseout="this.style.opacity=1">CHECK SA ↗</a>
      </div>
      ${biasHtml}
      <div class="tf-pill-row">
        <div class="tf-pill-section">
          <span class="tf-card-lbl">DIRECTION</span>
          <div class="tf-dir-btns">
            <button class="tf-dir-btn${dir==='long'?' active':''}" data-tf-dir="long" type="button"
              style="${dir==='long'?'background:rgba(16,185,129,0.14);border-color:rgba(16,185,129,0.40);color:var(--green-bright)':''}">LONG</button>
            <button class="tf-dir-btn${dir==='short'?' active short':''}" data-tf-dir="short" type="button"
              style="${dir==='short'?'background:rgba(248,113,113,0.14);border-color:rgba(248,113,113,0.40);color:var(--red-bright)':''}">SHORT</button>
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
      tfRenderHeader();
      const saLink = document.getElementById('tf-card-sa-link');
      if (saLink) {
        if (v) {
          saLink.href = `https://seekingalpha.com/symbol/${v}`;
          saLink.style.display = 'inline-flex';
        } else {
          saLink.style.display = 'none';
        }
      }
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
      renderTrade();
    });
  });
  document.querySelectorAll('#trade-body [data-tf-struct]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.tfStruct;
      if (m === 'intraday') {
        if (typeof tfSetIntradayStructure === 'function') {
          tfSetIntradayStructure(s);
        } else {
          if (!state.intraday) state.intraday = {};
          state.intraday.structure = s;
          state.intraday.instrument = s;
          saveState();
          renderTrade();
        }
      } else {
        if (typeof tfSetSwingStructure === 'function') {
          tfSetSwingStructure(s);
        } else {
          state.structure = s;
          state.instrument = s;
          saveState();
          renderTrade();
        }
      }
    });
  });
}

export function renderTrade() {
  if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '' };
  tfBindTradePanelStaticOnce();
  const step = state.tradeFlow.step || 1;
  tfRenderHeader();
  tfRenderRail();
  const body = document.getElementById('trade-body');
  if (body) body.innerHTML = tfRenderMobileProgress() + tfRenderTickerCard() + tfStepBody(step);
  tfMountStep(step);
  tfMountTickerCard();
  tfRenderActions();
  tfBindScrollObserver();
}

// setTab → kept in legacy.js (Phase 11 will move it to src/tabs.js)

