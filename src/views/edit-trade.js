// Edit Trade — full-page view for managing an open position.
// Two modes: VIEW (read-only dashboard) and EDIT (drag handles + form controls + staged save).

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { calcPL, tradeRiskDollars, tradeMultiplier, tradeQty } from '../models/trade.js';

// ── module state ──────────────────────────────────────────────────────────
let editMode = false;
let draft = null;          // staged copy in edit mode
let originalSnapshot = null; // for discard
let journalEditOnRender = false;

// ── format helpers ─────────────────────────────────────────────────────────
function fmt$(v) {
  const abs = Math.abs(v);
  return (v >= 0 ? '+$' : '−$') + (abs >= 1000
    ? abs.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : abs.toFixed(0));
}
function fmtR(r) {
  return (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2) + 'R';
}
function modeAccent(mode) {
  return mode === 'intraday'
    ? { c: 'var(--magenta, #ec4899)', bg: 'rgba(236,72,153,0.10)', line: 'rgba(236,72,153,0.30)', soft: 'rgba(236,72,153,0.06)' }
    : { c: 'var(--cyan)', bg: 'rgba(6,212,248,0.10)', line: 'rgba(6,212,248,0.30)', soft: 'rgba(6,212,248,0.06)' };
}
function edgeColor(edge) {
  const e = (edge || '').toUpperCase();
  if (e === 'STRONG')  return 'var(--green-bright)';
  if (e === 'HOLDING') return 'var(--cyan)';
  if (e === 'FADING')  return 'var(--amber-bright, #fbbf24)';
  if (e) return 'var(--red-bright)';
  return 'var(--ink-3)';
}
function edgeBg(edge) {
  const e = (edge || '').toUpperCase();
  if (e === 'STRONG')  return 'rgba(16,185,129,0.12)';
  if (e === 'HOLDING') return 'rgba(6,212,248,0.10)';
  if (e === 'FADING')  return 'rgba(245,158,11,0.10)';
  if (e) return 'rgba(239,68,68,0.10)';
  return 'rgba(255,255,255,0.04)';
}
function edgeLine(edge) {
  const e = (edge || '').toUpperCase();
  if (e === 'STRONG')  return 'rgba(16,185,129,0.32)';
  if (e === 'HOLDING') return 'rgba(6,212,248,0.30)';
  if (e === 'FADING')  return 'rgba(245,158,11,0.32)';
  if (e) return 'rgba(239,68,68,0.32)';
  return 'rgba(255,255,255,0.08)';
}
function regimeColor(r) {
  const k = (r || '').toLowerCase();
  if (k.includes('on'))  return 'var(--green-bright)';
  if (k.includes('off')) return 'var(--red-bright)';
  if (k.includes('neutral')) return 'var(--amber-bright,#fbbf24)';
  return 'var(--ink-3)';
}
function toast(msg) {
  if (typeof window.toast === 'function') window.toast(msg);
}

// ── entry point ────────────────────────────────────────────────────────────
export function openEditTrade(tradeId) {
  const overlay = document.getElementById('edit-trade-overlay');
  const mainEl  = document.getElementById('edit-trade-main');
  if (!overlay || !mainEl) return;

  const trade = (state.trades || []).find(t => t.id === tradeId);
  if (!trade) return;

  overlay.dataset.tradeId = tradeId;
  overlay.classList.add('show');
  editMode = false;
  draft = null;
  originalSnapshot = null;
  renderEditTrade(trade);
}

export function closeEditTrade() {
  const overlay = document.getElementById('edit-trade-overlay');
  if (overlay) overlay.classList.remove('show');
  editMode = false;
  draft = null;
  originalSnapshot = null;
  journalEditOnRender = false;
}

// ── working copy helpers ───────────────────────────────────────────────────
function workingTrade(trade) {
  return editMode && draft ? draft : trade;
}
function enterEditMode(trade) {
  editMode = true;
  draft = JSON.parse(JSON.stringify(trade));
  originalSnapshot = JSON.parse(JSON.stringify(trade));
  renderEditTrade(trade);
}
function exitEditMode(trade) {
  editMode = false;
  draft = null;
  originalSnapshot = null;
  journalEditOnRender = false;
  renderEditTrade(trade);
}
function commitDraft(trade) {
  if (!draft) return;
  Object.keys(draft).forEach(k => { trade[k] = draft[k]; });
  trade.updated_at = new Date().toISOString();
  saveState();
}
function draftDirty() {
  if (!draft || !originalSnapshot) return false;
  return JSON.stringify(draft) !== JSON.stringify(originalSnapshot);
}

