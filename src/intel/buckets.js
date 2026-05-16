// Intraday context "buckets" — pure pattern-matching helpers that turn a
// closed-trade row into a string label (e.g. "Morning window", "Tight 0-2%",
// "Aligned"). Extracted from alpha.js so the bucketing logic can be unit-
// tested and reused without pulling in the 1000-line render layer.

import { state } from '../state/store.js';
import {
  tradeBias,
  tradeInstrument,
  tradeMultiplier,
  tradeQty,
} from '../models/trade.js';
import { TRADE_INTRADAY_SETUPS, TRADE_CONFLUENCE_OPTIONS } from '../config/constants.js';

// ── Direction / setup detection ─────────────────────────────────────────

export function alphaDirectionKey(t) {
  if (typeof tradeBias === 'function') return tradeBias(t) === 'bearish' ? 'short' : 'long';
  const d = String((t && t.direction) || '').toLowerCase();
  return /short|put|bear/.test(d) ? 'short' : 'long';
}

export function alphaIntradaySetupDef(t) {
  const raw = String((t && t.setup) || '').trim();
  if (!raw || typeof TRADE_INTRADAY_SETUPS === 'undefined') return null;
  return TRADE_INTRADAY_SETUPS.find(s =>
    s.id === raw ||
    s.name.toUpperCase() === raw.toUpperCase()
  ) || null;
}

export function alphaSetupBias(t) {
  const def = alphaIntradaySetupDef(t);
  if (def && def.bias && def.bias !== 'either') return def.bias;
  const setup = String((t && t.setup) || '').toUpperCase();
  if (/\b(DN|DOWN|BELOW|LOSS|SHORT)\b/.test(setup)) return 'short';
  if (/\b(UP|ABOVE|RECLAIM|LONG|BREAK|RETEST|MOMO|TREND)\b/.test(setup)) return 'long';
  return null;
}

export function alphaConfluenceBias(t) {
  const id = (t && t.confluence) || '';
  if (id && typeof TRADE_CONFLUENCE_OPTIONS !== 'undefined') {
    const def = TRADE_CONFLUENCE_OPTIONS.find(c => c.id === id);
    if (def && def.bias && def.bias !== 'either') return def.bias;
    if (def && def.bias === 'either') return 'either';
  }
  const rel = String((t && t.vwapRel) || '').toLowerCase();
  if (rel === 'above') return 'long';
  if (rel === 'below') return 'short';
  if (rel === 'at' || rel === 'mixed') return 'either';
  return null;
}

export function alphaBreadthBias(t) {
  const b = String((t && t.breadth) || '').toLowerCase();
  if (b === 'up') return 'long';
  if (b === 'down') return 'short';
  return null;
}

export function alphaContextAlignment(t) {
  if (!t || t.mode !== 'intraday') return { bucket: null, score: null, checks: 0 };
  const dir = alphaDirectionKey(t);
  const checks = [];
  const setupBias = alphaSetupBias(t);
  const confBias = alphaConfluenceBias(t);
  const breadthBias = alphaBreadthBias(t);

  if (setupBias) checks.push(setupBias === dir);
  if (confBias && confBias !== 'either') checks.push(confBias === dir);
  if (breadthBias) checks.push(breadthBias === dir);

  if (!checks.length) return { bucket: 'No context', score: null, checks: 0 };
  const pass = checks.filter(Boolean).length;
  const score = Math.round(pass / checks.length * 100);
  const bucket = score >= 75 ? 'Aligned' : score >= 40 ? 'Mixed' : 'Conflicted';
  return { bucket, score, checks: checks.length };
}

// ── Option spread + fill quality ────────────────────────────────────────

export function alphaSpreadValue(t) {
  if (!t || tradeInstrument(t) !== 'options') return null;
  const spread = window.deriveSpreadPct(t);
  return Number.isFinite(Number(spread)) ? Number(spread) : null;
}

export function alphaSpreadBucket(t) {
  const spread = alphaSpreadValue(t);
  if (spread === null) return null;
  const max = (state.settings && state.settings.intradayMaxSpreadPct) || 5;
  if (spread <= 2) return 'Tight 0-2%';
  if (spread <= max) return `Tradable 2-${max}%`;
  return `Wide over ${max}%`;
}

