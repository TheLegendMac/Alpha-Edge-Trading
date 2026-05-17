// Stats tab — equity curve, 7 metric cards, R-distribution, setup performance.

import { state } from '../state/store.js';
import { isClosedTrade, calcPL, calcR } from '../models/trade.js';
import { fmtMoney, fmtR, fmtPct } from '../models/formatters.js';
import { enrichClosed, aggregateBySetup, bestWorstSetup } from '../models/aggregations.js';
import { buildAlphaIntel } from '../intel/alpha.js';

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
    return `<div class="stats-equity-body"><svg viewBox="0 0 760 260" class="stats-equity-svg">
      <text x="380" y="130" text-anchor="middle" font-family="var(--mono)" font-size="13" fill="var(--ink-4)">No closed trades in this period</text>
    </svg></div>`;
  }
  const W = 880, H = 260, PAD_L = 64, PAD_R = 24, PAD_T = 22, PAD_B = 36;
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
  const baseY = toY(0).toFixed(1);
  const fillD = pathD + ` L${toX(points.length - 1).toFixed(1)} ${baseY} L${toX(0).toFixed(1)} ${baseY} Z`;
  const isPos = totalPL >= 0;
  const lineColor = isPos ? 'var(--cyan)' : 'var(--red-bright)';
  const gradId = `eq-grad-${isPos ? 'pos' : 'neg'}`;

  // Y-axis labels (4 lines)
  const yLabels = [0, 0.33, 0.67, 1].map(f => {
    const v = minV + f * range;
    const y = toY(v);
    const label = fmtMoney(v);
    return `<g>
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3 5"/>
      <text x="${PAD_L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="11" fill="rgba(148,163,184,0.75)">${label}</text>
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
      labels.push(`<text x="${x.toFixed(1)}" y="${(H + 4).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="10.5" fill="rgba(148,163,184,0.7)">${label}</text>`);
    }
    return labels.join('');
  })();

  // Peak dot
  const peakIdx = vals.reduce((best, v, i) => v > vals[best] ? i : best, 0);
  const peakX   = toX(peakIdx).toFixed(1);
  const peakY   = toY(vals[peakIdx]).toFixed(1);
  const peakLabel = fmtMoney(vals[peakIdx]);

  // Max DD marker (red vertical line at max DD index, tagged for hover)
  const maxDDFromPeak = maxDDIdx >= 0 ? (vals[peakIdx] - vals[maxDDIdx]) : 0;
  const maxDDDate = maxDDIdx >= 0 ? points[maxDDIdx].date : null;
  const maxDDMarker = maxDDIdx >= 0 && maxDDIdx < points.length ? `
    <line class="eq-dd-line" data-dd-idx="${maxDDIdx}" x1="${toX(maxDDIdx).toFixed(1)}" x2="${toX(maxDDIdx).toFixed(1)}" y1="${PAD_T}" y2="${(H - PAD_B).toFixed(1)}" stroke="var(--red-bright)" stroke-width="1.5" opacity="0.55" stroke-dasharray="2 3"/>
    <circle cx="${toX(maxDDIdx).toFixed(1)}" cy="${toY(vals[maxDDIdx]).toFixed(1)}" r="3" fill="var(--red-bright)" opacity="0.75"/>
  ` : '';

  // Serialise points for the JS hover handler (x/y in viewBox coords).
  const pointData = points.map((p, i) => ({
    x: +toX(i).toFixed(2),
    y: +toY(p.cumPL).toFixed(2),
    pl: p.cumPL,
    date: p.date,
  }));
  const ddPayload = maxDDIdx >= 0 ? {
    idx: maxDDIdx,
    x: +toX(maxDDIdx).toFixed(2),
    drop: Math.round(maxDDFromPeak),
    date: maxDDDate,
  } : null;
  const chartMeta = {
    W, H: H + 14, PAD_L, PAD_R, PAD_T, PAD_B,
    plotTop: PAD_T,
    plotBottom: H - PAD_B,
    plotLeft: PAD_L,
    plotRight: W - PAD_R,
    points: pointData,
    dd: ddPayload,
    color: isPos ? '#06d4f8' : '#f87171',
  };
  const metaJson = JSON.stringify(chartMeta).replace(/"/g, '&quot;');

  return `<div class="stats-equity-body">
    <svg viewBox="0 0 ${W} ${H + 14}" class="stats-equity-svg" data-eq-meta="${metaJson}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${isPos ? '#06d4f8' : '#f87171'}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${isPos ? '#06d4f8' : '#f87171'}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${yLabels}
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${baseY}" y2="${baseY}" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
      <path d="${fillD}" fill="url(#${gradId})"/>
      <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${maxDDMarker}
      <circle cx="${toX(points.length - 1).toFixed(1)}" cy="${toY(points[points.length - 1].cumPL).toFixed(1)}" r="5" fill="${lineColor}" stroke="var(--bg)" stroke-width="2"/>
      <circle cx="${peakX}" cy="${peakY}" r="3" fill="${lineColor}" opacity="0.6"/>
      <text x="${peakX}" y="${(parseFloat(peakY) - 10).toFixed(1)}" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="10" fill="rgba(148,163,184,0.85)">PEAK ${peakLabel}</text>
      ${xLabels}
      <g class="eq-crosshair" style="display:none; pointer-events:none">
        <line class="eq-ch-line" y1="${PAD_T}" y2="${H - PAD_B}" stroke="rgba(255,255,255,0.30)" stroke-width="1" stroke-dasharray="3 3"/>
        <circle class="eq-ch-dot" r="5" fill="${lineColor}" stroke="var(--bg)" stroke-width="2"/>
      </g>
    </svg>
    <div class="stats-equity-tip" hidden>
      <div class="eq-tip-date"></div>
      <div class="eq-tip-pl"></div>
      <div class="eq-tip-dd" hidden></div>
    </div>
  </div>`;
}