// ── main render ────────────────────────────────────────────────────────────
function renderEditTrade(trade) {
  const overlay = document.getElementById('edit-trade-overlay');
  const mainEl  = document.getElementById('edit-trade-main');
  if (!overlay || !mainEl) return;

  const w        = workingTrade(trade);
  const mode     = w.mode || 'swing';
  const a        = modeAccent(mode);
  const entry    = parseFloat(w.entry || w.premium || 0);
  const stop     = parseFloat(w.stop || 0);
  const target   = parseFloat(w.target || 0);
  const mark     = parseFloat(w.mark || w.currentPrice || entry);
  const qty      = w.qty || w.contracts || w.shares || 1;
  const edge     = (w.edge || w.setup_edge || '').toUpperCase() || null;
  const regimeAtEntry = w.regimeAtEntry || w.regime || null;

  const dirRaw   = (w.direction || w.dir || 'long').toLowerCase();
  const isLong   = !dirRaw.startsWith('s');
  const mult     = tradeMultiplier(w);
  const gainPerUnit = (mark - entry) * (isLong ? 1 : -1);
  const pl       = gainPerUnit * qty * mult;
  const isProfit = pl >= 0;
  const tone     = isProfit ? 'var(--green-bright)' : 'var(--red-bright)';
  // 1R is FROZEN at entry: trade.riskDollars (account × regimePct at the moment of entry).
  // Falls back to |entry−stop| × qty × multiplier for legacy trades that didn't snapshot riskDollars.
  const oneR     = Math.round(tradeRiskDollars(w) || (Math.abs(entry - stop) * qty * mult) || 1);
  const r        = oneR ? (pl / oneR) : 0;
  const plPct    = entry ? (gainPerUnit / entry * 100) : 0;

  // Target dollar potential — uses live entry/target/qty, scaled by contract multiplier.
  const hasTarget = target > 0 && Number.isFinite(target) && target !== entry;
  const targetGainPerUnit = hasTarget ? Math.abs(target - entry) : 0;
  const targetDollars = Math.round(targetGainPerUnit * qty * mult);
  const plannedRR = hasTarget && oneR ? (targetDollars / oneR) : 0;

  // Ladder geometry — fixed visual positions
  const stopX   = 8;
  const entryX  = 32;
  const targetX = 92;
  const progressDen = hasTarget ? (isLong ? (target - stop) : (stop - target)) : (isLong ? (entry - stop) : (stop - entry));
  const progressNum = isLong ? (mark - stop) : (stop - mark);
  // Clamp progress to [0,1] so NOW dot never exits the bar.
  const progress    = progressDen ? Math.max(0, Math.min(1, progressNum / progressDen)) : 0;
  const markPct     = Math.max(stopX, Math.min(targetX, stopX + progress * (targetX - stopX)));

  // Detect overlap with markers so NOW label stays readable.
  const nearStop   = Math.abs(markPct - stopX)   < 7;
  const nearEntry  = Math.abs(markPct - entryX)  < 7;
  const nearTarget = Math.abs(markPct - targetX) < 7;
  const stopLaneTop = nearStop ? 88 : 12;
  const stopLineTop = nearStop ? -32 : 36;
  const targetLaneTop = nearTarget ? 88 : 12;
  const targetLineTop = nearTarget ? -32 : 36;
  const entryLaneTop = nearEntry ? 96 : 88;

  const pctToTarget = hasTarget ? Math.round((isLong ? (mark - entry) / (target - entry) : (entry - mark) / (entry - target)) * 100) : 0;
  const pctToStop   = entry !== stop ? Math.round((isLong ? (mark - stop) / (entry - stop) : (stop - mark) / (stop - entry)) * 100) : 100;
  const ctxLeft = !hasTarget
    ? `<strong style="color:var(--amber-bright,#fbbf24)">No target set.</strong> Add one to track progress vs. risk.`
    : isProfit
      ? `<strong style="color:var(--green-bright)">${pctToTarget}% to target.</strong> Price ${Math.abs(plPct).toFixed(1)}% ${isLong ? 'above' : 'below'} entry · trail to BE recommended.`
      : `<strong style="color:var(--red-bright)">${pctToStop}% buffer to stop.</strong> Price ${Math.abs(plPct).toFixed(1)}% ${isLong ? 'below' : 'above'} entry · monitor closely.`;

  const highestMark = Math.max(mark, parseFloat(w.highMark || w.dayHigh || mark) || mark);

  const history = buildHistory(w, a.c, tone);

  // Opened-at display
  const openedAt = w.openedAt || w.created_at || w.date || null;
  const openedStr = openedAt ? formatOpened(openedAt) : '—';
  const isJournalEditing = editMode && journalEditOnRender;

  // ── nav bar ─────────────────────────────────────────────────────────────
  const navBar = document.getElementById('edit-trade-nav-bar');
  if (navBar) {
    const regimeKey = (state.regime || 'risk-on').toLowerCase();
    const regimeLabel = regimeKey === 'risk-off' ? 'RISK-OFF' : regimeKey === 'neutral' ? 'NEUTRAL' : 'RISK-ON';
    navBar.innerHTML = `
      <header class="cmdbar ${regimeKey}">
        <div class="cmdbar-inner">
          <div class="cmdbar-left">
            <div class="cmdbar-brand brand" id="et-brand-home" title="Back to Home">
              <span class="brand-mark" style="display:flex;align-items:center;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 18 L12 4 L21 18"></path>
                  <path d="M8 18 L12 11 L16 18"></path>
                </svg>
              </span>
              <span class="brand-name">TRAPPER'S <span class="brand-name-dim">EDGE</span></span>
            </div>
            <nav class="cmdbar-nav" aria-label="Main navigation">
              <button class="tab" data-et-tab="home" type="button">Home</button>
              <button class="tab" data-et-tab="trade" type="button">Trade</button>
              <button class="tab active" data-et-tab="log" type="button">Log</button>
              <button class="tab" data-et-tab="stats" type="button">Stats</button>
              <button class="tab" data-et-tab="reference" type="button">Reference</button>
            </nav>
          </div>
          <div class="cmdbar-actions">
            <button class="cmdbar-context-btn ${regimeKey}" id="et-regime-state" type="button" title="Open Market Context">
              <span class="cmdbar-regime-dot"></span>
              <span>${regimeLabel}</span>
            </button>
            <div class="cmdbar-sync" title="Local journal">
              <span id="sync-dot"></span>
              <span>SYNC · LOCAL</span>
            </div>
            <button class="cmdbar-kmk-btn" id="et-btn-settings" title="Settings" aria-label="Settings" type="button" style="display:flex;align-items:center;justify-content:center;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button class="cmdbar-kmk-btn" id="et-close-btn" title="Back to Book" type="button">← BACK</button>
          </div>
        </div>
      </header>`;
    navBar.querySelector('#et-close-btn').addEventListener('click', handleBack(trade));
    navBar.querySelector('#et-brand-home').addEventListener('click', () => {
      if (editMode && draftDirty()) {
        if (!confirm('Discard unsaved edits and leave?')) return;
      }
      closeEditTrade();
      if (typeof window.setTab === 'function') window.setTab('home');
    });
    navBar.querySelectorAll('[data-et-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (editMode && draftDirty()) {
          if (!confirm('Discard unsaved edits and leave?')) return;
        }
        closeEditTrade();
        if (typeof window.setTab === 'function') window.setTab(btn.dataset.etTab);
      });
    });
    navBar.querySelector('#et-regime-state')?.addEventListener('click', () => {
      if (typeof window.openContextPanel === 'function') window.openContextPanel();
    });
    navBar.querySelector('#et-btn-settings')?.addEventListener('click', () => {
      if (typeof window.openSettingsModal === 'function') window.openSettingsModal();
      else if (typeof window.openSettings === 'function') window.openSettings();
    });
    // Mode toggle now lives in the body toolbar — wired in wireEvents().
  }

  // ── body html ───────────────────────────────────────────────────────────
  mainEl.innerHTML = `
    <section class="et-hero ${isProfit ? 'et-hero-profit' : 'et-hero-loss'}">
      <div class="et-hero-left">
        <div class="et-hero-status" style="color:${tone}">
          <div class="et-hero-status-dot" style="background:${tone};box-shadow:0 0 8px ${tone}"></div>
          OPEN${editMode ? ' · EDITING' : ''}
        </div>
        <div class="et-ticker-row">
          <h1 class="et-ticker">${(w.ticker || w.symbol || '—').toUpperCase()}</h1>
          <span class="et-pill ${isLong ? 'et-pill-long' : 'et-pill-short'}">${isLong ? 'LONG' : 'SHORT'}</span>
          <span class="et-pill ${mode === 'intraday' ? 'et-pill-intra' : 'et-pill-swing'}">${mode}</span>
          <span class="et-qty-note">${qty} ${mode === 'intraday' || w.instrument === 'options' ? 'ct' : 'sh'}</span>
        </div>
      </div>
      <div class="et-pnl-grid">
        <div>
          <div class="et-pnl-label">Unrealized</div>
          <div class="et-pnl-val" style="color:${tone}">${fmt$(pl)}</div>
          <div class="et-pnl-sub" style="color:${tone}">${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%</div>
        </div>
        <div>
          <div class="et-pnl-label">Risk · R</div>
          <div class="et-pnl-val" style="color:var(--red-bright)">$${oneR.toLocaleString()}</div>
          <div class="et-pnl-sub" style="color:${tone}">${fmtR(r)} now</div>
        </div>
        <div>
          <div class="et-pnl-label">Mark ${editMode ? '<span style="color:var(--ink-4);font-size:9px;">· tap to edit</span>' : ''}</div>
          <div class="et-pnl-val ${editMode ? 'et-mark-editable' : ''}" id="et-mark-val"
            ${editMode ? 'contenteditable="true" inputmode="decimal"' : ''}
            style="color:var(--ink);${editMode ? 'cursor:text;outline:none;' : ''}">$${mark.toFixed(2)}</div>
        </div>
      </div>
    </section>

    <!-- Setup snapshot — frozen on entry -->
    <section class="et-snapshot-card" style="background:linear-gradient(180deg,${a.soft},transparent 60%),rgba(19,23,34,0.78);border:1px solid ${a.line};">
      <div class="et-card-heading">
        <h2 class="et-card-title">Setup snapshot</h2>
        <div class="et-card-meta">FROZEN AT ENTRY · ${openedStr}</div>
      </div>
      <div class="et-snapshot-grid">
        <div class="et-snap-cell">
          <div class="et-snap-label">Macro regime</div>
          <div class="et-snap-val" style="color:${regimeColor(regimeAtEntry)}">${(regimeAtEntry || '—').toString().toUpperCase()}</div>
        </div>
        <div class="et-snap-cell">
          <div class="et-snap-label">Setup</div>
          <div class="et-snap-val">${escapeHtml(w.setup || w.selectedSetup || '—')}</div>
        </div>
        <div class="et-snap-cell">
          <div class="et-snap-label">Edge at entry</div>
          <div class="et-snap-val" style="color:${edgeColor(edge)}">${edge || '—'}</div>
        </div>
        <div class="et-snap-cell">
          <div class="et-snap-label">Direction</div>
          <div class="et-snap-val" style="color:${isLong ? 'var(--green-bright)' : 'var(--red-bright)'}">${isLong ? 'LONG' : 'SHORT'} · ${mode}</div>
        </div>
        <div class="et-snap-cell">
          <div class="et-snap-label">Entry price</div>
          <div class="et-snap-val">$${entry.toFixed(2)}</div>
        </div>
        <div class="et-snap-cell">
          <div class="et-snap-label">Planned R:R</div>
          <div class="et-snap-val">${plannedRR ? plannedRR.toFixed(2) + ':1' : '—'}</div>
        </div>
      </div>
      ${w.setup ? `<button class="et-repeat-setup-pill" id="et-repeat-setup-btn" type="button"
        style="color:${a.c};background:${a.bg};border:1px solid ${a.line};">↻ Repeat this setup</button>` : ''}
    </section>

    <!-- Price ladder -->
    <section class="et-ladder-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Price ladder${editMode ? ' <span class="et-card-meta" style="margin-left:8px;">DRAG TO ADJUST</span>' : ''}</h2>
      </div>
      <div class="et-ladder ${editMode ? 'is-editable' : ''}" id="et-ladder">
        <div class="et-ladder-track">
          <div class="et-ladder-fill" style="background:linear-gradient(90deg,rgba(239,68,68,0.18) 0%,rgba(239,68,68,0.18) 28%,rgba(255,255,255,0.04) 28%,rgba(255,255,255,0.04) 32%,rgba(16,185,129,0.14) 32%,${hasTarget ? 'rgba(52,211,153,0.28)' : 'rgba(255,255,255,0.04)'} 100%)"></div>
        </div>
        <div class="et-marker ${nearStop ? 'et-marker-below' : 'et-marker-above'} ${editMode ? 'et-marker-drag' : ''}" data-handle="stop" style="left:${stopX}%;top:${stopLaneTop}px;">
          <div class="et-marker-label" style="color:var(--red-bright)">STOP</div>
          <div class="et-marker-price">$${stop.toFixed(2)}</div>
          <div class="et-marker-line" style="background:var(--red-bright);opacity:0.6;height:28px;position:absolute;top:${stopLineTop}px;"></div>
        </div>
        <div class="et-marker et-marker-entry et-marker-below ${editMode ? 'et-marker-drag' : ''}" data-handle="entry" style="left:${entryX}%;top:${entryLaneTop}px;">
          <div class="et-marker-line" style="background:${a.c};opacity:0.6;height:28px;position:absolute;top:-32px;"></div>
          <div class="et-marker-label" style="color:${a.c}">ENTRY</div>
          <div class="et-marker-price">$${entry.toFixed(2)}</div>
        </div>
        ${hasTarget ? `
        <div class="et-marker ${nearTarget ? 'et-marker-below' : 'et-marker-above'} ${editMode ? 'et-marker-drag' : ''}" data-handle="target" style="left:${targetX}%;top:${targetLaneTop}px;">
          <div class="et-marker-label" style="color:var(--green-bright)">TARGET</div>
          <div class="et-marker-price">$${target.toFixed(2)}</div>
          <div class="et-marker-line" style="background:var(--green-bright);opacity:0.6;height:28px;position:absolute;top:${targetLineTop}px;"></div>
        </div>` : `
        <div class="et-marker ${nearTarget ? 'et-marker-below' : 'et-marker-above'} ${editMode ? 'et-marker-drag' : ''}" data-handle="target" style="left:${targetX}%;top:${targetLaneTop}px;opacity:0.6;">
          <div class="et-marker-label" style="color:var(--amber-bright,#fbbf24)">TARGET</div>
          <div class="et-marker-price" style="color:var(--ink-4);">—</div>
        </div>`}
        <div class="et-now-dot" style="left:${markPct}%;top:10px;">
          <div class="et-now-label" style="color:${tone};white-space:nowrap;">NOW · $${mark.toFixed(2)}</div>
          <div class="et-now-stem" style="background:${tone};height:38px;"></div>
          <div class="et-now-circle" style="background:${tone};box-shadow:0 0 14px ${tone},0 0 0 3px var(--bg,#08090d)"></div>
        </div>
      </div>
      <div class="et-ladder-trio">
        <div class="et-trio-cell">
          <div class="et-trio-label">Closing @ Stop</div>
          <div class="et-trio-val" style="color:var(--red-bright)">−$${oneR.toLocaleString()}</div>
          <div class="et-trio-sub" style="color:var(--red-bright)">${entry ? '−' + Math.abs((stop - entry) / entry * 100).toFixed(2) + '%' : '—'}</div>
        </div>
        <div class="et-trio-cell et-trio-center">
          <div class="et-trio-label">Closing Now</div>
          <div class="et-trio-val" style="color:${tone}">${pl >= 0 ? '+$' : '−$'}${Math.abs(Math.round(pl)).toLocaleString()}</div>
          <div class="et-trio-sub" style="color:${tone}">${plPct >= 0 ? '+' : '−'}${Math.abs(plPct).toFixed(2)}%</div>
        </div>
        <div class="et-trio-cell et-trio-right">
          <div class="et-trio-label">Closing @ Target</div>
          <div class="et-trio-val" style="color:var(--green-bright)">${hasTarget ? '+$' + targetDollars.toLocaleString() : '—'}</div>
          <div class="et-trio-sub">${hasTarget ? '$' + target.toFixed(2) + ' · ' + plannedRR.toFixed(2) + ':1 R:R' : 'not set'}</div>
        </div>
      </div>
      ${editMode ? `
      <div class="et-level-inputs">
        <label class="et-level-input">
          <span style="color:var(--red-bright)">STOP</span>
          <input type="number" step="0.01" id="et-input-stop" value="${stop.toFixed(2)}">
        </label>
        <label class="et-level-input">
          <span style="color:${a.c}">ENTRY</span>
          <input type="number" step="0.01" id="et-input-entry" value="${entry.toFixed(2)}">
        </label>
        <label class="et-level-input">
          <span style="color:var(--green-bright)">TARGET</span>
          <input type="number" step="0.01" id="et-input-target" value="${hasTarget ? target.toFixed(2) : ''}" placeholder="—">
        </label>
      </div>` : ''}
    </section>

    ${editMode ? renderManageForms(w, mark, qty, a, isProfit, r) : ''}

    <section class="et-body-grid">
      <div class="et-journal-card" style="grid-column:1 / -1;">
        <div class="et-card-heading">
          <h2 class="et-card-title">Journal</h2>
          ${!isJournalEditing ? `
            <button class="et-journal-edit-btn" id="et-edit-journal-btn" type="button" title="Edit journal note" aria-label="Edit journal note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
              </svg>
            </button>` : ''}
        </div>
        <div class="et-card-meta" style="margin-bottom:6px;">NOTE</div>
        <div class="et-journal-quote" id="et-journal-quote">${isJournalEditing ? renderJournalEditor(w) : renderJournalQuote(w)}</div>
      </div>
    </section>

    <section class="et-timeline-card">
      <div class="et-card-heading" style="margin-bottom:6px;">
        <h2 class="et-card-title">Trade timeline</h2>
        <div class="et-card-meta">${history.length} EVENTS</div>
      </div>
      ${history.map(h => `
        <div class="et-timeline-row">
          <span class="et-tl-time">${h.t}</span>
          <div class="et-tl-dot" style="background:${h.color};box-shadow:0 0 6px ${h.color}"></div>
          <span class="et-tl-text">${h.text}</span>
          <span class="et-tl-kind" style="color:${h.color}">${h.kind}</span>
        </div>`).join('')}
    </section>
  `;

  // Footer — matches the settings sticky-footer pattern (ghost + primary buttons).
  const footer = document.createElement('div');
  footer.className = 'sett-sticky-footer et-sticky-footer';
  if (editMode) {
    const dirty = draftDirty();
    footer.innerHTML = `
      <button class="sett-btn-ghost" id="et-footer-back">← Back</button>
      <div class="et-footer-mid" style="color:${dirty ? 'var(--amber-bright,#fbbf24)' : 'var(--ink-4)'}">
        ${dirty ? '● UNSAVED EDITS' : 'NO CHANGES'}
      </div>
      <button class="sett-btn-ghost" id="et-discard-btn" ${dirty ? '' : 'disabled'}>Discard</button>
      <button class="sett-btn-primary" id="et-save-btn" ${dirty ? '' : 'disabled'}>Save changes →</button>`;
  } else {
    footer.innerHTML = `
      <button class="sett-btn-ghost" id="et-footer-back">← Back to book</button>
      <button class="sett-btn-primary" id="et-enter-edit">Edit trade →</button>`;
  }
  mainEl.appendChild(footer);

  wireEvents(trade, w, { mark, qty, entry, stop, target, a, isLong });

  mainEl.scrollTop = 0;
}

