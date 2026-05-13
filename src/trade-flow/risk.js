// Risk widgets: money/pct/R formatters, spread inputs, risk-table render.

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

function tfRiskDirection({ entry, stop, target } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  if (e > 0 && s > 0 && t > 0) {
    if (t > e && s < e) return 1;
    if (t < e && s > e) return -1;
  }
  const mode = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const explicit = mode === 'intraday' ? (state.intraday && state.intraday.direction) : state.direction;
  if ((explicit || '').toString().toLowerCase().startsWith('s')) return -1;
  if (e > 0 && t > 0 && t !== e) return t > e ? 1 : -1;
  if (e > 0 && s > 0 && s !== e) return s < e ? 1 : -1;
  return 1;
}

function tfRiskLevelStat({ entry, price, qty, mult = 1, rBase = null, direction = 1 } = {}) {
  const e = Number(entry);
  const p = Number(price);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && p > 0 && q > 0)) return null;
  const dir = direction === -1 ? -1 : 1;
  const pnl = (p - e) * dir * q * m;
  const pct = ((p - e) / e) * dir * 100;
  const base = Number(rBase);
  const r = base > 0 ? pnl / base : 0;
  return { pnl, pct, r };
}

function tfRiskLevelRows({ entry, stop, target, qty, mult = 1 } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return [];
  const stopDist = Math.abs(e - s);
  if (!(stopDist > 0)) return [];
  const direction = window.tfRiskDirection({ entry: e, stop: s, target: t });
  const loss = stopDist * q * m;
  const rBase = loss;
  const targetR = Math.abs(t - e) / stopDist;
  const targetLabel = Number.isFinite(targetR) ? `Target (${targetR.toFixed(1)}R)` : 'Target';
  const make = (label, price, cls) => {
    const p = Number(price);
    const stat = window.tfRiskLevelStat({ entry: e, price: p, qty: q, mult: m, rBase, direction });
    return { label, price: p, dist: stat ? stat.pct : 0, pnl: stat ? stat.pnl : 0, r: stat ? stat.r : 0, cls };
  };
  return [
    make('Stop loss', s, 'stop'),
    make('Entry', e, 'entry'),
    make(targetLabel, t, 'target'),
  ];
}

function tfRiskRailHtml({ entry, stop, target, qty, mult = 1 } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return '';
  const stopDist = Math.abs(e - s);
  if (!(stopDist > 0)) return '';
  const loss = stopDist * q * m;
  const reward = Math.abs(t - e) * q * m;
  if (!(loss > 0 && reward > 0)) return '';
  const targetR = reward / loss;
  const targetVisual = Math.max(0.6, Math.min(3.0, targetR || 1));
  const total = 1 + targetVisual;
  const lossPct = (1 / total) * 100;
  const targetPct = 100 - lossPct;
  const zone = (cls, widthPct, caption, price, pnlText, rLabel) => `
    <div class="tf-risk-zone ${cls}" style="width:${widthPct.toFixed(2)}%;">
      <span class="tf-risk-chip">${rLabel}</span>
      <em class="tf-risk-caption">${caption}</em>
      <strong>${window.tfMoneyText(price)}</strong>
      <span>${pnlText}</span>
    </div>`;
  return `
    <div class="tf-risk-rail">
      ${zone('loss', lossPct, 'Closing @ Stop', s, `-${window.tfAbsMoneyText(loss, 2)}`, '-1R')}
      ${zone('target', targetPct, 'Closing @ Target', t, window.tfSignedMoneyText(reward, 2), `${targetR.toFixed(2)}R`)}
      <div class="tf-risk-entry-marker" style="left:${lossPct.toFixed(2)}%;"><span class="tf-risk-entry-label">ENTRY ${window.tfMoneyText(e)}</span></div>
    </div>`;
}

