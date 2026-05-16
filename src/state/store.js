// Central mutable app state. The object identity is preserved across loads
// (loadState mutates fields rather than reassigning the binding) so any
// `import { state }` and any `window.state` reference always sees the same object.

import { createDefaultState } from '../config/constants.js';

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
  if (typeof window.renderHome === 'function') window.renderHome();
  if (typeof window.renderTrade === 'function') window.renderTrade();
  if (typeof window.renderRegime === 'function') window.renderRegime();
  if (typeof window.renderPortfolioStatus === 'function') window.renderPortfolioStatus();
  if (typeof window.renderLogStats === 'function') window.renderLogStats();
  if (typeof window.renderLogTable === 'function') window.renderLogTable();
  if (typeof window.renderTickerBar === 'function') window.renderTickerBar();
  if (typeof window.renderContextPanel === 'function') window.renderContextPanel();
}

// Bridge to legacy.js (regular <script>).
window.state = state;
window.getRiskPctForRegime = getRiskPctForRegime;
window.getRegimeRiskMultiplier = getRegimeRiskMultiplier;
window.refreshAllUI = refreshAllUI;