// ── manage forms (edit mode) ──────────────────────────────────────────────
function renderManageForms(w, mark, qty, a, isProfit, r) {
  return `
  <section class="et-manage-grid">
    <div class="et-manage-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Add to position</h2>
        <div class="et-card-meta">AVERAGE ENTRY</div>
      </div>
      <div class="et-form-row">
        <label class="et-form-field">
          <span>Qty</span>
          <input type="number" min="1" id="et-add-qty" value="1">
        </label>
        <label class="et-form-field">
          <span>Fill price</span>
          <input type="number" step="0.01" id="et-add-price" value="${mark.toFixed(2)}">
        </label>
        <button class="et-form-apply" id="et-add-apply" style="color:var(--cyan);background:rgba(6,212,248,0.12);border:1px solid rgba(6,212,248,0.32);">ADD</button>
      </div>
      <div class="et-form-hint" id="et-add-hint">Stages added size and recalculates average entry.</div>
    </div>

    <div class="et-manage-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Scale out</h2>
        <div class="et-card-meta">PARTIAL CLOSE</div>
      </div>
      <div class="et-pct-row">
        ${[25, 50, 75].map(p => `<button class="et-pct-btn" data-pct="${p}">${p}%</button>`).join('')}
      </div>
      <div class="et-form-row">
        <label class="et-form-field">
          <span>Qty</span>
          <input type="number" min="1" max="${qty}" id="et-scale-qty" value="${Math.max(1, Math.floor(qty/2))}">
        </label>
        <label class="et-form-field">
          <span>Fill price</span>
          <input type="number" step="0.01" id="et-scale-price" value="${mark.toFixed(2)}">
        </label>
        <button class="et-form-apply" id="et-scale-apply" style="color:var(--green-bright);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.32);">SCALE OUT</button>
      </div>
      <div class="et-form-hint" id="et-scale-hint">Locks ${fmtR(r * 0.5)} on half · ${qty} ct remaining if 50%.</div>
    </div>

    <div class="et-manage-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Close position</h2>
        <div class="et-card-meta">FULL EXIT</div>
      </div>
      <div class="et-form-row">
        <label class="et-form-field">
          <span>Qty</span>
          <input type="number" min="1" max="${qty}" id="et-close-qty" value="${qty}">
        </label>
        <label class="et-form-field">
          <span>Fill price</span>
          <input type="number" step="0.01" id="et-close-price" value="${mark.toFixed(2)}">
        </label>
        <button class="et-form-apply" id="et-close-apply" style="color:var(--red-bright);background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);">CLOSE</button>
      </div>
      <div class="et-form-hint" id="et-close-hint">Realizes P&amp;L at the fill price you enter.</div>
    </div>
  </section>`;
}

