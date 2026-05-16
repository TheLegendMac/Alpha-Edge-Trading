// Pure formatting helpers — no state dependencies.

export function _fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

export function _fmtMoneyPlain(n) {
  const v = Number(n) || 0;
  return `$${v.toFixed(2)}`;
}

export function _toneClass(n) {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
}

export function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export function dateOffsetISO(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}
