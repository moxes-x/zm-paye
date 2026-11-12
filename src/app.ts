import { calculate, type PayResult } from './calculator';
import { compareOffers } from './compare';
import {
  currencyName,
  fromKwacha,
  FX_CURRENCIES,
  loadRates,
  rateUnit,
  toKwacha,
  type FxStorage,
  type LoadedRates,
} from './fx';
import { isLabelKey, label, LANGUAGES, type Lang } from './i18n';
import { formatKwacha, formatRate, parseMoney, type MoneyError } from './money';
import { getRates, latestYear } from './rateTable';
import { requiredPay } from './reverse';
import {
  OFFER_LETTERS,
  readQuery,
  writeQuery,
  type FormState,
  type FxDirection,
  type Mode,
  type PayEntry,
  type Period,
} from './share';

const year = latestYear();
const rates = getRates(year);

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

function setText(id: string, text: string): void {
  el(id).textContent = text;
}

const basicInput = el<HTMLInputElement>('basic');
const allowancesInput = el<HTMLInputElement>('allowances');
const targetInput = el<HTMLInputElement>('target');
const targetAllowancesInput = el<HTMLInputElement>('target-allowances');
const showEmployer = el<HTMLInputElement>('show-employer');
const languageSelect = el<HTMLSelectElement>('language');
const fxZmwInput = el<HTMLInputElement>('fx-zmw');
const fxForeignInput = el<HTMLInputElement>('fx-foreign');
const fxCurrencySelect = el<HTMLSelectElement>('fx-currency');
let fxDirection: FxDirection = 'from-kwacha';
let fxRates: LoadedRates | 'loading' | 'error' | undefined;
const bar = el('bar');

const ERROR_TEXT: Record<Exclude<MoneyError, 'blank'>, string> = {
  negative: 'Enter an amount of zero or more.',
  invalid: 'Enter an amount like 12,500 or 8000.50.',
  'too-large': 'That amount is too large. The limit is K1 billion.',
};

function radios(name: string): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
}

function checkedValue(name: string): string | undefined {
  return radios(name).find((input) => input.checked)?.value;
}

function setChecked(name: string, value: string): void {
  radios(name).forEach((input) => {
    input.checked = input.value === value;
  });
}

function offerInput(letter: string, field: 'basic' | 'allowances'): HTMLInputElement {
  return el<HTMLInputElement>(`offer-${letter}-${field}`);
}

function buildOfferFields(): void {
  const template = el<HTMLTemplateElement>('offer-template');
  const container = el('offers');

  OFFER_LETTERS.forEach((letter, index) => {
    const offer = template.content.cloneNode(true) as DocumentFragment;
    const letterSlot = offer.querySelector<HTMLElement>('[data-slot="letter"]');
    if (letterSlot) letterSlot.textContent = letter.toUpperCase();
    if (index < 2) offer.querySelector('[data-slot="optional"]')?.remove();

    for (const field of ['basic', 'allowances'] as const) {
      const id = `offer-${letter}-${field}`;
      const input = offer.querySelector<HTMLInputElement>(`input[data-slot="${field}"]`);
      const fieldLabel = offer.querySelector<HTMLLabelElement>(`label[data-slot="${field}-label"]`);
      const error = offer.querySelector<HTMLElement>(`[data-slot="${field}-error"]`);
      if (!input || !fieldLabel || !error) throw new Error('Offer template is incomplete');
      input.id = id;
      fieldLabel.htmlFor = id;
      error.id = `${id}-error`;
      input.setAttribute('aria-describedby', error.id);
    }
    container.append(offer);
  });
}

function currentState(): FormState {
  return {
    mode: checkedValue('mode') as Mode,
    lang: languageSelect.value as Lang,
    payEntry: payEntry(),
    basic: basicInput.value,
    allowances: allowancesInput.value,
    period: checkedValue('period') as Period,
    showEmployer: showEmployer.checked,
    target: targetInput.value,
    targetAllowances: targetAllowancesInput.value,
    offers: OFFER_LETTERS.map((letter) => ({
      basic: offerInput(letter, 'basic').value,
      allowances: offerInput(letter, 'allowances').value,
    })),
    fxAmount: fxDirection === 'to-kwacha' ? fxForeignInput.value : fxZmwInput.value,
    fxCurrency: fxCurrencySelect.value as FormState['fxCurrency'],
    fxDirection,
  };
}

