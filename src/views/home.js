// Home dashboard — main landing tab. Pulls together account/regime/portfolio summary.

import { state, getRiskPctForRegime } from '../state/store.js';
import { REGIME_DATA } from '../config/constants.js';
import {
  calcPL,
  tradeBias,
  tradeMultiplier,
  tradeQty,
  tradeInstrument,
  tradeRiskDollars,
  calcR,
} from '../models/trade.js';
import { formatDate, todayISO } from '../models/formatters.js';
import { computeRollingPL } from '../intel/rolling.js';
import { saveState } from '../state/persistence.js';
import { buildTradeIndex } from '../models/trade-index.js';
import { esc, attr } from '../dom/html.js';

function renderUniversalSidebar() {
  // Stable function name other modules can call without coupling.
  renderHome();
  window.renderLogStats();
}

function openQty(t) {
  const total = tradeQty(t);
  const closed = Array.isArray(t.executions)
    ? t.executions.reduce((sum, e) => sum + (Number(e.qty) || 0), 0)
    : 0;
  return Math.max(0, total - closed);
}

function openUnrealizedPL(t) {
  const mark = Number(t.mark);
  const entry = Number(t.entry);
  const qty = openQty(t);
  if (!Number.isFinite(mark) || !Number.isFinite(entry) || mark <= 0 || entry <= 0 || qty <= 0) return 0;
  const sign = tradeInstrument(t) === 'stocks' && tradeBias(t) === 'bearish' ? -1 : 1;
  return sign * (mark - entry) * tradeMultiplier(t) * qty;
}

function openRiskDollars(t) {
  const risk = tradeRiskDollars(t);
  const totalQty = tradeQty(t);
  if (!(risk > 0) || !(totalQty > 0)) return risk || 0;
  return risk * (openQty(t) / totalQty);
}

