# Zambia take-home pay calculator

Works out Zambian PAYE, NAPSA, NHIMA and net pay from a monthly salary, and shows how each tax band contributes. It is a static site with no backend, and the calculation runs entirely in the browser.

It can also:

- work backwards from the take-home pay you want to the salary you need
- compare up to three job offers side by side
- print a one-page pay summary, or save it as a PDF
- show its labels in Icibemba or Chinyanja (draft translations, see below)
- link to any calculation through its URL

## The rules (2026)

| Item | Rule | Base |
|---|---|---|
| PAYE | 0% on the first K5,100, 20% to K7,100, 30% to K9,200, 37% above (monthly) | Gross pay |
| NAPSA, employee | 5%, on earnings up to K37,236 a month, so at most K1,861.80 | Gross pay |
| NHIMA, employee | 1%, no cap | Basic salary |
| Employer cost | NAPSA 5% (same cap), NHIMA 1% of basic, Skills Development Levy 0.5% of gross | As shown |

Worked example, with basic pay of K10,000 and no allowances:

| | |
|---|---:|
| PAYE (0 + 400 + 630 + 296) | K1,326.00 |
| NAPSA | K500.00 |
| NHIMA | K100.00 |
| **Net** | **K8,074.00** |

### Is NAPSA deducted before PAYE?

This calculator says no, and charges PAYE on gross pay. Section 4 of the Income Tax (Amendment) Act No. 22 of 2024 is reported to have removed the employee deduction for pension contributions from 1 January 2025. That reading comes from secondary sources and has not been confirmed against the Act or with ZRA. If it turns out to be wrong, set `paye.deductNapsaBeforePaye` to `true` in the rates file.

Sources for every figure are listed in [src/rates/2026.json](src/rates/2026.json) and on the page itself.

## How it is built

- [src/calculator.ts](src/calculator.ts) holds the calculation, a pure function with no access to the page.
- [src/rates/](src/rates/) holds one JSON file per tax year, so rates are data rather than code.
- Money is stored as whole ngwee and rates as basis points, so no floating-point value touches a calculation.
- Each figure is rounded once, half-up to the ngwee. The per-band PAYE amounts are derived from a rounded running total, so they always add up to the PAYE figure.

## Running it

```sh
npm install
npm run dev      # local dev server
npm test         # test suite
npm run build    # type-check and build to dist/
```

## Tests

| File | Covers |
|---|---|
| `test/calculator.test.ts` | Hand-worked golden cases, band boundaries, the NAPSA cap, NHIMA base, employer cost, the NAPSA flag |
| `test/properties.test.ts` | Randomised checks with fast-check, such as net pay never falling when pay rises |
| `test/money.test.ts` | Input parsing and formatting |
| `test/rates.test.ts` | Each rates file has contiguous bands, ascending rates and sources |
| `test/reverse.test.ts` | Salary needed for a target take-home, always the smallest that reaches it exactly |
| `test/compare.test.ts` | Offer comparison, differences and ties |
| `test/i18n.test.ts` | Every label used on the page exists in every language |
| `test/share.test.ts` | Shareable URLs |
| `test/payslips.test.ts` | Real anonymised payslips from `test/fixtures/payslips.json` (none added yet) |

Net pay is guaranteed never to fall for a rise of 6 ngwee or more. Below that, the separate rounding of three deductions can move net down by up to 2 ngwee, which is normal on a payslip where each line must be a whole ngwee.

## Translations

The Icibemba and Chinyanja labels in [src/i18n.ts](src/i18n.ts) are drafts that no fluent speaker has checked yet, and the page says so when either language is selected. Only short labels are translated. Explanations of the tax rules stay in English, and PAYE, NAPSA and NHIMA are kept as names. Corrections are welcome.

## Yearly update (each January)

1. Check the new NAPSA ceiling and the budget's PAYE bands against ZRA, NAPSA and NHIMA.
2. Copy `src/rates/2026.json` to `src/rates/2027.json` and update the figures, sources and dates.
3. Add golden cases for the new year.
4. Run `npm test`. The site picks up the newest rates file automatically.

## Deployment

GitHub Actions runs the tests on every push and deploys to GitHub Pages from `main` only if they pass. In the repository settings, set Pages > Source to "GitHub Actions".

This is an estimate and not tax advice.
