// Stats tab — equity curve, metric strip, sparklines, behavioral cuts,
// monthly heatmap, setup performance, sector exposure, drilldowns into History,
// robustness toggles, copy-summary export.

import { state } from '../state/store.js';
import { setState } from '../state/persistence.js';
import { isClosedTrade, calcPL, calcR, tradeRiskDollars, tradeQty } from '../models/trade.js';
import { fmtMoney, fmtR, fmtPct } from '../models/formatters.js';
import { enrichClosed, aggregateBySetup } from '../models/aggregations.js';
import { buildAlphaIntel } from '../intel/alpha.js';
import { generateAiInsights, renderInsightsHtml } from '../intel/ai-insights.js';
import { setTab } from '../tabs.js';
import { toast } from '../modals/toast.js';

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
function getStatsMode() {
  return state.statsMode || 'all'; // 'all' | 'swing' | 'intraday'
}
function getStatsExclude() {
  return state.statsExclude || { biggestWin: false, biggestLoss: false };
}

function filterByPeriod(trades, periodKey, anchor = Date.now()) {
  const def = PERIODS.find(p => p.k === periodKey) || PERIODS[2];
  if (periodKey === 'ALL') return trades;
  if (periodKey === 'YTD') {
    const jan1 = new Date(new Date(anchor).getFullYear(), 0, 1).getTime();
    return trades.filter(t => {
      const d = new Date(t.exit_date || t.date);
      return d.getTime() >= jan1;
    });
  }
  const cutoff = anchor - def.days * 86400000;
  return trades.filter(t => {
    const d = new Date(t.exit_date || t.date);
    return d.getTime() >= cutoff && d.getTime() <= anchor;
  });
}

function filterByMode(trades, mode) {
  if (mode === 'all') return trades;
  return trades.filter(t => (t.mode || 'swing') === mode);
}

function applyRobustness(closedWithPL, exclude) {
  if (!exclude.biggestWin && !exclude.biggestLoss) return closedWithPL;
  let arr = [...closedWithPL];
  if (exclude.biggestWin && arr.length) {
    const wins = arr.filter(x => x.pl > 0);
    if (wins.length) {
      const top = wins.reduce((a, b) => a.pl > b.pl ? a : b);
      arr = arr.filter(x => x !== top);
    }
  }
  if (exclude.biggestLoss && arr.length) {
    const losses = arr.filter(x => x.pl < 0);
    if (losses.length) {
      const bot = losses.reduce((a, b) => a.pl < b.pl ? a : b);
      arr = arr.filter(x => x !== bot);
    }
  }
  return arr;
}

function priorPeriodAnchor(periodKey) {
  const def = PERIODS.find(p => p.k === periodKey);
  if (!def || !def.days) return null;
  return Date.now() - def.days * 86400000;
}

