import { describe, expect, it } from 'vitest';
import worker, { kwacha } from '../server/app';

const BASE = 'https://api.example.test';

async function call(path: string, init?: RequestInit) {
  const response = await worker.fetch(new Request(`${BASE}${path}`, init));
  return { status: response.status, headers: response.headers, body: (await response.json().catch(() => null)) as any };
}

const post = (path: string, body: unknown) =>
  call(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('kwacha strings', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [586_250, '5862.50'],
    [100_000_000_000, '1000000000.00'],
    [-15_000, '-150.00'],
  ])('%d ngwee is "%s"', (ngwee, text) => {
    expect(kwacha(ngwee)).toBe(text);
  });
});

describe('GET /v1/take-home', () => {
  it('works out the K10,000 golden case from gross', async () => {
    const { status, body } = await call('/v1/take-home?gross=10000');
    expect(status).toBe(200);
    expect(body.monthly).toEqual({ gross: '10000.00', paye: '1326.00', napsa: '500.00', nhima: '100.00', net: '8074.00' });
    expect(body.input.nhimaAssumesAllBasic).toBe(true);
    expect(body.notes).toHaveLength(1);
  });

  it('uses basic with gross for exact NHIMA', async () => {
    const { body } = await call('/v1/take-home?gross=10000&basic=8000');
    expect(body.input).toEqual({ basic: '8000.00', allowances: '2000.00', nhimaAssumesAllBasic: false });
    expect(body.monthly.nhima).toBe('80.00');
    expect(body.monthly.net).toBe('8094.00');
    expect(body.notes).toEqual([]);
  });

  it('gives the same answer for basic plus allowances', async () => {
    const a = await call('/v1/take-home?gross=10000&basic=8000');
    const b = await call('/v1/take-home?basic=8000&allowances=2000');
    expect(b.body.monthly).toEqual(a.body.monthly);
  });

  it('includes annual figures, PAYE bands and employer cost', async () => {
    const { body } = await call('/v1/take-home?gross=10000');
    expect(body.annual.net).toBe('96888.00');
    expect(body.payeBands.map((b: { tax: string }) => b.tax)).toEqual(['0.00', '400.00', '630.00', '296.00']);
    expect(body.payeBands[3]).toEqual({ from: '9200.00', to: null, ratePercent: 37, taxable: '800.00', tax: '296.00' });
    expect(body.employerCost).toEqual({ napsa: '500.00', nhima: '100.00', sdl: '50.00', total: '10650.00' });
  });

  it('accepts commas and decimals', async () => {
    const { body } = await call('/v1/take-home?gross=12,500.50');
    expect(body.monthly.gross).toBe('12500.50');
  });

  it('uses a requested year', async () => {
    expect((await call('/v1/take-home?gross=1&year=2026')).body.year).toBe(2026);
  });

  it.each([
    ['', 'missing-field', 'gross'],
    ['?gross=12a', 'invalid-amount', 'gross'],
    ['?gross=-5', 'invalid-amount', 'gross'],
    ['?gross=99999999999', 'invalid-amount', 'gross'],
    ['?gross=1000&allowances=200', 'conflicting-fields', 'allowances'],
    ['?gross=1000&basic=2000', 'basic-exceeds-gross', 'basic'],
    ['?allowances=500', 'missing-field', 'gross'],
    ['?gross=1000&year=1999', 'unknown-year', 'year'],
  ])('rejects %j with %s', async (query, code, field) => {
    const { status, body } = await call(`/v1/take-home${query}`);
    expect(status).toBe(400);
    expect(body.error).toMatchObject({ code, field });
  });
});

describe('GET /v1/required-salary', () => {
  it('finds the gross for a target take-home', async () => {
    const { status, body } = await call('/v1/required-salary?net=8074');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.monthly.gross).toBe('10000.00');
    expect(body.monthly.net).toBe('8074.00');
  });

  it('holds allowances fixed', async () => {
    const { body } = await call('/v1/required-salary?net=8074&allowances=2000');
    expect(body.allowances).toBe('2000.00');
    expect(body.monthly.net).toBe('8074.00');
  });

  it('says when allowances already beat the target', async () => {
    const { body } = await call('/v1/required-salary?net=1000&allowances=3000');
    expect(body.status).toBe('allowances-exceed-target');
    expect(body.basic).toBe('0.00');
  });

  it('rejects a missing or unreachable target', async () => {
    expect((await call('/v1/required-salary')).body.error.code).toBe('missing-field');
    const tooHigh = await call('/v1/required-salary?net=999999999');
    expect(tooHigh.status).toBe(422);
    expect(tooHigh.body.error.code).toBe('out-of-range');
  });
});

