// Plan tab — live cockpit reading: personalized sizing, setup playbook,
// rule-adherence scorecard, plus the static hard limits + IV-rank rules.

import { state } from '../state/store.js';
import { setState } from '../state/persistence.js';
import { TRADE_SWING_SETUPS, TRADE_INTRADAY_SETUPS } from '../config/constants.js';
import { isClosedTrade, calcPL, calcR, tradeRiskDollars } from '../models/trade.js';
import { setTab } from '../tabs.js';

const REGIMES = [
  { id: 'risk-on',  cls: 'on',   name: 'RISK-ON',  short: 'Risk-On',  dir: 'Long full size · short blocked.',                 context: 'In form · rolling > +5% · sectors leaning.' },
  { id: 'neutral',  cls: 'neut', name: 'NEUTRAL',  short: 'Neutral',  dir: 'Reduced size · both directions · debit spreads.', context: 'Choppy regime · mixed sector ratings.' },
  { id: 'risk-off', cls: 'off',  name: 'RISK-OFF', short: 'Risk-Off', dir: 'Quarter size · long blocked · puts only.',         context: 'Rolling < −7% · kill switch · re-rate to exit.' },
];

function regimePct(regime, s) {
  if (regime === 'neutral')  return s.riskNeutral;
  if (regime === 'risk-off') return s.riskOff;
  return s.riskOn;
}

function fmtPct(pct) {
  return (pct || 0).toFixed(2).replace(/\.?0+$/, '') + '%';
}

function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return `$${v.toLocaleString()}`;
}

