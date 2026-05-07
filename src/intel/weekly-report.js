import { state } from '../state/store.js';
import { buildTradeIndex } from '../models/trade-index.js';
import { calcPL, isClosedTrade, processQualityLabel } from '../models/trade.js';
import { computeSetupScorecards } from './setup-scorecards.js';
import { esc, money, plainMoney } from '../dom/html.js';

function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + mondayOffset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end, startISO: localISO(start), endISO: localISO(end) };
}

function reportRows(trades, startISO, endISO) {
  return trades.filter(t => {
    const d = t.exit_date || t.date || '';
    return d >= startISO && d <= endISO;
  });
}

function downloadHtml(filename, html) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildWeeklyReportHtml({ trades = state.trades || [], range = currentWeekRange() } = {}) {
  const weekTrades = reportRows(trades, range.startISO, range.endISO);
  const closed = weekTrades.filter(t => isClosedTrade(t));
  const closedRows = closed.map(t => ({ trade: t, pl: calcPL(t) || 0, r: window.calcR(t) || 0 }));
  const wins = closedRows.filter(r => r.pl > 0);
  const losses = closedRows.filter(r => r.pl < 0);
  const totalPL = closedRows.reduce((s, r) => s + r.pl, 0);
  const totalR = closedRows.reduce((s, r) => s + r.r, 0);
  const winRate = closedRows.length ? Math.round(wins.length / closedRows.length * 100) : 0;
  const avgR = closedRows.length ? totalR / closedRows.length : 0;
  const scorecards = computeSetupScorecards(closed).slice(0, 5);
  const biggestWin = [...closedRows].sort((a, b) => b.pl - a.pl)[0];
  const biggestLoss = [...closedRows].sort((a, b) => a.pl - b.pl)[0];
  const index = buildTradeIndex(trades);
  const openRisk = index.open.reduce((s, t) => s + (Number(t.riskDollars) || window.tradeRiskDollars(t) || 0), 0);
  const bestTone = biggestWin && biggestWin.pl >= 0 ? 'pos' : 'neg';

  const tradeTable = closedRows.length ? closedRows
    .sort((a, b) => (a.trade.exit_date || a.trade.date || '').localeCompare(b.trade.exit_date || b.trade.date || ''))
    .map(r => `
      <tr>
        <td>${esc(r.trade.exit_date || r.trade.date || '—')}</td>
        <td>${esc(r.trade.ticker || '—')}</td>
        <td>${esc(r.trade.setup || 'No setup')}</td>
        <td>${esc(r.trade.mode || 'swing')}</td>
        <td>${esc(processQualityLabel(r.trade.grade) || '—')}</td>
        <td class="${r.r >= 0 ? 'pos' : 'neg'}">${r.r >= 0 ? '+' : ''}${r.r.toFixed(2)}R</td>
        <td class="${r.pl >= 0 ? 'pos' : 'neg'}">${money(r.pl)}</td>
      </tr>`).join('')
    : `<tr><td colspan="7">No closed trades this week.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alpha Edge Weekly Report ${esc(range.startISO)} to ${esc(range.endISO)}</title>
<style>
  :root { color-scheme: dark; --bg:#0b0f14; --card:#121821; --line:#28313d; --ink:#edf3f8; --muted:#9aa7b5; --green:#32d583; --red:#ff6b6b; --cyan:#22d3ee; }
  body { margin:0; padding:32px; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  header { display:flex; justify-content:space-between; gap:24px; align-items:flex-end; border-bottom:1px solid var(--line); padding-bottom:18px; margin-bottom:20px; }
  h1 { margin:0; font-size:28px; }
  h2 { margin:0 0 10px; font-size:14px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
  .meta { color:var(--muted); font-size:12px; text-align:right; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:18px 0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:16px; }
  .label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.1em; }
  .value { font-size:24px; font-weight:800; margin-top:6px; }
  .pos { color:var(--green); } .neg { color:var(--red); }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th, td { text-align:left; padding:9px 8px; border-bottom:1px solid var(--line); font-size:12px; }
  th { color:var(--muted); text-transform:uppercase; letter-spacing:.08em; font-size:10px; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .score { display:grid; grid-template-columns:1.4fr repeat(4, .7fr); gap:8px; padding:8px 0; border-bottom:1px solid var(--line); font-size:12px; }
  .notes { min-height:86px; border:1px dashed var(--line); border-radius:8px; padding:12px; color:var(--muted); }
  @media print { body { background:white; color:#111; padding:18px; } .card { background:white; } .pos { color:#047857; } .neg { color:#b91c1c; } }
</style>
</head>
<body>
  <header>
    <div>
      <h1>Alpha Edge Weekly Report</h1>
      <div class="label">${esc(range.startISO)} to ${esc(range.endISO)}</div>
    </div>
    <div class="meta">Generated ${esc(new Date().toLocaleString())}<br>Educational trading journal summary</div>
  </header>
  <section class="grid">
    <div class="card"><div class="label">Realized P/L</div><div class="value ${totalPL >= 0 ? 'pos' : 'neg'}">${money(totalPL)}</div></div>
    <div class="card"><div class="label">Closed Trades</div><div class="value">${closedRows.length}</div></div>
    <div class="card"><div class="label">Win Rate</div><div class="value">${winRate}%</div></div>
    <div class="card"><div class="label">Avg R</div><div class="value ${avgR >= 0 ? 'pos' : 'neg'}">${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R</div></div>
  </section>
  <section class="split">
    <div class="card"><h2>Best Trade</h2>${biggestWin ? `${esc(biggestWin.trade.ticker || '—')} · ${esc(biggestWin.trade.setup || 'No setup')}<br><strong class="${bestTone}">${money(biggestWin.pl)} · ${biggestWin.r >= 0 ? '+' : ''}${biggestWin.r.toFixed(2)}R</strong>` : '—'}</div>
    <div class="card"><h2>Largest Loss</h2>${biggestLoss && biggestLoss.pl < 0 ? `${esc(biggestLoss.trade.ticker || '—')} · ${esc(biggestLoss.trade.setup || 'No setup')}<br><strong class="neg">${money(biggestLoss.pl)} · ${biggestLoss.r.toFixed(2)}R</strong>` : '—'}</div>
  </section>
  <section class="card" style="margin-top:12px;">
    <h2>Setup Scorecards</h2>
    ${scorecards.length ? scorecards.map(s => `<div class="score"><strong>${esc(s.setup)}</strong><span>${s.n}x</span><span>${s.winRate}%W</span><span class="${s.avgR >= 0 ? 'pos' : 'neg'}">${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R</span><span>${esc(s.weakestReason)}</span></div>`).join('') : 'No closed setup data this week.'}
  </section>
  <section class="card" style="margin-top:12px;">
    <h2>Closed Trades</h2>
    <table>
      <thead><tr><th>Date</th><th>Ticker</th><th>Setup</th><th>Mode</th><th>Process</th><th>R</th><th>P/L</th></tr></thead>
      <tbody>${tradeTable}</tbody>
    </table>
  </section>
  <section class="grid">
    <div class="card"><div class="label">Open Risk</div><div class="value">${plainMoney(openRisk)}</div></div>
    <div class="card"><div class="label">Open Positions</div><div class="value">${index.open.length}</div></div>
    <div class="card"><div class="label">Weekly R</div><div class="value ${totalR >= 0 ? 'pos' : 'neg'}">${totalR >= 0 ? '+' : ''}${totalR.toFixed(2)}R</div></div>
    <div class="card"><div class="label">Next Week Focus</div><div class="value" style="font-size:14px;">Write one rule below</div></div>
  </section>
  <section class="card">
    <h2>Review Notes</h2>
    <div class="notes">What worked? What cost money? What one behavior gets tightened next week?</div>
  </section>
</body>
</html>`;
}

export function exportWeeklyReport() {
  const range = currentWeekRange();
  const html = buildWeeklyReportHtml({ range });
  downloadHtml(`alpha_edge_weekly_${range.startISO}_to_${range.endISO}.html`, html);
  if (typeof window.toast === 'function') window.toast('Weekly report exported');
}

window.exportWeeklyReport = exportWeeklyReport;
window.buildWeeklyReportHtml = buildWeeklyReportHtml;
