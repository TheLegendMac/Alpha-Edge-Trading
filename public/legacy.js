// Phase 2 wrapper: verbatim copy of the original inline <script> JS.
// Loaded as a regular (non-module) script so top-level `function foo()` declarations
// remain global — inline onclick="foo(...)" handlers resolve against window as before.
// Phases 3+ will progressively extract chunks of this file into proper ES modules.
//
//=================================================================
// V2 TRADE COCKPIT v3 — Step-by-step flow with traffic light design
//=================================================================

// STORAGE_KEY, OLD_STORAGE_KEY → src/config/constants.js
// Supabase sync layer (SYNC, getDeviceId, initSupabase, setSyncStatus, pullCloudState,
// schedulePush, doPush, syncTradesTableMirror, reconcileOnSignIn, pullAndMergeIfNewer,
// online/offline/visibility/focus listeners, 60s poll) → src/sync/supabase.js
// Auth flow (showAuthModal, hideAuthModal, showAuthError, clearAuthError, handleSignIn,
// handleSignUp, handleSkipAuth, showSyncMenu, manualSupabaseRefresh, bootstrapAuth)
// → src/sync/auth-modal.js
// Merge helpers + market-context (tradeFieldScore, tradeUpdatedTime, chooseTradeVersion,
// mergeDeletedTradeIds, mergeTradesArrays, touchMarketContext, marketContextTime,
// shouldAdoptCloudMarketContext, adoptCloudMarketContext) → src/sync/merge.js

// getRiskPctForRegime → src/state/store.js

// ---------- Context Panel (regime + sector two-in-one) ----------
function openContextPanel() {
  document.getElementById('ctx-panel').classList.add('open');
  document.getElementById('ctx-backdrop').classList.add('open');
  renderContextPanel();
}
function closeContextPanel() {
  document.getElementById('ctx-panel').classList.remove('open');
  document.getElementById('ctx-backdrop').classList.remove('open');
}
function renderContextPanel() {
  // Regime buttons
  document.querySelectorAll('.ctx-regime-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ctxRegime === state.regime);
  });
  // Rules text
  const rules = document.getElementById('ctx-rules');
  if (rules) {
    const data = REGIME_DATA[state.regime];
    const pct = (getRiskPctForRegime(state.regime) * 100).toFixed(2).replace(/\.?0+$/, '');
    rules.innerHTML = data.rulesTemplate.replace('{pct}', pct);
  }
  // Rated-at
  const ratedAtEl = document.getElementById('ctx-rated-at');
  if (ratedAtEl && state.sectorRatedAt) {
    const days = daysSinceSectorRating();
    const label = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
    ratedAtEl.textContent = `· ${label}`;
    ratedAtEl.className = 'ctx-rated-at' + (days > 7 ? ' stale' : '');
  } else if (ratedAtEl) {
    ratedAtEl.textContent = '· never rated';
    ratedAtEl.className = 'ctx-rated-at';
  }
  // Sector grid
  const grid = document.getElementById('ctx-sector-grid');
  if (grid) {
    grid.innerHTML = SECTORS.map(s => {
      const rating = state.sectorRatings[s.ticker] || '';
      const status = ratingToStatus(rating);
      const rowClass = status ? status.toLowerCase() : '';
      return `
        <div class="ctx-sector-row ${rowClass}" data-ctx-ticker="${s.ticker}">
          <span class="ctx-sector-ticker" title="${s.name}">${s.ticker}</span>
          <span class="ctx-sector-name" title="${s.name}">${s.name}</span>
          <input class="ctx-sector-input" type="text"
                 placeholder="—" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*"
                 data-ctx-ticker="${s.ticker}"
                 value="${rating}" />
        </div>`;
    }).join('');
    // Wire inputs
    grid.querySelectorAll('.ctx-sector-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const ticker = e.target.dataset.ctxTicker;
        const raw = e.target.value.trim();
        const num = parseFloat(raw);
        if (raw === '' || isNaN(num)) delete state.sectorRatings[ticker];
        else if (num >= 1 && num <= 5) state.sectorRatings[ticker] = raw;
        else return;
        state.sectorRatedAt = new Date().toISOString();
        touchMarketContext();
        saveState();
        // Update row class live
        const row = e.target.closest('.ctx-sector-row');
        if (row) {
          const st = ratingToStatus(raw);
          row.classList.remove('strong', 'neutral', 'weak');
          if (st) row.classList.add(st.toLowerCase());
        }
        updateCtxSectorSummary();
        if (typeof renderHome === 'function') renderHome();
        if (typeof renderSectors === 'function') renderSectors();
        if (typeof renderSectorStatusMini === 'function') renderSectorStatusMini();
      });
    });
  }
  updateCtxSectorSummary();
}
function updateCtxSectorSummary() {
  const summary = document.getElementById('ctx-sector-summary');
  if (!summary) return;
  const top3  = computeTop3();
  const avoid = computeAvoidList();
  const topNames  = top3.length  ? top3.map(s => `${s.name} (${s.ticker})`).join(', ')  : '—';
  const avoidNames = avoid.length ? avoid.map(s => `${s.name} (${s.ticker})`).join(', ') : '—';
  summary.innerHTML = `<span class="cs-top">▲ Long: ${topNames}</span><br><span class="cs-avoid">▼ Avoid: ${avoidNames}</span>`;
}

// ---------- Regime ----------
// REGIME_DATA → src/config/constants.js

function setRegime(r) {
  state.regime = r;
  touchMarketContext();
  saveState();
  renderHome();
  renderRegime();
  renderPretradeCheck();
  if (typeof renderTrade === 'function') renderTrade();
}

function renderRegime() {
  const data = REGIME_DATA[state.regime];
  // Cmdbar (formerly the regime banner) is always visible — only the rules strip toggles
  const banner = document.getElementById('regime-banner');
  const display = document.getElementById('regime-state');
  if (display) display.className = 'cmdbar-context-btn ' + state.regime;
  const text = document.getElementById('regime-text');
  if (text) text.textContent = data.text;
  const contextRegime = document.getElementById('cmdbar-context-regime');
  if (contextRegime) {
    const pct = (getRiskPctForRegime(state.regime) * 100).toFixed(2).replace(/\.?0+$/, '');
    contextRegime.textContent = `${data.text} (${pct}%)`;
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

  // Hidden legacy element — preserved as data source for any external readers / tests
  const legacy = document.getElementById('regime-rules');
  if (legacy) legacy.innerHTML = rulesHtml;

  // Drive the colored top accent line on cmdbar
  if (banner) {
    banner.classList.remove('risk-on', 'neutral', 'risk-off');
    banner.classList.add(data.bannerClass);
  }

}

// ---------- Pre-trade check ----------
function getTodayLossCount() {
  const today = new Date().toISOString().split('T')[0];
  return state.trades.filter(t =>
    t.status === 'loss' && t.exit_date === today
  ).length;
}

function getOpenPositionsCount() {
  return state.trades.filter(t => t.status === 'open').length;
}

function renderPretradeCheck() {
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

function togglePretradeCheck(key) {
  // Only manual checks (vix, news) can be toggled
  if (key !== 'vix' && key !== 'news') return;
  state.pretradeChecks[key] = !state.pretradeChecks[key];
  saveState();
  renderPretradeCheck();
  if (typeof renderTrade === 'function') renderTrade();
}

// ---------- IV Rank Strategy ----------
function getStrategyForIVR(ivr, direction) {
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

function deriveSpreadPct(liq) {
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

function liquidityOK() {
  const liq = state.liquidity || {};
  if (state.instrument === "stocks") {
    return Number(liq.stockVol) >= 1000000;
  }
  const bid = Number(liq.bid);
  const ask = Number(liq.ask);
  if (!(bid > 0 && ask > 0 && ask >= bid)) return false;
  const mid = (bid + ask) / 2;
  const derivedSpread = mid > 0 ? ((ask - bid) / mid) * 100 : null;
  return Number(liq.stockVol) >= 1000000
      && Number(liq.optionOI) >= 500
      && Number(liq.optionVol) >= 100
      && derivedSpread !== null && derivedSpread <= 5;
}

// ---------- Trade Log ----------
// genTradeId, tradeInstrument, tradeMultiplier → src/models/trade.js

function tradeRiskDollars(t) {
  const explicit = Number(t && t.riskDollars);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const entry = Number(t && t.entry);
  const stop = Number(t && t.stop);
  const qty = (typeof tradeQty === 'function') ? tradeQty(t) : Number((t && (t.qty ?? t.contracts ?? t.shares)) || 0);
  if (Number.isFinite(entry) && Number.isFinite(stop) && entry > 0 && stop > 0 && qty > 0) {
    return Math.abs(entry - stop) * tradeMultiplier(t) * qty;
  }

  const settings = state.settings || DEFAULT_SETTINGS || {};
  const fallbackStopPct = ((settings.stopPct || 50) / 100);
  return (Number.isFinite(entry) && entry > 0 && qty > 0)
    ? entry * fallbackStopPct * tradeMultiplier(t) * qty
    : 0;
}

// isClosedTrade, calcPL → src/models/trade.js

// R-multiple: P/L expressed in units of risk dollars. 2R = 2x risk dollars profit.
function calcR(t) {
  const pl = calcPL(t);
  if (pl === null) return null;
  const risk = tradeRiskDollars(t) || 1;
  if (!risk || risk === 0) return null;
  return pl / risk;
}

// dateOffsetISO → src/models/formatters.js
// normalizeProcessQuality, processQualityLabel → src/models/trade.js

function addTestTrades() {
  const ok = confirm(
    'Generate 25 random test trades?\n\n' +
    'They will be saved locally and pushed to Supabase if you are signed in.'
  );
  if (!ok) return;

  const batchId = Date.now().toString(36).toUpperCase();
  const nowIso = new Date().toISOString();
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const rand = (min, max, decimals = 2) => Number((min + Math.random() * (max - min)).toFixed(decimals));
  const swingSetups = ['21-EMA Pullback', 'Base Breakout', 'Breakout Retest', '9-EMA Reclaim', 'Edge Reversal'];
  const intradaySetups = TRADE_INTRADAY_SETUPS.map(s => s.id);
  const tickers = ['AAPL','MSFT','NVDA','TSLA','META','AMZN','AMD','AVGO','GOOGL','NFLX','SPY','QQQ','IWM','COIN','PLTR'];
  const regimes = ['RISK-ON', 'NEUTRAL', 'RISK-OFF'];
  const grades = ['clean', 'clean', 'mixed', 'broken'];
  const emotions = ['calm', 'focused', 'anxious', 'rushed', 'patient'];
  const exitReasons = ['target', 'stop', 'thesis-broke', 'discretionary', 'time'];

  const sampleTrades = Array.from({ length: 25 }, (_, i) => {
    const mode = Math.random() < 0.65 ? 'swing' : 'intraday';
    const instrument = Math.random() < 0.18 ? 'stocks' : 'options';
    const statusRoll = Math.random();
    const status = statusRoll < 0.14 ? 'open' : statusRoll < 0.62 ? 'win' : 'loss';
    const daysAgo = Math.floor(Math.random() * 75);
    const holdDays = mode === 'intraday' ? 0 : Math.max(1, Math.floor(Math.random() * 14));
    const setup = mode === 'intraday' ? pick(intradaySetups) : pick(swingSetups);
    const setupDef = mode === 'intraday' ? TRADE_INTRADAY_SETUPS.find(s => s.id === setup) : null;
    const direction = mode === 'intraday' && setupDef && setupDef.bias !== 'either'
      ? (setupDef.bias === 'short' ? 'Short' : 'Long')
      : pick(['Long', 'Short']);
    const dirKey = direction === 'Short' ? 'short' : 'long';
    const entry = instrument === 'stocks' ? rand(35, 420, 2) : rand(0.55, 8.5, 2);
    const qty = instrument === 'stocks' ? Math.floor(rand(5, 80, 0)) : Math.floor(rand(1, 6, 0));
    const riskDollars = instrument === 'stocks'
      ? Math.round(entry * qty * rand(0.015, 0.06, 3))
      : Math.round(entry * 100 * qty * rand(0.35, 0.7, 2));
    const plR = status === 'open' ? null : status === 'win' ? rand(0.45, 2.8, 2) : -rand(0.35, 1.35, 2);
    const multiplier = instrument === 'stocks' ? 1 : 100;
    const exit = status === 'open' ? null : Math.max(0.05, entry + ((riskDollars * plR) / (multiplier * qty)));
    const tradeDate = dateOffsetISO(daysAgo);
    const exitDate = status === 'open' ? null : dateOffsetISO(Math.max(0, daysAgo - holdDays));
    const time = mode === 'intraday' ? `${String(Math.floor(rand(9, 15, 0))).padStart(2, '0')}:${String(Math.floor(rand(0, 59, 0))).padStart(2, '0')}` : null;
    const spreadPct = mode === 'intraday' && instrument === 'options' ? rand(1.2, 6.5, 1) : null;
    const mid = spreadPct !== null ? Number((entry * rand(0.985, 1.015, 3)).toFixed(2)) : null;
    const halfSpread = mid && spreadPct !== null ? mid * (spreadPct / 100) / 2 : null;
    const bid = halfSpread !== null ? Math.max(0.01, Number((mid - halfSpread).toFixed(2))) : null;
    const ask = halfSpread !== null ? Number((mid + halfSpread).toFixed(2)) : null;
    const alignedConf = dirKey === 'short' ? 'short-bias' : 'long-bias';
    const oppositeConf = dirKey === 'short' ? 'long-bias' : 'short-bias';
    const confluence = mode === 'intraday' ? (Math.random() < 0.68 ? alignedConf : pick(['mixed', oppositeConf])) : '';
    const breadth = mode === 'intraday' ? (Math.random() < 0.65 ? (dirKey === 'short' ? 'down' : 'up') : pick(['flat', dirKey === 'short' ? 'up' : 'down'])) : '';
    const isOrb = mode === 'intraday' && setupDef && setupDef.isOrb;
    const orMid = isOrb ? rand(80, 520, 2) : null;
    const orRng = isOrb ? rand(0.35, 4.8, 2) : null;
    const orHi = isOrb ? Number((orMid + orRng / 2).toFixed(2)) : null;
    const orLo = isOrb ? Number((orMid - orRng / 2).toFixed(2)) : null;
    return {
      id: `test_${batchId}_${String(i + 1).padStart(2, '0')}_${Math.random().toString(36).slice(2, 6)}`,
      mode,
      instrument,
      date: tradeDate,
      time,
      ticker: pick(tickers),
      setup,
      direction,
      entry,
      stop: instrument === 'stocks' ? Number((entry * (direction === 'Long' ? 0.96 : 1.04)).toFixed(2)) : Number((entry * 0.55).toFixed(2)),
      target: status === 'open' ? null : Number((entry * (status === 'win' ? 1.55 : 0.75)).toFixed(2)),
      contracts: qty,
      shares: instrument === 'stocks' ? qty : null,
      ivr: mode === 'swing' && instrument !== 'stocks' ? Math.floor(rand(12, 78, 0)) : null,
      spreadPct,
      bid,
      ask,
      mid,
      confluence,
      breadth,
      orbType: isOrb ? pick(['5', '15', '30']) : null,
      orHi,
      orLo,
      orRng,
      vwapValue: mode === 'intraday' ? rand(80, 520, 2) : null,
      vwapRel: mode === 'intraday' ? (confluence === 'long-bias' ? 'above' : confluence === 'short-bias' ? 'below' : 'at') : '',
      regime: pick(regimes),
      thesis: `Random test ${mode} trade ${i + 1} from batch ${batchId}.`,
      premortem: 'Generated sample data for layout and stats testing.',
      notes: mode === 'intraday' ? `Random intraday sample ${i + 1}.` : '',
      riskDollars,
      inWindow: mode === 'intraday' ? Math.random() > 0.12 : null,
      tradeNumOfDay: mode === 'intraday' ? Math.floor(rand(1, 5, 0)) : null,
      status,
      exit: exit === null ? null : Number(exit.toFixed(2)),
      exit_date: exitDate,
      grade: status === 'open' ? null : pick(grades),
      followed_plan: status === 'open' ? null : pick(['yes', 'yes', 'partial', 'no']),
      emotion: status === 'open' ? null : pick(emotions),
      exit_reason: status === 'open' ? null : (status === 'win' ? pick(['target', 'discretionary', 'time']) : pick(exitReasons)),
      lesson: status === 'open' ? null : `Generated trade ${i + 1}: review stats, row layout, and filtering.`,
      created_at: nowIso,
      updated_at: nowIso,
    };
  });

  state.trades.push(...sampleTrades);
  saveState();
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }
  renderHome();
  renderLogStats();
  renderLogTable();
  renderPretradeCheck();
  if (typeof renderTrade === 'function') renderTrade();
  toast(`Generated ${sampleTrades.length} random test trades`);
}

// ──────────────────────────────────────────────────────────
//  Alpha Intel — glossary panel
// ──────────────────────────────────────────────────────────
function openAIGlossary() {
  // Sync the dynamic window label with the user's Settings value.
  const days = (state.settings && state.settings.killSwitchDays) || 30;
  document.querySelectorAll('[data-ai-glossary-window]').forEach(el => {
    el.textContent = days;
  });
  const panel = document.getElementById('ai-glossary-panel');
  const back  = document.getElementById('ai-glossary-backdrop');
  if (!panel || !back) return;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  back.classList.add('open');
}
function closeAIGlossary() {
  const panel = document.getElementById('ai-glossary-panel');
  const back  = document.getElementById('ai-glossary-backdrop');
  if (!panel || !back) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  back.classList.remove('open');
}

// ──────────────────────────────────────────────────────────
//  Rolling P/L over the kill-switch window. Single source of
//  truth for both Home and Stats. Returns { totalPL, pct, days,
//  count, winRate }.
// ──────────────────────────────────────────────────────────
function computeRollingPL() {
  const days = (state.settings && state.settings.killSwitchDays) || 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const closed = (state.trades || []).filter(t => isClosedTrade(t) && (t.exit_date || t.date));
  const recent = closed.filter(t => new Date(t.exit_date || t.date).getTime() >= cutoff);
  const totalPL = recent.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const wins = recent.filter(t => (calcPL(t) || 0) > 0).length;
  const account = (state.settings && state.settings.account) || 10000;
  const winRate = recent.length ? Math.round(wins / recent.length * 100) : null;
  return { totalPL, pct: (totalPL / account * 100), days, count: recent.length, winRate };
}

function alphaEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

function alphaMoney(v) {
  const n = Number(v) || 0;
  return `${n >= 0 ? '+$' : '-$'}${Math.abs(Math.round(n)).toLocaleString()}`;
}

function alphaR(v) {
  const n = Number(v) || 0;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}R`;
}

function alphaDirectionKey(t) {
  if (typeof tradeBias === 'function') return tradeBias(t) === 'bearish' ? 'short' : 'long';
  const d = String((t && t.direction) || '').toLowerCase();
  return /short|put|bear/.test(d) ? 'short' : 'long';
}

function alphaIntradaySetupDef(t) {
  const raw = String((t && t.setup) || '').trim();
  if (!raw || typeof TRADE_INTRADAY_SETUPS === 'undefined') return null;
  return TRADE_INTRADAY_SETUPS.find(s =>
    s.id === raw ||
    s.name.toUpperCase() === raw.toUpperCase()
  ) || null;
}

function alphaSetupBias(t) {
  const def = alphaIntradaySetupDef(t);
  if (def && def.bias && def.bias !== 'either') return def.bias;
  const setup = String((t && t.setup) || '').toUpperCase();
  if (/\b(DN|DOWN|BELOW|LOSS|SHORT)\b/.test(setup)) return 'short';
  if (/\b(UP|ABOVE|RECLAIM|LONG|BREAK|RETEST|MOMO|TREND)\b/.test(setup)) return 'long';
  return null;
}

function alphaConfluenceBias(t) {
  const id = (t && t.confluence) || '';
  if (id && typeof TRADE_CONFLUENCE_OPTIONS !== 'undefined') {
    const def = TRADE_CONFLUENCE_OPTIONS.find(c => c.id === id);
    if (def && def.bias && def.bias !== 'either') return def.bias;
    if (def && def.bias === 'either') return 'either';
  }
  const rel = String((t && t.vwapRel) || '').toLowerCase();
  if (rel === 'above') return 'long';
  if (rel === 'below') return 'short';
  if (rel === 'at' || rel === 'mixed') return 'either';
  return null;
}

function alphaBreadthBias(t) {
  const b = String((t && t.breadth) || '').toLowerCase();
  if (b === 'up') return 'long';
  if (b === 'down') return 'short';
  return null;
}

function alphaContextAlignment(t) {
  if (!t || t.mode !== 'intraday') return { bucket: null, score: null, checks: 0 };
  const dir = alphaDirectionKey(t);
  const checks = [];
  const setupBias = alphaSetupBias(t);
  const confBias = alphaConfluenceBias(t);
  const breadthBias = alphaBreadthBias(t);

  if (setupBias) checks.push(setupBias === dir);
  if (confBias && confBias !== 'either') checks.push(confBias === dir);
  if (breadthBias) checks.push(breadthBias === dir);

  if (!checks.length) return { bucket: 'No context', score: null, checks: 0 };
  const pass = checks.filter(Boolean).length;
  const score = Math.round(pass / checks.length * 100);
  const bucket = score >= 75 ? 'Aligned' : score >= 40 ? 'Mixed' : 'Conflicted';
  return { bucket, score, checks: checks.length };
}

function alphaSpreadValue(t) {
  if (!t || tradeInstrument(t) !== 'options') return null;
  const spread = deriveSpreadPct(t);
  return Number.isFinite(Number(spread)) ? Number(spread) : null;
}

function alphaSpreadBucket(t) {
  const spread = alphaSpreadValue(t);
  if (spread === null) return null;
  const max = (state.settings && state.settings.intradayMaxSpreadPct) || 5;
  if (spread <= 2) return 'Tight 0-2%';
  if (spread <= max) return `Tradable 2-${max}%`;
  return `Wide over ${max}%`;
}

function alphaFillQuality(t) {
  if (!t || tradeInstrument(t) !== 'options') return null;
  const entry = Number(t.entry);
  const bid = Number(t.bid);
  const ask = Number(t.ask);
  const mid = Number(t.mid) || ((bid > 0 && ask > 0) ? (bid + ask) / 2 : null);
  if (!entry || !mid || entry <= 0 || mid <= 0) return null;
  const slipPct = ((entry - mid) / mid) * 100;
  const slipDollars = (entry - mid) * tradeMultiplier(t) * Math.max(1, tradeQty(t));
  const bucket = slipPct <= 0 ? 'Mid or better' : slipPct <= 1 ? 'Near mid' : 'Above mid';
  return { bucket, slipPct, slipDollars };
}

function alphaTimeBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const raw = String(t.time || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) {
    if (t.inWindow === false) return 'Outside window';
    if (t.inWindow === true) return 'In window';
    return null;
  }
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes >= 9 * 60 + 35 && minutes <= 11 * 60 + 30) return 'Morning window';
  if (minutes >= 14 * 60 && minutes <= 15 * 60 + 30) return 'Afternoon window';
  if (minutes > 11 * 60 + 30 && minutes < 14 * 60) return 'Midday';
  return 'Outside window';
}

function alphaOrbDirectionBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const setup = String(t.setup || '').toUpperCase();
  const hasOrb = /ORB/.test(setup) || t.orHi != null || t.orLo != null || t.orRng != null;
  if (!hasOrb) return null;
  const bias = alphaSetupBias(t) || alphaDirectionKey(t);
  return bias === 'short' ? 'ORB down' : 'ORB up';
}

function alphaOrbRangeBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const rng = Number(t.orRng);
  if (!Number.isFinite(rng) || rng <= 0) return null;
  const ref = Number(t.orHi) || Number(t.orLo) || null;
  const pct = ref && ref > 0 ? (rng / ref) * 100 : null;
  if (pct !== null) {
    if (pct <= 0.25) return 'Tight OR range';
    if (pct <= 0.75) return 'Normal OR range';
    return 'Wide OR range';
  }
  if (rng <= 0.75) return 'Tight OR range';
  if (rng <= 2) return 'Normal OR range';
  return 'Wide OR range';
}

function alphaVwapBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  if (t.confluence && typeof TRADE_CONFLUENCE_OPTIONS !== 'undefined') {
    const def = TRADE_CONFLUENCE_OPTIONS.find(c => c.id === t.confluence);
    if (def) return def.label;
  }
  const rel = String(t.vwapRel || '').toLowerCase();
  if (rel === 'above') return 'ABOVE VWAP';
  if (rel === 'below') return 'BELOW VWAP';
  if (rel === 'at') return 'AT VWAP';
  return null;
}

function alphaFrictionScore(t) {
  if (!t || t.mode !== 'intraday') return null;
  const parts = [];
  if (tradeInstrument(t) === 'options') {
    const spread = alphaSpreadValue(t);
    if (spread !== null) parts.push(spread <= ((state.settings && state.settings.intradayMaxSpreadPct) || 5) ? 1 : 0);
    const fill = alphaFillQuality(t);
    if (fill) parts.push(fill.slipPct <= 1 ? 1 : fill.slipPct <= 3 ? 0.5 : 0);
  }
  if (typeof t.inWindow === 'boolean') parts.push(t.inWindow ? 1 : 0);
  const align = alphaContextAlignment(t);
  if (align.score !== null) parts.push(align.score >= 75 ? 1 : align.score >= 40 ? 0.5 : 0);
  if (t.tradeNumOfDay != null) parts.push(Number(t.tradeNumOfDay) <= 3 ? 1 : 0.5);
  if (!parts.length) return null;
  return Math.round(parts.reduce((s, x) => s + x, 0) / parts.length * 100);
}

function alphaFrictionBucket(t) {
  const score = alphaFrictionScore(t);
  if (score === null) return null;
  if (score >= 80) return 'Low friction';
  if (score >= 55) return 'Moderate friction';
  return 'High friction';
}

function alphaSummarizeRows(label, rows) {
  const n = rows.length;
  const pl = rows.reduce((s, x) => s + x.pl, 0);
  const wins = rows.filter(x => x.pl > 0).length;
  const totalR = rows.reduce((s, x) => s + x.r, 0);
  const targetHits = rows.filter(x =>
    x.trade.exit_reason === 'target' ||
    (Array.isArray(x.trade.outcome_tags) && x.trade.outcome_tags.includes('target_hit'))
  ).length;
  return {
    label,
    rows,
    n,
    pl,
    wins,
    winRate: n ? Math.round(wins / n * 100) : 0,
    avgR: n ? totalR / n : 0,
    targetRate: n ? Math.round(targetHits / n * 100) : null,
  };
}

function alphaGroupClosedRows(rows, classifier) {
  const map = {};
  rows.forEach(row => {
    const label = classifier(row.trade, row);
    if (!label) return;
    if (!map[label]) map[label] = [];
    map[label].push(row);
  });
  return Object.entries(map)
    .map(([label, groupRows]) => alphaSummarizeRows(label, groupRows))
    .sort((a, b) => b.pl - a.pl);
}

function alphaRowsHtml(groups, emptyText, opts = {}) {
  const visible = (groups || []).filter(g => g.n > 0);
  if (!visible.length) return `<div class="alpha-edge-empty">${alphaEsc(emptyText)}</div>`;
  const maxAbs = Math.max(1, ...visible.map(g => Math.abs(g.pl)));
  return visible.map(g => {
    const color = g.color || (g.pl > 0 ? 'pos' : g.pl < 0 ? 'neg' : 'neutral');
    const subParts = [
      `${g.n} trade${g.n === 1 ? '' : 's'}`,
      `${g.winRate}%W`,
      `${alphaR(g.avgR)} avg`,
    ];
    if (opts.showTargetRate && g.targetRate !== null) subParts.push(`${g.targetRate}% target`);
    if (g.extraSub) subParts.push(g.extraSub);
    return `
      <div class="bar-row">
        <div class="bar-row-label">${alphaEsc(g.label)}<span class="bar-row-sub">${alphaEsc(subParts.join(' · '))}</span></div>
        <div class="bar-wrap"><div class="bar-fill ${color}" style="width:${Math.max(4, Math.abs(g.pl) / maxAbs * 100).toFixed(0)}%"></div></div>
        <div class="bar-value ${g.pl >= 0 ? 'pl-positive' : 'pl-negative'}">${alphaMoney(g.pl)}</div>
      </div>`;
  }).join('');
}

function alphaSection(title, body) {
  return `<div class="alpha-edge-section"><div class="ai-section-title">${alphaEsc(title)}</div>${body}</div>`;
}

function buildAlphaHighlightBullets(closedWithPL) {
  const bullets = [];
  const intraday = closedWithPL.filter(x => x.trade.mode === 'intraday');
  const intradayOptions = intraday.filter(x => tradeInstrument(x.trade) === 'options');
  const spreadGroups = alphaGroupClosedRows(intradayOptions, t => alphaSpreadBucket(t));
  const tight = spreadGroups.find(g => g.label === 'Tight 0-2%');
  const wide = spreadGroups.find(g => /^Wide/.test(g.label));
  if ((tight && tight.n >= 2) || (wide && wide.n >= 2)) {
    if (wide && wide.n >= 2 && wide.avgR < 0) {
      bullets.push({
        tone: 'warn',
        icon: 'SP',
        text: `<strong>Spread drag is real:</strong> wide-spread intraday options average ${alphaR(wide.avgR)} across ${wide.n} trades. Keep bid/ask tight or switch to stock.`,
      });
    } else if (tight && tight.n >= 2) {
      bullets.push({
        tone: tight.avgR >= 0 ? 'good' : 'warn',
        icon: 'SP',
        text: `<strong>Tight-spread trades average ${alphaR(tight.avgR)}</strong> across ${tight.n} entries. That is your cleanest execution bucket.`,
      });
    }
  }

  const contextGroups = alphaGroupClosedRows(intraday, t => {
    const a = alphaContextAlignment(t);
    return a.score === null ? null : a.bucket;
  });
  const aligned = contextGroups.find(g => g.label === 'Aligned');
  const conflicted = contextGroups.find(g => g.label === 'Conflicted');
  if ((aligned && aligned.n >= 2) || (conflicted && conflicted.n >= 2)) {
    if (aligned && (!conflicted || aligned.avgR >= conflicted.avgR)) {
      bullets.push({
        tone: aligned.avgR >= 0 ? 'good' : 'warn',
        icon: 'CTX',
        text: `<strong>Context-aligned intraday trades average ${alphaR(aligned.avgR)}</strong> (${aligned.winRate}% wins). VWAP, setup, and breadth are worth logging.`,
      });
    } else if (conflicted) {
      bullets.push({
        tone: 'warn',
        icon: 'CTX',
        text: `<strong>Conflicted context averages ${alphaR(conflicted.avgR)}</strong>. When setup, VWAP, or breadth disagree, your edge drops.`,
      });
    }
  }

  const instrumentGroups = alphaGroupClosedRows(closedWithPL, t => tradeInstrument(t) === 'stocks' ? 'Stock' : 'Options');
  const stocks = instrumentGroups.find(g => g.label === 'Stock');
  const options = instrumentGroups.find(g => g.label === 'Options');
  if (stocks && options && stocks.n >= 3 && options.n >= 3) {
    const better = stocks.avgR >= options.avgR ? stocks : options;
    const weaker = better === stocks ? options : stocks;
    bullets.push({
      tone: better.avgR >= 0 ? 'good' : 'warn',
      icon: 'TYPE',
      text: `<strong>${better.label} is ahead:</strong> ${alphaR(better.avgR)} avg vs ${alphaR(weaker.avgR)} for ${weaker.label.toLowerCase()}. Route marginal setups to the stronger instrument.`,
    });
  }

  return bullets;
}

function buildAlphaEdgeCard(closedWithPL, help) {
  if (!closedWithPL.length) return '';
  const intraday = closedWithPL.filter(x => x.trade.mode === 'intraday');
  const intradayOptions = intraday.filter(x => tradeInstrument(x.trade) === 'options');
  const instrumentGroups = alphaGroupClosedRows(closedWithPL, t => tradeInstrument(t) === 'stocks' ? 'Stock' : 'Options');
  const spreadGroups = alphaGroupClosedRows(intradayOptions, t => alphaSpreadBucket(t));
  const fillGroups = alphaGroupClosedRows(intradayOptions, t => {
    const f = alphaFillQuality(t);
    return f ? f.bucket : null;
  }).map(g => {
    const fills = g.rows.map(x => alphaFillQuality(x.trade)).filter(Boolean);
    const avgSlip = fills.length ? fills.reduce((s, f) => s + f.slipPct, 0) / fills.length : null;
    return { ...g, extraSub: avgSlip === null ? '' : `${avgSlip >= 0 ? '+' : ''}${avgSlip.toFixed(1)}% vs mid` };
  });

  const contextGroups = alphaGroupClosedRows(intraday, t => {
    const a = alphaContextAlignment(t);
    return a.score === null ? null : a.bucket;
  });
  const orbDirectionGroups = alphaGroupClosedRows(intraday, t => alphaOrbDirectionBucket(t));
  const orbRangeGroups = alphaGroupClosedRows(intraday, t => alphaOrbRangeBucket(t));
  const vwapGroups = alphaGroupClosedRows(intraday, t => alphaVwapBucket(t));
  const timeGroups = alphaGroupClosedRows(intraday, t => alphaTimeBucket(t));
  const frictionGroups = alphaGroupClosedRows(intraday, t => alphaFrictionBucket(t));

  const executionHtml = `
    ${alphaSection('Stock vs options edge', alphaRowsHtml(instrumentGroups, 'Log closed stock and option trades to compare which instrument is paying you.'))}
    ${alphaSection('Spread drag', alphaRowsHtml(spreadGroups, 'Intraday option trades with bid/ask or spread data will show spread drag here.'))}
    ${alphaSection('Fill quality', alphaRowsHtml(fillGroups, 'Paste or enter bid/ask so entry can be compared against mid price.'))}
  `;

  const contextHtml = `
    ${alphaSection('Context alignment', alphaRowsHtml(contextGroups, 'Intraday trades with setup, VWAP confluence, or breadth context will appear here.'))}
    ${alphaSection('ORB quality', `
      ${alphaRowsHtml(orbDirectionGroups, 'ORB trades will split by up-break vs down-break.', { showTargetRate: true })}
      <div class="alpha-edge-note">Range buckets use OR range as a percent of the opening range level when available.</div>
      ${alphaRowsHtml(orbRangeGroups, 'Add OR_HI, OR_LO, and RNG from the TOS alert to unlock OR range buckets.', { showTargetRate: true })}
    `)}
    ${alphaSection('VWAP edge', alphaRowsHtml(vwapGroups, 'VWAP confluence labels will show whether long-bias, short-bias, or mixed labels perform best.'))}
    ${alphaSection('Time and friction', `
      ${alphaRowsHtml(timeGroups, 'Intraday trade time will split results by morning, midday, afternoon, and outside-window entries.')}
      <div class="alpha-edge-note">Friction blends spread, fill quality, window discipline, context alignment, and trade number of day.</div>
      ${alphaRowsHtml(frictionGroups, 'Add execution and context fields to unlock friction scoring.')}
    `)}
  `;

  return `
    <div class="home-row stats-card-row">
      <div class="home-card">
        <div class="home-card-title">Execution Intelligence${help('Uses the new stock/options, bid, ask, mid, spread, and quantity fields to find execution drag.')}</div>
        ${executionHtml}
      </div>
      <div class="home-card">
        <div class="home-card-title">Intraday Context Intelligence${help('Uses ORB, VWAP confluence, breadth, time window, and friction fields from the intraday ticket.')}</div>
        ${contextHtml}
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────
//  buildAlphaIntel — returns the alpha-intel HTML block.
//  Called by renderLogStats; accepts pre-computed aggregates.
// ──────────────────────────────────────────────────────────
function buildAlphaIntel(closed, closedWithPL, wins, losses, expectancy, avgR, profitFactor, trades) {
  const n = closed.length;
  const helpBtn = '<button type="button" class="ai-help-btn" onclick="openAIGlossary()" title="What do these numbers mean?" aria-label="Open glossary">?</button>';

  // ── zero-data state ──────────────────────────────────────
  if (n === 0) {
    return `
      <div class="home-card ai-empty" style="margin-bottom: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div class="home-card-title" style="color:var(--cyan); margin: 0;">Alpha Intelligence${helpBtn}</div>
        </div>
        <div class="ai-empty-body">
          <div class="ai-empty-icon">⌁</div>
          <div class="ai-empty-msg"><strong>No closed trades yet.</strong> Log a few exits — wins or losses — and this card will surface your strongest pattern, biggest leak, and any stop-trading alerts.</div>
        </div>
      </div>`;
  }

  // ── shared computations ──────────────────────────────────
  const totalPL = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRate = Math.round(wins.length / n * 100);
  const avgWin  = wins.length  ? wins.reduce((s, x) => s + x.pl, 0)  / wins.length  : 0;
  const avgLoss = losses.length ? losses.reduce((s, x) => s + x.pl, 0) / losses.length : 0;

  // Setup-level aggregate
  const setupMap = {};
  closed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { name: k, n: 0, wins: 0, pl: 0, totalR: 0 };
    const pl = calcPL(t) || 0;
    setupMap[k].n++;
    if (pl > 0) setupMap[k].wins++;
    setupMap[k].pl += pl;
    setupMap[k].totalR += calcR(t) || 0;
  });
  const setups = Object.values(setupMap).sort((a, b) => b.pl - a.pl);
  const bestSetup  = setups[0] || null;
  const worstSetup = setups.length > 1 ? setups[setups.length - 1] : null;

  // Exit-reason breakdown — discretionary + thesis-broke are the early-exit leak.
  const byExit = r => closed.filter(t => t.exit_reason === r);
  const discCount = byExit('discretionary').length + byExit('thesis-broke').length;
  const discPL    = [...byExit('discretionary'), ...byExit('thesis-broke')]
                      .reduce((s, t) => s + (calcPL(t) || 0), 0);

  // Process quality — % of reviewed trades graded "Good" (followed plan).
  const graded = closed.filter(t => t.grade);
  const goodCount = graded.filter(t => normalizeProcessQuality(t.grade) === 'clean').length;
  const gradeScore = graded.length ? Math.round(goodCount / graded.length * 100) : null;

  // Kill switch — uses ROLLING window (Settings.killSwitchDays). Career
  // P/L was the wrong measure: someone with $5k of lifetime gains and a
  // recent $1k drawdown should not be killed by their lifetime number.
  const rolling = computeRollingPL();
  const killActive = rolling.pct <= -7;

  // Money-readable formatter — keeps strings short and consistent.
  const $ = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(Math.round(v)).toLocaleString()}`;

  // ── headline diagnostic ─────────────────────────────────
  let headline = '', headlineTone = 'good';

  if (n < 5) {
    headline = `Career: ${$(totalPL)} from ${n} closed trade${n === 1 ? '' : 's'} — patterns need ~10 to be reliable.`;
    headlineTone = 'info';
  } else if (killActive) {
    headline = `Last ${rolling.days} days down ${Math.abs(rolling.pct).toFixed(1)}% of account — kill switch active. Stop sizing up until P/L recovers.`;
    headlineTone = 'danger';
  } else if (gradeScore !== null && gradeScore < 60 && graded.length >= 5) {
    headline = `Only ${gradeScore}% of reviewed trades followed the plan. Process discipline is the priority — fix execution before adding size.`;
    headlineTone = 'warn';
  } else if (avgWin > 0 && avgLoss < 0 && Math.abs(avgLoss) > avgWin * 1.2) {
    headline = `Win rate ${winRate}% but losses run ${(Math.abs(avgLoss)/avgWin).toFixed(1)}× larger than wins. Tighten stops or cut faster.`;
    headlineTone = 'warn';
  } else if (discCount >= 3 && discPL < 0) {
    headline = `Discretionary / thesis-broke exits cost ${$(-Math.abs(discPL))} so far — main leak. Stick to target/stop, let winners run.`;
    headlineTone = 'warn';
  } else if (bestSetup && bestSetup.pl > 0) {
    const wr = Math.round(bestSetup.wins / bestSetup.n * 100);
    headline = `${bestSetup.name} is your edge: ${$(bestSetup.pl)} across ${bestSetup.n} trade${bestSetup.n === 1 ? '' : 's'} (${wr}% win rate). Lean into it.`;
    headlineTone = 'good';
  } else if (expectancy > 0 && avgR >= 0.5) {
    headline = `Positive edge: ${$(expectancy)} per trade, ${avgR.toFixed(2)}R average. Stay consistent.`;
    headlineTone = 'good';
  } else {
    headline = `Edge per trade: ${$(expectancy)} (${avgR.toFixed(2)}R). ${expectancy >= 0 ? 'Profitable — protect the process.' : 'Negative — review setup selection and sizing.'}`;
    headlineTone = expectancy >= 0 ? 'good' : 'warn';
  }

  // ── bullets — career-focused, plain English, max 5 ───────
  const bullets = [];

  // 1. Career line — the headline number, plus the metrics in one breath.
  bullets.push({
    tone: totalPL >= 0 ? 'good' : 'bad',
    icon: '📈',
    text: `<strong>Career: ${$(totalPL)}</strong> across ${n} trade${n === 1 ? '' : 's'} · ${winRate}% wins · avg ${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}× your risk per trade · profit factor ${profitFactor}.`,
  });

  // 2. Best vs worst setup — only if we have ≥5 trades and they differ.
  if (bestSetup && worstSetup && bestSetup.name !== worstSetup.name && n >= 5) {
    bullets.push({
      tone: bestSetup.pl >= 0 ? 'good' : 'warn',
      icon: '🎯',
      text: `Best pattern <strong>${bestSetup.name}</strong> (${$(bestSetup.pl)}) · weakest <strong style="color:var(--red-bright)">${worstSetup.name}</strong> (${$(worstSetup.pl)}). Size up the best, drop the worst.`,
    });
  } else if (n < 5) {
    bullets.push({
      tone: 'info', icon: '📋',
      text: `Setup-level breakdown unlocks at <strong>≥ 5 closed trades</strong>. Keep logging.`,
    });
  }

  buildAlphaHighlightBullets(closedWithPL).slice(0, 2).forEach(b => bullets.push(b));

  // 3. Process quality vs leak — pick the strongest signal.
  if (discCount >= 3 && discPL < 0) {
    bullets.push({
      tone: 'warn', icon: '🚪',
      text: `Early exits (gut call or thesis-broke) cost <strong>${$(-Math.abs(discPL))}</strong> across ${discCount} trade${discCount === 1 ? '' : 's'}. Letting them run more often would change the curve.`,
    });
  } else if (gradeScore !== null && graded.length >= 5) {
    const tone = gradeScore >= 80 ? 'good' : gradeScore >= 60 ? 'neutral' : 'bad';
    const verdict = gradeScore >= 80 ? 'execution is doing the work.'
                  : gradeScore >= 60 ? 'some drift — review Okay/Bad trades.'
                                     : 'execution quality is the next thing to fix.';
    bullets.push({ tone, icon: '📋', text: `<strong>${gradeScore}% of reviewed trades followed the plan</strong> — ${verdict}` });
  } else if (graded.length < 3 && n >= 5) {
    bullets.push({
      tone: 'info', icon: '📋',
      text: `<strong>${n - graded.length} trade${n - graded.length === 1 ? '' : 's'} ungraded.</strong> Mark them Good / Okay / Bad after each exit so stats can separate process from outcome.`,
    });
  }

  // 4. Recent-window bullet — small overlap with Home so a regression shows here too.
  if (rolling.count >= 3) {
    const tone = rolling.pct <= -7 ? 'bad' : rolling.pct < 0 ? 'warn' : 'good';
    const verdict = rolling.pct <= -7 ? 'kill switch active'
                  : rolling.pct < 0   ? 'in drawdown'
                                      : 'in form';
    bullets.push({
      tone, icon: '⏱',
      text: `Last ${rolling.days} days: <strong>${$(rolling.totalPL)}</strong> over ${rolling.count} closed (${rolling.pct >= 0 ? '+' : ''}${rolling.pct.toFixed(1)}% of account · ${rolling.winRate}% wins) — ${verdict}.`,
    });
  }

  // 5. Risk: avg win vs avg loss size, only if asymmetric.
  if (wins.length && losses.length && avgWin > 0 && avgLoss < 0 && Math.abs(avgLoss) > avgWin * 1.2) {
    bullets.push({
      tone: 'warn', icon: '⚖',
      text: `Avg win ${$(avgWin)} vs avg loss ${$(avgLoss)} — losses ${(Math.abs(avgLoss)/avgWin).toFixed(1)}× wider. Move stops in or cut sooner on broken setups.`,
    });
  }

  // ── kill-switch panel (only when active) ────────────────
  const ksHtml = killActive ? `
    <div class="ai-killswitch">
      <div class="ai-section-title">⚡ Kill switch active</div>
      <div class="alpha-intel-line danger"><span>Last ${rolling.days} days: ${$(rolling.totalPL)} (${rolling.pct.toFixed(1)}% of account) — past the -7% stop-trading line.</span></div>
      <div class="alpha-intel-line warn"><span>Pause new trades until P/L recovers. Window is editable in Settings → Alpha Intelligence.</span></div>
    </div>` : '';

  // ── assemble ─────────────────────────────────────────────
  let hlClass = '';
  if (headlineTone === 'warn') hlClass = 'neutral';
  if (headlineTone === 'danger' || headlineTone === 'bad') hlClass = 'risk-off';

  // Kicker mirrors Home's "Today's read" pattern — gives the card a clear
  // long-term identity and surfaces dataset size at a glance.
  const kickerText = `Career view · ${n} closed${graded.length ? ` · ${graded.length} graded` : ''}`;

  return `
    <div class="home-card green" style="margin-bottom: 0;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
        <div class="home-card-title" style="color:#7ee787; margin: 0; display: inline-flex; align-items: center;">Alpha Intelligence${helpBtn}</div>
        <div class="home-card-kicker" style="margin: 0;">${kickerText}</div>
      </div>
      <div class="home-intel-headline ${hlClass}">${headline}</div>
      <ul class="home-intel-points">
        ${bullets.slice(0, 6).map(b => `<li class="tone-${b.tone}"><span class="intel-icon">${b.icon}</span><span>${b.text}</span></li>`).join('')}
      </ul>
      ${ksHtml}
    </div>`;
}

function renderLogStats() {
  const container = document.getElementById('log-stats');
  const help = text => `<span class="stat-help" title="${text}">?</span>`;
  const filter = state.logModeFilter || 'all';
  const setupFilter = state.logSetupFilter || '';
  const modeTrades = filter === 'all' ? state.trades : state.trades.filter(t => (t.mode || 'swing') === filter);
  const trades = setupFilter ? modeTrades.filter(t => (t.setup || '—') === setupFilter) : modeTrades;
  const open   = trades.filter(t => t.status === 'open');
  const closed = trades.filter(t => isClosedTrade(t));
  const closedWithPL = closed.map(t => ({ trade: t, pl: calcPL(t) || 0, r: calcR(t) || 0 }));
  const wins   = closedWithPL.filter(x => x.pl > 0);
  const losses = closedWithPL.filter(x => x.pl < 0);

  // Core P/L
  const totalPL    = closedWithPL.reduce((s, x) => s + x.pl, 0);
  const winRateNum = closed.length > 0 ? wins.length / closed.length * 100 : null;
  const winRateStr = winRateNum !== null ? winRateNum.toFixed(0) + '%' : '—';
  const avgWin     = wins.length   ? wins.reduce((s, x) => s + x.pl, 0)   / wins.length   : 0;
  const avgLoss    = losses.length ? losses.reduce((s, x) => s + x.pl, 0) / losses.length : 0;
  const grossWin   = wins.reduce((s, x) => s + x.pl, 0);
  const grossLoss  = Math.abs(losses.reduce((s, x) => s + x.pl, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? '∞' : '—');
  const expectancy = closed.length > 0 ? totalPL / closed.length : 0;
  const avgR = closedWithPL.length ? closedWithPL.reduce((s, x) => s + x.r, 0) / closedWithPL.length : 0;

  // NEW: open exposure
  const settings = state.settings || {};
  const openRisk = open.reduce((s, t) => {
    const fallback = tradeRiskDollars(t);
    return s + (Number(t.riskDollars) || fallback || 0);
  }, 0);

  // NEW: R expectancy per trade = winRate × avgWin_R + lossRate × avgLoss_R
  const avgWinR  = wins.length   ? wins.reduce((s, x) => s + x.r, 0)   / wins.length   : 0;
  const avgLossR = losses.length ? losses.reduce((s, x) => s + x.r, 0) / losses.length : 0;
  const rExpectancy = winRateNum !== null
    ? (winRateNum / 100) * avgWinR + (1 - winRateNum / 100) * avgLossR
    : null;

  // ── Metric strip ──────────────────────────────────────────
  const plTone    = totalPL >= 0 ? 'pos' : 'neg';
  const wrTone    = winRateNum === null ? 'neutral' : winRateNum >= 50 ? 'pos' : winRateNum >= 45 ? 'amber' : 'neg';
  const avgRTone  = closed.length ? (avgR >= 0.5 ? 'pos' : avgR >= 0 ? 'neutral' : 'neg') : 'neutral';

  const metricCells = [
    {
      label: 'Total P/L', tone: plTone,
      help: 'Realized profit or loss across closed trades in the current filter. Open trades are counted separately.',
      value: (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toFixed(0),
      sub: `${closed.length} closed · ${open.length} open`,
    },
    {
      label: 'Win Rate', tone: wrTone,
      help: 'Percentage of closed trades with positive P/L. It does not measure how large wins or losses are.',
      value: winRateStr,
      sub: winRateNum !== null ? `${wins.length}W · ${losses.length}L` : 'no closed trades',
    },
    {
      label: 'Avg R / Trade', tone: avgRTone,
      help: 'Average result measured in units of risk. +1R means the trade made one times the planned risk.',
      value: closed.length ? (avgR >= 0 ? '+' : '') + avgR.toFixed(2) + 'R' : '—',
      sub: rExpectancy !== null ? `R exp: ${rExpectancy >= 0 ? '+' : ''}${rExpectancy.toFixed(2)}R` : '',
    },
    {
      label: 'Profit Factor', tone: 'cyan',
      help: 'Gross wins divided by gross losses. Above 1.00 means wins are larger than losses overall.',
      value: profitFactor,
      sub: grossLoss > 0 ? `$${grossWin.toFixed(0)} gross win` : '',
    },
    {
      label: 'Expectancy', tone: expectancy >= 0 ? 'pos' : 'neg',
      help: 'Average dollars made or lost per closed trade.',
      value: (expectancy >= 0 ? '+$' : '-$') + Math.abs(expectancy).toFixed(0),
      sub: 'per closed trade',
    },
    {
      label: 'Open Exposure', tone: openRisk > 0 ? 'amber' : 'neutral',
      help: 'Estimated dollars currently at risk in open positions.',
      value: open.length > 0 ? '$' + openRisk.toFixed(0) : '$0',
      sub: open.length > 0 ? `${open.length} position${open.length === 1 ? '' : 's'}` : 'no open positions',
    },
  ];

  const smsCells = metricCells.map(c => `
    <div class="sms-cell ${c.tone || 'neutral'}">
      <div class="sms-label">${c.label}${c.help ? help(c.help) : ''}</div>
      <div class="sms-value">${c.value}</div>
      ${c.extra ? c.extra : ''}
      ${c.sub ? `<div class="sms-sub">${c.sub}</div>` : ''}
    </div>`).join('');

  // ── Exit discipline panel ──────────────────────────────────
  const exitDefs = [
    { key: 'target',       label: 'Hit target',      color: 'pos' },
    { key: 'stop',         label: 'Stopped out',     color: 'neg' },
    { key: 'thesis-broke', label: 'Thesis broke',    color: 'amber' },
    { key: 'discretionary',label: 'Discretionary',   color: 'amber' },
    { key: 'time',         label: 'Time exit',       color: 'neutral' },
  ];
  const exitRows = exitDefs.map(d => {
    const group = closed.filter(t => t.exit_reason === d.key);
    if (!group.length) return null;
    const pl = group.reduce((s, t) => s + (calcPL(t) || 0), 0);
    const pct = Math.round(group.length / closed.length * 100);
    return { label: d.label, n: group.length, pct, pl, color: d.color };
  }).filter(Boolean);
  const maxExitPL = Math.max(...exitRows.map(r => Math.abs(r.pl)), 1);
  const exitHtml = exitRows.length ? exitRows.map(r => `
    <div class="bar-row">
      <div class="bar-row-label">${r.label}<span class="bar-row-sub">${r.n} trades · ${r.pct}%</span></div>
      <div class="bar-wrap"><div class="bar-fill ${r.color}" style="width:${Math.max(4, Math.abs(r.pl) / maxExitPL * 100).toFixed(0)}%"></div></div>
      <div class="bar-value ${r.pl >= 0 ? 'pl-positive' : 'pl-negative'}">${r.pl >= 0 ? '+$' : '-$'}${Math.abs(r.pl).toFixed(0)}</div>
    </div>`).join('')
    : `<div style="color:var(--ink-4);font-size:12px;padding:8px 0;">Exit reasons will appear once you close trades with a reason logged.</div>`;

  // ── Setup performance panel ────────────────────────────────
  const setupMap = {};
  const setupSourceClosed = modeTrades.filter(t => isClosedTrade(t));
  setupSourceClosed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { n: 0, wins: 0, pl: 0, totalR: 0 };
    const pl = calcPL(t) || 0;
    setupMap[k].n++;
    if (pl > 0) setupMap[k].wins++;
    setupMap[k].pl += pl;
    setupMap[k].totalR += calcR(t) || 0;
  });
  const setups = Object.entries(setupMap).sort((a, b) => b[1].pl - a[1].pl);
  const maxSetupPL = Math.max(...setups.map(([, s]) => Math.abs(s.pl)), 1);
  const setupHtml = setups.length ? setups.map(([name, s]) => {
    const wr  = Math.round(s.wins / s.n * 100);
    const avgRv = s.totalR / s.n;
    const isActive = setupFilter === name;
    const encodedName = encodeURIComponent(name).replace(/'/g, '%27');
    return `
      <button class="bar-row setup-filter-row ${isActive ? 'active' : ''}" type="button" onclick="setLogSetupFilter(decodeURIComponent('${encodedName}'))">
        <div class="bar-row-label">${name}<span class="bar-row-sub">${s.n}× · ${wr}%W · ${avgRv >= 0 ? '+' : ''}${avgRv.toFixed(2)}R avg</span></div>
        <div class="bar-wrap"><div class="bar-fill ${s.pl >= 0 ? 'pos' : 'neg'}" style="width:${Math.max(4, Math.abs(s.pl) / maxSetupPL * 100).toFixed(0)}%"></div></div>
        <div class="bar-value ${s.pl >= 0 ? 'pl-positive' : 'pl-negative'}">${s.pl >= 0 ? '+$' : '-$'}${Math.abs(s.pl).toFixed(0)}</div>
      </button>`;
  }).join('')
    : `<div style="color:var(--ink-4);font-size:12px;padding:8px 0;">Setup breakdown appears after your first closed trade.</div>`;

  // ── Assemble ──────────────────────────────────────────────
  const modeLabel = filter === 'all' ? 'All trades' : filter === 'swing' ? 'Swing only' : 'Intraday only';
  const filterLabel = setupFilter ? `${modeLabel} · ${setupFilter}` : modeLabel;
  const clearSetupHtml = setupFilter
    ? `<button class="stats-filter-clear" type="button" onclick="clearLogSetupFilter()">Clear setup</button>`
    : '';
  // ── CLT (Mean Convergence) panel ───────────────────────────
  const cltHtml = buildCltCard(closedWithPL, help);

  // ── TOS Backtest import panel ──────────────────────────────
  const backtestHtml = buildBacktestCard(help);

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
      ${buildAlphaIntel(closed, closedWithPL, wins, losses, expectancy, avgR, profitFactor, trades)}

      <div class="home-card">
        <div class="stats-snapshot-head">
          <div class="home-card-title" style="margin: 0;">Stats Snapshot${help('Six core indicators for the selected trade set. Use these for the fastest read on performance and risk.')}</div>
          <div class="stats-snapshot-meta">${filterLabel} · ${trades.length} total · ${closed.length} closed · ${open.length} open${clearSetupHtml}</div>
        </div>
        <div class="sms-grid" style="border-bottom: none;">${smsCells}</div>
      </div>

      ${buildAlphaEdgeCard(closedWithPL, help)}

      ${cltHtml}

      <div class="home-row stats-card-row">
        <div class="home-card">
          <div class="home-card-title">Setup Performance${help('Shows which setups are producing or losing money, including win rate and average R by setup.')}</div>
          ${setupHtml}
        </div>
        <div class="home-card">
          <div class="home-card-title">Exit Discipline${help('Shows where exits are happening and how much P/L each exit reason contributes.')}</div>
          ${exitHtml}
        </div>
      </div>

      ${backtestHtml}
    </div>
  `;
}

