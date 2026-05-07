import { state } from '../state/store.js';
import { buildTradeIndex } from '../models/trade-index.js';
import { calcPL } from '../models/trade.js';
import { esc, attr, money } from '../dom/html.js';

function streakLabel(rows) {
  const closed = rows
    .filter(r => r.trade.status !== 'open')
    .sort((a, b) => (b.trade.exit_date || b.trade.date || '').localeCompare(a.trade.exit_date || a.trade.date || ''));
  if (!closed.length) return 'No closes';
  const firstWin = closed[0].pl > 0;
  let n = 0;
  for (const row of closed) {
    if ((row.pl > 0) !== firstWin) break;
    n++;
  }
  return `${n} ${firstWin ? 'win' : 'loss'} streak`;
}

function bestSetup(rows, dir = 1) {
  const map = {};
  rows.forEach(row => {
    const name = row.trade.setup || 'No setup';
    if (!map[name]) map[name] = { name, n: 0, pl: 0, r: 0 };
    map[name].n++;
    map[name].pl += row.pl;
    map[name].r += row.r || 0;
  });
  return Object.values(map).sort((a, b) => dir * (b.pl - a.pl))[0] || null;
}

export function computeTickerDashboard(trades = state.trades || []) {
  const index = buildTradeIndex(trades);
  const grouped = new Map();
  index.all.forEach(t => {
    const ticker = String(t.ticker || '').trim().toUpperCase();
    if (!ticker) return;
    if (!grouped.has(ticker)) grouped.set(ticker, []);
    grouped.get(ticker).push(t);
  });

  return [...grouped.entries()].map(([ticker, tickerTrades]) => {
    const rows = tickerTrades
      .filter(t => t.status !== 'open')
      .map(t => ({ trade: t, pl: calcPL(t) || 0, r: window.calcR(t) || 0 }));
    const wins = rows.filter(r => r.pl > 0).length;
    const totalPL = rows.reduce((s, r) => s + r.pl, 0);
    const avgR = rows.length ? rows.reduce((s, r) => s + r.r, 0) / rows.length : 0;
    const best = bestSetup(rows, 1);
    const worst = rows.length > 1 ? bestSetup(rows, -1) : null;
    const open = tickerTrades.filter(t => t.status === 'open').length;
    const last = [...tickerTrades].sort((a, b) =>
      (b.updated_at || b.exit_date || b.date || '').localeCompare(a.updated_at || a.exit_date || a.date || '')
    )[0];
    return {
      ticker,
      total: tickerTrades.length,
      closed: rows.length,
      open,
      wins,
      winRate: rows.length ? Math.round(wins / rows.length * 100) : null,
      totalPL,
      avgR,
      best,
      worst,
      streak: streakLabel(rows),
      lastDate: last ? (last.exit_date || last.date || '') : '',
    };
  }).sort((a, b) => {
    const scoreA = a.closed * 2 + Math.abs(a.totalPL) / 100;
    const scoreB = b.closed * 2 + Math.abs(b.totalPL) / 100;
    return scoreB - scoreA;
  });
}

export function buildTickerDashboardHtml(trades = state.trades || []) {
  const tickers = computeTickerDashboard(trades).slice(0, 10);
  if (!tickers.length) {
    return `
      <div class="home-card ticker-dashboard-card">
        <div class="home-card-title">Ticker Memory</div>
        <div class="alpha-edge-empty">Log trades with tickers to see which names you actually trade well.</div>
      </div>`;
  }

  return `
    <div class="home-card ticker-dashboard-card">
      <div class="stats-snapshot-head">
        <div class="home-card-title" style="margin:0;">Ticker Memory</div>
        <div class="stats-snapshot-meta">${tickers.length} active ticker${tickers.length === 1 ? '' : 's'}</div>
      </div>
      <div class="ticker-memory-grid">
        ${tickers.map(t => `
          <button type="button" class="ticker-memory-card ${t.totalPL >= 0 ? 'pos' : 'neg'}" data-ticker-filter="${attr(t.ticker)}">
            <span class="ticker-memory-head">
              <span class="ticker-memory-symbol">${esc(t.ticker)}</span>
              <span class="ticker-memory-pl ${t.totalPL >= 0 ? 'pl-positive' : 'pl-negative'}">${money(t.totalPL)}</span>
            </span>
            <span class="ticker-memory-metrics">
              <span>${t.total}x</span>
              <span>${t.winRate === null ? '—' : t.winRate + '%W'}</span>
              <span class="${t.avgR >= 0 ? 'pl-positive' : 'pl-negative'}">${t.closed ? `${t.avgR >= 0 ? '+' : ''}${t.avgR.toFixed(2)}R` : '—'}</span>
              ${t.open ? `<span>${t.open} open</span>` : ''}
            </span>
            <span class="ticker-memory-line">Best: ${t.best ? `${esc(t.best.name)} · ${money(t.best.pl)}` : '—'}</span>
            <span class="ticker-memory-line muted">Worst: ${t.worst ? `${esc(t.worst.name)} · ${money(t.worst.pl)}` : '—'}</span>
            <span class="ticker-memory-foot">${esc(t.streak)}${t.lastDate ? ` · ${esc(t.lastDate)}` : ''}</span>
          </button>
        `).join('')}
      </div>
    </div>`;
}

window.computeTickerDashboard = computeTickerDashboard;
window.buildTickerDashboardHtml = buildTickerDashboardHtml;
