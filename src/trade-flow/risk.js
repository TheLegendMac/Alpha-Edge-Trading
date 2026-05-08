// Risk widgets: money/pct/R formatters, spread inputs, moonshot slider, risk-table render.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';

function tfMoneyText(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : '—';
}

function tfPctText(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

function tfSignedMoneyText(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toFixed(digits)}`;
}

function tfAbsMoneyText(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${Math.abs(n).toFixed(digits)}` : '—';
}

function tfOptionSpreadFromBidAsk(bid, ask) {
  const b = Number(bid);
  const a = Number(ask);
  if (!(b > 0 && a > 0 && a >= b)) return null;
  const mid = (b + a) / 2;
  if (!(mid > 0)) return null;
  return { bid: b, ask: a, mid: +mid.toFixed(2), spreadPct: +(((a - b) / mid) * 100).toFixed(1) };
}

function tfSpreadReadHtml(spread, max = null) {
  if (spread === null || spread === undefined || spread === '') return '';
  const b = window.tfSpreadBracket(spread, max);
  return `<div class="tf-spread-read ${b.cls}">Spread <span class="v">${window.tfPctText(spread)}</span></div>`;
}

function tfOptionBidAskInputsHtml({ bidValue = '', askValue = '', bidAttrs = '', askAttrs = '', spread = null, spreadMax = null } = {}) {
  const b = spread === null ? { cls: 'empty', text: '—' } : window.tfSpreadBracket(spread, spreadMax);
  return `
    <div class="trade-section-grid-2">
      <div class="trade-input-row"><div>
        <label class="input-label">Bid $</label>
        <input type="number" min="0" step="0.01" class="trade-input" ${bidAttrs} value="${bidValue ?? ''}" placeholder="Option bid" />
      </div>
      <div class="trade-bracket ${b.cls}">${b.text}</div>
      </div>
      <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
        <label class="input-label">Ask $</label>
        <input type="number" min="0" step="0.01" class="trade-input" ${askAttrs} value="${askValue ?? ''}" placeholder="Option ask" />
      </div></div>
    </div>
    <div data-tf-spread-read>${window.tfSpreadReadHtml(spread, spreadMax)}</div>`;
}

function tfClampMoonshotR(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(2, Math.min(6, Math.round(n * 4) / 4));
}

function tfFormatR(value) {
  const n = window.tfClampMoonshotR(value);
  return `${n.toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}R`;
}

function tfMoonshotR() {
  const tf = state.tradeFlow || {};
  return window.tfClampMoonshotR(tf.moonshotR);
}

function tfRenderMoonshotSliderHtml(moonshotR) {
  const r = window.tfClampMoonshotR(moonshotR);
  return `
    <div class="tf-moonshot-control">
      <div class="tf-moonshot-head">
        <span>Adjust moon shot target</span>
        <output data-tf-moonshot-value>${window.tfFormatR(r)}</output>
      </div>
      <input type="range" min="2" max="6" step="0.25" value="${r}" class="tf-moonshot-slider" data-tf-moonshot-slider aria-label="Adjust moon shot target" />
    </div>`;
}

function tfRiskLevelRows({ entry, stop, target, qty, mult = 1, riskUnitDollars = null, moonshotR = null } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return [];
  const stopDist = Math.abs(e - s);
  if (!(stopDist > 0)) return [];
  const direction = t >= e ? 1 : -1;
  const loss = stopDist * q * m;
  const riskUnit = Number(riskUnitDollars);
  const rBase = riskUnit > 0 ? riskUnit : loss;
  const targetR = Math.abs(t - e) / stopDist;
  const targetLabel = Number.isFinite(targetR) ? `Target 1 (${targetR.toFixed(1)}R)` : 'Target 1';
  const moonR = window.tfClampMoonshotR(moonshotR === null || moonshotR === undefined ? window.tfMoonshotR() : moonshotR);
  const make = (label, price, cls) => {
    const p = Number(price);
    const pnl = (p - e) * direction * q * m;
    const r = rBase > 0 ? pnl / rBase : 0;
    const dist = Math.abs((p - e) / e) * 100;
    return { label, price: p, dist, pnl, r, cls };
  };
  const profitRows = [
    make(targetLabel, t, 'target'),
    make(`Moon shot (${window.tfFormatR(moonR)})`, e + direction * stopDist * moonR, 'moon'),
  ].sort((a, b) => a.r - b.r);
  return [
    make('Stop loss', s, 'stop'),
    make('Entry', e, 'entry'),
    ...profitRows,
  ];
}

