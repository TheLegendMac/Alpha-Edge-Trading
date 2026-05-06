// Settings modal — open/close/save + danger-zone clear.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS, newIntradayTicket } from '../config/constants.js';

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
  window.renderHome();
  window.renderRegime();
  window.renderPretradeCheck();
  window.renderLogStats();
  renderReference();
  if (typeof window.renderTrade === 'function') window.renderTrade();
  window.toast('Settings saved');
}

function resetSettingsToDefaults() {
  if (!confirm('Reset all settings to v2 defaults?')) return;
  state.settings = { ...DEFAULT_SETTINGS };
  openSettings();  // reload form with defaults
  window.toast('Defaults loaded — click Save to apply');
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
  window.closeContextPanel();
  window.setTab('home');
  window.renderHome();
  window.renderRegime();
  window.renderPretradeCheck();
  window.renderLogStats();
  window.renderLogTable();
  window.renderSectors();
  if (typeof window.renderSectorStatusMini === 'function') window.renderSectorStatusMini();
  window.toast('All trades and cockpit data cleared');
}


window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.saveSettings = saveSettings;
window.resetSettingsToDefaults = resetSettingsToDefaults;
window.clearAllTradesAndData = clearAllTradesAndData;
