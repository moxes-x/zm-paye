// Zambia take-home pay API: a Web-standard fetch handler over the same functions the website uses.
// It is bundled into api/index.js (npm run build:api) and served by Vercel at /v1/...
// Amounts go in as kwacha ("6500" or "6,500.50") and come out as decimal strings ("5862.50"),
// so no client has to deal with floating-point money.
import { calculate, type PayResult } from '../src/calculator';
import { compareOffers } from '../src/compare';
import { parseMoney, type MoneyError } from '../src/money';
import { availableYears, getRates, latestYear } from '../src/rateTable';
import { requiredPay } from '../src/reverse';

const MAX_OFFERS = 10;
const DOCS_URL = 'https://github.com/moxes-x/zm-paye#api';

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      // Answers only change when a rates file changes, so successful reads cache well.
      'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
      ...extraHeaders,
    },
  });
}

/** Formats ngwee as a plain decimal string: 586250 -> "5862.50". */
export function kwacha(ngwee: number): string {
  const sign = ngwee < 0 ? '-' : '';
  const absolute = Math.abs(ngwee);
  return `${sign}${(absolute - (absolute % 100)) / 100}.${String(absolute % 100).padStart(2, '0')}`;
}

// Input

type Getter = (name: string) => unknown;

const AMOUNT_ERRORS: Record<Exclude<MoneyError, 'blank'>, string> = {
  negative: 'must be zero or more',
  invalid: 'must be an amount such as 6500 or 6500.50',
  'too-large': 'must be at most 1000000000',
};

function readAmount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ApiError(400, 'invalid-amount', `${field} ${AMOUNT_ERRORS.invalid}`, field);
  }
  const parsed = parseMoney(String(value));
  if (parsed.ok) return parsed.ngwee;
  if (parsed.error === 'blank') return undefined;
  throw new ApiError(400, 'invalid-amount', `${field} ${AMOUNT_ERRORS[parsed.error]}`, field);
}

function readYear(value: unknown): number {
  if (value === undefined || value === null || value === '') return latestYear();
  const year = Number(value);
  if (!Number.isInteger(year) || !availableYears().includes(year)) {
    throw new ApiError(400, 'unknown-year', `year must be one of ${availableYears().join(', ')}`, 'year');
  }
  return year;
}

interface PayInputs {
  basic: number;
  allowances: number;
  /** True when only gross was given, so NHIMA is worked out on the whole gross. */
  assumedAllBasic: boolean;
}

/**
 * Accepts gross alone, gross with basic (allowances are the rest), or basic with
 * optional allowances. Field names are prefixed for errors inside a compare body.
 */
function readPay(get: Getter, prefix = ''): PayInputs {
  const name = (field: string) => `${prefix}${field}`;
  const gross = readAmount(get('gross'), name('gross'));
  const basic = readAmount(get('basic'), name('basic'));
  const allowances = readAmount(get('allowances'), name('allowances'));

  if (gross !== undefined) {
    if (allowances !== undefined) {
      throw new ApiError(
        400,
        'conflicting-fields',
        `Send ${name('gross')} (with ${name('basic')} if known), or ${name('basic')} and ${name('allowances')}, not both styles`,
        name('allowances'),
      );
    }
    if (basic === undefined) return { basic: gross, allowances: 0, assumedAllBasic: true };
    if (basic > gross) {
      throw new ApiError(400, 'basic-exceeds-gross', `${name('basic')} cannot be more than ${name('gross')}`, name('basic'));
    }
    return { basic, allowances: gross - basic, assumedAllBasic: false };
  }

  if (basic === undefined) {
    throw new ApiError(400, 'missing-field', `Send ${name('gross')}, or ${name('basic')} with optional ${name('allowances')}`, name('gross'));
  }
  return { basic, allowances: allowances ?? 0, assumedAllBasic: false };
}

// Output

const ALL_BASIC_NOTE =
  'Only gross was given, so NHIMA is 1% of the whole gross. NHIMA is charged on basic salary only; send basic for an exact figure.';

function amounts(result: PayResult, factor = 1) {
  return {
    gross: kwacha(result.gross * factor),
    paye: kwacha(result.paye * factor),
    napsa: kwacha(result.napsa * factor),
    nhima: kwacha(result.nhima * factor),
    net: kwacha(result.net * factor),
  };
}

function inputSummary(pay: PayInputs) {
  return {
    basic: kwacha(pay.basic),
    allowances: kwacha(pay.allowances),
    nhimaAssumesAllBasic: pay.assumedAllBasic,
  };
}

function takeHomeBody(result: PayResult, pay: PayInputs) {
  return {
    year: result.year,
    input: inputSummary(pay),
    monthly: amounts(result),
    annual: amounts(result, 12),
    payeBands: result.payeByBand.map((band) => ({
      from: kwacha(band.fromNgwee),
      to: band.toNgwee === null ? null : kwacha(band.toNgwee),
      ratePercent: band.rateBps / 100,
      taxable: kwacha(band.amountNgwee),
      tax: kwacha(band.taxNgwee),
    })),
    employerCost: {
      napsa: kwacha(result.employerCost.napsa),
      nhima: kwacha(result.employerCost.nhima),
      sdl: kwacha(result.employerCost.sdl),
      total: kwacha(result.employerCost.total),
    },
    notes: pay.assumedAllBasic ? [ALL_BASIC_NOTE] : [],
  };
}

// Endpoints

