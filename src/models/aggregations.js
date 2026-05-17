// Reusable aggregators for closed trades — one source of truth for the
// repeated `closedWithPL` map and the setup-level reducer that previously
// lived (in slightly different forms) across alpha.js, stats.js, log.js,
// and ticker-memory.js.

import { isClosedTrade, calcPL, calcR } from './trade.js';

// Map each trade to its computed P/L and R. Stable shape: { trade, pl, r }.
export function enrichTrades(trades) {
  return (trades || []).map(t => ({
    trade: t,
    pl: calcPL(t) || 0,
    r: calcR(t) || 0,
  }));
}

// Filter to closed trades and enrich in one step — what almost every caller wants.
export function enrichClosed(trades) {
  return enrichTrades((trades || []).filter(t => isClosedTrade(t)));
}

// Aggregate a list of trades by a key (default = setup). Returns a Map-like
// plain object keyed by the group; each entry has the same fields callers
// have historically rebuilt by hand.
//
//   { n, wins, losses, pl, totalR, avgR, winRate, mode? }
//
// `keyFn` lets callers regroup by mode, exit_reason, etc.
export function aggregateBy(trades, keyFn = (t) => t.setup || '—') {
  const out = {};
  (trades || []).forEach(t => {
    const k = keyFn(t);
    if (!k) return;
    if (!out[k]) {
      out[k] = { key: k, n: 0, wins: 0, losses: 0, pl: 0, totalR: 0, mode: t.mode || 'swing' };
    }
    const pl = calcPL(t) || 0;
    const r  = calcR(t) || 0;
    out[k].n++;
    out[k].pl += pl;
    out[k].totalR += r;
    if (pl > 0) out[k].wins++;
    else if (pl < 0) out[k].losses++;
  });
  Object.values(out).forEach(g => {
    g.avgR = g.n ? g.totalR / g.n : 0;
    g.winRate = g.n ? g.wins / g.n * 100 : 0;
    g.avgPL = g.n ? g.pl / g.n : 0;
  });
  return out;
}

// Convenience: aggregate by setup, sorted by P/L descending — the most common shape.
export function aggregateBySetup(trades) {
  const map = aggregateBy(trades, t => t.setup || '—');
  return Object.values(map).sort((a, b) => b.pl - a.pl);
}

// Best / worst setup for "edge intel"-style summaries.
export function bestWorstSetup(trades) {
  const sorted = aggregateBySetup(trades);
  return {
    best: sorted[0] || null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    all: sorted,
  };
}
