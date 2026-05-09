<<<<<<< HEAD
// Stats — performance dashboard. Equity curve, R-distribution, setup performance.
// Builds entirely from state.trades; no DOM is hard-coded in index.html.

import { state } from '../state/store.js';
import { calcPL, calcR, isClosedTrade } from '../models/trade.js';
import { buildTradeIndex } from '../models/trade-index.js';
import { esc } from '../dom/html.js';

const $ = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(Math.round(v)).toLocaleString()}`;

function getPeriod() {
  return state.statsPeriod || '3M';
}

function periodMs(p) {
  switch (p) {
    case '1W': return 7 * 24 * 3600 * 1000;
    case '1M': return 30 * 24 * 3600 * 1000;
    case '3M': return 90 * 24 * 3600 * 1000;
    case 'YTD': {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 1);
      return now - start;
    }
    case 'ALL':
    default: return Infinity;
  }
}

function buildEquityCurve(closedSorted) {
  // Cumulative P/L over time. Returns {points: [{x, y, date, pl}], min, max, peak}.
  if (!closedSorted.length) return { points: [], min: 0, max: 0, peak: 0, peakIdx: 0, ddIdx: 0, dd: 0 };
  let cum = 0;
  const points = closedSorted.map((t, i) => {
    cum += calcPL(t) || 0;
    return { i, cum, date: t.exit_date || t.date };
  });
  let peak = points[0].cum;
  let peakIdx = 0;
  let dd = 0;
  let ddIdx = 0;
  let runningPeak = -Infinity;
  points.forEach((p, i) => {
    if (p.cum > runningPeak) runningPeak = p.cum;
    const drawdown = p.cum - runningPeak;
    if (drawdown < dd) { dd = drawdown; ddIdx = i; }
    if (p.cum > peak) { peak = p.cum; peakIdx = i; }
  });
  const min = Math.min(0, ...points.map(p => p.cum));
  const max = Math.max(0, peak);
  return { points, min, max, peak, peakIdx, ddIdx, dd };
}

function equityCurveSvg(curve) {
  const W = 760, H = 220;
  const padL = 44, padR = 14, padT = 16, padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const { points, min, max } = curve;

  if (!points.length) {
    return `
      <svg viewBox="0 0 ${W} ${H}" style="display:block; width:100%;">
        <text x="${W/2}" y="${H/2}" text-anchor="middle" fill="var(--ink-4)"
              font-family="var(--mono)" font-size="12">No closed trades yet</text>
      </svg>`;
  }

  const span = (max - min) || 1;
  const xOf = (i) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yOf = (v) => padT + innerH - ((v - min) / span) * innerH;
  const baseY = yOf(0);

  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${xOf(i).toFixed(1)} ${yOf(p.cum).toFixed(1)}`).join(' ');
  const fillPath = `${path} L ${xOf(points.length - 1).toFixed(1)} ${baseY.toFixed(1)} L ${xOf(0).toFixed(1)} ${baseY.toFixed(1)} Z`;

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const v = min + (max - min) * t;
    return { v, y: yOf(v) };
  });

  // X labels — first / mid / last
  const xLabels = points.length >= 3
    ? [0, Math.floor(points.length / 2), points.length - 1].map(i => ({ x: xOf(i), label: points[i].date }))
    : points.map((p, i) => ({ x: xOf(i), label: p.date }));

  const peakX = xOf(curve.peakIdx);
  const peakY = yOf(curve.peak);
  const ddX = xOf(curve.ddIdx);
  const ddY = yOf(points[curve.ddIdx].cum);

  return `
    <svg viewBox="0 0 ${W} ${H}" style="display:block; width:100%;">
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#06d4f8" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#06d4f8" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="eqline" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7be8fb" />
          <stop offset="100%" stop-color="#06d4f8" />
        </linearGradient>
      </defs>
      ${yLabels.map(({ v, y }) => `
        <line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="2 4" />
        <text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-family="var(--mono)" font-size="9.5" fill="var(--ink-4)" letter-spacing="0.05em">${v >= 0 ? '+' : '-'}$${Math.abs(Math.round(v)).toLocaleString()}</text>
      `).join('')}
      <line x1="${padL}" x2="${W - padR}" y1="${baseY}" y2="${baseY}" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
      <path d="${fillPath}" fill="url(#eqfill)" />
      <path d="${path}" fill="none" stroke="url(#eqline)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      ${curve.dd < 0 ? `
        <circle cx="${ddX}" cy="${ddY}" r="3" fill="var(--red-bright)" />
        <text x="${ddX}" y="${ddY + 16}" text-anchor="middle" font-family="var(--mono)" font-size="9" font-weight="700" fill="var(--red-bright)" letter-spacing="0.10em">DD ${$(curve.dd)}</text>
      ` : ''}
      <circle cx="${peakX}" cy="${peakY}" r="4" fill="var(--cyan)" stroke="var(--bg)" stroke-width="2" />
      <text x="${peakX}" y="${Math.max(8, peakY - 8)}" text-anchor="middle" font-family="var(--mono)" font-size="9" font-weight="700" fill="var(--green-bright)" letter-spacing="0.10em">PEAK</text>
      ${xLabels.map(l => `
        <text x="${l.x}" y="${H - 12}" text-anchor="middle" font-family="var(--mono)" font-size="9.5" fill="var(--ink-4)" letter-spacing="0.10em">${esc(l.label || '')}</text>
      `).join('')}
    </svg>`;
}