function applyState(state: FormState): void {
  setChecked('mode', state.mode);
  setChecked('pay-entry', state.payEntry);
  setChecked('period', state.period);
  languageSelect.value = state.lang;
  basicInput.value = state.basic;
  allowancesInput.value = state.allowances;
  showEmployer.checked = state.showEmployer;
  targetInput.value = state.target;
  targetAllowancesInput.value = state.targetAllowances;
  fxCurrencySelect.value = state.fxCurrency;
  fxDirection = state.fxDirection;
  (state.fxDirection === 'to-kwacha' ? fxForeignInput : fxZmwInput).value = state.fxAmount;
  OFFER_LETTERS.forEach((letter, i) => {
    offerInput(letter, 'basic').value = state.offers[i]?.basic ?? '';
    offerInput(letter, 'allowances').value = state.offers[i]?.allowances ?? '';
  });
}

function applyLanguage(lang: Lang): void {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-label]').forEach((node) => {
    const key = node.dataset.label ?? '';
    if (isLabelKey(key)) node.textContent = label(lang, key);
  });
  el('draft-note').hidden = lang === 'en';
}

/** Reads one field. A blank field counts as zero; invalid text shows an error and returns null. */
function readField(input: HTMLInputElement): number | null {
  const error = el(`${input.id}-error`);
  const parsed = parseMoney(input.value);
  const message = !parsed.ok && parsed.error !== 'blank' ? ERROR_TEXT[parsed.error] : '';

  error.textContent = message;
  error.hidden = message === '';
  input.setAttribute('aria-invalid', String(message !== ''));

  if (message) return null;
  return parsed.ok ? parsed.ngwee : 0;
}

function payEntry(): PayEntry {
  return checkedValue('pay-entry') === 'split' ? 'split' : 'gross';
}

/** Allowances only count when pay is entered as basic plus allowances. */
function readAllowances(input: HTMLInputElement): number | null {
  if (payEntry() === 'split') return readField(input);
  el(`${input.id}-error`).hidden = true;
  input.removeAttribute('aria-invalid');
  return 0;
}

/** Text for an amount the user can keep editing, such as "10000" or "10000.50". */
function editableAmount(ngwee: number): string {
  return formatKwacha(ngwee).slice(1).replaceAll(',', '').replace(/\.00$/, '');
}

/** Moving to gross entry adds allowances into the main figure, so nothing is lost. */
function mergeIntoGross(basicField: HTMLInputElement, allowancesField: HTMLInputElement): void {
  const allowances = parseMoney(allowancesField.value);
  if (!allowances.ok) {
    if (allowances.error === 'blank') allowancesField.value = '';
    return;
  }
  const basic = parseMoney(basicField.value);
  const basicNgwee = basic.ok ? basic.ngwee : basic.error === 'blank' ? 0 : null;
  if (basicNgwee === null) return;
  basicField.value = editableAmount(basicNgwee + allowances.ngwee);
  allowancesField.value = '';
}

function switchToGross(): void {
  mergeIntoGross(basicInput, allowancesInput);
  OFFER_LETTERS.forEach((letter) => mergeIntoGross(offerInput(letter, 'basic'), offerInput(letter, 'allowances')));
  targetAllowancesInput.value = '';
}

function bandLabel(fromNgwee: number, toNgwee: number | null, factor: number): string {
  const from = formatKwacha(fromNgwee * factor).replace('.00', '');
  if (toNgwee === null) return `Above ${from}`;
  const to = formatKwacha(toNgwee * factor).replace('.00', '');
  return fromNgwee === 0 ? `First ${to}` : `${from} to ${to}`;
}

function tableRow(cells: string[], className?: string): HTMLTableRowElement {
  const row = document.createElement('tr');
  if (className) row.className = className;
  for (const text of cells) {
    const cell = document.createElement('td');
    cell.textContent = text;
    row.append(cell);
  }
  return row;
}

function renderBands(result: PayResult, factor: number): void {
  const money = (ngwee: number) => formatKwacha(ngwee * factor);
  const rows = result.payeByBand.map((band) =>
    tableRow([
      bandLabel(band.fromNgwee, band.toNgwee, factor),
      formatRate(band.rateBps),
      money(band.amountNgwee),
      money(band.taxNgwee),
    ]),
  );
  el('bands').replaceChildren(...rows);
}

function renderBar(result: PayResult): void {
  const parts = [result.net, result.paye, result.napsa, result.nhima];
  bar.querySelectorAll<HTMLElement>('.seg').forEach((segment, i) => {
    segment.style.flexGrow = String(parts[i] ?? 0);
  });
  bar.classList.toggle('empty', result.gross === 0);
}