function tfRenderRiskTableHtml(args = {}) {
  const rows = window.tfRiskLevelRows(args);
  if (!rows.length) return '';
  const rowHtml = rows.map(r => `
    <div class="tf-risk-table-row ${r.cls}">
      <div class="level">${r.label}</div>
      <div>${window.tfMoneyText(r.price)}</div>
      <div>${r.dist >= 0 ? '+' : ''}${r.dist.toFixed(2)}%</div>
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

function tfPriceSliderBounds({ entry, stop, target, kind } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  if (!(e > 0)) return null;
  const dir = window.tfRiskDirection({ entry: e, stop: s, target: t });
  const tick = 0.01;
  const span = Math.max(Math.abs(e - s) || 0, Math.abs(t - e) || 0, e * 0.35, 0.25);
  let min;
  let max;
  if (kind === 'stop') {
    if (dir === 1) {
      min = Math.max(tick, Math.min(s > 0 ? s * 0.75 : e - span * 2, e - span * 2));
      max = Math.max(tick, e - tick);
    } else {
      min = e + tick;
      max = Math.max(s > 0 ? s * 1.25 : e + span * 2, e + span * 2);
    }
  } else {
    // Target slider — no practical ceiling/floor, let the user reach for it.
    if (dir === 1) {
      min = e + tick;
      max = Math.max(t > 0 ? t * 5 : e * 5, e + span * 20, e * 5);
    } else {
      min = tick;
      max = Math.max(tick, e - tick);
    }
  }
  if (!(max > min)) max = min + tick;
  return { min: +min.toFixed(2), max: +max.toFixed(2), step: tick };
}

function tfPriceSliderSummaryHtml({ entry, price, qty, mult, rBase, direction } = {}) {
  const stat = window.tfRiskLevelStat({ entry, price, qty, mult, rBase, direction });
  if (!stat) return '<span>—</span>';
  const cls = stat.pnl < 0 ? 'neg' : stat.pnl > 0 ? 'pos' : '';
  return `<span class="${cls}">${window.tfSignedMoneyText(stat.pnl, 0)} · ${stat.pct >= 0 ? '+' : ''}${stat.pct.toFixed(1)}% · ${stat.r >= 0 ? '+' : ''}${stat.r.toFixed(2)}R</span>`;
}

function tfRenderPriceLevelSlidersHtml({ entry, stop, target, qty, mult = 1 } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return '';
  const loss = Math.abs(e - s) * q * m;
  if (!(loss > 0)) return '';
  const direction = window.tfRiskDirection({ entry: e, stop: s, target: t });
  const row = (kind, label, value) => {
    const bounds = window.tfPriceSliderBounds({ entry: e, stop: s, target: t, kind });
    if (!bounds) return '';
    const clamped = Math.max(bounds.min, Math.min(bounds.max, Number(value)));
    return `
      <div class="tf-price-adjust-row" data-tf-price-row="${kind}">
        <div class="tf-price-adjust-head">
          <span>${label}</span>
          <output data-tf-price-output="${kind}">${window.tfMoneyText(clamped)}</output>
        </div>
        <input type="range" min="${bounds.min}" max="${bounds.max}" step="${bounds.step}" value="${clamped.toFixed(2)}" class="tf-price-adjust-slider" data-tf-price-slider="${kind}" aria-label="Adjust ${label.toLowerCase()} price" />
      </div>`;
  };
  return `
    <div class="tf-price-adjust">
      ${row('stop', 'Stop price', s)}
      ${row('target', 'Target price', t)}
    </div>`;
}

function tfRenderRiskProfileHtml({ entry, stop, target, qty, mult = 1 } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return '';
  const loss = Math.abs(e - s) * q * m;
  const reward = Math.abs(t - e) * q * m;
  if (!(loss > 0 && reward > 0)) return '';
  return `
    <div class="tf-risk-profile" data-tf-risk-entry="${e}" data-tf-risk-stop="${s}" data-tf-risk-target="${t}" data-tf-risk-qty="${q}" data-tf-risk-mult="${m}" data-tf-risk-unit="${loss}">
      <div data-tf-risk-rail-wrap>${window.tfRiskRailHtml({ entry, stop, target, qty, mult })}</div>
      ${window.tfRenderPriceLevelSlidersHtml({ entry, stop, target, qty, mult })}
    </div>`;
}

function tfRiskArgsFromProfile(profile) {
  if (!profile) return null;
  return {
    entry: Number(profile.dataset.tfRiskEntry),
    stop: Number(profile.dataset.tfRiskStop),
    target: Number(profile.dataset.tfRiskTarget),
    qty: Number(profile.dataset.tfRiskQty),
    mult: Number(profile.dataset.tfRiskMult),
    riskUnitDollars: Number(profile.dataset.tfRiskUnit),
  };
}

function tfSetPriceLevel(kind, raw) {
  const value = +Number(raw).toFixed(2);
  if (!(value > 0)) return;
  const mode = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (mode === 'intraday') {
    if (!state.intraday) state.intraday = {};
    state.intraday[kind] = value;
    if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '' };
    if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
    state.tradeFlow.intradayDraft[kind] = String(value);
    const input = document.getElementById(`tf-i-${kind}`);
    if (input) input.value = value;
    if (typeof window.tfUpdateIntradayRMult === 'function') window.tfUpdateIntradayRMult();
  } else {
    const key = kind === 'stop' ? 'swingStop' : 'swingTarget';
    state[key] = value;
    const input = document.getElementById(kind === 'stop' ? 'tf-swing-stop' : 'tf-swing-target');
    if (input) input.value = value;
  }
  saveState();
  if (typeof window.tfRefreshHeaderOnly === 'function') window.tfRefreshHeaderOnly();
}

function tfRefreshPriceSliderReadout(slider) {
  const profile = slider && slider.closest('.tf-risk-profile');
  if (!profile) return;
  const kind = slider.dataset.tfPriceSlider;
  const price = Number(slider.value);
  const output = profile.querySelector(`[data-tf-price-output="${kind}"]`);
  const args = window.tfRiskArgsFromProfile(profile);
  if (!args || !(price > 0)) return;
  const stop = kind === 'stop' ? price : args.stop;
  const target = kind === 'target' ? price : args.target;
  let qty = args.qty;
  let mult = args.mult;
  const mode = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (mode === 'intraday' && typeof window.tfComputeIntradayRiskSize === 'function') {
    const auto = window.tfComputeIntradayRiskSize();
    const manualQty = Number(state.intraday && state.intraday.contracts);
    if (auto) {
      qty = manualQty > 0 ? manualQty : auto.qty;
      mult = auto.mult;
    }
  }
  const loss = Math.abs(args.entry - stop) * qty * mult;
  profile.dataset.tfRiskStop = stop;
  profile.dataset.tfRiskTarget = target;
  profile.dataset.tfRiskQty = qty;
  profile.dataset.tfRiskMult = mult;
  profile.dataset.tfRiskUnit = loss;
  if (output) output.textContent = window.tfMoneyText(price);
  ['stop', 'target'].forEach(rowKind => {
    const rowPrice = rowKind === 'stop' ? stop : target;
    const rowOutput = profile.querySelector(`[data-tf-price-output="${rowKind}"]`);
    if (rowOutput) rowOutput.textContent = window.tfMoneyText(rowPrice);
  });
  const railWrap = profile.querySelector('[data-tf-risk-rail-wrap]');
  if (railWrap) railWrap.innerHTML = window.tfRiskRailHtml({ entry: args.entry, stop, target, qty, mult });
}

function tfBindPriceLevelSliders() {
  document.querySelectorAll('#panel-trade [data-tf-price-slider]').forEach(slider => {
    if (slider.dataset.tfPriceBound === '1') return;
    slider.dataset.tfPriceBound = '1';
    slider.addEventListener('input', e => {
      const kind = e.target.dataset.tfPriceSlider;
      window.tfSetPriceLevel(kind, e.target.value);
      window.tfRefreshPriceSliderReadout(e.target);
      // Live-refresh the gain/loss estimates so the target $/R numbers track
      // the slider thumb rather than waiting for the drag to end.
      const mode = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
      if (mode === 'intraday' && typeof window.tfUpdateIntradayRMult === 'function') {
        window.tfUpdateIntradayRMult();
      }
    });
    slider.addEventListener('change', () => {
      const mode = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
      if (mode === 'intraday' && typeof window.tfUpdateIntradaySizing === 'function') {
        window.tfUpdateIntradaySizing();
      } else if (typeof window.tfUpdateSwingSizing === 'function') {
        window.tfUpdateSwingSizing();
      }
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
window.tfRiskDirection = tfRiskDirection;
window.tfRiskLevelStat = tfRiskLevelStat;
window.tfRiskLevelRows = tfRiskLevelRows;
window.tfRiskRailHtml = tfRiskRailHtml;
window.tfRenderRiskTableHtml = tfRenderRiskTableHtml;
window.tfPriceSliderBounds = tfPriceSliderBounds;
window.tfPriceSliderSummaryHtml = tfPriceSliderSummaryHtml;
window.tfRenderPriceLevelSlidersHtml = tfRenderPriceLevelSlidersHtml;
window.tfRenderRiskProfileHtml = tfRenderRiskProfileHtml;
window.tfRiskArgsFromProfile = tfRiskArgsFromProfile;
window.tfSetPriceLevel = tfSetPriceLevel;
window.tfRefreshPriceSliderReadout = tfRefreshPriceSliderReadout;
window.tfBindPriceLevelSliders = tfBindPriceLevelSliders;