// ── event wiring ───────────────────────────────────────────────────────────
function wireEvents(trade, w, ctx) {
  const mainEl = document.getElementById('edit-trade-main');
  if (!mainEl) return;

  // Mark edit (only in edit mode)
  const markEl = mainEl.querySelector('#et-mark-val');
  if (markEl && editMode) {
    markEl.addEventListener('focus', () => {
      const range = document.createRange();
      range.selectNodeContents(markEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    markEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); markEl.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); markEl.textContent = `$${ctx.mark.toFixed(2)}`; markEl.blur(); }
    });
    markEl.addEventListener('blur', () => {
      const raw = markEl.textContent.replace(/[^0-9.]/g, '');
      const v = parseFloat(raw);
      if (Number.isFinite(v) && v > 0 && Math.abs(v - ctx.mark) > 0.001) {
        draft.mark = v;
        renderEditTrade(trade);
      } else {
        markEl.textContent = `$${ctx.mark.toFixed(2)}`;
      }
    });
  }

  // Level inputs
  if (editMode) {
    const wireLevel = (id, key) => {
      const el = mainEl.querySelector(id);
      if (!el) return;
      el.addEventListener('change', () => {
        const v = parseFloat(el.value);
        if (Number.isFinite(v) && v > 0) {
          draft[key] = v;
          renderEditTrade(trade);
        } else if (el.value === '' && key === 'target') {
          draft.target = null;
          renderEditTrade(trade);
        }
      });
    };
    wireLevel('#et-input-stop', 'stop');
    wireLevel('#et-input-entry', 'entry');
    wireLevel('#et-input-target', 'target');
  }

  // Drag handles
  if (editMode) wireDragHandles(trade, w, ctx);

  // Scale-out form
  if (editMode) {
    mainEl.querySelectorAll('.et-pct-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.pct, 10);
        const q = Math.max(1, Math.floor(ctx.qty * (p / 100)));
        const qtyEl = mainEl.querySelector('#et-scale-qty');
        if (qtyEl) qtyEl.value = q;
      });
    });
    mainEl.querySelector('#et-scale-apply')?.addEventListener('click', () => {
      const q = parseInt(mainEl.querySelector('#et-scale-qty')?.value, 10);
      const px = parseFloat(mainEl.querySelector('#et-scale-price')?.value);
      if (!Number.isFinite(q) || q < 1 || q >= ctx.qty) { toast('Enter qty between 1 and ' + (ctx.qty - 1)); return; }
      if (!Number.isFinite(px) || px <= 0) { toast('Enter a fill price'); return; }
      applyScaleOut(trade, q, px, ctx);
    });
    mainEl.querySelector('#et-add-apply')?.addEventListener('click', () => {
      const q = parseInt(mainEl.querySelector('#et-add-qty')?.value, 10);
      const px = parseFloat(mainEl.querySelector('#et-add-price')?.value);
      if (!Number.isFinite(q) || q < 1) { toast('Enter qty to add'); return; }
      if (!Number.isFinite(px) || px <= 0) { toast('Enter a fill price'); return; }
      applyAddToPosition(trade, q, px, ctx);
    });
    mainEl.querySelector('#et-close-apply')?.addEventListener('click', () => {
      const q  = parseInt(mainEl.querySelector('#et-close-qty')?.value, 10);
      const px = parseFloat(mainEl.querySelector('#et-close-price')?.value);
      if (!Number.isFinite(q) || q < 1) { toast('Enter qty'); return; }
      if (!Number.isFinite(px) || px <= 0) { toast('Enter a fill price'); return; }
      applyCloseAll(trade, q, px, ctx);
    });
  }

  // Repeat setup
  mainEl.querySelector('#et-repeat-setup-btn')?.addEventListener('click', () => {
    if (!w.setup) return;
    const mode = w.mode || 'swing';
    if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
    state.tradeFlow.mode = mode;
    state.tradeFlow.step = 1;
    if (mode === 'intraday') {
      if (!state.intraday) state.intraday = {};
      state.intraday.setup = w.setup;
      state.intraday.direction = ctx.isLong ? 'long' : 'short';
    } else {
      state.selectedSetup = w.setup;
      state.direction = ctx.isLong ? 'long' : 'short';
    }
    saveState();
    closeEditTrade();
    if (typeof window.setTab === 'function') window.setTab('trade');
    if (typeof window.renderTrade === 'function') window.renderTrade();
    toast(`Repeating ${w.setup}`);
  });

  mainEl.querySelector('#et-edit-journal-btn')?.addEventListener('click', () => {
    journalEditOnRender = true;
    if (!editMode) enterEditMode(trade);
    else renderEditTrade(trade);
  });
  mainEl.querySelector('#et-journal-cancel')?.addEventListener('click', () => {
    journalEditOnRender = false;
    renderEditTrade(trade);
  });
  mainEl.querySelector('#et-journal-save')?.addEventListener('click', () => {
    if (!draft) return;
    draft.journal = (mainEl.querySelector('#et-journal-edit')?.value || '').trim();
    draft.thesis = draft.journal;
    draft.notes = '';
    delete draft.runningNotes;
    journalEditOnRender = false;
    renderEditTrade(trade);
  });
  if (journalEditOnRender) mainEl.querySelector('#et-journal-edit')?.focus();

  // Footer actions
  const footer = mainEl.querySelector('.et-sticky-footer');
  footer?.querySelector('#et-footer-back')?.addEventListener('click', handleBack(trade));
  footer?.querySelector('#et-enter-edit')?.addEventListener('click', () => enterEditMode(trade));
  footer?.querySelector('#et-save-btn')?.addEventListener('click', () => {
    if (!draftDirty()) return;
    commitDraft(trade);
    toast('Changes saved');
    exitEditMode(trade);
    if (typeof window.refreshAllUI === 'function') window.refreshAllUI();
  });
  footer?.querySelector('#et-discard-btn')?.addEventListener('click', () => {
    if (!draftDirty()) return;
    if (!confirm('Discard all unsaved edits?')) return;
    exitEditMode(trade);
    toast('Edits discarded');
  });
}