function renderSlip(result: PayResult, basic: number, allowances: number, period: Period, lang: Lang): void {
  const money = (ngwee: number) => formatKwacha(ngwee * (period === 'annual' ? 12 : 1));
  setText('slip-period', label(lang, period));
  setText('slip-date', new Date().toISOString().slice(0, 10));
  setText('slip-year', String(year));
  setText('slip-basic', money(basic));
  setText('slip-allowances', money(allowances));
  setText('slip-gross', money(result.gross));
  setText('slip-paye', money(result.paye));
  setText('slip-napsa', money(result.napsa));
  setText('slip-nhima', money(result.nhima));
  setText('slip-net', money(result.net));
}

function renderPay(result: PayResult, basic: number, allowances: number, state: FormState): void {
  const factor = state.period === 'annual' ? 12 : 1;
  const money = (ngwee: number) => formatKwacha(ngwee * factor);

  setText('net', money(result.net));
  setText('net-row', money(result.net));
  setText('gross', money(result.gross));
  setText('paye', money(result.paye));
  setText('napsa', money(result.napsa));
  setText('nhima', money(result.nhima));

  setText('er-gross', money(result.gross));
  setText('er-napsa', money(result.employerCost.napsa));
  setText('er-nhima', money(result.employerCost.nhima));
  setText('er-sdl', money(result.employerCost.sdl));
  setText('er-total', money(result.employerCost.total));

  renderBands(result, factor);
  renderBar(result);
  renderSlip(result, basic, allowances, state.period, state.lang);
}

function updatePay(state: FormState): void {
  const basic = readField(basicInput);
  const allowances = readAllowances(allowancesInput);
  el('employer').hidden = !state.showEmployer;

  const invalid = basic === null || allowances === null;
  const empty = !basicInput.value.trim() && (payEntry() === 'gross' || !allowancesInput.value.trim());
  el('result').classList.toggle('stale', invalid);
  el('result').classList.toggle('is-empty', empty && !invalid);
  if (invalid) return;
  renderPay(calculate({ basic, allowances, year }), basic, allowances, state);
}

function updateReverse(): void {
  const targetNet = readField(targetInput);
  const allowances = readAllowances(targetAllowancesInput);
  const resultCard = el('reverse-result');

  if (targetNet === null || allowances === null) {
    resultCard.classList.add('stale');
    setText('reverse-message', '');
    return;
  }

  const solved = requiredPay({ targetNet, allowances, year });
  resultCard.classList.toggle('stale', solved.status === 'out-of-range');

  if (solved.status === 'out-of-range') {
    setText('reverse-message', 'That take-home is too high to work out. The salary limit is K1 billion a month.');
    return;
  }

  setText(
    'reverse-message',
    solved.status === 'allowances-exceed-target'
      ? `Your allowances alone give ${formatKwacha(solved.result.net)} take-home, which is already more than this target.`
      : '',
  );

  const { result, basic } = solved;
  setText('reverse-gross', formatKwacha(result.gross));
  setText('reverse-basic', formatKwacha(basic));
  setText('reverse-allowances', formatKwacha(allowances));
  setText('reverse-paye', formatKwacha(result.paye));
  setText('reverse-napsa', formatKwacha(result.napsa));
  setText('reverse-nhima', formatKwacha(result.nhima));
  setText('reverse-net', formatKwacha(result.net));
}

function compareHeadline(entries: { letter: string; net: number }[]): string {
  const [top, next] = [...entries].sort((a, b) => b.net - a.net);
  if (!top || !next) return '';
  if (top.net === next.net) return `Offers ${top.letter} and ${next.letter} pay the same take-home.`;
  return `Offer ${top.letter} pays ${formatKwacha(top.net - next.net)} more take-home each month than Offer ${next.letter}.`;
}

