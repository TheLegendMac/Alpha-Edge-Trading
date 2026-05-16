// Alpha Intel — performance + friction analytics that drive the home dashboard's
// 'alpha edge' card and the closed-trade summary breakdowns.

import { state } from '../state/store.js';
import {
  isClosedTrade,
  calcPL,
  tradeInstrument,
  normalizeProcessQuality,
} from '../models/trade.js';
import { computeRollingPL } from './rolling.js';
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
function buildAlphaIntel(closed, closedWithPL, wins, losses, expectancy, avgR, profitFactor, trades) {
  const n = closed.length;
  const helpBtn = '<button type="button" class="ai-help-btn" title="What do these numbers mean?" aria-label="Open glossary">?</button>';

  // ── zero-data state ──────────────────────────────────────
  if (n === 0) {
    return `
      <div class="home-card ai-empty" style="margin-bottom: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div class="home-card-title" style="color:#7ee787; margin: 0;">Edge Intelligence${helpBtn}</div>
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
      text: `Setup-level breakdown unlocks at <strong>more than 5 closed trades</strong>. Keep logging.`,
    });
  }

  buildAlphaHighlightBullets(closedWithPL).slice(0, 2).forEach(b => bullets.push(b));

  // 3. Process quality vs leak — pick the strongest signal.
  if (discCount >= 3 && discPL < 0) {
    bullets.push({
      tone: 'warn', icon: '🚪',
      text: `Early exits (gut call or thesis-broke) total cost <strong>${$(-Math.abs(discPL))}</strong> across ${discCount} trade${discCount === 1 ? '' : 's'}. Letting them run more often would change the curve.`,
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
      <div class="alpha-intel-line warn"><span>Pause new trades until P/L recovers. Window is editable in Settings → Edge Intelligence.</span></div>
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
        <div class="home-card-title" style="color:#7ee787; margin: 0; display: inline-flex; align-items: center;">Edge Intelligence${helpBtn}</div>
        <div class="home-card-kicker" style="margin: 0;">${kickerText}</div>
      </div>
      <div class="home-intel-headline ${hlClass}">${headline}</div>
      <ul class="home-intel-points">
        ${bullets.slice(0, 6).map(b => `<li class="tone-${b.tone}"><span class="intel-icon">${b.icon}</span><span>${b.text}</span></li>`).join('')}
      </ul>
      ${ksHtml}
    </div>`;
}

// ──────────────────────────────────────────────────────────
//  buildTradeFlowEdgeIntel — Edge Intel sized for the final trade step.
//  Surfaces 3-4 bullets relevant to the trade about to be logged:
//  setup history, friction warnings, regime/budget reminders. Renders
//  with the same visual language as the home Edge Intel card so the user
//  reads it the same way no matter where they see it.
// ──────────────────────────────────────────────────────────
function buildTradeFlowEdgeIntel({ mode, setup, direction, instrument, inModal = false } = {}) {
  const helpBtn = inModal ? '' : '<button type="button" class="ai-help-btn" title="What do these numbers mean?" aria-label="Open glossary">?</button>';
  const closed = (state.trades || []).filter(t => isClosedTrade(t));
  const closedWithPL = closed.map(t => ({ trade: t, pl: calcPL(t) || 0, r: window.calcR(t) || 0 }));
  const $ = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(Math.round(v)).toLocaleString()}`;
  const dirKey = (direction || '').toString().toLowerCase().startsWith('s') ? 'short' : 'long';

  const bullets = [];

  // Friendly setup name — fall back to whatever was stored.
  const setupDef = (typeof window.tfFindIntradaySetup === 'function' && mode === 'intraday') ? window.tfFindIntradaySetup(setup) : null;
  const swingSetupDef = (mode === 'swing' && Array.isArray(window.TRADE_SWING_SETUPS))
    ? window.TRADE_SWING_SETUPS.find(s => s.id === setup)
    : null;
  const setupLabel = setupDef ? setupDef.name : (swingSetupDef ? (swingSetupDef.name || swingSetupDef.id) : (setup || 'this setup'));
  const dirWord = dirKey === 'short' ? 'short' : 'long';

  // Reward vs. risk.
  const ticket = mode === 'intraday' ? (state.intraday || {}) : null;
  const entry  = ticket ? Number(ticket.entry)  : Number(state.premium);
  const stop   = ticket ? Number(ticket.stop)   : Number(state.swingStop);
  const target = ticket ? Number(ticket.target) : Number(state.swingTarget);
  if (entry > 0 && stop > 0 && target > 0) {
    const rr = Math.abs((target - entry) / (entry - stop));
    if (isFinite(rr)) {
      if (rr >= 2) {
        bullets.push({ tone: 'good', icon: '🎯', text: `<strong>Good payoff:</strong> you could win about $${rr.toFixed(1)} for every $1 you risk.` });
      } else if (rr >= 1.5) {
        bullets.push({ tone: 'info', icon: '🎯', text: `<strong>Okay payoff:</strong> winning about $${rr.toFixed(1)} per $1 risked. Tight — only take it if you're confident.` });
      } else {
        bullets.push({ tone: 'bad', icon: '🎯', text: `<strong>Skinny payoff:</strong> only $${rr.toFixed(1)} reward per $1 risked. Most pros pass on this.` });
      }
    }
  }

  // How much of the account is on the line.
  if (mode === 'intraday') {
    const auto = (typeof window.tfComputeIntradayRiskSize === 'function') ? window.tfComputeIntradayRiskSize() : null;
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
        bullets.push({ tone: 'bad', icon: '💰', text: `<strong>Too much on the line:</strong> $${Math.round(riskDollars).toLocaleString()} is ${pct.toFixed(1)}% of your account — bigger than your usual trade. Cut the size.` });
      } else if (pct > 1) {
        bullets.push({ tone: 'warn', icon: '💰', text: `<strong>Heavy size:</strong> $${Math.round(riskDollars).toLocaleString()} (${pct.toFixed(1)}% of account). At the top of your normal range.` });
      } else {
        bullets.push({ tone: 'good', icon: '💰', text: `<strong>Risk in check:</strong> $${Math.round(riskDollars).toLocaleString()} on the line — ${pct.toFixed(1)}% of your account, well within your rules.` });
      }
    } else if (qty > 0) {
      bullets.push({ tone: 'neutral', icon: '💰', text: `<strong>${qty} ${isOptions ? 'contract' : 'share'}${qty > 1 ? 's' : ''} planned.</strong> Add an account size in Settings to see how much you're really risking.` });
    }
  }

  // Does the rest of the picture agree with the direction.
  if (mode === 'intraday') {
    const it = state.intraday || {};
    if (it.confluence || it.breadth) {
      const conflictConf = (dirKey === 'long' && it.confluence === 'short-bias') || (dirKey === 'short' && it.confluence === 'long-bias');
      const conflictBr   = (dirKey === 'long' && it.breadth === 'down')          || (dirKey === 'short' && it.breadth === 'up');
      if (conflictConf || conflictBr) {
        bullets.push({ tone: 'bad', icon: '⚠️', text: `<strong>You're fighting the tape:</strong> the market is pointing the other way. Flip the direction or skip the trade.` });
      } else {
        const aligned = [
          it.confluence && ((dirKey === 'long' && it.confluence === 'long-bias') || (dirKey === 'short' && it.confluence === 'short-bias')),
          it.breadth && ((dirKey === 'long' && it.breadth === 'up') || (dirKey === 'short' && it.breadth === 'down')),
        ].filter(Boolean).length;
        if (aligned > 0) {
          bullets.push({ tone: 'good', icon: '✅', text: `<strong>The tape agrees with you:</strong> the broader market is leaning ${dirWord} too. Good backdrop.` });
        }
      }
    } else {
      bullets.push({ tone: 'neutral', icon: '◌', text: `<strong>No market context tagged.</strong> Add confluence or breadth next time — it makes these reads sharper later.` });
    }
  }

  // What history says about this exact play.
  if (setup) {
    const peers = closedWithPL.filter(x => {
      const t = x.trade;
      const tDir = (t.direction || '').toString().toLowerCase().startsWith('s') ? 'short' : 'long';
      return (t.setup === setup) && (tDir === dirKey);
    });
    if (peers.length >= 2) {
      const wins = peers.filter(x => x.pl > 0).length;
      const wr = Math.round(wins / peers.length * 100);
      const avgR = peers.reduce((s, x) => s + x.r, 0) / peers.length;
      const totalPL = peers.reduce((s, x) => s + x.pl, 0);
      const totalSign = totalPL >= 0 ? '+' : '−';
      const totalAbs = `$${Math.abs(Math.round(totalPL)).toLocaleString()}`;
      if (avgR >= 0.4) {
        bullets.push({ tone: 'good', icon: '📈', text: `<strong>This setup has been good to you:</strong> ${peers.length} past trades, you won ${wr}% of them, ${totalSign}${totalAbs} total. Looks like a real edge.` });
      } else if (avgR >= 0) {
        bullets.push({ tone: 'info', icon: '📊', text: `<strong>Mixed history:</strong> ${peers.length} past trades, ${wr}% wins, roughly break-even (${totalSign}${totalAbs}). No strong edge yet — trade carefully.` });
      } else {
        bullets.push({ tone: 'bad', icon: '📉', text: `<strong>This setup has been losing money:</strong> ${peers.length} past trades, only ${wr}% wins, ${totalSign}${totalAbs} total. Maybe skip until you find what's missing.` });
      }
    } else if (peers.length === 1) {
      bullets.push({ tone: 'neutral', icon: '📊', text: `<strong>Only one ${setupLabel} ${dirWord} trade so far.</strong> Not enough history to call it. Ask whether today's chart still matches the playbook.` });
    } else {
      bullets.push({ tone: 'neutral', icon: '📊', text: `<strong>First time trading ${setupLabel} ${dirWord}.</strong> No track record yet. Ask, don't assume: does the setup still meet every rule?` });
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
        tone: totalPL >= 0 ? 'good' : 'bad', icon: '📚',
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
      tone: 'bad', icon: '🛑',
      text: `<strong>The market is in risk-off mode and you're buying.</strong> You're swimming upstream — cut the size in half or wait it out.`,
    });
  } else if (regime === 'neutral') {
    bullets.push({
      tone: 'warn', icon: '⚖️',
      text: `<strong>Choppy market — go half size.</strong> Both directions are tricky right now; only take rock-solid setups.`,
    });
  } else if (state.selectedSetup === 'Edge Reversal' && mode === 'swing') {
    bullets.push({
      tone: 'warn', icon: '⚠️',
      text: `<strong>Edge Reversal trades fail more often.</strong> Use half your usual size — that's the rule for catching turns.`,
    });
  }

  // Recent drawdown / kill switch.
  const rolling = computeRollingPL();
  if (rolling.pct <= -7) {
    bullets.push({
      tone: 'bad', icon: '⚡',
      text: `<strong>Cool-off time.</strong> You're down ${Math.abs(rolling.pct).toFixed(1)}% over the last ${rolling.days} days — step away until things turn around.`,
    });
  } else if (rolling.pct <= -4 && rolling.count > 0) {
    bullets.push({
      tone: 'warn', icon: '⏱',
      text: `<strong>You've been losing lately</strong> (down ${Math.abs(rolling.pct).toFixed(1)}% over ${rolling.days} days). Tighten things up before you hit the ${'-'}7% pause line.`,
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
          tone: spread > max ? 'bad' : 'warn', icon: '💧',
          text: spread > max
            ? `<strong>Spread is too wide</strong> (${spread.toFixed(1)}%). You'd lose a big chunk just getting in and out — pass on this one.`
            : `<strong>Wide spread</strong> (${spread.toFixed(1)}%). It'll eat into the move — need a bigger run than usual to come out ahead.`,
        });
      }
    }
    if (typeof window.tfComputeIntradayDayPL === 'function') {
      const dayPL = window.tfComputeIntradayDayPL();
      const cap = settings.intradayMaxDailyLoss || 200;
      const remaining = cap + dayPL;
      if (remaining < cap * 0.4 && dayPL < 0) {
        bullets.push({
          tone: remaining <= 0 ? 'bad' : 'warn', icon: '🔒',
          text: remaining <= 0
            ? `<strong>You've hit your daily loss limit.</strong> Stop trading for today.`
            : `<strong>Only $${Math.round(remaining).toLocaleString()} left in your daily loss budget.</strong> One more loss and you're done for the day.`,
        });
      }
    }
  }

  // All clear.
  if (!bullets.length) {
    bullets.push({
      tone: 'info', icon: '✅',
      text: `No logged-data warning yet. Ask the chart for confirmation before you treat this as clean.`,
    });
  }

  // Worst tone across bullets sets the card's accent stripe.
  const toneRank = { bad: 4, warn: 3, info: 2, neutral: 1, good: 0 };
  const worst = bullets.reduce((acc, b) => (toneRank[b.tone] || 0) > (toneRank[acc] || 0) ? b.tone : acc, 'good');
  const accent = worst === 'bad' ? 'red' : worst === 'warn' ? 'amber' : worst === 'neutral' ? 'neutral' : worst === 'info' ? 'cyan' : 'green';
  const accentTitleColor = accent === 'red' ? '#ff8b8b' : accent === 'amber' ? '#ffd166' : accent === 'cyan' ? '#67e8f9' : accent === 'neutral' ? 'var(--ink-2)' : '#7ee787';
  const kicker = inModal ? 'Final read before GO' : 'Pre-trade read';
  const cardMargin = inModal ? 'margin: 14px 0 0;' : 'margin: 0;';

  // Render with the same Edge Intelligence card language used on Home / Stats.
  return `
    <div class="home-card ${accent} trade-edge-intel" style="${cardMargin}">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
        <div class="home-card-title" style="color:${accentTitleColor}; margin: 0; display: inline-flex; align-items: center;">Edge Intelligence${helpBtn}</div>
        <div class="home-card-kicker" style="margin: 0;">${kicker}</div>
      </div>
      <ul class="home-intel-points">
        ${bullets.slice(0, 5).map(b => `<li class="tone-${b.tone}"><span class="intel-icon">${b.icon}</span><span>${b.text}</span></li>`).join('')}
      </ul>
    </div>`;
}

