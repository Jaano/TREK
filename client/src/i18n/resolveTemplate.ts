import en from '@trek/shared/i18n/en'
import { resolvePluralKey } from '@trek/shared'
import type { TranslationStrings } from '@trek/shared/i18n'

/**
 * The template a key reads as. A numeric `count` (or `n`) picks the plural
 * form the language's own rule selects (see `@trek/shared` plural helpers):
 * `places.count.one`, `.few`, ... and the key itself as the general form.
 * The active locale is asked with its rule first; English, with English's,
 * only when the locale has none of the key's forms.
 */
export function resolveTemplate(
  strings: TranslationStrings,
  intlLanguage: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = params?.count ?? params?.n
  const count = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
  if (count !== undefined) {
    const own = resolvePluralKey(strings, key, count, intlLanguage)
    if (own) return strings[own] as string
    const fallback = resolvePluralKey(en, key, count, 'en')
    if (fallback) return en[fallback] as string
    return key
  }
  return (strings[key] ?? en[key] ?? key) as string
}