function tfRiskRailHtml({ entry, stop, target, qty, mult = 1, moonshotR = null } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return '';
  const stopDist = Math.abs(e - s);
  if (!(stopDist > 0)) return '';
  const direction = t >= e ? 1 : -1;
  const loss = stopDist * q * m;
  const reward = Math.abs(t - e) * q * m;
  if (!(loss > 0 && reward > 0)) return '';
  const targetR = reward / loss;
  const moonR = window.tfClampMoonshotR(moonshotR === null || moonshotR === undefined ? window.tfMoonshotR() : moonshotR);
  const milestones = [
    { cls: 'target', r: targetR, label: `${targetR.toFixed(2)}R`, pnl: reward },
    { cls: 'moon', r: moonR, label: window.tfFormatR(moonR), pnl: loss * moonR },
  ].sort((a, b) => a.r - b.r);
  const firstVisual = Math.max(0.45, Math.min(2.5, milestones[0].r || 1));
  const secondVisual = Math.max(firstVisual + 0.65, Math.min(3.25, milestones[1].r || (milestones[0].r + 1)));
  const secondExtraVisual = secondVisual - firstVisual;
  const total = 1 + firstVisual + secondExtraVisual;
  const lossPct = (1 / total) * 100;
  const firstPct = (firstVisual / total) * 100;
  const secondPct = Math.max(12, 100 - lossPct - firstPct);
  return `
    <div class="tf-risk-rail">
      <div class="tf-risk-zone loss" style="width:${lossPct.toFixed(2)}%;">
        <div><strong>-1R</strong><span>-${window.tfAbsMoneyText(loss, 2)}</span></div>
      </div>
      <div class="tf-risk-zone ${milestones[0].cls}" style="width:${firstPct.toFixed(2)}%;">
        <div><strong>${milestones[0].label}</strong><span>${window.tfSignedMoneyText(milestones[0].pnl, 2)}</span></div>
      </div>
      <div class="tf-risk-zone ${milestones[1].cls}" style="width:${secondPct.toFixed(2)}%;">
        <div><strong>${milestones[1].label}</strong><span>${window.tfSignedMoneyText(milestones[1].pnl, 2)}</span></div>
      </div>
      <div class="tf-risk-entry-marker" style="left:${lossPct.toFixed(2)}%;"></div>
    </div>`;
}

function tfRenderRiskTableHtml(args = {}) {
  const rows = window.tfRiskLevelRows(args);
  if (!rows.length) return '';
  const rowHtml = rows.map(r => `
    <div class="tf-risk-table-row ${r.cls}">
      <div class="level">${r.label}</div>
      <div>${window.tfMoneyText(r.price)}</div>
      <div>${r.dist.toFixed(2)}%</div>
      <div class="${r.pnl < 0 ? 'neg' : r.pnl > 0 ? 'pos' : ''}">${window.tfSignedMoneyText(r.pnl, 2)}</div>
      <div class="${r.r < 0 ? 'neg' : r.r > 0 ? 'pos' : ''}">${r.r >= 0 ? '+' : ''}${r.r.toFixed(2)}R</div>
    </div>`).join('');
  return `
    <div class="tf-risk-table">
      <div class="tf-risk-table-row tf-risk-table-head">
        <div>Level</div><div>Price</div><div>% Dist</div><div>Proj. P/L</div><div>R-Units</div>
      </div>
      ${rowHtml}
    </div>`;
}