function buildEquityCurve(sortedTrades) {
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

  const yLabels = [0, 0.33, 0.67, 1].map(f => {
    const v = minV + f * range;
    const y = toY(v);
    const label = fmtMoney(v);
    return `<g>
      <line x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3 5"/>
      <text x="${PAD_L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="'JetBrains Mono',monospace" font-size="11" fill="rgba(148,163,184,0.75)">${label}</text>
    </g>`;
  }).join('');

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

  const peakIdx = vals.reduce((best, v, i) => v > vals[best] ? i : best, 0);
  const peakX   = toX(peakIdx).toFixed(1);
  const peakY   = toY(vals[peakIdx]).toFixed(1);
  const peakLabel = fmtMoney(vals[peakIdx]);

  const maxDDFromPeak = maxDDIdx >= 0 ? (vals[peakIdx] - vals[maxDDIdx]) : 0;
  const maxDDDate = maxDDIdx >= 0 ? points[maxDDIdx].date : null;
  const maxDDMarker = maxDDIdx >= 0 && maxDDIdx < points.length ? `
    <line class="eq-dd-line" data-dd-idx="${maxDDIdx}" x1="${toX(maxDDIdx).toFixed(1)}" x2="${toX(maxDDIdx).toFixed(1)}" y1="${PAD_T}" y2="${(H - PAD_B).toFixed(1)}" stroke="var(--red-bright)" stroke-width="1.5" opacity="0.55" stroke-dasharray="2 3"/>
    <circle cx="${toX(maxDDIdx).toFixed(1)}" cy="${toY(vals[maxDDIdx]).toFixed(1)}" r="3" fill="var(--red-bright)" opacity="0.75"/>
  ` : '';

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

// ── Sparkline & mini-chart helpers (feature 2) ────────────
function sparkline(values, color = 'var(--cyan)', width = 96, height = 28) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ');
  return `<svg class="stats-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function rollingWinRate(closedWithPL, window = 20) {
  if (closedWithPL.length < 2) return [];
  const out = [];
  for (let i = 0; i < closedWithPL.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = closedWithPL.slice(start, i + 1);
    const wins = slice.filter(x => x.pl > 0).length;
    out.push(slice.length ? wins / slice.length * 100 : 0);
  }
  return out;
}

function rollingAvgR(closedWithPL, window = 20) {
  if (closedWithPL.length < 2) return [];
  const out = [];
  for (let i = 0; i < closedWithPL.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = closedWithPL.slice(start, i + 1);
    const sum = slice.reduce((a, x) => a + x.r, 0);
    out.push(slice.length ? sum / slice.length : 0);
  }
  return out;
}

function drawdownSeries(sortedTrades) {
  let peak = 0, cum = 0;
  const out = [0];
  sortedTrades.forEach(t => {
    cum += calcPL(t) || 0;
    if (cum > peak) peak = cum;
    out.push(cum - peak); // underwater value (<=0)
  });
  return out;
}

function renderUnderwaterSvg(values, width = 320, height = 90) {
  if (values.length < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" class="stats-under-svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--ink-4)">No drawdown data</text></svg>`;
  }
  const min = Math.min(...values);
  const range = Math.abs(min) || 1;
  const stepX = width / (values.length - 1);
  const toY = v => (Math.abs(v) / range) * height; // 0 at top, deeper = down
  const pts = values.map((v, i) => `${(i * stepX).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const pathD = `M0,0 L${pts.split(' ').join(' L')} L${width},0 Z`;
  return `<svg viewBox="0 0 ${width} ${height}" class="stats-under-svg" preserveAspectRatio="none">
    <path d="${pathD}" fill="rgba(239,68,68,0.18)" stroke="var(--red-bright)" stroke-width="1.4"/>
  </svg>`;
}

// ── Behavioral cuts (feature 3) ───────────────────────────
function aggregateByDayOfWeek(closedWithPL) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const out = days.map(d => ({ key: d, n: 0, pl: 0, wins: 0 }));
  closedWithPL.forEach(x => {
    const t = x.trade;
    const d = new Date(t.exit_date || t.date);
    if (isNaN(d)) return;
    const row = out[d.getDay()];
    row.n++;
    row.pl += x.pl;
    if (x.pl > 0) row.wins++;
  });
  return out;
}

function aggregateByHoldingPeriod(closedWithPL) {
  const buckets = [
    { lab: 'Same day', test: d => d <= 0 },
    { lab: '1-2d',     test: d => d > 0 && d <= 2 },
    { lab: '3-5d',     test: d => d > 2 && d <= 5 },
    { lab: '6-10d',    test: d => d > 5 && d <= 10 },
    { lab: '11+d',     test: d => d > 10 },
  ].map(b => ({ ...b, n: 0, pl: 0, totalR: 0, wins: 0 }));
  closedWithPL.forEach(x => {
    const t = x.trade;
    const start = t.date ? new Date(`${t.date}T12:00:00`) : null;
    const end = (t.exit_date || t.date) ? new Date(`${t.exit_date || t.date}T12:00:00`) : null;
    if (!start || !end || isNaN(start) || isNaN(end)) return;
    const days = Math.max(0, Math.round((end - start) / 86400000));
    const b = buckets.find(b => b.test(days));
    if (!b) return;
    b.n++;
    b.pl += x.pl;
    b.totalR += x.r;
    if (x.pl > 0) b.wins++;
  });
  return buckets;
}

function aggregateBySizeBucket(closedWithPL, account) {
  // Bucket by % of account risked
  const buckets = [
    { lab: '<0.5%',   test: p => p < 0.5 },
    { lab: '0.5-1%',  test: p => p >= 0.5 && p < 1 },
    { lab: '1-2%',    test: p => p >= 1 && p < 2 },
    { lab: '2-4%',    test: p => p >= 2 && p < 4 },
    { lab: '4%+',     test: p => p >= 4 },
  ].map(b => ({ ...b, n: 0, pl: 0, totalR: 0, wins: 0 }));
  closedWithPL.forEach(x => {
    const risk = Number(x.trade.riskDollars) || 0;
    if (!risk || !account) return;
    const pct = (risk / account) * 100;
    const b = buckets.find(b => b.test(pct));
    if (!b) return;
    b.n++;
    b.pl += x.pl;
    b.totalR += x.r;
    if (x.pl > 0) b.wins++;
  });
  return buckets;
}

function aggregateByGrade(closedWithPL) {
  const grades = ['Good', 'Okay', 'Bad'];
  const out = grades.map(g => ({ key: g, n: 0, pl: 0, totalR: 0, wins: 0 }));
  closedWithPL.forEach(x => {
    const g = String(x.trade.processGrade || '').trim();
    const row = out.find(r => r.key.toLowerCase() === g.toLowerCase());
    if (!row) return;
    row.n++;
    row.pl += x.pl;
    row.totalR += x.r;
    if (x.pl > 0) row.wins++;
  });
  return out;
}

// ── Monthly heatmap (feature 5) ───────────────────────────
function monthlyPL(closedWithPL, months = 12) {
  const today = new Date();
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      yLabel: String(d.getFullYear()).slice(2),
      pl: 0,
      n: 0,
    });
  }
  closedWithPL.forEach(x => {
    const t = x.trade;
    const d = new Date(t.exit_date || t.date);
    if (isNaN(d)) return;
    const row = out.find(r => r.year === d.getFullYear() && r.month === d.getMonth());
    if (!row) return;
    row.pl += x.pl;
    row.n++;
  });
  return out;
}

// ── Setup significance (feature 7) ────────────────────────
function significanceBadge(n) {
  if (n < 3)  return { cls: 'noise',     label: 'NOISE',    title: 'Too few trades — statistically meaningless.' };
  if (n < 10) return { cls: 'small',     label: 'SMALL N',  title: 'Small sample — directional only, not reliable.' };
  if (n < 30) return { cls: 'building',  label: 'BUILDING', title: 'Sample is growing — edge directionally meaningful.' };
  return         { cls: 'established',  label: 'ESTABLISHED', title: 'Sample size large enough to trust the numbers.' };
}

// ── Open-risk concentration (split by classifier) ────────
function openTradeRisk(t) {
  const explicit = Number(t.riskDollars);
  if (Number.isFinite(explicit) && explicit > 0) {
    const total = tradeQty(t) || 0;
    const closed = Array.isArray(t.executions)
      ? t.executions.reduce((s, e) => s + (Number(e.qty) || 0), 0)
      : 0;
    if (total > 0) return explicit * Math.max(0, total - closed) / total;
    return explicit;
  }
  return tradeRiskDollars(t) || 0;
}

function bucketOpenRisk(openTrades, classify) {
  const map = new Map();
  openTrades.forEach(t => {
    const label = classify(t);
    if (!label) return;
    const cur = map.get(label) || { label, risk: 0, count: 0 };
    cur.risk += openTradeRisk(t);
    cur.count += 1;
    map.set(label, cur);
  });
  return [...map.values()].sort((a, b) => b.risk - a.risk);
}

function concentrationStripHtml(title, buckets, totalRisk, opts = {}) {
  if (!buckets.length || totalRisk <= 0) return '';
  const max = opts.maxBuckets || 4;
  const visible = buckets.slice(0, max);
  const overflow = buckets.slice(max);
  if (overflow.length) {
    const overflowRisk = overflow.reduce((s, b) => s + b.risk, 0);
    const overflowCount = overflow.reduce((s, b) => s + b.count, 0);
    visible.push({ label: `+${overflow.length} more`, risk: overflowRisk, count: overflowCount, isOverflow: true });
  }
  const segs = visible.map(b => {
    const pct = (b.risk / totalRisk) * 100;
    const tone = b.isOverflow ? 'mute' : (opts.toneFor ? opts.toneFor(b.label) : 'cyan');
    const safeLabel = String(b.label).replace(/"/g, '&quot;');
    return `<span class="home-conc-seg tone-${tone}" style="flex:${pct.toFixed(2)};" title="${safeLabel} · $${Math.round(b.risk).toLocaleString()} · ${b.count} position${b.count === 1 ? '' : 's'} · ${pct.toFixed(0)}%">
      <span class="home-conc-seg-label">${safeLabel}</span>
      <span class="home-conc-seg-pct">${pct.toFixed(0)}%</span>
    </span>`;
  }).join('');
  return `
    <div class="home-conc-row">
      <div class="home-conc-title">${String(title).replace(/</g, '&lt;')}</div>
      <div class="home-conc-bar">${segs}</div>
    </div>`;
}

function buildConcentrationCard(allTrades) {
  const openTrades = allTrades.filter(t => t.status === 'open');
  if (!openTrades.length) {
    return `<div class="home-conc-card">
      <div class="home-conc-head">
        <span class="home-conc-eyebrow">OPEN RISK CONCENTRATION</span>
        <span class="home-conc-total">No open positions</span>
      </div>
    </div>`;
  }
  const totalRisk = openTrades.reduce((s, t) => s + openTradeRisk(t), 0);
  if (totalRisk <= 0) {
    return `<div class="home-conc-card">
      <div class="home-conc-head">
        <span class="home-conc-eyebrow">OPEN RISK CONCENTRATION</span>
        <span class="home-conc-total">${openTrades.length} open · no risk computed</span>
      </div>
    </div>`;
  }
  const dirBuckets   = bucketOpenRisk(openTrades, t => String(t.direction || '').toLowerCase() === 'short' ? 'Short' : 'Long');
  const modeBuckets  = bucketOpenRisk(openTrades, t => (t.mode || 'swing') === 'intraday' ? 'Intraday' : 'Swing');
  const setupBuckets = bucketOpenRisk(openTrades, t => t.setup || 'No setup');
  const tickerBuckets = bucketOpenRisk(openTrades, t => (t.ticker || '—').toUpperCase());

  const dirTone   = (label) => label === 'Short' ? 'red' : 'green';
  const modeTone  = (label) => label === 'Intraday' ? 'magenta' : 'cyan';

  const rows = [
    concentrationStripHtml('Direction', dirBuckets, totalRisk, { toneFor: dirTone }),
    concentrationStripHtml('Mode',      modeBuckets, totalRisk, { toneFor: modeTone }),
    concentrationStripHtml('Setup',     setupBuckets, totalRisk, { maxBuckets: 4 }),
    concentrationStripHtml('Ticker',    tickerBuckets, totalRisk, { maxBuckets: 5 }),
  ].filter(Boolean).join('');

  return `
    <div class="home-conc-card">
      <div class="home-conc-head">
        <span class="home-conc-eyebrow">OPEN RISK CONCENTRATION</span>
        <span class="home-conc-total">$${Math.round(totalRisk).toLocaleString()} across ${openTrades.length} position${openTrades.length === 1 ? '' : 's'}</span>
      </div>
      ${rows}
    </div>`;
}

// ── Sector / loss-cluster analytics (feature 8) ──────────
function openByTicker(allTrades) {
  const open = allTrades.filter(t => t.status === 'open');
  const groups = {};
  open.forEach(t => {
    const k = (t.ticker || '—').toUpperCase();
    if (!groups[k]) groups[k] = { ticker: k, n: 0, risk: 0 };
    groups[k].n++;
    groups[k].risk += Number(t.riskDollars) || 0;
  });
  return Object.values(groups).sort((a, b) => b.risk - a.risk);
}

function lossClusters(closedWithPL, topN = 8) {
  const losses = closedWithPL.filter(x => x.pl < 0).sort((a, b) => a.pl - b.pl).slice(0, topN);
  // Group worst losses by ISO week
  const buckets = {};
  losses.forEach(x => {
    const d = new Date(x.trade.exit_date || x.trade.date);
    if (isNaN(d)) return;
    const yr = d.getFullYear();
    const wk = isoWeek(d);
    const k = `${yr}-W${String(wk).padStart(2, '0')}`;
    if (!buckets[k]) buckets[k] = { key: k, week: wk, year: yr, n: 0, pl: 0, tickers: [] };
    buckets[k].n++;
    buckets[k].pl += x.pl;
    buckets[k].tickers.push(x.trade.ticker || '—');
  });
  return Object.values(buckets).sort((a, b) => a.pl - b.pl);
}

function isoWeek(d) {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target - firstThursday) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

// ── Copy-summary export (feature 9) ───────────────────────
function buildSummaryMarkdown({ period, mode, totalPL, winRate, avgR, profitFactor, expectancy, maxDD, sharpe, n, deltaPL }) {
  const lines = [
    `**Trapper's Edge · ${period}${mode !== 'all' ? ` · ${mode}` : ''}**`,
    `- Net P/L: ${fmtMoney(totalPL)}${deltaPL !== null && isFinite(deltaPL) ? ` (Δ ${fmtMoney(deltaPL)} vs prior)` : ''}`,
    `- Win rate: ${winRate !== null ? `${winRate.toFixed(0)}%` : '—'} · Avg R: ${fmtR(avgR)} · Profit factor: ${profitFactor}`,
    `- Expectancy: ${fmtMoney(expectancy)}/trade · Max DD: ${maxDD > 0 ? fmtMoney(-maxDD) : '—'} · Sharpe-ish: ${sharpe || '—'}`,
    `- Closed trades: ${n}`,
  ];
  return lines.join('\n');
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

    if (meta.dd && Math.abs(xView - meta.dd.x) < 6) {
      tipDD.hidden = false;
      tipDD.textContent = `Max drawdown · -$${Math.abs(meta.dd.drop).toLocaleString()}`;
    } else {
      tipDD.hidden = true;
      tipDD.textContent = '';
    }

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
    let best = 0, bestD = Infinity;
    for (let i = 0; i < meta.points.length; i++) {
      const d = Math.abs(meta.points[i].x - xView);
      if (d < bestD) { bestD = d; best = i; }
    }
    show(xView, best);
  };

  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchstart', e => { if (e.touches[0]) onMove(e.touches[0]); }, { passive: true });
  svg.addEventListener('touchmove',  e => { if (e.touches[0]) onMove(e.touches[0]); }, { passive: true });
  svg.addEventListener('touchend',  hide);
}