export function renderReference() {
  const s = state.settings || {};
  const account = Number(s.account) || 10000;
  const currentRegime = state.regime || 'risk-on';
  const trades = Array.isArray(state.trades) ? state.trades : [];
  const closed = trades.filter(isClosedTrade);
  const open = trades.filter(t => t.status === 'open');
  const maxPos = Number(s.maxPositions) || 4;
  const slotsOpen = Math.max(0, maxPos - open.length);

  // ── Hero account label + stats ───────────────────────────
  const acctLabel = document.getElementById('ref-account-label');
  if (acctLabel) acctLabel.textContent = `ACCOUNT ${fmtMoney(account)}`;

  const heroStats = document.getElementById('ref-hero-stats');
  if (heroStats) {
    const curR = Math.round(account * regimePct(currentRegime, s) / 100);
    const reg = REGIMES.find(r => r.id === currentRegime) || REGIMES[0];
    const adherenceScore = computeAdherenceScore(closed);
    heroStats.innerHTML = `
      <div class="ref-hero-stat">
        <div class="ref-hero-stat-lbl">Regime now</div>
        <div class="ref-hero-stat-val regime-${reg.cls}">${reg.short}</div>
      </div>
      <div class="ref-hero-stat">
        <div class="ref-hero-stat-lbl">1R today</div>
        <div class="ref-hero-stat-val">${fmtMoney(curR)}</div>
      </div>
      <div class="ref-hero-stat">
        <div class="ref-hero-stat-lbl">Slots open</div>
        <div class="ref-hero-stat-val">${slotsOpen} / ${maxPos}</div>
      </div>
      <div class="ref-hero-stat">
        <div class="ref-hero-stat-lbl">Adherence</div>
        <div class="ref-hero-stat-val ${adherenceScore.tone}">${adherenceScore.pct}</div>
      </div>
    `;
  }

  // ── Live sizing (centerpiece: current regime hero card + other 2 sidekicks) ──
  const sizing = document.getElementById('ref-sizing-content');
  const sizingMeta = document.getElementById('ref-sizing-meta');
  if (sizing) {
    const current = REGIMES.find(r => r.id === currentRegime) || REGIMES[0];
    const others = REGIMES.filter(r => r.id !== currentRegime);
    if (sizingMeta) sizingMeta.textContent = `CURRENT: ${current.name} · ${fmtPct(regimePct(current.id, s))} PER TRADE`;

    const curPct = regimePct(current.id, s);
    const curR = Math.round(account * curPct / 100);
    const curCard = `
      <div class="ref-sizing-hero ${current.cls}">
        <div class="ref-sizing-hero-top">
          <span class="ref-sizing-hero-dot"></span>
          <span class="ref-sizing-hero-name">${current.name}</span>
          <span class="ref-sizing-hero-tag">CURRENT</span>
        </div>
        <div class="ref-sizing-hero-amount">${fmtMoney(curR)}</div>
        <div class="ref-sizing-hero-pct">${fmtPct(curPct)} of equity per trade · 1R</div>
        <div class="ref-sizing-hero-dir">${current.dir}</div>
        <div class="ref-sizing-hero-actions">
          <button class="ref-cta swing" type="button" data-ref-start="swing">+ Swing trade</button>
          <button class="ref-cta intraday" type="button" data-ref-start="intraday">+ Intraday trade</button>
        </div>
      </div>`;

    const otherCards = others.map(r => {
      const dollars = Math.round(account * regimePct(r.id, s) / 100);
      return `
        <div class="ref-sizing-mini ${r.cls}">
          <div class="ref-sizing-mini-top">
            <span class="ref-sizing-mini-dot"></span>
            <span class="ref-sizing-mini-name">${r.name}</span>
          </div>
          <div class="ref-sizing-mini-amount">${fmtMoney(dollars)}</div>
          <div class="ref-sizing-mini-pct">${fmtPct(regimePct(r.id, s))} · 1R</div>
        </div>`;
    }).join('');

    sizing.innerHTML = curCard + `<div class="ref-sizing-others">${otherCards}</div>`;
  }

  // ── Setup playbook ──────────────────────────────────────
  const playbookGrid = document.getElementById('ref-playbook-grid');
  const playbookTabs = document.querySelectorAll('.ref-playbook-tab');
  const activeMode = state.referencePlaybookMode || 'swing';
  playbookTabs.forEach(b => b.classList.toggle('active', b.dataset.playbookMode === activeMode));
  if (playbookGrid) {
    const setups = activeMode === 'intraday' ? TRADE_INTRADAY_SETUPS : TRADE_SWING_SETUPS;
    playbookGrid.innerHTML = setups.map(setup => {
      const peers = closed.filter(t => (t.setup === setup.id || t.setup === setup.name));
      const wins = peers.filter(t => calcPL(t) > 0).length;
      const wr = peers.length ? Math.round(wins / peers.length * 100) : null;
      const avgR = peers.length
        ? peers.reduce((a, t) => a + (calcR(t) || 0), 0) / peers.length
        : null;
      const totalPL = peers.reduce((a, t) => a + (calcPL(t) || 0), 0);
      const wrStr = wr === null ? '—' : `${wr}%`;
      const rStr = avgR === null ? '—' : `${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R`;
      const plStr = peers.length ? `${totalPL >= 0 ? '+' : '−'}${fmtMoney(Math.abs(totalPL))}` : '—';
      const biasClass = setup.bias === 'short' ? 'short' : setup.bias === 'either' ? 'either' : 'long';
      const biasLabel = setup.bias === 'short' ? 'SHORT' : setup.bias === 'either' ? 'BOTH' : 'LONG';
      const rTone = avgR === null ? '' : (avgR >= 0.3 ? 'good' : avgR >= 0 ? 'mixed' : 'bad');
      return `
        <div class="ref-setup-card" data-bias="${biasClass}">
          <div class="ref-setup-top">
            <span class="ref-setup-num">${setup.num}</span>
            <span class="ref-setup-bias ${biasClass}">${biasLabel}</span>
            ${setup.halfSize ? '<span class="ref-setup-tag">HALF SIZE</span>' : ''}
          </div>
          <div class="ref-setup-name">${setup.name}</div>
          <div class="ref-setup-desc">${setup.desc}</div>
          <div class="ref-setup-stats">
            <div class="ref-setup-stat">
              <span class="ref-setup-stat-lbl">Trades</span>
              <span class="ref-setup-stat-val">${peers.length}</span>
            </div>
            <div class="ref-setup-stat">
              <span class="ref-setup-stat-lbl">Win rate</span>
              <span class="ref-setup-stat-val">${wrStr}</span>
            </div>
            <div class="ref-setup-stat">
              <span class="ref-setup-stat-lbl">Avg R</span>
              <span class="ref-setup-stat-val ${rTone}">${rStr}</span>
            </div>
            <div class="ref-setup-stat">
              <span class="ref-setup-stat-lbl">Net P/L</span>
              <span class="ref-setup-stat-val">${plStr}</span>
            </div>
          </div>
          <button class="ref-setup-cta" type="button" data-ref-start="${activeMode}" data-ref-setup="${setup.id}">+ New trade</button>
        </div>`;
    }).join('');
  }

  // ── Rule adherence scorecard ─────────────────────────────
  const adherence = document.getElementById('ref-adherence-grid');
  const adherenceMeta = document.getElementById('ref-adherence-meta');
  if (adherence) {
    const sample = closed.slice(-30);
    if (adherenceMeta) adherenceMeta.textContent = `LAST ${sample.length} CLOSED TRADES`;
    const rows = computeAdherenceRows(sample, s);
    if (sample.length === 0) {
      adherence.innerHTML = `<div class="ref-adherence-empty">Log a few closed trades — this scorecard fills in once you have history.</div>`;
    } else {
      adherence.innerHTML = rows.map(r => `
        <div class="ref-adherence-card ${r.tone}">
          <div class="ref-adherence-card-top">
            <span class="ref-adherence-card-lbl">${r.label}</span>
            <span class="ref-adherence-card-pct">${r.pct}</span>
          </div>
          <div class="ref-adherence-card-bar"><span style="width:${r.fill}%"></span></div>
          <div class="ref-adherence-card-sub">${r.sub}</div>
        </div>`).join('');
    }
  }

  // ── Hard limits ─────────────────────────────────────────
  const caps = document.getElementById('ref-caps-list');
  if (caps) {
    const rows = [
      { key: `max ${s.maxPositions}`, keyClass: 'amber', val: 'Open positions',           detail: 'Across swing and intraday combined.' },
      { key: `${s.stopPct}%`,         keyClass: 'amber', val: 'Stop loss · premium paid', detail: 'Hard cut on options; equities use technical stop.' },
      { key: `+${s.targetPct}%`,      keyClass: 'green', val: 'Profit target',            detail: 'Default exit — adjust per setup playbook.' },
      { key: '15:55',                 keyClass: 'cyan',  val: 'Intraday cut time',        detail: 'Hard close · no overnight positions intraday.' },
    ];
    caps.innerHTML = rows.map((r, i) => `
      <li>
        <span class="ref-key ${r.keyClass}">${r.key}</span>
        <div class="ref-val">${r.val}<span>${r.detail}</span></div>
        <span class="ref-caps-rule-num">RULE ${String(i + 1).padStart(2, '0')}</span>
      </li>`).join('');
  }

  // ── Wire event handlers (once) ───────────────────────────
  wireReferenceHandlers();
}

