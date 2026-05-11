// Edit Trade — full-page overlay for managing an open position.
// Simplified per design: hero · price ladder · three wired actions · sidebar · timeline · footer.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { calcPL } from '../models/trade.js';

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
function ageLabel(opened) {
  if (!opened) return '';
  const d = new Date(opened);
  if (isNaN(d)) return '';
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  if (days === 0) return 'TODAY';
  if (days === 1) return '1D AGO';
  return `${days}D AGO`;
}
function toast(msg) {
  if (typeof window.toast === 'function') window.toast(msg);
}

// ── main renderer ─────────────────────────────────────────────────────────
export function openEditTrade(tradeId) {
  const overlay = document.getElementById('edit-trade-overlay');
  const mainEl  = document.getElementById('edit-trade-main');
  if (!overlay || !mainEl) return;

  const trade = (state.trades || []).find(t => t.id === tradeId);
  if (!trade) return;

  overlay.dataset.tradeId = tradeId;
  overlay.classList.add('show');
  renderEditTrade(trade);
}

function renderEditTrade(trade) {
  const overlay = document.getElementById('edit-trade-overlay');
  const mainEl  = document.getElementById('edit-trade-main');
  if (!overlay || !mainEl) return;

  const mode     = trade.mode || 'swing';
  const a        = modeAccent(mode);
  const entry    = parseFloat(trade.entry || trade.premium || 0);
  const stop     = parseFloat(trade.stop || 0);
  const target   = parseFloat(trade.target || 0);
  const mark     = parseFloat(trade.mark || trade.currentPrice || entry);
  const qty      = trade.qty || trade.contracts || trade.shares || 1;
  const edge     = (trade.edge || trade.setup_edge || '').toUpperCase() || null;

  const dirRaw   = (trade.direction || trade.dir || 'long').toLowerCase();
  const isLong   = !dirRaw.startsWith('s');
  const gainPerUnit = (mark - entry) * (isLong ? 1 : -1);
  const pl       = gainPerUnit * qty;
  const isProfit = pl >= 0;
  const tone     = isProfit ? 'var(--green-bright)' : 'var(--red-bright)';
  const riskPerUnit = Math.abs(entry - stop) || 1;
  const r        = gainPerUnit / riskPerUnit;
  const plPct    = entry ? (gainPerUnit / entry * 100) : 0;
  const oneR     = Math.round(Math.abs(riskPerUnit) * qty);

  // Price ladder geometry — fixed visual positions so STOP→ENTRY→TARGET always reads left→right.
  const hasTarget = target > 0 && Number.isFinite(target) && target !== entry;
  const stopX   = 8;
  const entryX  = 32;
  const targetX = 92;
  // Mark progresses from stop (0) → target (1). Sign flips for shorts.
  const progressDen = hasTarget ? (isLong ? (target - stop) : (stop - target)) : (isLong ? (entry - stop) : (stop - entry));
  const progressNum = isLong ? (mark - stop) : (stop - mark);
  const progress    = progressDen ? Math.max(-0.2, Math.min(1.2, progressNum / progressDen)) : 0;
  const markPct     = Math.max(2, Math.min(97, stopX + progress * (targetX - stopX)));

  // Progress context
  const pctToTarget = hasTarget ? Math.round((isLong ? (mark - entry) / (target - entry) : (entry - mark) / (entry - target)) * 100) : 0;
  const pctToStop   = entry !== stop ? Math.round((isLong ? (mark - stop) / (entry - stop) : (stop - mark) / (stop - entry)) * 100) : 100;
  const ctxLeft = !hasTarget
    ? `<strong style="color:var(--amber-bright,#fbbf24)">No target set.</strong> Add one to track progress vs. risk.`
    : isProfit
      ? `<strong style="color:var(--green-bright)">${pctToTarget}% to target.</strong> Price ${Math.abs(plPct).toFixed(1)}% ${isLong ? 'above' : 'below'} entry · trail to BE recommended.`
      : `<strong style="color:var(--red-bright)">${pctToStop}% buffer to stop.</strong> Price ${Math.abs(plPct).toFixed(1)}% ${isLong ? 'below' : 'above'} entry · monitor closely.`;

  // Highest mark today (fallback to current mark if not tracked)
  const highestMark = Math.max(mark, parseFloat(trade.highMark || trade.dayHigh || mark) || mark);

  // Status line bits
  const opened = trade.opened || trade.date || trade.openedAt;
  const od = opened ? new Date(opened) : null;
  const dayTag = od && !isNaN(od) ? od.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() : '—';
  const timeTag = od && !isNaN(od) ? od.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' ET' : '';

  const history = buildHistory(trade, a.c, tone);

  // Nav
  const navBar = document.getElementById('edit-trade-nav-bar');
  if (navBar) {
    navBar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 28px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(8,9,13,0.8);backdrop-filter:blur(8px);">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" id="et-brand-home" title="Back to Home">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 21H3"></path><path d="M3 14l5-5 4 4 9-9"></path>
          </svg>
          <span style="font-family:var(--display);font-weight:700;font-size:14px;letter-spacing:0.04em;color:var(--ink);">TRAPPER'S <span style="color:var(--ink-4)">EDGE</span></span>
        </div>
        <div class="et-breadcrumb">
          <span>OPEN BOOK</span>
          <span class="et-breadcrumb-sep">›</span>
          <span class="et-breadcrumb-active">EDIT · ${(trade.ticker || trade.symbol || '—').toUpperCase()} ${(isLong ? 'LONG' : 'SHORT')}</span>
          <span class="et-breadcrumb-sep">·</span>
          <span>POSITION #${String(trade.id || '').slice(-4).toUpperCase() || '—'}</span>
        </div>
        <button class="et-btn-back" id="et-close-btn">← BACK TO BOOK</button>
      </div>`;
    navBar.querySelector('#et-close-btn').addEventListener('click', closeEditTrade);
    navBar.querySelector('#et-brand-home').addEventListener('click', () => {
      closeEditTrade();
      if (typeof window.setTab === 'function') window.setTab('home');
    });
  }

  mainEl.innerHTML = `
    <section class="et-hero ${isProfit ? 'et-hero-profit' : 'et-hero-loss'}">
      <div class="et-hero-left">
        <div class="et-hero-status" style="color:${tone}">
          <div class="et-hero-status-dot" style="background:${tone};box-shadow:0 0 8px ${tone}"></div>
          OPEN · ${dayTag} · ${ageLabel(opened)} ${timeTag ? '· ' + timeTag : ''}
        </div>
        <div class="et-ticker-row">
          <h1 class="et-ticker">${(trade.ticker || trade.symbol || '—').toUpperCase()}</h1>
          <span class="et-pill ${isLong ? 'et-pill-long' : 'et-pill-short'}">${isLong ? 'LONG' : 'SHORT'}</span>
          <span class="et-pill ${mode === 'intraday' ? 'et-pill-intra' : 'et-pill-swing'}">${mode}</span>
          <span class="et-qty-note">${qty} sh · 1R = $${oneR}</span>
        </div>
      </div>
      <div class="et-pnl-grid">
        <div>
          <div class="et-pnl-label">Unrealized</div>
          <div class="et-pnl-val" style="color:${tone}">${fmt$(pl)}</div>
          <div class="et-pnl-sub" style="color:${tone}">${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%</div>
        </div>
        <div>
          <div class="et-pnl-label">R-Multiple</div>
          <div class="et-pnl-val" style="color:${tone}">${fmtR(r)}</div>
          <div class="et-pnl-sub">vs 1R risk</div>
        </div>
        <div>
          <div class="et-pnl-label">Mark</div>
          <div class="et-pnl-val" style="color:var(--ink)">$${mark.toFixed(2)}</div>
          <div class="et-pnl-sub">NBBO · live</div>
        </div>
      </div>
    </section>

    <section class="et-ladder-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Price ladder</h2>
        <div class="et-card-meta">STOP → ENTRY → TARGET</div>
      </div>
      <div class="et-ladder">
        <div class="et-ladder-track">
          <div class="et-ladder-fill" style="background:linear-gradient(90deg,rgba(239,68,68,0.18) 0%,rgba(239,68,68,0.18) 28%,rgba(255,255,255,0.04) 28%,rgba(255,255,255,0.04) 32%,rgba(16,185,129,0.14) 32%,${hasTarget ? 'rgba(52,211,153,0.28)' : 'rgba(255,255,255,0.04)'} 100%)"></div>
        </div>
        <div class="et-marker" style="left:${stopX}%;top:2px;">
          <div class="et-marker-label" style="color:var(--red-bright)">STOP</div>
          <div class="et-marker-price">$${stop.toFixed(2)}</div>
          <div class="et-marker-line" style="background:var(--red-bright);opacity:0.6;height:18px;position:absolute;top:36px;"></div>
        </div>
        <div class="et-marker et-marker-entry" style="left:${entryX}%;top:50px;">
          <div class="et-marker-line" style="background:${a.c};opacity:0.6;height:18px;position:absolute;top:-20px;"></div>
          <div class="et-marker-label" style="color:${a.c}">ENTRY</div>
          <div class="et-marker-price">$${entry.toFixed(2)}</div>
        </div>
        ${hasTarget ? `
        <div class="et-marker" style="left:${targetX}%;top:2px;">
          <div class="et-marker-label" style="color:var(--green-bright)">TARGET</div>
          <div class="et-marker-price">$${target.toFixed(2)}</div>
          <div class="et-marker-line" style="background:var(--green-bright);opacity:0.6;height:18px;position:absolute;top:36px;"></div>
        </div>` : `
        <div class="et-marker" style="left:${targetX}%;top:2px;opacity:0.6;">
          <div class="et-marker-label" style="color:var(--amber-bright,#fbbf24)">TARGET</div>
          <div class="et-marker-price" style="color:var(--ink-4);">—</div>
        </div>`}
        <div class="et-now-dot" style="left:${markPct}%;top:-6px;">
          <div class="et-now-label" style="color:${tone};white-space:nowrap;">NOW · $${mark.toFixed(2)}</div>
          <div class="et-now-stem" style="background:${tone};height:38px;"></div>
          <div class="et-now-circle" style="background:${tone};box-shadow:0 0 14px ${tone},0 0 0 3px var(--bg,#08090d)"></div>
        </div>
      </div>
      <div class="et-ladder-ctx">
        <span>${ctxLeft}</span>
        <span class="et-ladder-ctx-right">Highest mark today: $${highestMark.toFixed(2)}</span>
      </div>
    </section>

    <section class="et-body-grid">
      <div class="et-actions-card">
        <div class="et-card-heading" style="margin-bottom:4px;">
          <h2 class="et-card-title">Adjust the trade</h2>
          <div class="et-card-meta">SUGGESTED · TAP TO APPLY</div>
        </div>

        ${actionRow({
          id: 'move-stop',
          title: 'Move stop',
          accent: 'var(--cyan)',
          suggestion: isProfit
            ? `to $${entry.toFixed(2)} · breakeven`
            : `hold $${stop.toFixed(2)} · original`,
          suggestionColor: isProfit ? 'var(--green-bright)' : 'var(--ink-3)',
          cta: 'UPDATE',
          ctaColor: 'var(--cyan)',
          ctaBg: 'rgba(6,212,248,0.12)',
          ctaLine: 'rgba(6,212,248,0.4)',
        })}

        ${actionRow({
          id: 'take-partial',
          title: 'Take partial',
          accent: 'var(--green-bright)',
          suggestion: isProfit
            ? `trim 50% at $${mark.toFixed(2)} · lock ${fmtR(r * 0.5)}`
            : 'not recommended at this level',
          suggestionColor: isProfit ? 'var(--green-bright)' : 'var(--amber-bright,#fbbf24)',
          cta: 'SCALE OUT',
          ctaColor: 'var(--green-bright)',
          ctaBg: 'rgba(16,185,129,0.12)',
          ctaLine: 'rgba(16,185,129,0.32)',
          disabled: !isProfit,
        })}

        ${actionRow({
          id: 'close-all',
          title: 'Close position',
          accent: 'var(--red-bright)',
          suggestion: `market @ $${mark.toFixed(2)} · realize ${fmt$(pl)}`,
          suggestionColor: tone,
          cta: 'CLOSE ALL',
          ctaColor: 'var(--red-bright)',
          ctaBg: 'rgba(239,68,68,0.12)',
          ctaLine: 'rgba(239,68,68,0.4)',
        })}
      </div>

      <div class="et-sidebar">
        <div class="et-setup-card" style="background:linear-gradient(180deg,${a.soft},transparent 60%),rgba(19,23,34,0.78);border:1px solid ${a.line};">
          <div class="et-setup-hdr">
            <span class="et-card-meta">SETUP</span>
            ${edge ? `<span class="et-setup-edge" style="color:${edgeColor(edge)};background:${edgeBg(edge)};border:1px solid ${edgeLine(edge)}">EDGE · ${edge}</span>` : ''}
          </div>
          <div class="et-setup-name">${trade.setup || trade.selectedSetup || '—'}</div>
          ${!isProfit && edge === 'FADING' ? `
          <div class="et-setup-warn">
            Edge re-rated to <strong>FADING</strong>. Consider tighter management or reducing size.
          </div>` : ''}
          ${trade.setup ? `<button class="et-repeat-setup-pill" id="et-repeat-setup-btn" type="button"
            style="color:${a.c};background:${a.bg};border:1px solid ${a.line};">↻ Repeat setup</button>` : ''}
        </div>

        <div class="et-journal-card">
          <div class="et-card-heading">
            <span class="et-card-meta">JOURNAL · ON ENTRY</span>
            <span class="et-card-meta" style="cursor:pointer;color:var(--ink-4)" id="et-edit-journal-btn">EDIT</span>
          </div>
          <div class="et-journal-quote" id="et-journal-quote">"${escapeHtml(trade.journal || trade.thesis || trade.notes || 'No entry notes recorded.')}"</div>
          <div class="et-card-meta" style="margin-top:10px;">ADD A NOTE</div>
          <textarea class="et-note-area" id="et-note-input" placeholder='e.g. "Price tagging 495, moving stop to BE per plan."'></textarea>
        </div>
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

  // Footer
  const footer = document.createElement('div');
  footer.className = 'et-footer';
  footer.innerHTML = `
    <button class="et-btn-back" id="et-footer-back">← BACK TO BOOK</button>
    <div class="et-footer-right">
      <button class="et-btn-save" id="et-save-notes-btn">SAVE NOTES</button>
      <button class="et-btn-apply" id="et-apply-btn" style="background:${a.c};border:1px solid ${a.c}">APPLY CHANGES →</button>
    </div>`;
  mainEl.appendChild(footer);

  // Wire actions
  mainEl.querySelector('[data-action="move-stop"]')?.addEventListener('click', () => {
    if (isProfit) {
      trade.stop = entry;
      saveState();
      toast(`Stop moved to breakeven ($${entry.toFixed(2)})`);
      renderEditTrade(trade);
    } else {
      toast(`Stop held at $${stop.toFixed(2)}`);
    }
  });
  mainEl.querySelector('[data-action="take-partial"]')?.addEventListener('click', () => {
    if (!isProfit) return;
    const half = Math.max(1, Math.floor(qty / 2));
    trade.qty = qty - half;
    if (trade.shares != null) trade.shares = trade.qty;
    if (trade.contracts != null) trade.contracts = trade.qty;
    const note = `Scaled out ${half} @ $${mark.toFixed(2)} · locked ${fmtR(r)}`;
    trade.notes = trade.notes ? trade.notes + '\n' + note : note;
    saveState();
    toast(`Scaled out ${half} · ${trade.qty} remaining`);
    renderEditTrade(trade);
  });
  mainEl.querySelector('[data-action="close-all"]')?.addEventListener('click', () => {
    trade.status = 'closed';
    trade.exit = mark;
    trade.exitDate = new Date().toISOString().slice(0, 10);
    saveState();
    toast(`Closed ${trade.ticker || ''} @ $${mark.toFixed(2)} · ${fmt$(pl)}`);
    closeEditTrade();
    if (typeof window.refreshAllUI === 'function') window.refreshAllUI();
  });

  // Repeat setup → pre-seed trade flow with this setup + mode + direction
  mainEl.querySelector('#et-repeat-setup-btn')?.addEventListener('click', () => {
    if (!trade.setup) return;
    if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
    state.tradeFlow.mode = mode;
    state.tradeFlow.step = 1;
    if (mode === 'intraday') {
      if (!state.intraday) state.intraday = {};
      state.intraday.setup = trade.setup;
      state.intraday.direction = isLong ? 'long' : 'short';
    } else {
      state.selectedSetup = trade.setup;
      state.direction = isLong ? 'long' : 'short';
    }
    saveState();
    closeEditTrade();
    if (typeof window.setTab === 'function') window.setTab('trade');
    if (typeof window.renderTrade === 'function') window.renderTrade();
    toast(`Repeating ${trade.setup}`);
  });

  // Journal edit toggle
  mainEl.querySelector('#et-edit-journal-btn')?.addEventListener('click', () => {
    const quote = mainEl.querySelector('#et-journal-quote');
    if (!quote) return;
    if (quote.dataset.editing === '1') return;
    quote.dataset.editing = '1';
    const current = trade.journal || trade.thesis || '';
    quote.innerHTML = `<textarea class="et-note-area" id="et-journal-edit" style="width:100%;">${escapeHtml(current)}</textarea>
      <button class="et-btn-save" id="et-journal-save" style="margin-top:6px;">SAVE</button>`;
    quote.querySelector('#et-journal-save').addEventListener('click', () => {
      const v = quote.querySelector('#et-journal-edit').value.trim();
      trade.journal = v;
      saveState();
      toast('Journal updated');
      renderEditTrade(trade);
    });
  });

  footer.querySelector('#et-footer-back').addEventListener('click', closeEditTrade);
  footer.querySelector('#et-save-notes-btn').addEventListener('click', () => {
    const note = document.getElementById('et-note-input')?.value?.trim();
    if (!note) return;
    trade.notes = trade.notes ? trade.notes + '\n\n' + note : note;
    saveState();
    toast('Note saved');
    renderEditTrade(trade);
  });
  footer.querySelector('#et-apply-btn').addEventListener('click', () => {
    saveState();
    toast('Changes applied');
    closeEditTrade();
    if (typeof window.refreshAllUI === 'function') window.refreshAllUI();
  });

  mainEl.scrollTop = 0;
}

export function closeEditTrade() {
  const overlay = document.getElementById('edit-trade-overlay');
  if (overlay) overlay.classList.remove('show');
}

// ── row helper ─────────────────────────────────────────────────────────────
function actionRow({ id, title, accent, suggestion, suggestionColor, cta, ctaColor, ctaBg, ctaLine, disabled = false }) {
  return `<div class="et-action-row${disabled ? ' dim' : ''}" style="border-left-color:${accent};">
    <div class="et-action-name">${title}</div>
    <div class="et-action-suggestion" style="color:${suggestionColor}">${suggestion}</div>
    <button class="et-action-cta" data-action="${id}" ${disabled ? 'disabled' : ''}
      style="color:${ctaColor};background:${ctaBg};border:1px solid ${ctaLine};${disabled ? 'opacity:0.5;cursor:not-allowed;' : ''}">${cta}</button>
  </div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildHistory(trade, accentColor, toneColor) {
  const events = [];
  const d = new Date(trade.date || trade.opened || Date.now());
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const qty = trade.qty || trade.contracts || trade.shares || 1;
  const entry = parseFloat(trade.entry || trade.premium || 0);
  const stop  = parseFloat(trade.stop || 0);
  const mark  = parseFloat(trade.mark || trade.currentPrice || entry);
  const oneR  = Math.round(Math.abs(entry - stop) * qty) || 0;

  events.push({
    t: `${dateStr} ${timeStr}`,
    kind: 'FILL',
    text: `BUY ${qty} @ $${entry.toFixed(2)} · 1R = $${oneR}`,
    color: accentColor,
  });

  if (trade.journal || trade.thesis) {
    events.push({
      t: 'entry note',
      kind: 'NOTE',
      text: (trade.journal || trade.thesis || '').slice(0, 120) + ((trade.journal || trade.thesis || '').length > 120 ? '…' : ''),
      color: 'var(--ink-3)',
    });
  }

  const riskPerUnit = Math.abs(entry - stop) || 1;
  const r = (mark - entry) / riskPerUnit;
  const pl = calcPL(trade);
  const plStr = pl != null ? fmt$(pl) : `${(mark - entry) * qty >= 0 ? '+$' : '−$'}${Math.abs((mark - entry) * qty).toFixed(0)}`;
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
