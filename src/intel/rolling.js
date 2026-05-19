// Rolling P/L over the kill-switch window — single source of truth
// for both Home and Stats. Returns { totalPL, pct, days, count, winRate, floor, killActive }.

import { state } from '../state/store.js';
import { isClosedTrade, calcPL } from '../models/trade.js';

// % drawdown at which the kill switch trips. Stored as a positive number in
// settings (e.g. 7 → threshold is -7%); fall back to 7 when missing.
export function getKillSwitchFloor() {
  const v = Number(state.settings && state.settings.killSwitchFloor);
  return Number.isFinite(v) && v > 0 ? v : 7;
}

export function computeRollingPL() {
  const days = (state.settings && state.settings.killSwitchDays) || 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = [];
  (state.trades || []).forEach(t => {
    if (!isClosedTrade(t)) return;
    const d = t.exit_date || t.date;
    if (!d || new Date(d).getTime() < cutoff) return;
    recent.push(t);
  });
  // Sort chronologically once; both totals and the cumulative series read from this.
  recent.sort((a, b) => new Date(a.exit_date || a.date) - new Date(b.exit_date || b.date));
  let totalPL = 0;
  let wins = 0;
  const series = recent.map(t => {
    const pl = calcPL(t) || 0;
    totalPL += pl;
    if (pl > 0) wins++;
    return totalPL;
  });
  const account = (state.settings && state.settings.account) || 10000;
  const winRate = recent.length ? Math.round(wins / recent.length * 100) : null;
  const pct = totalPL / account * 100;
  const floor = getKillSwitchFloor();
  return { totalPL, pct, days, count: recent.length, winRate, floor, killActive: pct <= -floor, series };
}

// Tiny inline SVG sparkline for the TREND chip. Pure markup, no deps.
// Caller passes cumulative P/L points; we render them as a polyline that
// ends with a small dot so the last value is easy to see.
export function buildSparklineSvg(values, opts = {}) {
  const w = opts.w || 60;
  const h = opts.h || 16;
  const stroke = opts.stroke || 'currentColor';
  if (!Array.isArray(values) || values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = pts.split(' ').pop().split(',');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true" class="alpha-intel-spark"><polyline fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" points="${pts}"></polyline><circle cx="${last[0]}" cy="${last[1]}" r="1.6" fill="${stroke}"></circle></svg>`;
}


