import { describe, expect, it } from 'vitest';
import { formatKwacha, formatRate, parseMoney } from '../src/money';

describe('parseMoney', () => {
  it.each([
    ['0', 0],
    ['8000', 800_000],
    ['12,500', 1_250_000],
    ['1,234,567.89', 123_456_789],
    ['1234.5', 123_450],
    ['1234.', 123_400],
    ['K8000', 800_000],
    ['k 8,000.50', 800_050],
    ['ZMW 100', 10_000],
    ['  42  ', 4_200],
    ['007', 700],
    ['1000000000', 100_000_000_000],
  ])('reads %j', (text, ngwee) => {
    expect(parseMoney(text)).toEqual({ ok: true, ngwee });
  });

  it('avoids floating-point error on values like 1.15', () => {
    expect(parseMoney('1.15')).toEqual({ ok: true, ngwee: 115 });
    expect(parseMoney('4.35')).toEqual({ ok: true, ngwee: 435 });
  });

  it.each([
    ['', 'blank'],
    ['   ', 'blank'],
    ['-100', 'negative'],
    ['- 100', 'negative'],
    ['-K100', 'negative'],
    ['K-100', 'negative'],
    ['abc', 'invalid'],
    ['12a', 'invalid'],
    ['1,2,3', 'invalid'],
    ['12,50', 'invalid'],
    ['1.234', 'invalid'],
    ['1e5', 'invalid'],
    ['1000000000.01', 'too-large'],
    ['99999999999999', 'too-large'],
  ])('rejects %j as %s', (text, error) => {
    expect(parseMoney(text)).toEqual({ ok: false, error });
  });
});

describe('formatKwacha', () => {
  it.each([
    [0, 'K0.00'],
    [5, 'K0.05'],
    [186_180, 'K1,861.80'],
    [100_000_000_000, 'K1,000,000,000.00'],
    [-150, '-K1.50'],
  ])('formats %d', (ngwee, text) => {
    expect(formatKwacha(ngwee)).toBe(text);
  });
});

describe('formatRate', () => {
  it('formats whole and fractional percentages', () => {
    expect(formatRate(3700)).toBe('37%');
    expect(formatRate(50)).toBe('0.5%');
  });
});