// ── Central Limit Theorem (Mean Convergence) card ─────────────
// Visualizes how the sample mean (avg R) converges on the true edge as N grows,
// and gives a 95% CI for the true mean using SE = sd / sqrt(n).
function buildCltCard(closedWithPL, help) {
  const n = closedWithPL.length;
  const empty = n < 2;
  const head = `
    <div class="home-card-title" style="margin: 0 0 6px;">Central Limit Theorem · Mean Convergence${help(
      'As your sample size grows, the average outcome converges on your true edge. ' +
      'The 95% confidence interval narrows by roughly 1/√N — doubling trades shrinks the band by ~30%.'
    )}</div>
    <div style="font-family: var(--mono); font-size: 11px; color: var(--ink-4); margin-bottom: 10px;">How tight is your edge estimate? Wider band = noisier sample.</div>`;

  if (empty) {
    return `<div class="home-card clt-card">
      ${head}
      <div class="clt-card-empty">Need at least 2 closed trades to estimate the mean and confidence band.</div>
    </div>`;
  }

  const rs = closedWithPL.map(x => x.r || 0);
  const mean = rs.reduce((s, x) => s + x, 0) / n;
  // Sample standard deviation (n-1 denominator)
  const variance = n > 1 ? rs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const ciHalf = 1.96 * se;
  const ciLow = mean - ciHalf;
  const ciHigh = mean + ciHalf;

  // CI bar visualization: scale around max(|ciLow|,|ciHigh|, 1.0R)
  const span = Math.max(Math.abs(ciLow), Math.abs(ciHigh), 1.0);
  const xMin = -span * 1.1;
  const xMax =  span * 1.1;
  const toPct = v => ((v - xMin) / (xMax - xMin)) * 100;
  const zeroPct = toPct(0);
  const lowPct = toPct(ciLow);
  const highPct = toPct(ciHigh);
  const meanPct = toPct(mean);
  const containsZero = ciLow <= 0 && ciHigh >= 0;
  const verdict = containsZero
    ? `<span style="color:var(--amber-bright);">Edge not yet significant</span> — sample is too small to rule out zero.`
    : (mean > 0
      ? `<span style="color:var(--green-bright);">Edge is statistically positive</span> at 95% confidence.`
      : `<span style="color:var(--red-bright);">Edge is statistically negative</span> at 95% confidence.`);

  // Convergence projection: at 30, 60, 100, 250 trades — show how SE shrinks (assuming current sd holds)
  const targets = [30, 60, 100, 250];
  const seAt = k => sd / Math.sqrt(k);
  const halfAt = k => 1.96 * seAt(k);
  const widest = halfAt(Math.min(...targets, n));
  const convRows = targets.map(k => {
    const half = halfAt(k);
    const width = (half / widest) * 100;
    const isNow = k <= n && (targets.indexOf(k) === 0 || targets[targets.indexOf(k) - 1] < n);
    return `<div class="clt-converge-row ${k <= n ? 'now' : ''}">
      <div>n=${k}</div>
      <div class="clt-conv-bar-wrap"><div class="clt-conv-bar-fill" style="width:${Math.max(4, width).toFixed(0)}%"></div></div>
      <div style="text-align:right;">±${half.toFixed(2)}R</div>
    </div>`;
  }).join('');

  return `<div class="home-card clt-card">
    ${head}
    <div class="clt-row">
      <div>
        <div class="clt-stat-grid">
          <div class="clt-stat">
            <div class="clt-stat-label">Sample Mean (R)</div>
            <div class="clt-stat-value ${mean > 0 ? 'pos' : mean < 0 ? 'neg' : ''}">${mean >= 0 ? '+' : ''}${mean.toFixed(2)}R</div>
            <div class="clt-stat-sub">${n} closed trades</div>
          </div>
          <div class="clt-stat">
            <div class="clt-stat-label">Std Error</div>
            <div class="clt-stat-value">±${se.toFixed(2)}R</div>
            <div class="clt-stat-sub">SD ${sd.toFixed(2)}R / √${n}</div>
          </div>
          <div class="clt-stat" style="grid-column: 1 / -1;">
            <div class="clt-stat-label">95% Confidence Interval for True Mean</div>
            <div class="clt-stat-value">${ciLow >= 0 ? '+' : ''}${ciLow.toFixed(2)}R &nbsp;to&nbsp; ${ciHigh >= 0 ? '+' : ''}${ciHigh.toFixed(2)}R</div>
            <div class="clt-ci-bar-wrap">
              <div class="clt-ci-zero" style="left:${zeroPct.toFixed(2)}%"></div>
              <div class="clt-ci-band" style="left:${lowPct.toFixed(2)}%; width:${(highPct - lowPct).toFixed(2)}%;"></div>
              <div class="clt-ci-mean" style="left:${meanPct.toFixed(2)}%"></div>
            </div>
            <div class="clt-ci-labels"><span>${xMin.toFixed(2)}R</span><span>0</span><span>+${xMax.toFixed(2)}R</span></div>
          </div>
        </div>
      </div>
      <div>
        <div class="clt-stat-label">Projected band width as N grows</div>
        <div class="clt-converge-list">${convRows}</div>
        <div class="clt-explainer">${verdict}<br/><br/>
          <strong>Why this matters:</strong> The CLT says the mean of any sample tends toward the true population mean as N grows, with error shrinking ∝ 1/√N. A wide band means a few more trades could change your verdict — keep sample size in mind before scaling size or killing a setup.
        </div>
      </div>
    </div>
  </div>`;
}

// ── TOS backtest report import card ───────────────────────────
function buildBacktestCard(help) {
  const reports = (state.backtestReports || []);
  const list = reports.length ? reports.map((r, i) => {
    const tone = (r.netProfit || 0) >= 0 ? 'pos' : 'neg';
    const np = r.netProfit;
    const npStr = np == null ? '—' : `${np >= 0 ? '+' : '-'}$${Math.abs(np).toFixed(2)}`;
    const periodStr = r.period ? ` · ${r.period}` : '';
    const pfStr = r.profitFactor != null ? ` · PF ${r.profitFactor}` : '';
    const avgStr = r.avgTrade != null ? ` · avg ${r.avgTrade >= 0 ? '+' : '-'}$${Math.abs(r.avgTrade).toFixed(2)}` : '';
    return `<div class="bar-row" style="border-bottom:1px solid var(--line); padding-bottom:8px; align-items:center;">
      <div class="bar-row-label" style="flex:1;">
        <strong>${r.name || 'Backtest ' + (i + 1)}</strong>
        <span class="bar-row-sub">${r.symbol || '—'} · ${r.trades || 0} trades · ${r.winRate != null ? r.winRate.toFixed(0) + '%W' : '—'}${pfStr}${avgStr}${periodStr}</span>
      </div>
      <div class="bar-value ${tone === 'pos' ? 'pl-positive' : 'pl-negative'}" style="min-width:90px;">${npStr}</div>
      <button class="pos-exec-del-btn" onclick="deleteBacktestReport('${r.id}')" title="Remove" style="margin-left:8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>`;
  }).join('') : `<div style="color:var(--ink-4);font-size:12px;padding:8px 0;">Import a TOS Strategy Report (.csv or pasted text) to compare your live trades against the historical backtest.</div>`;

  return `<div class="home-card">
    <div class="stats-snapshot-head">
      <div class="home-card-title" style="margin: 0;">Backtest Reports (TOS Import)${help('Import a ThinkorSwim strategy backtest report. Stored locally so you can compare live results to the historical study.')}</div>
      <div style="display:flex; gap:8px;">
        <button class="btn-secondary" id="btn-import-backtest-file" type="button" style="font-size:11px;">Import file</button>
        <button class="btn-secondary" id="btn-import-backtest-paste" type="button" style="font-size:11px;">Paste text</button>
        <input type="file" id="backtest-file-input" accept=".csv,.txt,.tsv" style="display:none" />
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:6px;">${list}</div>
  </div>`;
}

// Universal sidebar refresher - call from anywhere a trade lifecycle event happens
function renderUniversalSidebar() {
  // Stable function name other modules can call without coupling.
  renderHome();
  renderLogStats();
}

function setLogSetupFilter(setup) {
  state.logSetupFilter = setup || '';
  saveState();
  renderLogStats();
  renderLogTable();
  const search = document.getElementById('log-trade-search');
  if (search) search.placeholder = state.logSetupFilter ? `Filtered: ${state.logSetupFilter}` : 'Filter ticker, setup…';
}

function clearLogSetupFilter() {
  setLogSetupFilter('');
}

