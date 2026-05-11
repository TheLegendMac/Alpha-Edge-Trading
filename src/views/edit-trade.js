// Edit Trade — full-page overlay for editing/managing an open position.
// Design spec: trader-s-edge 2/project/redesign.jsx  EditTrade component.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { calcPL } from '../models/trade.js';

// ── helpers ──────────────────────────────────────────────────────────────
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
  if (!edge) return 'var(--ink-3)';
  const e = edge.toUpperCase();
  if (e === 'STRONG')  return 'var(--green-bright)';
  if (e === 'HOLDING') return 'var(--cyan)';
  if (e === 'FADING')  return 'var(--amber-bright, #fbbf24)';
  return 'var(--red-bright)';
}
function edgeBg(edge) {
  if (!edge) return 'rgba(255,255,255,0.04)';
  const e = edge.toUpperCase();
  if (e === 'STRONG')  return 'rgba(16,185,129,0.12)';
  if (e === 'HOLDING') return 'rgba(6,212,248,0.10)';
  if (e === 'FADING')  return 'rgba(245,158,11,0.10)';
  return 'rgba(239,68,68,0.10)';
}
function edgeLine(edge) {
  if (!edge) return 'rgba(255,255,255,0.08)';
  const e = edge.toUpperCase();
  if (e === 'STRONG')  return 'rgba(16,185,129,0.32)';
  if (e === 'HOLDING') return 'rgba(6,212,248,0.30)';
  if (e === 'FADING')  return 'rgba(245,158,11,0.32)';
  return 'rgba(239,68,68,0.32)';
}