function buildRDist(closed) {
  // Bucket trades into <-2, -2, -1, 0, +1, +2, +3, >+3
  const buckets = [
    { lab: '<-2R', n: 0, neg: true,  zero: false },
    { lab: '-2R',  n: 0, neg: true,  zero: false },
    { lab: '-1R',  n: 0, neg: true,  zero: false },
    { lab: '0R',   n: 0, neg: false, zero: true },
    { lab: '+1R',  n: 0, neg: false, zero: false },
    { lab: '+2R',  n: 0, neg: false, zero: false },
    { lab: '+3R',  n: 0, neg: false, zero: false },
    { lab: '>+3R', n: 0, neg: false, zero: false },
  ];
  closed.forEach(t => {
    const r = calcR(t);
    if (r === null || !Number.isFinite(r)) return;
    if (r < -1.5) buckets[0].n++;
    else if (r < -0.5) buckets[1].n++;
    else if (r < -0.001) buckets[2].n++;
    else if (r < 0.5) buckets[3].n++;
    else if (r < 1.5) buckets[4].n++;
    else if (r < 2.5) buckets[5].n++;
    else if (r < 3.5) buckets[6].n++;
    else buckets[7].n++;
  });
  const max = Math.max(1, ...buckets.map(b => b.n));
  buckets.forEach(b => { b.h = Math.round((b.n / max) * 100); });
  return buckets;
}

function buildSetupPerformance(closed) {
  // Group by setup name
  const groups = new Map();
  closed.forEach(t => {
    const key = `${(t.mode || 'swing').toLowerCase()}|${t.setup || 'Unspecified'}`;
    if (!groups.has(key)) groups.set(key, { mode: (t.mode || 'swing').toLowerCase(), setup: t.setup || 'Unspecified', trades: [] });
    groups.get(key).trades.push(t);
  });
  const rows = [...groups.values()].map(g => {
    const n = g.trades.length;
    const wins = g.trades.filter(t => (calcPL(t) || 0) > 0).length;
    const winRate = n ? Math.round(wins / n * 100) : 0;
    const totalPL = g.trades.reduce((s, t) => s + (calcPL(t) || 0), 0);
    const totalR = g.trades.reduce((s, t) => s + (calcR(t) || 0), 0);
    const avgR = n ? totalR / n : 0;
    const exp = n ? Math.round(totalPL / n) : 0;
    let edge = 'holding';
    if (n >= 5 && avgR >= 0.7) edge = 'strong';
    else if (n >= 5 && avgR < -0.2) edge = 'kill';
    else if (n >= 5 && avgR < 0.2) edge = 'fading';
    return { mode: g.mode, name: g.setup, n, winRate, avgR, totalPL, exp, edge };
  });
  rows.sort((a, b) => b.totalPL - a.totalPL);
  return rows;
}

