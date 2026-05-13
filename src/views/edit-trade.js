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
let activeManagePanel = null;

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
function fmtPlain$(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '$0';
  return '$' + Math.round(Math.abs(n)).toLocaleString();
}
function fmtPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? '$' + n.toFixed(2) : '—';
}
function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—';
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

function qtyLabel(w, qty) {
  const unit = (w.mode === 'intraday' || w.instrument === 'options') ? 'ctr' : 'sh';
  return `${qty} ${unit}`;
}

function getFrozenSnapshot(trade) {
  const snap = trade.setupSnapshot && typeof trade.setupSnapshot === 'object'
    ? trade.setupSnapshot
    : {};
  if (Object.keys(snap).length) return snap;
  const qty = trade.qty || trade.contracts || trade.shares || 1;
  return {
    capturedAt: trade.openedAt || trade.created_at || trade.date || null,
    mode: trade.mode || 'swing',
    instrument: trade.instrument || trade.structure || 'options',
    structure: trade.structure || trade.instrument || '',
    ticker: trade.ticker || trade.symbol || '',
    setup: trade.setup || trade.selectedSetup || '',
    direction: trade.direction || trade.dir || 'Long',
    entry: trade.entry || trade.premium || null,
    stop: trade.stop || null,
    limit: trade.target || null,
    target: trade.target || null,
    qty,
    riskDollars: trade.riskDollars || null,
    regime: trade.regime || null,
    regimeAtEntry: trade.regimeAtEntry || trade.regime || null,
    ivr: trade.ivr ?? null,
    saQuant: trade.saQuant ?? null,
    saProfitGrade: trade.saProfitGrade || null,
    saMomentumGrade: trade.saMomentumGrade || null,
    stopUnderlying: trade.stopUnderlying || null,
    bid: trade.bid ?? null,
    ask: trade.ask ?? null,
    mid: trade.mid ?? null,
    spreadPct: trade.spreadPct ?? null,
    orbType: trade.orbType || null,
    orHi: trade.orHi ?? null,
    orLo: trade.orLo ?? null,
    orRng: trade.orRng ?? null,
    confluence: trade.confluence || '',
    breadth: trade.breadth || '',
    vwapValue: trade.vwapValue ?? null,
    notes: trade.notes || trade.thesis || '',
  };
}

function snapshotRows(trade) {
  const s = getFrozenSnapshot(trade);
  const rows = [
    ['Setup', s.setup || '—'],
    ['Macro regime', (s.regimeAtEntry || s.regime || '—').toString().toUpperCase()],
    ['Direction', `${(s.direction || '—').toString().toUpperCase()}${s.mode ? ' · ' + s.mode : ''}`],
    ['Instrument', s.instrument || s.structure || '—'],
    ['Entry', fmtPrice(s.entry)],
    ['Stop', fmtPrice(s.stop)],
    ['Limit', fmtPrice(s.limit || s.target)],
    ['Qty', s.qty || '—'],
    ['Risk $', s.riskDollars ? fmtPlain$(s.riskDollars) : '—'],
  ];
  if (s.ivr !== null && s.ivr !== undefined && s.ivr !== '') rows.push(['IVR', s.ivr]);
  if (s.saQuant !== null && s.saQuant !== undefined && s.saQuant !== '') rows.push(['SA Quant', s.saQuant]);
  if (s.saProfitGrade) rows.push(['Profit grade', s.saProfitGrade]);
  if (s.saMomentumGrade) rows.push(['Momentum', s.saMomentumGrade]);
  if (s.stopUnderlying) rows.push(['Underlying stop', fmtPrice(s.stopUnderlying)]);
  if (s.bid !== null && s.bid !== undefined && s.bid !== '') rows.push(['Bid', fmtPrice(s.bid)]);
  if (s.ask !== null && s.ask !== undefined && s.ask !== '') rows.push(['Ask', fmtPrice(s.ask)]);
  if (s.mid !== null && s.mid !== undefined && s.mid !== '') rows.push(['Mid', fmtPrice(s.mid)]);
  if (s.spreadPct !== null && s.spreadPct !== undefined && s.spreadPct !== '') rows.push(['Spread', `${Number(s.spreadPct).toFixed(1)}%`]);
  if (s.orbType) rows.push(['OR type', `${s.orbType}m`]);
  if (s.orHi !== null && s.orHi !== undefined && s.orHi !== '') rows.push(['OR high', fmtPrice(s.orHi)]);
  if (s.orLo !== null && s.orLo !== undefined && s.orLo !== '') rows.push(['OR low', fmtPrice(s.orLo)]);
  if (s.orRng !== null && s.orRng !== undefined && s.orRng !== '') rows.push(['OR range', Number(s.orRng).toFixed(2)]);
  if (s.confluence) rows.push(['Confluence', s.confluence]);
  if (s.breadth) rows.push(['Breadth', s.breadth]);
  if (s.vwapValue !== null && s.vwapValue !== undefined && s.vwapValue !== '') rows.push(['VWAP', fmtPrice(s.vwapValue)]);
  return rows;
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
  overlay.onclick = (e) => {
    if (e.target === overlay) handleBack(trade)();
  };
  editMode = false;
  draft = null;
  originalSnapshot = null;
  activeManagePanel = null;
  renderEditTrade(trade);
}