function animateStatNumbers(shell) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = shell.querySelectorAll('.stats-metric-value');
  els.forEach((el, idx) => {
    const text = (el.textContent || '').trim();
    const m = text.match(/^([^\d-]*-?)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    const prefix = m[1] || '';
    const numStr = m[2];
    const suffix = m[3] || '';
    const target = parseFloat(numStr.replace(/,/g, ''));
    if (!isFinite(target)) return;
    const isInt = !numStr.includes('.');
    const decimals = isInt ? 0 : (numStr.split('.')[1] || '').length;
    const startVal = 0;
    const duration = 700;
    const delay = 80 + idx * 45;
    el.textContent = `${prefix}${isInt ? '0' : (0).toFixed(decimals)}${suffix}`;
    const tStart = performance.now() + delay;
    const step = now => {
      const t = Math.max(0, Math.min(1, (now - tStart) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = startVal + (target - startVal) * eased;
      const display = isInt
        ? Math.round(cur).toLocaleString()
        : cur.toFixed(decimals);
      el.textContent = `${prefix}${display}${suffix}`;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function wireEquityHover(shell) {
  const svg = shell.querySelector('.stats-equity-svg[data-eq-meta]');
  const body = shell.querySelector('.stats-equity-body');
  const tip = shell.querySelector('.stats-equity-tip');
  if (!svg || !body || !tip) return;
  let meta;
  try { meta = JSON.parse(svg.dataset.eqMeta); } catch (_) { return; }
  if (!meta || !meta.points || meta.points.length < 2) return;

  const cross = svg.querySelector('.eq-crosshair');
  const line  = svg.querySelector('.eq-ch-line');
  const dot   = svg.querySelector('.eq-ch-dot');
  const tipDate = tip.querySelector('.eq-tip-date');
  const tipPL   = tip.querySelector('.eq-tip-pl');
  const tipDD   = tip.querySelector('.eq-tip-dd');
  const fmtDate  = d => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const show = (xView, pIdx) => {
    const p = meta.points[pIdx];
    if (!p) return;
    cross.style.display = '';
    line.setAttribute('x1', p.x);
    line.setAttribute('x2', p.x);
    dot.setAttribute('cx', p.x);
    dot.setAttribute('cy', p.y);

    tipDate.textContent = fmtDate(p.date) || 'Start';
    tipPL.textContent = fmtMoney(p.pl);
    tipPL.style.color = p.pl >= 0 ? 'var(--green-bright)' : 'var(--red-bright)';

    // Drawdown line hover — within ~6px of dd marker x in viewBox.
    if (meta.dd && Math.abs(xView - meta.dd.x) < 6) {
      tipDD.hidden = false;
      tipDD.textContent = `Max drawdown · -$${Math.abs(meta.dd.drop).toLocaleString()}`;
    } else {
      tipDD.hidden = true;
      tipDD.textContent = '';
    }

    // Position HTML tooltip alongside crosshair (use SVG matrix for correct meet/letterbox math).
    tip.hidden = false;
    const bodyRect = body.getBoundingClientRect();
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const svgPt = svg.createSVGPoint();
      svgPt.x = p.x; svgPt.y = p.y;
      const screen = svgPt.matrixTransform(ctm);
      const pxX = screen.x - bodyRect.left;
      const tipW = tip.offsetWidth || 140;
      let leftPx = pxX + 12;
      if (leftPx + tipW > bodyRect.width - 4) leftPx = pxX - tipW - 12;
      tip.style.left = `${Math.max(4, leftPx)}px`;
      tip.style.top = `12px`;
    }
  };

  const hide = () => {
    cross.style.display = 'none';
    tip.hidden = true;
  };

  const onMove = e => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const xView = local.x;
    if (xView < meta.plotLeft - 4 || xView > meta.plotRight + 4) { hide(); return; }
    // Find nearest point by x
    let best = 0, bestD = Infinity;
    for (let i = 0; i < meta.points.length; i++) {
      const d = Math.abs(meta.points[i].x - xView);
      if (d < bestD) { bestD = d; best = i; }
    }
    show(xView, best);
  };

  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchstart', e => {
    if (e.touches[0]) onMove(e.touches[0]);
  }, { passive: true });
  svg.addEventListener('touchmove', e => {
    if (e.touches[0]) onMove(e.touches[0]);
  }, { passive: true });
  svg.addEventListener('touchend', hide);
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

  const closedWithPL = enrichClosed(periodClosed);
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
  const allClosedWithPL = enrichClosed(allClosed);
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

  // Loss/win counts for R-dist header
  const rDistLossCount = losses.length;
  const rDistWinCount = wins.length;

  // Edge Intelligence — show the full card on stats (same content as home),
  // tagged with `.stats-alpha-intel` so the wrap can flex it to match the equity card height.
  const alphaIntelHtml = fullEiHtml.replace(
    /class="alpha-intel-card([^"]*)"/,
    'class="alpha-intel-card stats-alpha-intel$1"',
  );

  // Setup performance table
  const setups = aggregateBySetup(periodClosed);
  const setupRows = setups.map(s => {
      const wr = Math.round(s.winRate);
      const edge = s.avgR >= 0.7 ? 'strong' : s.avgR >= 0.3 ? 'holding' : s.avgR >= 0 ? 'fading' : 'kill';
      return `<div class="stats-setup-row">
        <span class="stats-mode-badge ${s.mode}">${s.mode}</span>
        <span style="color:var(--ink-2);font-size:13px;">${s.key}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-3);">${s.n}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-2);">${wr}%</span>
        <span style="font-family:var(--mono);text-align:right;color:${s.avgR >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'};font-weight:700;">${fmtR(s.avgR)}</span>
        <span style="font-family:var(--mono);text-align:right;color:${s.pl >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'};font-weight:700;">${fmtMoney(s.pl)}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-3);font-size:11px;">${fmtMoney(s.avgPL)}/trade</span>
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
  const avgWinR  = wins.length   ? wins.reduce((s, x) => s + x.r, 0)   / wins.length   : 0;
  const avgLossR = losses.length ? losses.reduce((s, x) => s + x.r, 0) / losses.length : 0;
  const metrics = [
    { label: 'Net P/L',       value: fmtMoney(totalPL),                                       sub: fmtPct(totalPL / account * 100, 1, true),           cls: totalPL >= 0 ? 'pos' : 'neg' },
    { label: 'Win rate',      value: winRateNum !== null ? fmtPct(winRateNum) : '—',          sub: `${wins.length} / ${closedWithPL.length}`,           cls: '' },
    { label: 'Avg R',         value: closedWithPL.length ? fmtR(avgR) : '—',
                                                                                               sub: `W ${wins.length ? fmtR(avgWinR) : '—'} · L ${losses.length ? fmtR(avgLossR) : '—'}`, cls: '' },
    { label: 'Profit factor', value: String(profitFactor),                                    sub: '$ won vs lost',                                      cls: 'cyan' },
    { label: 'Expectancy',    value: fmtMoney(expectancy),                                    sub: 'per trade',                                          cls: expectancy >= 0 ? 'pos' : 'neg' },
    { label: 'Max DD',        value: maxDD > 0 ? fmtMoney(-maxDD) : '—',                      sub: ddStart ? ddStart : 'none',                          cls: maxDD > 0 ? 'neg' : '' },
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
            <div class="stats-rdist-hi-value" style="color:var(--green-bright)">${bestTrade ? fmtR(bestTrade.r) : '—'}</div>
            <div class="stats-rdist-hi-sub">${bestTrade ? (bestTrade.trade.ticker || '') + ' · ' + (bestTrade.trade.exit_date || bestTrade.trade.date || '') : 'no wins'}</div>
          </div>
          <div>
            <div class="stats-rdist-hi-label">Worst</div>
            <div class="stats-rdist-hi-value" style="color:var(--red-bright)">${worstTrade ? fmtR(worstTrade.r) : '—'}</div>
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

  // Wire equity curve hover (crosshair + tooltip)
  wireEquityHover(shell);

  // Animate metric numbers (count-up) on render.
  animateStatNumbers(shell);

  // Wire period tabs
  shell.querySelectorAll('[data-stats-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.statsPeriod = btn.dataset.statsPeriod;
      renderStats();
    });
  });

}
