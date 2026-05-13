// Regime mode + pre-trade check + IV-rank strategy + liquidity gates.

import { state, getRiskPctForRegime } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { REGIME_DATA } from '../config/constants.js';
import { touchMarketContext } from '../sync/merge.js';

export function setRegime(r) {
  state.regime = r;
  touchMarketContext();
  saveState();
  if (typeof window.renderHome === 'function') window.renderHome();
  renderRegime();
  renderPretradeCheck();
  if (typeof window.renderTrade === 'function') window.renderTrade();
}

export function renderRegime() {
  const data = REGIME_DATA[state.regime];
  // Cmdbar (formerly the regime banner) is always visible — only the rules strip toggles.
  const banner = document.getElementById('regime-banner');
  const display = document.getElementById('regime-state');
  if (display) display.className = 'cmdbar-context-btn ' + state.regime;
  const text = document.getElementById('regime-text');
  if (text) text.textContent = data.text;
  const contextRegime = document.getElementById('cmdbar-context-regime');
  if (contextRegime) {
    // Status pill: "RISK ON" / "NEUTRAL" / "RISK OFF"
    const labelText = data.text.replace('-', ' ');
    contextRegime.textContent = labelText;
  }

  // Mode-aware rules text:
  // - Swing (or anywhere except intraday): show regime-driven sizing %
  // - Intraday: show "context only" message + the fixed dollar risk
  const rulesHtml = (() => {
    if (state.activeMode === 'intraday') {
      const dollar = state.settings.intradayRiskPerTrade;
      const tilt = state.regime === 'risk-on'
        ? 'Tilt long-side; same $ risk per trade'
        : state.regime === 'neutral'
          ? 'No directional tilt; consider half size'
          : 'Tilt short-side or stand aside';
      return `<strong>Context only</strong> &nbsp;•&nbsp; Intraday uses fixed $${dollar}/trade regardless of regime &nbsp;•&nbsp; ${tilt}`;
    }
    const pct = (getRiskPctForRegime(state.regime) * 100).toFixed(2).replace(/\.?0+$/, '');
    return data.rulesTemplate.replace('{pct}', pct);
  })();

  // Hidden legacy element — preserved as data source for any external readers / tests.
  const legacy = document.getElementById('regime-rules');
  if (legacy) legacy.innerHTML = rulesHtml;

  // Drive the colored top accent line on cmdbar.
  if (banner) {
    banner.classList.remove('risk-on', 'neutral', 'risk-off');
    banner.classList.add(data.bannerClass);
  }
}

// ---------- Pre-trade check ----------

export function getTodayLossCount() {
  const today = new Date().toISOString().split('T')[0];
  return state.trades.filter(t =>
    t.status === 'loss' && t.exit_date === today
  ).length;
}

export function getOpenPositionsCount() {
  return state.trades.filter(t => t.status === 'open').length;
}

