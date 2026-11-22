import { describe, expect, it } from 'vitest';
import { formatEditable, formatKwacha, formatRate, groupTyping, parseMoney } from '../src/money';

describe('shorthand amounts', () => {
  it.each([
    ['10k', 1_000_000],
    ['10K', 1_000_000],
    ['6.5k', 650_000],
    ['K12k', 1_200_000],
    ['0.5k', 50_000],
    ['1.2345k', 123_450],
    ['1.23456k', 123_456],
    ['1.2m', 120_000_000],
    ['1000m', 100_000_000_000],
  ])('reads %j', (text, ngwee) => {
    expect(parseMoney(text)).toEqual({ ok: true, ngwee });
  });

  it.each([
    ['k', 'invalid'],
    ['1.234567k', 'invalid'],
    ['1,000k', 'invalid'],
    ['-5k', 'negative'],
    ['1001m', 'too-large'],
    ['10000000k', 'too-large'],
  ])('rejects %j as %s', (text, error) => {
    expect(parseMoney(text)).toEqual({ ok: false, error });
  });
});

describe('formatEditable', () => {
  it.each([
    [650_000, '6,500'],
    [650_050, '6,500.50'],
    [0, '0'],
  ])('formats %d as %j', (ngwee, text) => {
    expect(formatEditable(ngwee)).toBe(text);
  });
});

describe('groupTyping', () => {
  it.each([
    // text, caret before, text after, caret after
    ['6500', 4, '6,500', 5],
    ['65000', 5, '65,000', 6],
    ['6,5000', 6, '65,000', 6],
    ['65,00', 1, '6,500', 1],
    ['1234567.5', 9, '1,234,567.5', 11],
    ['007', 3, '7', 1],
    ['.5', 2, '.5', 2],
    ['12345', 2, '12,345', 2],
  ])('%j with cursor at %d becomes %j', (text, caret, next, nextCaret) => {
    expect(groupTyping(text, caret)).toEqual({ text: next, caret: nextCaret });
  });

  it.each(['', '10k', 'abc', '1.234', 'K100', '.'])('leaves %j alone', (text) => {
    expect(groupTyping(text, text.length)).toBeNull();
  });

  it('only ever regroups to something that parses to the same amount', () => {
    for (const text of ['1', '12', '1234', '12345.6', '999999.99', '1000000']) {
      const grouped = groupTyping(text, text.length);
      expect(parseMoney(grouped?.text ?? '')).toEqual(parseMoney(text));
    }
  });
});

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
