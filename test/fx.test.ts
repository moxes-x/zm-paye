import { describe, expect, it } from 'vitest';
import {
  FX_CACHE_KEY,
  formatForeign,
  fromKwacha,
  loadRates,
  parseErApi,
  parseFawaz,
  rateUnit,
  toKwacha,
  type FxFetch,
  type FxStorage,
} from '../src/fx';

const erApiResponse = {
  result: 'success',
  base_code: 'ZMW',
  time_last_update_unix: 1794441751,
  rates: { ZMW: 1, USD: 0.049004, ZAR: 0.81117, MWK: 85.349562, XYZ: 5, GBP: 'bad', EUR: -1 },
};

const fawazResponse = { date: '2026-11-11', zmw: { usd: 0.049, zar: 0.8111, btc: 0.0000005 } };

const fx = parseErApi(erApiResponse);

describe('parsing', () => {
  it('reads ExchangeRate-API and keeps only offered currencies with valid rates', () => {
    expect(fx.rates).toEqual({ USD: 0.049004, ZAR: 0.81117, MWK: 85.349562 });
    expect(fx.updatedAt).toBe('2026-11-12T00:02:31.000Z');
    expect(fx.source.url).toBe('https://www.exchangerate-api.com');
  });

  it('reads the backup source', () => {
    const backup = parseFawaz(fawazResponse);
    expect(backup.rates).toEqual({ USD: 0.049, ZAR: 0.8111 });
    expect(backup.updatedAt).toBe('2026-11-11T00:00:00.000Z');
  });

  it.each([
    ['an error result', { ...erApiResponse, result: 'error' }],
    ['another base currency', { ...erApiResponse, base_code: 'USD' }],
    ['no usable rates', { ...erApiResponse, rates: { XYZ: 1 } }],
    ['nothing', null],
  ])('rejects %s', (_label, response) => {
    expect(() => parseErApi(response)).toThrow();
  });

  it('rejects a backup response without a date', () => {
    expect(() => parseFawaz({ zmw: { usd: 1 } })).toThrow();
  });
});

describe('conversion', () => {
  it('converts kwacha to another currency', () => {
    expect(fromKwacha(100_000, 'USD', fx)).toBeCloseTo(49.004, 10); // K1,000
  });

  it('converts another currency to ngwee', () => {
    expect(toKwacha(10_000, 'USD', fx)).toBe(204_065); // $100 is K2,040.65
  });

  it('round-trips within a ngwee', () => {
    const dollars = fromKwacha(807_400, 'USD', fx);
    expect(Math.abs(toKwacha(Math.round(dollars * 100), 'USD', fx) - 807_400)).toBeLessThanOrEqual(10);
  });

  it('refuses a currency with no rate', () => {
    expect(() => fromKwacha(100, 'GBP', fx)).toThrow(RangeError);
  });

  it('picks a readable unit for the rate line', () => {
    expect(rateUnit('USD', fx)).toBe(1); // 1 USD = K20.41
    expect(rateUnit('MWK', fx)).toBe(100); // 100 MWK = K1.17
  });

  it('formats with the currency symbol', () => {
    expect(formatForeign(49.004, 'USD')).toBe('$49.00');
  });
});

describe('loadRates', () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 60 * 60 * 1000;

  function memoryStorage(initial?: object): FxStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    if (initial) data.set(FX_CACHE_KEY, JSON.stringify(initial));
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  function fakeFetch(responses: Record<string, unknown>): FxFetch & { calls: string[] } {
    const calls: string[] = [];
    const fn = async (url: string) => {
      calls.push(url);
      const host = Object.keys(responses).find((h) => url.includes(h));
      if (!host) throw new Error('offline');
      return { ok: true, json: async () => responses[host] };
    };
    return Object.assign(fn, { calls });
  }

  const cachedAt = (fetchedAt: number) => ({ ...fx, fetchedAt });

  it('fetches, then saves to the device', async () => {
    const storage = memoryStorage();
    const fetch = fakeFetch({ 'er-api': erApiResponse });
    const loaded = await loadRates({ fetch, storage, now: NOW });
    expect(loaded.stale).toBe(false);
    expect(loaded.rates.USD).toBe(0.049004);
    expect(JSON.parse(storage.data.get(FX_CACHE_KEY) ?? '{}').fetchedAt).toBe(NOW);
  });

  it('uses saved rates under 6 hours old without a request', async () => {
    const fetch = fakeFetch({});
    const loaded = await loadRates({ fetch, storage: memoryStorage(cachedAt(NOW - 5 * HOUR)), now: NOW });
    expect(fetch.calls).toEqual([]);
    expect(loaded.stale).toBe(false);
  });

  it('refreshes saved rates older than 6 hours', async () => {
    const fetch = fakeFetch({ 'er-api': erApiResponse });
    await loadRates({ fetch, storage: memoryStorage(cachedAt(NOW - 7 * HOUR)), now: NOW });
    expect(fetch.calls).toHaveLength(1);
  });

  it('falls back to the backup source', async () => {
    const fetch = fakeFetch({ jsdelivr: fawazResponse });
    const loaded = await loadRates({ fetch, now: NOW });
    expect(fetch.calls).toHaveLength(2);
    expect(loaded.source.url).toContain('fawazahmed0');
  });

  it('skips a source that returns nonsense', async () => {
    const fetch = fakeFetch({ 'er-api': { hello: 'world' }, jsdelivr: fawazResponse });
    expect((await loadRates({ fetch, now: NOW })).rates.USD).toBe(0.049);
  });

  it('uses old saved rates, marked stale, when offline', async () => {
    const loaded = await loadRates({
      fetch: fakeFetch({}),
      storage: memoryStorage(cachedAt(NOW - 72 * HOUR)),
      now: NOW,
    });
    expect(loaded.stale).toBe(true);
    expect(loaded.rates.USD).toBe(0.049004);
  });

  it('fails when offline with nothing saved', async () => {
    await expect(loadRates({ fetch: fakeFetch({}), now: NOW })).rejects.toThrow();
  });

  it('ignores a corrupted or tampered cache', async () => {
    const storage = memoryStorage();
    storage.data.set(FX_CACHE_KEY, '{not json');
    await expect(loadRates({ fetch: fakeFetch({}), storage, now: NOW })).rejects.toThrow();

    const tampered = memoryStorage({ ...cachedAt(NOW), source: { name: 'x', url: 'javascript:alert(1)' } });
    await expect(loadRates({ fetch: fakeFetch({}), storage: tampered, now: NOW })).rejects.toThrow();
  });

  it('keeps working when storage throws', async () => {
    const broken: FxStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const loaded = await loadRates({ fetch: fakeFetch({ 'er-api': erApiResponse }), storage: broken, now: NOW });
    expect(loaded.rates.USD).toBe(0.049004);
  });
});