function handleBack(trade) {
  return () => {
    if (editMode && draftDirty()) {
      if (!confirm('Discard unsaved edits and leave?')) return;
    }
    closeEditTrade();
  };
}

// ── drag handles ──────────────────────────────────────────────────────────
function wireDragHandles(trade, w, ctx) {
  const ladder = document.getElementById('et-ladder');
  if (!ladder) return;
  const stopX = 8, entryX = 32, targetX = 92;

  // Use stop/entry actual prices to define the price-per-pixel scale.
  // We map the current stop position (stopX%) to current stop price and entry position (entryX%) to entry price.
  // From those two anchors derive: price(percent) = entry + (percent - entryX) * pricePerPercent
  const stop = parseFloat(w.stop || 0);
  const entry = parseFloat(w.entry || w.premium || 0);
  if (!entry || !stop || stop === entry) return;
  const pricePerPercent = (entry - stop) / (entryX - stopX);
  const percentToPrice = (pct) => {
    const v = entry + (pct - entryX) * pricePerPercent;
    return Math.round(v * 100) / 100;
  };

  ladder.querySelectorAll('.et-marker-drag').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const which = handle.dataset.handle;
      const rect = ladder.getBoundingClientRect();
      try { handle.setPointerCapture?.(e.pointerId); } catch {}
      handle.classList.add('is-dragging');

      const onMove = (ev) => {
        const x = ev.clientX - rect.left;
        const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
        const price = percentToPrice(pct);
        if (!Number.isFinite(price) || price <= 0) return;
        if (which === 'stop')   draft.stop = price;
        if (which === 'entry')  draft.entry = price;
        if (which === 'target') draft.target = price;
        const label = handle.querySelector('.et-marker-price');
        if (label) label.textContent = '$' + price.toFixed(2);
      };
      const onUp = () => {
        handle.classList.remove('is-dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        renderEditTrade(trade);
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  });
}

