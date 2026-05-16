// Central mutable app state. The object identity is preserved across loads
// (loadState mutates fields rather than reassigning the binding) so any
// `import { state }` and any `state` reference always sees the same object.

import { createDefaultState } from '../config/constants.js';
import { renderHome } from '../views/home.js';
import { renderTrade } from '../trade-flow/stepper.js';
import { renderRegime } from '../market/regime.js';
import { renderLogStats } from '../intel/alpha.js';
import { renderLogTable } from '../views/log.js';
import { renderContextPanel } from '../market/context-panel.js';

export const state = createDefaultState();

// Helper: % risk for current regime as a decimal (e.g. 0.02 for 2%).
export function getRiskPctForRegime(regime) {
  const s = state.settings;
  if (regime === 'risk-on') return s.riskOn / 100;
  if (regime === 'neutral') return s.riskNeutral / 100;
  if (regime === 'risk-off') return s.riskOff / 100;
  return s.riskOn / 100;
}

// Regime size/stop multiplier — scales both the Smart-Stop pct and any
// fixed-dollar risk unit (e.g. intradayRiskPerTrade). risk-on = full, neutral =
// half, risk-off = quarter. Drives "tighter stops + smaller size" in weaker tape.
export function getRegimeRiskMultiplier(regime) {
  if (regime === 'neutral')  return 0.5;
  if (regime === 'risk-off') return 0.25;
  return 1.0;
}

// Refresh entire UI after state replacement. Render functions are attached to
// window by their respective modules — `typeof` is safe even if undefined.
export function refreshAllUI() {
  if (typeof renderHome === 'function') renderHome();
  if (typeof renderTrade === 'function') renderTrade();
  if (typeof renderRegime === 'function') renderRegime();
  if (typeof window.renderPortfolioStatus === 'function') window.renderPortfolioStatus();
  if (typeof renderLogStats === 'function') renderLogStats();
  if (typeof renderLogTable === 'function') renderLogTable();
  if (typeof window.renderTickerBar === 'function') window.renderTickerBar();
  if (typeof renderContextPanel === 'function') renderContextPanel();
}

// Bridge to legacy.js (regular <script>).