export function renderPretradeCheck() {
  const card = document.getElementById('pretrade-check');
  if (!card) return;
  const idPrefix = '';
  const icon = document.getElementById(idPrefix + 'pretrade-icon');
  const title = document.getElementById(idPrefix + 'pretrade-title');
  const detail = document.getElementById(idPrefix + 'pretrade-detail');
  const vixEl = document.getElementById(idPrefix + 'check-vix') || document.getElementById('check-vix');
  const newsEl = document.getElementById(idPrefix + 'check-news') || document.getElementById('check-news');
  const streakEl = document.getElementById(idPrefix + 'check-streak') || document.getElementById('check-streak');
  const streakText = document.getElementById(idPrefix + 'check-streak-text') || document.getElementById('check-streak-text');
  const posEl = document.getElementById(idPrefix + 'check-positions') || document.getElementById('check-positions');
  const posText = document.getElementById(idPrefix + 'check-positions-text') || document.getElementById('check-positions-text');

  const checks = state.pretradeChecks;
  const todayLosses = getTodayLossCount();
  const openCount = getOpenPositionsCount();
  const maxPositions = state.settings.maxPositions;

  const streakOK = todayLosses < 2;
  const positionsOK = openCount < maxPositions;
  const allChecked = checks.vix && checks.news && streakOK && positionsOK;

  // Update mini check buttons (manual ones)
  if (vixEl) {
    vixEl.classList.remove('checked', 'unchecked');
    vixEl.classList.add(checks.vix ? 'checked' : 'unchecked');
  }
  if (newsEl) {
    newsEl.classList.remove('checked', 'unchecked');
    newsEl.classList.add(checks.news ? 'checked' : 'unchecked');
  }

  // Auto-detected: streak
  if (streakEl) {
    streakEl.classList.remove('checked', 'unchecked');
    streakEl.classList.add(streakOK ? 'checked' : 'unchecked');
  }
  if (streakText) {
    streakText.textContent = streakOK
      ? (todayLosses === 0 ? 'No losses today' : `${todayLosses} loss today`)
      : `${todayLosses} losses today`;
  }

  // Auto-detected: positions cap
  if (posEl) {
    posEl.classList.remove('checked', 'unchecked');
    posEl.classList.add(positionsOK ? 'checked' : 'unchecked');
  }
  if (posText) {
    posText.textContent = positionsOK
      ? `${openCount}/${maxPositions} open`
      : `Cap full (${openCount}/${maxPositions})`;
  }

  if (state.regime === 'risk-off' && state.direction !== 'short') {
    card.className = 'pretrade-check danger';
    if (icon) icon.textContent = '🔴';
    if (title) title.textContent = 'Long entries blocked';
    if (detail) detail.textContent = 'Regime is RISK-OFF. Only puts on weak / red-list sectors are permitted at quarter size. Switch direction to "Put / Short" in the header to proceed.';
  } else if (state.regime === 'risk-off' && state.direction === 'short') {
    card.className = 'pretrade-check warn';
    if (icon) icon.textContent = '🟡';
    if (title) title.textContent = 'Risk-Off puts only';
    const pct = (getRiskPctForRegime('risk-off') * 100).toFixed(2).replace(/\.?0+$/, '');
    if (detail) detail.textContent = `Quarter size ${pct}% per trade. Restrict to weak / red-list sector tickers (SA Quant under 2.5).`;
  } else if (!allChecked) {
    card.className = 'pretrade-check danger';
    if (icon) icon.textContent = '🔴';
    if (title) title.textContent = 'Veto condition active — DO NOT trade';
    const failed = [];
    if (!checks.vix) failed.push('VIX spike over 30%');
    if (!checks.news) failed.push('Surprise news event');
    if (!streakOK) failed.push(`${todayLosses} losses today`);
    if (!positionsOK) failed.push(`Position cap full (${openCount}/${maxPositions})`);
    if (detail) detail.textContent = 'Stand down: ' + failed.join(' • ');
  } else if (state.regime === 'neutral') {
    card.className = 'pretrade-check warn';
    if (icon) icon.textContent = '🟡';
    if (title) title.textContent = 'Trade with reduced size';
    const pct = (getRiskPctForRegime('neutral') * 100).toFixed(2).replace(/\.?0+$/, '');
    if (detail) detail.textContent = `Regime is NEUTRAL. Risk reduced to ${pct}% per trade. Debit spreads preferred.`;
  } else {
    card.className = 'pretrade-check';
    if (icon) icon.textContent = '🟢';
    if (title) title.textContent = 'Market is safe to trade';
    if (detail) detail.textContent = 'Regime is RISK-ON. No active veto conditions.';
  }
}

export function togglePretradeCheck(key) {
  // Only manual checks (vix, news) can be toggled
  if (key !== 'vix' && key !== 'news') return;
  state.pretradeChecks[key] = !state.pretradeChecks[key];
  saveState();
  renderPretradeCheck();
  if (typeof window.renderTrade === 'function') window.renderTrade();
}

