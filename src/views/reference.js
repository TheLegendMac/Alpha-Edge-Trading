// Reference tab — sizing rules + position caps cards.

import { state } from '../state/store.js';
import { esc } from '../dom/html.js';

export function renderReference() {
  const s = state.settings;
  const account = s.account;

  // ----- Redesigned sections -----
  const heroKicker = document.getElementById('ref-hero-kicker-text');
  if (heroKicker) heroKicker.textContent = `REFERENCE · ACCOUNT $${(account || 0).toLocaleString()}`;

  const regimeGrid = document.getElementById('ref-regime-grid');
  if (regimeGrid) {
    const regimes = [
      { k: 'on',  l: 'Risk-On',  pct: s.riskOn,      tone: 'green', emoji: '🟢',
        detail: 'Long full size · short blocked.', context: 'In form · rolling > +5% · sectors leaning.' },
      { k: 'neut',l: 'Neutral',  pct: s.riskNeutral, tone: 'amber', emoji: '🟡',
        detail: 'Reduced size · both directions · debit spreads preferred.', context: 'Choppy regime · mixed sector ratings.' },
      { k: 'off', l: 'Risk-Off', pct: s.riskOff,     tone: 'red',   emoji: '🔴',
        detail: 'Quarter size · long blocked · puts only on weak sectors.', context: 'Rolling < −7% · kill switch · re-rate to exit.' },
    ];
    regimeGrid.innerHTML = regimes.map(r => `
      <div class="ref-regime-card ${r.tone}">
        <div class="ref-regime-head">
          <span class="ref-regime-emoji">${r.emoji}</span>
          <span class="ae-mono ref-regime-label">${esc(r.l.toUpperCase())}</span>
        </div>
        <div class="ref-regime-pct">
          ${r.pct.toFixed(2)}<span class="ref-regime-pct-unit">%</span>
          <span class="ref-regime-pct-sub">per trade</span>
        </div>
        <div class="ref-regime-r">
          <span class="ae-mono">1R</span>
          <span class="ref-regime-r-val">$${Math.round((account || 0) * r.pct / 100).toLocaleString()}</span>
        </div>
        <div class="ref-regime-detail">${esc(r.detail)}</div>
        <div class="ref-regime-context">${esc(r.context)}</div>
      </div>
    `).join('');
  }

  const capsCard = document.getElementById('ref-caps-card');
  if (capsCard) {
    const caps = [
      { k: `max ${s.maxPositions}`,    v: 'Concurrent positions',     d: 'Across both swing and intraday combined.', tone: 'amber' },
      { k: `max ${s.maxPremiumPct}%`,  v: 'Total premium deployed',   d: `$${Math.round(account * s.maxPremiumPct / 100).toLocaleString()} cap on capital tied up.`, tone: 'amber' },
      { k: `max ${s.maxRiskPct}%`,     v: 'Total at risk',            d: `$${Math.round(account * s.maxRiskPct / 100).toLocaleString()} ceiling across all open trades.`, tone: 'amber' },
      { k: `${s.stopPct}%`,            v: 'Stop loss · premium paid', d: 'Hard cut on options; equities use technical stop.', tone: 'amber' },
      { k: `+${s.targetPct}%`,         v: 'Profit target',            d: 'Default exit — adjust per setup playbook.', tone: 'green' },
      { k: '15:55',                    v: 'Intraday cut time',        d: 'Hard close · no holding intraday positions overnight.', tone: 'cyan' },
    ];
    capsCard.innerHTML = caps.map((c, i) => `
      <div class="ref-cap-row">
        <div class="ref-cap-key ${c.tone}">${esc(c.k)}</div>
        <div class="ref-cap-body">
          <div class="ref-cap-title">${esc(c.v)}</div>
          <div class="ref-cap-desc">${esc(c.d)}</div>
        </div>
        <span class="ref-cap-rule">RULE ${String(i + 1).padStart(2, '0')}</span>
      </div>
    `).join('');
  }

  const ivrGrid = document.getElementById('ref-ivr-grid');
  if (ivrGrid) {
    const buckets = [
      { l: 'Under 30', name: 'Buy a single CALL/PUT',     tag: 'CHEAP IV', tone: 'green',
        delta: '0.65 – 0.75 ITM', dte: '30 – 45 DTE', width: '—' },
      { l: '30 – 50',  name: 'Debit call/put spread',     tag: 'MODERATE', tone: 'cyan',
        delta: '0.60-0.70 / 0.30-0.40', dte: '30 – 45 DTE', width: '$2.50 – $5.00' },
      { l: '50 – 70',  name: 'Debit spread · HALF size',  tag: 'ELEVATED', tone: 'amber',
        delta: '0.60-0.70 / 0.30-0.40', dte: '30 – 45 DTE', width: '$2.50 – $5.00' },
      { l: 'Over 70',  name: 'SKIP this trade',           tag: 'TOO RICH', tone: 'red',
        delta: '—', dte: '—', width: 'Wait for IV to drop' },
    ];
    ivrGrid.innerHTML = buckets.map(b => `
      <div class="ref-ivr-card ${b.tone}">
        <div class="ref-ivr-head">
          <span class="ae-mono ref-ivr-bucket">IVR ${esc(b.l)}</span>
          <span class="ref-ivr-tag">${esc(b.tag)}</span>
        </div>
        <div class="ref-ivr-name">${esc(b.name)}</div>
        <div class="ref-ivr-rows">
          <div><span>Δ</span><span>${esc(b.delta)}</span></div>
          <div><span>DTE</span><span>${esc(b.dte)}</span></div>
          <div><span>WIDTH</span><span>${esc(b.width)}</span></div>
        </div>
      </div>
    `).join('');
  }

  // ----- Legacy sections still used by the existing detailed reference -----

  // Regime sizing card
  const sizing = document.getElementById('ref-sizing-content');
  if (sizing) {
    const fmt = pct => pct.toFixed(2).replace(/\.?0+$/, '') + '%';
    sizing.innerHTML = `
      <div class="regime-info-card on">
        <div class="regime-info-label on">🟢 RISK-ON</div>
        <div style="font-size: 12px; color: var(--ink-2); line-height: 1.5;">
          Long full size <strong>${fmt(s.riskOn)}</strong> per trade<br/>
          ($${(account * s.riskOn / 100).toFixed(0)} risk dollars)<br/>
          Short blocked
        </div>
      </div>
      <div class="regime-info-card neut">
        <div class="regime-info-label neut">🟡 NEUTRAL</div>
        <div style="font-size: 12px; color: var(--ink-2); line-height: 1.5;">
          Reduced size <strong>${fmt(s.riskNeutral)}</strong> per trade<br/>
          ($${(account * s.riskNeutral / 100).toFixed(0)} risk dollars)<br/>
          Both directions allowed
        </div>
      </div>
      <div class="regime-info-card off">
        <div class="regime-info-label off">🔴 RISK-OFF</div>
        <div style="font-size: 12px; color: var(--ink-2); line-height: 1.5;">
          Defensive size <strong>${fmt(s.riskOff)}</strong> per trade<br/>
          ($${(account * s.riskOff / 100).toFixed(0)} risk dollars)<br/>
          Long blocked, puts only
        </div>
      </div>
    `;
  }

  // Caps card
  const caps = document.getElementById('ref-caps-list');
  if (caps) {
    caps.innerHTML = `
      <li><span class="ref-key amber">max ${s.maxPositions}</span><span class="ref-val">Concurrent positions</span></li>
      <li><span class="ref-key amber">max ${s.maxPremiumPct}%</span><span class="ref-val">Total premium deployed ($${(account * s.maxPremiumPct / 100).toFixed(0)})</span></li>
      <li><span class="ref-key amber">max ${s.maxRiskPct}%</span><span class="ref-val">Total at risk ($${(account * s.maxRiskPct / 100).toFixed(0)})</span></li>
      <li><span class="ref-key amber">${s.stopPct}%</span><span class="ref-val">Stop loss as % of premium paid</span></li>
      <li><span class="ref-key green">+${s.targetPct}%</span><span class="ref-val">Profit target as % of premium gain</span></li>
    `;
  }
}

window.renderReference = renderReference;
