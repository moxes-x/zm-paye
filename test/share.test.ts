import { describe, expect, it } from 'vitest';
import { readQuery, writeQuery, type FormState } from '../src/share';

const blankOffers = [
  { basic: '', allowances: '' },
  { basic: '', allowances: '' },
  { basic: '', allowances: '' },
];

const defaults: FormState = {
  mode: 'pay',
  lang: 'en',
  payEntry: 'gross',
  basic: '',
  allowances: '',
  period: 'monthly',
  showEmployer: false,
  target: '',
  targetAllowances: '',
  offers: blankOffers,
  fxAmount: '',
  fxCurrency: 'USD',
  fxDirection: 'from-kwacha',
};

describe('shareable URLs', () => {
  it('starts with gross pay entry', () => {
    expect(readQuery('')).toEqual(defaults);
  });

  it('reads gross pay', () => {
    expect(readQuery('?gross=10000')).toEqual({ ...defaults, basic: '10000' });
  });

  it('keeps old basic= links working as split entry', () => {
    expect(readQuery('?basic=8000')).toEqual({ ...defaults, payEntry: 'split', basic: '8000' });
  });

  it('keeps old offer links working as split entry', () => {
    const state = readQuery('?mode=compare&a_basic=9000&b_basic=11000');
    expect(state.payEntry).toBe('split');
    expect(state.offers[0]?.basic).toBe('9000');
  });

  it('round-trips a split state', () => {
    const state: FormState = {
      mode: 'compare',
      lang: 'ny',
      payEntry: 'split',
      basic: '12500',
      allowances: '2000',
      period: 'annual',
      showEmployer: true,
      target: '8000',
      targetAllowances: '500',
      offers: [
        { basic: '9000', allowances: '1000' },
        { basic: '11000', allowances: '' },
        { basic: '', allowances: '' },
      ],
      fxAmount: '250',
      fxCurrency: 'ZAR',
      fxDirection: 'to-kwacha',
    };
    expect(readQuery(writeQuery(state))).toEqual(state);
  });

  it('writes amounts without thousands separators', () => {
    expect(writeQuery({ ...defaults, basic: '1,250,000.50' })).toBe('?gross=1250000.50');
  });

  it('round-trips a gross state', () => {
    const state: FormState = {
      ...defaults,
      mode: 'compare',
      basic: '15000',
      target: '9000',
      offers: [
        { basic: '12000', allowances: '' },
        { basic: '14000', allowances: '' },
        { basic: '', allowances: '' },
      ],
    };
    expect(writeQuery(state)).toBe('?mode=compare&gross=15000&target=9000&a_gross=12000&b_gross=14000');
    expect(readQuery(writeQuery(state))).toEqual(state);
  });

  it('leaves out split-only fields in gross entry', () => {
    expect(writeQuery({ ...defaults, basic: '10000', allowances: '2000', targetAllowances: '500' })).toBe(
      '?gross=10000',
    );
  });

  it('reads the converter mode', () => {
    expect(readQuery('?mode=convert').mode).toBe('convert');
  });

  it('leaves defaults out of the URL', () => {
    expect(writeQuery(readQuery(''))).toBe('');
  });

  it('falls back to defaults on unknown values', () => {
    const state = readQuery('?period=weekly&mode=other&lang=fr&fx_currency=XYZ&fx_dir=sideways&pay=other');
    expect(state.period).toBe('monthly');
    expect(state.mode).toBe('pay');
    expect(state.lang).toBe('en');
    expect(state.payEntry).toBe('gross');
    expect(state.fxCurrency).toBe('USD');
    expect(state.fxDirection).toBe('from-kwacha');
  });
});
