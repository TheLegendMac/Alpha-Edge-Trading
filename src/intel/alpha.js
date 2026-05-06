// Alpha Intel — performance + friction analytics that drive the home dashboard's
// 'alpha edge' card and the closed-trade summary breakdowns.

import { state } from '../state/store.js';
import {
  isClosedTrade,
  calcPL,
  tradeBias,
  tradeInstrument,
  tradeMultiplier,
  tradeQty,
  normalizeProcessQuality,
} from '../models/trade.js';
import { TRADE_INTRADAY_SETUPS, TRADE_CONFLUENCE_OPTIONS } from '../config/constants.js';
import { computeRollingPL } from './rolling.js';

function alphaEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

function alphaMoney(v) {
  const n = Number(v) || 0;
  return `${n >= 0 ? '+$' : '-$'}${Math.abs(Math.round(n)).toLocaleString()}`;
}

function alphaR(v) {
  const n = Number(v) || 0;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`;
}

function alphaDirectionKey(t) {
  if (typeof tradeBias === 'function') return tradeBias(t) === 'bearish' ? 'short' : 'long';
  const d = String((t && t.direction) || '').toLowerCase();
  return /short|put|bear/.test(d) ? 'short' : 'long';
}

function alphaIntradaySetupDef(t) {
  const raw = String((t && t.setup) || '').trim();
  if (!raw || typeof TRADE_INTRADAY_SETUPS === 'undefined') return null;
  return TRADE_INTRADAY_SETUPS.find(s =>
    s.id === raw ||
    s.name.toUpperCase() === raw.toUpperCase()
  ) || null;
}

function alphaSetupBias(t) {
  const def = alphaIntradaySetupDef(t);
  if (def && def.bias && def.bias !== 'either') return def.bias;
  const setup = String((t && t.setup) || '').toUpperCase();
  if (/\b(DN|DOWN|BELOW|LOSS|SHORT)\b/.test(setup)) return 'short';
  if (/\b(UP|ABOVE|RECLAIM|LONG|BREAK|RETEST|MOMO|TREND)\b/.test(setup)) return 'long';
  return null;
}

function alphaConfluenceBias(t) {
  const id = (t && t.confluence) || '';
  if (id && typeof TRADE_CONFLUENCE_OPTIONS !== 'undefined') {
    const def = TRADE_CONFLUENCE_OPTIONS.find(c => c.id === id);
    if (def && def.bias && def.bias !== 'either') return def.bias;
    if (def && def.bias === 'either') return 'either';
  }
  const rel = String((t && t.vwapRel) || '').toLowerCase();
  if (rel === 'above') return 'long';
  if (rel === 'below') return 'short';
  if (rel === 'at' || rel === 'mixed') return 'either';
  return null;
}

function alphaBreadthBias(t) {
  const b = String((t && t.breadth) || '').toLowerCase();
  if (b === 'up') return 'long';
  if (b === 'down') return 'short';
  return null;
}

function alphaContextAlignment(t) {
  if (!t || t.mode !== 'intraday') return { bucket: null, score: null, checks: 0 };
  const dir = alphaDirectionKey(t);
  const checks = [];
  const setupBias = alphaSetupBias(t);
  const confBias = alphaConfluenceBias(t);
  const breadthBias = alphaBreadthBias(t);

  if (setupBias) checks.push(setupBias === dir);
  if (confBias && confBias !== 'either') checks.push(confBias === dir);
  if (breadthBias) checks.push(breadthBias === dir);

  if (!checks.length) return { bucket: 'No context', score: null, checks: 0 };
  const pass = checks.filter(Boolean).length;
  const score = Math.round(pass / checks.length * 100);
  const bucket = score >= 75 ? 'Aligned' : score >= 40 ? 'Mixed' : 'Conflicted';
  return { bucket, score, checks: checks.length };
}

function alphaSpreadValue(t) {
  if (!t || tradeInstrument(t) !== 'options') return null;
  const spread = window.deriveSpreadPct(t);
  return Number.isFinite(Number(spread)) ? Number(spread) : null;
}

function alphaSpreadBucket(t) {
  const spread = alphaSpreadValue(t);
  if (spread === null) return null;
  const max = (state.settings && state.settings.intradayMaxSpreadPct) || 5;
  if (spread <= 2) return 'Tight 0-2%';
  if (spread <= max) return `Tradable 2-${max}%`;
  return `Wide over ${max}%`;
}

function alphaFillQuality(t) {
  if (!t || tradeInstrument(t) !== 'options') return null;
  const entry = Number(t.entry);
  const bid = Number(t.bid);
  const ask = Number(t.ask);
  const mid = Number(t.mid) || ((bid > 0 && ask > 0) ? (bid + ask) / 2 : null);
  if (!entry || !mid || entry <= 0 || mid <= 0) return null;
  const slipPct = ((entry - mid) / mid) * 100;
  const slipDollars = (entry - mid) * tradeMultiplier(t) * Math.max(1, tradeQty(t));
  const bucket = slipPct <= 0 ? 'Mid or better' : slipPct <= 1 ? 'Near mid' : 'Above mid';
  return { bucket, slipPct, slipDollars };
}

function alphaTimeBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const raw = String(t.time || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) {
    if (t.inWindow === false) return 'Outside window';
    if (t.inWindow === true) return 'In window';
    return null;
  }
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes >= 9 * 60 + 35 && minutes <= 11 * 60 + 30) return 'Morning window';
  if (minutes >= 14 * 60 && minutes <= 15 * 60 + 30) return 'Afternoon window';
  if (minutes > 11 * 60 + 30 && minutes < 14 * 60) return 'Midday';
  return 'Outside window';
}

function alphaOrbDirectionBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const setup = String(t.setup || '').toUpperCase();
  const hasOrb = /ORB/.test(setup) || t.orHi != null || t.orLo != null || t.orRng != null;
  if (!hasOrb) return null;
  const bias = alphaSetupBias(t) || alphaDirectionKey(t);
  return bias === 'short' ? 'ORB down' : 'ORB up';
}

function alphaOrbRangeBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const rng = Number(t.orRng);
  if (!Number.isFinite(rng) || rng <= 0) return null;
  const ref = Number(t.orHi) || Number(t.orLo) || null;
  const pct = ref && ref > 0 ? (rng / ref) * 100 : null;
  if (pct !== null) {
    if (pct <= 0.25) return 'Tight OR range';
    if (pct <= 0.75) return 'Normal OR range';
    return 'Wide OR range';
  }
  if (rng <= 0.75) return 'Tight OR range';
  if (rng <= 2) return 'Normal OR range';
  return 'Wide OR range';
}

function alphaVwapBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  if (t.confluence && typeof TRADE_CONFLUENCE_OPTIONS !== 'undefined') {
    const def = TRADE_CONFLUENCE_OPTIONS.find(c => c.id === t.confluence);
    if (def) return def.label;
  }
  const rel = String(t.vwapRel || '').toLowerCase();
  if (rel === 'above') return 'ABOVE VWAP';
  if (rel === 'below') return 'BELOW VWAP';
  if (rel === 'at') return 'AT VWAP';
  return null;
}

function alphaFrictionScore(t) {
  if (!t || t.mode !== 'intraday') return null;
  const parts = [];
  if (tradeInstrument(t) === 'options') {
    const spread = alphaSpreadValue(t);
    if (spread !== null) parts.push(spread <= ((state.settings && state.settings.intradayMaxSpreadPct) || 5) ? 1 : 0);
    const fill = alphaFillQuality(t);
    if (fill) parts.push(fill.slipPct <= 1 ? 1 : fill.slipPct <= 3 ? 0.5 : 0);
  }
  if (typeof t.inWindow === 'boolean') parts.push(t.inWindow ? 1 : 0);
  const align = alphaContextAlignment(t);
  if (align.score !== null) parts.push(align.score >= 75 ? 1 : align.score >= 40 ? 0.5 : 0);
  if (t.tradeNumOfDay != null) parts.push(Number(t.tradeNumOfDay) <= 3 ? 1 : 0.5);
  if (!parts.length) return null;
  return Math.round(parts.reduce((s, x) => s + x, 0) / parts.length * 100);
}

function alphaFrictionBucket(t) {
  const score = alphaFrictionScore(t);
  if (score === null) return null;
  if (score >= 80) return 'Low friction';
  if (score >= 55) return 'Moderate friction';
  return 'High friction';
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
    const color = g.color || (g.pl > 0 ? 'pos' : g.pl < 0 ? 'neg' : 'neutral');
    const subParts = [
      `${g.n} trade${g.n === 1 ? '' : 's'}`,
      `${g.winRate}%W`,
      `${alphaR(g.avgR)} avg`,
    ];
    if (opts.showTargetRate && g.targetRate !== null) subParts.push(`${g.targetRate}% target`);
    if (g.extraSub) subParts.push(g.extraSub);
    return `
      <div class="bar-row">
        <div class="bar-row-label">${alphaEsc(g.label)}<span class="bar-row-sub">${alphaEsc(subParts.join(' · '))}</span></div>
        <div class="bar-wrap"><div class="bar-fill ${color}" style="width:${Math.max(4, Math.abs(g.pl) / maxAbs * 100).toFixed(0)}%"></div></div>
        <div class="bar-value ${g.pl >= 0 ? 'pl-positive' : 'pl-negative'}">${alphaMoney(g.pl)}</div>
      </div>`;
  }).join('');
}

function alphaSection(title, body) {
  return `<div class="alpha-edge-section"><div class="ai-section-title">${alphaEsc(title)}</div>${body}</div>`;
}

function buildAlphaHighlightBullets(closedWithPL) {
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

  const executionHtml = `
    ${alphaSection('Stock vs options edge', alphaRowsHtml(instrumentGroups, 'Log closed stock and option trades to compare which instrument is paying you.'))}
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
function buildAlphaIntel(closed, closedWithPL, wins, losses, expectancy, avgR, profitFactor, trades) {
  const n = closed.length;
  const helpBtn = '<button type="button" class="ai-help-btn" onclick="openAIGlossary()" title="What do these numbers mean?" aria-label="Open glossary">?</button>';

  // ── zero-data state ──────────────────────────────────────
  if (n === 0) {
    return `
      <div class="home-card ai-empty" style="margin-bottom: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div class="home-card-title" style="color:var(--cyan); margin: 0;">Alpha Intelligence${helpBtn}</div>
        </div>
        <div class="ai-empty-body">
          <div class="ai-empty-icon">⌁</div>
          <div class="ai-empty-msg"><strong>No closed trades yet.</strong> Log a few exits — wins or losses — and this card will surface your strongest pattern, biggest leak, and any stop-trading alerts.</div>
        </div>
      </div>`;
  }

  // ── shared computations ──────────────────────────────────
  const totalPL = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRate = Math.round(wins.length / n * 100);
  const avgWin  = wins.length  ? wins.reduce((s, x) => s + x.pl, 0)  / wins.length  : 0;
  const avgLoss = losses.length ? losses.reduce((s, x) => s + x.pl, 0) / losses.length : 0;

  // Setup-level aggregate
  const setupMap = {};
  closed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { name: k, n: 0, wins: 0, pl: 0, totalR: 0 };
    const pl = calcPL(t) || 0;
    setupMap[k].n++;
    if (pl > 0) setupMap[k].wins++;
    setupMap[k].pl += pl;
    setupMap[k].totalR += window.calcR(t) || 0;
  });
  const setups = Object.values(setupMap).sort((a, b) => b.pl - a.pl);
  const bestSetup  = setups[0] || null;
  const worstSetup = setups.length > 1 ? setups[setups.length - 1] : null;

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
  const killActive = rolling.pct <= -7;

  // Money-readable formatter — keeps strings short and consistent.
  const $ = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(Math.round(v)).toLocaleString()}`;

  // ── headline diagnostic ─────────────────────────────────
  let headline = '', headlineTone = 'good';

  if (n < 5) {
    headline = `Career: ${$(totalPL)} from ${n} closed trade${n === 1 ? '' : 's'} — patterns need ~10 to be reliable.`;
    headlineTone = 'info';
  } else if (killActive) {
    headline = `Last ${rolling.days} days down ${Math.abs(rolling.pct).toFixed(1)}% of account — kill switch active. Stop sizing up until P/L recovers.`;
    headlineTone = 'danger';
  } else if (gradeScore !== null && gradeScore < 60 && graded.length >= 5) {
    headline = `Only ${gradeScore}% of reviewed trades followed the plan. Process discipline is the priority — fix execution before adding size.`;
    headlineTone = 'warn';
  } else if (avgWin > 0 && avgLoss < 0 && Math.abs(avgLoss) > avgWin * 1.2) {
    headline = `Win rate ${winRate}% but losses run ${(Math.abs(avgLoss)/avgWin).toFixed(1)}× larger than wins. Tighten stops or cut faster.`;
    headlineTone = 'warn';
  } else if (discCount >= 3 && discPL < 0) {
    headline = `Discretionary / thesis-broke exits cost ${$(-Math.abs(discPL))} so far — main leak. Stick to target/stop, let winners run.`;
    headlineTone = 'warn';
  } else if (bestSetup && bestSetup.pl > 0) {
    const wr = Math.round(bestSetup.wins / bestSetup.n * 100);
    headline = `${bestSetup.name} is your edge: ${$(bestSetup.pl)} across ${bestSetup.n} trade${bestSetup.n === 1 ? '' : 's'} (${wr}% win rate). Lean into it.`;
    headlineTone = 'good';
  } else if (expectancy > 0 && avgR >= 0.5) {
    headline = `Positive edge: ${$(expectancy)} per trade, ${avgR.toFixed(2)}R average. Stay consistent.`;
    headlineTone = 'good';
  } else {
    headline = `Edge per trade: ${$(expectancy)} (${avgR.toFixed(2)}R). ${expectancy >= 0 ? 'Profitable — protect the process.' : 'Negative — review setup selection and sizing.'}`;
    headlineTone = expectancy >= 0 ? 'good' : 'warn';
  }

  // ── bullets — career-focused, plain English, max 5 ───────
  const bullets = [];

  // 1. Career line — the headline number, plus the metrics in one breath.
  bullets.push({
    tone: totalPL >= 0 ? 'good' : 'bad',
    icon: '📈',
    text: `<strong>Career: ${$(totalPL)}</strong> across ${n} trade${n === 1 ? '' : 's'} · ${winRate}% wins · avg ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}× your risk per trade · profit factor ${profitFactor}.`,
  });

  // 2. Best vs worst setup — only if we have ≥5 trades and they differ.
  if (bestSetup && worstSetup && bestSetup.name !== worstSetup.name && n >= 5) {
    bullets.push({
      tone: bestSetup.pl >= 0 ? 'good' : 'warn',
      icon: '🎯',
      text: `Best pattern <strong>${bestSetup.name}</strong> (${$(bestSetup.pl)}) · weakest <strong style="color:var(--red-bright)">${worstSetup.name}</strong> (${$(worstSetup.pl)}). Size up the best, drop the worst.`,
    });
  } else if (n < 5) {
    bullets.push({
      tone: 'info', icon: '📋',
      text: `Setup-level breakdown unlocks at <strong>≥ 5 closed trades</strong>. Keep logging.`,
    });
  }

  buildAlphaHighlightBullets(closedWithPL).slice(0, 2).forEach(b => bullets.push(b));

  // 3. Process quality vs leak — pick the strongest signal.
  if (discCount >= 3 && discPL < 0) {
    bullets.push({
      tone: 'warn', icon: '🚪',
      text: `Early exits (gut call or thesis-broke) cost <strong>${$(-Math.abs(discPL))}</strong> across ${discCount} trade${discCount === 1 ? '' : 's'}. Letting them run more often would change the curve.`,
    });
  } else if (gradeScore !== null && graded.length >= 5) {
    const tone = gradeScore >= 80 ? 'good' : gradeScore >= 60 ? 'neutral' : 'bad';
    const verdict = gradeScore >= 80 ? 'execution is doing the work.'
                  : gradeScore >= 60 ? 'some drift — review Okay/Bad trades.'
                                     : 'execution quality is the next thing to fix.';
    bullets.push({ tone, icon: '📋', text: `<strong>${gradeScore}% of reviewed trades followed the plan</strong> — ${verdict}` });
  } else if (graded.length < 3 && n >= 5) {
    bullets.push({
      tone: 'info', icon: '📋',
      text: `<strong>${n - graded.length} trade${n - graded.length === 1 ? '' : 's'} ungraded.</strong> Mark them Good / Okay / Bad after each exit so stats can separate process from outcome.`,
    });
  }

  // 4. Recent-window bullet — small overlap with Home so a regression shows here too.
  if (rolling.count >= 3) {
    const tone = rolling.pct <= -7 ? 'bad' : rolling.pct < 0 ? 'warn' : 'good';
    const verdict = rolling.pct <= -7 ? 'kill switch active'
                  : rolling.pct < 0   ? 'in drawdown'
                                      : 'in form';
    bullets.push({
      tone, icon: '⏱',
      text: `Last ${rolling.days} days: <strong>${$(rolling.totalPL)}</strong> over ${rolling.count} closed (${rolling.pct >= 0 ? '+' : ''}${rolling.pct.toFixed(1)}% of account · ${rolling.winRate}% wins) — ${verdict}.`,
    });
  }

  // 5. Risk: avg win vs avg loss size, only if asymmetric.
  if (wins.length && losses.length && avgWin > 0 && avgLoss < 0 && Math.abs(avgLoss) > avgWin * 1.2) {
    bullets.push({
      tone: 'warn', icon: '⚖',
      text: `Avg win ${$(avgWin)} vs avg loss ${$(avgLoss)} — losses ${(Math.abs(avgLoss)/avgWin).toFixed(1)}× wider. Move stops in or cut sooner on broken setups.`,
    });
  }

  // ── kill-switch panel (only when active) ────────────────
  const ksHtml = killActive ? `
    <div class="ai-killswitch">
      <div class="ai-section-title">⚡ Kill switch active</div>
      <div class="alpha-intel-line danger"><span>Last ${rolling.days} days: ${$(rolling.totalPL)} (${rolling.pct.toFixed(1)}% of account) — past the -7% stop-trading line.</span></div>
      <div class="alpha-intel-line warn"><span>Pause new trades until P/L recovers. Window is editable in Settings → Alpha Intelligence.</span></div>
    </div>` : '';

  // ── assemble ─────────────────────────────────────────────
  let hlClass = '';
  if (headlineTone === 'warn') hlClass = 'neutral';
  if (headlineTone === 'danger' || headlineTone === 'bad') hlClass = 'risk-off';

  // Kicker mirrors Home's "Today's read" pattern — gives the card a clear
  // long-term identity and surfaces dataset size at a glance.
  const kickerText = `Career view · ${n} closed${graded.length ? ` · ${graded.length} graded` : ''}`;

  return `
    <div class="home-card green" style="margin-bottom: 0;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
        <div class="home-card-title" style="color:#7ee787; margin: 0; display: inline-flex; align-items: center;">Alpha Intelligence${helpBtn}</div>
        <div class="home-card-kicker" style="margin: 0;">${kickerText}</div>
      </div>
      <div class="home-intel-headline ${hlClass}">${headline}</div>
      <ul class="home-intel-points">
        ${bullets.slice(0, 6).map(b => `<li class="tone-${b.tone}"><span class="intel-icon">${b.icon}</span><span>${b.text}</span></li>`).join('')}
      </ul>
      ${ksHtml}
    </div>`;
}

function renderLogStats() {
  const container = document.getElementById('log-stats');
  const help = text => `<span class="stat-help" title="${text}">?</span>`;
  const filter = state.logModeFilter || 'all';
  const setupFilter = state.logSetupFilter || '';
  const modeTrades = filter === 'all' ? state.trades : state.trades.filter(t => (t.mode || 'swing') === filter);
  const trades = setupFilter ? modeTrades.filter(t => (t.setup || '—') === setupFilter) : modeTrades;
  const open   = trades.filter(t => t.status === 'open');
  const closed = trades.filter(t => isClosedTrade(t));
  const closedWithPL = closed.map(t => ({ trade: t, pl: calcPL(t) || 0, r: window.calcR(t) || 0 }));
  const wins   = closedWithPL.filter(x => x.pl > 0);
  const losses = closedWithPL.filter(x => x.pl < 0);

  // Core P/L
  const totalPL    = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRateNum = closed.length > 0 ? wins.length / closed.length * 100 : null;
  const winRateStr = winRateNum !== null ? winRateNum.toFixed(0) + '%' : '—';
  const avgWin     = wins.length   ? wins.reduce((s, x) => s + x.pl, 0)   / wins.length   : 0;
  const avgLoss    = losses.length ? losses.reduce((s, x) => s + x.pl, 0) / losses.length : 0;
  const grossWin   = wins.reduce((s, x) => s + x.pl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, x) => s + x.pl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? '∞' : '—');
  const expectancy = closed.length > 0 ? totalPL / closed.length : 0;
  const avgR = closedWithPL.length ? closedWithPL.reduce((s, x) => s + x.r, 0) / closedWithPL.length : 0;

  // NEW: open exposure
  const settings = state.settings || {};
  const openRisk = open.reduce((s, t) => {
    const fallback = window.tradeRiskDollars(t);
    return s + (Number(t.riskDollars) || fallback || 0);
  }, 0);

  // NEW: R expectancy per trade = winRate × avgWin_R + lossRate × avgLoss_R
  const avgWinR  = wins.length   ? wins.reduce((s, x) => s + x.r, 0)   / wins.length   : 0;
  const avgLossR = losses.length ? losses.reduce((s, x) => s + x.r, 0) / losses.length : 0;
  const rExpectancy = winRateNum !== null
    ? (winRateNum / 100) * avgWinR + (1 - winRateNum / 100) * avgLossR
    : null;

  // ── Metric strip ──────────────────────────────────────────
  const plTone    = totalPL >= 0 ? 'pos' : 'neg';
  const wrTone    = winRateNum === null ? 'neutral' : winRateNum >= 50 ? 'pos' : winRateNum >= 45 ? 'amber' : 'neg';
  const avgRTone  = closed.length ? (avgR >= 0.5 ? 'pos' : avgR >= 0 ? 'neutral' : 'neg') : 'neutral';

  const metricCells = [
    {
      label: 'Total P/L', tone: plTone,
      help: 'Realized profit or loss across closed trades in the current filter. Open trades are counted separately.',
      value: (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toFixed(0),
      sub: `${closed.length} closed · ${open.length} open`,
    },
    {
      label: 'Win Rate', tone: wrTone,
      help: 'Percentage of closed trades with positive P/L. It does not measure how large wins or losses are.',
      value: winRateStr,
      sub: winRateNum !== null ? `${wins.length}W · ${losses.length}L` : 'no closed trades',
    },
    {
      label: 'Avg R / Trade', tone: avgRTone,
      help: 'Average result measured in units of risk. +1R means the trade made one times the planned risk.',
      value: closed.length ? (avgR >= 0 ? '+' : '') + avgR.toFixed(2) + 'R' : '—',
      sub: rExpectancy !== null ? `R exp: ${rExpectancy >= 0 ? '+' : ''}${rExpectancy.toFixed(2)}R` : '',
    },
    {
      label: 'Profit Factor', tone: 'cyan',
      help: 'Gross wins divided by gross losses. Above 1.00 means wins are larger than losses overall.',
      value: profitFactor,
      sub: grossLoss > 0 ? `$${grossWin.toFixed(0)} gross win` : '',
    },
    {
      label: 'Expectancy', tone: expectancy >= 0 ? 'pos' : 'neg',
      help: 'Average dollars made or lost per closed trade.',
      value: (expectancy >= 0 ? '+$' : '-$') + Math.abs(expectancy).toFixed(0),
      sub: 'per closed trade',
    },
    {
      label: 'Open Exposure', tone: openRisk > 0 ? 'amber' : 'neutral',
      help: 'Estimated dollars currently at risk in open positions.',
      value: open.length > 0 ? '$' + openRisk.toFixed(0) : '$0',
      sub: open.length > 0 ? `${open.length} position${open.length === 1 ? '' : 's'}` : 'no open positions',
    },
  ];

  const smsCells = metricCells.map(c => `
    <div class="sms-cell ${c.tone || 'neutral'}">
      <div class="sms-label">${c.label}${c.help ? help(c.help) : ''}</div>
      <div class="sms-value">${c.value}</div>
      ${c.extra ? c.extra : ''}
      ${c.sub ? `<div class="sms-sub">${c.sub}</div>` : ''}
    </div>`).join('');

  // ── Exit discipline panel ──────────────────────────────────
  const exitDefs = [
    { key: 'target',       label: 'Hit target',      color: 'pos' },
    { key: 'stop',         label: 'Stopped out',     color: 'neg' },
    { key: 'thesis-broke', label: 'Thesis broke',    color: 'amber' },
    { key: 'discretionary',label: 'Discretionary',   color: 'amber' },
    { key: 'time',         label: 'Time exit',       color: 'neutral' },
  ];
  const exitRows = exitDefs.map(d => {
    const group = closed.filter(t => t.exit_reason === d.key);
    if (!group.length) return null;
    const pl = group.reduce((s, t) => s + (calcPL(t) || 0), 0);
    const pct = Math.round(group.length / closed.length * 100);
    return { label: d.label, n: group.length, pct, pl, color: d.color };
  }).filter(Boolean);
  const maxExitPL = Math.max(...exitRows.map(r => Math.abs(r.pl)), 1);
  const exitHtml = exitRows.length ? exitRows.map(r => `
    <div class="bar-row">
      <div class="bar-row-label">${r.label}<span class="bar-row-sub">${r.n} trades · ${r.pct}%</span></div>
      <div class="bar-wrap"><div class="bar-fill ${r.color}" style="width:${Math.max(4, Math.abs(r.pl) / maxExitPL * 100).toFixed(0)}%"></div></div>
      <div class="bar-value ${r.pl >= 0 ? 'pl-positive' : 'pl-negative'}">${r.pl >= 0 ? '+$' : '-$'}${Math.abs(r.pl).toFixed(0)}</div>
    </div>`).join('')
    : `<div style="color:var(--ink-4);font-size:12px;padding:8px 0;">Exit reasons will appear once you close trades with a reason logged.</div>`;

  // ── Setup performance panel ────────────────────────────────
  const setupMap = {};
  const setupSourceClosed = modeTrades.filter(t => isClosedTrade(t));
  setupSourceClosed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { n: 0, wins: 0, pl: 0, totalR: 0 };
    const pl = calcPL(t) || 0;
    setupMap[k].n++;
    if (pl > 0) setupMap[k].wins++;
    setupMap[k].pl += pl;
    setupMap[k].totalR += window.calcR(t) || 0;
  });
  const setups = Object.entries(setupMap).sort((a, b) => b[1].pl - a[1].pl);
  const maxSetupPL = Math.max(...setups.map(([, s]) => Math.abs(s.pl)), 1);
  const setupHtml = setups.length ? setups.map(([name, s]) => {
    const wr  = Math.round(s.wins / s.n * 100);
    const avgRv = s.totalR / s.n;
    const isActive = setupFilter === name;
    const encodedName = encodeURIComponent(name).replace(/'/g, '%27');
    return `
      <button class="bar-row setup-filter-row ${isActive ? 'active' : ''}" type="button" onclick="setLogSetupFilter(decodeURIComponent('${encodedName}'))">
        <div class="bar-row-label">${name}<span class="bar-row-sub">${s.n}× · ${wr}%W · ${avgRv >= 0 ? '+' : ''}${avgRv.toFixed(2)}R avg</span></div>
        <div class="bar-wrap"><div class="bar-fill ${s.pl >= 0 ? 'pos' : 'neg'}" style="width:${Math.max(4, Math.abs(s.pl) / maxSetupPL * 100).toFixed(0)}%"></div></div>
        <div class="bar-value ${s.pl >= 0 ? 'pl-positive' : 'pl-negative'}">${s.pl >= 0 ? '+$' : '-$'}${Math.abs(s.pl).toFixed(0)}</div>
      </button>`;
  }).join('')
    : `<div style="color:var(--ink-4);font-size:12px;padding:8px 0;">Setup breakdown appears after your first closed trade.</div>`;

  // ── Assemble ──────────────────────────────────────────────
  const modeLabel = filter === 'all' ? 'All trades' : filter === 'swing' ? 'Swing only' : 'Intraday only';
  const filterLabel = setupFilter ? `${modeLabel} · ${setupFilter}` : modeLabel;
  const clearSetupHtml = setupFilter
    ? `<button class="stats-filter-clear" type="button" onclick="clearLogSetupFilter()">Clear setup</button>`
    : '';
  // ── CLT (Mean Convergence) panel ───────────────────────────
  const cltHtml = window.buildCltCard(closedWithPL, help);

  // ── TOS Backtest import panel ──────────────────────────────
  const backtestHtml = window.buildBacktestCard(help);

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
      ${buildAlphaIntel(closed, closedWithPL, wins, losses, expectancy, avgR, profitFactor, trades)}

      <div class="home-card">
        <div class="stats-snapshot-head">
          <div class="home-card-title" style="margin: 0;">Stats Snapshot${help('Six core indicators for the selected trade set. Use these for the fastest read on performance and risk.')}</div>
          <div class="stats-snapshot-meta">${filterLabel} · ${trades.length} total · ${closed.length} closed · ${open.length} open${clearSetupHtml}</div>
        </div>
        <div class="sms-grid" style="border-bottom: none;">${smsCells}</div>
      </div>

      ${buildAlphaEdgeCard(closedWithPL, help)}

      ${cltHtml}

      <div class="home-row stats-card-row">
        <div class="home-card">
          <div class="home-card-title">Setup Performance${help('Shows which setups are producing or losing money, including win rate and average R by setup.')}</div>
          ${setupHtml}
        </div>
        <div class="home-card">
          <div class="home-card-title">Exit Discipline${help('Shows where exits are happening and how much P/L each exit reason contributes.')}</div>
          ${exitHtml}
        </div>
      </div>

      ${backtestHtml}
    </div>
  `;
}

