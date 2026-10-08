#!/usr/bin/env node
/**
 * i18n:untranslated: English left in the other locales may only shrink.
 *
 * Parity proves every locale has every key, not that the key holds the
 * locale's own language: a copied en string passes it. Two kinds of copy are
 * counted per locale and domain file:
 *
 *   marked     a declaration carrying `// en-fallback`, the marker a
 *              translator leaves on a string they could not translate yet
 *   identical  an unmarked value equal to en's, unless the rule in
 *              `isInvariant` says the text reads the same in every language
 *
 * Both counts are held at scripts/i18n-untranslated-baseline.json. The check
 * fails when either grows past its entry (a file without one may hold none),
 * so a feature can no longer ship 26 English copies of a new string. Lowering
 * is a separate, explicit step:
 *
 *   node scripts/i18n-untranslated.mjs            check against the baseline (CI, via i18n-parity --strict)
 *   node scripts/i18n-untranslated.mjs --update   lower the baseline to today's counts; it never raises an
 *                                                 entry and drops the ones that reach zero
 *
 * The two counts are separate on purpose: deleting a marker without
 * translating the string moves it from `marked` to `identical`, and the
 * identical count refuses it.
 *
 * Fails closed: a missing or malformed baseline, a locale lacking one of en's
 * files, or a value the catalogue reader cannot parse is an error, never a
 * pass.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asPath, I18N_ROOT, listDomainFiles, listLocales, readCatalog } from './i18n-catalog.mjs';

export const BASELINE = join(dirname(fileURLToPath(import.meta.url)), 'i18n-untranslated-baseline.json');

/**
 * Names of two or more plain words that read the same in every language.
 * One-word names (Mapbox, Immich) and names with an inner capital (MapLibre,
 * OpenStreetMap) are already covered by the word rule below.
 */
export const BRAND_NAMES = ['Apple Maps', 'Google Maps', 'Google Places', 'Home Assistant', 'Organic Maps', 'Synology Photos'];

