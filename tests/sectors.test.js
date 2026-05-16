// computeTop3 / computeAvoidList — pure ranking of sector ratings into
// the STRONG and WEAK buckets. These feed the Home dashboard and the
// context panel.

import { describe, it, expect } from 'vitest';
import { computeTop3, computeAvoidList } from '../src/views/sectors.js';

describe('computeTop3', () => {
  it('returns only STRONG sectors (rating >= 3.5)', () => {
    const ratings = {
      XLK: 4.8, XLF: 3.7, XLV: 3.2, XLY: 2.1,
    };
    const top = computeTop3(ratings);
    expect(top.map(s => s.ticker)).toEqual(['XLK', 'XLF']);
  });

  it('sorts highest-rated first and caps at 3', () => {
    const ratings = {
      XLK: 4.0, XLF: 5.0, XLV: 4.5, XLY: 4.2, XLC: 4.8,
    };
    const top = computeTop3(ratings);
    expect(top.map(s => s.ticker)).toEqual(['XLF', 'XLC', 'XLV']);
    expect(top).toHaveLength(3);
  });

  it('returns empty when no sector is STRONG', () => {
    expect(computeTop3({ XLK: 2.0, XLF: 1.5 })).toEqual([]);
  });

  it('treats missing ratings as unrated (excluded)', () => {
    expect(computeTop3({})).toEqual([]);
  });
});

describe('computeAvoidList', () => {
  it('returns only WEAK sectors (rating < 2.5), worst first', () => {
    const ratings = {
      XLK: 4.5, XLF: 2.4, XLV: 1.2, XLY: 3.0,
    };
    const avoid = computeAvoidList(ratings);
    expect(avoid.map(s => s.ticker)).toEqual(['XLV', 'XLF']);
  });

  it('returns empty when nothing is WEAK', () => {
    expect(computeAvoidList({ XLK: 4.0, XLF: 3.0 })).toEqual([]);
  });
});
