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

// Bridge to legacy.js (regular <script>): expose as globals so unmoved code keeps resolving.
// These window assignments will be removed in Phase 12 along with the inline-onclick cleanup.
window._fmtMoney = _fmtMoney;
window._fmtMoneyPlain = _fmtMoneyPlain;
window._toneClass = _toneClass;
window.formatDate = formatDate;
window.todayISO = todayISO;
window.dateOffsetISO = dateOffsetISO;
