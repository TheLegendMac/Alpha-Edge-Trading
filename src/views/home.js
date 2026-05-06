// Home dashboard — main landing tab. Pulls together account/regime/portfolio summary.

import { state, getRiskPctForRegime } from '../state/store.js';
import { REGIME_DATA } from '../config/constants.js';
import {
  isClosedTrade,
  calcPL,
  tradeQty,
  tradeInstrument,
} from '../models/trade.js';
import { formatDate, todayISO } from '../models/formatters.js';
import { computeRollingPL } from '../intel/rolling.js';
import { saveState } from '../state/persistence.js';

function renderUniversalSidebar() {
  // Stable function name other modules can call without coupling.
  renderHome();
  window.renderLogStats();
}


function renderHome() {
  const today = todayISO();
  const closed = (state.trades || []).filter(t => isClosedTrade(t));
  const todayClosed = closed.filter(t => (t.exit_date || t.date) === today);
  const todayPL = todayClosed.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const todayR = todayClosed.reduce((s, t) => s + (window.calcR(t) || 0), 0);
  const wins = closed.filter(t => (calcPL(t) || 0) > 0);
  const losses = closed.filter(t => (calcPL(t) || 0) < 0);
  const winRate = closed.length ? Math.round(wins.length / closed.length * 100) : 0;
  const openTrades = (state.trades || []).filter(t => t.status === 'open');
  const maxPositions = state.settings.maxPositions || 0;
  const positionSlotsLeft = Math.max(0, maxPositions - openTrades.length);
  const nextRisk = Math.round((state.settings.account || 10000) * getRiskPctForRegime(state.regime));
  const maxRiskDollars = Math.round((state.settings.account || 10000) * (state.settings.maxRiskPct || 10) / 100);
  const openRisk = openTrades.reduce((sum, t) => {
    return sum + (Number(t.riskDollars) || window.tradeRiskDollars(t) || 0);
  }, 0);
  const riskBuffer = Math.max(0, Math.round(maxRiskDollars - openRisk));
  const riskBasedTradesLeft = nextRisk > 0 ? Math.floor(riskBuffer / nextRisk) : positionSlotsLeft;
  const tradesLeft = Math.max(0, Math.min(positionSlotsLeft, riskBasedTradesLeft));
  const ratings = Object.values(state.sectorRatings || {}).map(Number).filter(v => Number.isFinite(v));
  const sectorScore = ratings.length ? Math.round(ratings.reduce((s, v) => s + v, 0) / ratings.length / 5 * 100) : null;
  const top3 = window.computeTop3();
  const avoid = window.computeAvoidList();
  const regimeText = REGIME_DATA[state.regime]?.text || 'RISK-ON';
  const positionsOk = openTrades.length < state.settings.maxPositions;
  const riskOk = riskBuffer > nextRisk;
  const rolling = computeRollingPL();
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
        const r = window.calcR(t);
        const statusClass = t.status === 'open' ? 'open' : pl >= 0 ? 'win' : 'loss';
        const valueText = t.status === 'open'
          ? `Risk $${Math.round(Number(t.riskDollars) || window.tradeRiskDollars(t) || 0)}`
          : `${pl >= 0 ? '+$' : '-$'}${Math.abs(pl || 0).toFixed(0)}`;
        const qtyUnit = tradeInstrument(t) === 'stocks' ? 'sh' : 'ctr';
        const detailText = t.status === 'open'
          ? `${tradeQty(t) || 0} ${qtyUnit} @ $${Number(t.entry || 0).toFixed(2)}`
          : `${formatDate(t.exit_date || t.date)}${r !== null ? ` · ${r >= 0 ? '+' : '-'}${Math.abs(r).toFixed(2)}R` : ''}`;
        return `
          <button class="home-trade-row" type="button" onclick="event.stopPropagation(); window.reviewTrade('${t.id}')">
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
        ? `<button class="home-trade-row" type="button" onclick="event.stopPropagation(); window.setTab('log')" style="grid-template-columns:1fr; justify-items:center;"><span class="home-trade-action">View all ${allTrades.length} trades</span></button>`
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

window.renderHome = renderHome;
window.renderUniversalSidebar = renderUniversalSidebar;
window.toggleHomePortfolioView = toggleHomePortfolioView;