// ── Compute the stats payload for a given period+mode+exclude ─
function computeStatsPayload({ closed, mode, exclude }) {
  const filteredByMode = filterByMode(closed, mode).sort((a, b) =>
    (a.exit_date || a.date || '').localeCompare(b.exit_date || b.date || '')
  );
  const allCwP = enrichClosed(filteredByMode);
  const cwP = applyRobustness(allCwP, exclude);
  const wins   = cwP.filter(x => x.pl > 0);
  const losses = cwP.filter(x => x.pl < 0);
  const totalPL    = cwP.reduce((s, x) => s + x.pl, 0);
  const winRate    = cwP.length ? wins.length / cwP.length * 100 : null;
  const grossWin   = wins.reduce((s, x) => s + x.pl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, x) => s + x.pl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? '∞' : '—');
  const expectancy = cwP.length ? totalPL / cwP.length : 0;
  const avgR       = cwP.length ? cwP.reduce((s, x) => s + x.r, 0) / cwP.length : 0;
  const avgWinR    = wins.length   ? wins.reduce((s, x) => s + x.r, 0)   / wins.length   : 0;
  const avgLossR   = losses.length ? losses.reduce((s, x) => s + x.r, 0) / losses.length : 0;

  let peak = 0, cum = 0, maxDD = 0, ddStart = null;
  filteredByMode.forEach(t => {
    cum += calcPL(t) || 0;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) { maxDD = dd; ddStart = t.exit_date || t.date; }
  });

  const sharpe = (() => {
    if (cwP.length < 3) return null;
    const dailyMap = {};
    cwP.forEach(x => {
      const d = x.trade.exit_date || x.trade.date || '';
      dailyMap[d] = (dailyMap[d] || 0) + x.pl;
    });
    const daily = Object.values(dailyMap);
    const mean = daily.reduce((a, v) => a + v, 0) / daily.length;
    const variance = daily.reduce((a, v) => a + (v - mean) ** 2, 0) / daily.length;
    const sd = Math.sqrt(variance);
    return sd > 0 ? ((mean / sd) * Math.sqrt(252)).toFixed(2) : null;
  })();

  return {
    sortedTrades: filteredByMode,
    closedWithPL: cwP,
    wins, losses,
    totalPL, winRate, profitFactor, expectancy, avgR, avgWinR, avgLossR,
    maxDD, ddStart, sharpe,
    n: cwP.length,
  };
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const delta = Math.max(0, Date.now() - then);
  const min = Math.floor(delta / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function renderAiInsightsCard() {
  const cur = state.aiInsights || null;
  const meta = cur
    ? `<span class="ai-insights-meta">Generated ${formatRelativeTime(cur.generatedAt)} from your last ${cur.sampleSize} closed trade${cur.sampleSize === 1 ? '' : 's'}.</span>`
    : `<span class="ai-insights-meta">Send your last 50 closed trades to Claude for a pattern critique. Requires an Anthropic API key in Settings.</span>`;
  const body = cur
    ? renderInsightsHtml(cur.text)
    : `<div class="ai-insights-empty">Click <strong>Generate insights</strong> to ask Claude what's working and what's bleeding.</div>`;
  return `
    <div class="ai-insights-card">
      <div class="ai-insights-head">
        <div class="ai-insights-eyebrow">
          <span class="alpha-intel-sparkle">✦</span>
          <span class="alpha-intel-wordmark">AI INSIGHTS</span>
        </div>
        <button class="ai-insights-btn" id="stats-ai-generate" type="button">
          <span id="stats-ai-generate-label">${cur ? 'Regenerate' : 'Generate insights'}</span>
        </button>
      </div>
      ${meta}
      <div class="ai-insights-body" id="stats-ai-body">${body}</div>
    </div>`;
}

export function renderStats() {
  const shell = document.getElementById('stats-shell');
  if (!shell) return;

  const period = getStatsPeriod();
  const mode = getStatsMode();
  const exclude = getStatsExclude();
  const account = (state.settings && state.settings.account) || 10000;
  const allTrades = state.trades || [];
  const allClosed = allTrades.filter(t => isClosedTrade(t));

  const periodClosed = filterByPeriod(allClosed, period);
  const cur = computeStatsPayload({ closed: periodClosed, mode, exclude });

  // Prior-period comparison (feature 4) — same length, shifted back.
  const priorAnchor = priorPeriodAnchor(period);
  let prior = null;
  if (priorAnchor) {
    const priorClosed = filterByPeriod(allClosed, period, priorAnchor);
    prior = computeStatsPayload({ closed: priorClosed, mode, exclude });
  }
  const deltaPL = prior ? cur.totalPL - prior.totalPL : null;
  const deltaWR = prior && prior.winRate !== null && cur.winRate !== null ? cur.winRate - prior.winRate : null;
  const deltaR  = prior ? cur.avgR - prior.avgR : null;
  const deltaPF = prior ? (parseFloat(cur.profitFactor) - parseFloat(prior.profitFactor)) : null;
  const deltaExp= prior ? cur.expectancy - prior.expectancy : null;

  // Edge Intelligence (uses all-time, unfiltered, no robustness)
  const allCwp = enrichClosed(allClosed);
  const allWins   = allCwp.filter(x => x.pl > 0);
  const allLosses = allCwp.filter(x => x.pl < 0);
  const allTotalPL = allCwp.reduce((s, x) => s + x.pl, 0);
  const allGW = allWins.reduce((s, x) => s + x.pl, 0);
  const allGL = Math.abs(allLosses.reduce((s, x) => s + x.pl, 0));
  const allPF = allGL > 0 ? (allGW / allGL).toFixed(2) : (allGW > 0 ? '∞' : '—');
  const allExp = allCwp.length ? allTotalPL / allCwp.length : 0;
  const allAvgR = allCwp.length ? allCwp.reduce((s, x) => s + x.r, 0) / allCwp.length : 0;
  const fullEi = typeof buildAlphaIntel === 'function'
    ? buildAlphaIntel(allClosed, allCwp, allWins, allLosses, allExp, allAvgR, allPF)
    : `<div class="home-card green" style="margin:0;">Edge Intelligence loading…</div>`;
  const alphaIntelHtml = fullEi.replace(/class="alpha-intel-card([^"]*)"/, 'class="alpha-intel-card stats-alpha-intel$1"');

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
  const bucketCounts = rBuckets.map(b => cur.closedWithPL.filter(x => x.r >= b.min && x.r < b.max).length);
  const maxCount = Math.max(...bucketCounts, 1);
  const rBarsHtml = rBuckets.map((b, i) => {
    const n = bucketCounts[i];
    const h = Math.max(4, Math.round(n / maxCount * 100));
    const cls = b.neutral ? 'neutral' : b.neg ? 'neg' : 'pos';
    const minAttr = isFinite(b.min) ? b.min : -999;
    const maxAttr = isFinite(b.max) ? b.max : 999;
    return `<button class="stats-rdist-col" data-drill="r-bucket" data-r-min="${minAttr}" data-r-max="${maxAttr}" title="Show these trades in History" type="button">
      <div class="stats-rdist-count">${n}</div>
      <div class="stats-rdist-bar ${cls}" style="height:${h}%"></div>
      <div class="stats-rdist-bucket">${b.lab}</div>
    </button>`;
  }).join('');

  const bestTrade  = cur.wins.length   ? cur.wins.reduce((a, b) => a.r > b.r ? a : b) : null;
  const worstTrade = cur.losses.length ? cur.losses.reduce((a, b) => a.r < b.r ? a : b) : null;

  let streakN = 0, streakT = '';
  for (let i = cur.sortedTrades.length - 1; i >= 0; i--) {
    const pl = calcPL(cur.sortedTrades[i]) || 0;
    const isWin = pl > 0;
    if (streakN === 0) { streakN = 1; streakT = isWin ? 'W' : 'L'; }
    else if ((isWin && streakT === 'W') || (!isWin && streakT === 'L')) streakN++;
    else break;
  }
  const streakStr = streakN > 0 ? `${streakN}${streakT}` : '—';

  // Tag performance — one trade contributes to each of its tags' buckets.
  // Useful for slicing by user-defined themes (earnings, fed-week, etc).
  const tagBuckets = new Map();
  cur.closedWithPL.forEach(x => {
    const tags = Array.isArray(x.trade.tags) ? x.trade.tags : [];
    tags.forEach(rawTag => {
      const tag = String(rawTag || '').trim().toLowerCase();
      if (!tag) return;
      if (!tagBuckets.has(tag)) tagBuckets.set(tag, { tag, n: 0, wins: 0, pl: 0, totalR: 0 });
      const b = tagBuckets.get(tag);
      b.n += 1;
      if (x.pl > 0) b.wins += 1;
      b.pl += x.pl;
      b.totalR += x.r || 0;
    });
  });
  const tagRows = [...tagBuckets.values()]
    .sort((a, b) => b.pl - a.pl)
    .slice(0, 12)
    .map(b => {
      const wr = b.n ? Math.round(b.wins / b.n * 100) : 0;
      const avgR = b.n ? b.totalR / b.n : 0;
      return `<button class="stats-setup-row" data-drill="tag" data-tag="${b.tag.replace(/"/g, '&quot;')}" type="button" title="Show tagged trades in History">
        <span class="stats-mode-badge ${avgR >= 0.3 ? 'swing' : 'intraday'}">tag</span>
        <span style="color:var(--ink-2);font-size:13px;">${b.tag}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-3);">${b.n}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-2);">${wr}%</span>
        <span style="font-family:var(--mono);text-align:right;color:${avgR >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'};font-weight:700;">${fmtR(avgR)}</span>
        <span style="font-family:var(--mono);text-align:right;color:${b.pl >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'};font-weight:700;">${fmtMoney(b.pl)}</span>
        <span style="font-family:var(--mono);text-align:right;color:var(--ink-3);font-size:11px;">${fmtMoney(b.n ? b.pl / b.n : 0)}/trade</span>
        <span class="stats-edge-badge ${avgR >= 0.7 ? 'strong' : avgR >= 0.3 ? 'holding' : avgR >= 0 ? 'fading' : 'kill'}">${avgR >= 0.7 ? 'strong' : avgR >= 0.3 ? 'holding' : avgR >= 0 ? 'fading' : 'kill'}</span>
      </button>`;
    }).join('') || `<div style="color:var(--ink-4);font-size:13px;padding:16px 4px;">No tagged trades yet — open a closed trade in Edit mode and add a tag.</div>`;

  // Setup performance with significance badges (feature 7)
  const setups = aggregateBySetup(cur.sortedTrades);
  const setupRows = setups.map(s => {
    const wr = Math.round(s.winRate);
    const edge = s.avgR >= 0.7 ? 'strong' : s.avgR >= 0.3 ? 'holding' : s.avgR >= 0 ? 'fading' : 'kill';
    const sig = significanceBadge(s.n);
    return `<button class="stats-setup-row" data-drill="setup" data-setup="${s.key.replace(/"/g, '&quot;')}" type="button" title="Show in History">
      <span class="stats-mode-badge ${s.mode}">${s.mode}</span>
      <span style="color:var(--ink-2);font-size:13px;display:flex;align-items:center;gap:6px;">${s.key} <span class="stats-sig-badge ${sig.cls}" title="${sig.title}">${sig.label}</span></span>
      <span style="font-family:var(--mono);text-align:right;color:var(--ink-3);">${s.n}</span>
      <span style="font-family:var(--mono);text-align:right;color:var(--ink-2);">${wr}%</span>
      <span style="font-family:var(--mono);text-align:right;color:${s.avgR >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'};font-weight:700;">${fmtR(s.avgR)}</span>
      <span style="font-family:var(--mono);text-align:right;color:${s.pl >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'};font-weight:700;">${fmtMoney(s.pl)}</span>
      <span style="font-family:var(--mono);text-align:right;color:var(--ink-3);font-size:11px;">${fmtMoney(s.avgPL)}/trade</span>
      <span class="stats-edge-badge ${edge}">${edge}</span>
    </button>`;
  }).join('') || `<div style="color:var(--ink-4);font-size:13px;padding:16px 4px;">No closed trades in this period.</div>`;

  // Equity curve
  const curvePoints = buildEquityCurve(cur.sortedTrades);
  const maxDDIdx = cur.ddStart ? curvePoints.findIndex(p => p.date === cur.ddStart) : -1;
  const svgHtml = renderEquitySvg(curvePoints, cur.totalPL, maxDDIdx);

  // Sparklines (feature 2)
  const rollWR = rollingWinRate(cur.closedWithPL);
  const rollR  = rollingAvgR(cur.closedWithPL);
  const tradesPerWeek = (() => {
    if (!cur.sortedTrades.length) return [];
    const map = {};
    cur.sortedTrades.forEach(t => {
      const d = new Date(t.exit_date || t.date);
      if (isNaN(d)) return;
      const k = `${d.getFullYear()}-W${isoWeek(d)}`;
      map[k] = (map[k] || 0) + 1;
    });
    return Object.values(map);
  })();
  const ddSeries = drawdownSeries(cur.sortedTrades);

  // Period + mode + exclude UI
  const periodTabsHtml = PERIODS.map(p =>
    `<button class="stats-period-tab${p.k === period ? ' active' : ''}" data-stats-period="${p.k}" type="button">${p.k}</button>`
  ).join('');
  const modeTabsHtml = ['all','swing','intraday'].map(m =>
    `<button class="stats-mode-tab${m === mode ? ' active' : ''}" data-stats-mode="${m}" type="button">${m.toUpperCase()}</button>`
  ).join('');
  const excludePillsHtml = `
    <button class="stats-rob-pill${exclude.biggestWin ? ' on' : ''}" data-stats-exclude="biggestWin" type="button" title="Recalculate without your biggest win">Exclude biggest win</button>
    <button class="stats-rob-pill${exclude.biggestLoss ? ' on' : ''}" data-stats-exclude="biggestLoss" type="button" title="Recalculate without your biggest loss">Exclude biggest loss</button>
  `;

  // Metrics with deltas + sparklines (features 2, 4)
  const deltaHtml = (v, fmt, invert = false) => {
    if (v === null || !isFinite(v)) return '';
    const pos = invert ? v < 0 : v > 0;
    const neg = invert ? v > 0 : v < 0;
    const cls = pos ? 'pos' : neg ? 'neg' : '';
    const arrow = v > 0 ? '↑' : v < 0 ? '↓' : '·';
    return `<span class="stats-delta ${cls}">${arrow} ${fmt(Math.abs(v))}</span>`;
  };

  const metricsHtml = [
    { label: 'Net P/L',       value: fmtMoney(cur.totalPL),                                    cls: cur.totalPL >= 0 ? 'pos' : 'neg', delta: deltaHtml(deltaPL, fmtMoney) },
    { label: 'Win rate',      value: cur.winRate !== null ? fmtPct(cur.winRate) : '—',         cls: '',  delta: deltaHtml(deltaWR, v => `${v.toFixed(0)}%`) },
    { label: 'Avg R',         value: cur.n ? fmtR(cur.avgR) : '—',                             cls: '',  delta: deltaHtml(deltaR, v => v.toFixed(2) + 'R') },
    { label: 'Profit factor', value: String(cur.profitFactor),                                 cls: 'cyan', delta: deltaHtml(deltaPF, v => v.toFixed(2)) },
    { label: 'Expectancy',    value: fmtMoney(cur.expectancy),                                 cls: cur.expectancy >= 0 ? 'pos' : 'neg', delta: deltaHtml(deltaExp, fmtMoney) },
    { label: 'Max DD',        value: cur.maxDD > 0 ? fmtMoney(-cur.maxDD) : '—',               cls: cur.maxDD > 0 ? 'neg' : '', delta: '', drill: 'maxdd' },
    { label: 'Sharpe-ish',    value: cur.sharpe !== null ? cur.sharpe : '—',                   cls: '',  delta: '' },
  ].map(m => `<div class="stats-metric-card${m.drill ? ' stats-metric-clickable' : ''}"${m.drill ? ` data-drill="${m.drill}"` : ''}>
    <div class="stats-metric-label">${m.label}</div>
    <div class="stats-metric-value ${m.cls}">${m.value}</div>
    <div class="stats-metric-delta">${m.delta || '&nbsp;'}</div>
  </div>`).join('');

  // Behavioral cuts (feature 3)
  const dowRows = aggregateByDayOfWeek(cur.closedWithPL).filter((r, i) => i >= 1 && i <= 5); // Mon-Fri
  const dowMax = Math.max(1, ...dowRows.map(r => Math.abs(r.pl)));
  const dowHtml = dowRows.map(r => {
    const h = Math.max(4, Math.round(Math.abs(r.pl) / dowMax * 60));
    const cls = r.pl > 0 ? 'pos' : r.pl < 0 ? 'neg' : 'neutral';
    const wr = r.n ? Math.round(r.wins / r.n * 100) : null;
    return `<div class="stats-beh-col">
      <div class="stats-beh-label">${fmtMoney(r.pl)}</div>
      <div class="stats-beh-bar ${cls}" style="height:${h}px"></div>
      <div class="stats-beh-bucket">${r.key}</div>
      <div class="stats-beh-sub">${r.n}${wr !== null ? ` · ${wr}%` : ''}</div>
    </div>`;
  }).join('');

  const holdRows = aggregateByHoldingPeriod(cur.closedWithPL);
  const holdMax = Math.max(1, ...holdRows.map(r => Math.abs(r.pl)));
  const holdHtml = holdRows.map(r => {
    const h = Math.max(4, Math.round(Math.abs(r.pl) / holdMax * 60));
    const cls = r.pl > 0 ? 'pos' : r.pl < 0 ? 'neg' : 'neutral';
    const wr = r.n ? Math.round(r.wins / r.n * 100) : null;
    return `<div class="stats-beh-col">
      <div class="stats-beh-label">${fmtMoney(r.pl)}</div>
      <div class="stats-beh-bar ${cls}" style="height:${h}px"></div>
      <div class="stats-beh-bucket">${r.lab}</div>
      <div class="stats-beh-sub">${r.n}${wr !== null ? ` · ${wr}%` : ''}</div>
    </div>`;
  }).join('');

  const sizeRows = aggregateBySizeBucket(cur.closedWithPL, account);
  const sizeMax = Math.max(1, ...sizeRows.map(r => Math.abs(r.pl)));
  const sizeHtml = sizeRows.map(r => {
    const h = Math.max(4, Math.round(Math.abs(r.pl) / sizeMax * 60));
    const cls = r.pl > 0 ? 'pos' : r.pl < 0 ? 'neg' : 'neutral';
    const wr = r.n ? Math.round(r.wins / r.n * 100) : null;
    return `<div class="stats-beh-col">
      <div class="stats-beh-label">${fmtMoney(r.pl)}</div>
      <div class="stats-beh-bar ${cls}" style="height:${h}px"></div>
      <div class="stats-beh-bucket">${r.lab}</div>
      <div class="stats-beh-sub">${r.n}${wr !== null ? ` · ${wr}%` : ''}</div>
    </div>`;
  }).join('');

  const gradeRows = aggregateByGrade(cur.closedWithPL).filter(g => g.n > 0);
  const gradeHtml = gradeRows.length ? gradeRows.map(g => {
    const cls = g.key === 'Good' ? 'good' : g.key === 'Okay' ? 'okay' : 'bad';
    const wr = g.n ? Math.round(g.wins / g.n * 100) : null;
    return `<div class="stats-beh-grade ${cls}">
      <div class="stats-beh-grade-lbl">${g.key.toUpperCase()}</div>
      <div class="stats-beh-grade-val">${fmtMoney(g.pl)}</div>
      <div class="stats-beh-grade-sub">${g.n} trades · ${wr}% · ${fmtR(g.n ? g.totalR / g.n : 0)}</div>
    </div>`;
  }).join('') : `<div class="stats-beh-empty">Grade trades in Edit to see process quality stats here.</div>`;

  // Monthly heatmap (feature 5)
  const monthly = monthlyPL(allCwp, 12);
  const monthlyMax = Math.max(1, ...monthly.map(m => Math.abs(m.pl)));
  const monthlyHtml = monthly.map(m => {
    if (!m.n) return `<div class="stats-month idle" title="${m.label} '${m.yLabel}: no trades">
      <div class="stats-month-lbl">${m.label}</div><div class="stats-month-val">—</div>
    </div>`;
    const intensity = Math.min(1, Math.abs(m.pl) / monthlyMax);
    const cls = m.pl > 0 ? 'pos' : 'neg';
    const alpha = 0.15 + intensity * 0.55;
    const bg = m.pl > 0
      ? `rgba(16,185,129,${alpha.toFixed(2)})`
      : `rgba(239,68,68,${alpha.toFixed(2)})`;
    return `<div class="stats-month ${cls}" style="background:${bg};" title="${m.label} '${m.yLabel}: ${fmtMoney(m.pl)} from ${m.n} trades">
      <div class="stats-month-lbl">${m.label}</div>
      <div class="stats-month-val">${fmtMoney(m.pl)}</div>
      <div class="stats-month-sub">${m.n}</div>
    </div>`;
  }).join('');

  // Sector / loss-cluster (feature 8) — using open by ticker as proxy
  const openGroups = openByTicker(allTrades);
  const openHtml = openGroups.length ? openGroups.slice(0, 8).map(g => `
    <div class="stats-expo-row">
      <span class="stats-expo-ticker">${g.ticker}</span>
      <span class="stats-expo-n">${g.n}×</span>
      <span class="stats-expo-risk">${fmtMoney(g.risk)}</span>
    </div>`).join('') : `<div class="stats-beh-empty">No open positions.</div>`;

  const clusters = lossClusters(cur.closedWithPL, 10);
  const clustersHtml = clusters.length ? clusters.slice(0, 5).map(c => `
    <div class="stats-cluster-row">
      <span class="stats-cluster-wk">${c.year} W${String(c.week).padStart(2,'0')}</span>
      <span class="stats-cluster-pl">${fmtMoney(c.pl)}</span>
      <span class="stats-cluster-tk">${[...new Set(c.tickers)].slice(0, 4).join(' · ')}${c.tickers.length > 4 ? '…' : ''}</span>
    </div>`).join('') : `<div class="stats-beh-empty">No losses to cluster yet.</div>`;

  // ── Assemble ─────────────────────────────────────────────
  shell.innerHTML = `
    <section class="stats-hero">
      <div class="stats-edge-intel-wrap">${alphaIntelHtml}</div>
      <div class="stats-equity-card">
        <div class="stats-equity-header">
          <h2 class="stats-equity-title">Equity curve</h2>
          <div class="stats-equity-header-r">
            <div class="stats-mode-tabs">${modeTabsHtml}</div>
            <div class="stats-period-tabs">${periodTabsHtml}</div>
          </div>
        </div>
        ${svgHtml}
      </div>
    </section>

    <div class="stats-controls">
      <div class="stats-rob-pills">${excludePillsHtml}</div>
      <button class="stats-copy-btn" id="stats-copy-summary" type="button" title="Copy a markdown summary to clipboard">⧉ Copy summary</button>
    </div>

    <div class="stats-metric-strip">${metricsHtml}</div>

    <section class="stats-concentration">${buildConcentrationCard(allTrades)}</section>

    <section class="stats-ai-insights" id="stats-ai-insights">${renderAiInsightsCard()}</section>

    <section class="stats-breakdown">
      <div class="stats-rdist-card">
        <div class="stats-rdist-header">
          <h2 class="stats-rdist-title">Risk-Distribution</h2>
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
          <span class="stats-setup-meta">By setup · ${period} · click row to drill</span>
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

    <section class="stats-tags-section">
      <div class="stats-setup-card">
        <div class="stats-setup-header">
          <h2 class="stats-setup-title">Tag performance</h2>
          <span class="stats-setup-meta">By tag · ${period} · top 12 by P/L</span>
        </div>
        <div class="stats-setup-head-row">
          <div>TAG</div><div></div>
          <div style="text-align:right">N</div>
          <div style="text-align:right">WIN</div>
          <div style="text-align:right">AVG R</div>
          <div style="text-align:right">P/L</div>
          <div style="text-align:right">EXP</div>
          <div style="text-align:right">EDGE</div>
        </div>
        ${tagRows}
      </div>
    </section>

    <section class="stats-behavioral">
      <div class="stats-beh-card">
        <div class="stats-beh-header">
          <h2 class="stats-beh-title">Performance by Weekday</h2>
          <span class="stats-beh-meta">${cur.n} closed</span>
        </div>
        <div class="stats-beh-bars">${dowHtml}</div>
      </div>
      <div class="stats-beh-card">
        <div class="stats-beh-header">
          <h2 class="stats-beh-title">Performance by Hold Time</h2>
          <span class="stats-beh-meta">days held</span>
        </div>
        <div class="stats-beh-bars">${holdHtml}</div>
      </div>
      <div class="stats-beh-card">
        <div class="stats-beh-header">
          <h2 class="stats-beh-title">Performance by Size</h2>
          <span class="stats-beh-meta">% of account</span>
        </div>
        <div class="stats-beh-bars">${sizeHtml}</div>
      </div>
      <div class="stats-beh-card">
        <div class="stats-beh-header">
          <h2 class="stats-beh-title">Process quality</h2>
          <span class="stats-beh-meta">graded trades</span>
        </div>
        <div class="stats-beh-grades">${gradeHtml}</div>
      </div>
    </section>

    <section class="stats-monthly">
      <div class="stats-monthly-header">
        <h2 class="stats-monthly-title">Monthly Returns</h2>
        <span class="stats-monthly-meta">last 12 months · all trades</span>
      </div>
      <div class="stats-monthly-grid">${monthlyHtml}</div>
    </section>

    <section class="stats-correlation">
      <div class="stats-corr-card">
        <div class="stats-corr-header">
          <h2 class="stats-corr-title">Current Positions</h2>
          <span class="stats-corr-meta">by ticker</span>
        </div>
        <div class="stats-expo-rows">${openHtml}</div>
      </div>
      <div class="stats-corr-card">
        <div class="stats-corr-header">
          <h2 class="stats-corr-title">Worst Loss Weeks</h2>
          <span class="stats-corr-meta">worst losses, grouped by week</span>
        </div>
        <div class="stats-cluster-rows">${clustersHtml}</div>
      </div>
    </section>
  `;

  wireEquityHover(shell);
  animateStatNumbers(shell);
  wireStatsHandlers(shell, {
    period, mode, exclude, cur, deltaPL,
  });
}