// Bridge to legacy.js.
window.alphaEsc = alphaEsc;
window.alphaMoney = alphaMoney;
window.alphaR = alphaR;
window.alphaDirectionKey = alphaDirectionKey;
window.alphaIntradaySetupDef = alphaIntradaySetupDef;
window.alphaSetupBias = alphaSetupBias;
window.alphaConfluenceBias = alphaConfluenceBias;
window.alphaBreadthBias = alphaBreadthBias;
window.alphaContextAlignment = alphaContextAlignment;
window.alphaSpreadValue = alphaSpreadValue;
window.alphaSpreadBucket = alphaSpreadBucket;
window.alphaFillQuality = alphaFillQuality;
window.alphaTimeBucket = alphaTimeBucket;
window.alphaOrbDirectionBucket = alphaOrbDirectionBucket;
window.alphaOrbRangeBucket = alphaOrbRangeBucket;
window.alphaVwapBucket = alphaVwapBucket;
window.alphaFrictionScore = alphaFrictionScore;
window.alphaFrictionBucket = alphaFrictionBucket;
window.alphaSummarizeRows = alphaSummarizeRows;
window.alphaGroupClosedRows = alphaGroupClosedRows;
window.alphaRowsHtml = alphaRowsHtml;
window.alphaSection = alphaSection;
window.buildAlphaHighlightBullets = buildAlphaHighlightBullets;
window.buildAlphaEdgeCard = buildAlphaEdgeCard;
window.buildAlphaIntel = buildAlphaIntel;
// renderLogStats was inadvertently captured by the alpha extraction; will move to
// src/views/log.js in Phase 8. Exposed on window so legacy.js callers keep working.
window.renderLogStats = renderLogStats;