function takeHome(url: URL): Response {
  const get: Getter = (name) => url.searchParams.get(name) ?? undefined;
  const year = readYear(get('year'));
  const pay = readPay(get);
  return json(takeHomeBody(calculate({ basic: pay.basic, allowances: pay.allowances, year }), pay));
}

function requiredSalary(url: URL): Response {
  const get: Getter = (name) => url.searchParams.get(name) ?? undefined;
  const year = readYear(get('year'));
  const targetNet = readAmount(get('net'), 'net');
  if (targetNet === undefined) throw new ApiError(400, 'missing-field', 'Send net, the take-home pay wanted', 'net');
  const allowances = readAmount(get('allowances'), 'allowances') ?? 0;

  const solved = requiredPay({ targetNet, allowances, year });
  if (solved.status === 'out-of-range') {
    throw new ApiError(422, 'out-of-range', 'That take-home needs a salary above the K1,000,000,000 limit', 'net');
  }
  return json({
    year,
    status: solved.status,
    basic: kwacha(solved.basic),
    allowances: kwacha(allowances),
    monthly: amounts(solved.result),
    notes:
      solved.status === 'allowances-exceed-target'
        ? ['The allowances alone give more take-home than the target, so basic is 0.']
        : ['Allowances are held fixed and the rest is treated as basic salary.'],
  });
}

async function compare(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'invalid-json', 'Send a JSON body such as {"offers":[{"gross":"12000"},{"gross":"14000"}]}');
  }

  const data = (body ?? {}) as Record<string, unknown>;
  const offers = data.offers;
  if (!Array.isArray(offers) || offers.length < 2 || offers.length > MAX_OFFERS) {
    throw new ApiError(400, 'invalid-offers', `offers must be a list of 2 to ${MAX_OFFERS} offers`, 'offers');
  }

  const year = readYear(data.year);
  const inputs = offers.map((offer, i) => {
    if (!offer || typeof offer !== 'object') {
      throw new ApiError(400, 'invalid-offers', `offers[${i}] must be an object`, `offers[${i}]`);
    }
    const fields = offer as Record<string, unknown>;
    return readPay((name) => fields[name], `offers[${i}].`);
  });

  const compared = compareOffers(
    inputs.map(({ basic, allowances }) => ({ basic, allowances })),
    year,
  );
  return json({
    year,
    offers: compared.map((c, i) => ({
      index: i,
      input: inputSummary(inputs[i] as PayInputs),
      monthly: amounts(c.result),
      netDifferenceFromFirst: kwacha(c.netDifference),
      isBest: c.isBest,
    })),
    best: compared.flatMap((c, i) => (c.isBest ? [i] : [])),
    notes: inputs.some((p) => p.assumedAllBasic) ? [ALL_BASIC_NOTE] : [],
  });
}

function index(): Response {
  return json({
    name: 'Zambia take-home pay API',
    version: 'v1',
    docs: DOCS_URL,
    ratesYears: availableYears(),
    endpoints: {
      'GET /v1/take-home': '?gross=6500&basic=3250, or ?basic=3250&allowances=3250. Optional: year',
      'GET /v1/required-salary': '?net=8074. Optional: allowances, year',
      'POST /v1/compare': '{"offers":[{"gross":"12000"},{"basic":"5000","allowances":"5000"}]}',
      'GET /v1/rates': 'Years with rates',
      'GET /v1/rates/{year}': 'Bands, contribution rates and sources for a year',
    },
    disclaimer: 'Estimates, not tax advice. Check anything important with ZRA or your payroll office.',
  });
}

function requireMethod(request: Request, method: 'GET' | 'POST'): void {
  if (request.method !== method) {
    throw new ApiError(405, 'method-not-allowed', `Use ${method} for this endpoint`);
  }
}

/**
 * vercel.json rewrites /v1/... to the function at /api with the original path in
 * __route, so routing works whichever URL the platform hands the function.
 */
function routePath(url: URL): string {
  const rewritten = url.searchParams.get('__route');
  const path = (rewritten ?? url.pathname).replace(/\/+$/, '') || '/';
  return path === '/api' ? '/' : path;
}

async function route(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  const url = new URL(request.url);
  const path = routePath(url);

  switch (path) {
    case '/':
    case '/v1':
      requireMethod(request, 'GET');
      return index();
    case '/v1/take-home':
      requireMethod(request, 'GET');
      return takeHome(url);
    case '/v1/required-salary':
      requireMethod(request, 'GET');
      return requiredSalary(url);
    case '/v1/compare':
      requireMethod(request, 'POST');
      return compare(request);
    case '/v1/rates':
      requireMethod(request, 'GET');
      return json({ years: availableYears(), latest: latestYear() });
  }

  const ratesMatch = /^\/v1\/rates\/(\d{4})$/.exec(path);
  if (ratesMatch) {
    requireMethod(request, 'GET');
    const year = Number(ratesMatch[1]);
    if (!availableYears().includes(year)) throw new ApiError(404, 'unknown-year', `No rates for ${year}`);
    return json(getRates(year));
  }

  throw new ApiError(404, 'not-found', `No endpoint at ${path}. See ${DOCS_URL}`);
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof ApiError) {
        const headers: Record<string, string> = error.status === 405 ? { Allow: 'GET, POST, OPTIONS' } : {};
        return json({ error: { code: error.code, message: error.message, field: error.field } }, error.status, headers);
      }
      return json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
    }
  },
};
