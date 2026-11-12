import { isFxCurrency, type FxCurrency } from './fx';
import { isLang, type Lang } from './i18n';

export type Period = 'monthly' | 'annual';
export type Mode = 'pay' | 'reverse' | 'compare' | 'convert';
export type FxDirection = 'from-kwacha' | 'to-kwacha';
/** Whether pay is entered as one gross figure or as basic salary plus allowances. */
export type PayEntry = 'gross' | 'split';

export const OFFER_LETTERS = ['a', 'b', 'c'] as const;

export interface OfferFields {
  /** Basic salary, or the whole gross pay when entry is 'gross'. */
  basic: string;
  /** Always blank when entry is 'gross'. */
  allowances: string;
}

export interface FormState {
  mode: Mode;
  lang: Lang;
  payEntry: PayEntry;
  /** Basic salary, or the whole gross pay when payEntry is 'gross'. */
  basic: string;
  allowances: string;
  period: Period;
  showEmployer: boolean;
  target: string;
  targetAllowances: string;
  offers: OfferFields[];
  fxAmount: string;
  fxCurrency: FxCurrency;
  fxDirection: FxDirection;
}

function readMode(value: string | null): Mode {
  return value === 'reverse' || value === 'compare' || value === 'convert' ? value : 'pay';
}

/**
 * Gross entry is the default. Links made before it existed use basic= and
 * a_basic= without pay=split, so any split field also means split entry.
 */
function readPayEntry(params: URLSearchParams): PayEntry {
  const splitFields = ['basic', 'allowances', 'target_allowances'].concat(
    OFFER_LETTERS.flatMap((letter) => [`${letter}_basic`, `${letter}_allowances`]),
  );
  return params.get('pay') === 'split' || splitFields.some((name) => params.has(name)) ? 'split' : 'gross';
}

/** Reads form state from a URL query such as `?gross=10000&period=annual`. */
export function readQuery(search: string): FormState {
  const params = new URLSearchParams(search);
  const lang = params.get('lang');
  const currency = params.get('fx_currency') ?? '';
  const payEntry = readPayEntry(params);
  const split = payEntry === 'split';
  const get = (name: string) => params.get(name) ?? '';

  return {
    mode: readMode(params.get('mode')),
    lang: isLang(lang) ? lang : 'en',
    payEntry,
    basic: split ? get('basic') : get('gross'),
    allowances: split ? get('allowances') : '',
    period: params.get('period') === 'annual' ? 'annual' : 'monthly',
    showEmployer: params.get('employer') === '1',
    target: get('target'),
    targetAllowances: split ? get('target_allowances') : '',
    offers: OFFER_LETTERS.map((letter) => ({
      basic: split ? get(`${letter}_basic`) : get(`${letter}_gross`),
      allowances: split ? get(`${letter}_allowances`) : '',
    })),
    fxAmount: get('fx_amount'),
    fxCurrency: isFxCurrency(currency) ? currency : 'USD',
    fxDirection: params.get('fx_dir') === 'to' ? 'to-kwacha' : 'from-kwacha',
  };
}

/** Writes form state as a query string, leaving out anything at its default. */
export function writeQuery(state: FormState): string {
  const params = new URLSearchParams();
  const setText = (name: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) params.set(name, trimmed);
  };
  const split = state.payEntry === 'split';

  if (state.mode !== 'pay') params.set('mode', state.mode);
  if (state.lang !== 'en') params.set('lang', state.lang);
  if (split) params.set('pay', 'split');
  setText(split ? 'basic' : 'gross', state.basic);
  if (split) setText('allowances', state.allowances);
  if (state.period === 'annual') params.set('period', 'annual');
  if (state.showEmployer) params.set('employer', '1');
  setText('target', state.target);
  if (split) setText('target_allowances', state.targetAllowances);
  OFFER_LETTERS.forEach((letter, i) => {
    setText(`${letter}_${split ? 'basic' : 'gross'}`, state.offers[i]?.basic);
    if (split) setText(`${letter}_allowances`, state.offers[i]?.allowances);
  });
  setText('fx_amount', state.fxAmount);
  if (state.fxCurrency !== 'USD') params.set('fx_currency', state.fxCurrency);
  if (state.fxDirection === 'to-kwacha') params.set('fx_dir', 'to');

  const query = params.toString();
  return query ? `?${query}` : '';
}