function updateCompare(lang: Lang): void {
  const offers: { letter: string; basic: number; allowances: number }[] = [];
  let invalid = false;

  for (const letter of OFFER_LETTERS) {
    const basicField = offerInput(letter, 'basic');
    const allowancesField = offerInput(letter, 'allowances');
    const basic = readField(basicField);
    const allowances = readAllowances(allowancesField);
    if (basic === null || allowances === null) {
      invalid = true;
    } else if (basicField.value.trim() || (payEntry() === 'split' && allowancesField.value.trim())) {
      offers.push({ letter: letter.toUpperCase(), basic, allowances });
    }
  }

  el('compare-result').classList.toggle('stale', invalid);
  if (invalid) return;

  const enough = offers.length >= 2;
  el('compare-output').hidden = !enough;
  setText('compare-hint', enough ? '' : 'Enter at least two offers to compare them.');
  if (!enough) return;

  const compared = compareOffers(offers, year);
  setText(
    'compare-headline',
    compareHeadline(compared.map((c, i) => ({ letter: offers[i]?.letter ?? '', net: c.result.net }))),
  );

  const columnClass = compared.map((c) => (c.isBest ? 'best' : ''));
  const heading = document.createElement('tr');
  ['', ...offers.map((o) => `${label(lang, 'offer')} ${o.letter}`)].forEach((text, i) => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = text;
    cell.className = i > 0 ? (columnClass[i - 1] ?? '') : '';
    heading.append(cell);
  });
  el('compare-head').replaceChildren(heading);

  const signed = (ngwee: number) => (ngwee > 0 ? `+${formatKwacha(ngwee)}` : formatKwacha(ngwee));
  const rows: [string, (c: (typeof compared)[number]) => string, string?][] = [
    [label(lang, 'grossPay'), (c) => formatKwacha(c.result.gross)],
    ['PAYE', (c) => formatKwacha(c.result.paye)],
    ['NAPSA', (c) => formatKwacha(c.result.napsa)],
    ['NHIMA', (c) => formatKwacha(c.result.nhima)],
    [label(lang, 'takeHome'), (c) => formatKwacha(c.result.net), 'total-row'],
    [`vs ${label(lang, 'offer')} ${offers[0]?.letter ?? ''}`, (c) => signed(c.netDifference)],
  ];

  el('compare-body').replaceChildren(
    ...rows.map(([name, value, className]) => {
      const row = tableRow([name, ...compared.map(value)], className);
      columnClass.forEach((best, i) => {
        if (best) row.children[i + 1]?.classList.add(best);
      });
      return row;
    }),
  );
}

function deviceStorage(): FxStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Rates are only downloaded once someone opens the converter. */
function ensureRates(): void {
  if (fxRates) return;
  fxRates = 'loading';
  loadRates({ fetch: fetchWithTimeout, storage: deviceStorage(), now: Date.now() })
    .then((loaded) => {
      fxRates = loaded;
    })
    .catch(() => {
      fxRates = 'error';
    })
    .finally(update);
}

function renderFxSource(rates: LoadedRates): void {
  const link = document.createElement('a');
  link.href = rates.source.url;
  link.rel = 'noopener';
  link.textContent = rates.source.name;
  const updated = rates.updatedAt.slice(0, 10);
  const note = rates.stale ? ` Saved rates from ${updated}; you appear to be offline.` : ` Updated ${updated}.`;
  el('fx-source').replaceChildren(link, note);
}

const plainAmount = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whichever box was typed in last is the source; the other box shows the conversion. */
function updateConvert(): void {
  ensureRates();
  const code = fxCurrencySelect.value as FormState['fxCurrency'];
  const fromForeign = fxDirection === 'to-kwacha';
  const source = fromForeign ? fxForeignInput : fxZmwInput;
  const target = fromForeign ? fxZmwInput : fxForeignInput;

  setText('fx-foreign-code', code);
  setText('fx-foreign-label', `${currencyName(code)} amount`);
  el('fx-retry').hidden = fxRates !== 'error';

  el(`${target.id}-error`).hidden = true;
  target.removeAttribute('aria-invalid');
  const amount = readField(source);

  if (fxRates === 'loading' || fxRates === undefined) {
    setText('fx-status', "Loading today's exchange rates…");
    return;
  }
  if (fxRates === 'error') {
    setText('fx-status', 'Could not load exchange rates. Check your connection and try again.');
    return;
  }

  renderFxSource(fxRates);
  if (!fxRates.rates[code]) {
    setText('fx-rate', '');
    setText('fx-status', `No rate for ${currencyName(code)} today. Choose another currency.`);
    target.value = '';
    return;
  }

  const unit = rateUnit(code, fxRates);
  setText('fx-rate', `${unit.toLocaleString('en')} ${code} = ${formatKwacha(toKwacha(unit * 100, code, fxRates))}`);
  setText('fx-status', '');

  if (amount === null) return;
  if (source.value.trim() === '') {
    target.value = '';
    return;
  }
  target.value = fromForeign
    ? plainAmount.format(toKwacha(amount, code, fxRates) / 100)
    : plainAmount.format(fromKwacha(amount, code, fxRates));
}

function renderCurrencies(): void {
  fxCurrencySelect.replaceChildren(
    ...FX_CURRENCIES.map((code) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = `${code} · ${currencyName(code)}`;
      return option;
    }),
  );
}

