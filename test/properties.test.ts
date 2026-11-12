import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculate, MAX_NGWEE } from '../src/calculator';

const YEAR = 2026;
const THRESHOLD = 510_000;
const NAPSA_MAX = 186_180;

const amount = fc.integer({ min: 0, max: MAX_NGWEE });
const salary = fc.integer({ min: 0, max: 100_000_000 }); // up to K1 million, the realistic range
const pay = (basic: number, allowances = 0) => calculate({ basic, allowances, year: YEAR });

describe('calculator properties', () => {
  it('net is never more than gross and never negative', () => {
    fc.assert(
      fc.property(amount, amount, (basic, allowances) => {
        const { net, gross } = pay(basic, allowances);
        expect(net).toBeLessThanOrEqual(gross);
        expect(net).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('net equals gross minus the three deductions, in whole ngwee', () => {
    fc.assert(
      fc.property(amount, amount, (basic, allowances) => {
        const r = pay(basic, allowances);
        expect(Number.isInteger(r.net)).toBe(true);
        expect(r.net).toBe(r.gross - r.paye - r.napsa - r.nhima);
      }),
    );
  });

  it('PAYE equals the sum of the band amounts', () => {
    fc.assert(
      fc.property(amount, amount, (basic, allowances) => {
        const r = pay(basic, allowances);
        expect(r.payeByBand.reduce((sum, b) => sum + b.taxNgwee, 0)).toBe(r.paye);
        expect(r.payeByBand.reduce((sum, b) => sum + b.amountNgwee, 0)).toBe(r.taxable);
      }),
    );
  });

  it('owes no PAYE at or below the threshold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: THRESHOLD }), (gross) => {
        expect(pay(gross).paye).toBe(0);
      }),
    );
  });

  it('never takes more than the NAPSA maximum', () => {
    fc.assert(
      fc.property(amount, amount, (basic, allowances) => {
        expect(pay(basic, allowances).napsa).toBeLessThanOrEqual(NAPSA_MAX);
      }),
    );
  });

  it('never lowers net pay for a rise of 6 ngwee or more', () => {
    // Deductions grow by at most 43% of a rise, plus up to 1 ngwee of rounding
    // on each of the three. A rise of 6 ngwee always outruns that.
    fc.assert(
      fc.property(salary, fc.integer({ min: 6, max: 10_000_000 }), (basic, rise) => {
        expect(pay(basic + rise).net).toBeGreaterThanOrEqual(pay(basic).net);
      }),
      { numRuns: 2_000 },
    );
  });

  it('never lowers net pay when the rise comes through allowances', () => {
    fc.assert(
      fc.property(salary, salary, fc.integer({ min: 6, max: 10_000_000 }), (basic, allowances, rise) => {
        expect(pay(basic, allowances + rise).net).toBeGreaterThanOrEqual(pay(basic, allowances).net);
      }),
      { numRuns: 2_000 },
    );
  });

  it('moves net down by at most 2 ngwee of rounding on any smaller rise', () => {
    fc.assert(
      fc.property(salary, fc.integer({ min: 1, max: 5 }), (basic, rise) => {
        expect(pay(basic + rise).net).toBeGreaterThanOrEqual(pay(basic).net - 2);
      }),
      { numRuns: 2_000 },
    );
  });
});