const PLACEHOLDER_RE = /\{[a-zA-Z0-9_]+\}/g;
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
// A URL, an e-mail address or a path: anything with a slash or an at sign in it.
const ADDRESS_RE = /\S*[/@]\S*/g;
// Hyphens join a word: "Check-in", "Wi-Fi" and "Auto-Backup" are one each.
const WORD_RE = /\p{L}[\p{L}\p{M}'’-]*/gu;

/**
 * A word in the sense of the rule: two letters or more and no capital after
 * the first. Single letters (the A and Z of a sort label, the v of
 * "v{version}"), acronyms (GPX, URLs, 2FA) and names with an inner capital
 * (OAuth, AirTrail) are not words here.
 */
export const isPlainWord = (word) => word.length >= 2 && !/\p{Lu}/u.test(word.slice(1));

/**
 * Whether a value equal to en's is legitimately the same text. True when,
 * after dropping placeholders, markup, addresses and the brand names above,
 * at most one plain word is left: "{count} km", "OAuth", "GPX", "Google Maps",
 * "PDF · {size}", "Budget", the sort label "Name (A to Z)". Two plain words or
 * more are a phrase, and phrases differ between languages.
 */
export function isInvariant(value) {
  let text = value.replace(PLACEHOLDER_RE, ' ').replace(TAG_RE, ' ').replace(ADDRESS_RE, ' ');
  for (const name of BRAND_NAMES) text = text.split(name).join(' ');
  return (text.match(WORD_RE) ?? []).filter(isPlainWord).length <= 1;
}

/**
 * Today's counts: `{ [locale]: { [file]: { marked, identical } } }`, only
 * non-zero entries. Throws on a locale missing one of en's files or a value
 * the reader cannot parse.
 */
export function countUntranslated(root = I18N_ROOT) {
  const locales = listLocales(root);
  if (!locales.includes('en')) throw new Error(`${asPath(root)}/en is required as the reference locale`);
  const enFiles = listDomainFiles('en', root);
  const enValues = new Map(enFiles.map((f) => [f, new Map(readCatalog('en', f, root).map((e) => [e.key, e.value]))]));
  const counts = {};
  for (const locale of locales) {
    if (locale === 'en') continue;
    const files = new Set(listDomainFiles(locale, root));
    for (const file of enFiles) {
      if (!files.has(file)) throw new Error(`${locale}/${file} is missing; run i18n-parity for the file report`);
      const en = enValues.get(file);
      let marked = 0;
      let identical = 0;
      for (const { key, value, marked: isMarked } of readCatalog(locale, file, root)) {
        if (isMarked) marked++;
        else if (en.get(key) === value && !isInvariant(value)) identical++;
      }
      if (marked || identical) (counts[locale] ??= {})[file] = { marked, identical };
    }
  }
  return counts;
}

/** The committed baseline. Throws when it is missing or not the expected shape. */
export function readBaseline(path = BASELINE) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${path} cannot be read: ${err.message}. Restore it from git before running the check again.`);
  }
  const isCount = (n) => Number.isInteger(n) && n >= 0;
  const valid =
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Object.values(parsed).every(
      (files) =>
        files !== null &&
        typeof files === 'object' &&
        Object.values(files).every(
          (entry) => entry !== null && typeof entry === 'object' && isCount(entry.marked) && isCount(entry.identical),
        ),
    );
  if (!valid) throw new Error(`${path} is not a { locale: { file: { marked, identical } } } map of whole numbers`);
  return parsed;
}

const ZERO = { marked: 0, identical: 0 };

/** Every count above its baseline entry, and how many entries could come down. */
export function compare(counts, baseline) {
  const grown = [];
  let lowerable = 0;
  for (const [locale, files] of Object.entries(counts)) {
    for (const [file, now] of Object.entries(files)) {
      const allowed = baseline[locale]?.[file] ?? ZERO;
      for (const kind of ['marked', 'identical']) {
        if (now[kind] > allowed[kind]) grown.push({ locale, file, kind, now: now[kind], allowed: allowed[kind] });
      }
    }
  }
  for (const [locale, files] of Object.entries(baseline)) {
    for (const [file, allowed] of Object.entries(files)) {
      const now = counts[locale]?.[file] ?? ZERO;
      if (now.marked < allowed.marked || now.identical < allowed.identical) lowerable++;
    }
  }
  return { grown, lowerable };
}

/** The baseline lowered to `counts`: never raised, zero entries dropped, sorted. */
export function lowered(counts, baseline) {
  const out = {};
  for (const locale of Object.keys(baseline).sort()) {
    for (const file of Object.keys(baseline[locale]).sort()) {
      const allowed = baseline[locale][file];
      const now = counts[locale]?.[file] ?? ZERO;
      const entry = {
        marked: Math.min(allowed.marked, now.marked),
        identical: Math.min(allowed.identical, now.identical),
      };
      if (entry.marked || entry.identical) (out[locale] ??= {})[file] = entry;
    }
  }
  return out;
}

/** The baseline as committed: one line per file, so a diff shows which counts came down. */
export function serialize(baseline) {
  const locales = Object.keys(baseline).map((locale) => {
    const files = Object.entries(baseline[locale]).map(
      ([file, { marked, identical }]) =>
        `    ${JSON.stringify(file)}: { "marked": ${marked}, "identical": ${identical} }`,
    );
    return `  ${JSON.stringify(locale)}: {\n${files.join(',\n')}\n  }`;
  });
  return `{\n${locales.join(',\n')}\n}\n`;
}

export function formatGrown(grown) {
  return grown.map(
    ({ locale, file, kind, now, allowed }) =>
      `  ${locale}/${file}: ${now} ${kind === 'marked' ? 'marked en-fallback' : 'unmarked English copies'}, ` +
      `the baseline allows ${allowed}`,
  );
}

const total = (map, kind) =>
  Object.values(map)
    .flatMap((files) => Object.values(files))
    .reduce((sum, e) => sum + e[kind], 0);

// Compared by real path, so the check still runs when the script is started through a symlink.
const isCli =
  Boolean(process.argv[1]) && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const counts = countUntranslated();
    let baseline = readBaseline();
    if (process.argv.includes('--update')) {
      baseline = lowered(counts, baseline);
      writeFileSync(BASELINE, serialize(baseline));
    }
    const { grown, lowerable } = compare(counts, baseline);
    if (grown.length) {
      console.error('Untranslated strings grew past scripts/i18n-untranslated-baseline.json:');
      for (const line of formatGrown(grown)) console.error(line);
      console.error('Translate the new strings (shared/CLAUDE.md: an English placeholder is not acceptable).');
    }
    if (lowerable && !process.argv.includes('--update')) {
      console.log(`${lowerable} baseline entr${lowerable === 1 ? 'y is' : 'ies are'} above today's count: run with --update to lower.`);
    }
    console.log(
      `untranslated: ${total(counts, 'marked')} marked en-fallback, ${total(counts, 'identical')} unmarked English copies`,
    );
    if (grown.length) process.exit(1);
  } catch (err) {
    console.error(`FAIL  ${err.message}`);
    process.exit(1);
  }
}
