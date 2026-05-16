import { isClosedTrade, calcPL, calcR } from './trade.js';

let cachedKey = '';
let cachedIndex = null;

function tradeKey(t) {
  return [
    t && t.id,
    t && t.updated_at,
    t && t.date,
    t && t.exit_date,
    t && t.status,
    t && t.entry,
    t && t.exit,
    t && t.contracts,
    t && t.qty,
    t && t.shares,
    t && t.riskDollars,
    t && t.stop,
    t && t.setup,
    t && t.ticker,
    t && t.grade,
  ].join(':');
}

function pushMap(map, key, trade) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(trade);
}

export function buildTradeIndex(trades = []) {
  const key = `${trades.length}|${trades.map(tradeKey).join('|')}`;
  if (cachedIndex && cachedKey === key) return cachedIndex;

  const open = [];
  const closed = [];
  const closedWithPL = [];
  const byEntryDate = new Map();
  const byExitDate = new Map();
  const byAnyDate = new Map();

  trades.forEach(t => {
    pushMap(byEntryDate, t.date, t);
    pushMap(byAnyDate, t.date, t);
    if (t.exit_date && t.exit_date !== t.date) pushMap(byAnyDate, t.exit_date, t);

    if (isClosedTrade(t)) {
      closed.push(t);
      pushMap(byExitDate, t.exit_date || t.date, t);
      closedWithPL.push({ trade: t, pl: calcPL(t) || 0, r: calcR(t) || 0 });
    } else {
      open.push(t);
    }
  });

  const recent = [...trades].sort((a, b) => {
    const aTime = new Date(a.updated_at || a.exit_date || a.date || 0).getTime();
    const bTime = new Date(b.updated_at || b.exit_date || b.date || 0).getTime();
    return bTime - aTime;
  });

  cachedKey = key;
  cachedIndex = { all: trades, open, closed, closedWithPL, byEntryDate, byExitDate, byAnyDate, recent };
  return cachedIndex;
}

export function filterLogTrades(index, { mode = 'all', setup = '', search = '' } = {}) {
  const modeFiltered = mode === 'all'
    ? index.all
    : index.all.filter(t => (t.mode || 'swing') === mode);
  const setupFiltered = setup
    ? modeFiltered.filter(t => (t.setup || '—') === setup)
    : modeFiltered;
  const q = (search || '').trim().toLowerCase();
  if (!q) return setupFiltered;
  return setupFiltered.filter(t =>
    (t.ticker || '').toLowerCase().includes(q) ||
    (t.setup || '').toLowerCase().includes(q) ||
    (t.direction || '').toLowerCase().includes(q) ||
    (t.mode || '').toLowerCase().includes(q) ||
    (t.status || '').toLowerCase().includes(q));
}
