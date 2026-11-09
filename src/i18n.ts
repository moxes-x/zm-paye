export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'bem', name: 'Icibemba' },
  { code: 'ny', name: 'Chinyanja' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

// Short interface labels only. Explanations of the tax rules stay in English until
// they can be written or checked by a fluent speaker. PAYE, NAPSA and NHIMA are names.
const en = {
  title: 'Zambia take-home pay',
  language: 'Language',
  modePay: 'Take-home',
  modeReverse: 'Salary needed',
  modeCompare: 'Compare offers',
  basic: 'Basic salary',
  allowances: 'Allowances',
  perMonth: 'per month',
  monthly: 'Monthly',
  annual: 'Annual',
  youTakeHome: 'You take home',
  grossPay: 'Gross pay',
  takeHome: 'Take-home',
  tax: 'Tax',
  rate: 'Rate',
  showEmployer: 'Show what this costs the employer',
  totalCost: 'Total cost',
  copyLink: 'Copy link',
  print: 'Print or save as PDF',
  targetNet: 'Take-home you want',
  grossNeeded: 'Gross salary needed',
  basicNeeded: 'Basic salary needed',
  offer: 'Offer',
  optional: 'optional',
} as const;

export type LabelKey = keyof typeof en;

const LABELS: Record<Lang, Record<LabelKey, string>> = {
  en,
  // Draft translations, not yet checked by a fluent speaker.
  bem: {
    title: 'Indalama upoka mu Zambia',
    language: 'Ululimi',
    modePay: 'Indalama upoka',
    modeReverse: 'Icilambu cilekabilwa',
    modeCompare: 'Linganya ifilambu',
    basic: 'Icilambu ca basic',
    allowances: 'Ama-allowance',
    perMonth: 'pa mweshi',
    monthly: 'Pa mweshi',
    annual: 'Pa mwaka',
    youTakeHome: 'Indalama upoka',
    grossPay: 'Icilambu conse',
    takeHome: 'Indalama upoka',
    tax: 'Umusonko',
    rate: 'Icipimo',
    showEmployer: 'Langa ifyo kabwana alipila',
    totalCost: 'Umutengo onse',
    copyLink: 'Kopa link',
    print: 'Printa nangu sunga nga PDF',
    targetNet: 'Indalama ulefwaya ukupoka',
    grossNeeded: 'Icilambu conse cilekabilwa',
    basicNeeded: 'Icilambu ca basic cilekabilwa',
    offer: 'Offer',
    optional: 'nga ulefwaya',
  },
  // Draft translations, not yet checked by a fluent speaker.
  ny: {
    title: 'Ndalama zolandira ku Zambia',
    language: 'Chilankhulo',
    modePay: 'Ndalama zolandira',
    modeReverse: 'Malipiro ofunika',
    modeCompare: 'Yerekezerani malipiro',
    basic: 'Malipiro a basic',
    allowances: 'Ma-allowance',
    perMonth: 'pa mwezi',
    monthly: 'Pa mwezi',
    annual: 'Pa chaka',
    youTakeHome: 'Ndalama zomwe mumalandira',
    grossPay: 'Malipiro onse',
    takeHome: 'Ndalama zolandira',
    tax: 'Msonkho',
    rate: 'Mlingo',
    showEmployer: 'Onetsani zomwe abwana amalipira',
    totalCost: 'Mtengo wonse',
    copyLink: 'Kopani link',
    print: 'Printani kapena sungani ngati PDF',
    targetNet: 'Ndalama zomwe mukufuna kulandira',
    grossNeeded: 'Malipiro onse ofunika',
    basicNeeded: 'Malipiro a basic ofunika',
    offer: 'Offer',
    optional: 'ngati mukufuna',
  },
};

export function isLang(value: string | null): value is Lang {
  return LANGUAGES.some((language) => language.code === value);
}

export function label(lang: Lang, key: LabelKey): string {
  return LABELS[lang][key];
}

export function isLabelKey(value: string): value is LabelKey {
  return value in en;
}