function renderLogTable() {
  const container = document.getElementById('log-table-container');
  const filter = state.logModeFilter || 'all';
  const setupFilter = state.logSetupFilter || '';
  const search = (state.logSearch || '').trim().toLowerCase();
  const modeFiltered = filter === 'all' ? state.trades : state.trades.filter(t => (t.mode || 'swing') === filter);
  const setupFiltered = setupFilter ? modeFiltered.filter(t => (t.setup || '—') === setupFilter) : modeFiltered;
  const filtered = search
    ? setupFiltered.filter(t =>
        (t.ticker || '').toLowerCase().includes(search) ||
        (t.setup || '').toLowerCase().includes(search) ||
        (t.direction || '').toLowerCase().includes(search) ||
        (t.mode || '').toLowerCase().includes(search) ||
        (t.status || '').toLowerCase().includes(search))
    : setupFiltered;
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">${search ? 'No matching trades' : setupFilter ? 'No trades for this setup' : (filter === 'all' ? 'No trades logged yet' : 'No ' + filter + ' trades')}</div>
        <div>${search ? 'Clear the search or try a different ticker/setup.' : setupFilter ? 'Choose another setup or clear the setup filter.' : (filter === 'all' ? 'Click "Add Trade" when you take your first entry, or log one from the Intraday tab.' : 'Switch the filter or log a new ' + filter + ' trade.')}</div>
      </div>
    `;
    return;
  }

  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const formatMoney = value => `${value >= 0 ? '+$' : '-$'}${Math.abs(value || 0).toFixed(0)}`;
  const formatR = r => r !== null && Number.isFinite(r)
    ? `${r >= 0 ? '+' : '-'}${Math.abs(r).toFixed(2)}R`
    : '—';

  container.innerHTML = `
    <div class="log-trade-list">
      <div class="log-trade-header" aria-hidden="true">
        <span></span>
        <span>Trade</span>
        <span>Setup</span>
        <span>Risk</span>
        <span>P/L</span>
        <span>Action</span>
      </div>
      ${sorted.map(t => {
        const pl = calcPL(t);
        const r = calcR(t);
        const mode = t.mode || 'swing';
        const statusClass = t.status === 'open' ? 'open' : pl >= 0 ? 'win' : 'loss';
        const sizeUnit = tradeInstrument(t) === 'stocks' ? 'sh' : 'ctr';
        const entry = Number(t.entry || 0);
        const exit = t.exit ? Number(t.exit) : null;
        const risk = Number(t.riskDollars) || tradeRiskDollars(t) || 0;
        const valueText = t.status === 'open' ? `$${Math.round(risk)}` : formatMoney(pl || 0);
        const processLabel = processQualityLabel(t.grade);
        const valueDetail = t.status === 'open'
          ? 'risk open'
          : `${formatR(r)}${processLabel ? ` · ${processLabel}` : ''}`;
        return `
          <button class="home-trade-row log-trade-row" type="button" onclick="editTrade('${t.id}')">
            <span class="home-trade-stripe ${statusClass}"></span>
            <span class="home-trade-main">
              <span class="home-trade-ticker">${t.ticker || '—'} <span class="status ${t.status}" style="font-size:9px; padding:2px 6px;">${t.status === 'open' ? 'Open' : t.status === 'win' ? 'Win' : 'Loss'}</span></span>
              <span class="home-trade-meta">${formatDate(t.date)} · ${mode} · ${t.direction || '—'}</span>
            </span>
            <span class="home-trade-setup">
              ${t.setup || 'No setup'}
              <span class="home-trade-detail">Entry $${entry.toFixed(2)} · Exit ${exit !== null ? '$' + exit.toFixed(2) : '—'} · ${t.contracts || 0} ${sizeUnit}</span>
            </span>
            <span class="log-trade-risk">
              ${formatR(r)}
              <span class="home-trade-detail">Risk $${Math.round(risk)}</span>
            </span>
            <span class="home-trade-value ${statusClass}">
              ${valueText}
              <span class="home-trade-detail">${valueDetail}</span>
            </span>
            <span class="log-trade-action-btn">Edit</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

// formatDate → src/models/formatters.js

function renderHome() {
  const today = todayISO();
  const closed = (state.trades || []).filter(t => isClosedTrade(t));
  const todayClosed = closed.filter(t => (t.exit_date || t.date) === today);
  const todayPL = todayClosed.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const todayR = todayClosed.reduce((s, t) => s + (calcR(t) || 0), 0);
  const wins = closed.filter(t => (calcPL(t) || 0) > 0);
  const losses = closed.filter(t => (calcPL(t) || 0) < 0);
  const winRate = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
  const openTrades = (state.trades || []).filter(t => t.status === 'open');
  const maxPositions = state.settings.maxPositions || 0;
  const positionSlotsLeft = Math.max(0, maxPositions - openTrades.length);
  const nextRisk = Math.round((state.settings.account || 10000) * getRiskPctForRegime(state.regime));
  const maxRiskDollars = Math.round((state.settings.account || 10000) * (state.settings.maxRiskPct || 10) / 100);
  const openRisk = openTrades.reduce((sum, t) => {
    return sum + (Number(t.riskDollars) || tradeRiskDollars(t) || 0);
  }, 0);
  const riskBuffer = Math.max(0, Math.round(maxRiskDollars - openRisk));
  const riskBasedTradesLeft = nextRisk > 0 ? Math.floor(riskBuffer / nextRisk) : positionSlotsLeft;
  const tradesLeft = Math.max(0, Math.min(positionSlotsLeft, riskBasedTradesLeft));
  const ratings = Object.values(state.sectorRatings || {}).map(Number).filter(v => Number.isFinite(v));
  const sectorScore = ratings.length ? Math.round(ratings.reduce((s, v) => s + v, 0) / ratings.length / 5 * 100) : null;
  const top3 = computeTop3();
  const avoid = computeAvoidList();
  const regimeText = REGIME_DATA[state.regime]?.text || 'RISK-ON';
  const positionsOk = openTrades.length < state.settings.maxPositions;
  const riskOk = riskBuffer > nextRisk;
  const rolling = (typeof computeRollingPL === 'function') ? computeRollingPL() : { totalPL: 0, pct: 0, days: 30, count: 0, winRate: null };
  const killActive = rolling.pct <= -7;

  // Money formatter — keeps lines compact and consistent.
  const $ = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(Math.round(v)).toLocaleString()}`;

  // Headline — concise, action-first. Priority: kill switch > caps > regime > all-clear.
  let regimeHeadline, headlineTone = '';
  if (killActive) {
    regimeHeadline = `Kill switch on. Last ${rolling.days}d down ${Math.abs(rolling.pct).toFixed(1)}%. Pause.`;
    headlineTone = 'risk-off';
  } else if (!positionsOk) {
    regimeHeadline = `Position cap full (${openTrades.length}/${state.settings.maxPositions}). Close one to open another.`;
    headlineTone = 'neutral';
  } else if (!riskOk) {
    regimeHeadline = `Risk buffer thin. Next trade would push past the ${state.settings.maxRiskPct}% cap.`;
    headlineTone = 'neutral';
  } else if (state.regime === 'risk-off') {
    regimeHeadline = `Risk-off tape. Longs blocked. Puts on Avoid sectors only, half size.`;
    headlineTone = 'risk-off';
  } else if (state.regime === 'neutral') {
    regimeHeadline = `Neutral tape. Half size both ways. Wait for clean confirmation.`;
    headlineTone = 'neutral';
  } else {
    regimeHeadline = `Cleared to trade. ${tradesLeft} slot${tradesLeft === 1 ? '' : 's'} left, $${nextRisk} per trade.`;
    headlineTone = '';
  }

  // Today-focused bullets. Each line is one breath; the color carries tone.
  const sectorStaleNow = state.sectorRatedAt && isSectorRatingStale();
  const intelPoints = [];

  // 1. Today's session — only when there's something concrete to report.
  // (Empty days were noise, per user feedback.)
  if (todayClosed.length) {
    const tone = todayPL >= 0 ? 'good' : 'bad';
    const wins = todayClosed.filter(t => (calcPL(t) || 0) > 0).length;
    const rPart = todayR ? ` · ${todayR >= 0 ? '+' : ''}${todayR.toFixed(2)}R` : '';
    intelPoints.push({
      tone, icon: '📅',
      html: `<strong>Today: ${$(todayPL)}</strong> · ${wins}W ${todayClosed.length - wins}L${rPart}.`,
    });
  } else if (openTrades.length) {
    intelPoints.push({
      tone: 'info', icon: '📅',
      html: `${openTrades.length} position${openTrades.length === 1 ? '' : 's'} open · ${$(-Math.round(openRisk))} at risk. No closes today.`,
    });
  }

  // 2. Rolling-window read — concise.
  if (rolling.count > 0) {
    const tone = killActive ? 'bad' : rolling.pct < 0 ? 'warn' : 'good';
    const verdict = killActive ? 'kill switch on' : rolling.pct < 0 ? 'in drawdown' : 'in form';
    const wrPart = rolling.winRate !== null ? ` · ${rolling.winRate}% wins` : '';
    intelPoints.push({
      tone, icon: '⏱',
      html: `Last ${rolling.days}d: <strong>${$(rolling.totalPL)}</strong> (${rolling.pct >= 0 ? '+' : ''}${rolling.pct.toFixed(1)}%) · ${rolling.count} closed${wrPart} — ${verdict}.`,
    });
  } else if (closed.length === 0) {
    intelPoints.push({
      tone: 'info', icon: '📋',
      html: `<strong>No closed trades yet.</strong> First exit starts the rolling window.`,
    });
  }

  // 3. Sector lean — directional bias.
  if (top3.length || avoid.length) {
    const topPart = top3.length
      ? `<strong>${top3.slice(0, 3).map(s => `<span title="${s.ticker}">${s.name}</span>`).join(' · ')}</strong>`
      : 'none strong';
    const avoidPart = avoid.length
      ? ` · avoid <strong style="color:var(--red-bright)">${avoid.slice(0, 3).map(s => `<span title="${s.ticker}">${s.name}</span>`).join(' · ')}</strong>`
      : '';
    intelPoints.push({
      tone: top3.length ? 'good' : 'warn', icon: '🧭',
      html: `Lean long ${topPart}${avoidPart}.`,
    });
  } else {
    intelPoints.push({
      tone: 'warn', icon: '🧭',
      html: `<strong>No sector ratings.</strong> Rate sectors in Market Context first.`,
    });
  }

  // Stale sector callout — only if actually stale.
  if (sectorStaleNow) {
    const days = daysSinceSectorRating();
    intelPoints.push({
      tone: 'warn', icon: '⚠️',
      html: `Sector grades <strong>${days}d old</strong> — re-rate before trading.`,
    });
  }

  // 4. Action line — the explicit "what now".
  let actionTone = 'good', actionIcon = '✅', actionHtml = '';
  if (killActive) {
    actionTone = 'bad'; actionIcon = '🛑';
    actionHtml = `<strong>Don't trade.</strong> Wait for rolling P/L above -7%, or widen the window in Settings.`;
  } else if (state.regime === 'risk-off') {
    actionTone = 'bad'; actionIcon = '🛑';
    actionHtml = `<strong>Defensive.</strong> Skip longs. Puts on Avoid sectors at half size only.`;
  } else if (!positionsOk) {
    actionTone = 'warn'; actionIcon = '🔒';
    actionHtml = `<strong>Position cap.</strong> Close one before opening another.`;
  } else if (!riskOk) {
    actionTone = 'warn'; actionIcon = '🔒';
    actionHtml = `<strong>Buffer thin.</strong> Close something or pass on the next trade.`;
  } else if (state.regime === 'neutral') {
    actionTone = 'warn'; actionIcon = '⚖️';
    actionHtml = `<strong>Half size.</strong> Both directions OK on confirmed setups only.`;
  } else {
    actionTone = 'good'; actionIcon = '✅';
    actionHtml = `<strong>Cleared.</strong> ${tradesLeft} slot${tradesLeft === 1 ? '' : 's'} left · next trade $${nextRisk}.`;
  }
  intelPoints.push({ tone: actionTone, icon: actionIcon, html: actionHtml });

  // Stash for the headline render below — keep the existing class taxonomy.
  // (Legacy code reads state.regime to colour the headline; we override.)
  state._homeHeadlineClass = headlineTone;

  const scoreText = `${regimeHeadline} ${closed.length ? `${closed.length} closed.` : 'No closed trades yet.'}`;

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = text;
  };

  setText('home-intel-text', scoreText);

  // Render structured Alpha Intelligence
  const headlineEl = document.getElementById('home-intel-headline');
  if (headlineEl) {
    headlineEl.textContent = regimeHeadline;
    // Headline class reflects ACTION priority (kill switch / cap > regime),
    // not just regime. Falls back to '' = green.
    headlineEl.className = `home-intel-headline ${state._homeHeadlineClass || ''}`;
  }
  const pointsEl = document.getElementById('home-intel-points');
  if (pointsEl) {
    pointsEl.innerHTML = intelPoints.map(p =>
      `<li class="tone-${p.tone}"><span class="intel-icon">${p.icon}</span><span>${p.html}</span></li>`
    ).join('');
  }
  const deepLabel = document.getElementById('home-deep-label');
  if (deepLabel) {
    deepLabel.textContent = sectorStaleNow
      ? 'Stale sector data'
      : (todayClosed.length
          ? `${todayClosed.length} closed today`
          : "Today's read");
  }


  setText('home-session-pl', `${todayPL >= 0 ? '+$' : '-$'}${Math.abs(todayPL).toFixed(2)} <small>(${todayR >= 0 ? '+' : '-'}${Math.abs(todayR).toFixed(1)}R)</small>`);
  setText('home-realized', `${todayPL >= 0 ? '+$' : '-$'}${Math.abs(todayPL).toFixed(0)}`);
  setText('home-win-rate', `${winRate}%`);
  setText('home-trades-left', tradesLeft);
  setText('home-buffer', `$${riskBuffer}`);
  setText('home-next-risk', `$${nextRisk}`);
  setText('home-zone', tradesLeft > 1 ? 'Green Zone' : tradesLeft === 1 ? 'Caution' : 'Locked');

  const progress = document.getElementById('home-progress-fill');
  if (progress) progress.style.width = `${Math.max(0, Math.min(100, riskBuffer / Math.max(1, maxRiskDollars) * 100))}%`;

  const calendar = document.getElementById('home-calendar');
  const title = document.getElementById('home-calendar-title');
  if (calendar) {
    const now = new Date();
    const currentDay = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - currentDay - 14); // Start on Sunday, 2 weeks ago
    const end = new Date(now);
    end.setDate(start.getDate() + 20); // 21 days total
    if (title) {
      title.textContent = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const headerHtml = weekdays.map(day => `<div class="home-day-dow">${day}</div>`).join('');
    let totalPeriodPL = 0;
    
    const daysHtml = Array.from({ length: 21 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const dayTrades = closed.filter(t => (t.exit_date || t.date) === iso);
      const pl = dayTrades.reduce((s, t) => s + (calcPL(t) || 0), 0);
      
      totalPeriodPL += pl;
      
      const isFuture = iso > today;
      let cls = iso === today ? 'active' : pl > 0 ? 'good' : pl < 0 ? 'bad' : '';
      if (isFuture) cls += ' future';
      
      const plLabel = dayTrades.length ? `<span class="home-day-pl">${pl >= 0 ? '+$' : '-$'}${Math.abs(pl).toFixed(0)}</span>` : '';
      
      let hoverText = `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
      if (dayTrades.length > 0) {
        hoverText += `\nTrades: ${dayTrades.length}\nP/L: ${pl >= 0 ? '+$' : '-$'}${Math.abs(pl).toFixed(0)}`;
        const setupMap = {};
        dayTrades.forEach(t => {
          const s = t.setup || 'Other';
          setupMap[s] = (setupMap[s] || 0) + (calcPL(t) || 0);
        });
        const topSetup = Object.entries(setupMap).sort((a,b) => b[1] - a[1])[0];
        if (topSetup) {
          hoverText += `\nTop Setup: ${topSetup[0]} (${topSetup[1] >= 0 ? '+$' : '-$'}${Math.abs(topSetup[1]).toFixed(0)})`;
        }
      } else {
        hoverText += `\nNo trades`;
      }
      
      return `<div class="home-day ${cls}" title="${hoverText}"><span class="home-day-num">${d.getDate()}</span>${plLabel}</div>`;
    }).join('');
    
    const summaryHtml = `
      <div class="home-calendar-summary">
        <div class="home-calendar-legend">
          <span><span class="dot green"></span> Win</span>
          <span><span class="dot red"></span> Loss</span>
        </div>
        <div>Period P/L: <span style="color: ${totalPeriodPL >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'}; font-weight: 700;">${totalPeriodPL >= 0 ? '+$' : '-$'}${Math.abs(totalPeriodPL).toFixed(0)}</span></div>
      </div>
    `;
    
    calendar.innerHTML = headerHtml + daysHtml + summaryHtml;
  }

  const empty = document.getElementById('home-portfolio-empty');
  if (empty) {
    const allTrades = (state.trades || []);
    const showingOpen = state.homePortfolioView === 'open';
    const sourceTrades = showingOpen ? openTrades : allTrades;
    const toggle = document.getElementById('home-portfolio-toggle');
    if (toggle) {
      toggle.textContent = showingOpen ? 'Recent activity' : `Open positions (${openTrades.length})`;
      toggle.title = showingOpen ? 'Show recent activity' : 'Show open positions';
    }
    const listTrades = [...sourceTrades]
      .sort((a, b) => {
        const aTime = new Date(a.updated_at || a.exit_date || a.date || 0).getTime();
        const bTime = new Date(b.updated_at || b.exit_date || b.date || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 8);
    if (listTrades.length === 0) {
      empty.innerHTML = showingOpen
        ? `<div class="home-activity-empty"><div><div style="font-size:28px; color:rgba(139,148,158,0.25);">⌁</div><em>No open positions.</em><strong>Review recent activity</strong></div></div>`
        : `<div class="home-activity-empty"><div><div style="font-size:28px; color:rgba(139,148,158,0.25);">⌁</div><em>Your active session is empty.</em><strong>Launch Alpha Wizard</strong></div></div>`;
    } else {
      empty.innerHTML = listTrades.map(t => {
        const pl = calcPL(t);
        const r = calcR(t);
        const statusClass = t.status === 'open' ? 'open' : pl >= 0 ? 'win' : 'loss';
        const valueText = t.status === 'open'
          ? `Risk $${Math.round(Number(t.riskDollars) || tradeRiskDollars(t) || 0)}`
          : `${pl >= 0 ? '+$' : '-$'}${Math.abs(pl || 0).toFixed(0)}`;
        const qtyUnit = tradeInstrument(t) === 'stocks' ? 'sh' : 'ctr';
        const detailText = t.status === 'open'
          ? `${tradeQty(t) || 0} ${qtyUnit} @ $${Number(t.entry || 0).toFixed(2)}`
          : `${formatDate(t.exit_date || t.date)}${r !== null ? ` · ${r >= 0 ? '+' : '-'}${Math.abs(r).toFixed(2)}R` : ''}`;
        return `
          <button class="home-trade-row" type="button" onclick="event.stopPropagation(); reviewTrade('${t.id}')">
            <span class="home-trade-stripe ${statusClass}"></span>
            <span class="home-trade-main">
              <span class="home-trade-ticker">${t.ticker || '—'} <span class="status ${t.status}" style="font-size:9px; padding:2px 6px;">${t.status}</span></span>
              <span class="home-trade-meta">${formatDate(t.date)} · ${t.mode || 'swing'} · ${t.direction || '—'}</span>
            </span>
            <span class="home-trade-setup">${t.setup || 'No setup'}</span>
            <span class="home-trade-value ${statusClass}">${valueText}<span class="home-trade-detail">${detailText}</span></span>
            <span class="home-trade-action">Review</span>
          </button>
        `;
      }).join('');
      empty.insertAdjacentHTML('beforeend', !showingOpen && listTrades.length < allTrades.length
        ? `<button class="home-trade-row" type="button" onclick="event.stopPropagation(); setTab('log')" style="grid-template-columns:1fr; justify-items:center;"><span class="home-trade-action">View all ${allTrades.length} trades</span></button>`
        : '');
    }
  }
}

function toggleHomePortfolioView() {
  state.homePortfolioView = state.homePortfolioView === 'open' ? 'recent' : 'open';
  saveState();
  renderHome();
}

// ---------- Trade modal ----------
function populateTradeModalSetups(mode) {
  const sel = document.getElementById('t-setup');
  if (!sel) return;
  const swing = ['21-EMA Pullback','Base Breakout','Breakout Retest','9-EMA Reclaim','Edge Reversal'];
  const intraday = ['ORB Break','ORB Retest','VWAP Reclaim','VWAP Loss','Momentum Edge','Trend Continuation'];
  const list = mode === 'intraday' ? intraday : swing;
  const current = sel.value;
  sel.innerHTML = '<option value="">Select...</option>' + list.map(s => `<option>${s}</option>`).join('');
  // Preserve current selection if still valid for the new mode
  if (list.includes(current)) sel.value = current;
}

// Stock vs Option toggle inside the Log Trade modal — updates labels and IVR visibility.
function setTradeInstrument(inst) {
  if (inst !== 'options' && inst !== 'stocks') return;
  const hidden = document.getElementById('t-instrument');
  if (hidden) hidden.value = inst;
  document.querySelectorAll('#t-instrument-row .flow-instrument-pill').forEach(b => {
    const a = b.dataset.tInstrument === inst;
    b.classList.toggle('active', a);
    b.setAttribute('aria-selected', a ? 'true' : 'false');
  });
  const isStocks = inst === 'stocks';
  const entryLabel = document.getElementById('t-entry-label');
  const ctrLabel = document.getElementById('t-contracts-label');
  const ivrGroup = document.getElementById('t-ivr-group');
  if (entryLabel) entryLabel.textContent = isStocks ? 'Entry Price (per share)' : 'Entry Premium';
  if (ctrLabel)   ctrLabel.textContent   = isStocks ? 'Shares' : 'Contracts';
  if (ivrGroup)   ivrGroup.style.display = isStocks ? 'none' : '';
}

function openTradeModal(trade) {
  const modal = document.getElementById('modal-add');
  const title = document.getElementById('modal-title');
  const subtitle = document.getElementById('modal-subtitle');
  const form = document.getElementById('trade-form');
  const deleteBtn = document.getElementById('btn-delete-trade');
  form.reset();
  document.getElementById('t-id').value = '';
  document.getElementById('t-status').value = 'open';
  document.getElementById('t-grade').value = '';

  // Populate setup dropdown based on mode (default swing). Function defined below.
  populateTradeModalSetups('swing');

  if (trade) {
    title.textContent = 'Edit Trade';
    subtitle.textContent = trade.status === 'open'
      ? 'Open position — switch to Review only when closed in your broker'
      : 'Closed position — adjust review fields below';
    deleteBtn.style.display = 'inline-block';
    document.getElementById('t-id').value = trade.id;
    document.getElementById('t-mode').value = trade.mode || 'swing';
    populateTradeModalSetups(trade.mode || 'swing');
    document.getElementById('t-date').value = trade.date || '';
    document.getElementById('t-ticker').value = trade.ticker || '';
    document.getElementById('t-setup').value = trade.setup || '';
    document.getElementById('t-direction').value = trade.direction || 'Long';
    document.getElementById('t-entry').value = trade.entry || '';
    document.getElementById('t-contracts').value = trade.contracts || '';
    document.getElementById('t-ivr').value = trade.ivr || '';
    document.getElementById('t-regime').value = trade.regime || 'RISK-ON';
    document.getElementById('t-thesis').value = trade.thesis || '';
    document.getElementById('t-premortem').value = trade.premortem || '';
    document.getElementById('t-stop').value = trade.stop || '';
    document.getElementById('t-status').value = trade.status || 'open';
    document.getElementById('t-exit').value = trade.exit || '';
    setTradeBias(_directionToBias(trade.bias || trade.direction));
    setTradeInstrument(trade.instrument || 'options');
  } else {
    title.textContent = 'Log Trade';
    subtitle.textContent = 'Capture the entry plan. Closing, scaling, and grading happen in the Position Editor.';
    deleteBtn.style.display = 'none';
    document.getElementById('t-date').value = new Date().toISOString().split('T')[0];

    // Default mode based on which tab the user is on right now
    const defaultMode = state.activeMode === 'intraday' ? 'intraday' : 'swing';
    document.getElementById('t-mode').value = defaultMode;
    populateTradeModalSetups(defaultMode);
    setTradeInstrument(state.instrument || 'options');
    setTradeBias(state.direction === 'short' ? 'bearish' : 'bullish');

    // Pre-fill from current flow state — saves the user from re-entering everything
    if (state.selectedSetup) document.getElementById('t-setup').value = state.selectedSetup;
    if (state.premium) document.getElementById('t-entry').value = state.premium;
    if (state.ivr !== null) document.getElementById('t-ivr').value = state.ivr;
    if (state.ticker) document.getElementById('t-ticker').value = state.ticker;
    document.getElementById('t-regime').value = REGIME_DATA[state.regime].text;

    // Pre-fill stop from ATR + underlying price if both available (bias-aware)
    if (state.atr && state.atr > 0 && state.underlyingPrice && state.underlyingPrice > 0) {
      const distance = state.atr * 1.5;
      const isBullish = state.direction !== 'short';
      const volStop = (isBullish ? state.underlyingPrice - distance : state.underlyingPrice + distance).toFixed(2);
      document.getElementById('t-stop').value = volStop;
    }

    // Auto-compute contracts using same logic as the calculator
    if (state.premium && state.premium > 0) {
      const settings = state.settings;
      let riskPct = getRiskPctForRegime(state.regime);
      if (state.selectedSetup === 'Edge Reversal') riskPct = riskPct / 2;
      const riskDollars = settings.account * riskPct;
      const stopFraction = settings.stopPct / 100;
      const maxLossPerContract = state.premium * stopFraction * 100;
      const contracts = Math.floor(riskDollars / maxLossPerContract);
      if (contracts >= 1) {
        document.getElementById('t-contracts').value = contracts;
      }
    }
  }
  modal.classList.add('show');
}

function closeTradeModal() {
  document.getElementById('modal-add').classList.remove('show');
}

// Bias (Bullish/Bearish) lives in #t-bias and is mirrored to the legacy #t-direction
// Long/Short field for back-compat with calcPL and stats.
function _directionToBias(d) {
  if (!d) return 'bullish';
  const s = String(d).toLowerCase();
  if (s === 'bearish' || s === 'short') return 'bearish';
  return 'bullish';
}
function _biasToDirection(b) { return b === 'bearish' ? 'Short' : 'Long'; }
function setTradeBias(bias) {
  const sel = document.getElementById('t-bias');
  const hidden = document.getElementById('t-direction');
  if (sel) sel.value = bias;
  if (hidden) hidden.value = _biasToDirection(bias);
}

function saveTrade() {
  const id = document.getElementById('t-id').value || genTradeId();
  const mode = document.getElementById('t-mode').value || 'swing';
  const existingTrade = state.trades.find(t => t.id === id);
  const nowIso = new Date().toISOString();
  // Entry-only modal — Position Editor owns close/scale/grade. Preserve closed state on edit.
  const status = existingTrade?.status || 'open';
  // Risk dollars: swing uses regime %, intraday uses fixed $
  const riskDollars = mode === 'intraday'
    ? state.settings.intradayRiskPerTrade
    : (state.settings.account || 10000) * getRiskPctForRegime(state.regime || 'risk-on');
  // Trade modal exposes its own instrument toggle. Falls back to the existing trade,
  // then to the active flow instrument, then to options.
  const modalInstrument = (document.getElementById('t-instrument')?.value || '').trim();
  const instrument = modalInstrument || existingTrade?.instrument || (state.instrument || 'options');
  const bias = document.getElementById('t-bias')?.value || 'bullish';
  const direction = _biasToDirection(bias);
  const qty = parseInt(document.getElementById('t-contracts').value) || 0;
  const trade = {
    ...(existingTrade || {}),
    id,
    mode,
    instrument,
    date: document.getElementById('t-date').value,
    ticker: document.getElementById('t-ticker').value.toUpperCase(),
    setup: document.getElementById('t-setup').value,
    bias,
    direction, // legacy mirror
    entry: parseFloat(document.getElementById('t-entry').value) || 0,
    qty,
    contracts: qty, // legacy mirror
    ivr: parseFloat(document.getElementById('t-ivr').value) || null,
    regime: document.getElementById('t-regime').value,
    thesis: document.getElementById('t-thesis').value,
    premortem: document.getElementById('t-premortem').value,
    stop: parseFloat(document.getElementById('t-stop').value) || null,
    riskDollars,
    status,
    created_at: existingTrade?.created_at || nowIso,
    updated_at: nowIso,
  };

  if (!trade.date || !trade.ticker || !trade.setup || !trade.entry || !trade.qty) {
    toast('Fill in all required fields', true);
    return;
  }

  const isEdit = !!existingTrade;
  const idx = state.trades.findIndex(t => t.id === id);
  if (idx >= 0) state.trades[idx] = trade;
  else state.trades.push(trade);
  if (state.deletedTradeIds) delete state.deletedTradeIds[id];

  saveState();
  // Trades are too important to wait the 1.5s debounce — push right now.
  // If the user closes the tab in the next 1.5s, debounced push could be lost.
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }
  closeTradeModal();

  // Reset flow if this was a new trade entry from the GO button (not a manual edit)
  if (!isEdit && trade.status === 'open') {
    resetFlowSilent();
    toast('Trade logged. Flow reset for next decision.');
  } else {
    toast(isEdit ? 'Trade updated' : 'Trade logged');
  }

  renderLogStats();
  renderLogTable();
  renderPretradeCheck();  // recompute auto-detected checks
}

function deleteTrade() {
  const id = document.getElementById('t-id').value;
  if (!id) return;
  const trade = state.trades.find(t => t.id === id);
  if (!trade) return;
  if (!confirm(`Delete this trade?\n\n${trade.ticker} ${trade.setup} ${trade.date}\n\nThis cannot be undone.`)) return;
  if (!state.deletedTradeIds) state.deletedTradeIds = {};
  state.deletedTradeIds[id] = new Date().toISOString();
  state.trades = state.trades.filter(t => t.id !== id);
  saveState();
  // Force immediate push (same reason as saveTrade)
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }
  closeTradeModal();
  renderHome();
  renderLogStats();
  renderLogTable();
  renderPretradeCheck();
  toast('Trade deleted');
}

function resetFlowSilent() {
  state.selectedSetup = null;
  state.ivr = null;
  state.premium = null;
  state.atr = null;
  state.underlyingPrice = null;
  state.ticker = null;
  state.saQuant = null;
  state.daysToEarnings = null;
  state.gateChecks = {};
  state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
  if (state.tradeFlow) {
    state.tradeFlow.swingPremiumManual = false;
    state.tradeFlow.moonshotR = 3;
  }
  saveState();
  if (typeof renderTrade === 'function') renderTrade();
}

window.editTrade = function(id) {
  const t = state.trades.find(t => t.id === id);
  if (t) openPositionEditor(t);
};

window.reviewTrade = function(id) {
  const t = state.trades.find(t => t.id === id);
  if (!t) return;
  openPositionEditor(t, 'journal');
};

// ---------- Position Editor (simplified Execution Manager + Journal) ----------
// State that lives only while the editor is open.
const POS = {
  id: null,
  trade: null,
  mark: null,
  executions: [],
  tags: [],
  notes: '',
  playbookImage: null,
};

function _posMultiplier(t) { return tradeMultiplier(t); }

// tradeBias → src/models/trade.js

function _posSign(t) {
  // Only short stock requires sign flip — long calls and long puts both use +1.
  if (t.instrument === 'stocks' && tradeBias(t) === 'bearish') return -1;
  return 1;
}

function _posSideLabel(t) {
  const bias = tradeBias(t);
  if (t.instrument === 'stocks') return bias === 'bearish' ? 'SHORT STOCK' : 'LONG STOCK';
  return bias === 'bearish' ? 'LONG PUT' : 'LONG CALL';
}

function _posQtyUnit(t) {
  return t.instrument === 'stocks' ? 'Shares' : 'Contracts';
}

// tradeQty → src/models/trade.js

function _posRealizedPL(t, executions) {
  const mult = _posMultiplier(t);
  const sign = _posSign(t);
  return executions.reduce((s, e) => s + sign * (Number(e.price) - Number(t.entry)) * mult * Number(e.qty || 0), 0);
}

function _posOpenQty(t, executions) {
  const total = tradeQty(t);
  const closed = executions.reduce((s, e) => s + (Number(e.qty) || 0), 0);
  return Math.max(0, total - closed);
}

function _posUnrealizedPL(t, executions, mark) {
  if (mark === null || isNaN(mark)) return 0;
  const open = _posOpenQty(t, executions);
  if (!open) return 0;
  const mult = _posMultiplier(t);
  const sign = _posSign(t);
  return sign * (Number(mark) - Number(t.entry)) * mult * open;
}

// _fmtMoney, _fmtMoneyPlain, _toneClass → src/models/formatters.js

function openPositionEditor(trade, tab = 'exec') {
  POS.id = trade.id;
  POS.trade = trade;
  // Hydrate executions from trade — back-compat: synth a single execution from t.exit if present
  if (Array.isArray(trade.executions) && trade.executions.length) {
    POS.executions = trade.executions.map(e => ({ ...e }));
  } else if (trade.status !== 'open' && trade.exit) {
    POS.executions = [{
      id: 'e_' + Math.random().toString(36).slice(2, 8),
      time: trade.exit_date ? new Date(trade.exit_date).toISOString() : new Date().toISOString(),
      type: trade.exit_reason === 'target' ? 'target_hit' :
            trade.exit_reason === 'stop' ? 'stop_loss' : 'manual_close',
      qty: tradeQty(trade),
      price: Number(trade.exit) || 0,
    }];
  } else {
    POS.executions = [];
  }
  POS.mark = trade.mark != null ? Number(trade.mark) : (trade.exit ? Number(trade.exit) : null);
  POS.tags = Array.isArray(trade.outcome_tags) ? [...trade.outcome_tags] : _backfillTagsFromTrade(trade);
  POS.notes = trade.lesson || trade.notes || '';
  POS.playbookImage = trade.playbook_image || null;

  // Header
  document.getElementById('pos-ticker').textContent = (trade.ticker || '—').toUpperCase();
  const sideEl = document.getElementById('pos-side-badge');
  sideEl.textContent = _posSideLabel(trade);
  // Visual tone matches bias: bullish → green badge, bearish → red badge.
  const isBearish = tradeBias(trade) === 'bearish';
  sideEl.classList.toggle('long', !isBearish);
  sideEl.classList.toggle('short', isBearish);
  document.getElementById('pos-entry').textContent = _fmtMoneyPlain(trade.entry);
  document.getElementById('pos-qty-total').textContent = tradeQty(trade);
  document.getElementById('pos-qty-unit').textContent = _posQtyUnit(trade);

  // Mark input
  const markInput = document.getElementById('pos-mark');
  markInput.value = POS.mark != null ? POS.mark : '';

  // Notes + tags + playbook image
  document.getElementById('pos-notes').value = POS.notes;
  document.querySelectorAll('#pos-tag-group .pos-tag').forEach(b => {
    b.classList.toggle('active', POS.tags.includes(b.dataset.tag));
  });
  _renderPlaybookImage();
  setPositionTab(tab);
  renderPositionEditor();

  document.getElementById('modal-position').classList.add('show');
}

function closePositionEditor() {
  document.getElementById('modal-position').classList.remove('show');
  POS.id = null;
  POS.trade = null;
}

function setPositionTab(tab) {
  document.querySelectorAll('#pos-tabs .pos-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.posTab === tab);
  });
  document.querySelectorAll('#modal-position [data-pos-pane]').forEach(p => {
    p.classList.toggle('active', p.dataset.posPane === tab);
  });
}

function renderPositionEditor() {
  if (!POS.trade) return;
  const t = POS.trade;
  const mark = POS.mark;
  const open = _posOpenQty(t, POS.executions);
  const realized = _posRealizedPL(t, POS.executions);
  const unrealized = _posUnrealizedPL(t, POS.executions, mark);
  const total = realized + unrealized;

  // Header total
  const totalEl = document.getElementById('pos-total-pnl');
  totalEl.textContent = _fmtMoney(total);
  totalEl.classList.remove('pos','neg','zero');
  totalEl.classList.add(_toneClass(total));

  // Position status
  document.getElementById('pos-open-qty').textContent = open;
  const unrealEl = document.getElementById('pos-unrealized');
  unrealEl.textContent = _fmtMoney(unrealized);
  unrealEl.classList.remove('pos','neg','zero');
  unrealEl.classList.add(_toneClass(unrealized));

  // Quick scale buttons (mark % off open qty)
  document.querySelectorAll('.pos-quick-btn').forEach(b => {
    b.disabled = open <= 0;
    b.style.opacity = open <= 0 ? 0.5 : 1;
  });
  document.getElementById('pos-execute-btn').disabled = open <= 0;

  // Render execution log
  _renderExecLog();
}

function _renderExecLog() {
  const t = POS.trade;
  if (!t) return;
  const wrap = document.getElementById('pos-exec-log-body');
  if (!POS.executions.length) {
    wrap.innerHTML = `<div class="pos-exec-empty">No exits yet. Use Quick Scale to log a partial or full exit.</div>`;
    return;
  }
  const sign = _posSign(t);
  const mult = _posMultiplier(t);
  const rows = POS.executions.map(e => {
    const pl = sign * (Number(e.price) - Number(t.entry)) * mult * Number(e.qty || 0);
    const time = e.time ? new Date(e.time) : new Date();
    const timeStr = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const typeLabel = TAG_LABELS[e.type] || 'Manual Close';
    return `<tr>
      <td>${timeStr}</td>
      <td><span class="pos-exec-type-pill">${typeLabel}</span></td>
      <td><strong>${e.qty}</strong></td>
      <td>${_fmtMoneyPlain(e.price)}</td>
      <td class="right ${pl >= 0 ? 'pl-pos' : 'pl-neg'}">${_fmtMoney(pl)}</td>
      <td class="right"><button class="pos-exec-del-btn" data-exec-id="${e.id}" aria-label="Remove exit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button></td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table class="pos-exec-table">
    <thead><tr><th>Time</th><th>Type</th><th>Qty</th><th>Price</th><th class="right">PnL</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function _renderPlaybookImage() {
  const drop = document.getElementById('pos-playbook-drop');
  if (POS.playbookImage) {
    drop.classList.add('has-image');
    drop.innerHTML = `<img src="${POS.playbookImage}" alt="Playbook screenshot" />`;
  } else {
    drop.classList.remove('has-image');
    drop.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <div>Paste (Ctrl+V) Screenshot</div>`;
  }
}

const TAG_LABELS = {
  target_hit: 'Target Hit',
  stop_loss: 'Stop Loss',
  breakeven: 'Breakeven',
  manual_close: 'Manual Close',
  premature_exit: 'Premature Exit',
  fomo_entry: 'FOMO Entry',
};

// Build outcome tags from existing trade fields when migrating older data.
function _backfillTagsFromTrade(t) {
  const tags = [];
  if (t.exit_reason === 'target') tags.push('target_hit');
  if (t.exit_reason === 'stop') tags.push('stop_loss');
  if (t.exit_reason === 'discretionary') tags.push('manual_close');
  if (t.emotion === 'fomo') tags.push('fomo_entry');
  if (t.grade === 'broken' && t.exit_reason !== 'stop') tags.push('premature_exit');
  return tags;
}

function _activeExecType() {
  // Map active outcome tags to execution-row type. Falls back to manual close.
  const priority = ['target_hit','stop_loss','breakeven','premature_exit','manual_close'];
  for (const p of priority) if (POS.tags.includes(p)) return p;
  return 'manual_close';
}

function _execScale(pct) {
  const open = _posOpenQty(POS.trade, POS.executions);
  const qty = Math.max(0, Math.floor(open * pct));
  document.getElementById('pos-exit-qty').value = qty || '';
  // Default the price to the mark if the price input is empty
  const priceEl = document.getElementById('pos-exit-price');
  if (!priceEl.value && POS.mark != null) priceEl.value = POS.mark;
}

function _execExit() {
  const t = POS.trade;
  if (!t) return;
  const qty = parseInt(document.getElementById('pos-exit-qty').value, 10);
  const price = parseFloat(document.getElementById('pos-exit-price').value);
  const open = _posOpenQty(t, POS.executions);
  if (!qty || qty <= 0) { toast('Enter exit qty', true); return; }
  if (qty > open) { toast(`Only ${open} ${_posQtyUnit(t).toLowerCase()} open`, true); return; }
  if (!price || price <= 0) { toast('Enter exit price', true); return; }
  POS.executions.push({
    id: 'e_' + Math.random().toString(36).slice(2, 8),
    time: new Date().toISOString(),
    type: _activeExecType(),
    qty,
    price,
  });
  document.getElementById('pos-exit-qty').value = '';
  document.getElementById('pos-exit-price').value = '';
  renderPositionEditor();
}

function _delExec(id) {
  POS.executions = POS.executions.filter(e => e.id !== id);
  renderPositionEditor();
}

function _toggleTag(tag) {
  const idx = POS.tags.indexOf(tag);
  if (idx >= 0) POS.tags.splice(idx, 1); else POS.tags.push(tag);
  document.querySelectorAll('#pos-tag-group .pos-tag').forEach(b => {
    b.classList.toggle('active', POS.tags.includes(b.dataset.tag));
  });
}

function _savePositionEditor() {
  const t = POS.trade;
  if (!t) return;
  const tradeIdx = state.trades.findIndex(x => x.id === t.id);
  if (tradeIdx < 0) { toast('Trade not found', true); return; }

  // Persist editor data back onto the trade.
  const updated = { ...state.trades[tradeIdx] };
  updated.executions = POS.executions.slice();
  updated.outcome_tags = POS.tags.slice();
  updated.notes = document.getElementById('pos-notes').value;
  updated.lesson = updated.notes || updated.lesson || null;
  updated.mark = POS.mark;
  updated.playbook_image = POS.playbookImage || null;

  // Compute close state from executions.
  const open = _posOpenQty(updated, updated.executions);
  if (open === 0 && updated.executions.length) {
    const totalQty = updated.executions.reduce((s, e) => s + Number(e.qty), 0);
    const wAvgExit = updated.executions.reduce((s, e) => s + Number(e.price) * Number(e.qty), 0) / totalQty;
    updated.exit = Number(wAvgExit.toFixed(4));
    const realized = _posRealizedPL(updated, updated.executions);
    updated.status = realized >= 0 ? 'win' : 'loss';
    updated.exit_date = updated.exit_date || (updated.executions[updated.executions.length - 1].time || '').split('T')[0] || new Date().toISOString().split('T')[0];
  } else {
    updated.status = 'open';
    updated.exit = null;
  }
  // Map first relevant tag back into existing exit_reason field for back-compat with stats.
  if (POS.tags.includes('target_hit')) updated.exit_reason = 'target';
  else if (POS.tags.includes('stop_loss')) updated.exit_reason = 'stop';
  else if (POS.tags.includes('manual_close') || POS.tags.includes('breakeven')) updated.exit_reason = 'discretionary';
  else if (POS.tags.includes('premature_exit')) updated.exit_reason = 'thesis-broke';
  if (POS.tags.includes('fomo_entry')) updated.emotion = 'fomo';
  if (POS.tags.includes('premature_exit')) updated.grade = 'broken';
  updated.updated_at = new Date().toISOString();

  state.trades[tradeIdx] = updated;
  saveState();
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }
  closePositionEditor();
  renderHome();
  renderLogStats();
  renderLogTable();
  if (typeof renderTrade === 'function') renderTrade();
  toast('Trade updated');
}

function _deletePositionEditor() {
  const t = POS.trade;
  if (!t) return;
  if (!confirm(`Delete this trade?\n\n${t.ticker} ${t.setup || ''} ${t.date || ''}\n\nThis cannot be undone.`)) return;
  if (!state.deletedTradeIds) state.deletedTradeIds = {};
  state.deletedTradeIds[t.id] = new Date().toISOString();
  state.trades = state.trades.filter(x => x.id !== t.id);
  saveState();
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }
  closePositionEditor();
  renderHome();
  renderLogStats();
  renderLogTable();
  if (typeof renderTrade === 'function') renderTrade();
  toast('Trade deleted');
}

function _wirePositionEditor() {
  const modal = document.getElementById('modal-position');
  if (!modal) return;
  // Backdrop close
  modal.addEventListener('click', e => { if (e.target === e.currentTarget) closePositionEditor(); });
  document.querySelectorAll('[data-close-position]').forEach(b => b.addEventListener('click', closePositionEditor));
  // Tabs
  document.querySelectorAll('#pos-tabs .pos-tab').forEach(b => b.addEventListener('click', () => setPositionTab(b.dataset.posTab)));
  // Mark price input
  document.getElementById('pos-mark').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    POS.mark = isNaN(v) ? null : v;
    renderPositionEditor();
  });
  // Quick scale
  document.querySelectorAll('.pos-quick-btn').forEach(b => b.addEventListener('click', () => _execScale(parseFloat(b.dataset.scale))));
  // Execute exit
  document.getElementById('pos-execute-btn').addEventListener('click', _execExit);
  // Exec log delete (event delegation)
  document.getElementById('pos-exec-log-body').addEventListener('click', e => {
    const btn = e.target.closest('.pos-exec-del-btn');
    if (btn) _delExec(btn.dataset.execId);
  });
  // Tag chips
  document.querySelectorAll('#pos-tag-group .pos-tag').forEach(b => b.addEventListener('click', () => _toggleTag(b.dataset.tag)));
  // Save / delete
  document.getElementById('pos-save-btn').addEventListener('click', _savePositionEditor);
  document.getElementById('pos-delete-btn').addEventListener('click', _deletePositionEditor);
  // Refine — light cleanup pass: trim, collapse newlines, sentence-case first letter
  document.getElementById('pos-refine-btn').addEventListener('click', () => {
    const ta = document.getElementById('pos-notes');
    let v = (ta.value || '').replace(/\s+/g, ' ').trim();
    if (v) v = v[0].toUpperCase() + v.slice(1);
    if (v && !/[.!?]$/.test(v)) v += '.';
    ta.value = v;
    toast('Notes cleaned up');
  });
  // Dictate — Web Speech API if available
  const dictateBtn = document.getElementById('pos-dictate-btn');
  let recognition = null;
  let recognizing = false;
  dictateBtn.addEventListener('click', () => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) { toast('Voice input not supported in this browser', true); return; }
    if (recognizing && recognition) { recognition.stop(); return; }
    recognition = new Rec();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => { recognizing = true; dictateBtn.style.color = 'var(--red-bright)'; };
    recognition.onend = () => { recognizing = false; dictateBtn.style.color = ''; };
    recognition.onerror = () => { recognizing = false; dictateBtn.style.color = ''; };
    recognition.onresult = e => {
      const txt = Array.from(e.results).map(r => r[0].transcript).join(' ');
      const ta = document.getElementById('pos-notes');
      ta.value = (ta.value ? ta.value + ' ' : '') + txt;
    };
    recognition.start();
  });
  // Image paste — only when modal is open and journal pane visible
  document.addEventListener('paste', e => {
    if (!modal.classList.contains('show')) return;
    if (!document.querySelector('[data-pos-pane="journal"].active')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        const reader = new FileReader();
        reader.onload = ev => { POS.playbookImage = ev.target.result; _renderPlaybookImage(); };
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  });
  // Click on drop area to open file picker
  const drop = document.getElementById('pos-playbook-drop');
  const fileInput = document.getElementById('pos-playbook-file');
  drop.addEventListener('click', () => fileInput.click());
  document.getElementById('pos-paste-img-btn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => { POS.playbookImage = ev.target.result; _renderPlaybookImage(); };
    reader.readAsDataURL(f);
    e.target.value = '';
  });
}

// ---------- Sunday checklist ----------
function renderSunday() {
  document.querySelectorAll('.checklist-item').forEach(el => {
    const block = el.parentElement.dataset.block;
    const key = el.dataset.key;
    const fullKey = block + '_' + key;
    el.classList.toggle('done', !!state.sundayChecks[fullKey]);
  });
  renderSectors();
}

function toggleSunday(el) {
  const block = el.parentElement.dataset.block;
  const key = el.dataset.key;
  const fullKey = block + '_' + key;
  state.sundayChecks[fullKey] = !state.sundayChecks[fullKey];
  saveState();
  renderSunday();
}

// ---------- Sectors panel (Sunday Prep Block 02) ----------
function renderSectors() {
  const grid = document.getElementById('sector-grid');
  if (!grid) return;

  // Build sector cards
  grid.innerHTML = SECTORS.map(s => {
    const rating = state.sectorRatings[s.ticker] || '';
    const status = ratingToStatus(rating);
    const label = ratingToLabel(rating);
    const cardClass = status ? status.toLowerCase() : '';
    const statusClass = status ? status.toLowerCase() : 'unrated';
    const statusLabel = status
      ? (status === 'STRONG' ? '🟢 STRONG'
         : status === 'NEUTRAL' ? '🟡 NEUTRAL'
         : '🔴 WEAK')
      : '— UNRATED —';
    const labelText = label ? `${label}` : '— enter rating —';

    return `
      <div class="sector-card ${cardClass}" data-ticker="${s.ticker}">
        <div class="sector-card-header">
          <span class="sector-card-ticker">${s.ticker}</span>
          <span class="sector-card-name">${s.name}</span>
        </div>
        <div class="sector-card-row">
          <input
            type="number"
            class="sector-card-grade-select"
            data-ticker="${s.ticker}"
            placeholder="SA Quant rating"
            inputmode="decimal"
            min="1"
            max="5"
            step="0.01"
            value="${rating}"
          />
          <span class="sector-card-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="sector-card-label">${labelText}</div>
      </div>
    `;
  }).join('');

  // Wire decimal inputs (live update only — no blur re-render to avoid stealing focus)
  grid.querySelectorAll('input[data-ticker]').forEach(inp => {
    inp.addEventListener('input', e => {
      const ticker = e.target.dataset.ticker;
      const raw = e.target.value.trim();
      const num = parseFloat(raw);
      if (raw === '' || isNaN(num)) {
        delete state.sectorRatings[ticker];
      } else if (num < 1 || num > 5) {
        // Out of range — keep typing but don't persist yet
        return;
      } else {
        state.sectorRatings[ticker] = raw;
      }
      state.sectorRatedAt = new Date().toISOString();
      touchMarketContext();
      saveState();
      renderHome();
      // Update only the surrounding card classes + label without full re-render
      // (full re-render would steal focus while user types)
      updateSectorCardLive(ticker, raw);
      updateSectorSummary();
      renderSectorStatusMini();
    });
  });

  // Update Top 3 / Avoid summary
  const top3 = computeTop3();
  const avoid = computeAvoidList();

  const top3El = document.getElementById('sector-top3');
  const avoidEl = document.getElementById('sector-avoid');
  const ratedAtEl = document.getElementById('sector-rated-at');

  if (top3El) {
    top3El.textContent = top3.length
      ? top3.map(t => `${t.name} ${t.ticker}`).join(', ')
      : '— rate sectors below to populate —';
  }
  if (avoidEl) {
    avoidEl.textContent = avoid.length
      ? avoid.map(t => `${t.name} ${t.ticker}`).join(', ')
      : '— none —';
  }
  if (ratedAtEl) {
    ratedAtEl.textContent = state.sectorRatedAt
      ? formatRatedAt(state.sectorRatedAt)
      : '— never —';
  }

  // Stale warning
  const existingWarning = grid.parentElement.querySelector('.sector-stale-warning');
  if (existingWarning) existingWarning.remove();

  if (state.sectorRatedAt && isSectorRatingStale()) {
    const days = daysSinceSectorRating();
    const warning = document.createElement('div');
    warning.className = 'sector-stale-warning';
    warning.textContent = `⚠️  Sector grades are ${days} days old — re-rate before sizing new trades`;
    grid.parentElement.insertBefore(warning, grid);
  }
}

function computeTop3() {
  // Pick STRONG sectors (rating 3.5 or higher), highest decimal first
  const strong = SECTORS
    .map(s => ({ ...s, rating: state.sectorRatings[s.ticker] }))
    .filter(s => ratingToStatus(s.rating) === 'STRONG')
    .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
  return strong.slice(0, 3);
}

function computeAvoidList() {
  // Pick WEAK sectors (rating <2.5), lowest decimal first (worst at top)
  return SECTORS
    .map(s => ({ ...s, rating: state.sectorRatings[s.ticker] }))
    .filter(s => ratingToStatus(s.rating) === 'WEAK')
    .sort((a, b) => parseFloat(a.rating) - parseFloat(b.rating));
}

// Update a single sector card's classes + label without re-rendering whole grid
// (avoids stealing focus from the input while user types)
function updateSectorCardLive(ticker, rawValue) {
  const card = document.querySelector(`.sector-card[data-ticker="${ticker}"]`);
  if (!card) return;
  const status = ratingToStatus(rawValue);
  const label = ratingToLabel(rawValue);
  card.classList.remove('strong', 'neutral', 'weak');
  if (status) card.classList.add(status.toLowerCase());

  const statusEl = card.querySelector('.sector-card-status');
  statusEl.classList.remove('strong', 'neutral', 'weak', 'unrated');
  if (status) {
    statusEl.classList.add(status.toLowerCase());
    statusEl.textContent = status === 'STRONG' ? '🟢 STRONG'
      : status === 'NEUTRAL' ? '🟡 NEUTRAL' : '🔴 WEAK';
  } else {
    statusEl.classList.add('unrated');
    statusEl.textContent = '— UNRATED —';
  }

  const labelEl = card.querySelector('.sector-card-label');
  if (labelEl) {
    labelEl.textContent = label || '— enter rating —';
  }
}

// Refresh the Top 3 / Avoid summary text only (no input re-render)
function updateSectorSummary() {
  const top3 = computeTop3();
  const avoid = computeAvoidList();
  const top3El = document.getElementById('sector-top3');
  const avoidEl = document.getElementById('sector-avoid');
  const ratedAtEl = document.getElementById('sector-rated-at');

  if (top3El) {
    top3El.textContent = top3.length
      ? top3.map(t => `${t.name} ${t.ticker}`).join(', ')
      : '— rate sectors below to populate —';
  }
  if (avoidEl) {
    avoidEl.textContent = avoid.length
      ? avoid.map(t => `${t.name} ${t.ticker}`).join(', ')
      : '— none —';
  }
  if (ratedAtEl) {
    ratedAtEl.textContent = state.sectorRatedAt
      ? formatRatedAt(state.sectorRatedAt)
      : '— never —';
  }
}

function formatRatedAt(iso) {
  const d = new Date(iso);
  const days = daysSinceSectorRating();
  const label = days === 0 ? 'today'
    : days === 1 ? 'yesterday'
    : `${days} days ago`;
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dateStr} (${label})`;
}

function daysSinceSectorRating() {
  if (!state.sectorRatedAt) return null;
  const ratedAt = new Date(state.sectorRatedAt);
  const now = new Date();
  return Math.floor((now - ratedAt) / (1000 * 60 * 60 * 24));
}

function isSectorRatingStale() {
  const days = daysSinceSectorRating();
  return days !== null && days > 7;
}

function clearSectors() {
  if (!confirm('Clear all sector ratings? This cannot be undone.')) return;
  state.sectorRatings = {};
  state.sectorRatedAt = null;
  touchMarketContext();
  saveState();
  renderHome();
  renderSectors();
  renderSectorStatusMini();
  toast('Sector grades cleared');
}

// ---------- Sector Status mini-card (New Trade tab) ----------
function renderSectorStatusMini() {
  const card = document.getElementById('sector-status-mini');
  if (!card) return;

  const top3 = computeTop3();
  const avoid = computeAvoidList();
  const hasRatings = Object.keys(state.sectorRatings).length > 0;

  if (!hasRatings) {
    card.querySelector('.sector-status-mini-list').innerHTML =
      '<span class="sector-status-mini-empty">No sector ratings set yet — head to Sunday Prep tab to rate sectors</span>';
    card.querySelector('.sector-status-mini-rated').textContent = '';
    return;
  }

  const days = daysSinceSectorRating();
  const ratedLabel = days === 0 ? 'rated today'
    : days === 1 ? 'rated yesterday'
    : `rated ${days}d ago${isSectorRatingStale() ? ' ⚠️' : ''}`;
  card.querySelector('.sector-status-mini-rated').textContent = ratedLabel;

  const pills = [];
  top3.forEach(s => {
    pills.push(`<span class="sector-status-mini-pill strong">🟢 ${s.name} <span style="opacity:0.7;font-weight:600;">${s.ticker}</span></span>`);
  });
  avoid.forEach(s => {
    pills.push(`<span class="sector-status-mini-pill weak">🔴 ${s.name} <span style="opacity:0.7;font-weight:600;">${s.ticker}</span></span>`);
  });
  if (pills.length === 0) {
    pills.push('<span class="sector-status-mini-empty">All sectors rated NEUTRAL — broad market, no edge</span>');
  }

  card.querySelector('.sector-status-mini-list').innerHTML = pills.join('');
}

// ---------- Settings ----------
function openSettings() {
  const s = state.settings;
  document.getElementById('set-account').value = s.account;
  document.getElementById('set-risk-on').value = s.riskOn;
  document.getElementById('set-risk-neutral').value = s.riskNeutral;
  document.getElementById('set-risk-off').value = s.riskOff;
  document.getElementById('set-stop-pct').value = s.stopPct;
  document.getElementById('set-target-pct').value = s.targetPct;
  document.getElementById('set-max-positions').value = s.maxPositions;
  document.getElementById('set-max-premium').value = s.maxPremiumPct;
  document.getElementById('set-max-risk').value = s.maxRiskPct;
  document.getElementById('set-long-only').checked = s.longOnlyMode || false;
  // Intraday
  document.getElementById('set-i-risk').value = s.intradayRiskPerTrade;
  document.getElementById('set-i-max-loss').value = s.intradayMaxDailyLoss;
  document.getElementById('set-i-max-spread').value = s.intradayMaxSpreadPct;
  document.getElementById('set-i-delta').value = s.intradayDefaultDelta;
  // Alpha Intel
  const ksEl = document.getElementById('set-killswitch-days');
  if (ksEl) ksEl.value = s.killSwitchDays || DEFAULT_SETTINGS.killSwitchDays;
  document.getElementById('modal-settings').classList.add('show');
}

function closeSettings() {
  document.getElementById('modal-settings').classList.remove('show');
}

function saveSettings() {
  const newSettings = {
    account: parseFloat(document.getElementById('set-account').value) || DEFAULT_SETTINGS.account,
    riskOn: parseFloat(document.getElementById('set-risk-on').value) || DEFAULT_SETTINGS.riskOn,
    riskNeutral: parseFloat(document.getElementById('set-risk-neutral').value) || DEFAULT_SETTINGS.riskNeutral,
    riskOff: parseFloat(document.getElementById('set-risk-off').value) || DEFAULT_SETTINGS.riskOff,
    stopPct: parseFloat(document.getElementById('set-stop-pct').value) || DEFAULT_SETTINGS.stopPct,
    targetPct: parseFloat(document.getElementById('set-target-pct').value) || DEFAULT_SETTINGS.targetPct,
    maxPositions: parseInt(document.getElementById('set-max-positions').value) || DEFAULT_SETTINGS.maxPositions,
    maxPremiumPct: parseFloat(document.getElementById('set-max-premium').value) || DEFAULT_SETTINGS.maxPremiumPct,
    maxRiskPct: parseFloat(document.getElementById('set-max-risk').value) || DEFAULT_SETTINGS.maxRiskPct,
    longOnlyMode: document.getElementById('set-long-only').checked,
    intradayRiskPerTrade: parseFloat(document.getElementById('set-i-risk').value) || DEFAULT_SETTINGS.intradayRiskPerTrade,
    intradayMaxDailyLoss: parseFloat(document.getElementById('set-i-max-loss').value) || DEFAULT_SETTINGS.intradayMaxDailyLoss,
    intradayMaxSpreadPct: parseFloat(document.getElementById('set-i-max-spread').value) || DEFAULT_SETTINGS.intradayMaxSpreadPct,
    intradayDefaultDelta: parseFloat(document.getElementById('set-i-delta').value) || DEFAULT_SETTINGS.intradayDefaultDelta,
    killSwitchDays: parseInt(document.getElementById('set-killswitch-days')?.value) || DEFAULT_SETTINGS.killSwitchDays,
  };
  state.settings = newSettings;
  saveState();
  closeSettings();

  // Re-render everything that depends on settings
  renderHome();
  renderRegime();
  renderPretradeCheck();
  renderLogStats();
  renderReference();
  if (typeof renderTrade === 'function') renderTrade();
  toast('Settings saved');
}

function resetSettingsToDefaults() {
  if (!confirm('Reset all settings to v2 defaults?')) return;
  state.settings = { ...DEFAULT_SETTINGS };
  openSettings();  // reload form with defaults
  toast('Defaults loaded — click Save to apply');
}

function clearAllTradesAndData() {
  const tradeCount = (state.trades || []).length;
  const ok = confirm(
    `Clear all trades and cockpit data?\n\n` +
    `This deletes ${tradeCount} trade${tradeCount === 1 ? '' : 's'}, sector ratings, Sunday/session progress, and current analysis inputs. Settings are preserved.\n\n` +
    `This cannot be undone.`
  );
  if (!ok) return;

  const deletedAt = new Date().toISOString();
  const deletedTradeIds = { ...(state.deletedTradeIds || {}) };
  (state.trades || []).forEach(t => {
    if (t && t.id) deletedTradeIds[t.id] = deletedAt;
  });

  const settings = { ...state.settings };
  // Replace state contents while preserving object identity (so module imports
  // and window.state continue to point at the same object).
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, {
    settings,
    regime: 'risk-on',
    activeMode: 'home',
    homeFilterDate: null,
    trades: [],
    deletedTradeIds,
    selectedSetup: null,
    instrument: 'options',
    ivr: null,
    direction: 'long',
    premium: null,
    atr: null,
    underlyingPrice: null,
    ticker: null,
    saQuant: null,
    daysToEarnings: null,
    gateChecks: {},
    pretradeChecks: { vix: true, news: true },
    sundayChecks: {},
    sectorNotes: '',
    sectorRatings: {},
    sectorRatedAt: null,
    marketContextUpdatedAt: deletedAt,
    liquidity: { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null },
    intraday: newIntradayTicket(),
    intradayQuality: { timeOverride: false },
    logModeFilter: 'all',
    logSearch: '',
    logSetupFilter: '',
    homePortfolioView: 'recent',
    tradeFlow: { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 },
  });

  ['ivr-input','premium-input','atr-input','underlying-price-input','ticker-input','sa-quant-input','days-to-earnings-input']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  ['i-ticker','i-entry','i-stop','i-target','i-contracts','i-spread','i-vwap-rel','i-notes']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  const directionInput = document.getElementById('direction-input');
  if (directionInput) directionInput.value = 'long';
  const logFilter = document.getElementById('log-mode-filter');
  if (logFilter) logFilter.value = 'all';

  saveState();
  closeSettings();
  closeContextPanel();
  setTab('home');
  renderHome();
  renderRegime();
  renderPretradeCheck();
  renderLogStats();
  renderLogTable();
  renderSectors();
  if (typeof renderSectorStatusMini === 'function') renderSectorStatusMini();
  toast('All trades and cockpit data cleared');
}

function renderReference() {
  const s = state.settings;
  const account = s.account;

  // Regime sizing card
  const sizing = document.getElementById('ref-sizing-content');
  if (sizing) {
    const fmt = pct => pct.toFixed(2).replace(/\.?0+$/, '') + '%';
    sizing.innerHTML = `
      <div class="regime-info-card on">
        <div class="regime-info-label on">🟢 RISK-ON</div>
        <div style="font-size: 12px; color: var(--ink-2); line-height: 1.5;">
          Long full size <strong>${fmt(s.riskOn)}</strong> per trade<br/>
          ($${(account * s.riskOn / 100).toFixed(0)} risk dollars)<br/>
          Short blocked
        </div>
      </div>
      <div class="regime-info-card neut">
        <div class="regime-info-label neut">🟡 NEUTRAL</div>
        <div style="font-size: 12px; color: var(--ink-2); line-height: 1.5;">
          Reduced size <strong>${fmt(s.riskNeutral)}</strong> per trade<br/>
          ($${(account * s.riskNeutral / 100).toFixed(0)} risk dollars)<br/>
          Both directions allowed
        </div>
      </div>
      <div class="regime-info-card off">
        <div class="regime-info-label off">🔴 RISK-OFF</div>
        <div style="font-size: 12px; color: var(--ink-2); line-height: 1.5;">
          Defensive size <strong>${fmt(s.riskOff)}</strong> per trade<br/>
          ($${(account * s.riskOff / 100).toFixed(0)} risk dollars)<br/>
          Long blocked, puts only
        </div>
      </div>
    `;
  }

  // Caps card
  const caps = document.getElementById('ref-caps-list');
  if (caps) {
    caps.innerHTML = `
      <li><span class="ref-key amber">max ${s.maxPositions}</span><span class="ref-val">Concurrent positions</span></li>
      <li><span class="ref-key amber">max ${s.maxPremiumPct}%</span><span class="ref-val">Total premium deployed ($${(account * s.maxPremiumPct / 100).toFixed(0)})</span></li>
      <li><span class="ref-key amber">max ${s.maxRiskPct}%</span><span class="ref-val">Total at risk ($${(account * s.maxRiskPct / 100).toFixed(0)})</span></li>
      <li><span class="ref-key amber">${s.stopPct}%</span><span class="ref-val">Stop loss as % of premium paid</span></li>
      <li><span class="ref-key green">+${s.targetPct}%</span><span class="ref-val">Profit target as % of premium gain</span></li>
    `;
  }
}

// ---------- Toast ----------
let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = isError ? 'var(--red)' : 'var(--green)';
  t.style.borderLeftColor = isError ? 'var(--red)' : 'var(--green)';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- CSV Export ----------
function exportCSV() {
  if (state.trades.length === 0) { toast('No trades to export', true); return; }
  const cols = ['date','mode','ticker','setup','direction','entry','contracts','ivr','regime','status','exit','exit_date','riskDollars','grade','thesis','premortem','stop'];
  const csv = [
    cols.join(','),
    ...state.trades.map(t => cols.map(c => {
      let v = t[c] || '';
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
        v = '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    }).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mac_trades_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported');
}

// ---------- JSON Export / Import ----------
function exportJSON() {
  // Full state snapshot (settings, regime, sectors, trades) for cross-machine sync
  const blob = new Blob([JSON.stringify({
    version: 'mac-v3',
    exportedAt: new Date().toISOString(),
    state: state
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mac_state_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  // Stamp the export so the "stale backup" nudge stays quiet
  localStorage.setItem('mac_cockpit_last_export', String(Date.now()));
  hideStaleBackupNudge();
  toast('JSON snapshot exported');
}

// ---------- Stale-backup nudge ----------
// Even with Supabase sync, a local JSON export is cheap insurance against
// cloud account issues, schema migrations gone wrong, or just wanting an
// archived snapshot. Nudge if no export in 7+ days.
function checkStaleBackup() {
  const last = Number(localStorage.getItem('mac_cockpit_last_export') || 0);
  if (!last) return;  // never exported — don't nag a brand-new user
  const days = (Date.now() - last) / (1000 * 60 * 60 * 24);
  if (days >= 7) showStaleBackupNudge(Math.floor(days));
}

function showStaleBackupNudge(daysOld) {
  if (document.getElementById('stale-backup-nudge')) return;
  const banner = document.createElement('div');
  banner.id = 'stale-backup-nudge';
  banner.style.cssText = 'position: fixed; bottom: 16px; right: 16px; z-index: 9999; background: var(--bg-card); border: 1px solid var(--amber); border-left: 3px solid var(--amber); border-radius: var(--r-md); padding: 12px 16px; max-width: 340px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); font-size: 13px;';
  banner.innerHTML = `
    <div style="display: flex; gap: 10px; align-items: flex-start;">
      <span style="font-size: 16px; flex-shrink: 0;">💾</span>
      <div style="flex: 1;">
        <div style="font-weight: 600; color: var(--ink); margin-bottom: 4px;">Backup is ${daysOld} days old</div>
        <div style="color: var(--ink-3); margin-bottom: 8px; line-height: 1.4;">Cloud sync is great but a local export is cheap insurance. Save one now?</div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-secondary" id="stale-backup-export" style="padding: 4px 10px; font-size: 11px;">Export now</button>
          <button class="btn-ghost" id="stale-backup-dismiss" style="padding: 4px 10px; font-size: 11px;">Dismiss</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(banner);
  document.getElementById('stale-backup-export').addEventListener('click', exportJSON);
  document.getElementById('stale-backup-dismiss').addEventListener('click', () => {
    // Snooze 24 hours
    localStorage.setItem('mac_cockpit_last_export', String(Date.now() - (6 * 24 * 60 * 60 * 1000)));
    hideStaleBackupNudge();
  });
}

function hideStaleBackupNudge() {
  const n = document.getElementById('stale-backup-nudge');
  if (n) n.remove();
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.state || !Array.isArray(data.state.trades)) throw new Error('Invalid format');
      const ok = confirm(`Import ${data.state.trades.length} trades and overwrite current cockpit state? Current data will be replaced.`);
      if (!ok) return;
      // Replace state contents while preserving object identity.
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, data.state);
      // Re-init missing fields after import
      if (!state.liquidity) state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
      if (!state.sectorRatings) state.sectorRatings = {};
      if (!state.pretradeChecks) state.pretradeChecks = { vix: true, news: true };
      saveState();
      toast(`Imported ${state.trades.length} trades`);
      // Hard refresh of UI
      location.reload();
    } catch (err) {
      toast('Import failed: ' + err.message, true);
    }
  };
  reader.readAsText(file);
}

// ---------- TOS Backtest Report Import ----------
// TOS exports two main formats:
//   A) "Strategy Report" tab as semicolon-delimited CSV with header row, trade rows,
//      then summary lines: "Total P/L: $X;", "Total order(s): N;", "Max trade P/L: $X;"
//   B) Older summary export with key/value lines like "Net Profit: $X" or "Percent Profitable: 55%"
// Parser handles both — extracts trade-level rows when present so we can compute win rate.
function parseTOSBacktest(rawText, filename) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n').map(l => l.replace(/^﻿/, '').trim()).filter(Boolean);
  const result = {
    id: 'bt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: filename ? filename.replace(/\.(csv|tsv|txt)$/i, '') : null,
    symbol: null,
    netProfit: null,
    winRate: null,
    trades: null,
    profitFactor: null,
    maxDrawdown: null,
    avgTrade: null,
    period: null,
    strategy: null,
    raw: text.length > 200000 ? text.slice(0, 200000) : text,
    imported_at: new Date().toISOString(),
  };

  // Detect delimiter for a single line
  const splitFor = (line) => {
    if (line.includes('\t')) return line.split('\t');
    if (line.includes(';'))  return line.split(';');
    if (line.includes(','))  return line.split(',');
    return line.split(/\s{2,}/);
  };

  // Strip quotes/dollar/commas/percent → number. Parens denote negative.
  const num = v => {
    if (v == null) return null;
    let s = String(v).trim().replace(/^["']|["']$/g, '');
    if (!s) return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[$,%\s]/g, '');
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return negative ? -Math.abs(n) : n;
  };

  // Find a labelled value: "Label: 123" or "Label;...;123"
  const findVal = (...labels) => {
    for (const label of labels) {
      const re = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:;]?', 'i');
      for (const line of lines) {
        if (re.test(line)) {
          // After the label, take the trailing numeric token.
          const after = line.replace(re, '').replace(/[;:,]\s*$/, '');
          const parts = splitFor(after);
          for (let i = parts.length - 1; i >= 0; i--) {
            const n = num(parts[i]);
            if (n !== null) return n;
          }
          // If no parts, try the raw remainder
          const n2 = num(after);
          if (n2 !== null) return n2;
        }
      }
    }
    return null;
  };

  // ---- Header metadata ----
  const symLine = lines.find(l => /^symbol\s*[:;]/i.test(l));
  if (symLine) {
    const after = symLine.replace(/^symbol\s*[:;]\s*/i, '').replace(/[;,]+$/, '').trim();
    const m = after.match(/[A-Z.]{1,6}/);
    if (m) result.symbol = m[0];
  }
  const workTime = lines.find(l => /^work\s*time\s*[:;]/i.test(l));
  if (workTime) result.period = workTime.replace(/^work\s*time\s*[:;]\s*/i, '').replace(/;+$/, '').trim();

  // ---- Trade-row table (Format A) ----
  // Find a header row containing "Trade P/L" — subsequent rows until blank are data.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/trade\s*p\/?l/i.test(lines[i]) && /side|strategy/i.test(lines[i])) { headerIdx = i; break; }
  }
  let tradeCount = 0;
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let netFromRows = 0;
  let strategySeen = null;
  if (headerIdx >= 0) {
    const headerParts = splitFor(lines[headerIdx]).map(s => s.trim().toLowerCase());
    const colTradePL  = headerParts.findIndex(c => /^trade\s*p\/?l/.test(c));
    const colSide     = headerParts.findIndex(c => /^side$/.test(c));
    const colStrategy = headerParts.findIndex(c => /^strategy$/.test(c));
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const ln = lines[i];
      // Stop at the summary section (blank already filtered, so look for non-numeric leading)
      if (/^total\s+p\/?l/i.test(ln) || /^max\s+trade\s+p\/?l/i.test(ln) || /^total\s+order/i.test(ln)) break;
      const parts = splitFor(ln);
      if (!parts.length) continue;
      // Trade row starts with a numeric Id
      if (!/^\d+$/.test(parts[0].trim())) continue;
      const side = colSide >= 0 ? (parts[colSide] || '').trim().toLowerCase() : '';
      // Only count exits as trades — entries pair to exits to form one trade
      if (side && !/(close|cover)/.test(side)) continue;
      const pl = colTradePL >= 0 ? num(parts[colTradePL]) : null;
      if (pl === null) continue;
      tradeCount++;
      netFromRows += pl;
      if (pl > 0) { wins++; grossWin += pl; }
      else if (pl < 0) { losses++; grossLoss += Math.abs(pl); }
      if (colStrategy >= 0 && !strategySeen) {
        const stratRaw = (parts[colStrategy] || '').trim();
        const m = stratRaw.match(/^([A-Z][A-Za-z0-9_]+)/);
        if (m) strategySeen = m[1];
      }
    }
  }

  // ---- Summary lines (Format A footer + Format B) ----
  result.netProfit    = findVal('Total P/L', 'Net Profit', 'Total Net Profit', 'Total Net P/L');
  result.trades       = findVal('Total Number of Trades', 'Number of Trades', 'Total Trades', '# of Trades');
  result.winRate      = findVal('Percent Profitable', 'Win Rate', 'Profitable %', '% Profitable');
  result.profitFactor = findVal('Profit Factor');
  result.maxDrawdown  = findVal('Max Drawdown', 'Max. Drawdown');
  result.avgTrade     = findVal('Avg Trade', 'Avg. Trade', 'Average Trade', 'Max trade P/L');

  // Fill from row-derived stats when summary line is missing
  if (result.netProfit === null && tradeCount > 0) result.netProfit = Number(netFromRows.toFixed(2));
  if (result.trades === null && tradeCount > 0) result.trades = tradeCount;
  if (result.winRate === null && tradeCount > 0) result.winRate = (wins / tradeCount) * 100;
  if (result.profitFactor === null && grossLoss > 0) result.profitFactor = Number((grossWin / grossLoss).toFixed(2));
  if (result.avgTrade === null && tradeCount > 0) result.avgTrade = Number((netFromRows / tradeCount).toFixed(2));

  if (strategySeen) result.strategy = strategySeen;

  if (!result.symbol && filename) {
    const m = filename.match(/[A-Z]{1,5}/);
    if (m) result.symbol = m[0];
  }

  // Auto-name from strategy + symbol if no explicit name
  if (result.name && /^StrategyReports?_/i.test(result.name) && result.symbol) {
    result.name = (result.strategy || 'Strategy') + ' · ' + result.symbol;
  }

  // Failure: nothing found at all
  if (result.netProfit === null && result.trades === null && result.winRate === null) {
    return { ok: false, reason: 'Could not detect TOS Strategy Report fields. Looked for "Total P/L", "Total order(s)", "Net Profit", "Percent Profitable", and trade rows with "Trade P/L". Got ' + lines.length + ' lines.' };
  }
  return { ok: true, report: result };
}

function addBacktestReport(report) {
  if (!state.backtestReports) state.backtestReports = [];
  state.backtestReports.unshift(report);
  saveState();
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }
  renderLogStats();
  toast('Backtest imported');
}

window.deleteBacktestReport = function(id) {
  if (!state.backtestReports) return;
  if (!confirm('Remove this backtest report?')) return;
  state.backtestReports = state.backtestReports.filter(r => r.id !== id);
  saveState();
  renderLogStats();
  toast('Backtest removed');
};

function importBacktestFromFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = parseTOSBacktest(e.target.result, file.name);
    if (!parsed.ok) { toast(parsed.reason || 'Could not parse backtest', true); return; }
    addBacktestReport(parsed.report);
  };
  reader.readAsText(file);
}

function importBacktestFromPaste() {
  const txt = prompt('Paste your TOS Strategy Report below (tab-delimited or CSV):');
  if (!txt || !txt.trim()) return;
  const parsed = parseTOSBacktest(txt, null);
  if (!parsed.ok) { toast(parsed.reason || 'Could not parse backtest', true); return; }
  // Ask for an optional name
  const name = prompt('Give this backtest a name (e.g., "21-EMA Pullback / SPY 2024"):', 'Backtest ' + new Date().toLocaleDateString());
  if (name) parsed.report.name = name.trim();
  addBacktestReport(parsed.report);
}

// ---------- Intraday Trade Helpers ----------
// todayISO → src/models/formatters.js

function todayIntradayTrades() {
  return state.trades.filter(t => t.mode === "intraday" && t.date === todayISO());
}

function isInIntradayWindow() {
  const now = new Date();
  const total = now.getHours() * 60 + now.getMinutes();
  const morning = total >= 9 * 60 + 35 && total <= 11 * 60 + 30;
  const afternoon = total >= 14 * 60 && total <= 15 * 60 + 30;
  return morning || afternoon;
}

function logIntradayTrade() {
  const t = state.intraday;
  const instrument = t.instrument === 'stocks' ? 'stocks' : 'options';
  const multiplier = instrument === 'stocks' ? 1 : 100;
  const stopDist = Math.abs(t.entry - t.stop);
  const qty = t.contracts ||
    Math.max(1, Math.floor(state.settings.intradayRiskPerTrade / Math.max(0.01, stopDist * multiplier)));
  const bid = Number(t.bid);
  const ask = Number(t.ask);
  const mid = instrument === 'options'
    ? (Number(t.mid) || (bid > 0 && ask > 0 ? (bid + ask) / 2 : null))
    : null;
  const spreadPct = instrument === 'options' ? deriveSpreadPct(t) : null;
  const nowIso = new Date().toISOString();
  const trade = {
    id: 'i_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    mode: 'intraday',
    instrument,
    structure: t.structure || instrument,
    date: todayISO(),
    time: new Date().toTimeString().slice(0, 5),
    ticker: t.ticker,
    direction: t.direction === 'short' ? 'Short' : 'Long',
    setup: t.setup,
    entry: t.entry,
    stop: t.stop,
    target: t.target,
    contracts: qty,
    shares: instrument === 'stocks' ? qty : null,
    spreadPct,
    bid: t.bid ?? null,
    ask: t.ask ?? null,
    mid: mid ?? null,
    // Legacy field — kept for older trade rows that may still be pulling it.
    vwapRel: t.vwapRel || '',
    // ThinkScript-aligned context (recorded for review, not blocking GO).
    orbType:    t.orbType || null,
    orHi:       t.orHi    ?? null,
    orLo:       t.orLo    ?? null,
    orRng:      t.orRng   ?? null,
    confluence: t.confluence || '',
    breadth:    t.breadth    || '',
    vwapValue:  t.vwapValue  ?? null,
    notes: t.notes,
    riskDollars: state.settings.intradayRiskPerTrade,
    inWindow: isInIntradayWindow(),
    tradeNumOfDay: todayIntradayTrades().length + 1,
    regime: state.regime,
    ivr: null,
    thesis: t.notes,
    premortem: '',
    status: 'open',
    exit: null,
    grade: null,
    lesson: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  state.trades.push(trade);
  state.intraday = newIntradayTicket();
  state.intradayQuality.timeOverride = false;
  if (state.tradeFlow) state.tradeFlow.intradayDraft = {};
  saveState();
  // Force immediate push of the new trade
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }
  renderHome();
  renderLogStats();
  if (typeof renderUniversalSidebar === 'function') renderUniversalSidebar();
  if (typeof renderTrade === 'function') renderTrade();
  toast('Intraday trade logged');
}

// =====================================================================
// UNIFIED TRADE FLOW
// =====================================================================
// Self-contained module. Reads/writes the same state fields as the
// legacy panels (selectedSetup, ivr, premium, atr, underlyingPrice,
// gateChecks, intraday) so trade data round-trips between flows.

// TRADE_SWING_SETUPS, TRADE_STRUCTURES, TRADE_INTRADAY_SETUPS, TRADE_SETUP_TEMPLATES,
// TRADE_INTRADAY_LEGACY_MAP, TRADE_ORB_TYPES, TRADE_CONFLUENCE_OPTIONS, TRADE_BREADTH_OPTIONS
// → src/config/constants.js

// Compute rolling P/L over last N days — delegates to the canonical
// computeRollingPL (kept as alias so the trade flow doesn't depend on
// load order).
function tfComputeRolling30dPL() {
  return (typeof computeRollingPL === 'function')
    ? computeRollingPL()
    : { totalPL: 0, pct: 0, days: (state.settings && state.settings.killSwitchDays) || 30 };
}

// Pure gate evaluation — doesn't mutate state
function tfEvaluateGates() {
  const liqOk = (typeof liquidityOK === 'function') ? liquidityOK() : !!state.gateChecks['04'];
  const isOptions = state.instrument !== 'stocks';
  return {
    '01': state.saQuant !== null && state.saQuant !== undefined && state.saQuant >= 3.5,
    '02': !!state.gateChecks['02'],
    '03': !!state.gateChecks['03'],
    '04': liqOk,
    '05': state.daysToEarnings !== null && state.daysToEarnings !== undefined && state.daysToEarnings >= 8,
    '06': isOptions
      ? state.atr !== null && state.atr > 0 && state.underlyingPrice !== null && state.underlyingPrice > 0
      : state.premium !== null && state.premium > 0,
  };
}

// Live status: { tone, reason, step } — drives the sticky header status pill.
// `step` is the step number (1-based) where the user can fix the issue. The
// header pill uses this to show "Step N: <reason>" and to jump to that step
// when the user clicks it.
function tfComputeStatus() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const s = state.settings || DEFAULT_SETTINGS;

  // Universal kill-switch — hard block no matter the step. Surface it on
  // step 1 so the user lands somewhere when they click the pill.
  const ks = tfComputeRolling30dPL();
  if (ks.pct <= -7) {
    return { tone: 'blocked', reason: `Last ${ks.days}d down ${Math.abs(ks.pct).toFixed(1)}% — kill switch`, step: 1 };
  }

  if (m === 'swing') {
    // 1 Quality — ticker plus business/quality gates.
    if (!state.ticker)        return { tone: 'progress', reason: 'Add ticker',        step: 1 };
    if (state.saQuant === null || state.saQuant === undefined) return { tone: 'progress', reason: 'Add SA Quant rating', step: 1 };
    if (state.daysToEarnings === null || state.daysToEarnings === undefined) return { tone: 'progress', reason: 'Add days to earnings', step: 1 };
    const g = tfEvaluateGates();
    if (!g['01']) return { tone: 'blocked',  reason: 'SA Quant < 3.50 — skip',         step: 1 };
    if (!g['02']) return { tone: 'progress', reason: 'Confirm profitability grade',    step: 1 };
    if (!g['03']) return { tone: 'progress', reason: 'Confirm momentum grade',         step: 1 };
    if (!g['05']) return { tone: 'blocked',  reason: 'Earnings within 7 days',         step: 1 };

    // 2 Technicals — direction, setup pattern, and option contract spec.
    if (!state.direction)     return { tone: 'progress', reason: 'Pick direction',    step: 2 };
    if (!state.selectedSetup) return { tone: 'progress', reason: 'Pick a setup',      step: 2 };
    const isOptions = state.instrument !== 'stocks';
    if (isOptions && (state.ivr === null || state.ivr === undefined)) return { tone: 'progress', reason: 'Add IV Rank', step: 2 };
    if (isOptions && state.ivr >= 70) return { tone: 'blocked', reason: 'IVR ≥ 70 — too rich, skip', step: 2 };

    // 3 Size — liquidity, quote/entry, and risk sizing.
    if (!g['04']) return { tone: 'progress', reason: 'Liquidity inputs incomplete', step: 3 };
    if (state.premium === null || state.premium === undefined || state.premium <= 0) {
      return { tone: 'progress', reason: isOptions ? 'Review entry premium' : 'Add share price', step: 3 };
    }
    if (isOptions && (state.atr === null || state.atr === undefined || state.atr <= 0)) {
      return { tone: 'progress', reason: 'Add ATR(14)', step: 3 };
    }
    if (isOptions && (state.underlyingPrice === null || state.underlyingPrice === undefined || state.underlyingPrice <= 0)) {
      return { tone: 'progress', reason: 'Add underlying price', step: 3 };
    }
    if (!g['06']) return { tone: 'progress', reason: 'Stop level not set', step: 3 };
    // 4 Log — every gate green; ready to fire.
    return { tone: 'ready', reason: 'Ready to log', step: 4 };
  }

  if (m === 'intraday') {
    const it = state.intraday || {};
    const isOptions = (it.instrument || 'options') !== 'stocks';
    const setupDef = (typeof tfFindIntradaySetup === 'function') ? tfFindIntradaySetup(it.setup) : null;

    // 1 Setup — ticker / setup pattern / direction (+ direction-vs-setup-bias)
    if (!it.ticker)    return { tone: 'progress', reason: 'Add ticker',     step: 1 };
    if (!it.setup)     return { tone: 'progress', reason: 'Pick a setup',   step: 1 };
    if (!it.direction) return { tone: 'progress', reason: 'Pick direction', step: 1 };
    if (setupDef && setupDef.bias !== 'either' && it.direction !== setupDef.bias) {
      return { tone: 'blocked', reason: `${setupDef.name} expects ${setupDef.bias.toUpperCase()}`, step: 1 };
    }
    if (isOptions) {
      // 2 Plan & Size — bid/ask derives spread and usually fills the bracket.
      const spreadPct = tfDeriveIntradaySpread();
      if (spreadPct === null || spreadPct === undefined || spreadPct === '') {
        return { tone: 'progress', reason: 'Add bid/ask to auto-fill entry', step: 2 };
      }
      if (Number(spreadPct) > s.intradayMaxSpreadPct) {
        return { tone: 'blocked', reason: `Spread ${Number(spreadPct).toFixed(1)}% over ${s.intradayMaxSpreadPct}%`, step: 2 };
      }
    }
    // Levels live in the same Plan & Size group as quote/sizing.
    if (!it.entry)  return { tone: 'progress', reason: isOptions ? 'Review entry premium' : 'Add entry $', step: 2 };
    if (!it.stop)   return { tone: 'progress', reason: 'Add stop $',   step: 2 };
    if (!it.target) return { tone: 'progress', reason: 'Add target $', step: 2 };
    // 3 Context — confluence-vs-direction conflict (only when chip is set), window, loss budget
    if (it.confluence) {
      const confDef = (typeof TRADE_CONFLUENCE_OPTIONS !== 'undefined')
        ? TRADE_CONFLUENCE_OPTIONS.find(c => c.id === it.confluence) : null;
      if (confDef && confDef.bias !== 'either' && it.direction !== confDef.bias) {
        return { tone: 'blocked', reason: `Confluence is ${confDef.label} — ${confDef.bias.toUpperCase()} only`, step: 3 };
      }
    }
    const inWin = (typeof isInIntradayWindow === 'function') ? isInIntradayWindow() : true;
    if (!inWin && !(state.intradayQuality && state.intradayQuality.timeOverride)) {
      return { tone: 'blocked', reason: 'Outside entry window (override available)', step: 3 };
    }
    const dayPL = tfComputeIntradayDayPL();
    const lossBudget = s.intradayMaxDailyLoss + dayPL;
    if (lossBudget <= 0) return { tone: 'blocked', reason: 'Daily loss budget reached', step: 3 };

    return { tone: 'ready', reason: 'Ready to log', step: 3 };
  }

  return { tone: 'progress', reason: 'Pick a setup', step: 1 };
}

// Today's intraday P/L (negative on losing day) — copied semantics from existing intraday code.
function tfComputeIntradayDayPL() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();
  return (state.trades || [])
    .filter(t => t.mode === 'intraday' && isClosedTrade(t) && t.exit_date && new Date(t.exit_date).getTime() >= todayMs)
    .reduce((s, t) => s + (typeof calcPL === 'function' ? (calcPL(t) || 0) : 0), 0);
}

// Strategy label for the sticky header.
function tfComputeStrategyLabel() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') {
    if (!state.direction) return '—';
    if (state.instrument === 'stocks') return state.direction === 'long' ? 'LONG STOCK' : 'SHORT STOCK';
    if (tfStructureValue('swing') === 'spread') return state.direction === 'long' ? 'BULL DEBIT SPREAD' : 'BEAR DEBIT SPREAD';
    if (state.ivr === null || state.ivr === undefined) return state.direction === 'long' ? 'LONG (TBD)' : 'SHORT (TBD)';
    const sObj = (typeof getStrategyForIVR === 'function') ? getStrategyForIVR(state.ivr, state.direction) : null;
    if (!sObj) return state.direction === 'long' ? 'LONG' : 'SHORT';
    return (sObj.name || '').toUpperCase();
  }
  if (m === 'intraday') {
    const it = state.intraday || {};
    if (!it.direction) return '—';
    if ((it.instrument || 'options') === 'stocks') return it.direction === 'long' ? 'INTRADAY LONG STOCK' : 'INTRADAY SHORT STOCK';
    if (tfStructureValue('intraday') === 'spread') return it.direction === 'long' ? 'INTRADAY CALL SPREAD' : 'INTRADAY PUT SPREAD';
    return it.direction === 'long' ? 'INTRADAY CALL' : 'INTRADAY PUT';
  }
  return '—';
}

// IVR bracket for the input badge — single word, color tells the story.
function tfIvrBracket(ivr) {
  if (ivr === null || ivr === undefined || ivr === '') return { cls: 'empty', text: '—' };
  const v = Number(ivr);
  if (isNaN(v)) return { cls: 'empty', text: '—' };
  if (v < 30) return { cls: 'cheap', text: 'CHEAP' };
  if (v < 50) return { cls: 'mid',   text: 'MID' };
  if (v < 70) return { cls: 'rich',  text: 'RICH' };
  return                { cls: 'rich',  text: 'SKIP' };
}

// Strategy output card markup — used live by the plan/size step to surgically update
// the recommendation as IVR/direction changes. Defined once here so the
// step renderer and the live updater stay in sync.
// ----- Ticker history & autocomplete -----
// Read state.trades to surface "you've traded this name before — here's
// what worked." Anchored on the symbol the user is typing.
function tfTickerHistory(symbol) {
  if (!symbol) return null;
  const sym = String(symbol).toUpperCase();
  const trades = (state.trades || []).filter(t => (t.ticker || '').toUpperCase() === sym);
  if (!trades.length) return null;
  const closed = trades.filter(t => isClosedTrade(t));
  const wins   = closed.filter(t => (calcPL(t) || 0) > 0).length;
  const losses = closed.filter(t => (calcPL(t) || 0) < 0).length;
  const totalPL = closed.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const avgR    = closed.length ? closed.reduce((s, t) => s + (calcR(t) || 0), 0) / closed.length : 0;
  // Per-setup aggregate so we can surface the strongest pattern for this name.
  const setupMap = {};
  closed.forEach(t => {
    const k = t.setup || '—';
    if (!setupMap[k]) setupMap[k] = { name: k, n: 0, pl: 0 };
    setupMap[k].n++;
    setupMap[k].pl += (calcPL(t) || 0);
  });
  const bestSetup = Object.values(setupMap).sort((a, b) => b.pl - a.pl)[0] || null;
  // Last trade (closed first, then any).
  const sorted = [...trades].sort((a, b) =>
    (b.exit_date || b.date || '').localeCompare(a.exit_date || a.date || ''));
  const lastTrade = sorted[0];
  return {
    sym, count: trades.length, closedCount: closed.length, wins, losses,
    winRate: closed.length ? Math.round(wins / closed.length * 100) : null,
    totalPL, avgR, bestSetup, lastTrade,
    openCount: trades.filter(t => t.status === 'open').length,
  };
}

// Top tickers by trade count — used for the "Recent" pills row.
function tfTopTickers(limit = 8) {
  const counts = {};
  (state.trades || []).forEach(t => {
    const sym = (t.ticker || '').toUpperCase();
    if (!sym) return;
    counts[sym] = (counts[sym] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([sym, n]) => ({ sym, n }));
}

// Match recent tickers against the user's prefix. Empty prefix returns the
// top traded list. Used by both swing and intraday step 1 pills.
function tfTickerSuggestions(prefix, limit = 8) {
  const all = tfTopTickers(50);
  const p = (prefix || '').toUpperCase().trim();
  if (!p) return all.slice(0, limit);
  return all.filter(t => t.sym.startsWith(p)).slice(0, limit);
}

// HTML for the ticker memory block (Recent pills + history snapshot).
// Container id = tf-ticker-memory (swing) or tf-i-ticker-memory (intraday).
function tfRenderTickerMemoryHtml(currentTicker) {
  const hasInput = !!(currentTicker || '').trim();
  const matches = tfTickerSuggestions(currentTicker, hasInput ? 8 : 3);
  const hist = currentTicker ? tfTickerHistory(currentTicker) : null;
  const fmtMoney = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(Math.round(v)).toLocaleString()}`;
  const snapClass = hist ? (hist.totalPL >= 0 ? 'pos' : 'neg') : '';

  const pills = matches.length ? `
    <div class="tf-ticker-pills">
      <span class="tf-ticker-pills-label">${(currentTicker || '').trim() ? 'Match' : 'Recent'}:</span>
      ${matches.map(t => `<button type="button" class="tf-ticker-pill ${currentTicker === t.sym ? 'active' : ''}" data-tf-ticker-pick="${t.sym}">${t.sym}<span class="tf-ticker-pill-n">${t.n}</span></button>`).join('')}
    </div>` : '';

  const snap = hist ? `
    <div class="tf-ticker-snap ${snapClass}">
      <div class="tf-ticker-snap-head">
        <strong>${hist.sym}</strong> · ${hist.count} prior trade${hist.count === 1 ? '' : 's'}${hist.openCount ? ` · ${hist.openCount} open` : ''}${hist.winRate !== null ? ` · ${hist.winRate}% wins` : ''}${hist.closedCount ? ` · <span class="${hist.totalPL >= 0 ? 'pl-positive' : 'pl-negative'}">${fmtMoney(hist.totalPL)}</span>` : ''}
      </div>
      <div class="tf-ticker-snap-body">
        ${hist.bestSetup ? `<div class="tf-ticker-snap-row"><span class="k">Best setup</span><span class="v">${hist.bestSetup.name} (${fmtMoney(hist.bestSetup.pl)} · ${hist.bestSetup.n} trade${hist.bestSetup.n === 1 ? '' : 's'})</span></div>` : ''}
        ${hist.closedCount ? `<div class="tf-ticker-snap-row"><span class="k">Avg R</span><span class="v">${hist.avgR >= 0 ? '+' : ''}${hist.avgR.toFixed(2)}R</span></div>` : ''}
        ${hist.lastTrade ? `<div class="tf-ticker-snap-row"><span class="k">Last</span><span class="v">${hist.lastTrade.setup || '—'} · ${hist.lastTrade.direction || '—'} · ${hist.lastTrade.exit_date || hist.lastTrade.date || '—'}${hist.lastTrade.status === 'open' ? ' (open)' : ''}</span></div>` : ''}
      </div>
    </div>` : '';

  return pills + snap;
}

// Surgical updater — replaces only the memory div, preserves input focus.
function tfUpdateTickerMemory(containerId, currentTicker) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = tfRenderTickerMemoryHtml(currentTicker);
  // Re-bind pill clicks against the *appropriate* state path.
  el.querySelectorAll('[data-tf-ticker-pick]').forEach(b => {
    b.addEventListener('click', () => {
      const sym = b.dataset.tfTickerPick;
      // Detect which mode by the container id; updates the right state field.
      if (containerId === 'tf-i-ticker-memory') {
        state.intraday.ticker = sym;
        const input = document.getElementById('tf-i-ticker');
        if (input) input.value = sym;
      } else if (containerId === 'tf-summary-ticker-memory') {
        const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
        if (m === 'intraday') {
          if (!state.intraday) state.intraday = newIntradayTicket();
          state.intraday.ticker = sym;
        } else {
          state.ticker = sym;
        }
        const input = document.getElementById('tf-summary-ticker-input');
        if (input) input.value = sym;
      } else {
        state.ticker = sym;
        const input = document.getElementById('tf-ticker');
        if (input) input.value = sym;
        const li = document.getElementById('ticker-input');
        if (li) li.value = sym;
      }
      saveState();
      tfRefreshHeaderOnly();
      tfUpdateTickerMemory(containerId, sym);
    });
  });
}

function tfEnsureSummaryControls(mode) {
  const tickerEl = document.getElementById('trade-summary-ticker');
  const stratEl = document.getElementById('trade-summary-strategy');
  if (!tickerEl || !stratEl) return;
  if (tickerEl.dataset.summaryMode === mode && stratEl.dataset.summaryMode === mode) return;

  tickerEl.dataset.summaryMode = mode;
  tickerEl.innerHTML = `
    <div class="summary-ticker-wrap">
      <span class="trade-summary-label" style="margin:0;">Ticker</span>
      <input type="text" maxlength="20" class="summary-ticker-input" id="tf-summary-ticker-input" placeholder="—" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      <div class="summary-ticker-memory" id="tf-summary-ticker-memory"></div>
    </div>`;

  stratEl.dataset.summaryMode = mode;
  stratEl.innerHTML = `
    <div class="summary-strategy-wrap">
      <span class="trade-summary-label" style="margin:0;">Strategy</span>
      <div class="summary-strategy-row">
        <div class="summary-structure-pills" role="tablist" aria-label="Structure">
          <button type="button" class="summary-structure-pill" data-tf-structure="stocks" role="tab">Stock</button>
          <button type="button" class="summary-structure-pill" data-tf-structure="options" role="tab">Option</button>
          <button type="button" class="summary-structure-pill" data-tf-structure="spread" role="tab">Spread</button>
        </div>
        <div class="summary-direction-toggle" role="group" aria-label="Direction">
          <button type="button" class="summary-dir-btn long" data-tf-summary-dir="long" title="Long / call" aria-label="Bull / long">
            <span class="summary-dir-arrow">▲</span><span class="summary-dir-text">BULL</span>
          </button>
          <button type="button" class="summary-dir-btn short" data-tf-summary-dir="short" title="Short / put" aria-label="Bear / short">
            <span class="summary-dir-arrow">▼</span><span class="summary-dir-text">BEAR</span>
          </button>
        </div>
      </div>
    </div>`;

  tfBindSummaryControls();
}

function tfBindSummaryControls() {
  const tickerInput = document.getElementById('tf-summary-ticker-input');
  if (tickerInput) {
    tickerInput.addEventListener('input', e => {
      const sym = (e.target.value || '').toUpperCase();
      e.target.value = sym;
      const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
      if (m === 'intraday') {
        if (!state.intraday) state.intraday = newIntradayTicket();
        state.intraday.ticker = sym;
      } else {
        state.ticker = sym;
      }
      saveState();
      tfUpdateTickerMemory('tf-summary-ticker-memory', sym);
      tfRenderStepper();
      tfRenderActions();
      tfUpdateSummaryStatus();
    });
  }
  tfUpdateTickerMemory('tf-summary-ticker-memory',
    ((state.tradeFlow && state.tradeFlow.mode) || 'swing') === 'intraday'
      ? ((state.intraday && state.intraday.ticker) || '')
      : (state.ticker || ''));

  document.querySelectorAll('#trade-summary-strategy [data-tf-structure]').forEach(b => {
    b.addEventListener('click', () => {
      const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
      if (m === 'intraday') tfSetIntradayStructure(b.dataset.tfStructure);
      else tfSetSwingStructure(b.dataset.tfStructure);
    });
  });

  document.querySelectorAll('#trade-summary-strategy [data-tf-summary-dir]').forEach(b => {
    b.addEventListener('click', () => {
      const dir = b.dataset.tfSummaryDir;
      const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
      if (m === 'intraday') {
        if (!state.intraday) state.intraday = newIntradayTicket();
        state.intraday.direction = dir;
      } else {
        state.direction = dir;
      }
      saveState();
      tfRefreshAll();
    });
  });
}

function tfUpdateSummaryStatus() {
  const statusEl = document.getElementById('trade-summary-status');
  const cell = document.getElementById('trade-summary-status-cell');
  if (!statusEl || !cell) return;
  const st = tfComputeStatus();
  cell.classList.remove('ready', 'progress', 'blocked', 'clickable');
  cell.classList.add(st.tone);
  statusEl.textContent = st.tone === 'ready' ? 'Ready' : `Step ${st.step}: ${st.reason}`;
  if (st.tone !== 'ready') cell.classList.add('clickable');
  cell.dataset.tfStatusStep = st.step || '';
}

function tfRenderStrategyOutHtml(sObj) {
  if (!sObj) return '';
  return `
    <div class="trade-output">
      <div class="trade-output-title">Recommended structure</div>
      <div class="trade-output-main">${sObj.name}</div>
      <div class="trade-output-rationale">${sObj.rationale}</div>
      <div class="trade-output-grid">
        <div class="trade-output-cell"><span class="trade-output-cell-label">Delta</span><span class="trade-output-cell-value">${sObj.delta}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">DTE</span><span class="trade-output-cell-value">${sObj.dte}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Spread Width</span><span class="trade-output-cell-value">${sObj.width}</span></div>
      </div>
    </div>`;
}

function tfUpdateSwingStrategyPreview() {
  const el = document.getElementById('tf-strategy-preview');
  if (!el) return;
  const isOptions = state.instrument !== 'stocks';
  if (!isOptions || state.ivr === null || state.ivr === undefined || !state.direction) { el.innerHTML = ''; return; }
  const sObj = (typeof getStrategyForIVR === 'function') ? getStrategyForIVR(Number(state.ivr), state.direction) : null;
  el.innerHTML = sObj ? tfRenderStrategyOutHtml(sObj) : '';
}

// Sizing card markup for swing plan/size — also rendered surgically on input.
// Sum of capital tied up in open positions: options = entry × qty × 100,
// stocks = entry × qty. Used to reduce sizing's effective account size.
function tfCapitalDeployed() {
  const trades = (state.trades || []).filter(t => t && t.status === 'open');
  return trades.reduce((sum, t) => {
    const entry = Number(t.entry);
    const qty = (typeof tradeQty === 'function') ? tradeQty(t) : Number(t.qty ?? t.contracts ?? t.shares ?? 0);
    if (!Number.isFinite(entry) || !Number.isFinite(qty) || entry <= 0 || qty <= 0) return sum;
    return sum + (entry * qty * tradeMultiplier(t));
  }, 0);
}

function tfMoneyText(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : '—';
}

function tfPctText(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

function tfSignedMoneyText(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(n).toFixed(digits)}`;
}

function tfAbsMoneyText(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${Math.abs(n).toFixed(digits)}` : '—';
}

function tfOptionSpreadFromBidAsk(bid, ask) {
  const b = Number(bid);
  const a = Number(ask);
  if (!(b > 0 && a > 0 && a >= b)) return null;
  const mid = (b + a) / 2;
  if (!(mid > 0)) return null;
  return { bid: b, ask: a, mid: +mid.toFixed(2), spreadPct: +(((a - b) / mid) * 100).toFixed(1) };
}

function tfSpreadReadHtml(spread, max = null) {
  if (spread === null || spread === undefined || spread === '') return '';
  const b = tfSpreadBracket(spread, max);
  return `<div class="tf-spread-read ${b.cls}">Spread <span class="v">${tfPctText(spread)}</span></div>`;
}

function tfOptionBidAskInputsHtml({ bidValue = '', askValue = '', bidAttrs = '', askAttrs = '', spread = null, spreadMax = null } = {}) {
  const b = spread === null ? { cls: 'empty', text: '—' } : tfSpreadBracket(spread, spreadMax);
  return `
    <div class="trade-section-grid-2">
      <div class="trade-input-row"><div>
        <label class="input-label">Bid $</label>
        <input type="number" min="0" step="0.01" class="trade-input" ${bidAttrs} value="${bidValue ?? ''}" placeholder="Option bid" />
      </div>
      <div class="trade-bracket ${b.cls}">${b.text}</div>
      </div>
      <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
        <label class="input-label">Ask $</label>
        <input type="number" min="0" step="0.01" class="trade-input" ${askAttrs} value="${askValue ?? ''}" placeholder="Option ask" />
      </div></div>
    </div>
    <div data-tf-spread-read>${tfSpreadReadHtml(spread, spreadMax)}</div>`;
}

function tfClampMoonshotR(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.max(2, Math.min(6, Math.round(n * 4) / 4));
}

function tfFormatR(value) {
  const n = tfClampMoonshotR(value);
  return `${n.toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}R`;
}

function tfMoonshotR() {
  const tf = state.tradeFlow || {};
  return tfClampMoonshotR(tf.moonshotR);
}

function tfRenderMoonshotSliderHtml(moonshotR) {
  const r = tfClampMoonshotR(moonshotR);
  return `
    <div class="tf-moonshot-control">
      <div class="tf-moonshot-head">
        <span>Adjust moon shot target</span>
        <output data-tf-moonshot-value>${tfFormatR(r)}</output>
      </div>
      <input type="range" min="2" max="6" step="0.25" value="${r}" class="tf-moonshot-slider" data-tf-moonshot-slider aria-label="Adjust moon shot target" />
    </div>`;
}

function tfRiskLevelRows({ entry, stop, target, qty, mult = 1, riskUnitDollars = null, moonshotR = null } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return [];
  const stopDist = Math.abs(e - s);
  if (!(stopDist > 0)) return [];
  const direction = t >= e ? 1 : -1;
  const loss = stopDist * q * m;
  const riskUnit = Number(riskUnitDollars);
  const rBase = riskUnit > 0 ? riskUnit : loss;
  const targetR = Math.abs(t - e) / stopDist;
  const targetLabel = Number.isFinite(targetR) ? `Target 1 (${targetR.toFixed(1)}R)` : 'Target 1';
  const moonR = tfClampMoonshotR(moonshotR === null || moonshotR === undefined ? tfMoonshotR() : moonshotR);
  const make = (label, price, cls) => {
    const p = Number(price);
    const pnl = (p - e) * direction * q * m;
    const r = rBase > 0 ? pnl / rBase : 0;
    const dist = Math.abs((p - e) / e) * 100;
    return { label, price: p, dist, pnl, r, cls };
  };
  return [
    make('Stop loss', s, 'stop'),
    make('Entry', e, 'entry'),
    make(targetLabel, t, 'target'),
    make('Target 2 (2R)', e + direction * stopDist * 2, 'target'),
    make(`Moon shot (${tfFormatR(moonR)})`, e + direction * stopDist * moonR, 'moon'),
  ];
}

function tfRenderRiskTableHtml(args = {}) {
  const rows = tfRiskLevelRows(args);
  if (!rows.length) return '';
  const rowHtml = rows.map(r => `
    <div class="tf-risk-table-row ${r.cls}">
      <div class="level">${r.label}</div>
      <div>${tfMoneyText(r.price)}</div>
      <div>${r.dist.toFixed(2)}%</div>
      <div class="${r.pnl < 0 ? 'neg' : r.pnl > 0 ? 'pos' : ''}">${tfSignedMoneyText(r.pnl, 2)}</div>
      <div class="${r.r < 0 ? 'neg' : r.r > 0 ? 'pos' : ''}">${r.r >= 0 ? '+' : ''}${r.r.toFixed(2)}R</div>
    </div>`).join('');
  return `
    <div class="tf-risk-table">
      <div class="tf-risk-table-row tf-risk-table-head">
        <div>Level</div><div>Price</div><div>% Dist</div><div>Proj. P/L</div><div>R-Units</div>
      </div>
      ${rowHtml}
    </div>`;
}

function tfRenderRiskProfileHtml({ entry, stop, target, qty, mult = 1, title = 'Visual risk profile', unitLabel = 'unit', riskUnitDollars = null, moonshotR = null } = {}) {
  const e = Number(entry);
  const s = Number(stop);
  const t = Number(target);
  const q = Number(qty);
  const m = Number(mult) || 1;
  if (!(e > 0 && s > 0 && t > 0 && q > 0)) return '';
  const loss = Math.abs(e - s) * q * m;
  const reward = Math.abs(t - e) * q * m;
  if (!(loss > 0 && reward > 0)) return '';
  const riskUnit = Number(riskUnitDollars) > 0 ? Number(riskUnitDollars) : loss;
  const rewardR = reward / loss;
  const displayR = Number.isFinite(rewardR) ? rewardR : 0;
  const visualRewardR = Math.max(0.45, Math.min(2.5, displayR || 1));
  const twoRVisual = Math.max(0.45, Math.min(1.35, Math.abs(2 - visualRewardR) || 0.65));
  const total = 1 + visualRewardR + twoRVisual;
  const lossPct = (1 / total) * 100;
  const targetPct = (visualRewardR / total) * 100;
  const twoPct = Math.max(12, 100 - lossPct - targetPct);
  const moonR = tfClampMoonshotR(moonshotR === null || moonshotR === undefined ? tfMoonshotR() : moonshotR);
  return `
    <div class="tf-risk-profile" data-tf-risk-entry="${e}" data-tf-risk-stop="${s}" data-tf-risk-target="${t}" data-tf-risk-qty="${q}" data-tf-risk-mult="${m}" data-tf-risk-unit="${riskUnit}">
      <div class="tf-risk-profile-head">
        <div class="tf-risk-profile-title">${title}</div>
        <div class="tf-risk-profile-meta">1R = ${tfAbsMoneyText(riskUnit)} · stop risk ${tfAbsMoneyText(loss)} · ${q} ${unitLabel}${q === 1 ? '' : 's'} · ${displayR.toFixed(2)}R target</div>
      </div>
      <div class="tf-risk-rail">
        <div class="tf-risk-zone loss" style="width:${lossPct.toFixed(2)}%;">
          <div><strong>-1R</strong><span>-${tfAbsMoneyText(loss, 2)}</span></div>
        </div>
        <div class="tf-risk-zone target" style="width:${targetPct.toFixed(2)}%;">
          <div><strong>${displayR.toFixed(2)}R</strong><span>${tfSignedMoneyText(reward, 2)}</span></div>
        </div>
        <div class="tf-risk-zone two-r" style="width:${twoPct.toFixed(2)}%;">
          <div><strong>2R</strong><span>${tfSignedMoneyText(loss * 2, 2)}</span></div>
        </div>
        <div class="tf-risk-entry-marker" style="left:${lossPct.toFixed(2)}%;"></div>
      </div>
      ${tfRenderMoonshotSliderHtml(moonR)}
      <div data-tf-risk-table-wrap>${tfRenderRiskTableHtml({ entry, stop, target, qty, mult, riskUnitDollars: riskUnit, moonshotR: moonR })}</div>
    </div>`;
}

function tfRiskArgsFromProfile(profile, moonshotR) {
  if (!profile) return null;
  return {
    entry: Number(profile.dataset.tfRiskEntry),
    stop: Number(profile.dataset.tfRiskStop),
    target: Number(profile.dataset.tfRiskTarget),
    qty: Number(profile.dataset.tfRiskQty),
    mult: Number(profile.dataset.tfRiskMult),
    riskUnitDollars: Number(profile.dataset.tfRiskUnit),
    moonshotR,
  };
}

function tfRefreshMoonshotProfile(profile, moonshotR) {
  if (!profile) return;
  const value = profile.querySelector('[data-tf-moonshot-value]');
  if (value) value.textContent = tfFormatR(moonshotR);
  const tableWrap = profile.querySelector('[data-tf-risk-table-wrap]');
  const args = tfRiskArgsFromProfile(profile, moonshotR);
  if (tableWrap && args) tableWrap.innerHTML = tfRenderRiskTableHtml(args);
}

function tfBindMoonshotSliders() {
  document.querySelectorAll('#panel-trade [data-tf-moonshot-slider]').forEach(slider => {
    if (slider.dataset.tfMoonshotBound === '1') return;
    slider.dataset.tfMoonshotBound = '1';
    slider.addEventListener('input', e => {
      const next = tfClampMoonshotR(e.target.value);
      if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
      state.tradeFlow.moonshotR = next;
      document.querySelectorAll('#panel-trade [data-tf-moonshot-slider]').forEach(other => {
        other.value = next;
        tfRefreshMoonshotProfile(other.closest('.tf-risk-profile'), next);
      });
      saveState();
    });
  });
}

function tfRenderSwingSizingHtml() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = state.instrument !== 'stocks';
  const premium = state.premium;
  if (!premium || premium <= 0) return '';
  const account = settings.account || 10000;
  const deployed = tfCapitalDeployed();
  const available = Math.max(0, account - deployed);
  const riskPct = (typeof getRiskPctForRegime === 'function') ? getRiskPctForRegime(state.regime || 'risk-on') : 0.02;
  const riskDollars = Math.round(available * riskPct);
  const deployedNote = deployed > 0
    ? ` Capital deployed in open positions $${Math.round(deployed).toLocaleString()} subtracted; available $${Math.round(available).toLocaleString()}.`
    : '';
  if (isOptions) {
    const stopFraction = (settings.stopPct || 50) / 100;
    const maxLossPerContract = premium * stopFraction * 100;
    const contracts = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerContract)));
    const totalRisk = contracts * maxLossPerContract;
    const totalPremium = contracts * premium * 100;
    const target = premium * (1 + (settings.targetPct || 50) / 100);
    const stopPrem = premium * (1 - stopFraction);
    const atr = state.atr; const upx = state.underlyingPrice;
    const stopDollar = (atr > 0 && upx > 0) ? `${(state.direction === 'short' ? upx + atr * 1.5 : upx - atr * 1.5).toFixed(2)}` : '—';
    return `
      <div class="trade-output">
        <div class="trade-output-title">Sizing (regime: ${(state.regime || 'risk-on').toUpperCase()})</div>
        <div class="trade-output-main">${contracts} contract${contracts === 1 ? '' : 's'} · risk $${Math.round(totalRisk)}</div>
        <div class="trade-output-rationale">Account $${account.toLocaleString()} × ${(riskPct * 100).toFixed(2)}% = $${riskDollars} risk per trade. Stop at ${(settings.stopPct || 50)}% of premium → max loss per contract $${maxLossPerContract.toFixed(0)}.${deployedNote}</div>
        <div class="trade-output-grid">
          <div class="trade-output-cell"><span class="trade-output-cell-label">Total premium</span><span class="trade-output-cell-value">$${Math.round(totalPremium)}</span></div>
          <div class="trade-output-cell"><span class="trade-output-cell-label">Profit target</span><span class="trade-output-cell-value">$${target.toFixed(2)} / ct</span></div>
          <div class="trade-output-cell"><span class="trade-output-cell-label">Premium stop</span><span class="trade-output-cell-value">$${stopPrem.toFixed(2)} / ct</span></div>
          <div class="trade-output-cell"><span class="trade-output-cell-label">Underlying stop</span><span class="trade-output-cell-value">$${stopDollar}</span></div>
        </div>
        ${tfRenderRiskProfileHtml({ entry: premium, stop: stopPrem, target, qty: contracts, mult: 100, unitLabel: 'contract', riskUnitDollars: riskDollars })}
      </div>`;
  }
  const stopPct = (settings.stopPct || 5) / 100;
  const maxLossPerShare = premium * stopPct;
  const shares = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerShare)));
  const targetPct = (settings.targetPct || 50) / 100;
  const stopPrice = state.direction === 'short' ? premium * (1 + stopPct) : premium * (1 - stopPct);
  const targetPrice = state.direction === 'short' ? premium * (1 - targetPct) : premium * (1 + targetPct);
  return `
    <div class="trade-output">
      <div class="trade-output-title">Sizing (regime: ${(state.regime || 'risk-on').toUpperCase()})</div>
      <div class="trade-output-main">${shares} shares · risk $${Math.round(shares * maxLossPerShare)}</div>
      <div class="trade-output-rationale">Stop at ${(settings.stopPct || 5)}% of price → max loss per share $${maxLossPerShare.toFixed(2)}.${deployedNote}</div>
      ${tfRenderRiskProfileHtml({ entry: premium, stop: stopPrice, target: targetPrice, qty: shares, mult: 1, unitLabel: 'share', riskUnitDollars: riskDollars })}
    </div>`;
}

function tfSwingQuoteMid(liq = (state.liquidity || {})) {
  const bid = Number(liq.bid);
  const ask = Number(liq.ask);
  if (!(bid > 0 && ask > 0 && ask >= bid)) return null;
  return +(((bid + ask) / 2).toFixed(2));
}

function tfCanAutoFillSwingPremium(previousMid = null) {
  if (state.tradeFlow && state.tradeFlow.swingPremiumManual) return false;
  const premium = Number(state.premium);
  if (!(premium > 0)) return true;
  return previousMid !== null && Math.abs(premium - previousMid) < 0.005;
}

function tfAutoFillSwingPremiumFromQuote(previousMid = null) {
  if (state.instrument === 'stocks') return false;
  const mid = tfSwingQuoteMid();
  if (mid === null || !tfCanAutoFillSwingPremium(previousMid)) return false;
  state.premium = mid;
  if (state.tradeFlow) state.tradeFlow.swingPremiumManual = false;
  return true;
}

function tfSetSwingPremiumFromQuote() {
  const mid = tfSwingQuoteMid();
  if (mid === null) return null;
  state.premium = mid;
  if (state.tradeFlow) state.tradeFlow.swingPremiumManual = false;
  return mid;
}

function tfUpdateSwingSpreadLine() {
  const quote = tfOptionSpreadFromBidAsk((state.liquidity || {}).bid, (state.liquidity || {}).ask);
  const spreadRead = document.querySelector('#panel-trade [data-tf-liq="bid"]')?.closest('.trade-section')?.querySelector('[data-tf-spread-read]');
  if (spreadRead) spreadRead.innerHTML = quote ? tfSpreadReadHtml(quote.spreadPct, 5) : '';
  const badge = document.querySelector('#panel-trade [data-tf-liq="bid"]')?.closest('.trade-input-row')?.querySelector('.trade-bracket');
  if (badge) {
    const b = quote ? tfSpreadBracket(quote.spreadPct, 5) : { cls: 'empty', text: '—' };
    badge.className = `trade-bracket ${b.cls}`;
    badge.textContent = b.text;
  }
  const liqCounter = document.getElementById('tf-swing-liq-counter');
  if (liqCounter) {
    const ok = tfEvaluateGates()['04'];
    liqCounter.classList.toggle('complete', !!ok);
    liqCounter.textContent = ok ? 'pass' : 'fill quote';
  }
}

function tfUpdateSwingSizing() {
  const card = document.getElementById('tf-sizing-card');
  if (card) card.innerHTML = tfRenderSwingSizingHtml();
  tfBindMoonshotSliders();
  const premiumCounter = document.getElementById('tf-premium-counter');
  if (premiumCounter) {
    const ok = Number(state.premium) > 0;
    premiumCounter.classList.toggle('complete', ok);
    premiumCounter.textContent = ok ? '1 set' : 'fill 1';
  }
  const riskCounter = document.getElementById('tf-swing-risk-counter');
  if (riskCounter) {
    const isOptions = state.instrument !== 'stocks';
    const gates = tfEvaluateGates();
    const ready = isOptions
      ? Number(state.premium) > 0 && Number(state.atr) > 0 && Number(state.underlyingPrice) > 0
      : gates['04'] && Number(state.premium) > 0;
    riskCounter.classList.toggle('complete', !!ready);
    riskCounter.textContent = ready ? 'ready' : (isOptions ? 'fill 3' : 'fill 2');
  }
  // Gate 06 row also reflects ATR + underlying — refresh in place.
  const gateRow = document.getElementById('tf-stop-gate');
  if (gateRow) {
    const gates = tfEvaluateGates();
    const ok = gates['06'];
    gateRow.classList.toggle('checked', !!ok);
    gateRow.classList.toggle('fail', !ok);
    const check = gateRow.querySelector('.trade-row-check');
    if (check) check.textContent = ok ? '✓' : '';
    const pill = gateRow.querySelector('.trade-row-pill');
    if (pill) pill.textContent = ok ? 'PASS' : 'FAIL';
  }
}

function tfInstrumentToggleHtml(current, attrName) {
  const cur = current === 'stocks' ? 'stocks' : 'options';
  return `
    <div class="flow-instrument-row" style="margin-bottom: 12px;">
      <span class="flow-instrument-label">Trading</span>
      <div class="flow-instrument-pills">
        <button type="button" class="flow-instrument-pill ${cur === 'options' ? 'active' : ''}" ${attrName}="options">
          <span class="flow-instrument-pill-name">Options</span>
          <span class="flow-instrument-pill-detail">Calls / puts</span>
        </button>
        <button type="button" class="flow-instrument-pill ${cur === 'stocks' ? 'active' : ''}" ${attrName}="stocks">
          <span class="flow-instrument-pill-name">Stock</span>
          <span class="flow-instrument-pill-detail">Shares</span>
        </button>
      </div>
    </div>`;
}

function tfStructureValue(mode = ((state.tradeFlow && state.tradeFlow.mode) || 'swing')) {
  if (mode === 'intraday') {
    const it = state.intraday || {};
    if (it.structure) return it.structure;
    return it.instrument === 'stocks' ? 'stocks' : 'options';
  }
  if (state.structure) return state.structure;
  return state.instrument === 'stocks' ? 'stocks' : 'options';
}

function tfSetSwingStructure(structure) {
  const s = structure === 'spread' ? 'spread' : structure === 'stocks' ? 'stocks' : 'options';
  state.structure = s;
  state.instrument = s === 'stocks' ? 'stocks' : 'options';
  saveState();
  tfRefreshAll();
}

function tfSetIntradayStructure(structure) {
  if (!state.intraday) state.intraday = newIntradayTicket();
  const s = structure === 'spread' ? 'spread' : structure === 'stocks' ? 'stocks' : 'options';
  state.intraday.structure = s;
  state.intraday.instrument = s === 'stocks' ? 'stocks' : 'options';
  tfDeriveIntradaySpread();
  tfAutoFillIntradayOptionBracket();
  tfAutoFillIntradayStockFromOR();
  saveState();
  tfRefreshAll();
}

function tfSetSwingInstrument(instrument) {
  tfSetSwingStructure(instrument === 'stocks' ? 'stocks' : 'options');
}

function tfSetIntradayInstrument(instrument) {
  tfSetIntradayStructure(instrument === 'stocks' ? 'stocks' : 'options');
}

function tfIntradayInstrument() {
  const it = state.intraday || {};
  return it.instrument === 'stocks' ? 'stocks' : 'options';
}

function tfDeriveIntradaySpread() {
  const it = state.intraday || {};
  const bid = Number(it.bid);
  const ask = Number(it.ask);
  if (bid > 0 && ask > 0 && ask >= bid) {
    const mid = (bid + ask) / 2;
    it.mid = +mid.toFixed(2);
    it.spreadPct = +(((ask - bid) / mid) * 100).toFixed(1);
    return it.spreadPct;
  }
  it.mid = null;
  it.spreadPct = null;
  return null;
}

function tfAutoFillIntradayOptionBracket({ force = false } = {}) {
  const it = state.intraday || {};
  if ((it.instrument || 'options') === 'stocks') return;
  const settings = state.settings || DEFAULT_SETTINGS;
  const mid = Number(it.mid);
  if (mid > 0 && (force || !it.entry)) it.entry = mid;
  const entry = Number(it.entry);
  if (!(entry > 0)) return;
  if (force || !it.stop) {
    it.stop = +(entry * (1 - ((settings.stopPct || 50) / 100))).toFixed(2);
  }
  if (force || !it.target) {
    it.target = +(entry * (1 + ((settings.targetPct || 50) / 100))).toFixed(2);
  }
}

function tfAutoFillIntradayStockFromOR({ force = false } = {}) {
  const it = state.intraday || {};
  if (it.instrument !== 'stocks') return;
  const hi = Number(it.orHi);
  const lo = Number(it.orLo);
  const rng = Number(it.orRng) || (hi > 0 && lo > 0 ? hi - lo : null);
  if (!(hi > 0 && lo > 0 && rng > 0)) return;
  if (it.setup === 'orb-up-break') {
    if (force || !it.entry) it.entry = +hi.toFixed(2);
    if (force || !it.stop) it.stop = +lo.toFixed(2);
    if (force || !it.target) it.target = +(hi + rng).toFixed(2);
  } else if (it.setup === 'orb-dn-break') {
    if (force || !it.entry) it.entry = +lo.toFixed(2);
    if (force || !it.stop) it.stop = +hi.toFixed(2);
    if (force || !it.target) it.target = +(lo - rng).toFixed(2);
  }
}

function tfRenderIntradaySizingHtml() {
  const it = state.intraday || {};
  const isOptions = tfIntradayInstrument() !== 'stocks';
  const auto = tfComputeIntradayRiskSize();
  if (!auto) {
    return `<div class="input-help" style="margin-top:8px;">Fill entry and stop to auto-size ${isOptions ? 'contracts' : 'shares'}.</div>`;
  }
  const manualQty = Number(it.contracts);
  const manualRisk = manualQty > 0 ? Math.round(manualQty * auto.stopDist * auto.mult) : null;
  const profileQty = manualQty > 0 ? manualQty : auto.qty;
  const qtyLine = manualQty > 0
    ? `${manualQty} ${auto.label}${manualQty === 1 ? '' : 's'} in the override field · estimated risk $${manualRisk}`
    : `Blank quantity logs the suggested ${auto.qty} ${auto.label}${auto.qty === 1 ? '' : 's'}.`;
  const perUnit = auto.stopDist * auto.mult;
  return `
    <div class="trade-output" style="margin-top:10px;">
      <div class="trade-output-title">Risk unit size</div>
      <div class="trade-output-main">${auto.qty} ${auto.label}${auto.qty === 1 ? '' : 's'} suggested</div>
      <div class="trade-output-rationale">${qtyLine}</div>
      <div class="trade-output-grid">
        <div class="trade-output-cell"><span class="trade-output-cell-label">Risk unit</span><span class="trade-output-cell-value">$${auto.riskBudget}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Risk / ${isOptions ? 'ct' : 'share'}</span><span class="trade-output-cell-value">$${perUnit.toFixed(isOptions ? 0 : 2)}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Suggested risk</span><span class="trade-output-cell-value">$${Math.round(auto.risk)}</span></div>
        <div class="trade-output-cell"><span class="trade-output-cell-label">Stop distance</span><span class="trade-output-cell-value">${tfMoneyText(auto.stopDist)}</span></div>
      </div>
      ${tfRenderRiskProfileHtml({ entry: it.entry, stop: it.stop, target: it.target, qty: profileQty, mult: auto.mult, unitLabel: auto.label, riskUnitDollars: auto.riskBudget })}
      <div class="trade-templates" style="margin-top:10px;">
        <button type="button" class="trade-template-btn" id="tf-i-use-risk-size">Apply suggested size</button>
        <span class="trade-templates-label">Writes ${auto.qty} to the ${isOptions ? 'contracts' : 'shares'} override.</span>
      </div>
    </div>`;
}

function tfComputeIntradayRiskSize() {
  const it = state.intraday || {};
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = tfIntradayInstrument() !== 'stocks';
  const entry = Number(it.entry);
  const stop = Number(it.stop);
  if (!(entry > 0 && stop > 0)) return null;
  const stopDist = Math.abs(entry - stop);
  if (!(stopDist > 0)) return null;
  const mult = isOptions ? 100 : 1;
  const riskBudget = settings.intradayRiskPerTrade || 100;
  const qty = Math.max(1, Math.floor(riskBudget / Math.max(0.01, stopDist * mult)));
  return {
    qty,
    risk: qty * stopDist * mult,
    riskBudget,
    stopDist,
    mult,
    label: isOptions ? 'contract' : 'share',
  };
}

function tfApplyIntradayRiskSize() {
  const auto = tfComputeIntradayRiskSize();
  if (!auto) return null;
  if (!state.intraday) state.intraday = newIntradayTicket();
  state.intraday.contracts = auto.qty;
  if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
  if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
  state.tradeFlow.intradayDraft.contracts = String(auto.qty);
  return auto.qty;
}

function tfBindIntradayRiskSizeButton() {
  const btn = document.getElementById('tf-i-use-risk-size');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const qty = tfApplyIntradayRiskSize();
    if (!qty) {
      if (typeof toast === 'function') toast('Fill entry and stop first.', true);
      return;
    }
    const el = document.getElementById('tf-i-contracts');
    if (el) el.value = qty;
    saveState();
    tfRefreshHeaderOnly();
    tfUpdateIntradaySizing();
  });
}

function tfUpdateIntradaySizing() {
  const card = document.getElementById('tf-i-sizing-card');
  if (card) card.innerHTML = tfRenderIntradaySizingHtml();
  tfBindIntradayRiskSizeButton();
  tfBindMoonshotSliders();
}

// Intraday R-multiple block — surgical update on entry/stop/target change.
function tfUpdateIntradayRMult() {
  const el = document.getElementById('tf-i-rmult');
  if (!el) return;
  const it = state.intraday || {};
  const r = (it.entry && it.stop && it.target)
    ? Math.abs((Number(it.target) - Number(it.entry)) / (Number(it.entry) - Number(it.stop)))
    : null;
  const rText = r !== null && isFinite(r) ? `${r.toFixed(2)}R reward / risk` : '—';
  const rGood = r !== null && isFinite(r) && r >= 1.5;
  el.innerHTML = `
    <div class="trade-output" style="${rGood ? 'border-color: var(--green-dim); background: linear-gradient(135deg, var(--green-bg), var(--bg) 60%);' : ''}">
      <div class="trade-output-title">R-multiple</div>
      <div class="trade-output-main">${rText}</div>
      <div class="trade-output-rationale">Distance to target divided by distance to stop.</div>
    </div>`;
}

// Spread bracket for intraday — single word.
function tfSpreadBracket(spread, maxOverride = null) {
  const override = Number(maxOverride);
  const max = override > 0 ? override : ((state.settings && state.settings.intradayMaxSpreadPct) || 5);
  if (spread === null || spread === undefined || spread === '') return { cls: 'empty', text: '—' };
  const v = Number(spread);
  if (isNaN(v)) return { cls: 'empty', text: '—' };
  if (v <= max * 0.6) return { cls: 'tight', text: 'TIGHT' };
  if (v <= max)       return { cls: 'mid',   text: 'OK' };
  return                       { cls: 'wide',  text: 'WIDE' };
}

// ----- Rendering -----

// The sticky header owns ticker, structure, and direction.
// Swing starts with quality gates, then technicals, sizing, and log. Intraday stays compact.
function tfStepCount() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  return m === 'swing' ? 4 : 3;
}
function tfStepNames() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') return ['Quality', 'Technicals', 'Size', 'Log'];
  return ['Setup', 'Plan & Size', 'Context'];
}
function tfIsSingleScreen() {
  return ((state.tradeFlow && state.tradeFlow.mode) || 'swing') === 'intraday';
}

// Determine which steps are "complete" — drives the stepper checkmarks.
// Each step is "complete" when its on-screen inputs are filled. The header
// status pill is still the source of truth for "OK to fire".
function tfStepCompletion() {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  const c = Array(tfStepCount()).fill(false);

  if (m === 'swing') {
    const isOptions = state.instrument !== 'stocks';
    const gates = tfEvaluateGates();

    // 1 Quality — ticker plus SA Quant, factor-grade gates, and earnings gap.
    const tickerReady = !!state.ticker;
    const qualityInputsDone = (state.saQuant !== null && state.saQuant !== undefined)
                           && (state.daysToEarnings !== null && state.daysToEarnings !== undefined);
    const qualityGatesOk = gates['01'] && gates['02'] && gates['03'] && gates['05'];
    c[0] = !!(tickerReady && qualityInputsDone && qualityGatesOk);

    // 2 Technicals — direction + approved setup + IV Rank contract read.
    const ivrOk = !isOptions || (state.ivr !== null && state.ivr !== undefined && Number(state.ivr) < 70);
    c[1] = !!(c[0] && state.direction && state.selectedSetup && ivrOk);

    // 3 Size — liquidity (Gate 04) + price/stop inputs (Gate 06).
    const sizingFilled = isOptions
      ? !!(state.premium > 0 && state.atr > 0 && state.underlyingPrice > 0)
      : !!(state.premium > 0);
    c[2] = !!(c[1] && gates['04'] && gates['06'] && sizingFilled);

    // 4 Log — flips green only when the whole swing ticket is ready.
    const st = tfComputeStatus();
    c[3] = c[0] && c[1] && c[2] && st.tone === 'ready';
    return c;
  }

  // Intraday — single-screen render. Completion still drives the header
  // status and guardrail jump targets.
  const it = state.intraday || {};
  const settings = state.settings || DEFAULT_SETTINGS;

  // 1 Setup — ticker + direction + setup pattern (header + setup-cards body).
  const headerReady = !!(it.ticker && it.setup && it.direction);
  c[0] = headerReady;

  const isOptions = (it.instrument || 'options') !== 'stocks';
  const levelsOk = !!(headerReady && it.entry && it.stop && it.target);
  if (isOptions) {
    // 2 Plan & Size — spread comes from bid/ask; levels and quantity derive from there.
    const spreadPct = tfDeriveIntradaySpread();
    const spreadOk = spreadPct !== null && spreadPct !== undefined
                  && Number(spreadPct) >= 0
                  && Number(spreadPct) <= settings.intradayMaxSpreadPct;
    c[1] = !!(headerReady && spreadOk && levelsOk);
  } else {
    // Share count itself is optional because it auto-sizes from entry/stop.
    c[1] = levelsOk;
  }

  // 3 Context — guardrails pass (status not blocked).
  const st = tfComputeStatus();
  c[2] = c[1] && st.tone !== 'blocked';
  return c;
}

function tfRenderStepper() {
  const stepper = document.getElementById('trade-stepper');
  const mob     = document.getElementById('trade-stepper-mobile');
  if (!stepper) return;
  // Single-screen mode: hide both stepper variants. Header still shows mode
  // toggle + summary row. Status pill remains the navigation cue.
  if (tfIsSingleScreen()) {
    stepper.innerHTML = '';
    stepper.style.display = 'none';
    if (mob) mob.style.display = 'none';
    return;
  }
  stepper.style.display = '';
  if (mob) mob.style.display = '';
  const names = tfStepNames();
  const compl = tfStepCompletion();
  const cur = state.tradeFlow.step || 1;
  stepper.innerHTML = names.map((n, i) => {
    const idx = i + 1;
    const isComplete = compl[i];
    const isActive = idx === cur;
    const cls = isComplete ? 'complete' : isActive ? 'active' : (idx < cur ? '' : (compl.slice(0, i).every(Boolean) ? '' : 'locked'));
    const inner = isComplete ? '✓' : idx;
    return `<button class="trade-step ${cls}" data-trade-step="${idx}" type="button">
      <span class="trade-step-node">${inner}</span>
      <span class="trade-step-label">${n}</span>
    </button>`;
  }).join('');
  stepper.querySelectorAll('[data-trade-step]').forEach(el => {
    el.addEventListener('click', () => {
      const target = parseInt(el.dataset.tradeStep, 10);
      if (target && target !== cur) tfGoToStep(target);
    });
  });
  if (mob) {
    const numEl = document.getElementById('trade-stepper-mobile-num');
    const nameEl = document.getElementById('trade-stepper-mobile-name');
    const progEl = document.getElementById('trade-stepper-mobile-progress');
    if (numEl) numEl.textContent = `Step ${cur} of ${names.length}`;
    if (nameEl) nameEl.textContent = names[cur - 1] || '';
    if (progEl) progEl.textContent = `${compl.filter(Boolean).length} of ${names.length}`;
  }
}

function tfBindHeaderScroll() {
  const header = document.querySelector('#panel-trade .trade-header');
  if (!header || header.dataset.tfScrollBound === '1') return;
  header.dataset.tfScrollBound = '1';
  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    header.classList.toggle('collapsed', y > 120);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function tfRenderHeader() {
  const tickerEl = document.getElementById('trade-summary-ticker');
  const stratEl  = document.getElementById('trade-summary-strategy');
  if (!tickerEl || !stratEl) return;
  tfBindHeaderScroll();
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  tfEnsureSummaryControls(m);

  const ticker = m === 'swing' ? (state.ticker || '') : ((state.intraday && state.intraday.ticker) || '');
  const tickerInput = document.getElementById('tf-summary-ticker-input');
  if (tickerInput && document.activeElement !== tickerInput) tickerInput.value = ticker;
  tfUpdateTickerMemory('tf-summary-ticker-memory', ticker);

  const struct = tfStructureValue(m);
  document.querySelectorAll('#trade-summary-strategy [data-tf-structure]').forEach(b => {
    b.classList.toggle('active', b.dataset.tfStructure === struct);
  });
  const dir = m === 'intraday' ? ((state.intraday && state.intraday.direction) || '') : (state.direction || '');
  document.querySelectorAll('#trade-summary-strategy [data-tf-summary-dir]').forEach(b => {
    b.classList.toggle('selected', b.dataset.tfSummaryDir === dir);
  });

  tfUpdateSummaryStatus();
  // Mode toggle highlight
  document.querySelectorAll('#panel-trade [data-trade-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.tradeMode === m);
  });
}

function tfRenderActions() {
  const backBtn = document.getElementById('trade-back-btn');
  const contBtn = document.getElementById('trade-continue-btn');
  const contLbl = document.getElementById('trade-continue-label');
  const reasonEl = document.getElementById('trade-action-reason');
  if (!backBtn || !contBtn) return;
  const cur = state.tradeFlow.step || 1;
  const max = tfStepCount();
  const compl = tfStepCompletion();
  const st = tfComputeStatus();
  if (reasonEl) reasonEl.textContent = '';

  // Single-screen (intraday): just GO. Back leaves the panel.
  if (tfIsSingleScreen()) {
    backBtn.disabled = false;
    backBtn.textContent = '← Home';
    contBtn.classList.add('go');
    contLbl.textContent = 'GO';
    contBtn.disabled = st.tone !== 'ready';
    return;
  }

  // Swing — paginated. Step 1's Back goes Home; later steps go back a step.
  backBtn.disabled = false;
  backBtn.textContent = cur <= 1 ? '← Home' : 'Back';

  const isLast = cur >= max;
  if (isLast) {
    contBtn.classList.add('go');
    contLbl.textContent = 'GO';
    contBtn.disabled = st.tone !== 'ready';
  } else {
    contBtn.classList.remove('go');
    contLbl.textContent = 'Continue';
    const stepOk = compl.slice(0, cur).every(Boolean);
    contBtn.disabled = !stepOk;
  }
}

function tfGoToStep(n) {
  // Single-screen mode — every "step" is already in the DOM, so jumping
  // means scrolling to the matching group anchor and dropping focus into
  // its first interactive control. Status-pill clicks and gate-row jumps
  // both feed through here.
  if (tfIsSingleScreen()) {
    const target = document.getElementById(`tf-i-group-${n}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief highlight to confirm where we landed.
      target.classList.remove('tf-flash');
      // Reflow so re-adding the class re-triggers the animation.
      void target.offsetWidth;
      target.classList.add('tf-flash');
      const focusable = target.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
      if (focusable) { try { focusable.focus({ preventScroll: true }); } catch(_) {} }
    }
    return;
  }
  const max = tfStepCount();
  state.tradeFlow.step = Math.max(1, Math.min(max, n));
  saveState();
  renderTrade();
}

function tfSetMode(mode) {
  if (mode !== 'swing' && mode !== 'intraday') return;
  if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
  state.tradeFlow.mode = mode;
  state.tradeFlow.step = 1;
  saveState();
  renderTrade();
}

function tfReset() {
  if (!confirm('Clear all current analysis fields? Trade log is unchanged.')) return;
  const m = state.tradeFlow.mode;
  state.selectedSetup = null;
  if (m === 'swing') {
    state.ticker = '';
    state.direction = null;
    state.structure = 'options';
    state.instrument = 'options';
    state.ivr = null;
    state.premium = null;
    state.atr = null;
    state.underlyingPrice = null;
    state.gateChecks = {};
    state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
    state.tradeFlow.swingPremiumManual = false;
  } else {
    state.intraday = newIntradayTicket();
    state.intradayQuality = { timeOverride: false };
  }
  state.tradeFlow.step = 1;
  state.tradeFlow.thesis = '';
  state.tradeFlow.preMortem = '';
  state.tradeFlow.intradayDraft = {};
  state.tradeFlow.moonshotR = 3;
  saveState();
  renderTrade();
}

// ============== Step body renderers ==============

function tfStepBody(step) {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (step > tfStepCount()) step = tfStepCount();
  if (step < 1) step = 1;
  if (m === 'swing') {
    if (step === 1) return tfSwingStep2();
    if (step === 2) return tfSwingStep1() + tfSwingContractSpecHtml();
    if (step === 3) return tfSwingStep3();
    if (step === 4) return tfSwingStep4();
    return '';
  }
  // Intraday — single screen. Render every section, separated by a small
  // group divider so the user has visual anchors to scroll between.
  const names = tfStepNames();
  const wrap = (idx, html) => `
    <div class="trade-step-group" id="tf-i-group-${idx + 1}">
      <div class="trade-step-group-eyebrow"><span>${idx + 1}</span> ${names[idx]}</div>
      ${html}
    </div>`;
  const planAndSize = tfIntradayInstrument() === 'stocks'
    ? tfIntradayStep2() + tfIntradayStep3()
    : tfIntradayStep3() + tfIntradayStep2();
  return wrap(0, tfIntradayStep1())
       + wrap(1, planAndSize)
       + wrap(2, tfIntradayStep4());
}

// ----- Swing technicals — pick one of 5 approved patterns -----
// Ticker, direction, and structure live in the sticky header. This screen is
// the chart/setup picker after the quality gates pass.

function tfSwingStep1() {
  const sel = state.selectedSetup;
  const cards = TRADE_SWING_SETUPS.map(s => `
    <button class="trade-setup-card ${sel === s.id ? 'selected' : ''}" type="button" data-tf-setup="${s.id}">
      <span class="trade-setup-card-num">SETUP ${s.num}${s.halfSize ? ' · ½ SIZE' : ''}</span>
      <span class="trade-setup-card-name">${s.id}</span>
      <span class="trade-setup-card-detail">${s.desc}</span>
    </button>`).join('');

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Technical setup</div>
          <div class="trade-section-subtitle">Pick one approved chart pattern. If none fit, stop here.</div>
        </div>
        <div class="trade-section-counter ${sel ? 'complete' : ''}">${sel ? '1 selected' : 'pick 1'}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-setup-grid" id="tf-setup-grid">${cards}</div>
      </div>
    </div>
  `;
}

function tfMountSwingStep1() {
  document.querySelectorAll('#panel-trade [data-tf-setup]').forEach(b => {
    b.addEventListener('click', () => {
      state.selectedSetup = b.dataset.tfSetup;
      saveState();
      tfRefreshAll();
    });
  });
}

function tfSwingContractSpecHtml() {
  const isOptions = state.instrument !== 'stocks';
  const ivr = state.ivr;
  const dir = state.direction;
  const bracket = tfIvrBracket(ivr);
  const sObj = (ivr !== null && ivr !== undefined && dir && isOptions)
    ? getStrategyForIVR(Number(ivr), dir) : null;
  const stratOut = `<div id="tf-strategy-preview">${sObj ? tfRenderStrategyOutHtml(sObj) : ''}</div>`;

  return isOptions ? `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> IV Rank → contract spec</div>
          <div class="trade-section-subtitle">From TOS Volatility tab. Drives strategy, delta target, DTE, and spread width.</div>
        </div>
        <div class="trade-section-counter ${ivr !== null && ivr !== undefined ? 'complete' : ''}">${ivr !== null && ivr !== undefined ? '1 set' : 'fill 1'}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-input-row">
          <div>
            <label class="input-label">IV Rank (0-100)</label>
            <input type="number" min="0" max="100" step="1" class="trade-input" id="tf-ivr"
              placeholder="IV Rank 0-100"
              value="${ivr !== null && ivr !== undefined ? ivr : ''}" />
            <div class="input-help">Cheap below 30 · Moderate 30-50 · Rich 50+ · Skip if 70+</div>
          </div>
          <div class="trade-bracket ${bracket.cls}">${bracket.text}</div>
        </div>
        ${stratOut}
      </div>
    </div>` : `
    <div class="trade-section muted">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> Stocks mode — IV doesn't apply</div>
          <div class="trade-section-subtitle">Sizing math runs off share price in the size step.</div>
        </div>
      </div>
    </div>`;
}

function tfMountSwingContractSpec() {
  const ivrEl = document.getElementById('tf-ivr');
  if (!ivrEl) return;
  ivrEl.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    state.ivr = isNaN(v) ? null : v;
    saveState();
    tfRefreshHeaderOnly();
    const wrap = ivrEl.parentElement && ivrEl.parentElement.parentElement;
    if (wrap) {
      const badge = wrap.querySelector('.trade-bracket');
      if (badge) {
        const b = tfIvrBracket(state.ivr);
        badge.className = `trade-bracket ${b.cls}`;
        badge.textContent = b.text;
      }
    }
    tfUpdateSwingStrategyPreview();
  });
}

// ----- Swing quality — eligibility (SA quant, factor grades, earnings) -----
// "Quality" answers: is this name worth trading before we inspect the chart?

function tfSwingStep2() {
  const gates = tfEvaluateGates();
  const passed = ['01','02','03','05'].filter(k => gates[k]).length;
  const ticker = state.ticker || '';
  const saUrl = ticker ? `https://seekingalpha.com/symbol/${ticker}` : 'https://seekingalpha.com';

  const gateRow = (k, name, rule, isManual) => {
    const ok = gates[k];
    return `
      <button type="button" class="trade-row ${ok ? 'checked' : 'fail'}" data-tf-gate="${k}" ${!isManual ? 'data-tf-readonly="1"' : ''}>
        <span class="trade-row-check">${ok ? '✓' : ''}</span>
        <span class="trade-row-main">
          <span class="trade-row-name"><small>GATE ${k}</small> ${name}</span>
          <span class="trade-row-help">${rule}${isManual ? ` · <a href="${saUrl}" target="_blank" rel="noopener noreferrer">Verify on SA →</a>` : ''}</span>
        </span>
        <span class="trade-row-pill">${ok ? 'PASS' : (isManual ? 'CLICK TO MARK' : 'FAIL')}</span>
      </button>`;
  };

  const noTickerWarn = !ticker ? `
    <p class="trade-row-help" style="color: var(--amber-bright); margin-bottom: 10px;">
      Set a ticker in the header first — the SA factor-grade links need it.
    </p>` : '';

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Quality inputs</div>
          <div class="trade-section-subtitle">Pull these from Seeking Alpha. They drive the auto-passing gates below.</div>
        </div>
        <div class="trade-section-counter ${(state.saQuant !== null && state.saQuant !== undefined) && (state.daysToEarnings !== null && state.daysToEarnings !== undefined) ? 'complete' : ''}">${(state.saQuant !== null && state.saQuant !== undefined) && (state.daysToEarnings !== null && state.daysToEarnings !== undefined) ? '2 set' : 'fill 2'}</div>
      </div>
      <div class="trade-section-body">
        ${noTickerWarn}
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">SA Quant Rating (1.00-5.00)</label>
              <input type="number" min="1" max="5" step="0.01" class="trade-input" id="tf-sa-quant"
                placeholder="SA Quant 1.00-5.00" value="${state.saQuant ?? ''}" />
              <div class="input-help">Auto-passes Gate 01 when ≥ 3.50 (Buy or Strong Buy).</div>
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Days to next earnings</label>
              <input type="number" min="0" step="1" class="trade-input" id="tf-days-er"
                placeholder="Days until earnings" value="${state.daysToEarnings ?? ''}" />
              <div class="input-help">Auto-passes Gate 05 when ≥ 8. Don't hold through earnings.</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> Eligibility gates</div>
          <div class="trade-section-subtitle">All four must pass before you move on. Manual gates need a click after verification.</div>
        </div>
        <div class="trade-section-counter ${passed === 4 ? 'complete' : ''}">${passed} of 4 passed</div>
      </div>
      <div class="trade-section-body">
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${gateRow('01', 'SA Quant Rating ≥ 3.50', 'Auto-passes from the input above.', false)}
          ${gateRow('02', 'Profitability grade B- or better', 'Open SA → Factor Grades → confirm grade. Click to mark.', true)}
          ${gateRow('03', 'Momentum grade B- or better', 'Same SA Factor Grades section. Click to mark once verified.', true)}
          ${gateRow('05', 'Earnings ≥ 7 days away', 'Auto-passes when days-to-earnings input is 8+.', false)}
        </div>
      </div>
    </div>
  `;
}

function tfMountSwingStep2() {
  const sa = document.getElementById('tf-sa-quant');
  if (sa) {
    sa.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      state.saQuant = isNaN(v) ? null : v;
      saveState();
      tfRefreshHeaderOnly();
    });
  }
  const der = document.getElementById('tf-days-er');
  if (der) {
    der.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      state.daysToEarnings = isNaN(v) ? null : v;
      saveState();
      tfRefreshHeaderOnly();
    });
  }
  document.querySelectorAll('#panel-trade [data-tf-gate]').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.tfGate;
      if (k !== '02' && k !== '03') return;
      state.gateChecks[k] = !state.gateChecks[k];
      saveState();
      tfRefreshAll();
    });
  });
}

// ----- Swing size — liquidity + premium / ATR / underlying -----
// Goal: prove the contract is tradable, then math out position size + stop.

function tfSwingStep3() {
  const isOptions = state.instrument !== 'stocks';
  const liq = state.liquidity || {};
  const gates = tfEvaluateGates();
  const premium = state.premium;
  const atr     = state.atr;
  const upx     = state.underlyingPrice;
  const liquidityInputs = [
    { key: 'stockVol',  label: 'Stock 30d avg volume',  rule: '≥ 1,000,000', step: '1' },
    { key: 'optionOI',  label: 'Option open interest',  rule: '≥ 500',       step: '1' },
    { key: 'optionVol', label: 'Option volume today',   rule: '≥ 100',       step: '1' },
  ];
  const liqInputHtml = (f) => `
    <div class="trade-input-row" style="grid-template-columns: 1fr;">
      <div>
        <label class="input-label">${f.label} <span style="float:right; color:var(--ink-4); font-weight:400; font-size:10px;">need ${f.rule}</span></label>
        <input type="number" min="0" step="${f.step}" class="trade-input" data-tf-liq="${f.key}"
          value="${liq[f.key] ?? ''}" />
      </div>
    </div>`;

  const quote = tfOptionSpreadFromBidAsk(liq.bid, liq.ask);
  const quoteInputs = tfOptionBidAskInputsHtml({
    bidValue: liq.bid ?? '',
    askValue: liq.ask ?? '',
    bidAttrs: 'data-tf-liq="bid"',
    askAttrs: 'data-tf-liq="ask"',
    spread: quote ? quote.spreadPct : null,
    spreadMax: 5,
  });

  // Sizing card + Gate 06 row — surgically updated by tfUpdateSwingSizing().
  const sizingCard = `<div id="tf-sizing-card">${tfRenderSwingSizingHtml()}</div>`;
  const stopGateRow = `
    <div id="tf-stop-gate" class="trade-row ${gates['06'] ? 'checked' : 'fail'}" data-tf-readonly="1">
      <span class="trade-row-check">${gates['06'] ? '✓' : ''}</span>
      <span class="trade-row-main">
        <span class="trade-row-name"><small>GATE 06</small> Stop level set before entry</span>
        <span class="trade-row-help">Auto-passes when ATR(14) and underlying price are both filled.</span>
      </span>
      <span class="trade-row-pill">${gates['06'] ? 'PASS' : 'FAIL'}</span>
    </div>`;

  if (!isOptions) {
    return `
      <div class="trade-section">
        <div class="trade-section-head">
          <div class="trade-section-head-stack">
            <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Stock price & risk size</div>
            <div class="trade-section-subtitle">Volume proves tradability. Share price drives the risk-unit size.</div>
          </div>
          <div class="trade-section-counter ${gates['04'] && premium > 0 ? 'complete' : ''}" id="tf-swing-risk-counter">${gates['04'] && premium > 0 ? 'ready' : 'fill 2'}</div>
        </div>
        <div class="trade-section-body">
          <div class="trade-section-grid-2">
            ${liqInputHtml(liquidityInputs[0])}
            <div class="trade-input-row" style="grid-template-columns: 1fr;">
              <div>
                <label class="input-label">Share entry price ($)</label>
                <input type="number" min="0" step="0.01" class="trade-input" id="tf-premium"
                  placeholder="Share entry price" value="${premium ?? ''}" />
              </div>
            </div>
          </div>
          ${sizingCard}
        </div>
      </div>`;
  }

  const liquidityGrid = liquidityInputs.map(liqInputHtml).join('');

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Liquidity & quote</div>
          <div class="trade-section-subtitle">Stock volume, option activity, and bid/ask all decide whether this contract is tradable.</div>
        </div>
        <div class="trade-section-counter ${gates['04'] ? 'complete' : ''}" id="tf-swing-liq-counter">${gates['04'] ? 'pass' : 'fill quote'}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">${liquidityGrid}</div>
        <div style="margin-top:12px;">${quoteInputs}</div>
      </div>
    </div>

    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> Entry, stop & size</div>
          <div class="trade-section-subtitle">Entry premium follows quote mid until you override it. ATR and price set the underlying stop.</div>
        </div>
        <div class="trade-section-counter ${premium > 0 && atr > 0 && upx > 0 ? 'complete' : ''}" id="tf-swing-risk-counter">${premium > 0 && atr > 0 && upx > 0 ? 'ready' : 'fill 3'}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Entry premium / limit ($)</label>
              <input type="number" min="0" step="0.01" class="trade-input" id="tf-premium"
                placeholder="Auto from quote mid" value="${premium ?? ''}" />
              <div class="input-help">Type here only when your real limit is different from mid.</div>
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">ATR(14) on the underlying</label>
              <input type="number" min="0" step="0.01" class="trade-input ${(!atr || atr <= 0) ? 'required-empty' : ''}" id="tf-atr"
                placeholder="ATR(14) from chart" value="${atr ?? ''}" />
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Underlying current price ($)</label>
              <input type="number" min="0" step="0.01" class="trade-input ${(!upx || upx <= 0) ? 'required-empty' : ''}" id="tf-upx"
                placeholder="Current underlying price" value="${upx ?? ''}" />
            </div>
          </div>
        </div>
        <div class="trade-templates" style="margin-top:10px;">
          <button type="button" class="trade-template-btn" id="tf-swing-use-mid">Use quote mid</button>
          <span class="trade-templates-label">Resets entry premium from bid/ask.</span>
        </div>
        <div style="margin-top:10px;">${stopGateRow}</div>
        ${sizingCard}
      </div>
    </div>
  `;
}

function tfMountSwingStep3() {
  if (tfAutoFillSwingPremiumFromQuote()) {
    const premiumEl = document.getElementById('tf-premium');
    if (premiumEl) premiumEl.value = state.premium;
    saveState();
    tfRefreshHeaderOnly();
    tfUpdateSwingSizing();
  }
  // Liquidity inputs — silent state writes + surgical header refresh only.
  document.querySelectorAll('#panel-trade [data-tf-liq]').forEach(el => {
    el.addEventListener('input', e => {
      const k = e.target.dataset.tfLiq;
      const v = parseFloat(e.target.value);
      if (!state.liquidity) state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
      const quoteChanged = k === 'bid' || k === 'ask';
      const previousMid = quoteChanged ? tfSwingQuoteMid(state.liquidity) : null;
      state.liquidity[k] = isNaN(v) ? null : v;
      const quote = tfOptionSpreadFromBidAsk(state.liquidity.bid, state.liquidity.ask);
      state.liquidity.spreadPct = quote ? quote.spreadPct : null;
      if (quoteChanged && tfAutoFillSwingPremiumFromQuote(previousMid)) {
        const premiumEl = document.getElementById('tf-premium');
        if (premiumEl) premiumEl.value = state.premium;
      }
      saveState();
      tfUpdateSwingSpreadLine();
      tfUpdateSwingSizing();
      tfRefreshHeaderOnly();
    });
  });
  // Premium / ATR / underlying — surgical sizing-card updates, no rebuild.
  const wireNum = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (key === 'premium') {
        if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
        state.tradeFlow.swingPremiumManual = !isNaN(v) && v > 0;
      }
      state[key] = isNaN(v) ? null : v;
      saveState();
      tfRefreshHeaderOnly();
      tfUpdateSwingSizing();
    });
  };
  wireNum('tf-premium', 'premium');
  wireNum('tf-atr', 'atr');
  wireNum('tf-upx', 'underlyingPrice');
  const useMidBtn = document.getElementById('tf-swing-use-mid');
  if (useMidBtn) {
    useMidBtn.addEventListener('click', () => {
      const mid = tfSetSwingPremiumFromQuote();
      if (mid === null) {
        if (typeof toast === 'function') toast('Enter valid bid and ask first.', true);
        return;
      }
      const premiumEl = document.getElementById('tf-premium');
      if (premiumEl) premiumEl.value = mid;
      saveState();
      tfRefreshHeaderOnly();
      tfUpdateSwingSizing();
    });
  }
}

