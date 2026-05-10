// Settings — full-page overlay open/close/save.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS, newIntradayTicket } from '../config/constants.js';

// ── helpers ──────────────────────────────────────────────────────────
function fmt$(n) { return '$' + Math.abs(Math.round(n)).toLocaleString(); }

function updateLiveHints() {
  const acct  = parseFloat(document.getElementById('set-account')?.value) || 50000;
  const rOn   = parseFloat(document.getElementById('set-risk-on-r')?.value) || 0.5;
  const prem  = parseFloat(document.getElementById('set-max-premium')?.value) || 12;
  const risk  = parseFloat(document.getElementById('set-max-risk')?.value) || 6;
  const kill  = parseFloat(document.getElementById('set-killswitch-days')?.value) || 7;
  const dml   = parseFloat(document.getElementById('set-i-max-loss')?.value) || 2;

  const el = (id) => document.getElementById(id);
  if (el('sett-live-equity'))    el('sett-live-equity').textContent    = '$' + acct.toLocaleString();
  if (el('sett-live-base1r'))    el('sett-live-base1r').textContent    = fmt$(acct * rOn / 100);
  if (el('sett-live-cap'))       el('sett-live-cap').textContent       = fmt$(acct * prem / 100);
  if (el('sett-live-cap-sub'))   el('sett-live-cap-sub').textContent   = `of ${fmt$(acct)} · ${prem}%`;
  if (el('sett-live-kill'))      el('sett-live-kill').textContent      = `-${kill.toFixed(1)}%`;
  if (el('sett-hint-base1r'))    el('sett-hint-base1r').textContent    = `+ ${fmt$(acct * rOn / 100)} · 1R`;

  // Regime equiv labels
  const rNeu = parseFloat(document.getElementById('set-risk-neutral-r')?.value) || 0.25;
  const rOff = parseFloat(document.getElementById('set-risk-off-r')?.value) || 0.15;
  if (el('sett-eqv-on'))      el('sett-eqv-on').textContent      = `= ${fmt$(acct * rOn / 100)}`;
  if (el('sett-eqv-neutral')) el('sett-eqv-neutral').textContent = `= ${fmt$(acct * rNeu / 100)}`;
  if (el('sett-eqv-off'))     el('sett-eqv-off').textContent     = `= ${fmt$(acct * rOff / 100)}`;

  // Cap dollar labels
  if (el('sett-live-premium-cap')) el('sett-live-premium-cap').textContent = Math.round(acct * prem / 100).toLocaleString();
  if (el('sett-live-risk-cap'))    el('sett-live-risk-cap').textContent    = Math.round(acct * risk / 100).toLocaleString();

  // Kill equiv
  if (el('sett-kill-eqv'))    el('sett-kill-eqv').textContent    = `= -${fmt$(acct * kill / 100)} on ${fmt$(acct)}`;
  if (el('sett-kill-daily-sub')) el('sett-kill-daily-sub').textContent = `= -${fmt$(acct * dml / 100)}`;

  // Slider fill
  syncSlider('sett-sl-on',      rOn,   0.1, 2,   'on');
  syncSlider('sett-sl-neutral', rNeu,  0.1, 2,   'neutral');
  syncSlider('sett-sl-off',     rOff,  0.1, 2,   'off');
  syncSlider('sett-sl-pos',     parseFloat(document.getElementById('set-max-positions')?.value)||4, 1, 20, 'cap');
  syncSlider('sett-sl-prem',    prem,  5,  100,  'cap');
  syncSlider('sett-sl-risk',    risk,  1,   50,  'cap');
  syncSlider('sett-sl-kill',    kill,  1,   30,  'kill');
}

