/**
 * Plural forms for count-bearing strings.
 *
 * A string that depends on a number keeps its key as the general form and
 * adds one key per CLDR category the language needs: `places.count` reads
 * "{count} places", `places.count.one` reads "{count} place". Russian adds
 * `.few` and `.many`, Arabic `.zero`, `.two`, `.few` and `.many`, Japanese
 * none at all. Which category a number takes is the language's own rule, read
 * from `Intl.PluralRules`, never a `count === 1` in the caller: 21 is "one" in
 * Russian and 0 is "one" in French.
 */

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

const rules = new Map<string, Intl.PluralRules>();

function rulesFor(intlLocale: string): Intl.PluralRules {
  let r = rules.get(intlLocale);
  if (!r) {
    r = new Intl.PluralRules(intlLocale);
    rules.set(intlLocale, r);
  }
  return r;
}

/** The CLDR category `count` takes in `intlLocale` (a BCP 47 tag, see `getIntlLanguage`). */
export function pluralCategory(count: number, intlLocale: string): PluralCategory {
  return rulesFor(intlLocale).select(count) as PluralCategory;
}

/**
 * The key a count-bearing string resolves to in `strings`: the form for the
 * count's category, else the `.other` form, else the key itself. Undefined
 * when `strings` has none of them, so the caller can fall back to another
 * locale with that locale's own rules.
 */
export function resolvePluralKey(
  strings: Readonly<Record<string, unknown>>,
  key: string,
  count: number,
  intlLocale: string,
): string | undefined {
  for (const candidate of [`${key}.${pluralCategory(count, intlLocale)}`, `${key}.other`, key]) {
    if (typeof strings[candidate] === 'string') return candidate;
  }
  return undefined;
}

/**
 * The categories whole counts from 0 to 200 reach: the forms a translation
 * has to spell out. Categories only fractions or millions reach (French
 * `many`, Russian `other`) fall back to the general form.
 */
export function integerPluralCategories(intlLocale: string): PluralCategory[] {
  const r = rulesFor(intlLocale);
  const seen = new Set<PluralCategory>();
  for (let n = 0; n <= 200; n++) seen.add(r.select(n) as PluralCategory);
  return PLURAL_CATEGORIES.filter((c) => seen.has(c));
}

/** Every category the language has at all, for refusing a form it can never select. */
export function allPluralCategories(intlLocale: string): PluralCategory[] {
  return rulesFor(intlLocale).resolvedOptions().pluralCategories as PluralCategory[];
}