function tfRenderRiskProfileHtml({ entry, stop, target, qty, mult = 1, title = 'Visual risk profile', unitLabel = 'unit', riskUnitDollars = null, moonshotR = null } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return '';
  const loss = Math.abs(e - s) * q * m;
  const reward = Math.abs(t - e) * q * m;
  if (!(loss > 0 && reward > 0)) return '';
  const riskUnit = Number(riskUnitDollars) > 0 ? Number(riskUnitDollars) : loss;
  const rewardR = reward / loss;
  const displayR = Number.isFinite(rewardR) ? rewardR : 0;
  const moonR = window.tfClampMoonshotR(moonshotR === null || moonshotR === undefined ? window.tfMoonshotR() : moonshotR);
  return `
    <div class="tf-risk-profile" data-tf-risk-entry="${e}" data-tf-risk-stop="${s}" data-tf-risk-target="${t}" data-tf-risk-qty="${q}" data-tf-risk-mult="${m}" data-tf-risk-unit="${riskUnit}">
      <div class="tf-risk-profile-head">
        <div class="tf-risk-profile-title">${title}</div>
        <div class="tf-risk-profile-meta">1R = ${window.tfAbsMoneyText(riskUnit)} · stop risk ${window.tfAbsMoneyText(loss)} · ${q} ${unitLabel}${q === 1 ? '' : 's'} · ${displayR.toFixed(2)}R target</div>
      </div>
      <div data-tf-risk-rail-wrap>${window.tfRiskRailHtml({ entry, stop, target, qty, mult, moonshotR: moonR })}</div>
      ${window.tfRenderMoonshotSliderHtml(moonR)}
      <div data-tf-risk-table-wrap>${window.tfRenderRiskTableHtml({ entry, stop, target, qty, mult, riskUnitDollars: riskUnit, moonshotR: moonR })}</div>
    </div>`;
}

function tfRiskArgsFromProfile(profile, moonshotR) {
  if (!profile) return null;
  return {
    entry: Number(profile.dataset.tfRiskEntry),
    stop: Number(profile.dataset.tfRiskStop),
    target: Number(profile.dataset.tfRiskTarget),
    qty: Number(profile.dataset.tfRiskQty),
    mult: Number(profile.dataset.tfRiskMult),
    riskUnitDollars: Number(profile.dataset.tfRiskUnit),
    moonshotR,
  };
}

function tfRefreshMoonshotProfile(profile, moonshotR) {
  if (!profile) return;
  const value = profile.querySelector('[data-tf-moonshot-value]');
  if (value) value.textContent = window.tfFormatR(moonshotR);
  const railWrap = profile.querySelector('[data-tf-risk-rail-wrap]');
  const tableWrap = profile.querySelector('[data-tf-risk-table-wrap]');
  const args = window.tfRiskArgsFromProfile(profile, moonshotR);
  if (railWrap && args) railWrap.innerHTML = window.tfRiskRailHtml(args);
  if (tableWrap && args) tableWrap.innerHTML = window.tfRenderRiskTableHtml(args);
}

function tfBindMoonshotSliders() {
  document.querySelectorAll('#panel-trade [data-tf-moonshot-slider]').forEach(slider => {
    if (slider.dataset.tfMoonshotBound === '1') return;
    slider.dataset.tfMoonshotBound = '1';

    slider.addEventListener('input', e => {
      const next = window.tfClampMoonshotR(e.target.value);
      if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
      state.tradeFlow.moonshotR = next;
      document.querySelectorAll('#panel-trade [data-tf-moonshot-slider]').forEach(other => {
        other.value = next;
        window.tfRefreshMoonshotProfile(other.closest('.tf-risk-profile'), next);
      });
      saveState();
    });
  });
}


window.tfMoneyText = tfMoneyText;
window.tfPctText = tfPctText;
window.tfSignedMoneyText = tfSignedMoneyText;
window.tfAbsMoneyText = tfAbsMoneyText;
window.tfOptionSpreadFromBidAsk = tfOptionSpreadFromBidAsk;
window.tfSpreadReadHtml = tfSpreadReadHtml;
window.tfOptionBidAskInputsHtml = tfOptionBidAskInputsHtml;
window.tfClampMoonshotR = tfClampMoonshotR;
window.tfFormatR = tfFormatR;
window.tfMoonshotR = tfMoonshotR;
window.tfRenderMoonshotSliderHtml = tfRenderMoonshotSliderHtml;
window.tfRiskLevelRows = tfRiskLevelRows;
window.tfRiskRailHtml = tfRiskRailHtml;
window.tfRenderRiskTableHtml = tfRenderRiskTableHtml;
window.tfRenderRiskProfileHtml = tfRenderRiskProfileHtml;
window.tfRiskArgsFromProfile = tfRiskArgsFromProfile;
window.tfRefreshMoonshotProfile = tfRefreshMoonshotProfile;
window.tfBindMoonshotSliders = tfBindMoonshotSliders;