export function closeEditTrade() {
  const overlay = document.getElementById('edit-trade-overlay');
  if (overlay) overlay.classList.remove('show');
  editMode = false;
  draft = null;
  originalSnapshot = null;
  journalEditOnRender = false;
  activeManagePanel = null;
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
  activeManagePanel = null;
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
  const openedDateStr = openedAt ? formatOpenedDate(openedAt) : '—';
  const isJournalEditing = editMode && journalEditOnRender;

  // ── drawer chrome ───────────────────────────────────────────────────────
  const navBar = document.getElementById('edit-trade-nav-bar');
  if (navBar) navBar.innerHTML = '';

  const snapshot = getFrozenSnapshot(trade);
  const snapshotTime = snapshot.capturedAt ? formatOpened(snapshot.capturedAt) : openedStr;
  const snapshotHtml = snapshotRows(trade).map(([label, value]) => `
    <div class="et-snap-cell">
      <div class="et-snap-label">${escapeHtml(label)}</div>
      <div class="et-snap-val">${escapeHtml(value)}</div>
    </div>`).join('');
  const percentAway = hasTarget && mark > 0 ? Math.max(0, Math.abs((target - mark) / mark * 100)) : null;
  const inputReadOnly = editMode ? '' : 'readonly';
  const editHint = editMode ? 'EDITING' : 'READ ONLY';

  // ── body html ───────────────────────────────────────────────────────────
  mainEl.innerHTML = `
    <section class="et-drawer-head">
      <div>
        <div class="et-drawer-kicker">Edit open trade</div>
        <div class="et-title-row">
          <h1 class="et-ticker">${escapeHtml((w.ticker || w.symbol || '—').toUpperCase())}</h1>
          <span class="et-pill et-pill-open">Open</span>
          <span class="et-pill ${isLong ? 'et-pill-long' : 'et-pill-short'}">${isLong ? 'Long' : 'Short'}</span>
          <span class="et-pill ${mode === 'intraday' ? 'et-pill-intra' : 'et-pill-swing'}">${mode}</span>
        </div>
        <div class="et-open-meta">Opened ${openedDateStr} · ${daysHeld(openedAt)} days held</div>
      </div>
      <div class="et-head-actions">
        <button class="et-icon-btn" id="et-enter-edit-icon" type="button" title="Edit entry, stop, and limit" aria-label="Edit entry, stop, and limit" ${editMode ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
        </button>
      </div>
    </section>

    <section class="et-top-stats" aria-label="Open trade numbers">
      <div>
        <div class="et-pnl-label">Open risk: $</div>
        <div class="et-pnl-val" style="color:var(--ink)">${fmtPlain$(oneR)}</div>
      </div>
      <div>
        <div class="et-pnl-label">To Make: $</div>
        <div class="et-pnl-val" style="color:var(--green-bright)">${hasTarget ? fmtPlain$(targetDollars) : '—'}</div>
      </div>
      <div>
        <div class="et-pnl-label">% Away</div>
        <div class="et-pnl-val" style="color:${hasTarget ? 'var(--cyan)' : 'var(--ink-4)'}">${percentAway === null ? '—' : percentAway.toFixed(1) + '%'}</div>
      </div>
    </section>

    <section class="et-snapshot-card" style="background:rgba(10,13,20,0.72);border:1px solid rgba(119,154,199,0.22);">
      <div class="et-card-heading">
        <h2 class="et-card-title">Setup snapshot</h2>
        <div class="et-card-meta"><span class="et-lock-dot">LOCKED</span> · ${snapshotTime}</div>
      </div>
      <div class="et-snapshot-grid">${snapshotHtml}</div>
    </section>

    <section class="et-position-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Position</h2>
        <div class="et-card-meta">${editHint}</div>
      </div>
      <div class="et-position-grid">
        <label class="et-form-field">
          <span>Qty</span>
          <input type="number" min="1" id="et-input-qty" value="${qty}" readonly>
        </label>
        <label class="et-form-field">
          <span>Avg entry</span>
          <input type="number" step="0.01" id="et-input-entry" value="${entry ? entry.toFixed(2) : ''}" ${inputReadOnly}>
        </label>
        <label class="et-form-field">
          <span>Stop</span>
          <input type="number" step="0.01" id="et-input-stop" value="${stop ? stop.toFixed(2) : ''}" ${inputReadOnly}>
        </label>
        <label class="et-form-field">
          <span>Limit</span>
          <input type="number" step="0.01" id="et-input-target" value="${hasTarget ? target.toFixed(2) : ''}" placeholder="—" ${inputReadOnly}>
        </label>
        <label class="et-form-field">
          <span>Mark</span>
          <input type="number" step="0.01" id="et-input-mark" value="${mark ? mark.toFixed(2) : ''}">
        </label>
        <label class="et-form-field">
          <span>Risk $</span>
          <input type="number" id="et-input-risk" value="${oneR}" readonly>
        </label>
      </div>
    </section>

    <section class="et-actions-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Actions</h2>
      </div>
      <div class="et-action-buttons">
        <button class="et-action-outline ${activeManagePanel === 'add' ? 'active' : ''}" id="et-action-add" type="button">+ Add to position</button>
        <button class="et-action-outline ${activeManagePanel === 'partial' ? 'active' : ''}" id="et-action-partial" type="button">- Close Partial</button>
        <button class="et-action-outline danger ${activeManagePanel === 'close' ? 'active' : ''}" id="et-action-close" type="button">× Close Trade</button>
      </div>
    </section>

    ${editMode ? renderManageForms(w, mark, qty, a, isProfit, r) : ''}

    <section class="et-journal-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Journal</h2>
        ${!isJournalEditing ? `
          <button class="et-journal-edit-btn" id="et-edit-journal-btn" type="button" title="Add journal note" aria-label="Add journal note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
            </svg>
          </button>` : ''}
      </div>
      <div class="et-journal-quote" id="et-journal-quote">${isJournalEditing ? renderJournalEditor(w) : renderJournalQuote(w)}</div>
    </section>

    <section class="et-timeline-card">
      <div class="et-card-heading" style="margin-bottom:6px;">
        <h2 class="et-card-title">Trade timeline</h2>
        <div class="et-card-meta">${history.length} events</div>
      </div>
      ${history.map(h => `
        <div class="et-timeline-row">
          <span class="et-tl-time">${h.t}</span>
          <div class="et-tl-dot" style="background:${h.color};box-shadow:0 0 6px ${h.color}"></div>
          <span class="et-tl-text">${escapeHtml(h.text)}</span>
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
      <button class="sett-btn-primary" id="et-save-btn" ${dirty ? '' : 'disabled'}>Save changes →</button>`;
  } else {
    footer.innerHTML = `
      <button class="sett-btn-ghost" id="et-footer-back">Cancel</button>
      <button class="sett-btn-primary" id="et-enter-edit" disabled>Save changes</button>`;
  }
  mainEl.appendChild(footer);

  wireEvents(trade, w, { mark, qty, entry, stop, target, a, isLong });

  mainEl.scrollTop = 0;
}

// ── manage forms (edit mode) ──────────────────────────────────────────────
function renderManageForms(w, mark, qty, a, isProfit, r) {
  if (!activeManagePanel) return '';

  const panels = {
    add: `
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
      <div class="et-form-hint" id="et-add-hint">Stages added size and recalculates average entry.</div>`,
    partial: `
      <div class="et-card-heading">
        <h2 class="et-card-title">Close partial</h2>
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
        <button class="et-form-apply" id="et-scale-apply" style="color:var(--green-bright);background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.32);">CLOSE PARTIAL</button>
      </div>
      <div class="et-form-hint" id="et-scale-hint">Locks ${fmtR(r * 0.5)} on half · ${qty} ct remaining if 50%.</div>`,
    close: `
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
      <div class="et-form-hint" id="et-close-hint">Realizes P&amp;L at the fill price you enter.</div>`,
  };

  return `
  <section class="et-manage-grid" id="et-manage-panel">
    <div class="et-manage-card ${activeManagePanel === 'close' ? 'danger' : ''}">
      ${panels[activeManagePanel] || ''}
    </div>
  </section>`;
}

// ── event wiring ───────────────────────────────────────────────────────────
function wireEvents(trade, w, ctx) {
  const mainEl = document.getElementById('edit-trade-main');
  if (!mainEl) return;

  mainEl.querySelector('#et-enter-edit-icon')?.addEventListener('click', () => {
    activeManagePanel = null;
    enterEditMode(trade);
  });

  const revealManage = (panel) => {
    activeManagePanel = panel;
    if (!editMode) {
      enterEditMode(trade);
      setTimeout(() => {
        document.getElementById('et-manage-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
      return;
    }
    renderEditTrade(trade);
    const el = document.getElementById('et-manage-panel');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  mainEl.querySelector('#et-action-add')?.addEventListener('click', () => revealManage('add'));
  mainEl.querySelector('#et-action-partial')?.addEventListener('click', () => revealManage('partial'));
  mainEl.querySelector('#et-action-close')?.addEventListener('click', () => revealManage('close'));

  // Mark can be edited without entering full edit mode. In view mode it saves immediately.
  const markInput = mainEl.querySelector('#et-input-mark');
  if (markInput) {
    markInput.addEventListener('change', () => {
      const v = parseFloat(markInput.value);
      if (!Number.isFinite(v) || v <= 0) {
        markInput.value = ctx.mark.toFixed(2);
        toast('Enter a mark price');
        return;
      }
      if (Math.abs(v - ctx.mark) <= 0.001) return;
      if (editMode) {
        draft.mark = v;
        renderEditTrade(trade);
        return;
      }
      trade.mark = v;
      trade.currentPrice = v;
      trade.updated_at = new Date().toISOString();
      saveState();
      if (typeof window.refreshAllUI === 'function') window.refreshAllUI();
      renderEditTrade(trade);
      toast('Mark price updated');
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
          if (key === 'entry' && draft.premium != null) draft.premium = v;
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
    if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '' };
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
    const text = (mainEl.querySelector('#et-journal-edit')?.value || '').trim();
    if (!text) { toast('Write a journal note first'); return; }
    draft.journalEntries = Array.isArray(draft.journalEntries) ? draft.journalEntries : [];
    draft.journalEntries.push({
      id: 'jn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      text,
      at: new Date().toISOString(),
    });
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
  toast(`${q} closed partial · ${newQty} remaining (save to commit)`);
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
  const entries = Array.isArray(w.journalEntries)
    ? [...w.journalEntries].filter(n => n && n.text).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    : [];
  const entryNote = w.journal || w.thesis || w.notes || '';
  if (!entries.length && !entryNote) return '<span style="color:var(--ink-4);font-style:italic;">No note recorded.</span>';
  return `
    <div class="et-journal-list">
      ${entries.map(n => `
        <div class="et-journal-entry">
          <div class="et-journal-entry-meta">${escapeHtml(formatTimelineTime(n.at || Date.now()))}</div>
          <div class="et-journal-entry-text">${escapeHtml(n.text)}</div>
        </div>`).join('')}
      ${entryNote ? `
        <div class="et-journal-entry muted">
          <div class="et-journal-entry-meta">Entry note</div>
          <div class="et-journal-entry-text">${escapeHtml(entryNote)}</div>
        </div>` : ''}
    </div>`;
}
function renderJournalEditor(w) {
  return `
    <textarea class="et-note-area" id="et-journal-edit" style="width:100%;min-height:110px;" placeholder="Add a new journal note"></textarea>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn-primary btn-compact" id="et-journal-save" type="button">ADD NOTE</button>
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

function formatOpenedDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  } catch { return '—'; }
}

