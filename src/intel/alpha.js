// Alpha Intel — performance + friction analytics that drive the home dashboard's
// 'alpha edge' card and the closed-trade summary breakdowns.

import { tfFindIntradaySetup } from '../trade-flow/intraday-steps.js';
import { TRADE_SWING_SETUPS } from '../config/constants.js';
import { tfComputeIntradayRiskSize } from '../trade-flow/intraday-sizing.js';
import { tfComputeIntradayDayPL } from '../trade-flow/gates.js';
import { state } from '../state/store.js';
import {
  isClosedTrade,
  calcPL,
  tradeInstrument,
  normalizeProcessQuality,
} from '../models/trade.js';
import { fmtMoney, fmtR } from '../models/formatters.js';
import { esc, barRow } from '../dom/html.js';
import { enrichClosed, bestWorstSetup } from '../models/aggregations.js';
import { computeRollingPL, buildSparklineSvg } from './rolling.js';
import { buildTradeIndex } from '../models/trade-index.js';
import { buildSetupScorecardsHtml } from './setup-scorecards.js';
import {
  alphaDirectionKey,
  alphaIntradaySetupDef,
  alphaSetupBias,
  alphaConfluenceBias,
  alphaBreadthBias,
  alphaContextAlignment,
  alphaSpreadValue,
  alphaSpreadBucket,
  alphaFillQuality,
  alphaTimeBucket,
  alphaOrbDirectionBucket,
  alphaOrbRangeBucket,
  alphaVwapBucket,
  alphaFrictionScore,
  alphaFrictionBucket,
} from './buckets.js';

// Local aliases preserved for minimal call-site churn.
const alphaEsc = esc;
const alphaMoney = (v) => fmtMoney(v);
const alphaR = (v) => fmtR(v);

export function alphaConfidenceLabel(count) {
  const n = Number(count) || 0;
  if (n >= 15) return 'RELIABLE';
  if (n >= 5) return 'BUILDING';
  return 'EARLY DATA';
}

function alphaConfidenceMeta(count, singular = 'closed trade', plural = `${singular}s`) {
  const n = Number(count) || 0;
  return `${alphaConfidenceLabel(n)} · ${n} ${n === 1 ? singular : plural}`;
}

function alphaToneRank(tone) {
  const rank = { bad: 0, warn: 1, info: 2, good: 3 };
  return rank[tone] ?? 4;
}

function alphaBulletHtml(b) {
  const priorityClass = b.priority ? ' priority' : '';
  return `<li class="alpha-intel-point tone-${b.tone}${priorityClass}"><span class="alpha-intel-chip">${b.chip || ''}</span><span class="alpha-intel-body">${b.text}</span></li>`;
}

function collapseDuplicateIntelBullets(bullets) {
  const hasHardStop = bullets.some(b =>
    b.tone === 'bad' && (b.chip === 'TREND' || b.chip === 'BUDGET')
  );
  const seen = new Map();
  bullets.forEach((b, i) => {
    if (!b) return;
    if (hasHardStop && b.tone !== 'bad' && (b.chip === 'REGIME' || b.chip === 'SIZE')) return;
    const key = b.chip || b.text;
    const prev = seen.get(key);
    if (!prev || alphaToneRank(b.tone) < alphaToneRank(prev.b.tone)) seen.set(key, { b, i });
  });
  return Array.from(seen.values())
    .sort((a, b) => a.i - b.i)
    .map(x => x.b);
}

function alphaSaQuantBucket(t) {
  const q = Number(t && t.saQuant);
  if (!Number.isFinite(q) || q <= 0) return null;
  if (q >= 4.5) return 'SA Strong Buy';
  if (q >= 3.5) return 'SA Buy';
  if (q >= 2.5) return 'SA Hold';
  return 'SA Sell / Strong Sell';
}

function alphaSummarizeRows(label, rows) {
  const n = rows.length;
  const pl = rows.reduce((s, x) => s + x.pl, 0);
  const wins = rows.filter(x => x.pl > 0).length;
  const totalR = rows.reduce((s, x) => s + x.r, 0);
  const targetHits = rows.filter(x =>
    x.trade.exit_reason === 'target' ||
    (Array.isArray(x.trade.outcome_tags) && x.trade.outcome_tags.includes('target_hit'))
  ).length;
  return {
    label,
    rows,
    n,
    pl,
    wins,
    winRate: n ? Math.round(wins / n * 100) : 0,
    avgR: n ? totalR / n : 0,
    targetRate: n ? Math.round(targetHits / n * 100) : null,
  };
}

function alphaGroupClosedRows(rows, classifier) {
  const map = {};
  rows.forEach(row => {
    const label = classifier(row.trade, row);
    if (!label) return;
    if (!map[label]) map[label] = [];
    map[label].push(row);
  });
  return Object.entries(map)
    .map(([label, groupRows]) => alphaSummarizeRows(label, groupRows))
    .sort((a, b) => b.pl - a.pl);
}

function alphaRowsHtml(groups, emptyText, opts = {}) {
  const visible = (groups || []).filter(g => g.n > 0);
  if (!visible.length) return `<div class="alpha-edge-empty">${alphaEsc(emptyText)}</div>`;
  const maxAbs = Math.max(1, ...visible.map(g => Math.abs(g.pl)));
  return visible.map(g => {
    const tone = g.color || (g.pl > 0 ? 'pos' : g.pl < 0 ? 'neg' : 'neutral');
    const subParts = [
      `${g.n} trade${g.n === 1 ? '' : 's'}`,
      `${g.winRate}%W`,
      `${alphaR(g.avgR)} avg`,
    ];
    if (opts.showTargetRate && g.targetRate !== null) subParts.push(`${g.targetRate}% target`);
    if (g.extraSub) subParts.push(g.extraSub);
    return barRow({
      label: alphaEsc(g.label),
      sub: alphaEsc(subParts.join(' · ')),
      value: alphaMoney(g.pl),
      fillPct: Math.max(4, Math.abs(g.pl) / maxAbs * 100),
      tone,
    });
  }).join('');
}