// ── manage actions ────────────────────────────────────────────────────────
function applyScaleOut(trade, q, px, ctx) {
  const newQty = ctx.qty - q;
  if (newQty < 1) { toast('Use Close to fully exit'); return; }
  draft.qty = newQty;
  if (draft.shares != null) draft.shares = newQty;
  if (draft.contracts != null) draft.contracts = newQty;
  draft.scaleOuts = Array.isArray(draft.scaleOuts) ? draft.scaleOuts : [];
  draft.scaleOuts.push({ qty: q, price: px, at: new Date().toISOString() });
  const realized = (px - parseFloat(draft.entry || draft.premium || 0)) * q * (ctx.isLong ? 1 : -1);
  draft.realized = (parseFloat(draft.realized) || 0) + realized;
  renderEditTrade(trade);
  toast(`${q} scaled out · ${newQty} remaining (save to commit)`);
}

function applyAddToPosition(trade, q, px, ctx) {
  const newQty = ctx.qty + q;
  const currentEntry = parseFloat(draft.entry || draft.premium || 0) || ctx.entry || px;
  const avgEntry = ((currentEntry * ctx.qty) + (px * q)) / newQty;
  draft.qty = newQty;
  if (draft.shares != null) draft.shares = newQty;
  if (draft.contracts != null) draft.contracts = newQty;
  if (draft.entry != null) draft.entry = +avgEntry.toFixed(4);
  if (draft.premium != null) draft.premium = +avgEntry.toFixed(4);
  draft.addOns = Array.isArray(draft.addOns) ? draft.addOns : [];
  draft.addOns.push({ qty: q, price: px, at: new Date().toISOString() });
  const stop = parseFloat(draft.stop || 0);
  if (stop > 0) {
    draft.riskDollars = Math.round(Math.abs(avgEntry - stop) * newQty * tradeMultiplier(draft));
  }
  renderEditTrade(trade);
  toast(`Added ${q} · ${newQty} total (save to commit)`);
}