function formatTimelineTime(date, includeDay = false) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  if (Number.isNaN(d.getTime())) return '—';
  const tm = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (!includeDay) return tm;
  const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  return `${day} ${tm}`;
}

function daysHeld(iso) {
  if (!iso) return 0;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const now = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildHistory(trade, accentColor, toneColor) {
  const events = [];
  const d = new Date(trade.openedAt || trade.created_at || trade.date || trade.opened || Date.now());
  const openTs = Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
  const qty = trade.qty || trade.contracts || trade.shares || 1;
  const entry = parseFloat(trade.entry || trade.premium || 0);
  const stop  = parseFloat(trade.stop || 0);
  const mark  = parseFloat(trade.mark || trade.currentPrice || entry);
  const mult  = tradeMultiplier(trade);
  const oneR  = Math.round(tradeRiskDollars(trade) || (Math.abs(entry - stop) * qty * mult)) || 0;

  events.push({
    ts: openTs,
    t: formatTimelineTime(d, true),
    kind: 'FILL',
    text: `BUY ${qty} @ $${entry.toFixed(2)} · 1R = $${oneR}`,
    color: accentColor,
  });

  if (Array.isArray(trade.scaleOuts)) {
    trade.scaleOuts.forEach(s => {
      const sd = new Date(s.at || Date.now());
      events.push({
        ts: Number.isNaN(sd.getTime()) ? Date.now() : sd.getTime(),
        t: formatTimelineTime(sd),
        kind: 'SCALE',
        text: `Closed partial ${s.qty} @ $${(+s.price).toFixed(2)}`,
        color: 'var(--green-bright)',
      });
    });
  }

  if (Array.isArray(trade.addOns)) {
    trade.addOns.forEach(a => {
      const ad = new Date(a.at || Date.now());
      events.push({
        ts: Number.isNaN(ad.getTime()) ? Date.now() : ad.getTime(),
        t: formatTimelineTime(ad),
        kind: 'ADD',
        text: `Added ${a.qty} @ $${(+a.price).toFixed(2)}`,
        color: 'var(--cyan)',
      });
    });
  }

  if (Array.isArray(trade.journalEntries)) {
    trade.journalEntries.forEach(n => {
      if (!n || !n.text) return;
      const nd = new Date(n.at || Date.now());
      events.push({
        ts: Number.isNaN(nd.getTime()) ? Date.now() : nd.getTime(),
        t: formatTimelineTime(nd),
        kind: 'NOTE',
        text: n.text.slice(0, 140) + (n.text.length > 140 ? '...' : ''),
        color: 'var(--ink-3)',
      });
    });
  }

  if (trade.journal || trade.thesis) {
    events.push({
      ts: openTs - 1,
      t: 'entry note',
      kind: 'NOTE',
      text: (trade.journal || trade.thesis || '').slice(0, 120) + ((trade.journal || trade.thesis || '').length > 120 ? '…' : ''),
      color: 'var(--ink-3)',
    });
  }

  const pl = calcPL(trade);
  const r = (pl != null && oneR) ? (pl / oneR) : 0;
  const plStr = pl != null ? fmt$(pl) : `${(mark - entry) * qty * mult >= 0 ? '+$' : '−$'}${Math.abs((mark - entry) * qty * mult).toFixed(0)}`;
  events.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  if ((trade.status || 'open') === 'open') events.unshift({
    ts: Date.now(),
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
