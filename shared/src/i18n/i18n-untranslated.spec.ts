import {
  compare,
  countUntranslated,
  isInvariant,
  lowered,
  readBaseline,
  serialize,
  // @ts-expect-error: plain .mjs script with no .d.ts; import as JS module.
} from '../../scripts/i18n-untranslated.mjs';

import { describe, it, expect } from 'vitest';

/**
 * The untranslated-strings ratchet (scripts/i18n-untranslated.mjs). The
 * fixtures under scripts/fixtures/ hold a two-locale table with one marked
 * fallback, two unmarked English copies and the invariant strings the rule
 * excuses.
 */
const FIXTURES = new URL('../../scripts/fixtures/', import.meta.url);
const ROOT = new URL('i18n/', FIXTURES);

type Counts = Record<string, Record<string, { marked: number; identical: number }>>;

describe('i18n untranslated ratchet', () => {
  it('excuses placeholders, codes, names and single words, never a phrase', () => {
    for (const same of [
      '{count} km',
      'GPX',
      'OAuth',
      'Google Maps',
      'PDF · {size}',
      'Budget',
      'Name (A\u2013Z)',
      'Check-in',
      'https://ntfy.sh',
      'your@email.com',
      'Update → v{version}',
      '<b>{name}</b>',
    ]) {
      expect([same, isInvariant(same)]).toEqual([same, true]);
    }
    for (const copy of [
      'Trip settings',
      'Remove {count} items',
      'Open in Google Maps',
      'Source code',
      'Made with TREK',
    ]) {
      expect([copy, isInvariant(copy)]).toEqual([copy, false]);
    }
  });

  it('counts marked fallbacks and unmarked English copies per locale and file', () => {
    expect(countUntranslated(ROOT)).toEqual({ de: { 'a.ts': { marked: 1, identical: 2 } } });
  });

  it('fails when a count grows past its entry and when a file without one has any', () => {
    const counts: Counts = { de: { 'a.ts': { marked: 1, identical: 3 } }, fr: { 'b.ts': { marked: 1, identical: 0 } } };
    const baseline: Counts = { de: { 'a.ts': { marked: 2, identical: 2 } } };
    const { grown, lowerable } = compare(counts, baseline);
    expect(grown).toEqual([
      { locale: 'de', file: 'a.ts', kind: 'identical', now: 3, allowed: 2 },
      { locale: 'fr', file: 'b.ts', kind: 'marked', now: 1, allowed: 0 },
    ]);
    expect(lowerable).toBe(1);
  });

  it('refuses a marker deleted without translating the string', () => {
    const before: Counts = { de: { 'a.ts': { marked: 1, identical: 2 } } };
    const markerDropped: Counts = { de: { 'a.ts': { marked: 0, identical: 3 } } };
    expect(compare(markerDropped, before).grown).toHaveLength(1);
  });

  it('only ever lowers the baseline on --update and drops entries that reach zero', () => {
    const baseline: Counts = {
      de: { 'a.ts': { marked: 2, identical: 2 }, 'b.ts': { marked: 1, identical: 0 } },
    };
    const counts: Counts = { de: { 'a.ts': { marked: 3, identical: 1 } } };
    expect(lowered(counts, baseline)).toEqual({ de: { 'a.ts': { marked: 2, identical: 1 } } });
  });

  it('writes one line per file and reads back what it wrote', () => {
    const baseline: Counts = { de: { 'a.ts': { marked: 2, identical: 1 } } };
    const text = serialize(baseline);
    expect(text).toBe('{\n  "de": {\n    "a.ts": { "marked": 2, "identical": 1 }\n  }\n}\n');
    expect(JSON.parse(text)).toEqual(baseline);
  });

  it('fails closed on a missing, unparsable or misshapen baseline', () => {
    expect(() => readBaseline(new URL('missing.json', FIXTURES))).toThrow(/cannot be read/);
    expect(() => readBaseline(new URL('baseline-broken.json', FIXTURES))).toThrow(/cannot be read/);
    expect(() => readBaseline(new URL('baseline-shape.json', FIXTURES))).toThrow(/whole numbers/);
  });

  it('fails closed on a locale that lacks one of en’s files', () => {
    expect(() => countUntranslated(new URL('i18n-missing/', FIXTURES))).toThrow(/fr\/a\.ts is missing/);
  });

  it('holds the real locales at the committed baseline', () => {
    expect(compare(countUntranslated(), readBaseline()).grown).toEqual([]);
  });
});