function alphaSection(title, body) {
  return `<div class="alpha-edge-section"><div class="ai-section-title">${alphaEsc(title)}</div>${body}</div>`;
}

export function buildAlphaHighlightBullets(closedWithPL) {
  const bullets = [];
  const intraday = closedWithPL.filter(x => x.trade.mode === 'intraday');
  const intradayOptions = intraday.filter(x => tradeInstrument(x.trade) === 'options');
  const spreadGroups = alphaGroupClosedRows(intradayOptions, t => alphaSpreadBucket(t));
  const tight = spreadGroups.find(g => g.label === 'Tight 0-2%');
  const wide = spreadGroups.find(g => /^Wide/.test(g.label));
  if ((tight && tight.n >= 2) || (wide && wide.n >= 2)) {
    if (wide && wide.n >= 2 && wide.avgR < 0) {
      bullets.push({
        tone: 'warn',
        icon: 'SP',
        text: `<strong>Spread drag is real:</strong> wide-spread intraday options average ${alphaR(wide.avgR)} across ${wide.n} trades. Keep bid/ask tight or switch to stock.`,
      });
    } else if (tight && tight.n >= 2) {
      bullets.push({
        tone: tight.avgR >= 0 ? 'good' : 'warn',
        icon: 'SP',
        text: `<strong>Tight-spread trades average ${alphaR(tight.avgR)}</strong> across ${tight.n} entries. That is your cleanest execution bucket.`,
      });
    }
  }

  const contextGroups = alphaGroupClosedRows(intraday, t => {
    const a = alphaContextAlignment(t);
    return a.score === null ? null : a.bucket;
  });
  const aligned = contextGroups.find(g => g.label === 'Aligned');
  const conflicted = contextGroups.find(g => g.label === 'Conflicted');
  if ((aligned && aligned.n >= 2) || (conflicted && conflicted.n >= 2)) {
    if (aligned && (!conflicted || aligned.avgR >= conflicted.avgR)) {
      bullets.push({
        tone: aligned.avgR >= 0 ? 'good' : 'warn',
        icon: 'CTX',
        text: `<strong>Context-aligned intraday trades average ${alphaR(aligned.avgR)}</strong> (${aligned.winRate}% wins). VWAP, setup, and breadth are worth logging.`,
      });
    } else if (conflicted) {
      bullets.push({
        tone: 'warn',
        icon: 'CTX',
        text: `<strong>Conflicted context averages ${alphaR(conflicted.avgR)}</strong>. When setup, VWAP, or breadth disagree, your edge drops.`,
      });
    }
  }

  const instrumentGroups = alphaGroupClosedRows(closedWithPL, t => tradeInstrument(t) === 'stocks' ? 'Stock' : 'Options');
  const stocks = instrumentGroups.find(g => g.label === 'Stock');
  const options = instrumentGroups.find(g => g.label === 'Options');
  if (stocks && options && stocks.n >= 3 && options.n >= 3) {
    const better = stocks.avgR >= options.avgR ? stocks : options;
    const weaker = better === stocks ? options : stocks;
    bullets.push({
      tone: better.avgR >= 0 ? 'good' : 'warn',
      icon: 'TYPE',
      text: `<strong>${better.label} is ahead:</strong> ${alphaR(better.avgR)} avg vs ${alphaR(weaker.avgR)} for ${weaker.label.toLowerCase()}. Route marginal setups to the stronger instrument.`,
    });
  }

  return bullets;
}

