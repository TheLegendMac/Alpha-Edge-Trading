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

// ---------- Market: regime, pre-trade check, IVR, liquidity, context panel ----------
// → src/market/regime.js + src/market/context-panel.js

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



// ---------- Intraday Trade Helpers ----------
// todayISO → src/models/formatters.js

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