// ----- Swing step 3 — Execute -----
// Goal: review at-a-glance, place the order in TOS, then log.

function tfSwingStep4() {
  const isOptions = state.instrument !== 'stocks';
  const tpl = state.selectedSetup ? (TRADE_SETUP_TEMPLATES[state.selectedSetup] || null) : null;
  const thesis = state.tradeFlow.thesis || '';
  const preMortem = state.tradeFlow.preMortem || '';
  const thesisPh = tpl ? `Template: ${tpl.thesis}` : 'One sentence — what has to happen for this to work?';
  const preMortemPh = tpl ? `Template: ${tpl.preMortem}` : 'What invalidates the thesis?';
  const st = tfComputeStatus();
  const ready = st.tone === 'ready';

  const settings = state.settings || DEFAULT_SETTINGS;
  const premium = state.premium;
  const stopPrice = (premium > 0) ? (premium * (1 - (settings.stopPct || 50)/100)).toFixed(2) : '—';
  const targetPrice = (premium > 0) ? (premium * (1 + (settings.targetPct || 50)/100)).toFixed(2) : '—';
  const orderSteps = isOptions ? `
          <li>Open option chain in TOS (Trade tab → ${state.ticker || 'ticker'} → Option Chain).</li>
          <li>Right-click the contract → Buy → With OCO Bracket.</li>
          <li>Entry limit ≈ $${premium ? premium.toFixed(2) : '—'} · target +${settings.targetPct || 50}% ($${targetPrice}) · stop ${settings.stopPct || 50}% ($${stopPrice}).</li>
          <li>Submit in TOS, then click GO below to log the thesis.</li>`
    : `
          <li>Open the order ticket in TOS for ${state.ticker || 'ticker'}.</li>
          <li>Buy the share size from the sizing card.</li>
          <li>Set your planned stop and target in TOS.</li>
          <li>Submit in TOS, then click GO below to log the thesis.</li>`;

  const templateBtns = tpl ? `
    <div class="trade-templates">
      <span class="trade-templates-label">Templates for ${state.selectedSetup}:</span>
      <button type="button" class="trade-template-btn" data-tf-tpl="reset">Reset to template</button>
      <button type="button" class="trade-template-btn" data-tf-tpl="clear">Clear both</button>
    </div>` : `
    <div class="trade-templates">
      <span class="trade-templates-label" style="color: var(--ink-4);">Pick a setup in step 1 to enable templates.</span>
    </div>`;

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Place the order in TOS</div>
          <div class="trade-section-subtitle">Use the OCO bracket so target and stop fire automatically.</div>
        </div>
      </div>
      <div class="trade-section-body">
        <ol style="margin: 0 0 0 16px; padding: 0; color: var(--ink-2); font-size: 13px; line-height: 1.7;">
          ${orderSteps}
        </ol>
      </div>
    </div>

    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> Thesis &amp; pre-mortem</div>
          <div class="trade-section-subtitle">Saved to the trade log. One sentence each is enough.</div>
        </div>
      </div>
      <div class="trade-section-body">
        ${templateBtns}
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Thesis — why is this trade on?</label>
              <textarea class="trade-textarea" id="tf-thesis" rows="3" placeholder="${thesisPh.replace(/"/g, '&quot;')}">${thesis}</textarea>
            </div>
          </div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Pre-mortem — if it loses, why?</label>
              <textarea class="trade-textarea" id="tf-premortem" rows="3" placeholder="${preMortemPh.replace(/"/g, '&quot;')}">${preMortem}</textarea>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-title"><span class="trade-section-title-icon">C.</span> Final check</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-output" style="${ready ? 'border-color: var(--green-dim); background: linear-gradient(135deg, var(--green-bg), var(--bg) 60%);' : ''}">
          <div class="trade-output-title">Status</div>
          <div class="trade-output-main">${ready ? 'Ready to log' : st.reason}</div>
          <div class="trade-output-rationale">${ready ? 'Hit GO below — confirm dialog will summarize, then log.' : 'Status pill at the top jumps you to the failing step.'}</div>
        </div>
      </div>
    </div>
  `;
}

function tfMountSwingStep4() {
  const t = document.getElementById('tf-thesis');
  const p = document.getElementById('tf-premortem');
  if (t) t.addEventListener('input', e => { state.tradeFlow.thesis = e.target.value; saveState(); });
  if (p) p.addEventListener('input', e => { state.tradeFlow.preMortem = e.target.value; saveState(); });

  document.querySelectorAll('#panel-trade [data-tf-tpl]').forEach(b => {
    b.addEventListener('click', () => {
      const action = b.dataset.tfTpl;
      const tpl = TRADE_SETUP_TEMPLATES[state.selectedSetup];
      if (action === 'reset' && tpl) {
        state.tradeFlow.thesis = tpl.thesis;
        state.tradeFlow.preMortem = tpl.preMortem;
      } else if (action === 'clear') {
        state.tradeFlow.thesis = '';
        state.tradeFlow.preMortem = '';
      }
      saveState();
      const ti = document.getElementById('tf-thesis');
      const pi = document.getElementById('tf-premortem');
      if (ti) ti.value = state.tradeFlow.thesis;
      if (pi) pi.value = state.tradeFlow.preMortem;
    });
  });
}

// ----- Intraday steps (single-screen) -----
// Four groups rendered on one page; user Tabs through every input. Layout aligned
// with the user's ThinkScript outputs so chart labels map 1:1 to fields.

// Lookup helper: returns the intraday setup definition (with bias + isOrb).
function tfFindIntradaySetup(id) {
  return TRADE_INTRADAY_SETUPS.find(s => s.id === id) || null;
}

function tfParseHumanNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).trim().replace(/,/g, '').match(/^([-+]?\d*\.?\d+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') return n * 1000;
  if (suffix === 'M') return n * 1000000;
  if (suffix === 'B') return n * 1000000000;
  return n;
}

function tfReadKeyNumber(text, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const re = new RegExp(`\\b${key}\\s*(?:=|:)\\s*([-+]?\\d[\\d,.]*\\s*[KMB]?)`, 'i');
    const m = text.match(re);
    if (m) return tfParseHumanNumber(m[1]);
  }
  return null;
}

function tfGradePasses(raw) {
  const g = String(raw || '').trim().toUpperCase();
  const order = { 'A+': 12, 'A': 11, 'A-': 10, 'B+': 9, 'B': 8, 'B-': 7, 'C+': 6, 'C': 5, 'C-': 4, 'D+': 3, 'D': 2, 'D-': 1, 'F': 0 };
  return order[g] !== undefined && order[g] >= order['B-'];
}

function tfNormalizeSwingSetup(raw) {
  const s = String(raw || '').toUpperCase().replace(/[_-]+/g, ' ').trim();
  if (!s) return null;
  if (/21/.test(s) && /EMA|PULL/.test(s)) return '21-EMA Pullback';
  if (/BASE|BO|BREAKOUT/.test(s) && !/RETEST/.test(s)) return 'Base Breakout';
  if (/RETEST/.test(s)) return 'Breakout Retest';
  if (/9/.test(s) && /EMA|RECLAIM/.test(s)) return '9-EMA Reclaim';
  if (/EDGE|REVERS/.test(s)) return 'Edge Reversal';
  return null;
}

function tfParseSwingPaste(text) {
  const out = { gates: {}, liquidity: {} };
  const raw = text || '';
  const upper = raw.toUpperCase();

  const explicitTicker = raw.match(/\b(?:TICKER|SYMBOL|SYM)\s*(?:=|:)\s*([A-Z]{1,6})\b/i);
  const firstToken = raw.trim().match(/^([A-Z]{1,6})(?=\s|$)/);
  const skipFirst = /^(REGIME|FIRE|IVR|RSMK|RVOL|STACK|SETUP|SA|LIQ)$/i;
  if (explicitTicker) out.ticker = explicitTicker[1].toUpperCase();
  else if (firstToken && !skipFirst.test(firstToken[1])) out.ticker = firstToken[1].toUpperCase();

  if (/\b(STOCK|SHARES?)\b/.test(upper)) out.instrument = 'stocks';
  if (/\b(OPTION|OPTIONS|CALL|PUT|CONTRACTS?)\b/.test(upper)) out.instrument = 'options';
  if (/\b(SHORT|PUT|BEARISH)\b/.test(upper)) out.direction = 'short';
  if (/\b(LONG|CALL|BULLISH)\b/.test(upper)) out.direction = out.direction || 'long';

  const setupMatch = raw.match(/\b(?:SETUP|FIRE)\s*(?:=|:)\s*([A-Z0-9 _-]+)/i);
  if (setupMatch) out.setup = tfNormalizeSwingSetup(setupMatch[1]);
  else out.setup = tfNormalizeSwingSetup(raw);

  const regimeMatch = raw.match(/\bREGIME\s*(?:=|:)\s*(RISK[-\s]?ON|NEUTRAL|RISK[-\s]?OFF)\b/i);
  if (regimeMatch) {
    const r = regimeMatch[1].toUpperCase().replace(/\s+/g, '-');
    out.regime = r === 'RISK-ON' ? 'risk-on' : r === 'RISK-OFF' ? 'risk-off' : 'neutral';
  }

  const ivr = tfReadKeyNumber(raw, ['IVR', 'IV\\s*RANK']);
  const atr = tfReadKeyNumber(raw, ['ATR']);
  const px = tfReadKeyNumber(raw, ['PX', 'PRICE', 'UNDERLYING']);
  const premium = tfReadKeyNumber(raw, ['PREM', 'PREMIUM', 'MID', 'DEBIT', 'ENTRY']);
  const quant = tfReadKeyNumber(raw, ['QUANT', 'SA\\s*QUANT']);
  const earnings = tfReadKeyNumber(raw, ['EARNINGS', 'ER', 'DTE\\s*ER']);
  if (ivr !== null) out.ivr = ivr;
  if (atr !== null) out.atr = atr;
  if (px !== null) out.underlyingPrice = px;
  if (premium !== null) out.premium = premium;
  if (quant !== null) out.saQuant = quant;
  if (earnings !== null) out.daysToEarnings = earnings;

  const stockVol = tfReadKeyNumber(raw, ['VOL', 'AVG\\s*VOL', 'STOCK\\s*VOL']);
  const optionOI = tfReadKeyNumber(raw, ['OI', 'OPEN\\s*INTEREST']);
  const optionVol = tfReadKeyNumber(raw, ['OVOL', 'OPT\\s*VOL', 'OPTION\\s*VOL']);
  const bid = tfReadKeyNumber(raw, ['BID']);
  const ask = tfReadKeyNumber(raw, ['ASK']);
  const spread = tfReadKeyNumber(raw, ['SPR', 'SPREAD']);
  if (stockVol !== null) out.liquidity.stockVol = stockVol;
  if (optionOI !== null) out.liquidity.optionOI = optionOI;
  if (optionVol !== null) out.liquidity.optionVol = optionVol;
  if (bid !== null) out.liquidity.bid = bid;
  if (ask !== null) out.liquidity.ask = ask;
  if (spread !== null) out.liquidity.spreadPct = spread;

  const strength = tfReadKeyNumber(raw, ['STRENGTH']);
  const stack = raw.match(/\bSTACK\s*(?:=|:)\s*(BULLISH|BEARISH|MIXED)\b/i);
  const rvol = tfReadKeyNumber(raw, ['RVOL']);
  const rsmkPositive = /\bRSMK\s*(?:=|:)\s*(?:\+|POS|POSITIVE|LEADER)/i.test(raw);
  if (strength !== null && strength >= 2) out.gates['03'] = true;
  if (stack && stack[1].toUpperCase() !== 'MIXED') out.gates['03'] = true;
  if (rvol !== null && rvol >= 1 && rsmkPositive) out.gates['03'] = true;

  const prof = raw.match(/\b(?:PROFITABILITY|PROFIT)\s*(?:=|:)\s*([A-F][+-]?)\b/i);
  const momo = raw.match(/\b(?:MOMENTUM|MOMO)\s*(?:=|:)\s*([A-F][+-]?)\b/i);
  if (prof && tfGradePasses(prof[1])) out.gates['02'] = true;
  if (momo && tfGradePasses(momo[1])) out.gates['03'] = true;

  return out;
}

function tfApplySwingPaste(parsed) {
  if (!parsed) return;
  if (parsed.ticker) state.ticker = parsed.ticker;
  if (parsed.instrument) {
    state.instrument = parsed.instrument;
    state.structure = parsed.instrument === 'stocks' ? 'stocks' : (state.structure === 'spread' ? 'spread' : 'options');
  }
  if (parsed.direction) state.direction = parsed.direction;
  if (parsed.setup) state.selectedSetup = parsed.setup;
  if (parsed.regime) state.regime = parsed.regime;
  ['ivr', 'atr', 'underlyingPrice', 'premium', 'saQuant', 'daysToEarnings'].forEach(k => {
    if (parsed[k] !== undefined && parsed[k] !== null) state[k] = parsed[k];
  });
  if (!state.liquidity) state.liquidity = { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null };
  Object.assign(state.liquidity, parsed.liquidity || {});
  if (state.liquidity.bid > 0 && state.liquidity.ask > 0) {
    state.liquidity.spreadPct = deriveSpreadPct(state.liquidity);
    if (!state.premium) state.premium = +(((Number(state.liquidity.bid) + Number(state.liquidity.ask)) / 2).toFixed(2));
  }
  if (!state.gateChecks) state.gateChecks = {};
  Object.entries(parsed.gates || {}).forEach(([k, v]) => { if (v) state.gateChecks[k] = true; });
  saveState();
}

// Smart paste — parses TOS alert text from the user's MAC_Intraday_*
// scripts. Each regex matches one of the labels those studies emit.
function tfParseIntradayPaste(text) {
  const out = {};
  const t = (text || '').toUpperCase();

  // Setup pattern (priority order matters: ORB matches first)
  if      (/ORB\s+UP[\s-]?BREAK/.test(t))   out.setup = 'orb-up-break';
  else if (/ORB\s+DN[\s-]?BREAK/.test(t))   out.setup = 'orb-dn-break';
  else if (/ABOVE\s+VWAP\s+UP/.test(t))     out.setup = 'above-vwap-up';
  else if (/BELOW\s+VWAP\s+DN/.test(t))     out.setup = 'below-vwap-dn';
  else if (/VWAP\s+MEAN[\s-]?RV/.test(t))   out.setup = 'vwap-mean-rv';

  // Confluence label (MAC_Intraday_VWAP_Confluence_v2)
  if      (/LONG\s+BIAS/.test(t))           out.confluence = 'long-bias';
  else if (/SHORT\s+BIAS/.test(t))          out.confluence = 'short-bias';
  else if (/INTRADAY:\s*MIXED/.test(t))     out.confluence = 'mixed';

  // Breadth label (MAC_Intraday_Breadth_Label_v2)
  if      (/BREADTH\s+UP/.test(t))          out.breadth = 'up';
  else if (/BREADTH\s+DOWN/.test(t))        out.breadth = 'down';
  else if (/BREADTH\s+FLAT/.test(t))        out.breadth = 'flat';

  // ORB cloud alert numbers — case-insensitive match against original text.
  const mHi  = text && text.match(/OR[_\s]HI\s*[=:]\s*([0-9.]+)/i);
  const mLo  = text && text.match(/OR[_\s]LO\s*[=:]\s*([0-9.]+)/i);
  const mRng = text && text.match(/\bRNG\s*[=:]\s*([0-9.]+)/i);
  if (mHi)  out.orHi  = parseFloat(mHi[1]);
  if (mLo)  out.orLo  = parseFloat(mLo[1]);
  if (mRng) out.orRng = parseFloat(mRng[1]);

  // VWAP price value (label: "VWAP: 486.50" or "VWAP=486.50")
  const mVwap = text && text.match(/\bVWAP\s*[=:]\s*([0-9.]+)/i);
  if (mVwap) out.vwapValue = parseFloat(mVwap[1]);

  // Ticker — explicit "TICKER=SPY" or "SYM=SPY" key.
  const mTk = text && text.match(/(?:TICKER|SYMBOL|SYM)\s*[=:]\s*([A-Z]{1,6})/i);
  if (mTk) out.ticker = mTk[1].toUpperCase();

  if (/\b(STOCK|SHARES?)\b/i.test(text || '')) out.instrument = 'stocks';
  if (/\b(OPTION|OPTIONS|CALL|PUT|CONTRACTS?)\b/i.test(text || '')) out.instrument = 'options';

  const entry = tfReadKeyNumber(text || '', ['ENTRY', 'ENT', 'PRICE', 'PX']);
  const stop = tfReadKeyNumber(text || '', ['STOP', 'STP']);
  const target = tfReadKeyNumber(text || '', ['TARGET', 'TGT']);
  const bid = tfReadKeyNumber(text || '', ['BID']);
  const ask = tfReadKeyNumber(text || '', ['ASK']);
  const mid = tfReadKeyNumber(text || '', ['MID']);
  const spread = tfReadKeyNumber(text || '', ['SPR', 'SPREAD']);
  const qty = tfReadKeyNumber(text || '', ['QTY', 'CONTRACTS', 'SHARES']);
  if (entry !== null) out.entry = entry;
  if (stop !== null) out.stop = stop;
  if (target !== null) out.target = target;
  if (bid !== null) out.bid = bid;
  if (ask !== null) out.ask = ask;
  if (mid !== null) out.mid = mid;
  if (spread !== null) out.spreadPct = spread;
  if (qty !== null) out.contracts = Math.max(1, Math.floor(qty));

  return out;
}

function tfApplyIntradayPaste(parsed) {
  if (!state.intraday) state.intraday = newIntradayTicket();
  const it = state.intraday;
  if (parsed.instrument) it.instrument = parsed.instrument;
  if (parsed.instrument) it.structure = parsed.instrument === 'stocks' ? 'stocks' : (it.structure === 'spread' ? 'spread' : 'options');
  if (parsed.ticker)     it.ticker = parsed.ticker;
  if (parsed.setup) {
    it.setup = parsed.setup;
    // Auto-align direction with setup's bias (long/short patterns only).
    const def = tfFindIntradaySetup(parsed.setup);
    if (def && def.bias === 'long')  it.direction = 'long';
    if (def && def.bias === 'short') it.direction = 'short';
  }
  if (parsed.confluence) it.confluence = parsed.confluence;
  if (parsed.breadth)    it.breadth = parsed.breadth;
  if (parsed.orHi  !== undefined) it.orHi  = parsed.orHi;
  if (parsed.orLo  !== undefined) it.orLo  = parsed.orLo;
  if (parsed.orRng !== undefined) it.orRng = parsed.orRng;
  // Derive RNG when only the two endpoints came in.
  if (parsed.orHi !== undefined && parsed.orLo !== undefined && parsed.orRng === undefined) {
    it.orRng = +(parsed.orHi - parsed.orLo).toFixed(2);
  }
  if (parsed.vwapValue !== undefined) it.vwapValue = parsed.vwapValue;
  ['entry', 'stop', 'target', 'bid', 'ask', 'mid', 'spreadPct', 'contracts'].forEach(k => {
    if (parsed[k] !== undefined && parsed[k] !== null) it[k] = parsed[k];
  });
  tfDeriveIntradaySpread();
  tfAutoFillIntradayOptionBracket();
  tfAutoFillIntradayStockFromOR();
  saveState();
}

// Section 1 — Setup picker (parallel to swing's setup step). Ticker, direction,
// and instrument all live in the sticky header; ORB range chips appear when an
// ORB variant is picked.
function tfIntradayStep1() {
  const it = state.intraday || {};
  const setupDef = tfFindIntradaySetup(it.setup);
  const isOrb = !!(setupDef && setupDef.isOrb);
  const cards = TRADE_INTRADAY_SETUPS.map(s => {
    const biasTag = s.bias === 'long'  ? '<span class="tf-bias-tag long">LONG</span>'
                  : s.bias === 'short' ? '<span class="tf-bias-tag short">SHORT</span>'
                                       : '<span class="tf-bias-tag neutral">EITHER</span>';
    return `
    <button class="trade-setup-card ${it.setup === s.id ? 'selected' : ''}" type="button" data-tf-i-setup="${s.id}">
      <span class="trade-setup-card-num">${s.num} · ${biasTag}</span>
      <span class="trade-setup-card-name">${s.name}</span>
      <span class="trade-setup-card-detail">${s.desc}</span>
    </button>`;
  }).join('');

  const orbChips = isOrb ? `
    <div class="tf-chip-row" id="tf-i-orb-chips" style="margin-top:12px;">
      <span class="tf-chip-row-label">Range:</span>
      ${TRADE_ORB_TYPES.map(o => `
        <button type="button" class="tf-chip ${(it.orbType || '30') === o.id ? 'selected' : ''}" data-tf-i-orb-type="${o.id}">${o.label}</button>
      `).join('')}
    </div>` : '';

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">1.</span> Pick the setup</div>
          <div class="trade-section-subtitle">Mirrors your ThinkScript labels. Direction auto-aligns from the picked pattern's bias.</div>
        </div>
        <div class="trade-section-counter ${it.setup ? 'complete' : ''}">${it.setup ? '1 selected' : 'pick 1'}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-setup-grid">${cards}</div>
        ${orbChips}
      </div>
    </div>
  `;
}

