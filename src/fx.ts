/** Currencies offered in the converter, most relevant to Zambia first. */
export const FX_CURRENCIES = ['USD', 'ZAR', 'GBP', 'EUR', 'CNY', 'BWP', 'MWK', 'TZS', 'KES', 'AED', 'INR', 'AUD', 'CAD'] as const;

export type FxCurrency = (typeof FX_CURRENCIES)[number];

export interface FxSource {
  name: string;
  url: string;
}

/** Rates are units of each currency per 1 kwacha. */
export interface FxRates {
  rates: Partial<Record<FxCurrency, number>>;
  updatedAt: string;
  source: FxSource;
}

export interface LoadedRates extends FxRates {
  fetchedAt: number;
  /** True when every source failed and these are older saved rates. */
  stale: boolean;
}

export function isFxCurrency(value: string): value is FxCurrency {
  return (FX_CURRENCIES as readonly string[]).includes(value);
}

/** Keeps only offered currencies with a usable rate. Responses are untrusted. */
function cleanRates(raw: unknown, keyFor: (code: FxCurrency) => string): FxRates['rates'] {
  if (!raw || typeof raw !== 'object') throw new Error('Response has no rates');
  const table = raw as Record<string, unknown>;
  const rates: FxRates['rates'] = {};
  for (const code of FX_CURRENCIES) {
    const value = table[keyFor(code)];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code] = value;
  }
  if (Object.keys(rates).length === 0) throw new Error('Response has no usable rates');
  return rates;
}

/** Parses https://open.er-api.com/v6/latest/ZMW */
export function parseErApi(json: unknown): FxRates {
  const data = (json ?? {}) as Record<string, unknown>;
  if (data.result !== 'success' || data.base_code !== 'ZMW' || typeof data.time_last_update_unix !== 'number') {
    throw new Error('Unexpected response from ExchangeRate-API');
  }
  return {
    rates: cleanRates(data.rates, (code) => code),
    updatedAt: new Date(data.time_last_update_unix * 1000).toISOString(),
    source: { name: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' },
  };
}

/** Parses the fawazahmed0 currency API response for ZMW. */
export function parseFawaz(json: unknown): FxRates {
  const data = (json ?? {}) as Record<string, unknown>;
  if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    throw new Error('Unexpected response from the backup rates source');
  }
  return {
    rates: cleanRates(data.zmw, (code) => code.toLowerCase()),
    updatedAt: `${data.date}T00:00:00.000Z`,
    source: { name: 'Rates from fawazahmed0/exchange-api', url: 'https://github.com/fawazahmed0/exchange-api' },
  };
}

export const FX_SOURCES: readonly [string, (json: unknown) => FxRates][] = [
  ['https://open.er-api.com/v6/latest/ZMW', parseErApi],
  ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/zmw.min.json', parseFawaz],
];

function rateFor(code: FxCurrency, fx: FxRates): number {
  const rate = fx.rates[code];
  if (!rate) throw new RangeError(`No rate for ${code}`);
  return rate;
}

/** Converts ngwee to an amount in the other currency's main unit, such as dollars. */
export function fromKwacha(ngwee: number, code: FxCurrency, fx: FxRates): number {
  return (ngwee / 100) * rateFor(code, fx);
}

/** Converts hundredths of the other currency, such as cents, to ngwee. */
export function toKwacha(hundredths: number, code: FxCurrency, fx: FxRates): number {
  return Math.round(hundredths / rateFor(code, fx));
}

/** The smallest power of ten of a currency worth at least K1, for a readable rate line. */
export function rateUnit(code: FxCurrency, fx: FxRates): number {
  const rate = rateFor(code, fx);
  let unit = 1;
  while (unit / rate < 1 && unit < 1_000_000) unit *= 10;
  return unit;
}

export function formatForeign(amount: number, code: FxCurrency): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'symbol' }).format(amount);
}

export function currencyName(code: FxCurrency): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

// Loading, with a device cache. The free source updates daily and asks for
// no more than one request an hour; caching is permitted by its terms.

export const FX_CACHE_KEY = 'zm-paye:fx:v1';
const FRESH_FOR_MS = 6 * 60 * 60 * 1000;

export interface FxStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FxFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function readCache(storage: FxStorage | undefined): (FxRates & { fetchedAt: number }) | null {
  try {
    const text = storage?.getItem(FX_CACHE_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as Record<string, unknown>;
    const source = data.source as Record<string, unknown> | undefined;
    if (
      typeof data.fetchedAt !== 'number' ||
      typeof data.updatedAt !== 'string' ||
      typeof source?.name !== 'string' ||
      typeof source.url !== 'string' ||
      !source.url.startsWith('https://')
    ) {
      return null;
    }
    return {
      rates: cleanRates(data.rates, (code) => code),
      updatedAt: data.updatedAt,
      source: { name: source.name, url: source.url },
      fetchedAt: data.fetchedAt,
    };
  } catch {
    return null;
  }
}

function writeCache(storage: FxStorage | undefined, value: FxRates & { fetchedAt: number }): void {
  try {
    storage?.setItem(FX_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; the converter still works without it.
  }
}

export async function loadRates(options: { fetch: FxFetch; storage?: FxStorage; now: number }): Promise<LoadedRates> {
  const { fetch, storage, now } = options;
  const cached = readCache(storage);
  if (cached && now - cached.fetchedAt < FRESH_FOR_MS) return { ...cached, stale: false };

  for (const [url, parse] of FX_SOURCES) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const fresh = { ...parse(await response.json()), fetchedAt: now };
      writeCache(storage, fresh);
      return { ...fresh, stale: false };
    } catch {
      // Try the next source.
    }
  }

  if (cached) return { ...cached, stale: true };
  throw new Error('Exchange rates are unavailable');
}
