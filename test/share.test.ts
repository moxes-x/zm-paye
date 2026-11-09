import { describe, expect, it } from 'vitest';
import { readQuery, writeQuery, type FormState } from '../src/share';

const blankOffers = [
  { basic: '', allowances: '' },
  { basic: '', allowances: '' },
  { basic: '', allowances: '' },
];

describe('shareable URLs', () => {
  it('reads the plan example', () => {
    expect(readQuery('?basic=8000')).toEqual({
      mode: 'pay',
      lang: 'en',
      basic: '8000',
      allowances: '',
      period: 'monthly',
      showEmployer: false,
      target: '',
      targetAllowances: '',
      offers: blankOffers,
    });
  });

  it('round-trips a full state', () => {
    const state: FormState = {
      mode: 'compare',
      lang: 'ny',
      basic: '12,500',
      allowances: '2000',
      period: 'annual',
      showEmployer: true,
      target: '8000',
      targetAllowances: '500',
      offers: [
        { basic: '9000', allowances: '1000' },
        { basic: '11,000', allowances: '' },
        { basic: '', allowances: '' },
      ],
    };
    expect(readQuery(writeQuery(state))).toEqual(state);
  });

  it('leaves defaults out of the URL', () => {
    expect(writeQuery(readQuery(''))).toBe('');
  });

  it('falls back to defaults on unknown values', () => {
    const state = readQuery('?period=weekly&mode=other&lang=fr');
    expect(state.period).toBe('monthly');
    expect(state.mode).toBe('pay');
    expect(state.lang).toBe('en');
  });
});
