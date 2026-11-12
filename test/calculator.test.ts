import { describe, expect, it } from 'vitest';
import { calculate, calculateWithRates } from '../src/calculator';
import { getRates } from '../src/rateTable';

const YEAR = 2026;
/** Converts kwacha to ngwee. Tests only pass values with at most two decimals. */
const K = (kwacha: number) => Math.round(kwacha * 100);
const pay = (basic: number, allowances = 0) =>
  calculate({ basic: K(basic), allowances: K(allowances), year: YEAR });

describe('golden cases (gross = basic), worked by hand from the band table', () => {
  // gross, PAYE, NAPSA, NHIMA, net
  const cases: [number, number, number, number, number][] = [
    [0, 0, 0, 0, 0],
    [3_000, 0, 150, 30, 2_820],
    [5_100, 0, 255, 51, 4_794],
    [7_000, 380, 350, 70, 6_200], // 1,900 × 20%
    [10_000, 1_326, 500, 100, 8_074], // 400 + 630 + 296
    [20_000, 5_026, 1_000, 200, 13_774], // 400 + 630 + 3,996
    [50_000, 16_126, 1_861.8, 500, 31_512.2], // 400 + 630 + 15,096; NAPSA capped
  ];

  it.each(cases)('K%d', (gross, paye, napsa, nhima, net) => {
    const result = pay(gross);
    expect(result.gross).toBe(K(gross));
    expect(result.paye).toBe(K(paye));
    expect(result.napsa).toBe(K(napsa));
    expect(result.nhima).toBe(K(nhima));
    expect(result.net).toBe(K(net));
  });

  it('breaks K10,000 down band by band', () => {
    expect(pay(10_000).payeByBand.map((b) => b.taxNgwee)).toEqual([0, K(400), K(630), K(296)]);
  });
});

describe('PAYE band boundaries', () => {
  const cases: [number, number][] = [
    [5_100, 0],
    [5_100.01, 0], // 0.2 ngwee rounds down
    [5_100.03, 0.01], // 0.6 ngwee rounds up
    [7_100, 400],
    [7_100.01, 400], // 400 + 0.3 ngwee
    [7_100.02, 400.01], // 400 + 0.6 ngwee
    [9_200, 1_030],
    [9_200.01, 1_030], // 1,030 + 0.37 ngwee
    [9_200.02, 1_030.01], // 1,030 + 0.74 ngwee
  ];

  it.each(cases)('K%d owes K%d', (gross, paye) => {
    expect(pay(gross).paye).toBe(K(paye));
  });
});

describe('rounding', () => {
  it('rounds an exact half ngwee up', () => {
    // 5% of 10 ngwee is exactly 0.5 ngwee.
    expect(calculate({ basic: 10, allowances: 0, year: YEAR }).napsa).toBe(1);
    // 5% of 9 ngwee is 0.45 ngwee.
    expect(calculate({ basic: 9, allowances: 0, year: YEAR }).napsa).toBe(0);
  });

  it('rounds the PAYE total once rather than rounding each band', () => {
    // Exact tax is 400 + 630 + 0.0074 = 1,030.0074, which rounds to 1,030.01.
    const result = pay(9_200.02);
    expect(result.paye).toBe(103_001);
    expect(result.payeByBand.reduce((sum, b) => sum + b.taxNgwee, 0)).toBe(result.paye);
  });
});

describe('NAPSA cap', () => {
  const cases: [number, number][] = [
    [37_235, 1_861.75],
    [37_236, 1_861.8],
    [37_237, 1_861.8],
    [100_000, 1_861.8],
  ];

  it.each(cases)('K%d contributes K%d', (gross, napsa) => {
    expect(pay(gross).napsa).toBe(K(napsa));
  });

  it('counts allowances towards the ceiling', () => {
    expect(pay(30_000, 20_000).napsa).toBe(K(1_861.8));
    expect(pay(4_000, 1_000).napsa).toBe(K(250));
  });
});

describe('NHIMA', () => {
  it('is charged on basic only, so allowances do not change it', () => {
    expect(pay(8_000, 0).nhima).toBe(K(80));
    expect(pay(8_000, 12_000).nhima).toBe(K(80));
  });

  it('has no cap', () => {
    expect(pay(1_000_000).nhima).toBe(K(10_000));
  });
});

describe('allowances', () => {
  it('are taxed as part of gross', () => {
    expect(pay(6_000, 4_000).paye).toBe(pay(10_000).paye);
    expect(pay(6_000, 4_000).gross).toBe(K(10_000));
  });
});

describe('employer cost', () => {
  it('adds NAPSA, NHIMA and SDL to gross', () => {
    const { employerCost } = pay(8_000, 2_000);
    expect(employerCost.napsa).toBe(K(500)); // 5% of 10,000
    expect(employerCost.nhima).toBe(K(80)); // 1% of 8,000
    expect(employerCost.sdl).toBe(K(50)); // 0.5% of 10,000
    expect(employerCost.total).toBe(K(10_630));
  });

  it('caps employer NAPSA at the same ceiling but leaves SDL uncapped', () => {
    const { employerCost } = pay(100_000);
    expect(employerCost.napsa).toBe(K(1_861.8));
    expect(employerCost.sdl).toBe(K(500));
  });
});

describe('deductNapsaBeforePaye flag', () => {
  const rates = getRates(YEAR);
  const flagged = {
    ...rates,
    paye: { ...rates.paye, deductNapsaBeforePaye: true },
  };

  it('defaults to PAYE on gross', () => {
    expect(rates.paye.deductNapsaBeforePaye).toBe(false);
    expect(pay(10_000).taxable).toBe(K(10_000));
  });

  it('reduces taxable income by employee NAPSA when switched on', () => {
    const result = calculateWithRates({ basic: K(10_000), allowances: 0 }, flagged);
    expect(result.taxable).toBe(K(9_500));
    expect(result.paye).toBe(K(1_141)); // 400 + 630 + 300 × 37%
    expect(result.net).toBe(K(8_259));
  });
});

describe('invalid calculator input', () => {
  it.each([
    ['negative', -1],
    ['fractional ngwee', 1.5],
    ['NaN', Number.NaN],
    ['above K1 billion', 100_000_000_001],
  ])('rejects %s', (_label, basic) => {
    expect(() => calculate({ basic, allowances: 0, year: YEAR })).toThrow(RangeError);
    expect(() => calculate({ basic: 0, allowances: basic, year: YEAR })).toThrow(RangeError);
  });

  it('rejects a year with no rates file', () => {
    expect(() => calculate({ basic: 0, allowances: 0, year: 1999 })).toThrow(/1999/);
  });
});