// ---------- IV Rank Strategy ----------
export function getStrategyForIVR(ivr, direction) {
  if (ivr === null || isNaN(ivr) || ivr < 0) return null;

  const isLong = direction === 'long';
  const optType = isLong ? 'CALL' : 'PUT';
  const longOnly = state.settings.longOnlyMode;

  if (ivr < 30) return {
    bucket: 1,
    light: 'GREEN — Cheap volatility, buy outright',
    name: `Buy a single ${optType}`,
    rationale: `IV Rank under 30 means options are cheap right now. Buy a single ${optType.toLowerCase()} — you get max leverage for your risk dollar. If volatility rises later, your position gains extra value (called a "vega tailwind").`,
    delta: '0.65 – 0.75 (in-the-money — moves about 65-75¢ for every $1 the stock moves)',
    dte: '30 – 45 days to expiration',
    width: '—',
  };
  if (ivr < 50) {
    if (longOnly) return {
      bucket: 2,
      light: 'YELLOW — Moderate IV, single contract acceptable',
      name: `Buy a single ${optType} (smaller delta)`,
      rationale: `IV Rank 30-50 means options are fairly priced. Long-only mode is on, so instead of a debit spread, buy a single ${optType.toLowerCase()} but use slightly out-of-the-money strikes (lower delta) to reduce dollar cost. Watch for IV contraction — vega will work against you if IV falls.`,
      delta: '0.50 – 0.60 (slightly OTM, cheaper but less leverage)',
      dte: '30 – 45 days to expiration',
      width: '—',
    };
    return {
      bucket: 2,
      light: 'CYAN — Moderate volatility, use a spread',
      name: `Debit ${optType.toLowerCase()} spread`,
      rationale: `IV Rank 30-50 means options are fairly priced. Use a debit spread (buy one ${optType.toLowerCase()}, sell another further out-of-the-money). This cuts your cost 40-60% and protects you if volatility falls.`,
      delta: 'Long leg: 0.60 – 0.70 / Short leg: 0.30 – 0.40',
      dte: '30 – 45 days to expiration',
      width: '$2.50 – $5.00 between strikes',
    };
  }
  if (ivr < 70) {
    if (longOnly) return {
      bucket: 3,
      light: 'RED — IV too high for long-only — SKIP',
      name: 'SKIP this trade',
      rationale: `IV Rank 50-70 is the spread zone. Long-only mode is on, which means skip this trade. Buying a single ${optType.toLowerCase()} at this IVR will get crushed by vega contraction even if direction is right. Wait for IVR to drop under 50.`,
      delta: '—',
      dte: '—',
      width: '—',
    };
    return {
      bucket: 3,
      light: 'AMBER — Volatility elevated, half size with spread',
      name: `Debit ${optType.toLowerCase()} spread (HALF size)`,
      rationale: `IV Rank 50-70 means options are expensive. Spread required AND cut your size in half. When volatility is high, even correct directional bets can lose money if volatility drops (called "vega headwind").`,
      delta: 'Long leg: 0.60 – 0.70 / Short leg: 0.30 – 0.40',
      dte: '30 – 45 days to expiration',
      width: '$2.50 – $5.00 between strikes',
    };
  }
  return {
    bucket: 4,
    light: 'RED — Volatility too high, skip',
    name: 'SKIP this trade',
    rationale: `IV Rank above 70 means options are extremely expensive. Even if you\'re right on direction, the volatility crush after the move will likely wipe out your gains. Wait for IV to come back down.`,
    delta: '—',
    dte: '—',
    width: '—',
  };
}

// ---------- Liquidity ----------
export function deriveSpreadPct(liq) {
  const bid = Number(liq?.bid);
  const ask = Number(liq?.ask);
  if (!bid || !ask || bid <= 0 || ask <= 0 || ask < bid) {
    const fallback = Number(liq?.spreadPct);
    return Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
  }
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  return ((ask - bid) / mid) * 100;
}

export function liquidityOK() {
  const liq = state.liquidity || {};
  if (state.instrument === 'stocks') {
    return Number(liq.stockVol) >= 1000000;
  }
  return Number(liq.stockVol) >= 1000000
      && Number(liq.optionOI) >= 500
      && Number(liq.optionVol) >= 100;
}

// Bridge to legacy.js.
window.setRegime = setRegime;
window.renderRegime = renderRegime;
window.getTodayLossCount = getTodayLossCount;
window.getOpenPositionsCount = getOpenPositionsCount;
window.renderPretradeCheck = renderPretradeCheck;
window.togglePretradeCheck = togglePretradeCheck;
window.getStrategyForIVR = getStrategyForIVR;
window.deriveSpreadPct = deriveSpreadPct;
window.liquidityOK = liquidityOK;