function statCardHtml(label, value, sub, accent) {
  const valueClass = accent ? `ae-stat-value ${accent}` : 'ae-stat-value';
  return `
    <div class="ae-stat">
      <div class="ae-stat-label">${esc(label)}</div>
      <div class="${valueClass}">${value}</div>
      <div class="ae-stat-sub">${sub || ''}</div>
    </div>`;
=======
// Stats tab — equity curve, 7 metric cards, R-distribution, setup performance.

import { state } from '../state/store.js';
import { isClosedTrade, calcPL } from '../models/trade.js';
import { computeRollingPL } from '../intel/rolling.js';
import { buildTradeIndex } from '../models/trade-index.js';

const PERIODS = [
  { k: '1W', days: 7 },
  { k: '1M', days: 30 },
  { k: '3M', days: 90 },
  { k: 'YTD', days: null },
  { k: 'ALL', days: null },
];

function getStatsPeriod() {
  return state.statsPeriod || '3M';
}

function filterByPeriod(trades, periodKey) {
  const now = Date.now();
  const def = PERIODS.find(p => p.k === periodKey) || PERIODS[2];
  if (periodKey === 'ALL') return trades;
  if (periodKey === 'YTD') {
    const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
    return trades.filter(t => {
      const d = new Date(t.exit_date || t.date);
      return d.getTime() >= jan1;
    });
  }
  const cutoff = now - def.days * 86400000;
  return trades.filter(t => {
    const d = new Date(t.exit_date || t.date);
    return d.getTime() >= cutoff;
  });
}

function buildEquityCurve(sortedTrades) {
  // Returns array of { date, cumPL } cumulative points.
  let cum = 0;
  const points = [{ date: null, cumPL: 0 }];
  sortedTrades.forEach(t => {
    cum += calcPL(t) || 0;
    points.push({ date: t.exit_date || t.date, cumPL: cum });
  });
  return points;
}

function renderEquitySvg(points, totalPL) {
  if (points.length < 2) {
    return `<svg viewBox="0 0 760 200" width="100%" class="stats-equity-svg">
      <text x="380" y="100" text-anchor="middle" font-family="var(--mono)" font-size="13" fill="var(--ink-4)">No closed trades in this period</text>
    </svg>`;
  }
  const W = 760, H = 188, PAD_L = 52, PAD_R = 16, PAD_T = 16, PAD_B = 20;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const vals = points.map(p => p.cumPL);
  const minV = Math.min(0, ...vals);
  const maxV = Math.max(0, ...vals);
  const range = maxV - minV || 1;
  const toX = i => PAD_L + (i / (points.length - 1)) * plotW;
  const toY = v => PAD_T + plotH - ((v - minV) / range * plotH);
  const pts = points.map((p, i) => `${toX(i).toFixed(1)} ${toY(p.cumPL).toFixed(1)}`);
  const pathD = 'M' + pts.join(' L');
  const fillD = pathD + ` L${toX(points.length - 1).toFixed(1)} ${toY(0).toFixed(1)} L${toX(0).toFixed(1)} ${toY(0).toFixed(1)} Z`;
  const isPos = totalPL >= 0;
  const lineColor = isPos ? 'var(--cyan)' : 'var(--red-bright)';
  const fillColor = isPos ? 'rgba(6,212,248,0.15)' : 'rgba(248,113,113,0.12)';

  // Y-axis labels (5 lines)
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = minV + f * range;
    const y = toY(v);
    const label = (v >= 0 ? '+$' : '-$') + Math.abs(Math.round(v)).toLocaleString();
    return `<g>
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="2 4"/>
      <text x="${PAD_L - 4}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9.5" fill="var(--ink-4)">${label}</text>
    </g>`;
  }).join('');

  // Baseline
  const baseY = toY(0).toFixed(1);

  return `<svg viewBox="0 0 ${W} ${H + PAD_B}" width="100%" class="stats-equity-svg">
    ${yLabels}
    <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${baseY}" y2="${baseY}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <path d="${fillD}" fill="${fillColor}"/>
    <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${toX(points.length - 1).toFixed(1)}" cy="${toY(points[points.length - 1].cumPL).toFixed(1)}" r="4" fill="${lineColor}" stroke="var(--bg)" stroke-width="2"/>
  </svg>`;
>>>>>>> claude-recovery
}

