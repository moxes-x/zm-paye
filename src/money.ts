import { MAX_NGWEE } from './calculator';

export type MoneyError = 'blank' | 'negative' | 'invalid' | 'too-large';
export type ParsedMoney = { ok: true; ngwee: number } | { ok: false; error: MoneyError };

const MONEY_PATTERN = /^(?:K|ZMW)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?$/i;
const NEGATIVE_PATTERN = /^-\s*(?:K|ZMW)?\s*[\d.,]+[km]?$|^(?:K|ZMW)\s*-\s*[\d.,]+[km]?$/i;
/** Shorthand such as "10k", "6.5k" or "1.2m": thousands or millions, at most to the ngwee. */
const SHORTHAND_PATTERN = /^(?:K|ZMW)?\s*(\d+)(?:\.(\d+))?\s*([km])$/i;

function parseShorthand(match: RegExpExecArray): ParsedMoney {
  const scale = (match[3] ?? '').toLowerCase() === 'k' ? 3 : 6;
  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = match[2] ?? '';
  // Kwacha may have two decimal places, so "1.23456k" (K1,234.56) is fine but "1.234567k" is not.
  if (fraction.length > scale + 2) return { ok: false, error: 'invalid' };
  if (whole.length + scale > 10) return { ok: false, error: 'too-large' };

  const digits = `${whole}${fraction.padEnd(scale + 2, '0')}`;
  const ngwee = Number(digits);
  if (ngwee > MAX_NGWEE) return { ok: false, error: 'too-large' };
  return { ok: true, ngwee };
}

/** Parses typed money such as "12,500", "K8000", "1234.5" or "10k" without using floats. */
export function parseMoney(text: string): ParsedMoney {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'blank' };
  if (NEGATIVE_PATTERN.test(trimmed)) return { ok: false, error: 'negative' };

  const shorthand = SHORTHAND_PATTERN.exec(trimmed);
  if (shorthand) return parseShorthand(shorthand);

  const match = MONEY_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: 'invalid' };

  const whole = (match[1] ?? '').replaceAll(',', '').replace(/^0+(?=\d)/, '');
  if (whole.length > 10) return { ok: false, error: 'too-large' };

  const fraction = (match[2] ?? '').padEnd(2, '0');
  const ngwee = Number(whole) * 100 + Number(fraction);
  if (ngwee > MAX_NGWEE) return { ok: false, error: 'too-large' };

  return { ok: true, ngwee };
}

/** Formats ngwee as "K1,234.50". */
export function formatKwacha(ngwee: number): string {
  const sign = ngwee < 0 ? '-' : '';
  const absolute = Math.abs(ngwee);
  const fraction = String(absolute % 100).padStart(2, '0');
  const whole = String((absolute - (absolute % 100)) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}K${whole}.${fraction}`;
}

/** Formats ngwee for an input box the user keeps editing: "6,500" or "6,500.50", no "K". */
export function formatEditable(ngwee: number): string {
  return formatKwacha(ngwee).slice(1).replace(/\.00$/, '');
}

/**
 * Adds thousands separators to an amount as it is typed, keeping the cursor next to
 * the same digit. Returns null for anything else (such as "10k" mid-way), which is
 * then left exactly as typed.
 */
export function groupTyping(text: string, caret: number): { text: string; caret: number } | null {
  const match = /^(\d[\d,]*)?(\.\d{0,2})?$/.exec(text);
  if (!match || text === '' || !/\d/.test(text)) return null;

  const integer = (match[1] ?? '').replaceAll(',', '');
  const trimmed = integer.replace(/^0+(?=\d)/, '');
  const grouped = trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const next = grouped + (match[2] ?? '');

  // Count the digits and point before the cursor, less any leading zeros removed.
  const removedZeros = integer.length - trimmed.length;
  const before = Math.max(0, text.slice(0, caret).replaceAll(',', '').length - removedZeros);
  let position = 0;
  for (let seen = 0; position < next.length && seen < before; position++) {
    if (next[position] !== ',') seen++;
  }
  return { text: next, caret: position };
}

/** Formats a basis-point rate as "20%" or "0.5%". */
export function formatRate(bps: number): string {
  return `${bps / 100}%`;
}
