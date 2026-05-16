// Unit tests for the trade-math primitives. These functions feed every
// downstream sizing decision, so even small regressions can move real
// dollars. Tests run via `npm test` (vitest).

import { describe, it, expect, beforeEach } from 'vitest';

import {
  tradeQty,
  tradeMultiplier,
  tradeInstrument,
  tradeBias,
  calcPL,
  calcR,
  tradeRiskDollars,
  ratingToStatus,
} from '../src/models/trade.js';
import { getRiskPctForRegime, getRegimeRiskMultiplier, state } from '../src/state/store.js';

describe('tradeQty', () => {
  it('uses shares for a stocks trade', () => {
    expect(tradeQty({ instrument: 'stocks', shares: 100 })).toBe(100);
  });

  it('falls back to contracts on an options trade', () => {
    expect(tradeQty({ instrument: 'options', contracts: 3 })).toBe(3);
  });

  it('prefers explicit qty over contracts', () => {
    expect(tradeQty({ instrument: 'options', qty: 5, contracts: 3 })).toBe(5);
  });

  it('returns 0 when no size field is set', () => {
    expect(tradeQty({ instrument: 'options' })).toBe(0);
  });

  it('coerces string sizes to numbers', () => {
    expect(tradeQty({ instrument: 'options', contracts: '4' })).toBe(4);
  });
});

describe('tradeMultiplier', () => {
  it('returns 1 for stocks', () => {
    expect(tradeMultiplier({ instrument: 'stocks' })).toBe(1);
  });
  it('returns 100 for options', () => {
    expect(tradeMultiplier({ instrument: 'options' })).toBe(100);
  });
  it('defaults to options multiplier when instrument is missing', () => {
    expect(tradeMultiplier({})).toBe(100);
  });
});

describe('tradeBias', () => {
  it('honors explicit bias', () => {
    expect(tradeBias({ bias: 'bearish', direction: 'Long' })).toBe('bearish');
  });
  it('derives bearish from direction=Short', () => {
    expect(tradeBias({ direction: 'Short' })).toBe('bearish');
  });
  it('defaults to bullish', () => {
    expect(tradeBias({})).toBe('bullish');
  });
});

describe('calcPL', () => {
  it('long option: +$2 per contract × 100 mult × 3 contracts = $600', () => {
    const t = { instrument: 'options', contracts: 3, entry: 1.00, exit: 3.00, status: 'closed' };
    expect(calcPL(t)).toBe(600);
  });

  it('long stock: +$5 per share × 100 shares = $500', () => {
    const t = { instrument: 'stocks', shares: 100, entry: 10, exit: 15, status: 'closed' };
    expect(calcPL(t)).toBe(500);
  });

  it('short stock flips sign: entry 50, exit 40, 100 shares = +$1000', () => {
    const t = { instrument: 'stocks', shares: 100, entry: 50, exit: 40, direction: 'Short', status: 'closed' };
    expect(calcPL(t)).toBe(1000);
  });

  it('open trade returns null', () => {
    expect(calcPL({ status: 'open', entry: 1, contracts: 1 })).toBeNull();
  });
});

describe('tradeRiskDollars', () => {
  it('returns explicit riskDollars when set', () => {
    expect(tradeRiskDollars({ riskDollars: 250 })).toBe(250);
  });

  it('computes |entry - stop| × multiplier × qty when both are set', () => {
    // Long option: entry 2.00, stop 1.00, 5 contracts → $1.00 × 100 × 5 = $500
    const t = { instrument: 'options', contracts: 5, entry: 2, stop: 1 };
    expect(tradeRiskDollars(t)).toBe(500);
  });

  it('handles short stock risk: |entry - stop| × 1 × shares', () => {
    const t = { instrument: 'stocks', shares: 100, entry: 50, stop: 55, direction: 'Short' };
    expect(tradeRiskDollars(t)).toBe(500);
  });

  it('falls back to settings.stopPct when stop is missing', () => {
    // Default stopPct is 50 → entry 2 × 0.5 × 100 × 1 contract = $100
    const t = { instrument: 'options', contracts: 1, entry: 2 };
    expect(tradeRiskDollars(t)).toBe(100);
  });

  it('returns 0 when entry and qty are both missing', () => {
    expect(tradeRiskDollars({})).toBe(0);
  });
});

describe('calcR', () => {
  it('+1R when P/L equals risk dollars', () => {
    const t = { instrument: 'options', contracts: 1, entry: 2, stop: 1, exit: 3, status: 'closed' };
    // P/L = +$100, risk = $100 → +1R
    expect(calcR(t)).toBe(1);
  });

  it('-1R when loss equals risk dollars', () => {
    const t = { instrument: 'options', contracts: 1, entry: 2, stop: 1, exit: 1, status: 'closed' };
    // P/L = -$100, risk = $100 → -1R
    expect(calcR(t)).toBe(-1);
  });

  it('returns null for open trades', () => {
    expect(calcR({ status: 'open', entry: 1, contracts: 1 })).toBeNull();
  });

  it('+2R for a 2:1 winner', () => {
    const t = { instrument: 'options', contracts: 1, entry: 2, stop: 1, exit: 4, status: 'closed' };
    // P/L = $200, risk = $100 → +2R
    expect(calcR(t)).toBe(2);
  });
});

describe('regime helpers', () => {
  beforeEach(() => {
    state.settings.riskOn = 2.0;
    state.settings.riskNeutral = 1.0;
    state.settings.riskOff = 0.5;
  });

  it('getRiskPctForRegime returns decimals from percent settings', () => {
    expect(getRiskPctForRegime('risk-on')).toBeCloseTo(0.02);
    expect(getRiskPctForRegime('neutral')).toBeCloseTo(0.01);
    expect(getRiskPctForRegime('risk-off')).toBeCloseTo(0.005);
  });

  it('getRiskPctForRegime defaults unknown regime to risk-on', () => {
    expect(getRiskPctForRegime('bogus')).toBeCloseTo(0.02);
  });

  it('getRegimeRiskMultiplier scales 1 / 0.5 / 0.25', () => {
    expect(getRegimeRiskMultiplier('risk-on')).toBe(1.0);
    expect(getRegimeRiskMultiplier('neutral')).toBe(0.5);
    expect(getRegimeRiskMultiplier('risk-off')).toBe(0.25);
  });
});

describe('ratingToStatus', () => {
  it('classifies STRONG / NEUTRAL / WEAK', () => {
    expect(ratingToStatus(4.5)).toBe('STRONG');
    expect(ratingToStatus(3.0)).toBe('NEUTRAL');
    expect(ratingToStatus(1.5)).toBe('WEAK');
  });
  it('returns null for empty or out-of-range', () => {
    expect(ratingToStatus(null)).toBeNull();
    expect(ratingToStatus('')).toBeNull();
    expect(ratingToStatus(6)).toBeNull();
  });
});

describe('tradeInstrument', () => {
  it('returns stocks when set', () => {
    expect(tradeInstrument({ instrument: 'stocks' })).toBe('stocks');
  });
  it('defaults to options', () => {
    expect(tradeInstrument({})).toBe('options');
  });
});
