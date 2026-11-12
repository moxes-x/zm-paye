import { describe, expect, it } from 'vitest';
import { calculate } from '../src/calculator';
import payslips from './fixtures/payslips.json';

interface Payslip {
  label: string;
  year: number;
  basic: number;
  allowances: number;
  paye: number;
  napsa: number;
  nhima: number;
  net: number;
}

const cases = payslips as Payslip[];

// Real, anonymised payslips, all amounts in ngwee. Add them to fixtures/payslips.json.
describe('real payslip cross-check', () => {
  if (cases.length === 0) {
    it.todo('add 5–10 anonymised payslips to test/fixtures/payslips.json');
    return;
  }

  it.each(cases.map((slip) => [slip.label, slip] as const))('%s', (_label, slip) => {
    const result = calculate(slip);
    expect({ paye: result.paye, napsa: result.napsa, nhima: result.nhima, net: result.net }).toEqual({
      paye: slip.paye,
      napsa: slip.napsa,
      nhima: slip.nhima,
      net: slip.net,
    });
  });
});
