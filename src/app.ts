import { calculate, type PayResult } from './calculator';
import { compareOffers } from './compare';
import { isLabelKey, label, LANGUAGES, type Lang } from './i18n';
import { formatKwacha, formatRate, parseMoney, type MoneyError } from './money';
import { getRates, latestYear } from './rateTable';
import { requiredPay } from './reverse';
import { OFFER_LETTERS, readQuery, writeQuery, type FormState, type Mode, type Period } from './share';

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
  };
}

function applyState(state: FormState): void {
  setChecked('mode', state.mode);
  setChecked('period', state.period);
  languageSelect.value = state.lang;
  basicInput.value = state.basic;
  allowancesInput.value = state.allowances;
  showEmployer.checked = state.showEmployer;
  targetInput.value = state.target;
  targetAllowancesInput.value = state.targetAllowances;
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
  const allowances = readField(allowancesInput);
  el('employer').hidden = !state.showEmployer;

  const invalid = basic === null || allowances === null;
  el('result').classList.toggle('stale', invalid);
  if (invalid) return;
  renderPay(calculate({ basic, allowances, year }), basic, allowances, state);
}

function updateReverse(): void {
  const targetNet = readField(targetInput);
  const allowances = readField(targetAllowancesInput);
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
    const allowances = readField(allowancesField);
    if (basic === null || allowances === null) {
      invalid = true;
    } else if (basicField.value.trim() || allowancesField.value.trim()) {
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

function update(): void {
  const state = currentState();

  applyLanguage(state.lang);
  document.body.dataset.mode = state.mode;
  (['pay', 'reverse', 'compare'] as const).forEach((mode) => {
    el(`view-${mode}`).hidden = mode !== state.mode;
  });
  history.replaceState(null, '', location.pathname + writeQuery(state));

  if (state.mode === 'pay') updatePay(state);
  else if (state.mode === 'reverse') updateReverse();
  else updateCompare(state.lang);
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
renderSources();
applyState(readQuery(location.search));
document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', (event) => event.preventDefault());
});
document.addEventListener('input', update);
el('copy-link').addEventListener('click', () => void copyLink());
el('print').addEventListener('click', () => window.print());
update();