export function renderHome() {
  const today = todayISO();
  const tradeIndex = buildTradeIndex(state.trades || []);
  const closed = tradeIndex.closed;
  const todayClosed = tradeIndex.byExitDate.get(today) || [];
  const todayPL = todayClosed.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const todayR = todayClosed.reduce((s, t) => s + (calcR(t) || 0), 0);
  const wins = closed.filter(t => (calcPL(t) || 0) > 0);
  const losses = closed.filter(t => (calcPL(t) || 0) < 0);
  const winRate = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
  const openTrades = tradeIndex.open;
  const openUnrealized = openTrades.reduce((sum, t) => sum + openUnrealizedPL(t), 0);
  const openUnrealizedR = openTrades.reduce((sum, t) => {
    const risk = tradeRiskDollars(t);
    return risk > 0 ? sum + (openUnrealizedPL(t) / risk) : sum;
  }, 0);
  const sessionPL = todayPL + openUnrealized;
  const sessionR = todayR + openUnrealizedR;
  const maxPositions = state.settings.maxPositions || 0;
  const positionSlotsLeft = Math.max(0, maxPositions - openTrades.length);
  const nextRisk = Math.round((state.settings.account || 10000) * getRiskPctForRegime(state.regime));
  const maxRiskDollars = Math.round((state.settings.account || 10000) * (state.settings.maxRiskPct || 10) / 100);
  const openRisk = openTrades.reduce((sum, t) => sum + openRiskDollars(t), 0);
  const riskBuffer = Math.max(0, Math.round(maxRiskDollars - openRisk));
  const riskBasedTradesLeft = nextRisk > 0 ? Math.floor(riskBuffer / nextRisk) : positionSlotsLeft;
  const tradesLeft = Math.max(0, Math.min(positionSlotsLeft, riskBasedTradesLeft));
  const ratings = Object.values(state.sectorRatings || {}).map(Number).filter(v => Number.isFinite(v));
  const sectorScore = ratings.length ? Math.round(ratings.reduce((s, v) => s + v, 0) / ratings.length / 5 * 100) : null;
  const top3 = window.computeTop3();
  const avoid = window.computeAvoidList();
  const regimeText = REGIME_DATA[state.regime]?.text || 'RISK-ON';
  const positionsOk = openTrades.length < state.settings.maxPositions;
  const riskOk = nextRisk > 0 && riskBuffer >= nextRisk;
  const rolling = computeRollingPL();
  const killActive = rolling.pct <= -7;

  // Money formatter — keeps lines compact and consistent.
  const $ = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(Math.round(v)).toLocaleString()}`;

  // Headline — short punchy phrase for the hero h1. Details go in sub-text.
  let regimeHeadline, headlineTone = '';
  let heroLead = 'Cleared to ', heroAccent = 'trade.', heroStatus = 'STATUS · LIVE';
  if (killActive) {
    regimeHeadline = `Don't trade.`;
    headlineTone = 'risk-off';
    heroLead = `Don't trade. Last ${rolling.days}d down `;
    heroAccent = `${Math.abs(rolling.pct).toFixed(1)}%.`;
    heroStatus = 'KILL SWITCH · ACTIVE';
  } else if (!positionsOk) {
    regimeHeadline = `Position cap full.`;
    headlineTone = 'neutral';
    heroLead = `Position cap full. `;
    heroAccent = `Close one.`;
    heroStatus = 'CAP · LOCKED';
  } else if (!riskOk) {
    regimeHeadline = `Buffer thin.`;
    headlineTone = 'neutral';
    heroLead = `Buffer thin. Next trade clips the `;
    heroAccent = `${state.settings.maxRiskPct}% cap.`;
    heroStatus = 'BUFFER · WATCH';
  } else if (state.regime === 'risk-off') {
    regimeHeadline = `Risk-off.`;
    headlineTone = 'risk-off';
    heroLead = `Defensive. Puts on `;
    heroAccent = `Avoid sectors.`;
    heroStatus = 'RISK OFF · DEFENSIVE';
  } else if (state.regime === 'neutral') {
    regimeHeadline = `Neutral tape.`;
    headlineTone = 'neutral';
    heroLead = `Half size. `;
    heroAccent = `Wait for confirmation.`;
    heroStatus = 'NEUTRAL · HALF SIZE';
  } else {
    regimeHeadline = `Cleared to trade.`;
    headlineTone = '';
    heroLead = `Cleared to `;
    heroAccent = `trade.`;
    heroStatus = 'STATUS · CLEARED';
  }

  // Today-focused bullets. Each line is one breath; the color carries tone.
  const sectorStaleNow = state.sectorRatedAt && window.isSectorRatingStale();
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
    const days = window.daysSinceSectorRating();
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

  // home-intel-text is now the hero sub-paragraph — show slots + risk summary.
  const subText = killActive
    ? `Last ${rolling.days}d: ${$(rolling.totalPL)} · stop trading until rolling P/L above −7%.`
    : `${tradesLeft} slot${tradesLeft === 1 ? '' : 's'} left · next trade $${nextRisk} · buffer $${riskBuffer} of $${maxRiskDollars}`;
  setText('home-intel-text', subText);

  // ========== HERO ==========
  const heroKicker = document.getElementById('home-hero-kicker');
  if (heroKicker) {
    heroKicker.className = `home-hero-kicker ${headlineTone}`;
    const heroStatusEl = document.getElementById('home-hero-status');
    if (heroStatusEl) heroStatusEl.textContent = heroStatus;
  }
  const headline = document.getElementById('home-hero-headline');
  if (headline) headline.className = headlineTone || '';
  setText('home-hero-headline-text', heroLead);
  setText('home-hero-headline-accent', heroAccent);

  const heroMeta = document.getElementById('home-hero-meta');
  if (heroMeta) {
    if (killActive) {
      heroMeta.innerHTML = `Wait for rolling P/L above <strong>-7%</strong>. Open positions still tradable to exit only.`;
    } else if (!positionsOk) {
      heroMeta.innerHTML = `<strong>${openTrades.length} of ${state.settings.maxPositions} slots used</strong> · close a position to free a slot.`;
    } else if (!state.settings.account) {
      heroMeta.innerHTML = `Set your <strong>account size</strong> in Settings to activate the read.`;
    } else {
      heroMeta.innerHTML = `<strong>${tradesLeft} slot${tradesLeft === 1 ? '' : 's'} left</strong> · next trade <strong>$${nextRisk}</strong> · buffer <strong>$${riskBuffer.toLocaleString()}</strong> of $${maxRiskDollars.toLocaleString()}`;
    }
  }

  // ========== Tinted Intel card ==========
  const intelCardEl = document.getElementById('home-intel-card');
  if (intelCardEl) {
    intelCardEl.classList.toggle('risk-off-tint', state.regime === 'risk-off' || killActive);
  }
  const headlineEl = document.getElementById('home-intel-headline');
  if (headlineEl) {
    headlineEl.textContent = regimeHeadline;
    headlineEl.className = `home-hero-headline home-intel-headline ${state._homeHeadlineClass || ''}`;
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

  // ========== 4-stat row ==========
  // Session P/L: format like the design — "+$1,247" with green/red tinting + sub line
  const sessionPlEl = document.getElementById('home-session-pl');
  if (sessionPlEl) {
    const v = `${sessionPL >= 0 ? '+$' : '-$'}${Math.abs(Math.round(sessionPL)).toLocaleString()}`;
    sessionPlEl.textContent = v;
    sessionPlEl.className = `ae-stat-value ${sessionPL > 0 ? 'green' : sessionPL < 0 ? 'red' : ''}`;
  }
  setText('home-session-sub', `${sessionR >= 0 ? '+' : '-'}${Math.abs(sessionR).toFixed(1)}R · realized ${todayPL >= 0 ? '$' : '-$'}${Math.abs(Math.round(todayPL))} · open ${openUnrealized >= 0 ? '$' : '-$'}${Math.abs(Math.round(openUnrealized))}`);

  // New stat card IDs
  setText('home-session-pl', `${sessionPL >= 0 ? '+$' : '-$'}${Math.abs(Math.round(sessionPL)).toLocaleString()}`);
  setText('home-realized', `${todayPL >= 0 ? '+$' : '-$'}${Math.abs(todayPL).toFixed(0)}`);
  setText('home-unrealized', `${openUnrealized >= 0 ? '+$' : '-$'}${Math.abs(openUnrealized).toFixed(0)}`);
  setText('home-win-rate', winRate > 0 ? `${winRate}%` : '—');
  const wrSub = document.getElementById('home-win-rate-sub');
  if (wrSub) wrSub.textContent = closed.length ? `${wins.length} / ${closed.length} closed` : 'all time';
  setText('home-trades-left', tradesLeft > 0 ? String(tradesLeft) : '0');
  const zoneSub = document.getElementById('home-zone');
  if (zoneSub) zoneSub.textContent = `of ${maxPositions} max`;
  setText('home-buffer', `$${riskBuffer.toLocaleString()}`);
  setText('home-risk-unit', `1R = $${nextRisk}`);

  // Status dot colour mirrors headline tone
  const dot = document.getElementById('home-status-dot');
  if (dot) {
    dot.style.background = killActive ? 'var(--red-bright)'
      : state.regime === 'neutral' ? 'var(--amber-bright)'
      : 'var(--green-bright)';
    dot.style.boxShadow = `0 0 8px ${dot.style.background}`;
  }

  // Intel card background tone
  const intelCard = document.getElementById('home-intel-card');
  if (intelCard) intelCard.classList.toggle('risk-off', killActive || state.regime === 'risk-off');

  // Open book meta line
  const meta = document.getElementById('home-openbook-meta');
  if (meta) meta.textContent = openTrades.length
    ? `${openTrades.length} position${openTrades.length === 1 ? '' : 's'} · risk $${Math.round(openRisk)} / $${maxRiskDollars}`
    : '';

  // Legacy compat: keep hidden fields so nothing crashes
  const legacyNextRisk = document.getElementById('home-next-risk');
  if (legacyNextRisk) legacyNextRisk.setAttribute('data-value', nextRisk);
  const legacyProgress = document.getElementById('home-progress-fill');
  if (legacyProgress) legacyProgress.setAttribute('data-pct', Math.max(0, Math.min(100, riskBuffer / Math.max(1, maxRiskDollars) * 100)));

  const progress = document.getElementById('home-progress-fill');
  if (progress) progress.style.width = `${Math.max(0, Math.min(100, riskBuffer / Math.max(1, maxRiskDollars) * 100))}%`;

  const calendar = document.getElementById('home-calendar');
  const title = document.getElementById('home-calendar-title');
  // Local-time ISO formatter — toISOString() shifts to UTC and can land on the
  // wrong calendar date for late-evening trades. We need the user's local day.
  const isoLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  if (calendar) {
    // 2-week rolling view — lazy-default to 0 offset on first render.
    if (typeof state.homeCalendarOffset !== 'number') {
      state.homeCalendarOffset = 0;
    }
    const offset = state.homeCalendarOffset;
    const todayObj = new Date();
    // Find Saturday of the current week
    const currentSat = new Date(todayObj.getFullYear(), todayObj.getMonth(), todayObj.getDate() + (6 - todayObj.getDay()));
    // Apply offset (2 weeks = 14 days)
    currentSat.setDate(currentSat.getDate() + (offset * 14));
    // Start is 13 days before Saturday (previous week's Sunday)
    const startSun = new Date(currentSat.getFullYear(), currentSat.getMonth(), currentSat.getDate() - 13);
    
    const totalCells = 14;

    if (title) {
      const formatOpts = { month: 'short', day: 'numeric' };
      const rangeLabel = `${startSun.toLocaleDateString('en-US', formatOpts)} – ${currentSat.toLocaleDateString('en-US', formatOpts)}`;
      title.innerHTML = `
        <div class="home-calendar-nav" style="display: flex; align-items: center;">
          <button type="button" class="home-cal-arrow" data-cal-arrow="prev" aria-label="Previous 2 weeks">‹</button>
          <span class="home-cal-month" style="font-size: 12px;">${rangeLabel}</span>
          <button type="button" class="home-cal-arrow" data-cal-arrow="next" aria-label="Next 2 weeks">›</button>
          <button type="button" class="home-cal-today" data-cal-today="1" title="Reset to current week" aria-label="Reset calendar to current week">↻</button>
        </div>`;
    }

    const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const headerHtml = weekdays.map(day => `<div class="home-day-dow">${day}</div>`).join('');
    let totalPeriodPL = 0;
    const filterIso = state.homeCalendarFilter || null;

    const cellsHtml = Array.from({ length: totalCells }, (_, i) => {
      const d = new Date(startSun.getFullYear(), startSun.getMonth(), startSun.getDate() + i);
      const iso = isoLocal(d);
      const dayTrades = tradeIndex.byExitDate.get(iso) || [];
      const pl = dayTrades.reduce((s, t) => s + (calcPL(t) || 0), 0);
      totalPeriodPL += pl;
      const isFuture = iso > today;
      let cls = iso === today ? 'active' : pl > 0 ? 'good' : pl < 0 ? 'bad' : '';
      if (isFuture) cls += ' future';
      if (iso === filterIso) cls += ' selected';
      if (dayTrades.length) cls += ' has-trades';
      const plLabel = dayTrades.length ? `<span class="home-day-pl">${pl >= 0 ? '+$' : '-$'}${Math.abs(pl).toFixed(0)}</span>` : '';
      let hoverText = `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
      if (dayTrades.length > 0) {
        hoverText += `\nTrades: ${dayTrades.length}\nP/L: ${pl >= 0 ? '+$' : '-$'}${Math.abs(pl).toFixed(0)}\nClick to filter`;
      } else {
        hoverText += `\nNo trades`;
      }
      return `<button type="button" class="home-day ${attr(cls)}" data-cal-day="${attr(iso)}" title="${attr(hoverText)}"><span class="home-day-num">${d.getDate()}</span>${plLabel}</button>`;
    }).join('');

    const summaryHtml = `
      <div class="home-calendar-summary">
        <div class="home-calendar-legend">
          <span><span class="dot green"></span> Win</span>
          <span><span class="dot red"></span> Loss</span>
          ${filterIso ? `<button type="button" class="home-cal-clear" data-cal-clear="1">Show all trades</button>` : ''}
        </div>
        <div>Period P/L: <span style="color: ${totalPeriodPL >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'}; font-weight: 700;">${totalPeriodPL >= 0 ? '+$' : '-$'}${Math.abs(totalPeriodPL).toFixed(0)}</span></div>
      </div>`;

    calendar.innerHTML = headerHtml + cellsHtml + summaryHtml;

    wireHomeCalendar(title, calendar);
  }

  const empty = document.getElementById('home-portfolio-empty');
  if (empty) {
    const allTrades = (state.trades || []);
    const showingOpen = state.homePortfolioView === 'open';
    const filterIso = state.homeCalendarFilter || null;
    let sourceTrades = showingOpen ? openTrades : allTrades;
    if (filterIso) {
      // Calendar day filter — match either entry date or exit date.
      const daySet = new Set(tradeIndex.byAnyDate.get(filterIso) || []);
      sourceTrades = sourceTrades.filter(t => daySet.has(t));
    }
    const toggle = document.getElementById('home-portfolio-toggle');
    if (toggle) {
      toggle.textContent = showingOpen ? 'Recent activity' : `Open positions (${openTrades.length})`;
      toggle.title = showingOpen ? 'Show recent activity' : 'Show open positions';
    }
    const sourceSet = new Set(sourceTrades);
    const listTrades = tradeIndex.recent.filter(t => sourceSet.has(t)).slice(0, 8);
    // Filter banner — shows the active day filter and a reset button.
    const filterBanner = filterIso ? `
      <div class="home-portfolio-filter">
        <span>Filtered to <strong>${new Date(filterIso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong> · ${sourceTrades.length} trade${sourceTrades.length === 1 ? '' : 's'}</span>
        <button type="button" data-cal-clear="1" class="home-cal-clear">Show all trades</button>
      </div>` : '';
    if (listTrades.length === 0) {
      // Three empty-state branches: filtered (no results), open-only (no positions),
      // or fully empty trade log (offer demo data).
      if (filterIso) {
        empty.innerHTML = `${filterBanner}<div class="home-activity-empty"><div><div style="font-size:28px; color:rgba(139,148,158,0.25);">⌁</div><em>No trades on this day.</em><strong>Pick another day on the calendar</strong></div></div>`;
      } else if (showingOpen) {
        empty.innerHTML = `<div class="home-activity-empty"><div><div style="font-size:28px; color:rgba(139,148,158,0.25);">⌁</div><em>No open positions.</em><strong>Review recent activity</strong></div></div>`;
      } else if (allTrades.length === 0) {
        empty.innerHTML = `
          <div class="home-activity-empty">
            <div>
              <div style="font-size:28px; color:rgba(139,148,158,0.25);">⌁</div>
              <em>No trades logged yet.</em>
              <strong style="margin-bottom: 12px;">Start with a real trade or load sample data</strong>
              <button type="button" class="btn-secondary" data-load-demo="1" style="margin-top: 6px;">Load Demo Data</button>
              <div style="font-size: 11px; color: var(--ink-4); margin-top: 8px;">Generates 30 realistic trades for testing.</div>
            </div>
          </div>`;
      } else {
        empty.innerHTML = `<div class="home-activity-empty"><div><div style="font-size:28px; color:rgba(139,148,158,0.25);">⌁</div><em>Your active session is empty.</em><strong>Launch Alpha Wizard</strong></div></div>`;
      }
      // Wire any clear-filter or load-demo buttons in this branch.
      const clearInBanner = empty.querySelector('[data-cal-clear]');
      if (clearInBanner) clearInBanner.addEventListener('click', e => {
        e.stopPropagation();
        state.homeCalendarFilter = null;
        saveState();
        renderHome();
      });
      const demoBtn = empty.querySelector('[data-load-demo]');
      if (demoBtn) demoBtn.addEventListener('click', () => window.loadDemoData && window.loadDemoData());
    } else {
      empty.innerHTML = filterBanner + listTrades.map(t => {
        const pl = calcPL(t);
        const r = calcR(t);
        const statusClass = t.status === 'open' ? 'open' : pl >= 0 ? 'win' : 'loss';
        const mode = t.mode || 'swing';
        const qtyUnit = tradeInstrument(t) === 'stocks' ? 'sh' : 'ctr';
        const entry = Number(t.entry || 0);
        const mark  = Number(t.mark  || 0);
        const risk  = Math.round(Number(t.riskDollars) || window.tradeRiskDollars(t) || 0);
        const qtyStr = `${tradeQty(t) || 0} ${qtyUnit} @ $${entry.toFixed(2)}`;
        const markStr = mark > 0 ? `mark $${mark.toFixed(2)}` : '';
        const plStr = t.status === 'open'
          ? (mark > 0 ? `${pl >= 0 ? '+$' : '-$'}${Math.abs(pl || 0).toFixed(0)}` : `risk $${risk}`)
          : `${pl >= 0 ? '+$' : '-$'}${Math.abs(pl || 0).toFixed(0)}`;
        const rStr = r !== null && Number.isFinite(r)
          ? `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`
          : (t.status === 'open' ? 'open' : '—');
        return `
          <button class="home-trade-row" type="button" data-review-trade="${attr(t.id)}">
            <span class="home-trade-stripe ${attr(statusClass)}"></span>
            <span class="home-trade-main">
              <span class="home-trade-ticker">${esc(t.ticker || '—')} <span class="status ${attr(statusClass)}">${t.status === 'open' ? 'Open' : t.status === 'win' ? 'Win' : 'Loss'}</span></span>
              <span class="home-trade-meta">${formatDate(t.date)} · <span style="color: var(--${String(t.direction || '').toLowerCase() === 'short' ? 'red-bright' : 'green-bright'});">${esc(t.direction || '—')}</span></span>
            </span>
            <span class="home-trade-mode ${attr(mode)}">${esc(mode)}</span>
            <span class="home-trade-setup">
              ${esc(t.setup || 'No setup')}
              <span class="home-trade-detail">${esc(qtyStr)}</span>
            </span>
            <span class="home-trade-value ${attr(statusClass)}">
              ${esc(plStr)}
              <span class="home-trade-detail">${esc(rStr)}${markStr ? ' · ' + esc(markStr) : ''}</span>
            </span>
            <span class="home-trade-open-dot" style="${t.status !== 'open' ? 'display:none' : ''}">
              <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--cyan);"></span>
              open
            </span>
            <span class="home-trade-action">Review →</span>
          </button>
        `;
      }).join('');
      empty.insertAdjacentHTML('beforeend', !showingOpen && !filterIso && listTrades.length < allTrades.length
        ? `<button class="home-trade-row" type="button" data-home-tab="log" style="grid-template-columns:1fr; justify-items:center;"><span class="home-trade-action">View all ${allTrades.length} trades</span></button>`
        : '');
    }
    wireHomeActivityList(empty);
  }
}

function clearCalendarFilter() {
  state.homeCalendarFilter = null;
  saveState();
  renderHome();
}

function wireHomeCalendar(title, calendar) {
  if (title && title.dataset.homeCalWired !== '1') {
    title.dataset.homeCalWired = '1';
    title.addEventListener('click', e => {
      const todayBtn = e.target.closest('[data-cal-today]');
      if (todayBtn) {
        state.homeCalendarOffset = 0;
        saveState();
        renderHome();
        return;
      }

      const btn = e.target.closest('[data-cal-arrow]');
      if (!btn) return;
          const offset = typeof state.homeCalendarOffset === 'number' ? state.homeCalendarOffset : 0;
      const dir = btn.dataset.calArrow === 'next' ? 1 : -1;
          state.homeCalendarOffset = offset + dir;
      saveState();
      renderHome();
    });
  }
  if (calendar && calendar.dataset.homeCalWired !== '1') {
    calendar.dataset.homeCalWired = '1';
    calendar.addEventListener('click', e => {
      const clear = e.target.closest('[data-cal-clear]');
      if (clear) {
        e.stopPropagation();
        clearCalendarFilter();
        return;
      }
      const cell = e.target.closest('[data-cal-day]');
      if (!cell) return;
      const iso = cell.dataset.calDay;
      state.homeCalendarFilter = (state.homeCalendarFilter === iso) ? null : iso;
      saveState();
      renderHome();
    });
  }
}

function wireHomeActivityList(container) {
  if (!container || container.dataset.homeActivityWired === '1') return;
  container.dataset.homeActivityWired = '1';
  container.addEventListener('click', e => {
    const clear = e.target.closest('[data-cal-clear]');
    if (clear) {
      e.stopPropagation();
      clearCalendarFilter();
      return;
    }
    const demo = e.target.closest('[data-load-demo]');
    if (demo) {
      if (typeof window.loadDemoData === 'function') window.loadDemoData();
      return;
    }
    const review = e.target.closest('[data-review-trade]');
    if (review) {
      if (typeof window.reviewTrade === 'function') window.reviewTrade(review.dataset.reviewTrade);
      return;
    }
    const logTab = e.target.closest('[data-home-tab="log"]');
    if (logTab) {
      if (typeof window.setTab === 'function') window.setTab('log');
      return;
    }
  });
}

function toggleHomePortfolioView() {
  state.homePortfolioView = state.homePortfolioView === 'open' ? 'recent' : 'open';
  saveState();
  renderHome();
}

window.renderUniversalSidebar = renderUniversalSidebar;
window.renderHome = renderHome;
window.clearCalendarFilter = clearCalendarFilter;
window.wireHomeCalendar = wireHomeCalendar;
window.wireHomeActivityList = wireHomeActivityList;
window.toggleHomePortfolioView = toggleHomePortfolioView;
