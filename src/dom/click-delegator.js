// Global click delegator — single document-level click handler that routes
// to the right window.* function based on the clicked element. Previously
// lived as an inline <script> at the bottom of index.html; extracted so the
// build can see it (lint/tree-shake/HMR) and the module loader owns the
// timing.
//
// All handlers go through `window.foo` because the targets are still
// side-effect-registered globals from other modules. The wider window.*
// migration (refactor task #1) will swap these to direct imports.

import { openAIGlossary, closeAIGlossary } from '../intel/glossary.js';
import { exportCSV, exportJSON, importJSON } from '../modals/import-export.js';
import { setTab } from '../tabs.js';
import { resetFlowSilent, addTestTrades } from '../modals/trade-modal.js';
import { toggleHomePortfolioView } from '../views/home.js';
import { resetSettingsToDefaults } from '../views/settings.js';
import { tfReset } from '../trade-flow/stepper.js';
import { showSyncMenu } from '../sync/auth-modal.js';
import { closeEditTrade } from '../views/edit-trade.js';
import { closePositionEditor } from '../modals/position-editor.js';
import { closeContextPanel } from '../market/context-panel.js';
document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', (e) => {
    if (e.target.closest('.ai-help-btn')) {
      if (typeof openAIGlossary === 'function') openAIGlossary();
    }
    if (e.target.closest('.log-export-btn') || e.target.closest('#btn-weekly-report')) {
      if (typeof exportCSV === 'function') exportCSV();
    }
    if (e.target.closest('#btn-export-json')) {
      if (typeof exportJSON === 'function') exportJSON();
    }
    if (e.target.closest('.log-add-btn') || e.target.closest('#btn-home-new-analysis')) {
      if (typeof setTab === 'function') {
        setTab('trade');
        if (typeof resetFlowSilent === 'function') resetFlowSilent();
      }
    }
    if (e.target.closest('#home-portfolio-toggle')) {
      if (typeof toggleHomePortfolioView === 'function') toggleHomePortfolioView();
    }
    if (e.target.closest('#btn-reset-settings-inline')) {
      if (typeof resetSettingsToDefaults === 'function') resetSettingsToDefaults();
    }
    if (e.target.closest('.trade-header-reset-btn')) {
      if (typeof tfReset === 'function') tfReset();
    }
    if (e.target.closest('#sync-pill')) {
      if (typeof window.checkAndCloseSettings === 'function') {
        if (!window.checkAndCloseSettings()) return;
      }
      if (typeof showSyncMenu === 'function') showSyncMenu();
    }
    if (e.target.closest('#btn-sync-action')) {
      if (typeof showSyncMenu === 'function') showSyncMenu();
    }
    if (e.target.closest('#brand-home')) {
      if (typeof window.checkAndCloseSettings === 'function') {
        if (!window.checkAndCloseSettings()) return;
      }
      if (typeof closeEditTrade === 'function') closeEditTrade();
      if (typeof window.closeTradeModal === 'function') window.closeTradeModal();
      if (typeof closePositionEditor === 'function') closePositionEditor();
      if (typeof closeAIGlossary === 'function') closeAIGlossary();
      if (typeof closeContextPanel === 'function') closeContextPanel();
      if (typeof setTab === 'function') setTab('home');
    }
  });

  const importBtn = document.getElementById('btn-import-json');
  const importInput = document.getElementById('import-json-file');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (ev) => importJSON && importJSON(ev));
  }

  const testBtn = document.getElementById('btn-add-test-trades');
  if (testBtn) {
    testBtn.addEventListener('click', () => addTestTrades && addTestTrades());
  }
});
