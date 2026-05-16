// Stats tab — equity curve, 7 metric cards, R-distribution, setup performance.

import { state } from '../state/store.js';
import { isClosedTrade, calcPL, calcR } from '../models/trade.js';
import { computeRollingPL } from '../intel/rolling.js';
import { buildTradeIndex } from '../models/trade-index.js';
import { buildAlphaIntel, buildAlphaHighlightBullets } from '../intel/alpha.js';

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

function renderEquitySvg(points, totalPL, maxDDIdx = -1) {
  if (points.length < 2) {
    return `<svg viewBox="0 0 760 200" width="100%" class="stats-equity-svg">
      <text x="380" y="100" text-anchor="middle" font-family="var(--mono)" font-size="13" fill="var(--ink-4)">No closed trades in this period</text>
    </svg>`;
  }
  const W = 760, H = 178, PAD_L = 52, PAD_R = 16, PAD_T = 14, PAD_B = 28;
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
  const fillColor = isPos ? 'rgba(6,212,248,0.12)' : 'rgba(248,113,113,0.10)';

  // Y-axis labels (4 lines)
  const yLabels = [0, 0.33, 0.67, 1].map(f => {
    const v = minV + f * range;
    const y = toY(v);
    const label = (v >= 0 ? '+$' : '-$') + Math.abs(Math.round(v)).toLocaleString();
    return `<g>
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-dasharray="3 5"/>
      <text x="${PAD_L - 5}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="9" fill="rgba(148,163,184,0.7)">${label}</text>
    </g>`;
  }).join('');

  // X-axis date labels — evenly spaced, skip first (baseline)
  const xLabels = (() => {
    const n = points.length;
    if (n < 3) return '';
    const NUM = Math.min(6, n - 1);
    const labels = [];
    for (let k = 1; k <= NUM; k++) {
      const i = Math.round((k / NUM) * (n - 1));
      const pt = points[i];
      if (!pt || !pt.date) continue;
      const d = new Date(pt.date);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const x = toX(i);
      labels.push(`<text x="${x.toFixed(1)}" y="${(H + 8).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="8.5" fill="rgba(148,163,184,0.65)">${label}</text>`);
    }
    return labels.join('');
  })();

  // Peak dot
  const peakIdx = vals.reduce((best, v, i) => v > vals[best] ? i : best, 0);
  const peakX   = toX(peakIdx).toFixed(1);
  const peakY   = toY(vals[peakIdx]).toFixed(1);
  const peakLabel = (vals[peakIdx] >= 0 ? '+$' : '-$') + Math.abs(Math.round(vals[peakIdx])).toLocaleString();

  // Baseline
  const baseY = toY(0).toFixed(1);

  // Max DD marker (red vertical line at max DD index)
  const maxDDMarker = maxDDIdx >= 0 && maxDDIdx < points.length ? `
    <line x1="${toX(maxDDIdx).toFixed(1)}" x2="${toX(maxDDIdx).toFixed(1)}" y1="${PAD_T}" y2="${(H - PAD_B).toFixed(1)}" stroke="var(--red-bright)" stroke-width="1.5" opacity="0.4" stroke-dasharray="2 3"/>
    <circle cx="${toX(maxDDIdx).toFixed(1)}" cy="${toY(vals[maxDDIdx]).toFixed(1)}" r="3" fill="var(--red-bright)" opacity="0.6"/>
  ` : '';

  return `<svg viewBox="0 0 ${W} ${H + 14}" width="100%" class="stats-equity-svg">
    ${yLabels}
    <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${baseY}" y2="${baseY}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
    <path d="${fillD}" fill="${fillColor}"/>
    <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${maxDDMarker}
    <circle cx="${toX(points.length - 1).toFixed(1)}" cy="${toY(points[points.length - 1].cumPL).toFixed(1)}" r="4.5" fill="${lineColor}" stroke="var(--bg)" stroke-width="2"/>
    <circle cx="${peakX}" cy="${peakY}" r="3" fill="${lineColor}" opacity="0.6"/>
    <text x="${peakX}" y="${(parseFloat(peakY) - 8).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="8.5" fill="rgba(148,163,184,0.75)">PEAK ${peakLabel}</text>
    ${xLabels}
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

  const closedWithPL = periodClosed.map(t => ({ trade: t, pl: calcPL(t) || 0, r: calcR(t) || 0 }));
  const wins   = closedWithPL.filter(x => x.pl > 0);
  const losses = closedWithPL.filter(x => x.pl < 0);
  const totalPL    = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRateNum = closedWithPL.length ? wins.length / closedWithPL.length * 100 : null;
  const grossWin   = wins.reduce((s, x) => s + x.pl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, x) => s + x.pl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? '∞' : '—');
  const expectancy   = closedWithPL.length ? totalPL / closedWithPL.length : 0;
  const avgR = closedWithPL.length ? closedWithPL.reduce((s, x) => s + x.r, 0) / closedWithPL.length : 0;

  // ALL-time aggregates for Edge Intelligence card
  const allClosedWithPL = allClosed.map(t => ({ trade: t, pl: calcPL(t) || 0, r: calcR(t) || 0 }));
  const allWins    = allClosedWithPL.filter(x => x.pl > 0);
  const allLosses  = allClosedWithPL.filter(x => x.pl < 0);
  const allTotalPL = allClosedWithPL.reduce((s, x) => s + x.pl, 0);
  const allGrossWin   = allWins.reduce((s, x) => s + x.pl, 0);
  const allGrossLoss  = Math.abs(allLosses.reduce((s, x) => s + x.pl, 0));
  const allPF         = allGrossLoss > 0 ? (allGrossWin / allGrossLoss).toFixed(2) : (allGrossWin > 0 ? '∞' : '—');
  const allExpectancy = allClosedWithPL.length ? allTotalPL / allClosedWithPL.length : 0;
  const allAvgR       = allClosedWithPL.length ? allClosedWithPL.reduce((s, x) => s + x.r, 0) / allClosedWithPL.length : 0;

  // Full Edge Intelligence card HTML (same as Home tab — used only in modal)
  const fullEiHtml = typeof buildAlphaIntel === 'function'
    ? buildAlphaIntel(allClosed, allClosedWithPL, allWins, allLosses, allExpectancy, allAvgR, allPF)
    : `<div class="home-card green" style="margin:0;">Edge Intelligence loading…</div>`;

  // Glanceable compact card — 4 key numbers + verdict + enlarge button
  const allWinRate  = allClosedWithPL.length ? Math.round(allWins.length / allClosedWithPL.length * 100) : null;
  const allGraded   = allClosed.filter(t => t.grade);
  const allGood     = allGraded.filter(t => { const l = (t.grade||'').toLowerCase(); return l.includes('good')||l.includes('clean')||l==='a'||l==='b'; }).length;
  const gradeScore  = allGraded.length >= 3 ? Math.round(allGood / allGraded.length * 100) : null;
  const eiKicker    = `Career view · ${allClosed.length} trade${allClosed.length===1?'':'s'}${gradeScore!=null?` · ${gradeScore}% on-plan`:''}`;
  const eiVerdict   = allClosedWithPL.length === 0 ? 'No closed trades yet.'
    : allAvgR >= 0.5 && (allWinRate||0) >= 55 ? 'Proven edge. Consistency and size are the only levers left.'
    : allAvgR >= 0.25 && (allWinRate||0) >= 45 ? 'Developing edge — keep refining setup selection.'
    : allAvgR >= 0   ? 'Marginal edge — protect R, cut losers faster.'
    : 'Negative expected value — pause and review setups.';
  const eiVerdictCls = allAvgR >= 0.25 ? 'pos' : allAvgR >= 0 ? 'warn' : 'neg';

  const eiNums = [
    { v: allWinRate!=null ? allWinRate+'%' : '—',   cls: allWinRate==null?'':allWinRate>=55?'pos':allWinRate>=45?'':'neg', l: 'Win rate'      },
    { v: allClosedWithPL.length ? (allAvgR>=0?'+':'')+allAvgR.toFixed(2)+'R' : '—', cls: allAvgR>=0.3?'pos':allAvgR>=0?'':'neg', l: 'Avg R' },
    { v: String(allPF),                             cls: 'cyan',                                                              l: 'Profit factor' },
    { v: allClosedWithPL.length ? (allExpectancy>=0?'+$':'-$')+Math.abs(allExpectancy).toFixed(0) : '—', cls: allExpectancy>=0?'pos':'neg', l: 'Expectancy' },
  ].map(m=>`<div class="sei-num"><div class="sei-num-val ${m.cls}">${m.v}</div><div class="sei-num-lbl">${m.l}</div></div>`).join('');

  // 2-3 key bullets for compact view
  const highlightBullets = typeof buildAlphaHighlightBullets === 'function'
    ? buildAlphaHighlightBullets(allClosedWithPL).slice(0, 2)
    : [];
  const careerBullet = allClosedWithPL.length > 0 ? {
    tone: allTotalPL >= 0 ? 'good' : 'bad', icon: '📈',
    text: `<strong>Career: ${allTotalPL>=0?'+$':'-$'}${Math.abs(Math.round(allTotalPL)).toLocaleString()}</strong> · ${allClosed.length} trades · ${allWinRate}% wins · avg ${allAvgR>=0?'+':''}${allAvgR.toFixed(2)}R`,
  } : null;
  const previewBullets = [careerBullet, ...highlightBullets].filter(Boolean).slice(0, 3);
  const previewBulletsHtml = previewBullets.length
    ? `<ul class="home-intel-points sei-preview-bullets">${previewBullets.map(b=>`<li class="tone-${b.tone}"><span class="intel-icon">${b.icon}</span><span>${b.text}</span></li>`).join('')}</ul>`
    : '';

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

  // Compute current streak
  let streakN = 0, streakT = '';
  const sortedForStreak = [...periodClosed].sort((a,b) => (a.exit_date||a.date||'').localeCompare(b.exit_date||b.date||''));
  for (let i = sortedForStreak.length - 1; i >= 0; i--) {
    const pl = calcPL(sortedForStreak[i]) || 0;
    const isWin = pl > 0;
    if (streakN === 0) { streakN = 1; streakT = isWin ? 'W' : 'L'; }
    else if ((isWin && streakT === 'W') || (!isWin && streakT === 'L')) streakN++;
    else break;
  }
  const streakStr = streakN > 0 ? `${streakN}${streakT}` : '—';

  // Edge Intelligence card text
  const winStreakN = (() => {
    let n = 0;
    for (let i = sortedForStreak.length - 1; i >= 0; i--) {
      if ((calcPL(sortedForStreak[i]) || 0) > 0) n++;
      else break;
    }
    return n;
  })();

  // FORM
  const formText = closedWithPL.length === 0
    ? 'No closed trades in this period.'
    : winStreakN >= 3
      ? `<strong>${winStreakN}-trade win streak</strong> · avg ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R this period`
      : avgR >= 0.3 && (winRateNum||0) >= 50
        ? `<strong>${wins.length}W / ${losses.length}L</strong> · solid form · avg ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R`
        : avgR >= 0
          ? `<strong>${wins.length}W / ${losses.length}L</strong> · marginal form · avg ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R`
          : `<strong>${losses.length} consecutive pressure</strong> · avg ${avgR.toFixed(2)}R · review sizing`;

  // EDGE — top setup(s)
  const setupMapForEdge = {};
  periodClosed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMapForEdge[k]) setupMapForEdge[k] = { n: 0, wins: 0, pl: 0, totalR: 0 };
    const pl = calcPL(t) || 0;
    setupMapForEdge[k].n++;
    if (pl > 0) setupMapForEdge[k].wins++;
    setupMapForEdge[k].pl += pl;
    setupMapForEdge[k].totalR += calcR(t) || 0;
  });
  const topSetups = Object.entries(setupMapForEdge)
    .filter(([, s]) => s.pl > 0)
    .sort(([, a], [, b]) => b.pl - a.pl)
    .slice(0, 2);
  const edgeText = topSetups.length === 0
    ? 'No profitable setups this period.'
    : topSetups.map(([name, s]) => {
        const wr = Math.round(s.wins / s.n * 100);
        const ar = (s.totalR / s.n).toFixed(2);
        return `<strong>${name}</strong> ${wr}% WR · +${ar}R`;
      }).join(' &nbsp;·&nbsp; ');

  // WATCH — worst setup
  const worstSetup = Object.entries(setupMapForEdge)
    .filter(([, s]) => s.pl < 0)
    .sort(([, a], [, b]) => a.pl - b.pl)[0];
  const watchTone = worstSetup ? 'warn' : 'pos';
  const watchText = worstSetup
    ? `<strong>${worstSetup[0]}</strong> underperforming · ${(worstSetup[1].pl < 0 ? '-$' : '+$')}${Math.abs(worstSetup[1].pl).toFixed(0)} · consider reducing size`
    : maxDD > 0
      ? `Max drawdown <strong>-$${Math.round(maxDD).toLocaleString()}</strong> — within acceptable range`
      : 'No setups flagged for review this period.';

  // ACTION
  const actionText = closedWithPL.length === 0
    ? 'Log more trades to generate recommendations.'
    : avgR >= 0.5 && (winRateNum||0) >= 55
      ? 'Edge confirmed. <strong>Size up on A-grade setups</strong> and protect capital on borderline entries.'
      : avgR >= 0.25 && (winRateNum||0) >= 45
        ? '<strong>Stay selective</strong> — focus on top 1-2 setups. Skip B/C setups until form improves.'
        : avgR >= 0
          ? '<strong>Reduce size</strong> on all trades. Only take A-grade setups until stats stabilize.'
          : '<strong>Pause or go to sim</strong> — negative expected value. Review entry criteria before next trade.';

  // Loss/win counts for R-dist header
  const rDistLossCount = losses.length;
  const rDistWinCount = wins.length;

  // Edge Intelligence compact — uses the shared alpha-intel-card style.
  const formTone   = avgR >= 0.3 && (winRateNum||0) >= 50 ? 'good' : avgR >= 0 ? 'info' : 'warn';
  const edgeTone   = topSetups.length ? 'good' : 'info';
  const watchToneCls = watchTone === 'warn' ? 'bad' : 'good';
  const actionTone = avgR >= 0.5 && (winRateNum||0) >= 55 ? 'good'
    : avgR >= 0.25 && (winRateNum||0) >= 45 ? 'good'
    : avgR >= 0 ? 'warn' : 'bad';
  const alphaIntelHtml = `
    <div class="alpha-intel-card stats-alpha-intel">
      <div class="alpha-intel-eyebrow">
        <span class="alpha-intel-eyebrow-l"><span>EDGE INTELLIGENCE</span></span>
        <button class="stats-ei-enlarge-btn" type="button" data-ei-enlarge>Enlarge →</button>
      </div>
      <ul class="alpha-intel-points">
        <li class="alpha-intel-point tone-${formTone}"><span class="alpha-intel-chip">FORM</span><span class="alpha-intel-body">${formText}</span></li>
        <li class="alpha-intel-point tone-${edgeTone}"><span class="alpha-intel-chip">EDGE</span><span class="alpha-intel-body">${edgeText}</span></li>
        <li class="alpha-intel-point tone-${watchToneCls}"><span class="alpha-intel-chip">WATCH</span><span class="alpha-intel-body">${watchText}</span></li>
        <li class="alpha-intel-point tone-${actionTone}"><span class="alpha-intel-chip">ACTION</span><span class="alpha-intel-body">${actionText}</span></li>
      </ul>
    </div>`;

  // Setup performance table
  const setupMap = {};
  periodClosed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { n: 0, wins: 0, pl: 0, totalR: 0, mode: t.mode || 'swing' };
    const pl = calcPL(t) || 0;
    setupMap[k].n++;
    if (pl > 0) setupMap[k].wins++;
    setupMap[k].pl += pl;
    setupMap[k].totalR += calcR(t) || 0;
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
  // Find max DD index in curve points
  const maxDDIdx = ddStart ? curvePoints.findIndex(p => p.date === ddStart) : -1;
  const svgHtml = renderEquitySvg(curvePoints, totalPL, maxDDIdx);

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
    <!-- Hero: Edge Intelligence (left) | Equity Curve (right) — equal height -->
    <section class="stats-hero">
      <div class="stats-edge-intel-wrap">${alphaIntelHtml}</div>
      <div class="stats-equity-card">
        <div class="stats-equity-header">
          <h2 class="stats-equity-title">Equity curve</h2>
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="stats-period-tabs">${periodTabsHtml}</div>
            <span class="stats-equity-meta">Cumulative · realized</span>
          </div>
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
          <span class="stats-rdist-meta">L · ${rDistLossCount} &nbsp; W · ${rDistWinCount} &nbsp; ${closedWithPL.length} CLOSED</span>
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
            <div class="stats-rdist-hi-label">Streak</div>
            <div class="stats-rdist-hi-value" style="color:${streakT === 'W' ? 'var(--cyan)' : streakT === 'L' ? 'var(--red-bright)' : 'var(--ink-3)'}">${streakStr}</div>
            <div class="stats-rdist-hi-sub">current run</div>
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

  // Wire Edge Intel enlarge → modal (nothing in the page shifts)
  shell.querySelector('[data-ei-enlarge]')?.addEventListener('click', () => {
    const existing = document.getElementById('stats-ei-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'stats-ei-modal';
    modal.className = 'stats-ei-modal';
    modal.innerHTML = `
      <div class="stats-ei-modal-box">
        <button class="stats-ei-modal-close" type="button" aria-label="Close">✕</button>
        ${fullEiHtml}
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.stats-ei-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  });
}