// Compute the four scorecard rows from last N closed trades.
function computeAdherenceRows(closed, settings) {
  const n = closed.length;
  if (!n) return [];

  // 1. Sized within rules — risk dollars under 1.25× current 1R cap
  const account = Number(settings.account) || 10000;
  const cap = Math.max(1, account * Math.max(settings.riskOn, settings.riskNeutral, settings.riskOff) / 100);
  const sized = closed.filter(t => {
    const r = Number(t.riskDollars) || tradeRiskDollars(t) || 0;
    return r > 0 && r <= cap * 1.25;
  }).length;

  // 2. Followed a setup — has a logged setup name
  const setupOk = closed.filter(t => t.setup && String(t.setup).trim() && t.setup !== 'No setup').length;

  // 3. Closed at plan — exit reason is target or stop, not discretionary
  const planExit = closed.filter(t => {
    const reason = String(t.exitReason || t.exit_reason || '').toLowerCase();
    return reason === 'target' || reason === 'stop' || reason === 'expiry';
  }).length;
  // If no exitReason captured at all, derive from R: hit target (R>=1.5) or stop (R<=-0.8)
  const derivedPlanExit = closed.filter(t => {
    const reason = String(t.exitReason || t.exit_reason || '').toLowerCase();
    if (reason) return false; // already counted above
    const r = calcR(t);
    return r !== null && (r >= 1.5 || r <= -0.8);
  }).length;
  const planExitCount = planExit + derivedPlanExit;

  // 4. Process quality — `processGrade` field (Good/Okay/Bad). Falls back to "all good" if not graded.
  const graded = closed.filter(t => t.processGrade);
  const good = graded.filter(t => String(t.processGrade).toLowerCase() === 'good').length;
  const processPct = graded.length ? Math.round(good / graded.length * 100) : null;

  const row = (count, label, sub) => {
    const pct = Math.round(count / n * 100);
    const tone = pct >= 80 ? 'good' : pct >= 60 ? 'mixed' : 'bad';
    return { label, pct: `${pct}%`, fill: pct, sub, tone };
  };

  const rows = [
    row(sized, 'Sized within rules', `${sized}/${n} risked ≤ regime cap`),
    row(setupOk, 'Followed a setup', `${setupOk}/${n} logged with a setup`),
    row(planExitCount, 'Closed at plan', `${planExitCount}/${n} hit target or stop`),
  ];
  if (processPct !== null) {
    rows.push({
      label: 'Process quality',
      pct: `${processPct}%`,
      fill: processPct,
      sub: `${good}/${graded.length} graded "Good"`,
      tone: processPct >= 80 ? 'good' : processPct >= 60 ? 'mixed' : 'bad',
    });
  } else {
    rows.push({
      label: 'Process quality',
      pct: '—',
      fill: 0,
      sub: 'Grade trades in Edit to track this.',
      tone: 'idle',
    });
  }
  return rows;
}

