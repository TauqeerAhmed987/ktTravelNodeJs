import {
  buildInstallmentAmounts,
  maxOccupancy,
  normalizeCapacity,
  nightsBetween,
  parseCapacity,
  sameCapacity,
  toIsoDay,
} from './booking-rules.util.js';

describe('capacity labels', () => {
  it('reads every spelling used in the data', () => {
    expect(parseCapacity('4_Adults')).toEqual({ adults: 4, children: 0 });
    expect(parseCapacity('1_Adult_1_Child')).toEqual({ adults: 1, children: 1 });
    expect(parseCapacity('2_Adults_3_Children')).toEqual({ adults: 2, children: 3 });
    expect(parseCapacity('2 adult 0 child')).toEqual({ adults: 2, children: 0 });
    expect(parseCapacity('Deluxe')).toBeNull();
  });

  it('compares capacities by meaning, not spelling', () => {
    expect(sameCapacity('2_Adults_1_Child', '2 adult 1 child')).toBe(true);
    expect(sameCapacity('2_Adults_1_Child', '2_Adults_3_Children')).toBe(false);
    expect(normalizeCapacity('4_Adults')).toBe(normalizeCapacity('4 adult 0 child'));
  });

  it('finds the largest party a room can host', () => {
    expect(maxOccupancy(['4_Adults', '1_Adult_1_Child', '2_Adults_3_Children'])).toEqual({ maxAdults: 4, maxPeople: 5 });
    expect(maxOccupancy([])).toEqual({ maxAdults: 0, maxPeople: 0 }); // unknown -> no limit applied
  });
});

describe('dates', () => {
  it('accepts real dates only', () => {
    expect(toIsoDay('2026-10-07')).toBe('2026-10-07');
    expect(toIsoDay('2026-10-07T00:00:00.000Z')).toBe('2026-10-07');
    expect(toIsoDay('2026-02-31')).toBeNull();
    expect(toIsoDay('2026-13-01')).toBeNull();
    expect(toIsoDay('garbage')).toBeNull();
    expect(toIsoDay('')).toBeNull();
  });

  it('counts nights', () => {
    expect(nightsBetween('2026-10-07', '2026-10-10')).toBe(3);
  });
});

describe('installments are a share of the grand total', () => {
  it('deposit 30% + 50% + 20% of the total', () => {
    // total 1000, deposit 300 paid, 700 left
    expect(buildInstallmentAmounts([{ amount_type: 'percent', amount: 50 }, { amount_type: 'percent', amount: 20 }], 700, 1000)).toEqual([500, 200]);
  });

  it('matches the event guide example', () => {
    // total 5850, deposit 20% = 1170, installments 40% + 40% of the total
    expect(buildInstallmentAmounts([{ amount_type: 'percent', amount: 40 }, { amount_type: 'percent', amount: 40 }], 4680, 5850)).toEqual([2340, 2340]);
  });

  it('makes the schedule add up to exactly the balance', () => {
    // 20% + 30% only cover 50% of the total while 70% is left -> the last installment absorbs the rest
    expect(buildInstallmentAmounts([{ amount_type: 'percent', amount: 20 }, { amount_type: 'percent', amount: 30 }], 700, 1000)).toEqual([200, 500]);
    // fixed amounts that are too small
    expect(buildInstallmentAmounts([{ amount_type: 'fixed', amount: 100 }, { amount_type: 'fixed', amount: 100 }], 1000, 1500)).toEqual([100, 900]);
  });

  it('scales down when the earlier installments alone exceed the balance', () => {
    const out = buildInstallmentAmounts([{ amount_type: 'fixed', amount: 800 }, { amount_type: 'fixed', amount: 800 }], 1000, 1500);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(out.every((v) => v >= 0)).toBe(true);
  });

  it('handles an empty schedule', () => {
    expect(buildInstallmentAmounts([], 500, 1000)).toEqual([]);
  });
});
