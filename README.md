# Zambia take-home pay calculator

**Live site: [zm-paye.vercel.app](https://zm-paye.vercel.app)** · **API: [zm-paye.vercel.app/v1](https://zm-paye.vercel.app/v1)**

Works out Zambian PAYE, NAPSA, NHIMA and net pay from a monthly salary, and shows how each tax band contributes. Enter pay as one gross figure, or as basic salary plus allowances for an exact NHIMA figure. Calculations run in the browser, so nothing typed is sent anywhere.

Try it with an example: [K6,500 gross with K3,250 basic](https://zm-paye.vercel.app/?pay=split&basic=3250&allowances=3250), which matches a real payslip to the ngwee.

It can also:

- work backwards from the take-home pay you want to the salary you need
- compare up to three job offers side by side
- convert kwacha to and from 13 other currencies
- print a one-page pay summary, or save it as a PDF
- show its labels in Icibemba or Chinyanja (draft translations, see below)
- link to any calculation through its URL
- answer the same calculations through a free JSON API (see [API](#api))

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
| `test/fx.test.ts` | Exchange-rate parsing, conversion, caching and fallback |
| `test/share.test.ts` | Shareable URLs |
| `test/payslips.test.ts` | Real anonymised payslips from `test/fixtures/payslips.json` (none added yet) |

Net pay is guaranteed never to fall for a rise of 6 ngwee or more. Below that, the separate rounding of three deductions can move net down by up to 2 ngwee, which is normal on a payslip where each line must be a whole ngwee.

## API

A JSON API runs on the same calculation code as the website, hosted on Vercel ([server/app.ts](server/app.ts)). Any website or app can call it.

**Base URL:** `https://zm-paye.vercel.app/v1`. For example, try [/v1/take-home?gross=6500&basic=3250](https://zm-paye.vercel.app/v1/take-home?gross=6500&basic=3250) in a browser.

Amounts go in as kwacha (`6500`, `6,500.50`) and come back as decimal strings (`"5862.50"`), so clients never handle floating-point money.

| Endpoint | Purpose |
|---|---|
| `GET /v1/take-home` | Monthly and annual breakdown, PAYE bands, employer cost |
| `GET /v1/required-salary` | Salary needed for a target take-home |
| `POST /v1/compare` | Compare 2 to 10 offers |
| `GET /v1/rates` | Years with rates |
| `GET /v1/rates/{year}` | Bands, contribution rates and sources |

### Take-home

Send pay in either of two styles:

- **Gross:** `gross`, plus `basic` if known. Without `basic`, NHIMA is worked out on the whole gross and `notes` says so.
- **Basic plus allowances:** `basic` and `allowances`.

`year` is optional and defaults to the latest.

```sh
curl 'https://zm-paye.vercel.app/v1/take-home?gross=10000&basic=8000'
```

```json
{
  "year": 2026,
  "input": { "basic": "8000.00", "allowances": "2000.00", "nhimaAssumesAllBasic": false },
  "monthly": { "gross": "10000.00", "paye": "1326.00", "napsa": "500.00", "nhima": "80.00", "net": "8094.00" },
  "annual": { "gross": "120000.00", "...": "..." },
  "payeBands": [{ "from": "0.00", "to": "5100.00", "ratePercent": 0, "taxable": "5100.00", "tax": "0.00" }, "..."],
  "employerCost": { "napsa": "500.00", "nhima": "80.00", "sdl": "50.00", "total": "10630.00" },
  "notes": []
}
```

### Required salary

```sh
curl 'https://zm-paye.vercel.app/v1/required-salary?net=8074'          # optional: allowances, year
```

### Compare

```sh
curl -X POST 'https://zm-paye.vercel.app/v1/compare' \
  -H 'Content-Type: application/json' \
  -d '{"offers":[{"gross":"12000"},{"basic":"5000","allowances":"5000"}]}'
```

### Errors

Errors use HTTP status codes (400 for bad input, 404, 405, and 422 for an unreachable target) with a body such as:

```json
{ "error": { "code": "invalid-amount", "message": "gross must be an amount such as 6500 or 6500.50", "field": "gross" } }
```

### Other behaviour

- **CORS:** every response allows any origin.
- **Caching:** successful responses can be cached for an hour.
- **Currency:** there is no currency endpoint, because ExchangeRate-API's terms forbid redistributing its rates.

### How it is built and run

The API is hosted on Vercel alongside the website, at the same domain.

- **Source:** [server/app.ts](server/app.ts) holds the API code.
- **Bundle:** `npm run build:api` compiles the source into one self-contained file, `api/index.js`, which Vercel runs as a function. Using one file avoids Node's rule that ES module imports need file extensions.
- **Commit the bundle:** after changing the API, run `npm run build:api` and commit `api/index.js`. CI fails if the committed copy is out of date.
- **Routing:** [vercel.json](vercel.json) rewrites `/v1/...` to that function.

```sh
npm run api:local      # build the bundle and serve it at http://localhost:8787/v1
```

`test/api.test.ts` tests the source, and `test/api-bundle.test.ts` tests the built `api/index.js`.

## Currency converter

The Convert tab converts between kwacha and 13 currencies, starting with USD and ZAR, in either direction. Rates are mid-market and update once a day, so they are indicative only. Banks and bureaux de change add a margin.

- **Main source:** [ExchangeRate-API's free endpoint](https://www.exchangerate-api.com/docs/free) (`open.er-api.com`). It needs no key and allows browser requests. Its terms require the "Rates By Exchange Rate API" link the page shows, and do not allow the raw rates to be redistributed.
- **Backup:** [fawazahmed0/exchange-api](https://github.com/fawazahmed0/exchange-api), served from jsDelivr, used if the main source fails.
- **Loading:** rates download only when someone opens the Convert tab (about 3 kB) and are saved on the device for 6 hours. Offline, the last saved rates are shown and marked as old.
- **Code:** [src/fx.ts](src/fx.ts) validates every response and keeps only the currencies offered.

## Design and images

The look borrows from Wise's design system: forest green, pill controls, hairline borders and a single accent. Here the accent is copper, taken from the eagle on the Zambian flag. The page uses system fonts and no images, so it stays light on mobile data.

- `public/favicon.svg` is the tab icon.
- `public/og-image.png` is the 1200×630 preview shown when a link is shared on WhatsApp or social media. Its source is [scripts/og-image.html](scripts/og-image.html). After editing it, start Chrome or Edge with `--headless=new --remote-debugging-port=9334` and run:

  ```sh
  node scripts/capture.mjs 9334 file:///<full path>/scripts/og-image.html public/og-image.png 1200 630
  ```

The `og:url` and `og:image` tags in `index.html` assume the site is served at `https://zm-paye.vercel.app/`. Update them if Vercel gives the project a different address or it moves to a custom domain.

## Translations

The Icibemba and Chinyanja labels in [src/i18n.ts](src/i18n.ts) are drafts that no fluent speaker has checked yet, and the page says so when either language is selected. Only short labels are translated. Explanations of the tax rules stay in English, and PAYE, NAPSA and NHIMA are kept as names. Corrections are welcome.

## Yearly update (each January)

1. Check the new NAPSA ceiling and the budget's PAYE bands against ZRA, NAPSA and NHIMA.
2. Copy `src/rates/2026.json` to `src/rates/2027.json`, update the figures, sources and dates, and add the new file to `src/rates/index.ts`.
3. Add golden cases for the new year.
4. Run `npm test`. The site picks up the newest rates file automatically.

## Deployment

The website and API are live at **[zm-paye.vercel.app](https://zm-paye.vercel.app)**, hosted on [Vercel](https://vercel.com). [vercel.json](vercel.json) holds the settings.

1. Sign in to Vercel with GitHub and import the `zm-paye` repository. Vercel reads the build settings from `vercel.json`.
2. Every push to `main` deploys to production. Every other branch gets its own preview URL.

GitHub Actions runs the tests, the build and the API bundle check on every push. To stop failing commits from reaching production, protect `main` in GitHub so changes arrive through pull requests that must pass CI.

This is an estimate and not tax advice.
