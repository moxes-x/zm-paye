import { isLang, type Lang } from './i18n';

export type Period = 'monthly' | 'annual';
export type Mode = 'pay' | 'reverse' | 'compare';

export const OFFER_LETTERS = ['a', 'b', 'c'] as const;

export interface OfferFields {
  basic: string;
  allowances: string;
}

export interface FormState {
  mode: Mode;
  lang: Lang;
  basic: string;
  allowances: string;
  period: Period;
  showEmployer: boolean;
  target: string;
  targetAllowances: string;
  offers: OfferFields[];
}

function readMode(value: string | null): Mode {
  return value === 'reverse' || value === 'compare' ? value : 'pay';
}

/** Reads form state from a URL query such as `?basic=8000&period=annual`. */
export function readQuery(search: string): FormState {
  const params = new URLSearchParams(search);
  const lang = params.get('lang');
  return {
    mode: readMode(params.get('mode')),
    lang: isLang(lang) ? lang : 'en',
    basic: params.get('basic') ?? '',
    allowances: params.get('allowances') ?? '',
    period: params.get('period') === 'annual' ? 'annual' : 'monthly',
    showEmployer: params.get('employer') === '1',
    target: params.get('target') ?? '',
    targetAllowances: params.get('target_allowances') ?? '',
    offers: OFFER_LETTERS.map((letter) => ({
      basic: params.get(`${letter}_basic`) ?? '',
      allowances: params.get(`${letter}_allowances`) ?? '',
    })),
  };
}

/** Writes form state as a query string, leaving out anything at its default. */
export function writeQuery(state: FormState): string {
  const params = new URLSearchParams();
  const setText = (name: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) params.set(name, trimmed);
  };

  if (state.mode !== 'pay') params.set('mode', state.mode);
  if (state.lang !== 'en') params.set('lang', state.lang);
  setText('basic', state.basic);
  setText('allowances', state.allowances);
  if (state.period === 'annual') params.set('period', 'annual');
  if (state.showEmployer) params.set('employer', '1');
  setText('target', state.target);
  setText('target_allowances', state.targetAllowances);
  OFFER_LETTERS.forEach((letter, i) => {
    setText(`${letter}_basic`, state.offers[i]?.basic);
    setText(`${letter}_allowances`, state.offers[i]?.allowances);
  });

  const query = params.toString();
  return query ? `?${query}` : '';
}
