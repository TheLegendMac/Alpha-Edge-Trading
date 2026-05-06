// Rolling P/L over the kill-switch window — single source of truth
// for both Home and Stats. Returns { totalPL, pct, days, count, winRate }.

import { state } from '../state/store.js';
import { isClosedTrade, calcPL } from '../models/trade.js';

export function computeRollingPL() {
  const days = (state.settings && state.settings.killSwitchDays) || 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const closed = (state.trades || []).filter(t => isClosedTrade(t) && (t.exit_date || t.date));
  const recent = closed.filter(t => new Date(t.exit_date || t.date).getTime() >= cutoff);
  const totalPL = recent.reduce((s, t) => s + (calcPL(t) || 0), 0);
  const wins = recent.filter(t => (calcPL(t) || 0) > 0).length;
  const account = (state.settings && state.settings.account) || 10000;
  const winRate = recent.length ? Math.round(wins / recent.length * 100) : null;
  return { totalPL, pct: (totalPL / account * 100), days, count: recent.length, winRate };
}

window.computeRollingPL = computeRollingPL;
