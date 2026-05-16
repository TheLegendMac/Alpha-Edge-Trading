import { state } from '../state/store.js';
import { buildTradeIndex } from '../models/trade-index.js';
import {
  calcPL,
  tradeInstrument,
  normalizeProcessQuality,
} from '../models/trade.js';
import { esc, attr, money } from '../dom/html.js';
import { alphaSpreadValue } from './buckets.js';

function pct(part, total) {
  return total ? Math.round(part / total * 100) : 0;
}

function mode(list) {
  const counts = {};
  list.filter(Boolean).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
}

function hourBucket(t) {
  const raw = String(t.time || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes < 11 * 60 + 30) return 'Morning';
  if (minutes < 14 * 60) return 'Midday';
  return 'Afternoon';
}

export function computeSetupScorecards(trades = state.trades || []) {
  const index = buildTradeIndex(trades);
  const rowsBySetup = new Map();
  index.closedWithPL.forEach(row => {
    const setup = row.trade.setup || 'No setup';
    if (!rowsBySetup.has(setup)) rowsBySetup.set(setup, []);
    rowsBySetup.get(setup).push(row);
  });

  return [...rowsBySetup.entries()].map(([setup, rows]) => {
    const n = rows.length;
    const wins = rows.filter(r => r.pl > 0).length;
    const losses = rows.filter(r => r.pl < 0).length;
    const pl = rows.reduce((s, r) => s + r.pl, 0);
    const avgR = rows.reduce((s, r) => s + r.r, 0) / Math.max(1, n);
    const bestTicker = Object.entries(rows.reduce((m, r) => {
      const ticker = r.trade.ticker || '';
      if (!ticker) return m;
      m[ticker] = (m[ticker] || 0) + r.pl;
      return m;
    }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    const processBreaks = rows.filter(r => normalizeProcessQuality(r.trade.grade) === 'broken').length;
    const wideSpreads = rows.filter(r => {
      const spread = alphaSpreadValue(r.trade);
      return Number.isFinite(spread) && spread > ((state.settings && state.settings.intradayMaxSpreadPct) || 5);
    }).length;
    const avgLossR = losses
      ? rows.filter(r => r.pl < 0).reduce((s, r) => s + r.r, 0) / losses
      : 0;
    const bestWindow = mode(rows.map(r => hourBucket(r.trade)));
    const instrument = mode(rows.map(r => tradeInstrument(r.trade) === 'stocks' ? 'Stock' : 'Options'));
    const weakestReason = wideSpreads
      ? 'wide spreads'
      : processBreaks
        ? 'broken process'
        : avgLossR <= -1.25
          ? 'large losses'
          : losses > wins
            ? 'low win rate'
            : 'none flagged';
    const grade = n < 3
      ? 'Learning'
      : avgR >= 0.5 && pct(wins, n) >= 50
        ? 'A'
        : avgR >= 0
          ? 'B'
          : avgR > -0.5
            ? 'C'
            : 'D';

    return {
      setup,
      n,
      wins,
      losses,
      winRate: pct(wins, n),
      pl,
      avgR,
      bestTicker,
      bestWindow,
      instrument,
      weakestReason,
      grade,
    };
  }).sort((a, b) => b.avgR - a.avgR || b.pl - a.pl);
}

export function buildSetupScorecardsHtml(trades = state.trades || []) {
  const cards = computeSetupScorecards(trades);
  if (!cards.length) {
    return `
      <div class="home-card setup-scorecards-card">
        <div class="home-card-title">Setup Scorecards</div>
        <div class="alpha-edge-empty">Close a few trades to unlock setup scorecards.</div>
      </div>`;
  }

  return `
    <div class="home-card setup-scorecards-card">
      <div class="stats-snapshot-head">
        <div class="home-card-title" style="margin:0;">Setup Scorecards</div>
        <div class="stats-snapshot-meta">${cards.length} setup${cards.length === 1 ? '' : 's'} scored</div>
      </div>
      <div class="setup-scorecard-grid">
        ${cards.slice(0, 8).map(c => `
          <button type="button" class="setup-scorecard grade-${attr(c.grade).toLowerCase()}" data-setup-filter="${attr(c.setup)}">
            <span class="setup-scorecard-top">
              <span class="setup-scorecard-name">${esc(c.setup)}</span>
              <span class="setup-scorecard-grade">${esc(c.grade)}</span>
            </span>
            <span class="setup-scorecard-metrics">
              <span>${c.n}x</span>
              <span>${c.winRate}%W</span>
              <span class="${c.avgR >= 0 ? 'pl-positive' : 'pl-negative'}">${c.avgR >= 0 ? '+' : ''}${c.avgR.toFixed(2)}R</span>
              <span class="${c.pl >= 0 ? 'pl-positive' : 'pl-negative'}">${money(c.pl)}</span>
            </span>
            <span class="setup-scorecard-read">
              Best: ${esc(c.bestWindow)} · ${esc(c.instrument)} · ${esc(c.bestTicker)}
            </span>
            <span class="setup-scorecard-avoid">Watch: ${esc(c.weakestReason)}</span>
          </button>
        `).join('')}
      </div>
    </div>`;
}

window.computeSetupScorecards = computeSetupScorecards;
window.buildSetupScorecardsHtml = buildSetupScorecardsHtml;
