import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import { isLabelKey, isLang, label, LANGUAGES, type LabelKey } from '../src/i18n';

const usedKeys = [...html.matchAll(/data-label="(\w+)"/g)].map((match) => match[1] ?? '');

describe('labels', () => {
  it('every data-label in the page exists', () => {
    expect(usedKeys.length).toBeGreaterThan(20);
    expect(usedKeys.filter((key) => !isLabelKey(key))).toEqual([]);
  });

  it.each(LANGUAGES.map((l) => l.code))('%s has text for every label used', (lang) => {
    for (const key of usedKeys as LabelKey[]) {
      expect(label(lang, key).trim()).not.toBe('');
    }
  });

  it('recognises supported languages only', () => {
    expect(isLang('bem')).toBe(true);
    expect(isLang('ny')).toBe(true);
    expect(isLang('fr')).toBe(false);
    expect(isLang(null)).toBe(false);
  });
});
