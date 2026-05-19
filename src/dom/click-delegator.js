// Global click delegator — handles clicks for selector-based targets
// (classes, dynamically rendered children) that can't be wired directly in
// main.js. Direct ID-based wiring lives in main.js as the single source.

import { setTab } from '../tabs.js';
import { resetFlowSilent } from '../modals/trade-modal.js';
import { toggleHomePortfolioView } from '../views/home.js';
import { resetSettingsToDefaults } from '../views/settings.js';
import { tfReset } from '../trade-flow/stepper.js';
import { showSyncMenu } from '../sync/auth-modal.js';
import { closeEditTrade } from '../views/edit-trade.js';
import { closePositionEditor } from '../modals/position-editor.js';
import { closeContextPanel } from '../market/context-panel.js';
import { exportCSV } from '../modals/import-export.js';

document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', (e) => {
    // Class-based (dynamically rendered, can't be wired by ID in main.js)
    if (e.target.closest('.log-export-btn')) {
      exportCSV();
      return;
    }
    if (e.target.closest('.log-add-btn') || e.target.closest('#btn-home-new-analysis')) {
      setTab('trade');
      resetFlowSilent();
      return;
    }
    if (e.target.closest('#home-portfolio-toggle')) {
      toggleHomePortfolioView();
      return;
    }
    if (e.target.closest('#btn-reset-settings-inline')) {
      resetSettingsToDefaults();
      return;
    }
    if (e.target.closest('.trade-header-reset-btn')) {
      tfReset();
      return;
    }
    if (e.target.closest('#sync-pill') || e.target.closest('#btn-sync-action')) {
      if (typeof window.checkAndCloseSettings === 'function' && !window.checkAndCloseSettings()) return;
      showSyncMenu();
      return;
    }
    if (e.target.closest('#brand-home')) {
      if (typeof window.checkAndCloseSettings === 'function' && !window.checkAndCloseSettings()) return;
      closeEditTrade();
      if (typeof window.closeTradeModal === 'function') window.closeTradeModal();
      closePositionEditor();
      closeContextPanel();
      setTab('home');
    }
  });
});