function tfMountIntradayStep1() {
  // Setup pattern — auto-align direction with bias on first pick.
  document.querySelectorAll('#panel-trade [data-tf-i-setup]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.tfISetup;
      if (!state.intraday) state.intraday = newIntradayTicket();
      state.intraday.setup = id;
      const def = tfFindIntradaySetup(id);
      if (def && def.bias === 'long')  state.intraday.direction = 'long';
      if (def && def.bias === 'short') state.intraday.direction = 'short';
      tfAutoFillIntradayStockFromOR();
      saveState();
      tfRefreshAll();
    });
  });

  // ORB range chips (only present when setup is an ORB variant).
  document.querySelectorAll('#panel-trade [data-tf-i-orb-type]').forEach(b => {
    b.addEventListener('click', () => {
      if (!state.intraday) state.intraday = newIntradayTicket();
      state.intraday.orbType = b.dataset.tfIOrbType;
      saveState();
      tfRefreshAll();
    });
  });
}

// ----- Intraday plan — Levels (entry/stop/target + optional ORB OR levels) -----
function tfIntradayStep2() {
  const it = state.intraday || {};
  const isOptions = tfIntradayInstrument() !== 'stocks';
  const draft = (state.tradeFlow && state.tradeFlow.intradayDraft) || {};
  const filled = (v) => v !== null && v !== undefined && v !== '';
  const inputValue = (key) => (draft[key] !== undefined && draft[key] !== '') ? draft[key] : (it[key] ?? '');
  const lvlN = [filled(it.entry), filled(it.stop), filled(it.target)].filter(Boolean).length;
  const r = (it.entry && it.stop && it.target)
    ? Math.abs((Number(it.target) - Number(it.entry)) / (Number(it.entry) - Number(it.stop)))
    : null;
  const rText = r !== null && isFinite(r) ? `${r.toFixed(2)}R reward / risk` : '—';
  const rGood = r !== null && isFinite(r) && r >= 1.5;

  const setupDef = tfFindIntradaySetup(it.setup);
  const isOrb = !!(setupDef && setupDef.isOrb);
  const orFilledN = [filled(it.orHi), filled(it.orLo), filled(it.orRng)].filter(Boolean).length;
  const levelsLetter = isOptions ? 'B.' : 'A.';
  const orLetter = isOptions ? 'C.' : 'B.';

  // ORB section is optional ("bypass if not shown" — only present when an
  // ORB pattern is the picked setup, and even then the user can leave it
  // empty without blocking GO).
  const orSection = isOrb ? `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">${orLetter}</span> Opening Range levels</div>
          <div class="trade-section-subtitle">From your ORB cloud alert: <code>OR_HI=… | OR_LO=… | RNG=…</code>. Optional — skip if you didn't note them.</div>
        </div>
        <div class="trade-section-counter">${orFilledN} of 3 (optional)</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">OR_HI $</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-orHi" value="${inputValue('orHi')}" placeholder="OR_HI from TOS alert" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">OR_LO $</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-orLo" value="${inputValue('orLo')}" placeholder="OR_LO from TOS alert" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">RNG $</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-orRng" value="${inputValue('orRng')}" placeholder="RNG auto-fills from OR_HI/OR_LO" />
            <div class="input-help">Auto-fills as <code>OR_HI − OR_LO</code> if you leave it empty.</div>
          </div></div>
        </div>
      </div>
    </div>` : '';

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">${levelsLetter}</span> Entry · stop · target</div>
          <div class="trade-section-subtitle">${isOptions ? 'Auto-filled from bid/ask mid. Edit only when your actual limit, stop, or target differs.' : 'Share-price bracket. ORB alerts can fill this automatically for stock trades.'}</div>
        </div>
        <div class="trade-section-counter ${lvlN === 3 ? 'complete' : ''}">${lvlN} of 3</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">${isOptions ? 'Entry premium / mid $' : 'Entry price $'}</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-entry" value="${inputValue('entry')}" placeholder="${isOptions ? 'Auto from quote' : 'Share entry price'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">${isOptions ? 'Stop premium $' : 'Stop price $'}</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-stop" value="${inputValue('stop')}" placeholder="${isOptions ? 'Auto premium stop' : 'Invalidation price'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">${isOptions ? 'Target premium $' : 'Target price $'}</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-target" value="${inputValue('target')}" placeholder="${isOptions ? 'Auto premium target' : 'Target price'}" />
          </div></div>
        </div>
        <div id="tf-i-rmult">
          <div class="trade-output" style="${rGood ? 'border-color: var(--green-dim); background: linear-gradient(135deg, var(--green-bg), var(--bg) 60%);' : ''}">
            <div class="trade-output-title">R-multiple</div>
            <div class="trade-output-main">${rText}</div>
            <div class="trade-output-rationale">Distance to target divided by distance to stop.</div>
          </div>
        </div>
      </div>
    </div>
    ${orSection}
  `;
}

function tfMountIntradayStep2() {
  const wire = (id, key, isInt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      state.tradeFlow.intradayDraft[key] = e.target.value;
      const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
      state.intraday[key] = isNaN(v) ? null : v;
      saveState();
      tfRefreshHeaderOnly();
      if (key === 'entry' || key === 'stop' || key === 'target') {
        tfUpdateIntradayRMult();
        tfUpdateIntradaySizing();
      }
      // Auto-derive RNG = OR_HI - OR_LO when both sides are filled and the
      // user hasn't typed anything into the RNG field.
      if (key === 'orHi' || key === 'orLo') {
        const hi = Number(state.intraday.orHi);
        const lo = Number(state.intraday.orLo);
        const rngTouched = (draft && draft.orRng !== undefined) || (state.intraday.orRng !== null && state.intraday.orRng !== undefined);
        if (hi > 0 && lo > 0 && hi >= lo && !rngTouched) {
          state.intraday.orRng = +(hi - lo).toFixed(2);
          const rngEl = document.getElementById('tf-i-orRng');
          if (rngEl) rngEl.value = state.intraday.orRng;
          tfAutoFillIntradayStockFromOR();
          saveState();
        }
      }
      if (key === 'orHi' || key === 'orLo' || key === 'orRng') {
        tfAutoFillIntradayStockFromOR();
        ['entry', 'stop', 'target'].forEach(levelKey => {
          const levelEl = document.getElementById(`tf-i-${levelKey}`);
          if (levelEl && state.intraday[levelKey] !== null && state.intraday[levelKey] !== undefined) {
            levelEl.value = state.intraday[levelKey];
          }
        });
        tfUpdateIntradayRMult();
        tfUpdateIntradaySizing();
        saveState();
      }
    });
  };
  wire('tf-i-entry', 'entry');
  wire('tf-i-stop', 'stop');
  wire('tf-i-target', 'target');
  wire('tf-i-orHi', 'orHi');
  wire('tf-i-orLo', 'orLo');
  wire('tf-i-orRng', 'orRng');
}

// ----- Intraday plan — Size: options bid/ask spread or stock share count -----
function tfIntradayStep3() {
  const it = state.intraday || {};
  const isOptions = tfIntradayInstrument() !== 'stocks';
  const draft = (state.tradeFlow && state.tradeFlow.intradayDraft) || {};
  const inputValue = (key) => (draft[key] !== undefined && draft[key] !== '') ? draft[key] : (it[key] ?? '');
  const spread = tfDeriveIntradaySpread();
  const settings = state.settings || DEFAULT_SETTINGS;
  const sizeLetter = isOptions ? 'A.' : 'C.';

  const optionsSizing = `
    ${tfOptionBidAskInputsHtml({
      bidValue: inputValue('bid'),
      askValue: inputValue('ask'),
      bidAttrs: 'id="tf-i-bid"',
      askAttrs: 'id="tf-i-ask"',
      spread,
      spreadMax: settings.intradayMaxSpreadPct || 5,
    })}
    <div class="trade-templates" style="margin-top:10px;">
      <button type="button" class="trade-template-btn" id="tf-i-use-quote">Reset levels to quote</button>
      <span class="trade-templates-label">Sets entry to mid, then rebuilds stop and target.</span>
    </div>
    <div class="trade-section-grid-2">
      <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
        <label class="input-label">Contracts override</label>
        <input type="number" min="1" step="1" class="trade-input" id="tf-i-contracts" value="${inputValue('contracts')}" placeholder="Auto from risk, or override" />
        <div class="input-help">Blank uses the suggested risk-unit size.</div>
      </div></div>
    </div>`;

  const stockSizing = `
    <div class="trade-section-grid-2">
      <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
        <label class="input-label">Shares override</label>
        <input type="number" min="1" step="1" class="trade-input" id="tf-i-contracts" value="${inputValue('contracts')}" placeholder="Shares, or leave blank" />
        <div class="input-help">Blank uses the suggested risk-unit size.</div>
      </div></div>
    </div>`;

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">${sizeLetter}</span> ${isOptions ? 'Option quote & risk size' : 'Share risk size'}</div>
          <div class="trade-section-subtitle">${isOptions ? `Bid/ask creates the mid entry and spread check. Quantity is suggested from your $${settings.intradayRiskPerTrade || 100} risk unit.` : `Quantity is suggested from your $${settings.intradayRiskPerTrade || 100} risk unit.`}</div>
        </div>
      </div>
      <div class="trade-section-body">
        ${isOptions ? optionsSizing : stockSizing}
        <div id="tf-i-sizing-card">${tfRenderIntradaySizingHtml()}</div>
      </div>
    </div>
  `;
}

function tfMountIntradayStep3() {
  const updateOptionDerived = ({ forceBracket = false } = {}) => {
    const spread = tfDeriveIntradaySpread();
    tfAutoFillIntradayOptionBracket({ force: forceBracket });
    if (forceBracket) {
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      ['entry', 'stop', 'target'].forEach(key => {
        state.tradeFlow.intradayDraft[key] = state.intraday[key] ?? '';
      });
    }
    ['entry', 'stop', 'target'].forEach(key => {
      const el = document.getElementById(`tf-i-${key}`);
      if (el && state.intraday[key] !== null && state.intraday[key] !== undefined) el.value = state.intraday[key];
    });
    tfUpdateIntradayRMult();
    tfUpdateIntradaySizing();
    const spreadRead = document.querySelector('#panel-trade #tf-i-bid')?.closest('.trade-section')?.querySelector('[data-tf-spread-read]');
    if (spreadRead) spreadRead.innerHTML = tfSpreadReadHtml(spread);
    const badge = document.querySelector('#panel-trade #tf-i-bid')?.closest('.trade-input-row')?.querySelector('.trade-bracket')
      || document.querySelector('#panel-trade .trade-bracket');
    if (badge) {
      const b = tfSpreadBracket(state.intraday.spreadPct);
      badge.className = `trade-bracket ${b.cls}`;
      badge.textContent = b.text;
    }
  };
  const wire = (id, key, isInt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      state.tradeFlow.intradayDraft[key] = e.target.value;
      const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
      state.intraday[key] = isNaN(v) ? null : v;
      if (key === 'bid' || key === 'ask') updateOptionDerived();
      saveState();
      tfRefreshHeaderOnly();
      tfUpdateIntradaySizing();
    });
  };
  wire('tf-i-bid', 'bid');
  wire('tf-i-ask', 'ask');
  wire('tf-i-contracts', 'contracts', true);
  const quoteBtn = document.getElementById('tf-i-use-quote');
  if (quoteBtn) {
    quoteBtn.addEventListener('click', () => {
      const spread = tfDeriveIntradaySpread();
      if (spread === null) {
        if (typeof toast === 'function') toast('Enter a valid bid and ask first.', true);
        return;
      }
      updateOptionDerived({ forceBracket: true });
      saveState();
      tfRefreshHeaderOnly();
    });
  }
  tfBindIntradayRiskSizeButton();
}