function buildAlphaEdgeCard(closedWithPL, help) {
  if (!closedWithPL.length) return '';
  const intraday = closedWithPL.filter(x => x.trade.mode === 'intraday');
  const intradayOptions = intraday.filter(x => tradeInstrument(x.trade) === 'options');
  const instrumentGroups = alphaGroupClosedRows(closedWithPL, t => tradeInstrument(t) === 'stocks' ? 'Stock' : 'Options');
  const spreadGroups = alphaGroupClosedRows(intradayOptions, t => alphaSpreadBucket(t));
  const fillGroups = alphaGroupClosedRows(intradayOptions, t => {
    const f = alphaFillQuality(t);
    return f ? f.bucket : null;
  }).map(g => {
    const fills = g.rows.map(x => alphaFillQuality(x.trade)).filter(Boolean);
    const avgSlip = fills.length ? fills.reduce((s, f) => s + f.slipPct, 0) / fills.length : null;
    return { ...g, extraSub: avgSlip === null ? '' : `${avgSlip >= 0 ? '+' : ''}${avgSlip.toFixed(1)}% vs mid` };
  });

  const contextGroups = alphaGroupClosedRows(intraday, t => {
    const a = alphaContextAlignment(t);
    return a.score === null ? null : a.bucket;
  });
  const orbDirectionGroups = alphaGroupClosedRows(intraday, t => alphaOrbDirectionBucket(t));
  const orbRangeGroups = alphaGroupClosedRows(intraday, t => alphaOrbRangeBucket(t));
  const vwapGroups = alphaGroupClosedRows(intraday, t => alphaVwapBucket(t));
  const timeGroups = alphaGroupClosedRows(intraday, t => alphaTimeBucket(t));
  const frictionGroups = alphaGroupClosedRows(intraday, t => alphaFrictionBucket(t));
  const saQuantGroups = alphaGroupClosedRows(closedWithPL, t => alphaSaQuantBucket(t));

  const executionHtml = `
    ${alphaSection('Stock vs options edge', alphaRowsHtml(instrumentGroups, 'Log closed stock and option trades to compare which instrument is paying you.'))}
    ${alphaSection('Seeking Alpha edge', alphaRowsHtml(saQuantGroups, 'Trades logged with SA Quant ratings will show whether SA quality is actually helping your P/L.'))}
    ${alphaSection('Spread drag', alphaRowsHtml(spreadGroups, 'Intraday option trades with bid/ask or spread data will show spread drag here.'))}
    ${alphaSection('Fill quality', alphaRowsHtml(fillGroups, 'Paste or enter bid/ask so entry can be compared against mid price.'))}
  `;

  const contextHtml = `
    ${alphaSection('Context alignment', alphaRowsHtml(contextGroups, 'Intraday trades with setup, VWAP confluence, or breadth context will appear here.'))}
    ${alphaSection('ORB quality', `
      ${alphaRowsHtml(orbDirectionGroups, 'ORB trades will split by up-break vs down-break.', { showTargetRate: true })}
      <div class="alpha-edge-note">Range buckets use OR range as a percent of the opening range level when available.</div>
      ${alphaRowsHtml(orbRangeGroups, 'Add OR_HI, OR_LO, and RNG from the TOS alert to unlock OR range buckets.', { showTargetRate: true })}
    `)}
    ${alphaSection('VWAP edge', alphaRowsHtml(vwapGroups, 'VWAP confluence labels will show whether long-bias, short-bias, or mixed labels perform best.'))}
    ${alphaSection('Time and friction', `
      ${alphaRowsHtml(timeGroups, 'Intraday trade time will split results by morning, midday, afternoon, and outside-window entries.')}
      <div class="alpha-edge-note">Friction blends spread, fill quality, window discipline, context alignment, and trade number of day.</div>
      ${alphaRowsHtml(frictionGroups, 'Add execution and context fields to unlock friction scoring.')}
    `)}
  `;

  return `
    <div class="home-row stats-card-row">
      <div class="home-card">
        <div class="home-card-title">Execution Intelligence${help('Uses the new stock/options, bid, ask, mid, spread, and quantity fields to find execution drag.')}</div>
        ${executionHtml}
      </div>
      <div class="home-card">
        <div class="home-card-title">Intraday Context Intelligence${help('Uses ORB, VWAP confluence, breadth, time window, and friction fields from the intraday ticket.')}</div>
        ${contextHtml}
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────
//  buildAlphaIntel — returns the alpha-intel HTML block.
//  Called by renderLogStats; accepts pre-computed aggregates.
// ──────────────────────────────────────────────────────────
export function buildAlphaIntel(closed, closedWithPL, wins, losses, expectancy, avgR, profitFactor, trades) {
  const n = closed.length;

  // ── zero-data state ──────────────────────────────────────
  if (n === 0) {
    return `
      <div class="home-card ai-empty" style="margin-bottom: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div class="home-card-title" style="color:#7ee787; margin: 0;">Edge Intelligence</div>
        </div>
        <div class="ai-empty-body">
          <div class="ai-empty-icon">⌁</div>
          <div class="ai-empty-msg"><strong>No closed trades yet.</strong> Once you log a few exits — wins or losses — this card will tell you what's working, what's not, and when to slow down.</div>
        </div>
      </div>`;
  }

  // ── shared computations ──────────────────────────────────
  const totalPL = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRate = Math.round(wins.length / n * 100);
  const avgWin  = wins.length  ? wins.reduce((s, x) => s + x.pl, 0)  / wins.length  : 0;
  const avgLoss = losses.length ? losses.reduce((s, x) => s + x.pl, 0) / losses.length : 0;

  // Setup-level aggregate
  const { best: bestSetup, worst: worstSetup, all: setups } = bestWorstSetup(closed);

  // Exit-reason breakdown — discretionary + thesis-broke are the early-exit leak.
  const byExit = r => closed.filter(t => t.exit_reason === r);
  const discCount = byExit('discretionary').length + byExit('thesis-broke').length;
  const discPL    = [...byExit('discretionary'), ...byExit('thesis-broke')]
                      .reduce((s, t) => s + (calcPL(t) || 0), 0);

  // Process quality — % of reviewed trades graded "Good" (followed plan).
  const graded = closed.filter(t => t.grade);
  const goodCount = graded.filter(t => normalizeProcessQuality(t.grade) === 'clean').length;
  const gradeScore = graded.length ? Math.round(goodCount / graded.length * 100) : null;

  // Kill switch — uses ROLLING window (Settings.killSwitchDays). Career
  // P/L was the wrong measure: someone with $5k of lifetime gains and a
  // recent $1k drawdown should not be killed by their lifetime number.
  const rolling = computeRollingPL();
  const killActive = rolling.killActive;

  // Money-readable formatter — keeps strings short and consistent.
  const $ = fmtMoney;

  // ── headline diagnostic ─────────────────────────────────
  // Split into accent (leading verdict, colored) + tail (white follow-up).
  let headlineAccent = '', headlineTail = '', headlineTone = 'good';

  if (n < 5) {
    headlineAccent = `Early days.`;
    headlineTail = `Keep size small while the sample builds.`;
    headlineTone = 'info';
  } else if (killActive) {
    headlineAccent = `Kill switch active.`;
    headlineTail = `Pause new trades until rolling P/L recovers.`;
    headlineTone = 'bad';
  } else if (gradeScore !== null && gradeScore < 60 && graded.length >= 5) {
    headlineAccent = `Process leak.`;
    headlineTail = `Fix execution before adding size.`;
    headlineTone = 'warn';
  } else if (avgWin > 0 && avgLoss < 0 && Math.abs(avgLoss) > avgWin * 1.2) {
    headlineAccent = `Lopsided.`;
    headlineTail = `Tighten stops before adding risk.`;
    headlineTone = 'warn';
  } else if (discCount >= 3 && discPL < 0) {
    headlineAccent = `Early exits hurting.`;
    headlineTail = `Stick to target and stop rules before sizing up.`;
    headlineTone = 'warn';
  } else if (bestSetup && bestSetup.pl > 0) {
    headlineAccent = `Edge confirmed.`;
    headlineTail = `Favor proven setups and keep risk steady.`;
    headlineTone = 'good';
  } else if (expectancy > 0 && avgR >= 0.5) {
    headlineAccent = `In form.`;
    headlineTail = `Stay consistent; don't expand risk just because it is working.`;
    headlineTone = 'good';
  } else {
    headlineAccent = expectancy >= 0 ? `Net positive.` : `Net negative.`;
    headlineTail = expectancy >= 0 ? `Protect the process and keep logging.` : `Reduce size and review setup selection.`;
    headlineTone = expectancy >= 0 ? 'good' : 'warn';
  }

  // ── bullets — career-focused, plain English, max 5 ───────
  const bullets = [];

  // 1. Career line — the headline number, plus the metrics in one breath.
  bullets.push({
    tone: totalPL >= 0 ? 'good' : 'bad',
    chip: 'PORTFOLIO',
    text: `<strong>Portfolio: ${$(totalPL)}</strong> across ${n} trade${n === 1 ? '' : 's'} · ${winRate}% wins · avg ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}× your risk per trade · profit factor ${profitFactor}.`,
  });

  // 2. Best vs worst setup — only if we have ≥5 trades and they differ.
  if (bestSetup && worstSetup && bestSetup.key !== worstSetup.key && n >= 5) {
    bullets.push({
      tone: bestSetup.pl >= 0 ? 'good' : 'warn',
      chip: 'PATTERN',
      text: `Best pattern <strong>${bestSetup.key}</strong> (${$(bestSetup.pl)}) · weakest <strong>${worstSetup.key}</strong> (${$(worstSetup.pl)}). Size up the best, drop the worst.`,
    });
  } else if (n < 5) {
    bullets.push({
      tone: 'info', chip: 'PATTERN',
      text: `Setup-level breakdown unlocks at <strong>more than 5 closed trades</strong>. Keep logging.`,
    });
  }

  buildAlphaHighlightBullets(closedWithPL).slice(0, 2).forEach(b => bullets.push({ ...b, chip: b.icon || 'ALPHA' }));

  // 3. Process quality vs leak — pick the strongest signal.
  if (discCount >= 3 && discPL < 0) {
    bullets.push({
      tone: 'warn', chip: 'PROCESS',
      text: `Early exits (gut call or thesis-broke) total cost <strong>${$(-Math.abs(discPL))}</strong> across ${discCount} trade${discCount === 1 ? '' : 's'}. Letting them run more often would change the curve.`,
    });
  } else if (gradeScore !== null && graded.length >= 5) {
    const tone = gradeScore >= 80 ? 'good' : gradeScore >= 60 ? 'warn' : 'bad';
    const verdict = gradeScore >= 80 ? 'execution is doing the work.'
                  : gradeScore >= 60 ? 'some drift — review Okay/Bad trades.'
                                     : 'execution quality is the next thing to fix.';
    bullets.push({ tone, chip: 'PROCESS', text: `<strong>${gradeScore}% of reviewed trades followed the plan</strong> — ${verdict}` });
  } else if (graded.length < 3 && n >= 5) {
    bullets.push({
      tone: 'info', chip: 'PROCESS',
      text: `<strong>${n - graded.length} trade${n - graded.length === 1 ? '' : 's'} ungraded.</strong> Mark them Good / Okay / Bad after each exit so stats can separate process from outcome.`,
    });
  }

  // 4. Recent-window bullet — small overlap with Home so a regression shows here too.
  if (rolling.count >= 3) {
    const tone = rolling.killActive ? 'bad' : rolling.pct < 0 ? 'warn' : 'good';
    const verdict = rolling.killActive ? 'kill switch active'
                  : rolling.pct < 0    ? 'in drawdown'
                                       : 'in form';
    const spark = buildSparklineSvg(rolling.series, { w: 60, h: 16 });
    bullets.push({
      tone, chip: 'TREND',
      text: `Last ${rolling.days} days: <strong>${$(rolling.totalPL)}</strong> over ${rolling.count} closed (${rolling.pct >= 0 ? '+' : ''}${rolling.pct.toFixed(1)}% of account · ${rolling.winRate}% wins) — ${verdict}.${spark}`,
    });
  }

  // 5. Risk: avg win vs avg loss size, only if asymmetric.
  if (wins.length && losses.length && avgWin > 0 && avgLoss < 0 && Math.abs(avgLoss) > avgWin * 1.2) {
    bullets.push({
      tone: 'warn', chip: 'RISK',
      text: `Avg win ${$(avgWin)} vs avg loss ${$(avgLoss)} — losses ${(Math.abs(avgLoss)/avgWin).toFixed(1)}× wider. Move stops in or cut sooner on broken setups.`,
    });
  }

  const eyebrowStatus = alphaConfidenceLabel(n);
  const sortedBullets = sortBulletsBySeverity(collapseDuplicateIntelBullets(bullets)).slice(0, 6);

  return `
    <div class="alpha-intel-card" data-tone="${headlineTone || 'good'}">
      <div class="alpha-intel-eyebrow">
        <span class="alpha-intel-eyebrow-l"><span class="alpha-intel-sparkle">✦</span><span class="alpha-intel-wordmark">EDGE INTELLIGENCE</span></span>
        <span class="alpha-intel-eyebrow-r tone-${headlineTone}">${eyebrowStatus}</span>
      </div>
      <h2 class="alpha-intel-headline tone-${headlineTone}">
        <span class="alpha-intel-accent">${headlineAccent}</span>
        <span class="alpha-intel-tail">${headlineTail}</span>
      </h2>
      <ul class="alpha-intel-points">
        ${sortedBullets.map(alphaBulletHtml).join('')}
      </ul>
    </div>`;
}

