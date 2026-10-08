import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DYNAMIC_ALLOWED,
  evaluate,
  firstArgument,
  readEnKeys,
  scanSource,
  scanTree,
  templatePattern,
} from '../../../scripts/i18n-keys.mjs'

// FE-I18N-KEYS-001 to FE-I18N-KEYS-010: the client key check (scripts/i18n-keys.mjs).

const EN = new Set(['budget.title', 'places.count', 'places.count.one', 'trips.total.other', 'trips.total.one', 'costs.filter.all'])

describe('i18n key check', () => {
  it('FE-I18N-KEYS-001: finds literal keys in t, tHtml, tr, TransHtml, translateApiError and *Key props', () => {
    const { literal } = scanSource([
      "t('budget.title')",
      'props.t("places.count", { count })',
      "tHtml('a.html')",
      "tr('pdf.mapTitle')",
      '<TransHtml html="journey.text" />',
      "translateApiError(t, err, 'files.uploadError')",
      "const tabs = [{ labelKey: 'tabs.one' }]",
      '<Hint titleKey="hint.title" />',
    ].join('\n'))
    expect(literal.map((l) => l.key)).toEqual([
      'budget.title', 'places.count', 'a.html', 'pdf.mapTitle', 'journey.text', 'files.uploadError', 'tabs.one', 'hint.title',
    ])
  })

  it('FE-I18N-KEYS-002: checks both sides of a conditional key and ignores later arguments', () => {
    const { literal } = scanSource("t(open ? 'a.open' : 'a.closed', { name: 'x.y' })")
    expect(literal.map((l) => l.key)).toEqual(['a.open', 'a.closed'])
    expect(firstArgument("t(fn(a, b) ? 'x.y' : 'z.w', 1)", 1)).toBe("fn(a, b) ? 'x.y' : 'z.w'")
  })

  it('FE-I18N-KEYS-003: reads templates, appended prefixes and key builders as patterns', () => {
    const { literal, dynamic } = scanSource([
      't(`costs.filter.${f}`)',
      "t('costs.filter.' + f)",
      't(`plain.key`)',
      'export const guideKey = (id: string): string =>\n  `help.guide.${id}.title`',
      'const cacheKey = (id: number): string => `${id} x`',
      "const other = notATranslation('x.y')",
    ].join('\n'))
    expect(literal.map((l) => l.key)).toEqual(['plain.key'])
    expect(dynamic.map((d) => d.template)).toEqual(['costs.filter.${f}', 'costs.filter.${…}', 'help.guide.${id}.title'])
    expect(templatePattern('costs.filter.${f}')!.test('costs.filter.all')).toBe(true)
    expect(templatePattern('${opt.label}Hint')).toBeNull()
  })

  it('FE-I18N-KEYS-004: fails a literal key en lacks and accepts a plural group by its general form', () => {
    const scan = scanSource("t('budget.addCategory'); t('places.count', { count }); t('trips.total', { count })")
    const { missing } = evaluate(scan, EN, [])
    expect(missing.map((m) => m.key)).toEqual(['budget.addCategory'])
  })

  it('FE-I18N-KEYS-005: fails a template no en key matches unless it is allowed with the keys it resolves to', () => {
    const scan = scanSource('t(`costs.filter.${f}`); t(`gone.prefix.${x}`); t(`${opt.label}Hint`)')
    expect(evaluate(scan, EN, []).unmatched.map((u) => u.template)).toEqual(['gone.prefix.${x}', '${opt.label}Hint'])
    const allowed = [{ template: '${opt.label}Hint', because: 'test', resolves: ['budget.title'] }]
    const result = evaluate(scan, EN, allowed)
    expect(result.unmatched.map((u) => u.template)).toEqual(['gone.prefix.${x}'])
    expect(result.stale).toEqual([])
  })

  it('FE-I18N-KEYS-006: refuses an allow-list entry nothing uses or whose keys en lacks', () => {
    const scan = scanSource('t(`${opt.label}Hint`)')
    const unused = [{ template: '${gone}', because: 'test', resolves: ['budget.title'] }]
    expect(evaluate(scan, EN, unused).stale).toEqual(unused)
    const wrong = [{ template: '${opt.label}Hint', because: 'test', resolves: ['share.nope'] }]
    expect(evaluate(scan, EN, wrong).stale).toEqual(wrong)
  })

  it('FE-I18N-KEYS-007: reports en keys neither a literal nor a pattern reaches', () => {
    const scan = scanSource("t('budget.title'); t('places.count', { count }); t(`costs.filter.${f}`)")
    expect(evaluate(scan, EN, []).unused).toEqual(['trips.total.other', 'trips.total.one'])
  })

  it('FE-I18N-KEYS-008: every allow-list entry carries a reason and the keys it resolves to', () => {
    for (const entry of DYNAMIC_ALLOWED) {
      expect(entry.because.length).toBeGreaterThan(20)
      expect(entry.resolves.length).toBeGreaterThan(0)
    }
  })

  it('FE-I18N-KEYS-009: fails closed on a missing source tree or one without any key', () => {
    expect(() => scanTree(join(tmpdir(), 'trek-i18n-keys-does-not-exist'))).toThrow(/does not exist/)
    const empty = mkdtempSync(join(tmpdir(), 'trek-i18n-keys-'))
    try {
      expect(() => scanTree(empty)).toThrow(/scanner is broken/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('FE-I18N-KEYS-010: the client source names no key en lacks today', async () => {
    const enKeys = await readEnKeys()
    const { missing, unmatched, stale } = evaluate(scanTree(), enKeys)
    expect(missing).toEqual([])
    expect(unmatched).toEqual([])
    expect(stale).toEqual([])
  })
})
