import { describe, expect, it } from 'vitest';
import { calculate } from '../src/calculator';
import { compareOffers } from '../src/compare';

const YEAR = 2026;
const offer = (basicKwacha: number, allowancesKwacha = 0) => ({
  basic: basicKwacha * 100,
  allowances: allowancesKwacha * 100,
});

describe('compareOffers', () => {
  it('matches the calculator for every offer', () => {
    const offers = [offer(8_000, 2_000), offer(12_000)];
    const compared = compareOffers(offers, YEAR);
    offers.forEach((o, i) => {
      expect(compared[i]?.result).toEqual(calculate({ ...o, year: YEAR }));
    });
  });

  it('measures each offer against the first', () => {
    const [a, b, c] = compareOffers([offer(10_000), offer(20_000), offer(7_000)], YEAR);
    expect(a?.netDifference).toBe(0);
    expect(b?.netDifference).toBe(1_377_400 - 807_400);
    expect(c?.netDifference).toBe(620_000 - 807_400);
  });

  it('marks the highest take-home as best', () => {
    const flags = compareOffers([offer(10_000), offer(20_000), offer(7_000)], YEAR).map((c) => c.isBest);
    expect(flags).toEqual([false, true, false]);
  });

  it('marks nothing as best when every offer ties', () => {
    const flags = compareOffers([offer(10_000), offer(10_000)], YEAR).map((c) => c.isBest);
    expect(flags).toEqual([false, false]);
  });

  it('marks both leaders when two of three tie', () => {
    const flags = compareOffers([offer(10_000), offer(10_000), offer(7_000)], YEAR).map((c) => c.isBest);
    expect(flags).toEqual([true, true, false]);
  });

  it('prefers more allowances at equal gross, because NHIMA is on basic only', () => {
    const [mostlyBasic, mostlyAllowances] = compareOffers([offer(10_000), offer(5_000, 5_000)], YEAR);
    expect(mostlyAllowances?.isBest).toBe(true);
    expect(mostlyBasic?.isBest).toBe(false);
    expect(mostlyAllowances?.netDifference).toBe(5_000); // K50 less NHIMA
  });

  it('returns nothing for no offers', () => {
    expect(compareOffers([], YEAR)).toEqual([]);
  });
});
