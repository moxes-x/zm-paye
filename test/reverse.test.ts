import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculate, MAX_NGWEE } from '../src/calculator';
import { getRates } from '../src/rateTable';
import { requiredPay, requiredPayWithRates } from '../src/reverse';

const YEAR = 2026;
const K = (kwacha: number) => Math.round(kwacha * 100);
const solve = (targetNet: number, allowances = 0) => requiredPay({ targetNet, allowances, year: YEAR });
const netOf = (basic: number, allowances = 0) => calculate({ basic, allowances, year: YEAR }).net;

describe('required salary, using the forward golden cases', () => {
  it.each([
    [2_820, 3_000],
    [4_794, 5_100],
    [6_200, 7_000],
    [8_074, 10_000],
    [13_774, 20_000],
    [31_512.2, 50_000],
  ])('take-home K%d needs K%d', (net, basic) => {
    const solved = solve(K(net));
    expect(solved.status).toBe('ok');
    if (solved.status !== 'out-of-range') expect(solved.basic).toBe(K(basic));
  });

  it('returns zero for a zero target', () => {
    expect(solve(0)).toMatchObject({ status: 'ok', basic: 0 });
  });
});

describe('allowances', () => {
  it('holds allowances fixed and solves for basic', () => {
    const solved = solve(K(8_074), K(2_000));
    expect(solved.status).toBe('ok');
    if (solved.status === 'out-of-range') return;
    expect(solved.result.net).toBe(K(8_074));
    expect(solved.result.gross).toBe(solved.basic + K(2_000));
  });

  it('reports when allowances alone beat the target', () => {
    const solved = solve(K(1_000), K(3_000));
    expect(solved.status).toBe('allowances-exceed-target');
    if (solved.status !== 'out-of-range') expect(solved.result.net).toBe(K(2_850));
  });
});

describe('limits', () => {
  it('reports a target beyond the largest supported salary', () => {
    expect(solve(MAX_NGWEE)).toEqual({ status: 'out-of-range' });
  });

  it('rejects an invalid target', () => {
    expect(() => solve(-1)).toThrow(RangeError);
    expect(() => solve(1.5)).toThrow(RangeError);
  });
});

describe('deductNapsaBeforePaye flag', () => {
  it('solves against the flagged rules', () => {
    const rates = getRates(YEAR);
    const flagged = { ...rates, paye: { ...rates.paye, deductNapsaBeforePaye: true } };
    expect(requiredPayWithRates({ targetNet: K(8_259), allowances: 0 }, flagged)).toMatchObject({
      status: 'ok',
      basic: K(10_000),
    });
  });
});

describe('properties', () => {
  const basic = fc.integer({ min: 100, max: 100_000_000 });
  const allowances = fc.integer({ min: 0, max: 20_000_000 });

  it('hits the target exactly, with the smallest basic salary that does', () => {
    fc.assert(
      fc.property(basic, allowances, (original, extra) => {
        const target = netOf(original, extra);
        const solved = solve(target, extra);
        expect(solved.status).toBe('ok');
        if (solved.status === 'out-of-range') return;

        expect(solved.result.net).toBe(target);
        expect(solved.basic).toBeLessThanOrEqual(original);
        for (let lower = Math.max(0, solved.basic - 40); lower < solved.basic; lower++) {
          expect(netOf(lower, extra)).toBeLessThan(target);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('hits any reachable whole-ngwee target exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (target) => {
        const solved = solve(target);
        expect(solved.status).toBe('ok');
        if (solved.status !== 'out-of-range') expect(solved.result.net).toBe(target);
      }),
      { numRuns: 300 },
    );
  });
});