describe('POST /v1/compare', () => {
  it('compares offers in either style and marks the best', async () => {
    const { status, body } = await post('/v1/compare', {
      offers: [{ gross: '10000' }, { basic: 5000, allowances: 5000 }, { gross: '20000', basic: '20000' }],
    });
    expect(status).toBe(200);
    expect(body.offers.map((o: { monthly: { net: string } }) => o.monthly.net)).toEqual(['8074.00', '8124.00', '13774.00']);
    expect(body.offers.map((o: { netDifferenceFromFirst: string }) => o.netDifferenceFromFirst)).toEqual([
      '0.00',
      '50.00',
      '5700.00',
    ]);
    expect(body.best).toEqual([2]);
    expect(body.notes).toHaveLength(1);
  });

  it.each([
    ['not JSON', '{oops', 'invalid-json'],
    ['one offer', { offers: [{ gross: 1 }] }, 'invalid-offers'],
    ['eleven offers', { offers: Array.from({ length: 11 }, () => ({ gross: 1 })) }, 'invalid-offers'],
    ['a non-object offer', { offers: [{ gross: 1 }, 5] }, 'invalid-offers'],
    ['a bad amount', { offers: [{ gross: 1 }, { gross: 'lots' }] }, 'invalid-amount'],
  ])('rejects %s', async (_label, body, code) => {
    const response = await post('/v1/compare', body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
  });

  it('names the offer in error fields', async () => {
    const { body } = await post('/v1/compare', { offers: [{ gross: 1 }, { gross: 'lots' }] });
    expect(body.error.field).toBe('offers[1].gross');
  });
});

describe('rates', () => {
  it('lists years', async () => {
    const { body } = await call('/v1/rates');
    expect(body.years).toContain(2026);
  });

  it('returns a year with sources', async () => {
    const { body } = await call('/v1/rates/2026');
    expect(body.paye.bands).toHaveLength(4);
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it('404s an unknown year', async () => {
    expect((await call('/v1/rates/1999')).status).toBe(404);
  });
});

describe('HTTP behaviour', () => {
  it('describes itself at the root', async () => {
    const { status, body } = await call('/');
    expect(status).toBe(200);
    expect(body.endpoints).toHaveProperty(['GET /v1/take-home']);
  });

  it('allows any website to call it', async () => {
    const { headers } = await call('/v1/take-home?gross=1');
    expect(headers.get('access-control-allow-origin')).toBe('*');
    expect(headers.get('cache-control')).toContain('max-age');
  });

  it('answers CORS preflight', async () => {
    const response = await worker.fetch(new Request(`${BASE}/v1/compare`, { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('does not cache errors', async () => {
    const { headers } = await call('/v1/take-home');
    expect(headers.get('cache-control')).toBe('no-store');
  });

  it('rejects the wrong method', async () => {
    const { status, headers } = await call('/v1/take-home?gross=1', { method: 'POST' });
    expect(status).toBe(405);
    expect(headers.get('allow')).toContain('GET');
    expect((await call('/v1/compare')).status).toBe(405);
  });

  it('404s unknown paths', async () => {
    const { status, body } = await call('/v2/anything');
    expect(status).toBe(404);
    expect(body.error.code).toBe('not-found');
  });

  it('routes Vercel rewrites by the __route parameter', async () => {
    const { status, body } = await call('/api?__route=/v1/take-home&gross=10000');
    expect(status).toBe(200);
    expect(body.monthly.net).toBe('8074.00');
    expect((await call('/api?__route=/v1/rates/2026')).body.year).toBe(2026);
  });

  it('describes itself at /api', async () => {
    expect((await call('/api')).body.version).toBe('v1');
  });

  it('ignores a trailing slash', async () => {
    expect((await call('/v1/take-home/?gross=1')).status).toBe(200);
  });
});
