// Reference tab — sizing rules + position caps cards.

import { state } from '../state/store.js';

export function renderReference() {
  const s = state.settings;
  const account = s.account;

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