// ----- Intraday step 3 — Context: optional ThinkScript chips + guardrails -----
// Confluence + breadth chips capture what the user is reading off the chart
// (MAC_Intraday_VWAP_Confluence + MAC_Intraday_Breadth labels). They flow
// into the trade log; only an explicit confluence conflict blocks GO.
function tfIntradayStep4() {
  const it = state.intraday || {};
  const isOptions = tfIntradayInstrument() !== 'stocks';
  const settings = state.settings || DEFAULT_SETTINGS;
  const inWin = (typeof isInIntradayWindow === 'function') ? isInIntradayWindow() : true;
  const tov   = !!(state.intradayQuality && state.intradayQuality.timeOverride);
  const dayPL = tfComputeIntradayDayPL();
  const lossBudget = settings.intradayMaxDailyLoss + dayPL;
  const setupDef = tfFindIntradaySetup(it.setup);
  const spreadPct = isOptions ? tfDeriveIntradaySpread() : null;

  // Direction vs setup bias — explicit conflict (e.g. ORB UP-BREAK + Short).
  const dirSetupOk = !setupDef || setupDef.bias === 'either' || it.direction === setupDef.bias;

  // Direction vs confluence chip (LONG BIAS / SHORT BIAS / MIXED).
  const conf = (TRADE_CONFLUENCE_OPTIONS.find(c => c.id === it.confluence) || null);
  const dirConfOk = !conf || conf.bias === 'either' || it.direction === conf.bias;

  const checks = [
    { key: 'dir-setup', step: 1, name: 'Setup bias', ok: dirSetupOk,
      rule: setupDef ? `${setupDef.name} expects ${setupDef.bias === 'either' ? 'either direction' : setupDef.bias.toUpperCase()}.` : 'Pick a setup first.' },
    { key: 'dir-conf',  step: 3, name: 'VWAP confluence', ok: dirConfOk,
      rule: conf ? `Confluence chip is ${conf.label}.` : 'Optional — leave blank when you do not need it.' },
    { key: 'spread',    step: 2, name: isOptions ? `Spread ≤ ${settings.intradayMaxSpreadPct}%` : 'Spread not needed for stock', ok: !isOptions || (spreadPct !== null && spreadPct <= settings.intradayMaxSpreadPct),
      rule: isOptions ? 'Uses bid/ask from the quote section.' : 'Stock trades skip option-chain spread.' },
    { key: 'window',    step: 3, name: 'Entry window', ok: inWin || tov,
      rule: '09:35–11:30 or 14:00–15:30 local. Override for paper.' },
    { key: 'budget',    step: 3, name: 'Daily loss budget', ok: lossBudget > 0,
      rule: `Today: ${dayPL >= 0 ? '+$' : '-$'}${Math.abs(dayPL).toFixed(0)}. Cap: $${settings.intradayMaxDailyLoss}.` },
  ];
  const passed = checks.filter(c => c.ok).length;
  const total  = checks.length;
  const allGreen = passed === total;

  const rows = checks.map(c => `
    <button type="button" class="trade-row ${c.ok ? 'checked' : 'fail'}" data-tf-jump="${c.step}">
      <span class="trade-row-check">${c.ok ? '✓' : ''}</span>
      <span class="trade-row-main">
        <span class="trade-row-name">${c.name}</span>
        <span class="trade-row-help">${c.rule}${c.key === 'window' && !inWin ? ` <span data-tf-i-tov style="margin-left:6px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 4px; cursor: pointer; color: var(--cyan); font-family: var(--mono); font-size: 10px;">${tov ? 'Override on — turn off' : 'Override (paper)'}</span>` : ''}</span>
      </span>
      <span class="trade-row-pill">${c.ok ? 'PASS' : 'FAIL'}</span>
    </button>`).join('');

  const banner = allGreen
    ? `<div class="trade-output" style="border-color: var(--green-dim); background: linear-gradient(135deg, var(--green-bg), var(--bg) 60%);">
         <div class="trade-output-title">Cleared</div>
         <div class="trade-output-main">Ready to log</div>
         <div class="trade-output-rationale">Place the bracket in TOS, then use GO.</div>
       </div>`
    : `<div class="trade-output">
         <div class="trade-output-title">${total - passed} guardrail${total - passed === 1 ? '' : 's'} blocking</div>
         <div class="trade-output-main">${passed} of ${total} passed</div>
         <div class="trade-output-rationale">Click a failing row to jump to the field that fixes it.</div>
       </div>`;

  // Context chips — confluence + breadth. Both clear-able by clicking the
  // selected chip again (toggle off).
  const confChips = TRADE_CONFLUENCE_OPTIONS.map(c => `
    <button type="button" class="tf-chip ${it.confluence === c.id ? 'selected ' + (c.bias || 'neutral') : ''}" data-tf-i-conf="${c.id}">${c.label}</button>
  `).join('');
  const breadthChips = TRADE_BREADTH_OPTIONS.map(b => `
    <button type="button" class="tf-chip ${it.breadth === b.id ? 'selected ' + (b.id === 'up' ? 'long' : b.id === 'down' ? 'short' : 'neutral') : ''}" data-tf-i-breadth="${b.id}">${b.label}</button>
  `).join('');

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Context notes</div>
          <div class="trade-section-subtitle">Optional chart context. Only conflicting confluence blocks GO.</div>
        </div>
      </div>
      <div class="trade-section-body">
        <div class="tf-chip-row">
          <span class="tf-chip-row-label">Confluence:</span>
          ${confChips}
        </div>
        <div class="tf-chip-row" style="margin-top:8px;">
          <span class="tf-chip-row-label">Breadth:</span>
          ${breadthChips}
        </div>
        <div class="trade-input-row" style="grid-template-columns: 1fr; margin-top:12px;">
          <div>
            <label class="input-label">VWAP value (optional)</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-vwapValue" value="${it.vwapValue ?? ''}" placeholder="VWAP value from label" />
          </div>
        </div>
        <div class="trade-input-row" style="grid-template-columns: 1fr; margin-top:12px;">
          <div>
            <label class="input-label">Trigger / invalidation notes (optional)</label>
            <textarea class="trade-textarea" id="tf-i-notes" rows="2" placeholder="Execution note: trigger, invalidation, context">${it.notes || ''}</textarea>
          </div>
        </div>
      </div>
    </div>

    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> Guardrails</div>
          <div class="trade-section-subtitle">Fast pass/fail check from setup bias, spread, time window, and loss budget.</div>
        </div>
        <div class="trade-section-counter ${allGreen ? 'complete' : ''}">${passed} of ${total} passed</div>
      </div>
      <div class="trade-section-body">
        ${banner}
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">${rows}</div>
      </div>
    </div>
  `;
}

function tfMountIntradayStep4() {
  // Time-window override toggle.
  document.querySelectorAll('#panel-trade [data-tf-i-tov]').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (!state.intradayQuality) state.intradayQuality = { timeOverride: false };
      state.intradayQuality.timeOverride = !state.intradayQuality.timeOverride;
      saveState();
      tfRefreshAll();
    });
  });
  // Jump-to-fix on each failing check.
  document.querySelectorAll('#panel-trade [data-tf-jump]').forEach(el => {
    el.addEventListener('click', () => {
      const target = parseInt(el.dataset.tfJump, 10);
      if (target) tfGoToStep(target);
    });
  });
  // Confluence chip — toggle on/off.
  document.querySelectorAll('#panel-trade [data-tf-i-conf]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.tfIConf;
      state.intraday.confluence = (state.intraday.confluence === id) ? '' : id;
      saveState();
      tfRefreshAll();
    });
  });
  // Breadth chip — toggle on/off.
  document.querySelectorAll('#panel-trade [data-tf-i-breadth]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.tfIBreadth;
      state.intraday.breadth = (state.intraday.breadth === id) ? '' : id;
      saveState();
      tfRefreshAll();
    });
  });
  // VWAP value input — informational, no header refresh needed.
  const v = document.getElementById('tf-i-vwapValue');
  if (v) {
    v.addEventListener('input', e => {
      const n = parseFloat(e.target.value);
      state.intraday.vwapValue = isNaN(n) ? null : n;
      saveState();
    });
  }
  const t = document.getElementById('tf-i-notes');
  if (t) {
    t.addEventListener('input', e => {
      state.intraday.notes = e.target.value;
      saveState();
    });
  }
}

// ============== Orchestrator ==============

function renderTrade() {
  const panel = document.getElementById('panel-trade');
  if (!panel) return;
  if (!state.tradeFlow) state.tradeFlow = { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
  panel.querySelectorAll('[data-trade-mode]').forEach(b => {
    b.onclick = () => tfSetMode(b.dataset.tradeMode);
  });
  // Bind global handlers once
  if (!panel.dataset.tfBound) {
    panel.dataset.tfBound = '1';
    document.getElementById('trade-back-btn')?.addEventListener('click', () => {
      // Single-screen mode and step-1 Back both leave the panel (go Home).
      // Mid-flow Back walks one step back.
      const cur = state.tradeFlow.step || 1;
      if (tfIsSingleScreen() || cur <= 1) {
        if (typeof setTab === 'function') setTab('home');
        return;
      }
      tfGoToStep(cur - 1);
    });
    document.getElementById('trade-continue-btn')?.addEventListener('click', tfContinue);
    document.getElementById('trade-reset-btn')?.addEventListener('click', tfReset);
    // Click the status pill to jump to the failing step.
    const statusCell = document.getElementById('trade-summary-status-cell');
    if (statusCell) {
      statusCell.addEventListener('click', () => {
        if (!statusCell.classList.contains('clickable')) return;
        const target = parseInt(statusCell.dataset.tfStatusStep, 10);
        if (target) tfGoToStep(target);
      });
    }
  }
  // Clamp persisted step to the current mode's step count.
  const max = tfStepCount();
  const cur = Math.max(1, Math.min(max, state.tradeFlow.step || 1));
  if (state.tradeFlow.step !== cur) {
    state.tradeFlow.step = cur;
    saveState();
  }
  tfRenderHeader();
  tfRenderStepper();
  const body = document.getElementById('trade-body');
  if (body) {
    body.innerHTML = tfStepBody(cur);
    tfMountStep(cur);
  }
  tfRenderActions();
}

function tfMountStep(step) {
  const m = (state.tradeFlow && state.tradeFlow.mode) || 'swing';
  if (m === 'swing') {
    const max = tfStepCount();
    if (step > max) step = max;
    if (step < 1) step = 1;
    if (step === 1) tfMountSwingStep2();
    if (step === 2) {
      tfMountSwingStep1();
      tfMountSwingContractSpec();
    }
    if (step === 3) tfMountSwingStep3();
    if (step === 4) tfMountSwingStep4();
    return;
  }
  // Intraday single-screen — every section is in the DOM, mount all of them.
  tfMountIntradayStep1();
  tfMountIntradayStep2();
  tfMountIntradayStep3();
  tfMountIntradayStep4();
}

function tfRefreshHeaderOnly() {
  tfRenderHeader();
  tfRenderStepper();
  tfRenderActions();
}

function tfRefreshAll() {
  // Re-renders step body too. Use only when input focus isn't an issue.
  renderTrade();
}

function tfContinue() {
  if (tfIsSingleScreen()) {
    tfLogIntradayDirect();
    return;
  }
  const cur = state.tradeFlow.step || 1;
  const max = tfStepCount();
  if (cur < max) {
    tfGoToStep(cur + 1);
    return;
  }
  // Last step → GO. Direct log with styled confirm — no native modal.
  const m = state.tradeFlow.mode;
  if (m === 'swing') tfLogSwingDirect();
  else               tfLogIntradayDirect();
}

// Styled confirm dialog. `bodyHtml` is trusted markup we build ourselves —
// not user input — so innerHTML is safe here. Calls onConfirm() if user
// clicks Confirm, drops if user cancels.
function tfShowConfirm({ title = 'Confirm', okLabel = 'Confirm', bodyHtml = '', onConfirm }) {
  const modal = document.getElementById('modal-tf-confirm');
  if (!modal) { if (onConfirm) onConfirm(); return; }
  document.getElementById('tf-confirm-title').textContent = title;
  document.getElementById('tf-confirm-body').innerHTML = bodyHtml;
  const okBtn = document.getElementById('tf-confirm-ok');
  okBtn.textContent = okLabel;

  const cancel = document.getElementById('tf-confirm-cancel');
  const xBtn   = document.getElementById('tf-confirm-x');

  // Replace the click handlers via clone so prior bindings don't pile up.
  const fresh = (el) => { const c = el.cloneNode(true); el.parentNode.replaceChild(c, el); return c; };
  const newOk = fresh(okBtn);
  const newCancel = fresh(cancel);
  const newX = fresh(xBtn);

  const close = () => modal.classList.remove('show');
  newOk.addEventListener('click', () => { close(); if (onConfirm) onConfirm(); });
  newCancel.addEventListener('click', close);
  newX.addEventListener('click', close);

  modal.classList.add('show');
  // Move focus to the OK button so Enter confirms, Esc cancels (browsers'
  // default behavior on dialogs).
  setTimeout(() => { try { newOk.focus(); } catch (_) {} }, 30);
}

// Build a swing trade record from current flow state and log it. Confirms
// first so the user can spot a wrong number before it lands in the journal.
function tfLogSwingDirect() {
  const settings = state.settings || DEFAULT_SETTINGS;
  const isOptions = state.instrument !== 'stocks';
  const premium = Number(state.premium);
  const atr = Number(state.atr);
  const upx = Number(state.underlyingPrice);

  // Sizing: regime risk%, halved for Edge Reversal. Same math as the legacy
  // calc — we replicate it inline to avoid a dependency on the modal.
  let riskPct = (typeof getRiskPctForRegime === 'function')
    ? getRiskPctForRegime(state.regime || 'risk-on') : 0.02;
  if (state.selectedSetup === 'Edge Reversal') riskPct = riskPct / 2;
  const riskDollars = settings.account * riskPct;
  const stopFraction = (settings.stopPct || 50) / 100;
  let contracts = 1;
  let stopUnderlying = null;
  if (isOptions) {
    const maxLossPerContract = premium * stopFraction * 100;
    contracts = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerContract)));
    if (atr > 0 && upx > 0) {
      const dist = atr * 1.5;
      stopUnderlying = +(state.direction === 'short' ? upx + dist : upx - dist).toFixed(2);
    }
  } else {
    const maxLossPerShare = premium * stopFraction;
    contracts = Math.max(1, Math.floor(riskDollars / Math.max(0.01, maxLossPerShare)));
  }

  const ticker = (state.ticker || '').toUpperCase();
  const directionLabel = state.direction === 'short' ? 'Short' : 'Long';
  const regimeText = (typeof REGIME_DATA !== 'undefined' && REGIME_DATA[state.regime])
    ? REGIME_DATA[state.regime].text
    : (state.regime || 'risk-on').toUpperCase();

  if (!ticker || !state.selectedSetup || !premium || premium <= 0) {
    if (typeof toast === 'function') toast('Missing required field — go back and check the inputs.', true);
    return;
  }

  // Build a styled summary for the confirm modal.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const sizeLine = isOptions
    ? `${premium.toFixed(2)} premium × ${contracts} contract${contracts > 1 ? 's' : ''}`
    : `$${premium.toFixed(2)} × ${contracts} share${contracts > 1 ? 's' : ''}`;
  const thesisHtml = state.tradeFlow.thesis
    ? `<div class="tf-confirm-thesis">${esc(state.tradeFlow.thesis)}</div>`
    : `<div class="tf-confirm-thesis empty">Thesis is empty — log anyway?</div>`;
  const bodyHtml = `
    <p style="margin: 0 0 6px;">This trade will be added to the log as <strong>open</strong>.</p>
    <div class="tf-confirm-summary">
      <div class="row"><span class="k">Ticker</span><span>${esc(ticker)}</span></div>
      <div class="row"><span class="k">Setup</span><span>${esc(state.selectedSetup)}</span></div>
      <div class="row"><span class="k">Direction</span><span>${esc(directionLabel)}</span></div>
      <div class="row"><span class="k">Size</span><span>${esc(sizeLine)}</span></div>
      <div class="row"><span class="k">Risk</span><span>$${Math.round(riskDollars)} (${esc(regimeText)})</span></div>
      ${stopUnderlying ? `<div class="row"><span class="k">Underlying stop</span><span>$${stopUnderlying}</span></div>` : ''}
    </div>
    ${thesisHtml}
  `;

  // Capture values needed for the post-confirm path so the closure stays small.
  tfShowConfirm({
    title: `Log ${ticker} ${state.selectedSetup}?`,
    okLabel: 'Confirm & log',
    bodyHtml,
    onConfirm: () => tfLogSwingFinalize({ ticker, directionLabel, premium, contracts, isOptions, stopUnderlying, riskDollars, regimeText }),
  });
}

function tfLogSwingFinalize({ ticker, directionLabel, premium, contracts, isOptions, stopUnderlying, riskDollars, regimeText }) {
  const nowIso = new Date().toISOString();
  const liq = state.liquidity || {};
  const bid = Number(liq.bid);
  const ask = Number(liq.ask);
  const mid = isOptions && bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  const trade = {
    id: (typeof genTradeId === 'function') ? genTradeId() : ('s_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    mode: 'swing',
    instrument: isOptions ? 'options' : 'stocks',
    structure: state.structure || (isOptions ? 'options' : 'stocks'),
    date: new Date().toISOString().split('T')[0],
    ticker,
    setup: state.selectedSetup,
    direction: directionLabel,
    entry: premium,
    contracts,
    shares: isOptions ? null : contracts,
    ivr: (state.ivr === null || state.ivr === undefined) ? null : Number(state.ivr),
    bid: isOptions ? (liq.bid ?? null) : null,
    ask: isOptions ? (liq.ask ?? null) : null,
    mid,
    spreadPct: isOptions ? deriveSpreadPct(liq) : null,
    regime: regimeText,
    thesis: state.tradeFlow.thesis || '',
    premortem: state.tradeFlow.preMortem || '',
    stop: stopUnderlying,
    riskDollars,
    status: 'open',
    exit: null, exit_date: null, grade: null, followed_plan: null,
    emotion: null, exit_reason: null, lesson: null,
    created_at: nowIso, updated_at: nowIso,
  };

  if (!Array.isArray(state.trades)) state.trades = [];
  state.trades.push(trade);
  saveState();
  // Trades are too important to wait the 1.5s debounce — push right now.
  if (typeof doPush === 'function') {
    if (typeof SYNC !== 'undefined' && SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    doPush();
  }

  // Reset the flow and bounce the user to Home so they see the new trade.
  if (typeof resetFlowSilent === 'function') resetFlowSilent();
  state.tradeFlow.step = 1;
  state.tradeFlow.thesis = '';
  state.tradeFlow.preMortem = '';
  saveState();
  if (typeof toast === 'function') toast(`Logged ${ticker} ${state.selectedSetup || ''}`);
  if (typeof renderHome === 'function') renderHome();
  if (typeof renderLogStats === 'function') renderLogStats();
  if (typeof renderLogTable === 'function') renderLogTable();
  if (typeof setTab === 'function') setTab('home');
}

// Wrap the existing intraday logger with a styled confirm prompt, then reset
// the flow's step pointer afterward.
function tfLogIntradayDirect() {
  const it = state.intraday || {};
  const ticker = (it.ticker || '').toUpperCase();
  const st = tfComputeStatus();
  if (st.tone !== 'ready') {
    if (typeof toast === 'function') toast(st.reason || 'Intraday ticket is not ready yet.', true);
    return;
  }
  if (!ticker || !it.setup || !it.entry || !it.stop || !it.target) {
    if (typeof toast === 'function') toast('Missing required field — go back and check.', true);
    return;
  }
  const isOptions = tfIntradayInstrument() !== 'stocks';
  const setupDef   = TRADE_INTRADAY_SETUPS.find(s => s.id === it.setup) || null;
  const setupLabel = setupDef ? setupDef.name : it.setup;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  const dir = (it.direction || '').toUpperCase();
  const orRow = (setupDef && setupDef.isOrb && (it.orHi || it.orLo || it.orRng))
    ? `<div class="row"><span class="k">OR (${esc(it.orbType || '30')}-min)</span><span>HI ${esc(it.orHi || '—')} · LO ${esc(it.orLo || '—')} · RNG ${esc(it.orRng || '—')}</span></div>`
    : '';
  const confluenceLabel = ((TRADE_CONFLUENCE_OPTIONS.find(c => c.id === it.confluence) || {}).label) || '';
  const breadthLabel    = ((TRADE_BREADTH_OPTIONS.find(b => b.id === it.breadth) || {}).label) || '';
  const ctxRow = (confluenceLabel || breadthLabel || it.vwapValue)
    ? `<div class="row"><span class="k">Context</span><span>${[
        confluenceLabel,
        breadthLabel,
        it.vwapValue ? `VWAP ${esc(it.vwapValue)}` : ''
      ].filter(Boolean).map(esc).join(' · ') || '—'}</span></div>`
    : '';
  const optionRows = isOptions ? `
      <div class="row"><span class="k">Bid / Ask</span><span>${it.bid ? '$' + esc(it.bid) : '—'} / ${it.ask ? '$' + esc(it.ask) : '—'}${it.mid ? ` · mid $${esc(it.mid)}` : ''}</span></div>
      <div class="row"><span class="k">Spread</span><span>${it.spreadPct != null ? esc(it.spreadPct) + '%' : '—'}</span></div>
      <div class="row"><span class="k">Contracts</span><span>${it.contracts ? esc(it.contracts) : 'auto'}</span></div>`
    : `<div class="row"><span class="k">Shares</span><span>${it.contracts ? esc(it.contracts) : 'auto'}</span></div>`;
  const bodyHtml = `
    <p style="margin: 0 0 6px;">This intraday trade will be added to the log as <strong>open</strong>.</p>
    <div class="tf-confirm-summary">
      <div class="row"><span class="k">Ticker</span><span>${esc(ticker)}</span></div>
      <div class="row"><span class="k">Instrument</span><span>${isOptions ? 'Options' : 'Stock'}</span></div>
      <div class="row"><span class="k">Setup</span><span>${esc(setupLabel)}</span></div>
      <div class="row"><span class="k">Direction</span><span>${esc(dir)}</span></div>
      <div class="row"><span class="k">Entry</span><span>$${esc(it.entry)}</span></div>
      <div class="row"><span class="k">Stop</span><span>$${esc(it.stop)}</span></div>
      <div class="row"><span class="k">Target</span><span>$${esc(it.target)}</span></div>
      ${optionRows}
      ${orRow}
      ${ctxRow}
    </div>
  `;
  tfShowConfirm({
    title: `Log ${ticker} ${setupLabel}?`,
    okLabel: 'Confirm & log',
    bodyHtml,
    onConfirm: () => {
      if (typeof logIntradayTrade !== 'function') {
        if (typeof toast === 'function') toast('Intraday logging is unavailable.', true);
        return;
      }
      logIntradayTrade();
      state.tradeFlow.step = 1;
      saveState();
      if (typeof setTab === 'function') setTab('home');
    },
  });
}

// ---------- Tabs ----------
function setTab(name) {
  if (name === 'decision' || name === 'intraday') name = 'trade';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  state.activeMode = name;
  saveState();
  // Refresh regime banner so its rules text matches the active mode
  renderRegime();
  // Refresh dynamic content when navigating
  if (name === 'home') renderHome();
  if (name === 'sunday') renderSectors();
  if (name === 'reference') renderReference();
  if (name === 'log') { renderLogStats(); renderLogTable(); }
  if (name === 'trade') renderTrade();
}

// ---------- Ticker Autocomplete (history of traded tickers) ----------
function _buildTickerHistory() {
  // Aggregate from trades + recent
  const map = new Map();
  (state.trades || []).forEach(t => {
    const sym = (t.ticker || '').toUpperCase();
    if (!sym) return;
    const e = map.get(sym) || { sym, count: 0, lastDate: 0, totalPL: 0 };
    e.count += 1;
    const d = t.exit_date || t.date || t.updated_at;
    const ts = d ? new Date(d).getTime() : 0;
    if (ts > e.lastDate) e.lastDate = ts;
    const pl = (typeof calcPL === 'function') ? calcPL(t) : null;
    if (pl != null) e.totalPL += pl;
    map.set(sym, e);
  });
  (state.recentTickers || []).forEach(sym => {
    if (!map.has(sym)) map.set(sym, { sym, count: 0, lastDate: Date.now(), totalPL: 0 });
  });
  return Array.from(map.values()).sort((a, b) => {
    // Most-traded first, then most-recent
    if (b.count !== a.count) return b.count - a.count;
    return b.lastDate - a.lastDate;
  });
}

function rememberTicker(sym) {
  const s = (sym || '').toUpperCase().trim();
  if (!s || s.length > 6) return;
  if (!Array.isArray(state.recentTickers)) state.recentTickers = [];
  // Move-to-front, dedupe, cap at 30
  state.recentTickers = [s, ...state.recentTickers.filter(x => x !== s)].slice(0, 30);
  saveState();
}

// Wire an input to show ticker autocomplete suggestions. Dropdown is rendered as a
// fixed-position element appended to <body>, anchored to the input via getBoundingClientRect.
// This avoids fighting the input's parent layout (flex columns, modals, etc.).
function attachTickerAutocomplete(input, opts = {}) {
  if (!input || input.dataset.acAttached === '1') return;
  input.dataset.acAttached = '1';

  const list = document.createElement('div');
  list.className = 'ticker-ac-list';
  document.body.appendChild(list);

  let activeIdx = -1;
  let items = [];

  function position() {
    const r = input.getBoundingClientRect();
    list.style.left = r.left + 'px';
    list.style.top = (r.bottom + 4) + 'px';
    list.style.minWidth = Math.max(240, r.width) + 'px';
  }
  function show() { position(); list.classList.add('show'); }
  function hide() { list.classList.remove('show'); activeIdx = -1; }

  function renderList(query) {
    const q = (query || '').toUpperCase().trim();
    const all = _buildTickerHistory();
    items = q
      ? all.filter(e => e.sym.startsWith(q)).slice(0, 8)
      : all.slice(0, 8);
    if (!items.length) {
      list.innerHTML = `<div class="ticker-ac-empty">No prior trades${q ? ' for "' + q + '"' : ''} yet.</div>`;
      return;
    }
    const heading = q ? 'Matches' : 'Recent tickers';
    list.innerHTML = `<div class="ticker-ac-section">${heading}</div>` + items.map((e, i) => {
      const plClass = e.totalPL > 0 ? 'pl-pos' : e.totalPL < 0 ? 'pl-neg' : '';
      const plStr = e.count ? `<span class="${plClass}">${e.totalPL >= 0 ? '+' : '-'}$${Math.abs(e.totalPL).toFixed(0)}</span>` : '';
      return `<div class="ticker-ac-item ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
        <span class="ticker-ac-symbol">${e.sym}</span>
        <span class="ticker-ac-meta">
          ${e.count ? `<span>${e.count} trade${e.count === 1 ? '' : 's'}</span>` : '<span>recent</span>'}
          ${plStr}
        </span>
      </div>`;
    }).join('');
  }

  function pick(sym) {
    input.value = sym;
    rememberTicker(sym);
    hide();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof opts.onPick === 'function') opts.onPick(sym);
  }

  // Reposition while shown — covers scroll inside modals, window resize, etc.
  const repos = () => { if (list.classList.contains('show')) position(); };
  window.addEventListener('scroll', repos, true);
  window.addEventListener('resize', repos);

  input.addEventListener('focus', () => { renderList(input.value); show(); });
  input.addEventListener('click', () => { renderList(input.value); show(); });
  input.addEventListener('input', () => { renderList(input.value); show(); });
  input.addEventListener('keydown', e => {
    if (!list.classList.contains('show') || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); renderList(input.value); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderList(input.value); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(items[activeIdx].sym); }
    else if (e.key === 'Escape') hide();
  });
  input.addEventListener('blur', () => {
    setTimeout(hide, 150);
    rememberTicker(input.value);
  });
  list.addEventListener('mousedown', e => {
    const it = e.target.closest('.ticker-ac-item');
    if (it) { e.preventDefault(); pick(items[parseInt(it.dataset.idx, 10)].sym); }
  });
}

// ---------- Init ----------
function init() {
  loadState();

  // Render initial state
  renderHome();
  renderRegime();
  renderPretradeCheck();
  renderLogStats();
  renderLogTable();
  renderSunday();
  renderReference();
  if (typeof renderSectorStatusMini === 'function') renderSectorStatusMini();

  document.getElementById('home-portfolio-toggle')?.addEventListener('click', toggleHomePortfolioView);

  // Context panel — regime cluster click opens the two-in-one panel
  const ctxTrigger = document.getElementById('regime-state');
  if (ctxTrigger) {
    ctxTrigger.style.cursor = 'pointer';
    ctxTrigger.addEventListener('click', openContextPanel);
  }
  // Context panel — close via backdrop, Done button, Escape
  document.getElementById('ctx-backdrop')?.addEventListener('click', closeContextPanel);
  document.getElementById('ctx-close')?.addEventListener('click', closeContextPanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeContextPanel(); });
  // Context panel — regime buttons inside panel
  document.querySelectorAll('.ctx-regime-btn').forEach(b => {
    b.addEventListener('click', () => {
      setRegime(b.dataset.ctxRegime);
      renderContextPanel(); // refresh panel state
    });
  });
  // Context panel — clear sectors
  document.getElementById('ctx-clear-sectors')?.addEventListener('click', () => {
    if (!confirm('Clear all sector ratings?')) return;
    state.sectorRatings = {};
    state.sectorRatedAt = null;
    touchMarketContext();
    saveState();
    renderContextPanel();
    if (typeof renderHome === 'function') renderHome();
    if (typeof renderSectors === 'function') renderSectors();
    if (typeof renderSectorStatusMini === 'function') renderSectorStatusMini();
    toast('Sector grades cleared');
  });

  // Pre-trade mini checks (only manual ones - vix and news)
  document.querySelectorAll('.pretrade-mini[data-check]').forEach(el => {
    el.addEventListener('click', () => togglePretradeCheck(el.dataset.check));
  });

  // Ticker autocomplete for the edit modal. New Trade flow fields are rendered dynamically.
  attachTickerAutocomplete(document.getElementById('t-ticker'));

  document.getElementById('btn-home-new-analysis')?.addEventListener('click', () => {
    setTab('trade');
  });
  document.getElementById('btn-home-log')?.addEventListener('click', () => setTab('log'));
  document.getElementById('brand-home')?.addEventListener('click', () => setTab('home'));

  // Alpha Intel glossary panel — close on backdrop click / × / Esc.
  document.getElementById('ai-glossary-close')?.addEventListener('click', closeAIGlossary);
  document.getElementById('ai-glossary-backdrop')?.addEventListener('click', closeAIGlossary);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const panel = document.getElementById('ai-glossary-panel');
      if (panel && panel.classList.contains('open')) closeAIGlossary();
    }
  });
  // Add trade button
  document.getElementById('btn-add-trade')?.addEventListener('click', () => openTradeModal());
  document.getElementById('btn-add-test-trades')?.addEventListener('click', addTestTrades);
  document.getElementById('btn-export')?.addEventListener('click', exportCSV);

  document.getElementById('btn-export-json')?.addEventListener('click', exportJSON);
  document.getElementById('btn-import-json')?.addEventListener('click', () => document.getElementById('import-json-file')?.click());
  document.getElementById('import-json-file')?.addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });

  // TOS backtest import — buttons are inside re-rendered stats card, so use delegation.
  document.getElementById('panel-log')?.addEventListener('click', (e) => {
    if (e.target.closest('#btn-import-backtest-file')) {
      document.getElementById('backtest-file-input')?.click();
    } else if (e.target.closest('#btn-import-backtest-paste')) {
      importBacktestFromPaste();
    }
  });
  document.getElementById('panel-log')?.addEventListener('change', (e) => {
    if (e.target.id === 'backtest-file-input' && e.target.files[0]) {
      importBacktestFromFile(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Log mode filter
  const logFilter = document.getElementById('log-mode-filter');
  if (logFilter) {
    logFilter.value = state.logModeFilter || 'all';
    logFilter.addEventListener('change', e => {
      state.logModeFilter = e.target.value;
      saveState();
      renderLogStats();
      renderLogTable();
    });
  }
  const logSearch = document.getElementById('log-trade-search');
  if (logSearch) {
    logSearch.value = state.logSearch || '';
    logSearch.placeholder = state.logSetupFilter ? `Filtered: ${state.logSetupFilter}` : 'Filter ticker, setup…';
    logSearch.addEventListener('input', e => {
      state.logSearch = e.target.value || '';
      renderLogTable();
    });
  }

  // Trade modal
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeTradeModal));
  document.getElementById('modal-add').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTradeModal();
  });
  // Position editor modal (Execution Manager + Journal)
  if (typeof _wirePositionEditor === 'function') _wirePositionEditor();
  document.getElementById('btn-save-trade').addEventListener('click', saveTrade);
  document.getElementById('btn-delete-trade').addEventListener('click', deleteTrade);
  document.getElementById('t-mode').addEventListener('change', e => {
    populateTradeModalSetups(e.target.value);
  });
  // Modal-internal Stock vs Option toggle
  document.querySelectorAll('#t-instrument-row .flow-instrument-pill').forEach(btn => {
    btn.addEventListener('click', () => setTradeInstrument(btn.dataset.tInstrument));
  });
  // Bias select mirrors into the legacy direction hidden input
  document.getElementById('t-bias')?.addEventListener('change', e => setTradeBias(e.target.value));

  // Settings modal
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.querySelectorAll('[data-close-settings]').forEach(b => b.addEventListener('click', closeSettings));
  document.getElementById('modal-settings').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettings();
  });
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-reset-settings').addEventListener('click', resetSettingsToDefaults);
  document.getElementById('btn-clear-all-data')?.addEventListener('click', clearAllTradesAndData);

  // Sunday checklists
  document.querySelectorAll('.checklist-item').forEach(el => {
    el.addEventListener('click', () => toggleSunday(el));
  });
  document.getElementById('btn-reset-sunday').addEventListener('click', () => {
    if (confirm('Reset Sunday checklist for next week?')) {
      state.sundayChecks = {};
      saveState();
      renderSunday();
      toast('Sunday checklist reset');
    }
  });

  // Sectors panel
  const clearBtn = document.getElementById('btn-clear-sectors');
  if (clearBtn) clearBtn.addEventListener('click', clearSectors);

  // Restore last-active mode
  if (state.activeMode && ['home','sunday','log','reference','trade'].includes(state.activeMode)) {
    setTab(state.activeMode);
  } else if (state.activeMode === 'decision' || state.activeMode === 'intraday') {
    setTab('trade');
  }

  // ============ SUPABASE SYNC BOOTSTRAP ============
  // Wire auth modal buttons
  document.getElementById('auth-signin-btn')?.addEventListener('click', handleSignIn);
  document.getElementById('auth-signup-btn')?.addEventListener('click', handleSignUp);
  document.getElementById('auth-skip-btn')?.addEventListener('click', handleSkipAuth);
  // Allow Enter to submit the auth form
  ['auth-email','auth-password'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleSignIn();
    });
  });
  document.getElementById('btn-reference')?.addEventListener('click', () => setTab('reference'));
  // Sync pill click
  document.getElementById('sync-pill')?.addEventListener('click', showSyncMenu);
  // Boot the auth flow (async, non-blocking)
  bootstrapAuth();
  // Check for stale backup (≥7 days since last manual JSON export)
  // Delay so it doesn't pop up during initial bootstrap chaos
  setTimeout(checkStaleBackup, 8000);
  // ============ END SUPABASE SYNC BOOTSTRAP ============
}

document.addEventListener('DOMContentLoaded', init);
