// Pure trade utilities — no state dependencies.
// (tradeRiskDollars and calcR depend on state.settings; they stay in legacy.js until after Phase 4.)

export function genTradeId() {
  return 't_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

export function tradeInstrument(t) {
  return t && t.instrument === 'stocks' ? 'stocks' : 'options';
}

export function tradeMultiplier(t) {
  return tradeInstrument(t) === 'stocks' ? 1 : 100;
}

// Bias drives the LABEL (Long Call vs Long Put). The PnL math sign only flips
// for short stock — long puts are still long positions in the option (you bought
// it; sell-to-close higher = profit).
export function tradeBias(t) {
  if (t.bias) return t.bias;
  return (String(t.direction || 'Long').toLowerCase() === 'short') ? 'bearish' : 'bullish';
}

// Single source of truth for trade size — handles legacy `contracts` and `shares`.
export function tradeQty(t) {
  if (tradeInstrument(t) === 'stocks' && t.shares != null) return Number(t.shares) || 0;
  if (t.qty != null) return Number(t.qty) || 0;
  if (t.contracts != null) return Number(t.contracts) || 0;
  if (t.shares != null) return Number(t.shares) || 0;
  return 0;
}

export function isClosedTrade(t) {
  return !!t && t.status !== 'open';
}

export function calcPL(t) {
  if (t.status === 'open' || !t.exit) return null;
  const multiplier = tradeMultiplier(t);
  const bias = tradeBias(t);
  const sign = (tradeInstrument(t) === 'stocks' && bias === 'bearish') ? -1 : 1;
  const qty = tradeQty(t);
  return sign * (t.exit - t.entry) * multiplier * qty;
}

// SA decimal rating → category label.
//   4.50–5.00 = Strong Buy   3.50–4.49 = Buy
//   2.50–3.49 = Hold         1.50–2.49 = Sell   1.00–1.49 = Strong Sell
export function ratingToLabel(rating) {
  if (rating === null || rating === undefined || rating === '') return null;
  const r = parseFloat(rating);
  if (isNaN(r) || r < 1 || r > 5) return null;
  if (r >= 4.5) return 'Strong Buy';
  if (r >= 3.5) return 'Buy';
  if (r >= 2.5) return 'Hold';
  if (r >= 1.5) return 'Sell';
  return 'Strong Sell';
}

// SA decimal rating → traffic-light status.
//   3.50–5.00 = STRONG    2.50–3.49 = NEUTRAL    1.00–2.49 = WEAK
export function ratingToStatus(rating) {
  if (rating === null || rating === undefined || rating === '') return null;
  const r = parseFloat(rating);
  if (isNaN(r) || r < 1 || r > 5) return null;
  if (r >= 3.5) return 'STRONG';
  if (r >= 2.5) return 'NEUTRAL';
  return 'WEAK';
}

export function normalizeProcessQuality(grade) {
  if (!grade) return '';
  const g = String(grade).toLowerCase();
  if (g === 'a' || g === 'b' || g === 'clean') return 'clean';
  if (g === 'c' || g === 'mixed') return 'mixed';
  if (g === 'd' || g === 'f' || g === 'broken') return 'broken';
  return g;
}

export function processQualityLabel(grade) {
  const q = normalizeProcessQuality(grade);
  if (q === 'clean') return 'Good';
  if (q === 'mixed') return 'Okay';
  if (q === 'broken') return 'Bad';
  return '';
}

// Bridge to legacy.js (regular <script>).
window.genTradeId = genTradeId;
window.tradeInstrument = tradeInstrument;
window.tradeMultiplier = tradeMultiplier;
window.tradeBias = tradeBias;
window.tradeQty = tradeQty;
window.isClosedTrade = isClosedTrade;
window.calcPL = calcPL;
window.ratingToLabel = ratingToLabel;
window.ratingToStatus = ratingToStatus;
window.normalizeProcessQuality = normalizeProcessQuality;
window.processQualityLabel = processQualityLabel;
