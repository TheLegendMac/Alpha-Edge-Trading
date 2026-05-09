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
}

export function renderStats() {
  const shell = document.getElementById('stats-shell');
  if (!shell) return;

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
          </div>
        </div>
      </div>

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
      </div>
    </section>
  `;

  // Wire period tabs
  shell.querySelectorAll('[data-stats-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.statsPeriod = btn.dataset.statsPeriod;
      renderStats();
    });
  });
}

window.renderStats = renderStats;