export function renderStats() {
  const shell = document.getElementById('stats-shell');
  if (!shell) return;
<<<<<<< HEAD
  const period = getPeriod();
  const periodWindow = periodMs(period);
  const trades = state.trades || [];
  const closedAll = trades.filter(isClosedTrade);

  const cutoffMs = Date.now() - periodWindow;
  const inWindow = (t) => {
    const d = t.exit_date || t.date;
    return d ? new Date(d + 'T12:00:00').getTime() >= cutoffMs : false;
  };
  const closed = periodWindow === Infinity ? closedAll : closedAll.filter(inWindow);
  const sortedByExit = [...closed].sort((a, b) => {
    const ad = (a.exit_date || a.date) || '';
    const bd = (b.exit_date || b.date) || '';
    return ad.localeCompare(bd);
  });

  const totalPL = closed.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const totalR = closed.reduce((s, t) => s + (calcR(t) || 0), 0);
  const wins = closed.filter(t => (calcPL(t) || 0) > 0);
  const losses = closed.filter(t => (calcPL(t) || 0) < 0);
  const winRate = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
  const avgR = closed.length ? totalR / closed.length : 0;
  const avgWinR = wins.length ? wins.reduce((s, t) => s + (calcR(t) || 0), 0) / wins.length : 0;
  const avgLossR = losses.length ? losses.reduce((s, t) => s + (calcR(t) || 0), 0) / losses.length : 0;
  const account = state.settings?.account || 10000;
  const equityPct = account ? (totalPL / account) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (calcPL(t) || 0), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  const expectancy = closed.length ? totalPL / closed.length : 0;

  const curve = buildEquityCurve(sortedByExit);
  const buckets = buildRDist(closed);
  const setupRows = buildSetupPerformance(closed);

  const periodLabel = period === 'YTD' ? 'YEAR-TO-DATE' : period === 'ALL' ? 'ALL-TIME' : `${period.replace('M', '-MONTH').replace('W', '-WEEK')} PERFORMANCE`;
  const dateRange = sortedByExit.length
    ? `${sortedByExit[0].exit_date || sortedByExit[0].date} – ${sortedByExit[sortedByExit.length - 1].exit_date || sortedByExit[sortedByExit.length - 1].date}`
    : 'NO TRADES';

  const heroValue = totalPL >= 0 ? `+$${Math.abs(Math.round(totalPL)).toLocaleString()}` : `-$${Math.abs(Math.round(totalPL)).toLocaleString()}`;
  const heroPctText = `${equityPct >= 0 ? '+' : ''}${equityPct.toFixed(1)}%`;
  const ddText = curve.dd < 0 ? `${$(curve.dd)}` : '$0';

  const periods = ['1W', '1M', '3M', 'YTD', 'ALL'];
  const periodPills = periods.map(p =>
    `<span class="stats-period-pill ${p === period ? 'active' : ''}" data-stats-period="${p}">${p}</span>`
  ).join('');

  // Best / worst trades
  const sortedR = [...closed].sort((a, b) => (calcR(b) || 0) - (calcR(a) || 0));
  const bestTrade = sortedR[0];
  const worstTrade = sortedR[sortedR.length - 1];
  const bestR = bestTrade ? (calcR(bestTrade) || 0) : 0;
  const worstR = worstTrade ? (calcR(worstTrade) || 0) : 0;

  // Streak
  let streak = 0, streakKind = 'W';
  for (let i = sortedByExit.length - 1; i >= 0; i--) {
    const pl = calcPL(sortedByExit[i]) || 0;
    const kind = pl > 0 ? 'W' : pl < 0 ? 'L' : 'N';
    if (i === sortedByExit.length - 1) { streakKind = kind; streak = 1; continue; }
    if (kind === streakKind) streak++;
    else break;
  }

  shell.innerHTML = `
    <section class="stats-hero">
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div class="stats-hero-kicker">
          <span class="ae-dot cyan"></span> ${esc(periodLabel)} · ${esc(dateRange)}
        </div>
        <h1 class="${totalPL < 0 ? 'red' : ''}">${heroValue}</h1>
        <p>
          <strong style="color:${equityPct >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'}">${heroPctText}</strong> on starting equity ·
          <strong>${closed.length} closed</strong> ·
          max DD <strong style="color:var(--red-bright)">${ddText}</strong>
        </p>
        <div class="stats-period-row">${periodPills}</div>
      </div>
      <div class="ae-card stats-equity-card">
        <div class="stats-equity-head">
          <h2>Equity curve</h2>
          <span class="ae-mono">Cumulative · realized</span>
        </div>
        ${equityCurveSvg(curve)}
      </div>
    </section>

    <section class="stats-grid">
      ${statCardHtml('Net P/L', heroValue, heroPctText, totalPL >= 0 ? 'green' : 'red')}
      ${statCardHtml('Win rate', `${winRate}%`, `${wins.length} / ${closed.length}`, '')}
      ${statCardHtml('Avg R', `${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R`, `W ${avgWinR >= 0 ? '+' : ''}${avgWinR.toFixed(2)}R · L ${avgLossR.toFixed(2)}R`, '')}
      ${statCardHtml('Profit factor', Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞', '$ won vs lost', 'cyan')}
      ${statCardHtml('Expectancy', `${expectancy >= 0 ? '+$' : '-$'}${Math.abs(Math.round(expectancy))}`, 'per trade', expectancy >= 0 ? 'green' : 'red')}
      ${statCardHtml('Max DD', ddText, curve.dd < 0 ? `${closed.length} trades` : '—', 'red')}
      ${statCardHtml('Streak', `${streak}${streakKind}`, 'current', streakKind === 'W' ? 'cyan' : streakKind === 'L' ? 'red' : '')}
    </section>

    <section class="stats-bottom-row">
      <div class="ae-card" style="padding: 20px 22px; display:flex; flex-direction:column; gap:14px;">
        <div class="stats-section-head">
          <h2>R-distribution</h2>
          <span class="ae-mono">${closed.length} closed</span>
        </div>
        <div class="r-dist-bars">
          ${buckets.map(b => {
            const cls = b.zero ? 'zero' : b.neg ? 'neg' : 'pos';
            return `
              <div class="r-bar">
                <div class="r-bar-count">${b.n}</div>
                <div class="r-bar-fill ${cls}" style="height: ${b.h}%;"></div>
                <div class="r-bar-label">${esc(b.lab)}</div>
              </div>`;
          }).join('')}
        </div>
        <div class="r-dist-summary">
          <div>
            <div class="label">Best</div>
            <div class="v" style="color: var(--green-bright);">${bestTrade ? `${bestR >= 0 ? '+' : ''}${bestR.toFixed(2)}R` : '—'}</div>
            <div class="sub">${bestTrade ? esc(`${bestTrade.ticker || ''} · ${bestTrade.exit_date || bestTrade.date || ''}`) : '—'}</div>
          </div>
          <div>
            <div class="label">Worst</div>
            <div class="v" style="color: var(--red-bright);">${worstTrade ? `${worstR.toFixed(2)}R` : '—'}</div>
            <div class="sub">${worstTrade ? esc(`${worstTrade.ticker || ''} · ${worstTrade.exit_date || worstTrade.date || ''}`) : '—'}</div>
          </div>
          <div>
            <div class="label">Streak</div>
            <div class="v" style="color: ${streakKind === 'W' ? 'var(--cyan)' : streakKind === 'L' ? 'var(--red-bright)' : 'var(--ink)'};">${streak}${streakKind}</div>
            <div class="sub">current</div>
=======

  const period = getStatsPeriod();
  const account = (state.settings && state.settings.account) || 10000;
  const allClosed = (state.trades || []).filter(t => isClosedTrade(t));
  const periodClosed = filterByPeriod(allClosed, period).sort((a, b) =>
    (a.exit_date || a.date || '').localeCompare(b.exit_date || b.date || '')
  );

  const closedWithPL = periodClosed.map(t => ({ trade: t, pl: calcPL(t) || 0, r: window.calcR ? (window.calcR(t) || 0) : 0 }));
  const wins   = closedWithPL.filter(x => x.pl > 0);
  const losses = closedWithPL.filter(x => x.pl < 0);
  const totalPL    = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRateNum = closedWithPL.length ? wins.length / closedWithPL.length * 100 : null;
  const grossWin   = wins.reduce((s, x) => s + x.pl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, x) => s + x.pl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? '∞' : '—');
  const expectancy   = closedWithPL.length ? totalPL / closedWithPL.length : 0;
  const avgR = closedWithPL.length ? closedWithPL.reduce((s, x) => s + x.r, 0) / closedWithPL.length : 0;

  // Max drawdown
  let peak = 0, maxDD = 0, ddStart = null;
  let cum = 0;
  periodClosed.forEach(t => {
    cum += calcPL(t) || 0;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) { maxDD = dd; ddStart = t.exit_date || t.date; }
  });

  // Sharpe-ish (daily P/L std dev)
  const sharpe = (() => {
    if (closedWithPL.length < 3) return null;
    const dailyMap = {};
    closedWithPL.forEach(x => {
      const d = x.trade.exit_date || x.trade.date || '';
      dailyMap[d] = (dailyMap[d] || 0) + x.pl;
    });
    const dailyPLs = Object.values(dailyMap);
    const mean = dailyPLs.reduce((s, v) => s + v, 0) / dailyPLs.length;
    const variance = dailyPLs.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyPLs.length;
    const sd = Math.sqrt(variance);
    return sd > 0 ? ((mean / sd) * Math.sqrt(252)).toFixed(2) : null;
  })();

  // R-distribution
  const rBuckets = [
    { lab: '<−2R', min: -Infinity, max: -2, neg: true },
    { lab: '−2R',  min: -2, max: -1,   neg: true },
    { lab: '−1R',  min: -1, max: -0.01, neg: true },
    { lab: '0R',   min: -0.01, max: 0.01, neg: false, neutral: true },
    { lab: '+1R',  min: 0.01, max: 1,   neg: false },
    { lab: '+2R',  min: 1, max: 2,      neg: false },
    { lab: '+3R',  min: 2, max: 3,      neg: false },
    { lab: '>+3R', min: 3, max: Infinity, neg: false },
  ];
  const bucketCounts = rBuckets.map(b => closedWithPL.filter(x => x.r >= b.min && x.r < b.max).length);
  const maxCount = Math.max(...bucketCounts, 1);

  const rBarsHtml = rBuckets.map((b, i) => {
    const n = bucketCounts[i];
    const h = Math.max(4, Math.round(n / maxCount * 100));
    const cls = b.neutral ? 'neutral' : b.neg ? 'neg' : 'pos';
    return `<div class="stats-rdist-col">
      <div class="stats-rdist-count">${n}</div>
      <div class="stats-rdist-bar ${cls}" style="height:${h}%"></div>
      <div class="stats-rdist-bucket">${b.lab}</div>
    </div>`;
  }).join('');

  const bestTrade  = wins.length   ? wins.reduce((a, b) => a.r > b.r ? a : b) : null;
  const worstTrade = losses.length ? losses.reduce((a, b) => a.r < b.r ? a : b) : null;

  // Setup performance table
  const setupMap = {};
  periodClosed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { n: 0, wins: 0, pl: 0, totalR: 0, mode: t.mode || 'swing' };
    const pl = calcPL(t) || 0;
    setupMap[k].n++;
    if (pl > 0) setupMap[k].wins++;
    setupMap[k].pl += pl;
    setupMap[k].totalR += window.calcR ? (window.calcR(t) || 0) : 0;
  });
  const setupRows = Object.entries(setupMap)
    .sort(([, a], [, b]) => b.pl - a.pl)
    .map(([name, s]) => {
      const wr = Math.round(s.wins / s.n * 100);
      const avgRv = (s.totalR / s.n);
      const exp = (s.pl / s.n);
      const edge = avgRv >= 0.7 ? 'strong' : avgRv >= 0.3 ? 'holding' : avgRv >= 0 ? 'fading' : 'kill';
      const plStr = (s.pl >= 0 ? '+$' : '-$') + Math.abs(s.pl).toFixed(0);
      const expStr = (exp >= 0 ? '+$' : '-$') + Math.abs(exp).toFixed(0) + '/trade';
      return `<div class="stats-setup-row">
        <span class="stats-mode-badge ${s.mode}">${s.mode}</span>
        <span style="color:var(--ink-2);font-size:13px;">${name}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-3);">${s.n}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-2);">${wr}%</span>
        <span style="font-family:var(--mono);text-align:right;color:${avgRv >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'};font-weight:700;">${avgRv >= 0 ? '+' : ''}${avgRv.toFixed(2)}R</span>
        <span style="font-family:var(--mono);text-align:right;color:${s.pl >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'};font-weight:700;">${plStr}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-3);font-size:11px;">${expStr}</span>
        <span class="stats-edge-badge ${edge}">${edge}</span>
      </div>`;
    }).join('') || `<div style="color:var(--ink-4);font-size:13px;padding:16px 4px;">No closed trades in this period.</div>`;

  // Period start label
  const firstTrade = periodClosed[0];
  const lastTrade  = periodClosed[periodClosed.length - 1];
  const periodLabel = firstTrade && lastTrade
    ? `${firstTrade.exit_date || firstTrade.date || '?'} – ${lastTrade.exit_date || lastTrade.date || '?'}`
    : period;

  // Equity curve
  const curvePoints = buildEquityCurve(periodClosed);
  const svgHtml = renderEquitySvg(curvePoints, totalPL);

  // Period tabs
  const periodTabsHtml = PERIODS.map(p =>
    `<button class="stats-period-tab${p.k === period ? ' active' : ''}" data-stats-period="${p.k}" type="button">${p.k}</button>`
  ).join('');

  // 7 metric cards
  const totalPLStr = (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const metrics = [
    { label: 'Net P/L',       value: totalPLStr,                                              sub: `${(totalPL / account * 100).toFixed(1)}%`,         cls: totalPL >= 0 ? 'pos' : 'neg' },
    { label: 'Win rate',      value: winRateNum !== null ? winRateNum.toFixed(0) + '%' : '—', sub: `${wins.length} / ${closedWithPL.length}`,           cls: '' },
    { label: 'Avg R',         value: closedWithPL.length ? (avgR >= 0 ? '+' : '') + avgR.toFixed(2) + 'R' : '—',
                                                                                               sub: `W ${wins.length ? ('+' + (wins.reduce((s,x)=>s+x.r,0)/wins.length).toFixed(2) + 'R') : '—'} · L ${losses.length ? (losses.reduce((s,x)=>s+x.r,0)/losses.length).toFixed(2) + 'R' : '—'}`, cls: '' },
    { label: 'Profit factor', value: String(profitFactor),                                    sub: '$ won vs lost',                                      cls: 'cyan' },
    { label: 'Expectancy',    value: (expectancy >= 0 ? '+$' : '-$') + Math.abs(expectancy).toFixed(0), sub: 'per trade',                              cls: expectancy >= 0 ? 'pos' : 'neg' },
    { label: 'Max DD',        value: maxDD > 0 ? '-$' + Math.round(maxDD).toLocaleString() : '—',
                                                                                               sub: ddStart ? ddStart : 'none',                          cls: maxDD > 0 ? 'neg' : '' },
    { label: 'Sharpe-ish',    value: sharpe !== null ? sharpe : '—',                          sub: 'daily, ann.',                                        cls: '' },
  ].map(m => `<div class="stats-metric-card">
    <div class="stats-metric-label">${m.label}</div>
    <div class="stats-metric-value ${m.cls}">${m.value}</div>
    <div class="stats-metric-sub">${m.sub}</div>
  </div>`).join('');

  shell.innerHTML = `
    <!-- Hero -->
    <section class="stats-hero">
      <div class="stats-hero-left">
        <div class="stats-hero-eyebrow">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 6px var(--cyan);flex-shrink:0;"></span>
          ${period === 'ALL' ? 'ALL TIME' : period + ' PERFORMANCE'} · ${periodLabel}
        </div>
        <h1 class="stats-hero-heading" style="color:var(--${totalPL >= 0 ? 'green-bright' : 'red-bright'})">${totalPLStr}</h1>
        <p class="stats-hero-sub">
          <strong style="color:var(--${totalPL >= 0 ? 'green-bright' : 'red-bright'})">${(totalPL / account * 100).toFixed(1)}%</strong> on equity ·
          <strong>${closedWithPL.length} closed</strong>
          ${maxDD > 0 ? ` · max DD <strong style="color:var(--red-bright)">-$${Math.round(maxDD).toLocaleString()}</strong>` : ''}
        </p>
        <div class="stats-period-tabs">${periodTabsHtml}</div>
      </div>
      <div class="stats-equity-card">
        <div class="stats-equity-header">
          <h2 class="stats-equity-title">Equity curve</h2>
          <span class="stats-equity-meta">Cumulative · realized</span>
        </div>
        ${svgHtml}
      </div>
    </section>

    <!-- 7 metric strip -->
    <div class="stats-metric-strip">${metrics}</div>

    <!-- R-dist + Setup perf -->
    <section class="stats-breakdown">
      <div class="stats-rdist-card">
        <div class="stats-rdist-header">
          <h2 class="stats-rdist-title">R-distribution</h2>
          <span class="stats-rdist-meta">${closedWithPL.length} closed</span>
        </div>
        <div class="stats-rdist-bars">${rBarsHtml}</div>
        <div class="stats-rdist-highlights">
          <div>
            <div class="stats-rdist-hi-label">Best</div>
            <div class="stats-rdist-hi-value" style="color:var(--green-bright)">${bestTrade ? (bestTrade.r >= 0 ? '+' : '') + bestTrade.r.toFixed(2) + 'R' : '—'}</div>
            <div class="stats-rdist-hi-sub">${bestTrade ? (bestTrade.trade.ticker || '') + ' · ' + (bestTrade.trade.exit_date || bestTrade.trade.date || '') : 'no wins'}</div>
          </div>
          <div>
            <div class="stats-rdist-hi-label">Worst</div>
            <div class="stats-rdist-hi-value" style="color:var(--red-bright)">${worstTrade ? (worstTrade.r >= 0 ? '+' : '') + worstTrade.r.toFixed(2) + 'R' : '—'}</div>
            <div class="stats-rdist-hi-sub">${worstTrade ? (worstTrade.trade.ticker || '') + ' · ' + (worstTrade.trade.exit_date || worstTrade.trade.date || '') : 'no losses'}</div>
          </div>
          <div>
            <div class="stats-rdist-hi-label">Avg R</div>
            <div class="stats-rdist-hi-value" style="color:var(--cyan)">${closedWithPL.length ? (avgR >= 0 ? '+' : '') + avgR.toFixed(2) + 'R' : '—'}</div>
            <div class="stats-rdist-hi-sub">per closed trade</div>
