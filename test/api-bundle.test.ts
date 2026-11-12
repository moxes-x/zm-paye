import { describe, expect, it } from 'vitest';

// api/index.js is what Vercel actually runs. Check the built file, not just the source.
// CI rebuilds it and fails if the committed copy is out of date.
const bundlePath = '../api/index.js';

describe('api/index.js bundle', () => {
  it('is self-contained, with no imports to resolve at runtime', async () => {
    const source = (await import(/* @vite-ignore */ `${bundlePath}?raw`)).default as string;
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it('answers a rewritten request', async () => {
    const api = (await import(/* @vite-ignore */ bundlePath)).default as {
      fetch(request: Request): Promise<Response>;
    };
    const response = await api.fetch(new Request('https://zm-paye.example/api?__route=/v1/take-home&gross=10000&basic=8000'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { monthly: { net: string } };
    expect(body.monthly.net).toBe('8094.00');
  });
});
