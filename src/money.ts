import { MAX_NGWEE } from './calculator';

export type MoneyError = 'blank' | 'negative' | 'invalid' | 'too-large';
export type ParsedMoney = { ok: true; ngwee: number } | { ok: false; error: MoneyError };

const MONEY_PATTERN = /^(?:K|ZMW)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{0,2}))?$/i;
const NEGATIVE_PATTERN = /^-\s*(?:K|ZMW)?\s*[\d.,]+$|^(?:K|ZMW)\s*-\s*[\d.,]+$/i;

/** Parses typed money such as "12,500", "K8000" or "1234.5" without using floats. */
export function parseMoney(text: string): ParsedMoney {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'blank' };
  if (NEGATIVE_PATTERN.test(trimmed)) return { ok: false, error: 'negative' };

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

/** Formats a basis-point rate as "20%" or "0.5%". */
export function formatRate(bps: number): string {
  return `${bps / 100}%`;
}