function wireStatsHandlers(shell, ctx) {
  shell.querySelectorAll('[data-stats-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.statsPeriod = btn.dataset.statsPeriod;
      setState({});
      renderStats();
    });
  });
  shell.querySelectorAll('[data-stats-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.statsMode = btn.dataset.statsMode;
      setState({});
      renderStats();
    });
  });
  shell.querySelectorAll('[data-stats-exclude]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.statsExclude;
      const ex = getStatsExclude();
      state.statsExclude = { ...ex, [key]: !ex[key] };
      setState({});
      renderStats();
    });
  });

  // Drilldowns into History
  shell.querySelectorAll('[data-drill]').forEach(el => {
    el.addEventListener('click', () => {
      const kind = el.dataset.drill;
      if (kind === 'setup') {
        state.logSetupFilter = el.dataset.setup || '';
        if (ctx.mode !== 'all') state.logModeFilter = ctx.mode;
        setState({});
        setTab('log');
      } else if (kind === 'tag') {
        // History doesn't have a dedicated tag filter; the free-text search
        // matches setup but not tags. Pre-fill the search and let the user
        // see the matches. Bumps log search to the tag value.
        state.logSetupFilter = '';
        state.logSearch = el.dataset.tag || '';
        if (ctx.mode !== 'all') state.logModeFilter = ctx.mode;
        setState({});
        setTab('log');
        toast(`Filtered to tag "${el.dataset.tag}". Use the search box to refine.`);
      } else if (kind === 'r-bucket') {
        // Use a search filter via setup field — can't pre-set numeric range,
        // so just navigate and show toast about the bucket.
        const min = el.dataset.rMin, max = el.dataset.rMax;
        state.logSetupFilter = '';
        if (ctx.mode !== 'all') state.logModeFilter = ctx.mode;
        setState({});
        setTab('log');
        toast(`Switched to History — filter manually for R between ${min} and ${max}.`);
      } else if (kind === 'maxdd') {
        if (!ctx.cur.ddStart) return;
        toast(`Max drawdown bottomed on ${ctx.cur.ddStart}.`);
      }
    });
  });

  // AI insights — direct browser call to Anthropic with the user's key.
  const aiBtn = shell.querySelector('#stats-ai-generate');
  if (aiBtn) {
    aiBtn.addEventListener('click', async () => {
      const label = shell.querySelector('#stats-ai-generate-label');
      const body  = shell.querySelector('#stats-ai-body');
      const prevLabelText = label ? label.textContent : '';
      aiBtn.disabled = true;
      if (label) label.textContent = 'Thinking…';
      if (body) body.innerHTML = `<div class="ai-insights-loading">Asking Claude — usually 5–10 seconds…</div>`;
      try {
        await generateAiInsights();
        // Re-render the whole card with the fresh result.
        const host = shell.querySelector('#stats-ai-insights');
        if (host) host.innerHTML = renderAiInsightsCard();
        // Re-bind click on the freshly-rendered button.
        renderStats();
      } catch (err) {
        if (body) body.innerHTML = `<div class="ai-insights-error">${(err && err.message) || 'Failed to generate insights.'}</div>`;
        if (err && err.code === 'NO_KEY') toast('Add your Anthropic API key in Settings to use AI Insights.');
        else toast((err && err.message) || 'AI insights failed.', true);
      } finally {
        aiBtn.disabled = false;
        if (label) label.textContent = prevLabelText || 'Generate insights';
      }
    });
  }

  // Copy summary
  const copyBtn = shell.querySelector('#stats-copy-summary');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const md = buildSummaryMarkdown({
        period: ctx.period,
        mode: ctx.mode,
        totalPL: ctx.cur.totalPL,
        winRate: ctx.cur.winRate,
        avgR: ctx.cur.avgR,
        profitFactor: ctx.cur.profitFactor,
        expectancy: ctx.cur.expectancy,
        maxDD: ctx.cur.maxDD,
        sharpe: ctx.cur.sharpe,
        n: ctx.cur.n,
        deltaPL: ctx.deltaPL,
      });
      try {
        await navigator.clipboard.writeText(md);
        toast('Summary copied to clipboard.');
      } catch (_) {
        toast('Copy failed — clipboard unavailable.', true);
      }
    });
  }
}
