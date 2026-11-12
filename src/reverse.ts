import { calculateWithRates, MAX_NGWEE, type PayResult } from './calculator';
import { getRates, type Rates } from './rateTable';

export interface ReverseInput {
  /** Take-home pay wanted, in ngwee. */
  targetNet: number;
  /** Allowances held fixed while basic salary is solved for, in ngwee. */
  allowances: number;
}

export type ReverseResult =
  | { status: 'ok'; basic: number; result: PayResult }
  /** Allowances alone already give more take-home than the target, so basic is zero. */
  | { status: 'allowances-exceed-target'; basic: 0; result: PayResult }
  /** The target is beyond what the largest supported salary pays. */
  | { status: 'out-of-range' };

/**
 * Rounding can lower net by a couple of ngwee over very small rises, so the binary
 * search may land just above the true answer. This many ngwee back is always enough
 * while combined marginal deductions stay below 90%.
 */
const SCAN_BACK_NGWEE = 32;

/** Finds the smallest basic salary that gives the target take-home pay. */
export function requiredPayWithRates({ targetNet, allowances }: ReverseInput, rates: Rates): ReverseResult {
  if (!Number.isInteger(targetNet) || targetNet < 0) {
    throw new RangeError('targetNet must be a whole number of ngwee, zero or more');
  }

  const payFor = (basic: number) => calculateWithRates({ basic, allowances }, rates);

  const atZero = payFor(0);
  if (atZero.net > targetNet) return { status: 'allowances-exceed-target', basic: 0, result: atZero };
  if (atZero.net === targetNet) return { status: 'ok', basic: 0, result: atZero };
  if (payFor(MAX_NGWEE).net < targetNet) return { status: 'out-of-range' };

  let tooLow = 0;
  let enough = MAX_NGWEE;
  while (enough - tooLow > 1) {
    const middle = tooLow + Math.floor((enough - tooLow) / 2);
    if (payFor(middle).net >= targetNet) enough = middle;
    else tooLow = middle;
  }

  for (let basic = Math.max(1, enough - SCAN_BACK_NGWEE); basic < enough; basic++) {
    if (payFor(basic).net >= targetNet) {
      enough = basic;
      break;
    }
  }

  return { status: 'ok', basic: enough, result: payFor(enough) };
}

export function requiredPay(input: ReverseInput & { year: number }): ReverseResult {
  return requiredPayWithRates(input, getRates(input.year));
}