// Stable-sort bullets so the most-actionable (worst tone) read floats to the
// top of the card. Within a tone, original order is preserved so the catalog
// flow (Portfolio → Pattern → Process → Trend → Risk) still reads naturally.
function sortBulletsBySeverity(bullets) {
  return bullets
    .map((b, i) => ({ b, i }))
    .sort((a, b) => alphaToneRank(a.b.tone) - alphaToneRank(b.b.tone) || a.i - b.i)
    .map(x => x.b);
}

// Top-right status pill mapped from headline tone — mirrors the reference
// "RISK OFF · DEFENSIVE" style. Kept here so home + stats stay in sync.
function alphaIntelStatusLabel(tone) {
  switch (tone) {
    case 'bad':  return 'RISK OFF · DEFENSIVE';
    case 'warn': return 'CAUTION · MIXED';
    case 'info': return 'EARLY · OBSERVING';
    case 'good':
    default:     return 'RISK ON · IN FORM';
  }
}

// ──────────────────────────────────────────────────────────
//  buildTradeFlowEdgeIntel — Edge Intel sized for the final trade step.
//  Surfaces 3-4 bullets relevant to the trade about to be logged:
//  setup history, friction warnings, regime/budget reminders. Renders
//  with the same visual language as the home Edge Intel card so the user
//  reads it the same way no matter where they see it.
// ──────────────────────────────────────────────────────────
export function buildTradeFlowEdgeIntel({ mode, setup, direction, instrument, inModal = false } = {}) {
  const closedWithPL = enrichClosed(state.trades);
  const closed = closedWithPL.map(x => x.trade);
  const $ = fmtMoney;
  const dirKey = (direction || '').toString().toLowerCase().startsWith('s') ? 'short' : 'long';

  const bullets = [];

  // Friendly setup name — fall back to whatever was stored.
  const setupDef = (typeof tfFindIntradaySetup === 'function' && mode === 'intraday') ? tfFindIntradaySetup(setup) : null;
  const swingSetupDef = (mode === 'swing' && Array.isArray(TRADE_SWING_SETUPS))
    ? (TRADE_SWING_SETUPS.find(s => s.id === setup)
        || (state.aiCustomSetups && state.aiCustomSetups[setup])
        || null)
    : null;
  const setupLabel = setupDef ? setupDef.name : (swingSetupDef ? (swingSetupDef.name || swingSetupDef.id) : (setup || 'this setup'));
  const dirWord = dirKey === 'short' ? 'short' : 'long';
  let setupBullet = null;
  let setupSampleCount = 0;

  // Reward vs. risk.
  const ticket = mode === 'intraday' ? (state.intraday || {}) : null;
  const entry  = ticket ? Number(ticket.entry)  : Number(state.premium);
  const stop   = ticket ? Number(ticket.stop)   : Number(state.swingStop);
  const target = ticket ? Number(ticket.target) : Number(state.swingTarget);
  if (entry > 0 && stop > 0 && target > 0) {
    const rr = Math.abs((target - entry) / (entry - stop));
    if (isFinite(rr)) {
      if (rr >= 2) {
        bullets.push({ tone: 'good', chip: 'PAYOFF', text: `<strong>Good payoff:</strong> you could win about $${rr.toFixed(1)} for every $1 you risk.` });
      } else if (rr >= 1.5) {
        bullets.push({ tone: 'info', chip: 'PAYOFF', text: `<strong>Okay payoff:</strong> winning about $${rr.toFixed(1)} per $1 risked. Tight — only take it if you're confident.` });
      } else {
        bullets.push({ tone: 'bad', chip: 'PAYOFF', text: `<strong>Skinny payoff:</strong> only $${rr.toFixed(1)} reward per $1 risked. Most pros pass on this.` });
      }
    }
  }

  // How much of the account is on the line.
  if (mode === 'intraday') {
    const auto = (typeof tfComputeIntradayRiskSize === 'function') ? tfComputeIntradayRiskSize() : null;
    const it = state.intraday || {};
    const settings = state.settings || {};
    const account = Number(settings.account) || 0;
    const isOptions = (it.instrument || 'options') !== 'stocks';
    const qty = Number(it.contracts) || (auto ? auto.qty : 0);
    const stopDist = (entry > 0 && stop > 0) ? Math.abs(entry - stop) : 0;
    const riskDollars = qty && stopDist ? qty * stopDist * (isOptions ? 100 : 1) : (auto ? auto.risk : 0);
    if (account > 0 && riskDollars > 0) {
      const pct = (riskDollars / account) * 100;
      if (pct > 2) {
        bullets.push({ tone: 'bad', chip: 'SIZE', text: `<strong>Too much on the line:</strong> $${Math.round(riskDollars).toLocaleString()} is ${pct.toFixed(1)}% of your account — bigger than your usual trade. Cut the size.` });
      } else if (pct > 1) {
        bullets.push({ tone: 'warn', chip: 'SIZE', text: `<strong>Heavy size:</strong> $${Math.round(riskDollars).toLocaleString()} (${pct.toFixed(1)}% of account). At the top of your normal range.` });
      } else {
        bullets.push({ tone: 'good', chip: 'SIZE', text: `<strong>Risk in check:</strong> $${Math.round(riskDollars).toLocaleString()} on the line — ${pct.toFixed(1)}% of your account, well within your rules.` });
      }
    } else if (qty > 0) {
      bullets.push({ tone: 'info', chip: 'SIZE', text: `<strong>${qty} ${isOptions ? 'contract' : 'share'}${qty > 1 ? 's' : ''} planned.</strong> Add an account size in Settings to see how much you're really risking.` });
    }
  }

  // Does the rest of the picture agree with the direction.
  if (mode === 'intraday') {
    const it = state.intraday || {};
    if (it.confluence || it.breadth) {
      const conflictConf = (dirKey === 'long' && it.confluence === 'short-bias') || (dirKey === 'short' && it.confluence === 'long-bias');
      const conflictBr   = (dirKey === 'long' && it.breadth === 'down')          || (dirKey === 'short' && it.breadth === 'up');
      if (conflictConf || conflictBr) {
        bullets.push({ tone: 'bad', chip: 'TAPE', text: `<strong>You're fighting the tape:</strong> the market is pointing the other way. Flip the direction or skip the trade.` });
      } else {
        const aligned = [
          it.confluence && ((dirKey === 'long' && it.confluence === 'long-bias') || (dirKey === 'short' && it.confluence === 'short-bias')),
          it.breadth && ((dirKey === 'long' && it.breadth === 'up') || (dirKey === 'short' && it.breadth === 'down')),
        ].filter(Boolean).length;
        if (aligned > 0) {
          bullets.push({ tone: 'good', chip: 'TAPE', text: `<strong>The tape agrees with you:</strong> the broader market is leaning ${dirWord} too. Good backdrop.` });
        }
      }
    } else {
      bullets.push({ tone: 'info', chip: 'TAPE', text: `<strong>No market context tagged.</strong> Add confluence or breadth next time — it makes these reads sharper later.` });
    }
  }

  // What history says about this exact play.
  if (setup) {
    const peers = closedWithPL.filter(x => {
      const t = x.trade;
      const tDir = (t.direction || '').toString().toLowerCase().startsWith('s') ? 'short' : 'long';
      return (t.setup === setup) && (tDir === dirKey);
    });
    setupSampleCount = peers.length;
    if (peers.length >= 2) {
      const wins = peers.filter(x => x.pl > 0).length;
      const losses = peers.length - wins;
      const wr = Math.round(wins / peers.length * 100);
      const avgR = peers.reduce((s, x) => s + x.r, 0) / peers.length;
      const totalPL = peers.reduce((s, x) => s + x.pl, 0);
      const totalSign = totalPL >= 0 ? '+' : '−';
      const totalAbs = `$${Math.abs(Math.round(totalPL)).toLocaleString()}`;
      const avgRText = `${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R`;
      const sampleMeta = alphaConfidenceMeta(peers.length, 'setup trade');
      if (avgR >= 0.4) {
        setupBullet = { tone: 'good', chip: 'SETUP', priority: true, text: `<strong>${setupLabel} ${dirWord}: ${wins}W / ${losses}L · avg ${avgRText}.</strong> ${sampleMeta}; ${wr}% wins, ${totalSign}${totalAbs} total. Eligible for normal size if today's chart still matches.` };
      } else if (avgR >= 0) {
        setupBullet = { tone: 'info', chip: 'SETUP', priority: true, text: `<strong>${setupLabel} ${dirWord}: ${wins}W / ${losses}L · avg ${avgRText}.</strong> ${sampleMeta}; ${wr}% wins, ${totalSign}${totalAbs} total. No strong edge yet — trade carefully.` };
      } else {
        setupBullet = { tone: 'bad', chip: 'SETUP', priority: true, text: `<strong>${setupLabel} ${dirWord}: ${wins}W / ${losses}L · avg ${avgRText}.</strong> ${sampleMeta}; ${wr}% wins, ${totalSign}${totalAbs} total. Skip unless today's setup fixes the miss.` };
      }
    } else if (peers.length === 1) {
      setupBullet = { tone: 'info', chip: 'SETUP', priority: true, text: `<strong>Only one ${setupLabel} ${dirWord} trade so far.</strong> ${alphaConfidenceMeta(1, 'setup trade')}; not enough history to call it. Ask whether today's chart still matches the playbook.` };
    } else {
      setupBullet = { tone: 'info', chip: 'SETUP', priority: true, text: `<strong>First logged ${setupLabel} ${dirWord} trade.</strong> ${alphaConfidenceMeta(0, 'setup trade')}; treat this as rule-based, not edge-confirmed.` };
    }
  }

  // SA quant history (swing only).
  const saBucket = alphaSaQuantBucket({ saQuant: state.saQuant });
  if (mode === 'swing' && saBucket) {
    const peers = closedWithPL.filter(x => alphaSaQuantBucket(x.trade) === saBucket);
    if (peers.length >= 3) {
      const totalPL = peers.reduce((s, x) => s + x.pl, 0);
      const totalSign = totalPL >= 0 ? '+' : '−';
      const totalAbs = `$${Math.abs(Math.round(totalPL)).toLocaleString()}`;
      bullets.push({
        tone: totalPL >= 0 ? 'good' : 'bad', chip: 'SA QUANT',
        text: totalPL >= 0
          ? `<strong>${saBucket}-rated names have worked for you</strong> — ${peers.length} prior trades, ${totalSign}${totalAbs} total.`
          : `<strong>${saBucket}-rated names have lost money:</strong> ${peers.length} prior trades, ${totalSign}${totalAbs}. Be picky here.`,
      });
    }
  }

  // Market regime warnings.
  const regime = state.regime || 'risk-on';
  if (regime === 'risk-off' && dirKey === 'long') {
    bullets.push({
      tone: 'bad', chip: 'REGIME',
      text: `<strong>The market is in risk-off mode and you're buying.</strong> You're swimming upstream — cut the size in half or wait it out.`,
    });
  } else if (regime === 'neutral') {
    bullets.push({
      tone: 'warn', chip: 'REGIME',
      text: `<strong>Choppy market — go half size.</strong> Both directions are tricky right now; only take rock-solid setups.`,
    });
  } else if (state.selectedSetup === 'Edge Reversal' && mode === 'swing') {
    bullets.push({
      tone: 'warn', chip: 'REGIME',
      text: `<strong>Edge Reversal trades fail more often.</strong> Use half your usual size — that's the rule for catching turns.`,
    });
  }

  // Recent drawdown / kill switch.
  const rolling = computeRollingPL();
  const warnFloor = rolling.floor * 0.6;
  if (rolling.killActive) {
    bullets.push({
      tone: 'bad', chip: 'TREND',
      text: `<strong>Cool-off time.</strong> You're down ${Math.abs(rolling.pct).toFixed(1)}% over the last ${rolling.days} days — step away until things turn around.`,
    });
  } else if (rolling.pct <= -warnFloor && rolling.count > 0) {
    bullets.push({
      tone: 'warn', chip: 'TREND',
      text: `<strong>You've been losing lately</strong> (down ${Math.abs(rolling.pct).toFixed(1)}% over ${rolling.days} days). Tighten things up before you hit the -${rolling.floor}% pause line.`,
    });
  }

  // Friction + daily loss budget (intraday).
  if (mode === 'intraday') {
    const it = state.intraday || {};
    const settings = state.settings || {};
    const isOptions = (it.instrument || 'options') !== 'stocks';
    if (isOptions && it.spreadPct !== null && it.spreadPct !== undefined) {
      const spread = Number(it.spreadPct);
      const max = settings.intradayMaxSpreadPct || 5;
      if (spread > max * 0.7) {
        bullets.push({
          tone: spread > max ? 'bad' : 'warn', chip: 'SPREAD',
          text: spread > max
            ? `<strong>Spread is too wide</strong> (${spread.toFixed(1)}%). You'd lose a big chunk just getting in and out — pass on this one.`
            : `<strong>Wide spread</strong> (${spread.toFixed(1)}%). It'll eat into the move — need a bigger run than usual to come out ahead.`,
        });
      }
    }
    if (typeof tfComputeIntradayDayPL === 'function') {
      const dayPL = tfComputeIntradayDayPL();
      const cap = settings.intradayMaxDailyLoss || 200;
      const remaining = cap + dayPL;
      if (remaining < cap * 0.4 && dayPL < 0) {
        bullets.push({
          tone: remaining <= 0 ? 'bad' : 'warn', chip: 'BUDGET',
          text: remaining <= 0
            ? `<strong>You've hit your daily loss limit.</strong> Stop trading for today.`
            : `<strong>Only $${Math.round(remaining).toLocaleString()} left in your daily loss budget.</strong> One more loss and you're done for the day.`,
        });
      }
    }
  }

  // All clear.
  if (!bullets.length && !setupBullet) {
    bullets.push({
      tone: 'info', chip: 'READ',
      text: `No logged-data warning yet. Ask the chart for confirmation before you treat this as clean.`,
    });
  }

  const allBullets = collapseDuplicateIntelBullets(setupBullet ? [setupBullet, ...bullets] : bullets);
  const priorityBullets = allBullets.filter(b => b.priority);
  const sortedEvidence = sortBulletsBySeverity(allBullets.filter(b => !b.priority));
  const modalBlockers = sortedEvidence.filter(b => b.tone === 'bad' || b.tone === 'warn');
  const displayBullets = inModal
    ? [
        ...priorityBullets.filter(b => b.tone === 'bad' || b.tone === 'warn'),
        ...modalBlockers,
        ...priorityBullets.filter(b => b.tone !== 'bad' && b.tone !== 'warn'),
        ...sortedEvidence.filter(b => b.tone !== 'bad' && b.tone !== 'warn'),
      ].slice(0, 2)
    : [...priorityBullets, ...sortedEvidence].slice(0, 5);

  // Worst tone across bullets sets the verdict headline tone.
  const worst = allBullets.reduce((acc, b) => alphaToneRank(b.tone) < alphaToneRank(acc) ? b.tone : acc, 'good');
  const headlineTone = worst;

  // Verdict is action-first; the rows below carry the evidence.
  const badBullet = allBullets.find(b => b.tone === 'bad');
  const warnBullet = allBullets.find(b => b.tone === 'warn');
  let headlineAccent, headlineTail;
  if (badBullet) {
    headlineAccent = `Stand down.`;
    switch (badBullet.chip) {
      case 'SETUP':
        headlineTail = `Skip this setup unless today's chart fixes the miss.`;
        break;
      case 'SIZE':
        headlineTail = `Cut size before entry.`;
        break;
      case 'PAYOFF':
        headlineTail = `Reward is too thin for the risk.`;
        break;
      case 'TAPE':
        headlineTail = `Wait for market alignment.`;
        break;
      case 'SPREAD':
        headlineTail = `Pass until the spread tightens.`;
        break;
      case 'BUDGET':
      case 'TREND':
        headlineTail = `Stop trading until the loss guard clears.`;
        break;
      default:
        headlineTail = `Resolve the blocking issue before entry.`;
    }
  } else if (warnBullet) {
    headlineAccent = `Caution.`;
    headlineTail = `Reduce size and require cleaner confirmation.`;
  } else if (headlineTone === 'info') {
    headlineAccent = `Data light.`;
    headlineTail = `Use the rules first; the sample is still building.`;
  } else {
    headlineAccent = `Cleared.`;
    headlineTail = `Normal size is reasonable if the chart confirms.`;
  }

  const confidenceCount = setup ? setupSampleCount : closed.length;
  const kicker = inModal
    ? alphaConfidenceLabel(confidenceCount)
    : `PRE-TRADE READ · ${alphaConfidenceLabel(confidenceCount)}`;

  return `
    <div class="alpha-intel-card trade-edge-intel${inModal ? ' compact' : ''}" data-tone="${headlineTone || 'good'}">
      <div class="alpha-intel-eyebrow">
        <span class="alpha-intel-eyebrow-l"><span class="alpha-intel-sparkle">✦</span><span class="alpha-intel-wordmark">EDGE INTELLIGENCE</span></span>
        <span class="alpha-intel-eyebrow-r">${kicker}</span>
      </div>
      <h2 class="alpha-intel-headline tone-${headlineTone}">
        <span class="alpha-intel-accent">${headlineAccent}</span>
        <span class="alpha-intel-tail">${headlineTail}</span>
      </h2>
      <ul class="alpha-intel-points">
        ${displayBullets.map(alphaBulletHtml).join('')}
      </ul>
    </div>`;
}

