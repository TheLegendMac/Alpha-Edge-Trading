// Reference tab — regime sizing cards, position caps, IV-rank playbook.

import { state } from '../state/store.js';

export function renderReference() {
  const s = state.settings;
  const account = s.account || 10000;
  const fmt = pct => (pct || 0).toFixed(2).replace(/\.?0+$/, '') + '%';

  // Update hero account label
  const acctLabel = document.getElementById('ref-account-label');
  if (acctLabel) acctLabel.textContent = `ACCOUNT $${account.toLocaleString()}`;

  // ── Regime sizing 3 cards ────────────────────────────────
  const sizing = document.getElementById('ref-sizing-content');
  if (sizing) {
    const regimes = [
      {
        cls: 'on', emoji: '🟢', name: 'RISK-ON',
        pct: s.riskOn, dir: 'Long full size · short blocked.',
        context: 'In form · rolling > +5% · sectors leaning.',
      },
      {
        cls: 'neut', emoji: '🟡', name: 'NEUTRAL',
        pct: s.riskNeutral, dir: 'Reduced size · both directions · debit spreads preferred.',
        context: 'Choppy regime · mixed sector ratings.',
      },
      {
        cls: 'off', emoji: '🔴', name: 'RISK-OFF',
        pct: s.riskOff, dir: 'Quarter size · long blocked · puts only on weak sectors.',
        context: 'Rolling < −7% · kill switch · re-rate to exit.',
      },
    ];
    sizing.innerHTML = regimes.map(r => {
      const dollars = Math.round(account * (r.pct || 0) / 100);
      return `
        <div class="ref-regime-card ${r.cls}">
          <div class="ref-regime-top">
            <span class="ref-regime-emoji">${r.emoji}</span>
            <span class="ref-regime-name">${r.name}</span>
          </div>
          <div class="ref-regime-pct-row">
            <span class="ref-regime-pct">${fmt(r.pct || 0)}</span>
            <span class="ref-regime-unit">per trade</span>
          </div>
          <div class="ref-regime-dollar-box">
            <span class="ref-regime-dollar-label">1R</span>
            <span>$${dollars.toLocaleString()}</span>
          </div>
          <div class="ref-regime-detail">${r.dir}</div>
          <div class="ref-regime-context">${r.context}</div>
        </div>`;
    }).join('');
  }

  // ── Caps list ────────────────────────────────────────────
  const caps = document.getElementById('ref-caps-list');
  if (caps) {
    const rows = [
      { key: `max ${s.maxPositions}`,    keyClass: 'amber', val: 'Concurrent positions',     detail: 'Across both swing and intraday combined.' },
      { key: `max ${s.maxPremiumPct}%`,  keyClass: 'amber', val: 'Total premium deployed',   detail: `$${Math.round(account * (s.maxPremiumPct || 0) / 100).toLocaleString()} cap on capital tied up.` },
      { key: `max ${s.maxRiskPct}%`,     keyClass: 'amber', val: 'Total at risk',            detail: `$${Math.round(account * (s.maxRiskPct || 0) / 100).toLocaleString()} ceiling across all open trades.` },
      { key: `${s.stopPct}%`,            keyClass: 'amber', val: 'Stop loss · premium paid', detail: 'Hard cut on options; equities use technical stop.' },
      { key: `+${s.targetPct}%`,         keyClass: 'green', val: 'Profit target',            detail: 'Default exit — adjust per setup playbook.' },
      { key: '15:55',                    keyClass: 'cyan',  val: 'Intraday cut time',        detail: 'Hard close · no holding intraday positions overnight.' },
    ];
    caps.innerHTML = rows.map((r, i) => `
      <li>
        <span class="ref-key ${r.keyClass}">${r.key}</span>
        <div class="ref-val">${r.val}<span>${r.detail}</span></div>
        <span class="ref-caps-rule-num">RULE ${String(i + 1).padStart(2, '0')}</span>
      </li>`).join('');
  }
}

window.renderReference = renderReference;