function applyCloseAll(trade, q, px, ctx) {
  if (q < ctx.qty) {
    // Partial close routed through scale-out
    applyScaleOut(trade, q, px, ctx);
    return;
  }
  if (!confirm(`Close ${q} ${ctx.isLong ? 'long' : 'short'} @ $${px.toFixed(2)}? This commits immediately.`)) return;
  // Closing is destructive — commit immediately rather than staging.
  Object.assign(trade, draft);
  trade.status = 'closed';
  trade.exit = px;
  trade.exit_date = new Date().toISOString().slice(0, 10);
  trade.exitDate = trade.exit_date;
  trade.closedAt = new Date().toISOString();
  trade.updated_at = trade.closedAt;
  saveState();
  toast(`Closed ${trade.ticker || ''} @ $${px.toFixed(2)}`);
  closeEditTrade();
  if (typeof window.refreshAllUI === 'function') window.refreshAllUI();
}

// ── journal helpers ───────────────────────────────────────────────────────
function renderJournalQuote(w) {
  const text = w.journal || w.thesis || w.notes || '';
  if (!text) return '<span style="color:var(--ink-4);font-style:italic;">No note recorded.</span>';
  return `"${escapeHtml(text)}"`;
}
function renderJournalEditor(w) {
  const current = w.journal || w.thesis || w.notes || '';
  return `
    <textarea class="et-note-area" id="et-journal-edit" style="width:100%;min-height:110px;">${escapeHtml(current)}</textarea>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn-primary btn-compact" id="et-journal-save" type="button">SAVE</button>
      <button class="btn-secondary btn-compact" id="et-journal-cancel" type="button">CANCEL</button>
    </div>`;
}

