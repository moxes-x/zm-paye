// Visual polish and input comfort: sliding pill highlights, count-up figures, scroll
// fade-ins, the top bar's shadow and amounts that format themselves as they are typed.
// Everything degrades to the plain page when motion is reduced or JS fails.
import { formatEditable, groupTyping, parseMoney } from './money';

const AMOUNT_INPUTS = 'input[inputmode="decimal"]';

function regroup(input: HTMLInputElement, moveCaret: boolean): void {
  const caret = input.selectionStart ?? input.value.length;
  const grouped = groupTyping(input.value, caret);
  if (!grouped || grouped.text === input.value) return;
  input.value = grouped.text;
  if (moveCaret && document.activeElement === input) input.setSelectionRange(grouped.caret, grouped.caret);
}

/** Adds thousands separators to every amount box, for values set from a link. */
export function regroupAmounts(): void {
  document.querySelectorAll<HTMLInputElement>(AMOUNT_INPUTS).forEach((input) => {
    regroup(input, false);
    input.dataset.previous = input.value;
  });
}

/**
 * Formats amounts as they are typed ("6500000" reads as "6,500,000") and expands
 * shorthand such as "10k" when the user leaves the box. Runs in the capture phase,
 * before the page's own input listeners, so they always see the formatted value.
 */
export function initAmountTyping(): void {
  document.addEventListener(
    'input',
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.matches(AMOUNT_INPUTS)) return;
      const previous = input.dataset.previous ?? '';
      const caret = input.selectionStart ?? input.value.length;
      const kind = (event as InputEvent).inputType;
      const removedOne = previous.length === input.value.length + 1;

      // Deleting only a comma would be undone by regrouping, so delete the digit beside it.
      if (kind === 'deleteContentBackward' && removedOne && caret > 0 && previous[caret] === ',') {
        input.value = input.value.slice(0, caret - 1) + input.value.slice(caret);
        input.setSelectionRange(caret - 1, caret - 1);
      } else if (kind === 'deleteContentForward' && removedOne && previous[caret] === ',') {
        input.value = input.value.slice(0, caret) + input.value.slice(caret + 1);
        input.setSelectionRange(caret, caret);
      }

      regroup(input, true);
      input.dataset.previous = input.value;
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.matches(AMOUNT_INPUTS)) return;
      if (!/[km]\s*$/i.test(input.value)) return;
      const parsed = parseMoney(input.value);
      if (!parsed.ok) return;
      input.value = formatEditable(parsed.ngwee);
      input.dataset.previous = input.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    true,
  );
}

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Adds a sliding highlight to every pill control (.period) and returns a function that
 * moves each highlight under the checked option. Call it whenever a control may have
 * changed size or selection.
 */
export function initSegmentThumbs(): () => void {
  const groups = [...document.querySelectorAll<HTMLElement>('.period')];
  for (const group of groups) {
    const thumb = document.createElement('span');
    thumb.className = 'seg-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    group.prepend(thumb);
    group.classList.add('has-thumb');
  }

  const place = (): void => {
    for (const group of groups) {
      const thumb = group.querySelector<HTMLElement>(':scope > .seg-thumb');
      const option = group.querySelector<HTMLInputElement>('input:checked')?.nextElementSibling as HTMLElement | null;
      // Hidden controls have no layout yet; they are placed when they appear.
      if (!thumb || !option || group.offsetParent === null) continue;
      // Measure against the control itself: the labels are positioned, so offsetLeft won't do.
      const box = group.getBoundingClientRect();
      const rect = option.getBoundingClientRect();
      const x = rect.left - box.left - group.clientLeft;
      const y = rect.top - box.top - group.clientTop;
      thumb.style.width = `${rect.width}px`;
      thumb.style.height = `${rect.height}px`;
      thumb.style.transform = `translate(${x}px, ${y}px)`;
      // Animate only after the first placement, so the page doesn't open with a slide.
      if (!group.classList.contains('thumb-ready')) {
        requestAnimationFrame(() => requestAnimationFrame(() => group.classList.add('thumb-ready')));
      }
    }
  };

  window.addEventListener('resize', place);
  return place;
}

/**
 * Shrinks a headline figure so long amounts (K4,030,512.20) stay on one line. Up to
 * about "K10,000.00" keeps the full size. The scale goes to CSS as --fit.
 */
export function fitFigure(node: HTMLElement, text = node.textContent ?? ''): void {
  node.style.setProperty('--fit', String(Math.min(1, 9.5 / Math.max(1, text.length))));
}

const running = new WeakMap<HTMLElement, number>();

/** Counts a money figure up or down to its new value. Formats integers via `format`. */
export function animateNumber(node: HTMLElement, to: number, format: (value: number) => string): void {
  const previous = node.dataset.value;
  node.dataset.value = String(to);
  const pending = running.get(node);
  if (pending !== undefined) cancelAnimationFrame(pending);

  const from = previous === undefined ? to : Number(previous);
  // Size for the final value up front, so the figure doesn't resize while counting.
  fitFigure(node, format(Math.max(Math.abs(from), Math.abs(to))));
  if (from === to || prefersReducedMotion()) {
    node.textContent = format(to);
    return;
  }

  const start = performance.now();
  const duration = 420;
  const step = (now: number): void => {
    // A frame's timestamp can be slightly earlier than `start`, so clamp at both ends.
    const progress = Math.min(1, Math.max(0, (now - start) / duration));
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = format(Math.round(from + (to - from) * eased));
    if (progress < 1) running.set(node, requestAnimationFrame(step));
    else running.delete(node);
  };
  running.set(node, requestAnimationFrame(step));
}

/** Fades sections in as they scroll into view. Content is never hidden without JS. */
export function initReveal(): void {
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
  document.documentElement.classList.add('reveal-ready');

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  targets.forEach((target) => observer.observe(target));
}

/** Gives the sticky top bar a shadow once the page has scrolled. */
export function initTopbar(): void {
  const topbar = document.querySelector<HTMLElement>('.topbar');
  if (!topbar) return;
  const sync = () => topbar.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', sync, { passive: true });
  sync();
}
