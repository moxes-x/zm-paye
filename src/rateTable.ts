import { RATE_FILES } from './rates/index';

export interface Band {
  fromNgwee: number;
  /** Upper limit, inclusive. `null` means the band has no upper limit. */
  toNgwee: number | null;
  /** Rate in basis points: 2000 is 20%. */
  rateBps: number;
}

export interface Source {
  covers: string;
  title: string;
  url: string;
}

export interface Rates {
  year: number;
  effectiveFrom: string;
  reviewedOn: string;
  paye: {
    deductNapsaBeforePaye: boolean;
    bands: Band[];
  };
  napsa: { employeeBps: number; employerBps: number; ceilingNgwee: number };
  nhima: { employeeBps: number; employerBps: number };
  sdl: { employerBps: number };
  sources: Source[];
}

// New years are registered in src/rates/index.ts: a plain import list rather than
// a Vite glob, so the same code also runs in the API worker.
export const ALL_RATES: readonly Rates[] = (RATE_FILES as Rates[]).slice().sort((a, b) => a.year - b.year);

export function availableYears(): number[] {
  return ALL_RATES.map((r) => r.year);
}

export function latestYear(): number {
  const latest = ALL_RATES[ALL_RATES.length - 1];
  if (!latest) throw new Error('No rate files found in src/rates/');
  return latest.year;
}

export function getRates(year: number): Rates {
  const rates = ALL_RATES.find((r) => r.year === year);
  if (!rates) throw new RangeError(`No rates available for ${year}`);
  return rates;
}

/** Returns a list of problems with a rates file; an empty list means it is valid. */
export function validateRates(rates: Rates): string[] {
  const problems: string[] = [];
  const { bands } = rates.paye;

  if (bands.length === 0) {
    problems.push('no PAYE bands');
  } else {
    if (bands[0]?.fromNgwee !== 0) problems.push('first band must start at 0');
    if (bands[bands.length - 1]?.toNgwee !== null) problems.push('last band must have no upper limit');
  }

  bands.forEach((band, i) => {
    const next = bands[i + 1];
    if (band.toNgwee !== null && band.toNgwee <= band.fromNgwee) {
      problems.push(`band ${i} ends at or before its start`);
    }
    if (next) {
      if (band.toNgwee !== next.fromNgwee) problems.push(`bands ${i} and ${i + 1} are not contiguous`);
      if (next.rateBps <= band.rateBps) problems.push(`rate of band ${i + 1} does not ascend`);
    }
  });

  if (rates.sources.length === 0) problems.push('no sources');
  for (const source of rates.sources) {
    if (!source.url.startsWith('https://')) problems.push(`source is not an https URL: ${source.covers}`);
  }

  const covered = rates.sources.map((s) => s.covers.toLowerCase()).join(' | ');
  for (const topic of ['paye', 'napsa', 'nhima', 'skills development levy']) {
    if (!covered.includes(topic)) problems.push(`no source covers ${topic}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rates.effectiveFrom)) problems.push('effectiveFrom must be YYYY-MM-DD');
  if (!rates.effectiveFrom.startsWith(String(rates.year))) problems.push('effectiveFrom is not in the rate year');

  return problems;
}