// ── misc helpers ──────────────────────────────────────────────────────────
function formatOpened(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    const tm = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} · ${tm}`;
  } catch { return '—'; }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildHistory(trade, accentColor, toneColor) {
  const events = [];
  const d = new Date(trade.openedAt || trade.created_at || trade.date || trade.opened || Date.now());
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const qty = trade.qty || trade.contracts || trade.shares || 1;
  const entry = parseFloat(trade.entry || trade.premium || 0);
  const stop  = parseFloat(trade.stop || 0);
  const mark  = parseFloat(trade.mark || trade.currentPrice || entry);
  const mult  = tradeMultiplier(trade);
  const oneR  = Math.round(tradeRiskDollars(trade) || (Math.abs(entry - stop) * qty * mult)) || 0;

  events.push({
    t: `${dateStr} ${timeStr}`,
    kind: 'FILL',
    text: `BUY ${qty} @ $${entry.toFixed(2)} · 1R = $${oneR}`,
    color: accentColor,
  });

  if (Array.isArray(trade.scaleOuts)) {
    trade.scaleOuts.forEach(s => {
      const sd = new Date(s.at || Date.now());
      events.push({
        t: sd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        kind: 'SCALE',
        text: `Scaled out ${s.qty} @ $${(+s.price).toFixed(2)}`,
        color: 'var(--green-bright)',
      });
    });
  }

  if (Array.isArray(trade.addOns)) {
    trade.addOns.forEach(a => {
      const ad = new Date(a.at || Date.now());
      events.push({
        t: ad.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        kind: 'ADD',
        text: `Added ${a.qty} @ $${(+a.price).toFixed(2)}`,
        color: 'var(--cyan)',
      });
    });
  }

  if (trade.journal || trade.thesis) {
    events.push({
      t: 'entry note',
      kind: 'NOTE',
      text: (trade.journal || trade.thesis || '').slice(0, 120) + ((trade.journal || trade.thesis || '').length > 120 ? '…' : ''),
      color: 'var(--ink-3)',
    });
  }

  const pl = calcPL(trade);
  const r = (pl != null && oneR) ? (pl / oneR) : 0;
  const plStr = pl != null ? fmt$(pl) : `${(mark - entry) * qty * mult >= 0 ? '+$' : '−$'}${Math.abs((mark - entry) * qty * mult).toFixed(0)}`;
  events.unshift({
    t: 'now',
    kind: 'MARK',
    text: `Mark $${mark.toFixed(2)} · ${r >= 0 ? '+' : ''}${r.toFixed(2)}R · P/L ${plStr}`,
    color: toneColor,
  });

  return events;
}

// ── global expose ─────────────────────────────────────────────────────────
window.openEditTrade  = openEditTrade;
window.closeEditTrade = closeEditTrade;