export function renderLogStats() {
  const container = document.getElementById('log-stats');
  if (!container) return;
  const filter = state.logModeFilter || 'all';
  const setupFilter = state.logSetupFilter || '';
  const index = buildTradeIndex(state.trades || []);
  const modeTrades = filter === 'all' ? index.all : index.all.filter(t => (t.mode || 'swing') === filter);
  const trades = setupFilter ? modeTrades.filter(t => (t.setup || '—') === setupFilter) : modeTrades;
  const open   = trades.filter(t => t.status === 'open');
  const closed = trades.filter(t => isClosedTrade(t));
  const closedWithPL = enrichClosed(closed);
  const wins   = closedWithPL.filter(x => x.pl > 0);
  const losses = closedWithPL.filter(x => x.pl < 0);

  const totalPL    = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRateNum = closed.length > 0 ? wins.length / closed.length * 100 : null;
  const winRateStr = winRateNum !== null ? winRateNum.toFixed(0) + '%' : '—';
  const avgWinR  = wins.length   ? wins.reduce((s, x) => s + x.r, 0)   / wins.length   : 0;
  const avgLossR = losses.length ? losses.reduce((s, x) => s + x.r, 0) / losses.length : 0;

  // Grade quality (Process card)
  const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  closed.forEach(t => { const g = (t.grade || '').toUpperCase(); if (gradeCounts[g] !== undefined) gradeCounts[g]++; });
  const totalGraded = gradeCounts.A + gradeCounts.B + gradeCounts.C + gradeCounts.D;
  const aPct = totalGraded ? Math.round(gradeCounts.A / totalGraded * 100) : null;
  const processValue = aPct !== null ? `A · ${aPct}%` : '—';
  const processSubParts = [gradeCounts.A && `${gradeCounts.A}A`, gradeCounts.B && `${gradeCounts.B}B`, gradeCounts.C && `${gradeCounts.C}C`].filter(Boolean);
  const processSub = processSubParts.length ? processSubParts.join(' · ') : 'no graded trades';

  const avgWinRStr  = wins.length   ? `${avgWinR  >= 0 ? '+' : ''}${avgWinR.toFixed(2)}R`  : '—';
  const avgLossRStr = losses.length ? `${avgLossR >= 0 ? '+' : ''}${avgLossR.toFixed(2)}R` : '—';

  const totalPLStr = (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const heroModeLabel = (state.logModeFilter || 'all') === 'all' ? 'ALL' : (state.logModeFilter || '').toUpperCase();
  const heroPeriodLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();

  const fiveCards = [
    { label: 'Net P/L',  value: totalPLStr, sub: `${closed.length} closed · ${open.length} open`, cls: totalPL >= 0 ? 'pos' : 'neg' },
    { label: 'Win rate', value: winRateStr, sub: `${wins.length}W / ${losses.length}L closed`, cls: '' },
    { label: 'Avg win',  value: avgWinRStr,  sub: `${wins.length} trades`,  cls: 'pos' },
    { label: 'Avg loss', value: avgLossRStr, sub: `${losses.length} trades`, cls: 'neg' },
    { label: 'Process',  value: processValue, sub: processSub, cls: '' },
  ].map(c => `
    <div class="log-stat-card">
      <div class="log-stat-label">${c.label}</div>
      <div class="log-stat-value ${c.cls}">${c.value}</div>
      <div class="log-stat-sub">${c.sub}</div>
    </div>`).join('');

  container.innerHTML = `
    <div class="log-hero">
      <div class="log-hero-left">
        <div class="log-hero-eyebrow">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 6px var(--cyan);flex-shrink:0;"></span>
          HISTORY · ${heroPeriodLabel}${setupFilter ? ' · ' + alphaEsc(setupFilter) : ''}
        </div>
        <h1 class="log-hero-heading">${trades.length} trades · <span style="color:var(--${totalPL >= 0 ? 'green-bright' : 'red-bright'})">${totalPLStr}</span></h1>
        <p class="log-hero-sub">
          <strong>${wins.length} wins / ${losses.length} losses</strong> closed ·
          <strong>${open.length} open</strong> · ${heroModeLabel} · sorted newest first.
        </p>
      </div>
      <div class="log-hero-actions">
        <button class="btn-secondary" style="font-family:var(--mono);font-size:10px;letter-spacing:0.12em;" onclick="exportCSV()">EXPORT CSV</button>
        <button class="btn-primary" style="font-family:var(--mono);font-size:10px;letter-spacing:0.12em;" onclick="openTradeModal()">+ ADD TRADE</button>
      </div>
    </div>
    <div class="log-stat-strip">${fiveCards}</div>
  `;
}