export function alphaFillQuality(t) {
  if (!t || tradeInstrument(t) !== 'options') return null;
  const entry = Number(t.entry);
  const bid = Number(t.bid);
  const ask = Number(t.ask);
  const mid = Number(t.mid) || ((bid > 0 && ask > 0) ? (bid + ask) / 2 : null);
  if (!entry || !mid || entry <= 0 || mid <= 0) return null;
  const slipPct = ((entry - mid) / mid) * 100;
  const slipDollars = (entry - mid) * tradeMultiplier(t) * Math.max(1, tradeQty(t));
  const bucket = slipPct <= 0 ? 'Mid or better' : slipPct <= 1 ? 'Near mid' : 'Above mid';
  return { bucket, slipPct, slipDollars };
}

// ── Intraday context (time, ORB, VWAP) ──────────────────────────────────

export function alphaTimeBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const raw = String(t.time || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) {
    if (t.inWindow === false) return 'Outside window';
    if (t.inWindow === true) return 'In window';
    return null;
  }
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes >= 9 * 60 + 35 && minutes <= 11 * 60 + 30) return 'Morning window';
  if (minutes >= 14 * 60 && minutes <= 15 * 60 + 30) return 'Afternoon window';
  if (minutes > 11 * 60 + 30 && minutes < 14 * 60) return 'Midday';
  return 'Outside window';
}

export function alphaOrbDirectionBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const setup = String(t.setup || '').toUpperCase();
  const hasOrb = /ORB/.test(setup) || t.orHi != null || t.orLo != null || t.orRng != null;
  if (!hasOrb) return null;
  const bias = alphaSetupBias(t) || alphaDirectionKey(t);
  return bias === 'short' ? 'ORB down' : 'ORB up';
}

export function alphaOrbRangeBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  const rng = Number(t.orRng);
  if (!Number.isFinite(rng) || rng <= 0) return null;
  const ref = Number(t.orHi) || Number(t.orLo) || null;
  const pct = ref && ref > 0 ? (rng / ref) * 100 : null;
  if (pct !== null) {
    if (pct <= 0.25) return 'Tight OR range';
    if (pct <= 0.75) return 'Normal OR range';
    return 'Wide OR range';
  }
  if (rng <= 0.75) return 'Tight OR range';
  if (rng <= 2) return 'Normal OR range';
  return 'Wide OR range';
}

export function alphaVwapBucket(t) {
  if (!t || t.mode !== 'intraday') return null;
  if (t.confluence && typeof TRADE_CONFLUENCE_OPTIONS !== 'undefined') {
    const def = TRADE_CONFLUENCE_OPTIONS.find(c => c.id === t.confluence);
    if (def) return def.label;
  }
  const rel = String(t.vwapRel || '').toLowerCase();
  if (rel === 'above') return 'ABOVE VWAP';
  if (rel === 'below') return 'BELOW VWAP';
  if (rel === 'at') return 'AT VWAP';
  return null;
}

// ── Friction (composite of spread / fill / context) ─────────────────────

export function alphaFrictionScore(t) {
  if (!t || t.mode !== 'intraday') return null;
  const parts = [];
  if (tradeInstrument(t) === 'options') {
    const spread = alphaSpreadValue(t);
    if (spread !== null) parts.push(spread <= ((state.settings && state.settings.intradayMaxSpreadPct) || 5) ? 1 : 0);
    const fill = alphaFillQuality(t);
    if (fill) parts.push(fill.slipPct <= 1 ? 1 : fill.slipPct <= 3 ? 0.5 : 0);
  }
  if (typeof t.inWindow === 'boolean') parts.push(t.inWindow ? 1 : 0);
  const align = alphaContextAlignment(t);
  if (align.score !== null) parts.push(align.score >= 75 ? 1 : align.score >= 40 ? 0.5 : 0);
  if (t.tradeNumOfDay != null) parts.push(Number(t.tradeNumOfDay) <= 3 ? 1 : 0.5);
  if (!parts.length) return null;
  return Math.round(parts.reduce((s, x) => s + x, 0) / parts.length * 100);
}

export function alphaFrictionBucket(t) {
  const score = alphaFrictionScore(t);
  if (score === null) return null;
  if (score >= 80) return 'Low friction';
  if (score >= 55) return 'Moderate friction';
  return 'High friction';
}