function computeAdherenceScore(closed) {
  if (!closed.length) return { pct: '—', tone: 'idle' };
  const sample = closed.slice(-30);
  const rows = computeAdherenceRows(sample, state.settings || {});
  const scored = rows.filter(r => r.fill > 0 || r.pct !== '—');
  if (!scored.length) return { pct: '—', tone: 'idle' };
  const avg = Math.round(scored.reduce((a, r) => a + r.fill, 0) / scored.length);
  const tone = avg >= 80 ? 'good' : avg >= 60 ? 'mixed' : 'bad';
  return { pct: `${avg}%`, tone };
}

let handlersWired = false;
function wireReferenceHandlers() {
  if (handlersWired) return;
  handlersWired = true;
  const panel = document.getElementById('panel-reference');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    // Mode tabs
    const tab = e.target.closest('[data-playbook-mode]');
    if (tab) {
      state.referencePlaybookMode = tab.dataset.playbookMode;
      renderReference();
      return;
    }
    // Quick-start trade buttons
    const start = e.target.closest('[data-ref-start]');
    if (start) {
      const mode = start.dataset.refStart;
      const setupId = start.dataset.refSetup || '';
      if (!state.tradeFlow) state.tradeFlow = {};
      state.tradeFlow.mode = mode;
      state.tradeFlow.step = 1;
      if (setupId) {
        if (mode === 'swing') {
          state.selectedSetup = setupId;
        } else {
          if (!state.intraday) state.intraday = {};
          state.intraday.setup = setupId;
        }
      }
      setState({});
      setTab('trade');
    }
  });
}
