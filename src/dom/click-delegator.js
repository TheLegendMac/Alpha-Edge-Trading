// Global click delegator — single document-level click handler that routes
// to the right window.* function based on the clicked element. Previously
// lived as an inline <script> at the bottom of index.html; extracted so the
// build can see it (lint/tree-shake/HMR) and the module loader owns the
// timing.
//
// All handlers go through `window.foo` because the targets are still
// side-effect-registered globals from other modules. The wider window.*
// migration (refactor task #1) will swap these to direct imports.

document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', (e) => {
    if (e.target.closest('.ai-help-btn')) {
      if (typeof window.openAIGlossary === 'function') window.openAIGlossary();
    }
    if (e.target.closest('.log-export-btn') || e.target.closest('#btn-weekly-report')) {
      if (typeof window.exportCSV === 'function') window.exportCSV();
    }
    if (e.target.closest('#btn-export-json')) {
      if (typeof window.exportJSON === 'function') window.exportJSON();
    }
    if (e.target.closest('.log-add-btn') || e.target.closest('#btn-home-new-analysis')) {
      if (typeof window.setTab === 'function') {
        window.setTab('trade');
        if (typeof window.resetFlowSilent === 'function') window.resetFlowSilent();
      }
    }
    if (e.target.closest('#home-portfolio-toggle')) {
      if (typeof window.toggleHomePortfolioView === 'function') window.toggleHomePortfolioView();
    }
    if (e.target.closest('#btn-reset-settings-inline')) {
      if (typeof window.resetSettingsToDefaults === 'function') window.resetSettingsToDefaults();
    }
    if (e.target.closest('.trade-header-reset-btn')) {
      if (typeof window.tfReset === 'function') window.tfReset();
    }
    if (e.target.closest('#sync-pill')) {
      if (typeof window.checkAndCloseSettings === 'function') {
        if (!window.checkAndCloseSettings()) return;
      }
      if (typeof window.showSyncMenu === 'function') window.showSyncMenu();
    }
    if (e.target.closest('#brand-home')) {
      if (typeof window.checkAndCloseSettings === 'function') {
        if (!window.checkAndCloseSettings()) return;
      }
      if (typeof window.closeEditTrade === 'function') window.closeEditTrade();
      if (typeof window.closeTradeModal === 'function') window.closeTradeModal();
      if (typeof window.closePositionEditor === 'function') window.closePositionEditor();
      if (typeof window.closeAIGlossary === 'function') window.closeAIGlossary();
      if (typeof window.closeContextPanel === 'function') window.closeContextPanel();
      if (typeof window.setTab === 'function') window.setTab('home');
    }
  });

  const importBtn = document.getElementById('btn-import-json');
  const importInput = document.getElementById('import-json-file');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (ev) => window.importJSON && window.importJSON(ev));
  }

  const testBtn = document.getElementById('btn-add-test-trades');
  if (testBtn) {
    testBtn.addEventListener('click', () => window.addTestTrades && window.addTestTrades());
  }
});
