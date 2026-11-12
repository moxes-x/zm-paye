import { getRates, type Band, type Rates } from './rateTable';

const BPS_SCALE = 10_000;

/** K1 billion. Keeps ngwee × basis-point arithmetic inside the safe integer range. */
export const MAX_NGWEE = 100_000_000_000;

export interface PayInput {
  /** Basic salary in ngwee. */
  basic: number;
  /** Taxable allowances in ngwee. */
  allowances: number;
}

export interface BandResult extends Band {
  /** The part of taxable income that falls in this band. */
  amountNgwee: number;
  taxNgwee: number;
}

export interface EmployerCost {
  napsa: number;
  nhima: number;
  sdl: number;
  /** Gross pay plus the employer's contributions. */
  total: number;
}

/** All amounts are monthly, in ngwee. */
export interface PayResult {
  year: number;
  gross: number;
  taxable: number;
  paye: number;
  payeByBand: BandResult[];
  napsa: number;
  nhima: number;
  net: number;
  employerCost: EmployerCost;
}

/** Rounds a value scaled by BPS_SCALE to whole ngwee, half-up. Integer-only, so exact. */
function roundHalfUp(scaled: number): number {
  const shifted = scaled + BPS_SCALE / 2;
  return (shifted - (shifted % BPS_SCALE)) / BPS_SCALE;
}

function percentOf(ngwee: number, bps: number): number {
  return roundHalfUp(ngwee * bps);
}

function assertValidAmount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_NGWEE) {
    throw new RangeError(`${name} must be a whole number of ngwee from 0 to ${MAX_NGWEE}`);
  }
}

/**
 * Applies the bands exactly, then rounds the running total at each step. PAYE is
 * therefore the exact tax rounded once, and the band amounts always add up to it.
 */
function applyBands(taxable: number, bands: Band[]): { paye: number; payeByBand: BandResult[] } {
  let exactRunningTotal = 0;
  let paye = 0;

  const payeByBand = bands.map((band) => {
    const top = band.toNgwee ?? Number.POSITIVE_INFINITY;
    const amountNgwee = Math.max(0, Math.min(taxable, top) - band.fromNgwee);
    exactRunningTotal += amountNgwee * band.rateBps;
    const roundedRunningTotal = roundHalfUp(exactRunningTotal);
    const taxNgwee = roundedRunningTotal - paye;
    paye = roundedRunningTotal;
    return { ...band, amountNgwee, taxNgwee };
  });

  return { paye, payeByBand };
}

export function calculateWithRates({ basic, allowances }: PayInput, rates: Rates): PayResult {
  assertValidAmount('basic', basic);
  assertValidAmount('allowances', allowances);

  const gross = basic + allowances;
  const napsaBase = Math.min(gross, rates.napsa.ceilingNgwee);

  const napsa = percentOf(napsaBase, rates.napsa.employeeBps);
  const nhima = percentOf(basic, rates.nhima.employeeBps);
  const taxable = rates.paye.deductNapsaBeforePaye ? gross - napsa : gross;
  const { paye, payeByBand } = applyBands(taxable, rates.paye.bands);

  const employerNapsa = percentOf(napsaBase, rates.napsa.employerBps);
  const employerNhima = percentOf(basic, rates.nhima.employerBps);
  const sdl = percentOf(gross, rates.sdl.employerBps);

  return {
    year: rates.year,
    gross,
    taxable,
    paye,
    payeByBand,
    napsa,
    nhima,
    net: gross - paye - napsa - nhima,
    employerCost: {
      napsa: employerNapsa,
      nhima: employerNhima,
      sdl,
      total: gross + employerNapsa + employerNhima + sdl,
    },
  };
}

export function calculate(input: PayInput & { year: number }): PayResult {
  return calculateWithRates(input, getRates(input.year));
}