function update(): void {
  const state = currentState();

  applyLanguage(state.lang);
  document.body.dataset.mode = state.mode;
  document.body.dataset.payEntry = state.payEntry;
  el('pay-entry').hidden = state.mode === 'convert';
  (['pay', 'reverse', 'compare', 'convert'] as const).forEach((mode) => {
    el(`view-${mode}`).hidden = mode !== state.mode;
  });
  history.replaceState(null, '', location.pathname + writeQuery(state));

  if (state.mode === 'pay') updatePay(state);
  else if (state.mode === 'reverse') updateReverse();
  else if (state.mode === 'compare') updateCompare(state.lang);
  else updateConvert();
}

async function copyLink(): Promise<void> {
  const status = el('copy-status');
  try {
    await navigator.clipboard.writeText(location.href);
    status.textContent = 'Link copied';
  } catch {
    status.textContent = 'Copy the link from your address bar';
  }
}

function renderLanguages(): void {
  languageSelect.replaceChildren(
    ...LANGUAGES.map(({ code, name }) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      return option;
    }),
  );
}

/** The landing page's rules and examples come from the rates file, so they can't drift from the calculator. */
function renderRules(): void {
  el('rules-bands').replaceChildren(
    ...rates.paye.bands.map((band) => tableRow([bandLabel(band.fromNgwee, band.toNgwee, 1), formatRate(band.rateBps)])),
  );

  const ceiling = rates.napsa.ceilingNgwee;
  const napsaMax = Math.round((ceiling * rates.napsa.employeeBps) / 10_000);
  setText(
    'rule-napsa',
    `Your pension contribution: ${formatRate(rates.napsa.employeeBps)} of gross pay, on earnings up to ${formatKwacha(ceiling)} a month. The most anyone pays is ${formatKwacha(napsaMax)}.`,
  );
  setText('rule-nhima', `National health insurance: ${formatRate(rates.nhima.employeeBps)} of basic salary only, with no cap. Allowances don't count.`);
  setText('rule-sdl', formatRate(rates.sdl.employerBps));

  const example = calculate({ basic: 1_000_000, allowances: 0, year });
  setText('ex-gross', formatKwacha(example.gross));
  setText('ex-paye', formatKwacha(example.paye));
  setText(
    'ex-paye-detail',
    example.payeByBand
      .filter((band) => band.taxNgwee > 0)
      .map((band) => `${formatRate(band.rateBps)} of ${formatKwacha(band.amountNgwee)}`)
      .join(' + '),
  );
  setText('ex-napsa', formatKwacha(example.napsa));
  setText('ex-nhima', formatKwacha(example.nhima));
  setText('ex-net', formatKwacha(example.net));

  setText('hero-ex-net', formatKwacha(example.net));
  setText('hero-ex-paye', formatKwacha(example.paye));
  setText('hero-ex-napsa', formatKwacha(example.napsa));
  setText('hero-ex-nhima', formatKwacha(example.nhima));
  const parts = [example.net, example.paye, example.napsa, example.nhima];
  el('hero-ex-bar')
    .querySelectorAll<HTMLElement>('.seg')
    .forEach((segment, i) => {
      segment.style.flexGrow = String(parts[i] ?? 0);
    });
}

function renderSources(): void {
  setText('rates-year', String(year));
  setText('reviewed', `Rates for ${year}, last reviewed ${rates.reviewedOn}.`);
  const items = rates.sources.map((source) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.url;
    link.rel = 'noopener';
    link.textContent = source.covers;
    item.append(link, `: ${source.title}`);
    return item;
  });
  el('sources').replaceChildren(...items);
}

buildOfferFields();
renderLanguages();
renderCurrencies();
renderSources();
renderRules();
applyState(readQuery(location.search));
document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', (event) => event.preventDefault());
});
document.addEventListener('input', update);
el('copy-link').addEventListener('click', () => void copyLink());
el('print').addEventListener('click', () => window.print());
// These run before the page-wide input listener, so update() sees the new state.
radios('pay-entry').forEach((radio) => {
  radio.addEventListener('input', () => {
    if (radio.value === 'gross') switchToGross();
  });
});
fxZmwInput.addEventListener('input', () => {
  fxDirection = 'from-kwacha';
});
fxForeignInput.addEventListener('input', () => {
  fxDirection = 'to-kwacha';
});
// Feature cards are links to #calculator that also open the matching tab.
document.querySelectorAll<HTMLAnchorElement>('[data-go-mode]').forEach((link) => {
  link.addEventListener('click', () => {
    setChecked('mode', link.dataset.goMode ?? 'pay');
    update();
  });
});
el('fx-retry').addEventListener('click', () => {
  fxRates = undefined;
  update();
});
update();