function syncSlider(sliderId, val, min, max, kind) {
  const sl = document.getElementById(sliderId);
  if (!sl) return;
  sl.value = val;
  const pct = ((val - min) / (max - min) * 100).toFixed(1);
  const colorMap = { on: 'var(--green-bright)', neutral: '#f59e0b', off: 'var(--red-bright)', cap: 'var(--cyan)', kill: '#f59e0b' };
  const c = colorMap[kind] || 'var(--cyan)';
  sl.style.background = `linear-gradient(90deg, ${c} ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
}

function wireSliderInput(sliderId, inputId, min, max, kind, linkedInputId) {
  const sl = document.getElementById(sliderId);
  const inp = document.getElementById(inputId);
  if (!sl || !inp) return;

  sl.addEventListener('input', () => {
    inp.value = sl.value;
    if (linkedInputId) {
      const li = document.getElementById(linkedInputId);
      if (li) li.value = sl.value;
    }
    syncSlider(sliderId, parseFloat(sl.value), min, max, kind);
    updateLiveHints();
  });
  inp.addEventListener('input', () => {
    sl.value = inp.value;
    if (linkedInputId) {
      const li = document.getElementById(linkedInputId);
      if (li) li.value = inp.value;
    }
    syncSlider(sliderId, parseFloat(inp.value), min, max, kind);
    updateLiveHints();
  });
}

// ── open ─────────────────────────────────────────────────────────────
function openSettings() {
  const s = state.settings;
  const el = (id) => document.getElementById(id);

  // Populate all inputs from state
  if (el('set-account'))        el('set-account').value        = s.account        || DEFAULT_SETTINGS.account;
  // Regime risk — new IDs include -r suffix for the new sliders/inputs
  if (el('set-risk-on-r'))      el('set-risk-on-r').value      = s.riskOn         || DEFAULT_SETTINGS.riskOn;
  if (el('set-risk-neutral-r')) el('set-risk-neutral-r').value = s.riskNeutral    || DEFAULT_SETTINGS.riskNeutral;
  if (el('set-risk-off-r'))     el('set-risk-off-r').value     = s.riskOff        || DEFAULT_SETTINGS.riskOff;
  // Also keep old IDs alive for save compat
  if (el('set-risk-on'))        el('set-risk-on').value        = s.riskOn         || DEFAULT_SETTINGS.riskOn;
  if (el('set-risk-neutral'))   el('set-risk-neutral').value   = s.riskNeutral    || DEFAULT_SETTINGS.riskNeutral;
  if (el('set-risk-off'))       el('set-risk-off').value       = s.riskOff        || DEFAULT_SETTINGS.riskOff;

  if (el('set-stop-pct'))       el('set-stop-pct').value       = s.stopPct        || DEFAULT_SETTINGS.stopPct;
  if (el('set-target-pct'))     el('set-target-pct').value     = s.targetPct      || DEFAULT_SETTINGS.targetPct;
  if (el('set-max-positions'))  el('set-max-positions').value  = s.maxPositions   || DEFAULT_SETTINGS.maxPositions;
  if (el('set-max-premium'))    el('set-max-premium').value    = s.maxPremiumPct  || DEFAULT_SETTINGS.maxPremiumPct;
  if (el('set-max-risk'))       el('set-max-risk').value       = s.maxRiskPct     || DEFAULT_SETTINGS.maxRiskPct;
  if (el('set-long-only'))      el('set-long-only').checked    = s.longOnlyMode   || false;
  if (el('set-i-risk'))         el('set-i-risk').value         = s.intradayRiskPerTrade    || DEFAULT_SETTINGS.intradayRiskPerTrade;
  if (el('set-i-max-loss'))     el('set-i-max-loss').value     = s.intradayMaxDailyLoss    || DEFAULT_SETTINGS.intradayMaxDailyLoss;
  if (el('set-i-max-spread'))   el('set-i-max-spread').value   = s.intradayMaxSpreadPct    || DEFAULT_SETTINGS.intradayMaxSpreadPct;
  if (el('set-i-delta'))        el('set-i-delta').checked      = true; // loss-day stop on by default
  if (el('set-killswitch-days')) el('set-killswitch-days').value = s.killSwitchDays || DEFAULT_SETTINGS.killSwitchDays;

  // Wire sliders (only first time — guard with dataset flag)
  const overlay = document.getElementById('modal-settings');
  if (!overlay.dataset.wired) {
    overlay.dataset.wired = '1';
    wireSliderInput('sett-sl-on',      'set-risk-on-r',      0.1, 2,   'on',      'set-risk-on');
    wireSliderInput('sett-sl-neutral', 'set-risk-neutral-r', 0.1, 2,   'neutral', 'set-risk-neutral');
    wireSliderInput('sett-sl-off',     'set-risk-off-r',     0.1, 2,   'off',     'set-risk-off');
    wireSliderInput('sett-sl-pos',     'set-max-positions',  1,   20,  'cap');
    wireSliderInput('sett-sl-prem',    'set-max-premium',    5,   100, 'cap');
    wireSliderInput('sett-sl-risk',    'set-max-risk',       1,   50,  'cap');
    wireSliderInput('sett-sl-kill',    'set-killswitch-days',1,   30,  'kill');

    // account input triggers all hints
    const acctEl = el('set-account');
    if (acctEl) acctEl.addEventListener('input', updateLiveHints);

    // Segment cadence buttons
    overlay.querySelectorAll('[data-cadence]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('[data-cadence]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Sidebar nav highlight on scroll
    const mainScroll = el('sett-main-scroll');
    if (mainScroll) {
      mainScroll.addEventListener('scroll', () => {
        const sections = ['sett-s01','sett-s02','sett-s03','sett-s04'];
        let active = sections[0];
        sections.forEach(id => {
          const sec = el(id);
          if (sec && sec.offsetTop - mainScroll.scrollTop < 200) active = id;
        });
        const navKey = active.replace('sett-s0', 's0');
        overlay.querySelectorAll('[data-sett-nav]').forEach(a => {
          a.classList.toggle('active', a.dataset.settNav === navKey);
        });
      });
    }

    // Smooth scroll nav links
    overlay.querySelectorAll('[data-sett-nav]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const id = 'sett-s0' + a.dataset.settNav.replace('s0','');
        const target = el(id);
        if (target && mainScroll) mainScroll.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' });
      });
    });

    // Long-only toggle label
    const loCheck = el('set-long-only');
    const loLbl   = el('sett-long-only-lbl');
    if (loCheck && loLbl) {
      loCheck.addEventListener('change', () => {
        loLbl.textContent = loCheck.checked ? 'ON' : 'OFF';
        loLbl.className = 'sett-toggle-lbl-sm ' + (loCheck.checked ? 'sett-lbl-on' : '');
      });
    }
  }

  // Update all live hints
  updateLiveHints();

  overlay.classList.add('show');
}

// ── close ─────────────────────────────────────────────────────────────
function closeSettings() {
  document.getElementById('modal-settings')?.classList.remove('show');
}

// ── save ──────────────────────────────────────────────────────────────
function saveSettings() {
  const v = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? (parseFloat(el.value) || fallback) : fallback;
  };
  const vi = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? (parseInt(el.value) || fallback) : fallback;
  };
  const vc = (id) => {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  };

  // Regime risk — read from new -r inputs (which stay synced with old IDs via wireSliderInput)
  const riskOn      = v('set-risk-on-r',      null) || v('set-risk-on',      DEFAULT_SETTINGS.riskOn);
  const riskNeutral = v('set-risk-neutral-r', null) || v('set-risk-neutral', DEFAULT_SETTINGS.riskNeutral);
  const riskOff     = v('set-risk-off-r',     null) || v('set-risk-off',     DEFAULT_SETTINGS.riskOff);

  const newSettings = {
    account:                  v('set-account',      DEFAULT_SETTINGS.account),
    riskOn,
    riskNeutral,
    riskOff,
    stopPct:                  v('set-stop-pct',     DEFAULT_SETTINGS.stopPct),
    targetPct:                v('set-target-pct',   DEFAULT_SETTINGS.targetPct),
    maxPositions:             vi('set-max-positions', DEFAULT_SETTINGS.maxPositions),
    maxPremiumPct:            v('set-max-premium',  DEFAULT_SETTINGS.maxPremiumPct),
    maxRiskPct:               v('set-max-risk',     DEFAULT_SETTINGS.maxRiskPct),
    longOnlyMode:             vc('set-long-only'),
    intradayRiskPerTrade:     v('set-i-risk',       DEFAULT_SETTINGS.intradayRiskPerTrade),
    intradayMaxDailyLoss:     v('set-i-max-loss',   DEFAULT_SETTINGS.intradayMaxDailyLoss),
    intradayMaxSpreadPct:     v('set-i-max-spread', DEFAULT_SETTINGS.intradayMaxSpreadPct),
    intradayDefaultDelta:     v('set-i-delta',      DEFAULT_SETTINGS.intradayDefaultDelta),
    killSwitchDays:           vi('set-killswitch-days', DEFAULT_SETTINGS.killSwitchDays),
  };

  state.settings = newSettings;
  saveState();
  closeSettings();

  // Re-render everything that depends on settings
  if (typeof window.renderHome === 'function')          window.renderHome();
  if (typeof window.renderRegime === 'function')        window.renderRegime();
  if (typeof window.renderPretradeCheck === 'function') window.renderPretradeCheck();
  if (typeof window.renderLogStats === 'function')      window.renderLogStats();
  if (typeof renderReference === 'function')            renderReference();
  if (typeof window.renderTrade === 'function')         window.renderTrade();
  window.toast('Settings saved');
}

// ── reset ─────────────────────────────────────────────────────────────
function resetSettingsToDefaults() {
  if (!confirm('Reset all settings to v3 defaults?')) return;
  state.settings = { ...DEFAULT_SETTINGS };
  openSettings();
  window.toast('Defaults loaded — click Save to apply');
}

// ── clear all ──────────────────────────────────────────────────────────
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
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['i-ticker','i-entry','i-stop','i-target','i-contracts','i-spread','i-vwap-rel','i-notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  const directionInput = document.getElementById('direction-input');
  if (directionInput) directionInput.value = 'long';
  const logFilter = document.getElementById('log-mode-filter');
  if (logFilter) logFilter.value = 'all';

  saveState();
  closeSettings();
  if (typeof window.closeContextPanel === 'function') window.closeContextPanel();
  window.setTab('home');
  if (typeof window.renderHome === 'function')          window.renderHome();
  if (typeof window.renderRegime === 'function')        window.renderRegime();
  if (typeof window.renderPretradeCheck === 'function') window.renderPretradeCheck();
  if (typeof window.renderLogStats === 'function')      window.renderLogStats();
  if (typeof window.renderLogTable === 'function')      window.renderLogTable();
  if (typeof window.renderSectors === 'function')       window.renderSectors();
  if (typeof window.renderSectorStatusMini === 'function') window.renderSectorStatusMini();
  window.toast('All trades and cockpit data cleared');
}

window.openSettings          = openSettings;
window.closeSettings         = closeSettings;
window.saveSettings          = saveSettings;
window.resetSettingsToDefaults = resetSettingsToDefaults;
window.clearAllTradesAndData   = clearAllTradesAndData;
