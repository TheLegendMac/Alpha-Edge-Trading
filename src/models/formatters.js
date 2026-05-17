// Pure formatting helpers — no state dependencies.
// Canonical home for money / R / percent / date formatting.

// Round-to-N helper used by money formatters.
function fmtAbs(abs, digits) {
  if (digits === 0) return Math.round(abs).toLocaleString();
  return abs.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// fmtMoney(1234.5)       → "+$1,235"
// fmtMoney(-1234.5, 2)   → "-$1,234.50"
export function fmtMoney(value, digits = 0) {
  const n = Number(value) || 0;
  const sign = n >= 0 ? '+$' : '-$';
  return `${sign}${fmtAbs(Math.abs(n), digits)}`;
}

// fmtMoneyPlain(-1234)   → "$1,234"  (no sign, always positive presentation)
export function fmtMoneyPlain(value, digits = 0) {
  const n = Number(value) || 0;
  return `$${fmtAbs(Math.abs(n), digits)}`;
}

// fmtR(0.39)       → "+0.39R"
// fmtR(-1.2)       → "-1.20R"
export function fmtR(value, digits = 2) {
  const n = Number(value) || 0;
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}R`;
}

// fmtPct(45.3)             → "45%"
// fmtPct(-7.2, 1, true)    → "-7.2%"
export function fmtPct(value, digits = 0, signed = false) {
  const n = Number(value) || 0;
  const prefix = signed && n > 0 ? '+' : '';
  return `${prefix}${n.toFixed(digits)}%`;
}

export function toneClass(n) {
  const v = Number(n) || 0;
  return v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
}

// ── Legacy aliases ─────────────────────────────────────────
// Older callers used _fmtMoney / _fmtMoneyPlain / _toneClass with
// always-2-decimals output. Keep the names but route through fmt*.
export const _fmtMoney = (n) => fmtMoney(n, 2);
export const _fmtMoneyPlain = (n) => fmtMoneyPlain(n, 2);
export const _toneClass = toneClass;

// ── Dates ──────────────────────────────────────────────────
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
