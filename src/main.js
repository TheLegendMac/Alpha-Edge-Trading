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
import '../styles/redesign.css';

// ---------- Config + state ----------
import './config/constants.js';
import './state/store.js';
import './state/persistence.js';
import './dom/html.js';

// ---------- Models ----------
import './models/formatters.js';
import './models/trade.js';
import './models/trade-index.js';

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
import './intel/backtest.js';
import './intel/setup-scorecards.js';
import './intel/weekly-report.js';

// ---------- Views ----------
import './views/home.js';
import './views/log.js';
import './views/sectors.js';
import './views/reference.js';
import './views/settings.js';
import './views/stats.js';
import './views/edit-trade.js';

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
window.setTab = setTab;

// ---------- Bootstrap ----------
// Direct imports for things init() calls immediately. Everything else is
// reached via `window.X` because the module side-effect imports above
// already populated those.
import { state } from './state/store.js';
import { loadState } from './state/persistence.js';

function runSafe(label, fn) {
  try {
    if (typeof fn === 'function') fn();
  } catch (err) {
    console.error(`[bootstrap] ${label} failed`, err);
  }
}

function on(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[bootstrap] Missing #${id}`);
    return null;
  }
  el.addEventListener(event, handler);
  return el;
}

function init() {
  loadState();

  const checkAndCloseSettings = () => {
    const modal = document.getElementById('modal-settings');
    if (modal && modal.classList.contains('show')) {
      if (window._settingsChanged && !confirm('You have unsaved adjustments. Continue without saving?')) return false;
      window._settingsChanged = false;
      if (typeof window.closeSettingsModal === 'function') window.closeSettingsModal();
      else if (typeof window.closeSettings === 'function') window.closeSettings();
    }
    return true;
  };
  window.checkAndCloseSettings = checkAndCloseSettings;

  // Auto-focus ticker input when Trade tab becomes active.
  const tradePanel = document.getElementById('panel-trade');
  if (tradePanel) {
    let wasActive = tradePanel.classList.contains('active');
    const obs = new MutationObserver(m => {
      m.forEach(mut => {
        if (mut.attributeName === 'class') {
          const isActive = tradePanel.classList.contains('active');
          if (isActive && !wasActive) {
            setTimeout(() => {
              const input = document.getElementById('tf-ticker-card-input');
              if (input) input.focus();
            }, 100);
          }
          wasActive = isActive;
        }
      });
    });
    obs.observe(tradePanel, { attributes: true });
  }

  // Wire inline nav tab buttons in the command bar.
  document.querySelectorAll('.cmdbar-nav .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (checkAndCloseSettings()) setTab(btn.dataset.tab);
    });
  });

  // Mobile hamburger menu — toggles a dropdown panel of the same nav items.
  const menuBtn   = document.getElementById('cmdbar-menu-btn');
  const menuPanel = document.getElementById('cmdbar-menu-panel');
  if (menuBtn && menuPanel) {
    const closeMenu = () => {
      menuPanel.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuPanel.setAttribute('aria-hidden', 'true');
    };
    const openMenu = () => {
      menuPanel.classList.add('open');
      menuBtn.setAttribute('aria-expanded', 'true');
      menuPanel.setAttribute('aria-hidden', 'false');
    };
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menuPanel.classList.contains('open') ? closeMenu() : openMenu();
    });
    menuPanel.addEventListener('click', (e) => {
      const item = e.target.closest('[data-menu-tab]');
      if (!item) return;
      if (!checkAndCloseSettings()) return;
      setTab(item.dataset.menuTab);
      closeMenu();
    });
    document.addEventListener('click', (e) => {
      if (!menuPanel.classList.contains('open')) return;
      if (menuPanel.contains(e.target) || menuBtn.contains(e.target)) return;
      closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuPanel.classList.contains('open')) closeMenu();
    });
  }

  // Wire the home actions early. If a later optional renderer fails, these
  // buttons still work and the user can navigate out of the bad state.
  on('brand-home', 'click', () => setTab('home'));

  // Log filter strip — mode tab buttons.
  document.getElementById('log-mode-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-log-mode]');
    if (!btn) return;
    state.logModeFilter = btn.dataset.logMode === 'all' ? '' : btn.dataset.logMode;
    document.querySelectorAll('.log-mode-tab').forEach(b => b.classList.toggle('active', b.dataset.logMode === btn.dataset.logMode));
    if (typeof window.renderLogStats === 'function') window.renderLogStats();
    if (typeof window.renderLogTable === 'function') window.renderLogTable();
  });

  // Context panel — regime cluster click opens the two-in-one panel.
  const ctxTrigger = document.getElementById('regime-state');
  if (ctxTrigger) {
    ctxTrigger.style.cursor = 'pointer';
    ctxTrigger.addEventListener('click', () => {
      if (checkAndCloseSettings() && typeof window.openContextPanel === 'function') window.openContextPanel();
    });
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
    window.toast('Sector grades cleared');
  });

  // Pre-trade mini checks (manual ones — vix and news only).
  document.querySelectorAll('.pretrade-mini[data-check]').forEach(el => {
    el.addEventListener('click', () => window.togglePretradeCheck(el.dataset.check));
  });

  // Ticker autocomplete for the edit modal. New Trade flow fields render dynamically.
  const legacyTickerInput = document.getElementById('t-ticker');
  if (legacyTickerInput) {
    attachTickerAutocomplete(legacyTickerInput);
  }

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
  document.getElementById('btn-add-test-trades')?.addEventListener('click', window.addTestTrades);
  document.getElementById('btn-export')?.addEventListener('click', window.exportCSV);
  document.getElementById('btn-export-json')?.addEventListener('click', window.exportJSON);
  document.getElementById('btn-weekly-report')?.addEventListener('click', window.exportWeeklyReport);
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
  document.getElementById('modal-add')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) window.closeTradeModal();
  });
  // Position editor modal (Execution Manager + Journal).
  if (typeof window._wirePositionEditor === 'function') window._wirePositionEditor();

  // Settings modal.
  window._settingsChanged = false;
  document.getElementById('modal-settings')?.addEventListener('input', () => { window._settingsChanged = true; });

  // Settings sidebar nav (desktop)
  document.querySelectorAll('.sett-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sett-nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // Settings list menu (mobile)
  document.querySelectorAll('.sett-mv-row').forEach(row => {
    row.addEventListener('click', () => {
      const secId = row.dataset.mvSec;
      const sec = document.getElementById(secId);
      if (!sec) return;
      
      document.getElementById('sett-mv').style.display = 'none';
      sec.classList.add('sett-mv-open');
      
      if (!sec.querySelector('.sett-mv-back')) {
        const backBtn = document.createElement('button');
        backBtn.className = 'sett-mv-back';
        backBtn.textContent = '← BACK TO MENU';
        backBtn.type = 'button';
        backBtn.addEventListener('click', () => {
          sec.classList.remove('sett-mv-open');
          document.getElementById('sett-mv').style.display = 'block';
        });
        sec.insertBefore(backBtn, sec.firstChild);
      }
    });
  });
  
  const triggerOpenSettings = () => {
    window._settingsChanged = false;
    if (typeof window.openSettingsModal === 'function') window.openSettingsModal();
    else if (typeof window.openSettings === 'function') window.openSettings();
  };

  document.getElementById('btn-settings')?.addEventListener('click', triggerOpenSettings);

  // Restore the Cmd+K / Ctrl+K keyboard shortcut
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      triggerOpenSettings();
    }
  });

  document.querySelectorAll('[data-close-settings]').forEach(b => b.addEventListener('click', checkAndCloseSettings));
  document.getElementById('modal-settings')?.addEventListener('click', e => { if (e.target === e.currentTarget) checkAndCloseSettings(); });
  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    window._settingsChanged = false;
    if (typeof window.saveSettingsModal === 'function') window.saveSettingsModal();
    else if (typeof window.saveSettings === 'function') window.saveSettings();
  });
  document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
    if (typeof window.resetSettingsToDefaults === 'function') window.resetSettingsToDefaults();
  });
  document.getElementById('btn-clear-all-data')?.addEventListener('click', window.clearAllTradesAndData);

  // Sector ratings now live entirely inside the Market Context panel.

  // Initial render pass. Keep each render isolated so one bad panel cannot
  // prevent button wiring or leave the home screen inert.
  runSafe('renderHome', window.renderHome);
  runSafe('renderRegime', window.renderRegime);
  runSafe('renderPretradeCheck', window.renderPretradeCheck);
  runSafe('renderLogStats', window.renderLogStats);
  runSafe('renderLogTable', window.renderLogTable);
  runSafe('renderReference', window.renderReference);

  // Restore last-active mode.
  if (state.activeMode && ['home','log','stats','reference','trade'].includes(state.activeMode)) {
    runSafe('restoreTab', () => setTab(state.activeMode));
  } else if (state.activeMode === 'decision' || state.activeMode === 'intraday') {
    runSafe('restoreTradeTab', () => setTab('trade'));
  }

  // ============ SUPABASE SYNC BOOTSTRAP ============
  if (typeof window.ensureAuthModal === 'function') window.ensureAuthModal();
  document.getElementById('btn-reference')?.addEventListener('click', () => setTab('reference'));
  // Boot the auth flow (async, non-blocking).
  window.bootstrapAuth();
  // Stale backup nudge — delay so it doesn't pop during initial bootstrap chaos.
  setTimeout(window.checkStaleBackup, 8000);
}

document.addEventListener('DOMContentLoaded', init);
