// Alpha Edge Trading — module entry. Wires every module's side effects (which
// register their exports on `window` for inline onclick handlers in markup),
// then runs the bootstrap on DOMContentLoaded.

// ---------- Styles ----------
import '../styles/tokens.css';
import '../styles/theme.css';
import '../styles/layout.css';
import '../styles/command-bar.css';
import '../styles/forms.css';
import '../styles/cards.css';
import '../styles/tables.css';
import '../styles/modals.css';
import '../styles/workflow.css';
import '../styles/panels.css';
import '../styles/utilities.css';
import '../styles/print.css';

// ---------- Config + state ----------
import './config/constants.js';
import './state/store.js';
import './state/persistence.js';

// ---------- Models ----------
import './models/formatters.js';
import './models/trade.js';

// ---------- Sync ----------
import './sync/merge.js';
import './sync/supabase.js';
import './sync/auth-modal.js';

// ---------- Market ----------
import './market/regime.js';
import './market/context-panel.js';

// ---------- Intel ----------
import './intel/glossary.js';
import './intel/rolling.js';
import './intel/alpha.js';
import './intel/clt-card.js';
import './intel/backtest.js';

// ---------- Views ----------
import './views/home.js';
import './views/log.js';
import './views/sunday.js';
import './views/reference.js';
import './views/settings.js';

// ---------- Modals ----------
import './modals/toast.js';
import './modals/import-export.js';
import './modals/position-editor.js';
import './modals/trade-modal.js';

// ---------- Trade flow ----------
import './trade-flow/intraday-helpers.js';
import './trade-flow/gates.js';
import './trade-flow/ticker-memory.js';
import './trade-flow/summary.js';
import './trade-flow/risk.js';
import './trade-flow/swing-sizing.js';
import './trade-flow/intraday-sizing.js';
import './trade-flow/stepper.js';
import './trade-flow/swing-steps.js';
import './trade-flow/intraday-steps.js';

// ---------- Tabs + autocomplete ----------
import { setTab, attachTickerAutocomplete } from './tabs.js';

// ---------- Bootstrap ----------
// Direct imports for things init() calls immediately. Everything else is
// reached via `window.X` because the module side-effect imports above
// already populated those.
import { state } from './state/store.js';
import { loadState } from './state/persistence.js';