// ── main renderer ─────────────────────────────────────────────────────────
export function openEditTrade(tradeId) {
  const overlay = document.getElementById('edit-trade-overlay');
  const mainEl  = document.getElementById('edit-trade-main');
  if (!overlay || !mainEl) return;

  const trade = (state.trades || []).find(t => t.id === tradeId);
  if (!trade) return;

  const pl       = calcPL(trade) || 0;
  const mode     = trade.mode || 'swing';
  const a        = modeAccent(mode);
  const isProfit = pl >= 0;
  const tone     = isProfit ? 'var(--green-bright)' : 'var(--red-bright)';
  const toneLine = isProfit ? 'rgba(16,185,129,0.32)' : 'rgba(239,68,68,0.32)';
  const dirColor = (trade.direction || trade.dir || 'long').toLowerCase() === 'long'
    ? 'var(--green-bright)' : 'var(--red-bright)';

  const entry  = parseFloat(trade.entry || trade.premium || 0);
  const stop   = parseFloat(trade.stop || 0);
  const target = parseFloat(trade.target || 0);
  const mark   = parseFloat(trade.mark || trade.currentPrice || entry);
  const qty    = trade.qty || trade.contracts || trade.shares || 1;
  const edge   = (trade.edge || trade.setup_edge || '').toUpperCase() || null;

  // R calculation
  const riskPerUnit = Math.abs(entry - stop) || 1;
  const gainPerUnit = mark - entry;
  const r = trade.r != null ? trade.r : (gainPerUnit / riskPerUnit);
  const plPct = entry ? (gainPerUnit / entry * 100) : 0;
  const oneR   = Math.round(Math.abs(riskPerUnit) * qty);

  // Price ladder geometry
  const range   = (target - stop) || 1;
  const stopX   = 8;
  const entryX  = 32;
  const targetX = 92;
  const markPct = Math.max(2, Math.min(97,
    ((mark - stop) / range) * (targetX - stopX) + stopX
  ));

  // Progress context text
  const pctToTarget = target > stop ? ((mark - entry) / (target - entry) * 100) : 0;
  const pctToStop   = entry > stop  ? ((mark - stop)  / (entry - stop) * 100) : 100;
  const ctxLeft = isProfit
    ? `<strong style="color:var(--green-bright)">${Math.round(pctToTarget)}% to target.</strong> Price ${Math.abs(gainPerUnit / entry * 100).toFixed(1)}% above entry · trail stop to BE recommended.`
    : `<strong style="color:var(--red-bright)">${Math.round(pctToStop)}% buffer to stop.</strong> Price ${Math.abs(gainPerUnit / entry * 100).toFixed(1)}% below entry · monitor closely.`;

  // Timeline from trade history / notes
  const history = buildHistory(trade, a.c, tone);

  // Render nav bar
  const navBar = document.getElementById('edit-trade-nav-bar');
  if (navBar) {
    navBar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 28px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(8,9,13,0.8);backdrop-filter:blur(8px);">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="display:flex;align-items:center;justify-content:center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 21H3"></path>
              <path d="M3 14l5-5 4 4 9-9"></path>
            </svg>
          </div>
          <span style="font-family:var(--display);font-weight:700;font-size:14px;letter-spacing:0.04em;color:var(--ink);">TRAPPER'S <span style="color:var(--ink-4)">EDGE</span></span>
        </div>
        <div class="et-breadcrumb">
          <span>OPEN BOOK</span>
          <span class="et-breadcrumb-sep">›</span>
          <span class="et-breadcrumb-active">EDIT · ${(trade.ticker || trade.symbol || '—').toUpperCase()} ${(trade.direction || trade.dir || 'LONG').toUpperCase()}</span>
          <span class="et-breadcrumb-sep">·</span>
          <span>POSITION #${String(trade.id || '').slice(-4).toUpperCase() || '—'}</span>
        </div>
        <button class="et-btn-back" id="et-close-btn">← BACK TO BOOK</button>
      </div>`;
    navBar.querySelector('#et-close-btn').addEventListener('click', closeEditTrade);
  }

  mainEl.innerHTML = `
    <!-- HERO -->
    <section class="et-hero ${isProfit ? 'et-hero-profit' : 'et-hero-loss'}">
      <div class="et-hero-left">
        <div class="et-hero-status" style="color:${tone}">
          <div class="et-hero-status-dot" style="background:${tone};box-shadow:0 0 8px ${tone}"></div>
          OPEN · ${trade.opened || trade.date || '—'}
        </div>
        <div class="et-ticker-row">
          <h1 class="et-ticker">${(trade.ticker || trade.symbol || '—').toUpperCase()}</h1>
          <span class="et-pill ${(trade.direction || trade.dir || 'long').toLowerCase() === 'long' ? 'et-pill-long' : 'et-pill-short'}">
            ${(trade.direction || trade.dir || 'LONG').toUpperCase()}
          </span>
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

    <!-- PRICE LADDER -->
    <section class="et-ladder-card">
      <div class="et-card-heading">
        <h2 class="et-card-title">Price ladder</h2>
        <div class="et-card-meta">STOP → ENTRY → TARGET</div>
      </div>
      <div class="et-ladder">
        <!-- Track -->
        <div class="et-ladder-track">
          <div class="et-ladder-fill" style="background:linear-gradient(90deg,rgba(239,68,68,0.18) 0%,rgba(239,68,68,0.18) 28%,rgba(255,255,255,0.04) 28%,rgba(255,255,255,0.04) 32%,rgba(16,185,129,0.14) 32%,rgba(52,211,153,0.28) 100%)"></div>
        </div>
        <!-- STOP -->
        <div class="et-marker" style="left:${stopX}%;top:2px;">
          <div class="et-marker-label" style="color:var(--red-bright)">STOP</div>
          <div class="et-marker-price">$${stop.toFixed(2)}</div>
          <div class="et-marker-line" style="background:var(--red-bright);opacity:0.6;height:18px;position:absolute;top:36px;"></div>
        </div>
        <!-- ENTRY -->
        <div class="et-marker et-marker-entry" style="left:${entryX}%;top:50px;">
          <div class="et-marker-line" style="background:${a.c};opacity:0.6;height:18px;position:absolute;top:-20px;"></div>
          <div class="et-marker-label" style="color:${a.c}">ENTRY</div>
          <div class="et-marker-price">$${entry.toFixed(2)}</div>
        </div>
        <!-- TARGET -->
        <div class="et-marker" style="left:${targetX}%;top:2px;">
          <div class="et-marker-label" style="color:var(--green-bright)">TARGET</div>
          <div class="et-marker-price">$${target.toFixed(2)}</div>
          <div class="et-marker-line" style="background:var(--green-bright);opacity:0.6;height:18px;position:absolute;top:36px;"></div>
        </div>
        <!-- NOW dot -->
        <div class="et-now-dot" style="left:${markPct}%;top:20px;">
          <div class="et-now-label" style="color:${tone}">NOW · $${mark.toFixed(2)}</div>
          <div class="et-now-circle" style="background:${tone};box-shadow:0 0 14px ${tone},0 0 0 3px var(--bg,#08090d)"></div>
          <div class="et-now-stem" style="background:${tone}"></div>
        </div>
      </div>
      <div class="et-ladder-ctx">
        <span>${ctxLeft}</span>
        <span class="et-ladder-ctx-right">Mark: $${mark.toFixed(2)}</span>
      </div>
    </section>

    <!-- ACTIONS + SIDEBAR -->
    <section class="et-body-grid">
      <!-- Actions card -->
      <div class="et-actions-card">
        <div class="et-card-heading" style="margin-bottom:4px;">
          <h2 class="et-card-title">Adjust the trade</h2>
          <div class="et-card-meta">4 ACTIONS</div>
        </div>

        ${actionRowHtml({
          title: 'Move stop',
          accent: 'var(--cyan)',
          suggestion: isProfit ? `$${entry.toFixed(2)} · breakeven` : `hold $${stop.toFixed(2)}`,
          suggestionColor: isProfit ? 'var(--green-bright)' : 'var(--ink-3)',
          presets: isProfit
            ? [[`$${entry.toFixed(2)}`, 'BE', true], [`$${(entry * 1.01).toFixed(2)}`, '+1R lock', false], [`$${stop.toFixed(2)}`, 'original', false]]
            : [[`$${stop.toFixed(2)}`, 'original', true], ['EMA', 'support', false], ['Trail', '1ATR', false]],
          cta: 'UPDATE STOP',
          ctaColor: 'var(--cyan)',
          ctaBg: 'rgba(6,212,248,0.12)',
          ctaLine: 'rgba(6,212,248,0.4)',
        })}

        ${actionRowHtml({
          title: 'Take partial',
          accent: 'var(--green-bright)',
          suggestion: isProfit ? 'Trim 50% · lock partial gain' : 'Not recommended at this level',
          suggestionColor: isProfit ? 'var(--green-bright)' : 'var(--amber-bright,#fbbf24)',
          presets: [['25%', `${Math.round(qty*.25)} sh`, false], ['50%', `${Math.round(qty*.5)} sh`, isProfit], ['75%', `${Math.round(qty*.75)} sh`, false], ['Custom', '—', false]],
          cta: isProfit ? 'SCALE OUT' : 'SCALE OUT (OVERRIDE)',
          ctaColor: 'var(--green-bright)',
          ctaBg: 'rgba(16,185,129,0.12)',
          ctaLine: 'rgba(16,185,129,0.32)',
          dim: !isProfit,
        })}

        ${actionRowHtml({
          title: 'Add to position',
          accent: 'var(--magenta,#ec4899)',
          suggestion: isProfit ? 'Disabled · no add-back same week' : 'Disabled · trade is at loss',
          suggestionColor: 'var(--amber-bright,#fbbf24)',
          presets: [['+25%', `${Math.round(qty*.25)} sh`, false], ['+50%', `${Math.round(qty*.5)} sh`, false], ['Custom', '—', false]],
          cta: 'ADD (BLOCKED)',
          ctaColor: 'var(--ink-4)',
          ctaBg: 'rgba(255,255,255,0.04)',
          ctaLine: 'rgba(255,255,255,0.08)',
          dim: true,
          blocked: true,
        })}

        ${actionRowHtml({
          title: 'Close position',
          accent: 'var(--red-bright)',
          suggestion: `At $${mark.toFixed(2)} · realize ${fmt$(pl)}`,
          suggestionColor: tone,
          presets: [['Market', 'now', true], ['Limit', `$${(mark + 0.05).toFixed(2)}`, false], ['EOD', '15:55', false]],
          cta: 'CLOSE ALL · MARKET',
          ctaColor: 'var(--red-bright)',
          ctaBg: 'rgba(239,68,68,0.12)',
          ctaLine: 'rgba(239,68,68,0.4)',
        })}
      </div>

      <!-- Sidebar -->
      <div class="et-sidebar">
        <!-- Setup card -->
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
          <button class="et-retag-btn" id="et-retag-btn">RE-TAG SETUP</button>
        </div>

        <!-- Journal card -->
        <div class="et-journal-card">
          <div class="et-card-heading">
            <span class="et-card-meta">JOURNAL · ON ENTRY</span>
            <span class="et-card-meta" style="cursor:pointer;color:var(--ink-4)" id="et-edit-journal-btn">EDIT</span>
          </div>
          <div class="et-journal-quote">"${trade.journal || trade.thesis || trade.notes || 'No entry notes recorded.'}"</div>
          <div class="et-card-meta">ADD A NOTE</div>
          <textarea class="et-note-area" id="et-note-input" placeholder='e.g. "Holding above key level · trailing stop to BE."'></textarea>
        </div>
      </div>
    </section>

    <!-- TIMELINE -->
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

  // Wire events
  footer.querySelector('#et-footer-back').addEventListener('click', closeEditTrade);
  footer.querySelector('#et-save-notes-btn').addEventListener('click', () => {
    const note = document.getElementById('et-note-input')?.value?.trim();
    if (note) {
      if (!trade.notes) trade.notes = '';
      trade.notes = trade.notes ? trade.notes + '\n\n' + note : note;
      saveState();
      if (typeof window.toast === 'function') window.toast('Note saved');
    }
  });
  footer.querySelector('#et-apply-btn').addEventListener('click', () => {
    saveState();
    if (typeof window.toast === 'function') window.toast('Changes applied');
    closeEditTrade();
  });

  overlay.classList.add('show');
  mainEl.scrollTop = 0;

  // Store the current trade ID for reference
  overlay.dataset.tradeId = tradeId;
}

export function closeEditTrade() {
  const overlay = document.getElementById('edit-trade-overlay');
  if (overlay) overlay.classList.remove('show');
}

// ── helpers ───────────────────────────────────────────────────────────────
function actionRowHtml({ title, accent, suggestion, suggestionColor, presets, cta, ctaColor, ctaBg, ctaLine, dim = false, blocked = false }) {
  const presetHtml = presets.map(([label, sub, active]) => `
    <span class="et-preset${active ? ' active' : ''}" style="${active ? `color:${accent};background:${accent}18;border-color:${accent}55` : ''}">
      ${label}
      ${sub !== '—' ? `<span class="et-preset-sub" style="${active ? `color:${accent}` : ''}">${sub}</span>` : ''}
    </span>`).join('');

  return `<div class="et-action-row${dim ? ' dim' : ''}" style="border-left-color:${accent};">
    <div class="et-action-name">${title}</div>
    <div class="et-action-suggestion" style="color:${suggestionColor}">${suggestion}</div>
    <div class="et-presets">${presetHtml}</div>
    <button class="et-action-cta${blocked ? ' blocked' : ''}" style="${blocked ? '' : `color:${ctaColor};background:${ctaBg};border:1px solid ${ctaLine}`}">${cta}</button>
  </div>`;
}

function buildHistory(trade, accentColor, toneColor) {
  const events = [];
  const d = new Date(trade.date || trade.opened || Date.now());
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Fill event
  events.push({
    t: `${dateStr} ${timeStr}`,
    kind: 'fill',
    text: `BUY ${trade.qty || trade.contracts || ''} @ $${parseFloat(trade.entry || trade.premium || 0).toFixed(2)} · 1R = $${Math.round(Math.abs((parseFloat(trade.entry || 0) - parseFloat(trade.stop || 0))) * (trade.qty || 1))}`,
    color: accentColor,
  });

  // Journal note if present
  if (trade.journal || trade.thesis) {
    events.unshift({
      t: 'entry note',
      kind: 'note',
      text: (trade.journal || trade.thesis || '').slice(0, 120) + ((trade.journal || trade.thesis || '').length > 120 ? '…' : ''),
      color: 'var(--ink-3)',
    });
  }

  // Mark (current)
  const pl = calcPL(trade) || 0;
  const entry = parseFloat(trade.entry || trade.premium || 0);
  const stop  = parseFloat(trade.stop || 0);
  const mark  = parseFloat(trade.mark || trade.currentPrice || entry);
  const riskPerUnit = Math.abs(entry - stop) || 1;
  const r = (mark - entry) / riskPerUnit;
  events.unshift({
    t: 'now',
    kind: 'mark',
    text: `Mark $${mark.toFixed(2)} · ${r >= 0 ? '+' : ''}${r.toFixed(2)}R · P/L ${pl >= 0 ? '+$' : '−$'}${Math.abs(pl).toFixed(0)}`,
    color: toneColor,
  });

  return events;
}

// ── global expose ─────────────────────────────────────────────────────────
window.openEditTrade  = openEditTrade;
window.closeEditTrade = closeEditTrade;