function renderLogStats() {
  const container = document.getElementById('log-stats');
  if (!container) return;
  const help = text => `<span class="stat-help" title="${text}">?</span>`;
  const filter = state.logModeFilter || 'all';
  const setupFilter = state.logSetupFilter || '';
  const index = buildTradeIndex(state.trades || []);
  const modeTrades = filter === 'all' ? index.all : index.all.filter(t => (t.mode || 'swing') === filter);
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
  const grossWin   = wins.reduce((s, x) => s + x.pl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, x) => s + x.pl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? '∞' : '—');
  const expectancy = closed.length > 0 ? totalPL / closed.length : 0;
  const avgR = closedWithPL.length ? closedWithPL.reduce((s, x) => s + x.r, 0) / closedWithPL.length : 0;
  const avgHoldDays = (() => {
    const holds = closed.map(t => {
      const start = t.date ? new Date(`${t.date}T12:00:00`) : null;
      const end = (t.exit_date || t.date) ? new Date(`${t.exit_date || t.date}T12:00:00`) : null;
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      return Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
    }).filter(v => v !== null);
    return holds.length ? holds.reduce((s, v) => s + v, 0) / holds.length : 0;
  })();
  const riskToMakeOne = grossWin > 0 ? grossLoss / grossWin : 0;
  const biggestWin = wins.length ? Math.max(...wins.map(x => x.pl)) : 0;
  const biggestLoss = losses.length ? Math.min(...losses.map(x => x.pl)) : 0;

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

  // ── Mean Convergence (CLT) summary — sample mean R + 95% CI half-width.
  // Surfaced as a top-line metric per UX priority.
  let cltMean = null, cltCiHalf = null, cltSignificant = null;
  if (closedWithPL.length >= 2) {
    const rs = closedWithPL.map(x => x.r || 0);
    const m = rs.reduce((s, x) => s + x, 0) / rs.length;
    const variance = rs.length > 1 ? rs.reduce((s, x) => s + (x - m) * (x - m), 0) / (rs.length - 1) : 0;
    const sd = Math.sqrt(variance);
    const se = sd / Math.sqrt(rs.length);
    const half = 1.96 * se;
    cltMean = m;
    cltCiHalf = half;
    cltSignificant = (m - half) > 0 || (m + half) < 0;
  }
  const cltTone = cltMean === null ? 'neutral' : (cltSignificant ? (cltMean > 0 ? 'pos' : 'neg') : 'amber');
  const cltValue = cltMean === null
    ? '—'
    : `${cltMean >= 0 ? '+' : ''}${cltMean.toFixed(2)}R`;
  const cltSub = cltMean === null
    ? 'need 2+ trades'
    : `±${cltCiHalf.toFixed(2)}R · ${cltSignificant ? 'edge significant' : 'not yet significant'}`;

  // ── Metric strip ──────────────────────────────────────────
  // Priority order (per UX brief): Expectancy first, Mean Convergence second,
  // then Profit Factor, Win Rate, Avg R, Total P/L, R Expectancy, Open Risk.
  const plTone    = totalPL >= 0 ? 'pos' : 'neg';
  const wrTone    = winRateNum === null ? 'neutral' : winRateNum >= 50 ? 'pos' : winRateNum >= 45 ? 'amber' : 'neg';
  const avgRTone  = closed.length ? (avgR >= 0.5 ? 'pos' : avgR >= 0 ? 'neutral' : 'neg') : 'neutral';
  const rExpTone  = rExpectancy === null ? 'neutral' : rExpectancy >= 0.3 ? 'pos' : rExpectancy >= 0 ? 'neutral' : 'neg';

  const metricCells = [
    {
      label: 'Expectancy', tone: expectancy >= 0 ? 'pos' : 'neg',
      help: 'Average dollars made or lost per closed trade. Top-line edge metric — keep it positive.',
      value: closed.length ? (expectancy >= 0 ? '+$' : '-$') + Math.abs(expectancy).toFixed(0) : '$0',
      sub: closed.length ? 'per closed trade' : 'no closed trades',
    },
    {
      label: 'Mean Convergence', tone: cltTone,
      help: 'Sample mean R-multiple with a 95% confidence band. Narrow band + non-zero mean = a real edge. Wide band = need more sample.',
      value: cltValue,
      sub: cltSub,
    },
    {
      label: 'Profit Factor', tone: 'cyan',
      help: 'Gross wins divided by gross losses. Above 1.00 means wins are larger than losses overall.',
      value: profitFactor,
      sub: grossLoss > 0 ? `$${grossWin.toFixed(0)} gross win` : (grossWin > 0 ? 'no losses yet' : ''),
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
      sub: closed.length ? `${closed.length} closed` : '',
    },
    {
      label: 'Total P/L', tone: plTone,
      help: 'Realized profit or loss across closed trades in the current filter. Open trades are counted separately.',
      value: (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toFixed(0),
      sub: `${closed.length} closed · ${open.length} open`,
    },
    {
      label: 'R Expectancy', tone: rExpTone,
      help: 'Probability-weighted R per trade. Stable across position-size changes — the cleanest read on edge.',
      value: rExpectancy === null ? '—' : `${rExpectancy >= 0 ? '+' : ''}${rExpectancy.toFixed(2)}R`,
      sub: rExpectancy === null ? 'need closed trades' : 'per trade',
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

  const modeLabel = filter === 'all' ? 'All trades' : filter === 'swing' ? 'Swing only' : 'Intraday only';
  const filterLabel = setupFilter ? `${modeLabel} · ${setupFilter}` : modeLabel;
  const legacyCards = [
    {
      label: 'Win Rate',
      cls: winRateNum !== null && winRateNum >= 50 ? 'pos' : 'amber',
      value: winRateNum !== null ? `${winRateNum.toFixed(2)}%` : '0.00%',
      detail: winRateNum !== null ? `${wins.length}W / ${losses.length}L` : 'No closed trades',
    },
    {
      label: 'Profit Factor',
      cls: 'cyan',
      value: profitFactor,
      detail: grossLoss > 0 ? `$${grossWin.toFixed(0)} wins / $${grossLoss.toFixed(0)} losses` : (grossWin > 0 ? 'No losses yet' : 'No closed P/L'),
    },
    {
      label: 'Avg Hold',
      cls: 'neutral',
      value: avgHoldDays.toFixed(1),
      detail: 'days',
    },
    {
      label: 'Trades',
      cls: 'neutral',
      value: String(trades.length),
      detail: `${closed.length} closed / ${open.length} open`,
    },
    {
      label: 'Risk $1 To Make',
      cls: 'gold',
      value: `$${riskToMakeOne.toFixed(2)}`,
      detail: 'gross loss per $1 gross win',
    },
    {
      label: 'Biggest Win',
      cls: 'pos',
      value: `+$${Math.abs(biggestWin).toFixed(2)}`,
      detail: wins.length ? 'best closed trade' : 'No winning trade yet',
    },
    {
      label: 'Biggest Loss',
      cls: 'neg',
      value: `-$${Math.abs(biggestLoss).toFixed(2)}`,
      detail: losses.length ? 'largest closed loss' : 'No losing trade yet',
    },
  ];
  const legacyStatsHtml = `
    <section class="legacy-stat-panel" aria-label="At-a-glance stats">
      <div class="legacy-stat-head">
        <div>
          <div class="legacy-stat-title">At-a-Glance</div>
          <div class="legacy-stat-meta">${filterLabel} · ${trades.length} total · ${closed.length} closed</div>
        </div>
        <button type="button" class="legacy-stat-export" onclick="exportCSV()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12"/>
            <path d="m7 10 5 5 5-5"/>
            <path d="M5 21h14"/>
          </svg>
          <span>Export CSV</span>
        </button>
      </div>
      <div class="legacy-stat-grid">
        ${legacyCards.map(c => `
          <div class="legacy-stat-card ${c.cls}">
            <div class="legacy-stat-label">${c.label}</div>
            <div class="legacy-stat-value">${c.value}</div>
            <div class="legacy-stat-detail">${c.detail}</div>
          </div>
        `).join('')}
      </div>
    </section>`;

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
    return `
      <button class="bar-row setup-filter-row ${isActive ? 'active' : ''}" type="button" data-setup-filter="${alphaEsc(name)}">
        <div class="bar-row-label">${alphaEsc(name)}<span class="bar-row-sub">${s.n}× · ${wr}%W · ${avgRv >= 0 ? '+' : ''}${avgRv.toFixed(2)}R avg</span></div>
        <div class="bar-wrap"><div class="bar-fill ${s.pl >= 0 ? 'pos' : 'neg'}" style="width:${Math.max(4, Math.abs(s.pl) / maxSetupPL * 100).toFixed(0)}%"></div></div>
        <div class="bar-value ${s.pl >= 0 ? 'pl-positive' : 'pl-negative'}">${s.pl >= 0 ? '+$' : '-$'}${Math.abs(s.pl).toFixed(0)}</div>
      </button>`;
  }).join('')
    : `<div style="color:var(--ink-4);font-size:12px;padding:8px 0;">Setup breakdown appears after your first closed trade.</div>`;

  // ── Grade quality (Process stat) ──────────────────────────
  const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  closed.forEach(t => { const g = (t.grade || '').toUpperCase(); if (gradeCounts[g] !== undefined) gradeCounts[g]++; });
  const totalGraded = gradeCounts.A + gradeCounts.B + gradeCounts.C + gradeCounts.D;
  const aPct = totalGraded ? Math.round(gradeCounts.A / totalGraded * 100) : null;
  const processValue = aPct !== null ? `A · ${aPct}%` : '—';
  const processSubParts = [gradeCounts.A && `${gradeCounts.A}A`, gradeCounts.B && `${gradeCounts.B}B`, gradeCounts.C && `${gradeCounts.C}C`].filter(Boolean);
  const processSub = processSubParts.length ? processSubParts.join(' · ') : 'no graded trades';

  // ── Avg win / avg loss in R ────────────────────────────────
  const avgWinRStr  = wins.length   ? `${avgWinR  >= 0 ? '+' : ''}${avgWinR.toFixed(2)}R`  : '—';
  const avgLossRStr = losses.length ? `${avgLossR >= 0 ? '+' : ''}${avgLossR.toFixed(2)}R` : '—';

  // ── Hero heading ───────────────────────────────────────────
  const totalPLStr = (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const heroModeLabel = (state.logModeFilter || 'all') === 'all' ? 'ALL' : (state.logModeFilter || '').toUpperCase();
  const heroPeriodLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();

  // ── 5-card stat strip ─────────────────────────────────────
  const fiveCards = [
    { label: 'Net P/L',  value: totalPLStr, sub: `${closed.length} closed · ${open.length} open`, cls: totalPL >= 0 ? 'pos' : 'neg' },
    { label: 'Win rate', value: winRateStr, sub: `${wins.length}W / ${losses.length}L closed`, cls: winRateNum !== null && winRateNum >= 50 ? '' : '' },
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
          TRADE LOG · ${heroPeriodLabel}${setupFilter ? ' · ' + alphaEsc(setupFilter) : ''}
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

  if (container.dataset.setupFilterWired !== '1') {
    container.dataset.setupFilterWired = '1';
    container.addEventListener('click', e => {
      const row = e.target.closest('[data-setup-filter]');
      if (!row) return;
      setLogSetupFilter(row.dataset.setupFilter);
    });
  }
}

// Expose computed stats for the Stats tab to consume.
function buildLogStatsData() {
  const index = buildTradeIndex(state.trades || []);
  const closed = index.all.filter(t => isClosedTrade(t));
  const closedWithPL = closed.map(t => ({ trade: t, pl: calcPL(t) || 0, r: window.calcR(t) || 0 }));
  const wins   = closedWithPL.filter(x => x.pl > 0);
  const losses = closedWithPL.filter(x => x.pl < 0);
  const totalPL = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRateNum = closed.length ? wins.length / closed.length * 100 : null;
  const grossWin = wins.reduce((s, x) => s + x.pl, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x.pl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss) : (grossWin > 0 ? Infinity : null);
  const expectancy = closed.length > 0 ? totalPL / closed.length : 0;
  const avgR = closedWithPL.length ? closedWithPL.reduce((s, x) => s + x.r, 0) / closedWithPL.length : 0;
  const avgWinR  = wins.length   ? wins.reduce((s, x) => s + x.r, 0)   / wins.length   : 0;
  const avgLossR = losses.length ? losses.reduce((s, x) => s + x.r, 0) / losses.length : 0;
  const setupMap = {};
  closed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { n: 0, wins: 0, pl: 0, totalR: 0, mode: t.mode || 'swing' };
    const pl = calcPL(t) || 0;
    setupMap[k].n++;
    if (pl > 0) setupMap[k].wins++;
    setupMap[k].pl += pl;
    setupMap[k].totalR += window.calcR(t) || 0;
  });
  return { closed, closedWithPL, wins, losses, totalPL, winRateNum, grossWin, grossLoss, profitFactor, expectancy, avgR, avgWinR, avgLossR, setupMap };
}
window.buildLogStatsData = buildLogStatsData;

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
window.buildTradeFlowEdgeIntel = buildTradeFlowEdgeIntel;
window.renderLogStats = renderLogStats;