function init() {
  loadState();

  // Initial render pass.
  window.renderHome();
  window.renderRegime();
  window.renderPretradeCheck();
  window.renderLogStats();
  window.renderLogTable();
  window.renderSunday();
  window.renderReference();
  if (typeof window.renderSectorStatusMini === 'function') window.renderSectorStatusMini();

  document.getElementById('home-portfolio-toggle')?.addEventListener('click', window.toggleHomePortfolioView);

  // Context panel — regime cluster click opens the two-in-one panel.
  const ctxTrigger = document.getElementById('regime-state');
  if (ctxTrigger) {
    ctxTrigger.style.cursor = 'pointer';
    ctxTrigger.addEventListener('click', window.openContextPanel);
  }
  document.getElementById('ctx-backdrop')?.addEventListener('click', window.closeContextPanel);
  document.getElementById('ctx-close')?.addEventListener('click', window.closeContextPanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeContextPanel(); });
  document.querySelectorAll('.ctx-regime-btn').forEach(b => {
    b.addEventListener('click', () => {
      window.setRegime(b.dataset.ctxRegime);
      window.renderContextPanel();
    });
  });
  document.getElementById('ctx-clear-sectors')?.addEventListener('click', () => {
    if (!confirm('Clear all sector ratings?')) return;
    state.sectorRatings = {};
    state.sectorRatedAt = null;
    window.touchMarketContext();
    window.saveState();
    window.renderContextPanel();
    if (typeof window.renderHome === 'function') window.renderHome();
    if (typeof window.renderSectors === 'function') window.renderSectors();
    if (typeof window.renderSectorStatusMini === 'function') window.renderSectorStatusMini();
    window.toast('Sector grades cleared');
  });

  // Pre-trade mini checks (manual ones — vix and news only).
  document.querySelectorAll('.pretrade-mini[data-check]').forEach(el => {
    el.addEventListener('click', () => window.togglePretradeCheck(el.dataset.check));
  });

  // Ticker autocomplete for the edit modal. New Trade flow fields render dynamically.
  attachTickerAutocomplete(document.getElementById('t-ticker'));

  document.getElementById('btn-home-new-analysis')?.addEventListener('click', () => setTab('trade'));
  document.getElementById('btn-home-log')?.addEventListener('click', () => setTab('log'));
  document.getElementById('brand-home')?.addEventListener('click', () => setTab('home'));

  // Alpha Intel glossary panel — close on backdrop click / × / Esc.
  document.getElementById('ai-glossary-close')?.addEventListener('click', window.closeAIGlossary);
  document.getElementById('ai-glossary-backdrop')?.addEventListener('click', window.closeAIGlossary);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const panel = document.getElementById('ai-glossary-panel');
      if (panel && panel.classList.contains('open')) window.closeAIGlossary();
    }
  });

  // Add trade.
  document.getElementById('btn-add-trade')?.addEventListener('click', () => window.openTradeModal());
  document.getElementById('btn-add-test-trades')?.addEventListener('click', window.addTestTrades);
  document.getElementById('btn-export')?.addEventListener('click', window.exportCSV);
  document.getElementById('btn-export-json')?.addEventListener('click', window.exportJSON);
  document.getElementById('btn-import-json')?.addEventListener('click', () => document.getElementById('import-json-file')?.click());
  document.getElementById('import-json-file')?.addEventListener('change', e => {
    if (e.target.files[0]) window.importJSON(e.target.files[0]);
    e.target.value = '';
  });

  // TOS backtest import — buttons are inside re-rendered stats card, so use delegation.
  document.getElementById('panel-log')?.addEventListener('click', e => {
    if (e.target.closest('#btn-import-backtest-file')) {
      document.getElementById('backtest-file-input')?.click();
    } else if (e.target.closest('#btn-import-backtest-paste')) {
      window.importBacktestFromPaste();
    }
  });
  document.getElementById('panel-log')?.addEventListener('change', e => {
    if (e.target.id === 'backtest-file-input' && e.target.files[0]) {
      window.importBacktestFromFile(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Log mode filter + search.
  const logFilter = document.getElementById('log-mode-filter');
  if (logFilter) {
    logFilter.value = state.logModeFilter || 'all';
    logFilter.addEventListener('change', e => {
      state.logModeFilter = e.target.value;
      window.saveState();
      window.renderLogStats();
      window.renderLogTable();
    });
  }
  const logSearch = document.getElementById('log-trade-search');
  if (logSearch) {
    logSearch.value = state.logSearch || '';
    logSearch.placeholder = state.logSetupFilter ? `Filtered: ${state.logSetupFilter}` : 'Filter ticker, setup…';
    logSearch.addEventListener('input', e => {
      state.logSearch = e.target.value || '';
      window.renderLogTable();
    });
  }

  // Trade modal.
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', window.closeTradeModal));
  document.getElementById('modal-add').addEventListener('click', e => {
    if (e.target === e.currentTarget) window.closeTradeModal();
  });
  // Position editor modal (Execution Manager + Journal).
  if (typeof window._wirePositionEditor === 'function') window._wirePositionEditor();
  document.getElementById('btn-save-trade').addEventListener('click', window.saveTrade);
  document.getElementById('btn-delete-trade').addEventListener('click', window.deleteTrade);
  document.getElementById('t-mode').addEventListener('change', e => {
    window.populateTradeModalSetups(e.target.value);
  });
  document.querySelectorAll('#t-instrument-row .flow-instrument-pill').forEach(btn => {
    btn.addEventListener('click', () => window.setTradeInstrument(btn.dataset.tInstrument));
  });
  document.getElementById('t-bias')?.addEventListener('change', e => window.setTradeBias(e.target.value));

  // Settings modal.
  document.getElementById('btn-settings').addEventListener('click', window.openSettings);
  document.querySelectorAll('[data-close-settings]').forEach(b => b.addEventListener('click', window.closeSettings));
  document.getElementById('modal-settings').addEventListener('click', e => {
    if (e.target === e.currentTarget) window.closeSettings();
  });
  document.getElementById('btn-save-settings').addEventListener('click', window.saveSettings);
  document.getElementById('btn-reset-settings').addEventListener('click', window.resetSettingsToDefaults);
  document.getElementById('btn-clear-all-data')?.addEventListener('click', window.clearAllTradesAndData);

  // Sunday checklists.
  document.querySelectorAll('.checklist-item').forEach(el => {
    el.addEventListener('click', () => window.toggleSunday(el));
  });
  document.getElementById('btn-reset-sunday').addEventListener('click', () => {
    if (confirm('Reset Sunday checklist for next week?')) {
      state.sundayChecks = {};
      window.saveState();
      window.renderSunday();
      window.toast('Sunday checklist reset');
    }
  });

  // Sectors panel.
  const clearBtn = document.getElementById('btn-clear-sectors');
  if (clearBtn) clearBtn.addEventListener('click', window.clearSectors);

  // Restore last-active mode.
  if (state.activeMode && ['home','sunday','log','reference','trade'].includes(state.activeMode)) {
    setTab(state.activeMode);
  } else if (state.activeMode === 'decision' || state.activeMode === 'intraday') {
    setTab('trade');
  }

  // ============ SUPABASE SYNC BOOTSTRAP ============
  document.getElementById('auth-signin-btn')?.addEventListener('click', window.handleSignIn);
  document.getElementById('auth-signup-btn')?.addEventListener('click', window.handleSignUp);
  document.getElementById('auth-skip-btn')?.addEventListener('click', window.handleSkipAuth);
  ['auth-email','auth-password'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') window.handleSignIn();
    });
  });
  document.getElementById('btn-reference')?.addEventListener('click', () => setTab('reference'));
  document.getElementById('sync-pill')?.addEventListener('click', window.showSyncMenu);
  // Boot the auth flow (async, non-blocking).
  window.bootstrapAuth();
  // Stale backup nudge — delay so it doesn't pop during initial bootstrap chaos.
  setTimeout(window.checkStaleBackup, 8000);
}

document.addEventListener('DOMContentLoaded', init);
