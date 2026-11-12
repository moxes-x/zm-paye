import { describe, expect, it } from 'vitest';
import { ALL_RATES, availableYears, getRates, latestYear, validateRates, type Rates } from '../src/rateTable';

describe.each(ALL_RATES.map((rates) => [rates.year, rates] as const))('rates/%d.json', (_year, rates) => {
  it('passes every structural check', () => {
    expect(validateRates(rates)).toEqual([]);
  });
});

describe('2026 values', () => {
  it('matches the published bands, annualised to the PwC table', () => {
    const limits = getRates(2026).paye.bands.map((b) => b.toNgwee && b.toNgwee * 12);
    expect(limits).toEqual([6_120_000, 8_520_000, 11_040_000, null]);
  });
});

describe('registry', () => {
  it('registers every JSON file in src/rates/', () => {
    const onDisk = import.meta.glob<Rates>('../src/rates/*.json', { eager: true, import: 'default' });
    const yearsOnDisk = Object.values(onDisk).map((r) => r.year).sort();
    expect(availableYears()).toEqual(yearsOnDisk);
  });

  it('finds the rate files', () => {
    expect(availableYears()).toContain(2026);
    expect(latestYear()).toBeGreaterThanOrEqual(2026);
  });
});

describe('validateRates catches broken files', () => {
  const clone = (): Rates => structuredClone(getRates(2026));

  it('a gap between bands', () => {
    const rates = clone();
    rates.paye.bands[1]!.fromNgwee = 510_001;
    expect(validateRates(rates)).toContain('bands 0 and 1 are not contiguous');
  });

  it('a falling rate', () => {
    const rates = clone();
    rates.paye.bands[3]!.rateBps = 2500;
    expect(validateRates(rates)).toContain('rate of band 3 does not ascend');
  });

  it('a capped top band', () => {
    const rates = clone();
    rates.paye.bands[3]!.toNgwee = 2_000_000;
    expect(validateRates(rates)).toContain('last band must have no upper limit');
  });

  it('missing sources', () => {
    const rates = clone();
    rates.sources = [];
    expect(validateRates(rates)).toContain('no sources');
  });

  it('a topic with no source', () => {
    const rates = clone();
    rates.sources = rates.sources.filter((s) => !s.covers.includes('NHIMA'));
    expect(validateRates(rates)).toContain('no source covers nhima');
  });
});