>>>>>>> claude-recovery
          </div>
        </div>
      </div>

<<<<<<< HEAD
      <div class="ae-card" style="padding: 20px 22px;">
        <div class="stats-section-head">
          <h2>Setup performance</h2>
          <span class="ae-mono">By tag · ${period}</span>
        </div>
        <div class="setup-perf-grid setup-perf-head">
          <div>SETUP</div><div></div>
          <div style="text-align:right;">N</div>
          <div style="text-align:right;">WIN</div>
          <div style="text-align:right;">AVG R</div>
          <div style="text-align:right;">P/L</div>
          <div style="text-align:right;">EXP</div>
          <div style="text-align:right;">EDGE</div>
        </div>
        ${setupRows.length === 0
          ? `<div style="padding: 24px 4px; color: var(--ink-4); font-family: var(--mono); font-size: 12px; text-align: center;">No closed trades in this period yet.</div>`
          : setupRows.slice(0, 8).map(r => {
              const plColor = r.totalPL >= 0 ? 'var(--green-bright)' : 'var(--red-bright)';
              const rColor = r.avgR >= 0 ? 'var(--green-bright)' : 'var(--red-bright)';
              return `
                <div class="setup-perf-grid setup-perf-row">
                  <span class="mode-pill ${r.mode}">${esc(r.mode)}</span>
                  <span style="color: var(--ink-2); font-size: 13px;">${esc(r.name)}</span>
                  <span style="font-family: var(--mono); text-align:right; color: var(--ink-3);">${r.n}</span>
                  <span style="font-family: var(--mono); text-align:right; color: var(--ink-2);">${r.winRate}%</span>
                  <span style="font-family: var(--mono); text-align:right; color: ${rColor}; font-weight: 700;">${r.avgR >= 0 ? '+' : ''}${r.avgR.toFixed(2)}R</span>
                  <span style="font-family: var(--mono); text-align:right; color: ${plColor}; font-weight: 700;">${r.totalPL >= 0 ? '+$' : '-$'}${Math.abs(Math.round(r.totalPL)).toLocaleString()}</span>
                  <span style="font-family: var(--mono); text-align:right; color: var(--ink-3); font-size: 11px;">${r.exp >= 0 ? '+$' : '-$'}${Math.abs(r.exp)}/trade</span>
                  <span class="edge-pill ${r.edge}">${esc(r.edge)}</span>
                </div>`;
            }).join('')
        }
=======
      <div class="stats-setup-card">
        <div class="stats-setup-header">
          <h2 class="stats-setup-title">Setup performance</h2>
          <span class="stats-setup-meta">By tag · ${period}</span>
        </div>
        <div class="stats-setup-head-row">
          <div>SETUP</div><div></div>
          <div style="text-align:right">N</div>
          <div style="text-align:right">WIN</div>
          <div style="text-align:right">AVG R</div>
          <div style="text-align:right">P/L</div>
          <div style="text-align:right">EXP</div>
          <div style="text-align:right">EDGE</div>
        </div>
        ${setupRows}
>>>>>>> claude-recovery
      </div>
    </section>
  `;

<<<<<<< HEAD
  // Wire period pills
  shell.querySelectorAll('[data-stats-period]').forEach(pill => {
    pill.addEventListener('click', () => {
      state.statsPeriod = pill.dataset.statsPeriod;
      if (typeof window.saveState === 'function') window.saveState();
=======
  // Wire period tabs
  shell.querySelectorAll('[data-stats-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.statsPeriod = btn.dataset.statsPeriod;
>>>>>>> claude-recovery
      renderStats();
    });
  });
}

window.renderStats = renderStats;
