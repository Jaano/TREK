/*
 * lint:i18n-keys: every translation key the client names exists in en.
 *
 * `t()` takes any string and returns the key itself when en has no such
 * entry, so a typo or a key deleted from the locales renders as raw
 * "budget.addCategory" text and nothing fails. Locale parity cannot see it:
 * it compares the locales with en, not en with the code. This check reads
 * src/ (tests aside) and resolves what it finds against shared/src/i18n/en:
 *
 *   t('x.y'), tHtml('x.y'), tr('x.y')   every string literal in the first
 *                                       argument, so both sides of a
 *                                       `cond ? 'a.b' : 'c.d'` are checked
 *   <TransHtml html="x.y" />            the markup variant
 *   translateApiError(t, err, 'x.y')    the fallback key
 *   labelKey: 'x.y', titleKey="x.y"     any property or prop named *Key that
 *                                       holds a dotted key, the tables
 *                                       components feed to t() later
 *   const guideKey = (id) => `help.${id}`  a key builder (help/registry.ts):
 *                                       a template returned by a const
 *                                       named *Key, read as a template key
 *
 * A key exists when en declares it, or declares `key.other` (a plural group
 * whose general form is spelled out). A template literal key such as
 * t(`budget.category.${id}`), or a prefix with the rest appended
 * (t('costs.filter.' + f)), cannot be resolved; it passes when its fixed
 * parts match at least one en key, and otherwise only through DYNAMIC_ALLOWED.
 * A key held in a variable (`t(opt.label)`) is out of reach unless the table
 * names it in a *Key property.
 *
 *   npm run lint:i18n-keys              check (CI)
 *   npm run lint:i18n-keys -- --unused  also list en keys no literal or pattern reaches
 *
 * The unused list is information, not a gate: keys reached through a
 * variable (`t(item.labelKey)` with the table elsewhere, server-sent error
 * keys) look unused here.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Plain paths rather than `new URL(..., import.meta.url)`: under the test runner's DOM environment URL is
// jsdom's, which fileURLToPath refuses.
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const SHARED_SCRIPTS = join(HERE, '..', '..', 'shared', 'scripts')

/**
 * Template literal keys whose fixed parts match no en key, each with the
 * reason it still resolves and the keys it resolves to, which must exist.
 * Keep this short: every entry is a key the check cannot follow.
 */
export const DYNAMIC_ALLOWED = [
  {
    template: '${opt.label}Hint',
    because:
      'TripShareDialog appends Hint to each SHARE_OPTIONS label (useTripShare.ts); share.optTravelOnlyHint ' +
      'and share.optHideImagesHint exist, and the template has no fixed part to match them by',
    resolves: ['share.optTravelOnlyHint', 'share.optHideImagesHint'],
  },
]

const KEY_RE = /^[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_:-]+)+$/
const PREFIX_RE = /^[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_:-]+)*\.$/
const CALL_RE = /(?<![\w$.])(?:t|tHtml|tr)\(|(?<=[\w$]\.)(?:t|tHtml)\(/g
const HTML_PROP_RE = /<TransHtml\b[^>]*?\bhtml=(["'])([^"'\n]+)\1/g
const API_ERROR_RE = /\btranslateApiError\(\s*t\s*,[^,()]*(?:\([^()]*\))?[^,()]*,\s*(['"])([^'"\n]+)\1/g
const KEY_BUILDER_RE = /\bconst\s+[a-zA-Z]*Key\s*=\s*\([^)]*\)\s*(?::\s*[^=]+?)?=>\s*`((?:\\.|\$\{[^}]*\}|[^`\\])*)`/g
const KEY_PROP_RE = /\b[a-zA-Z]*Key\s*(?::|=\{?)\s*(['"])([a-z][a-zA-Z0-9_]*\.[^'"\s]+)\1/g

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (/\.tsx?$/.test(name) && !/\.(?:test|spec)\./.test(name) && !name.endsWith('.d.ts')) files.push(path)
  }
  return files
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length

/**
 * The source of the first argument of the call whose `(` sits at `open`:
 * everything up to the top-level comma or the closing parenthesis, with
 * strings, template literals and nested brackets skipped as units.
 */
export function firstArgument(text, open) {
  let depth = 0
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) {
        if (text[i] === '\\') i++
        else if (c === '`' && text[i] === '$' && text[i + 1] === '{') {
          // Skip the interpolation, counting its braces.
          let braces = 0
          for (; i < text.length; i++) {
            if (text[i] === '{') braces++
            else if (text[i] === '}' && --braces === 0) break
          }
        }
      }
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return text.slice(open + 1, i)
      depth--
    } else if (c === ',' && depth === 0) return text.slice(open + 1, i)
  }
  return text.slice(open + 1)
}

/** The quoted literals and template literals of an argument's source. */
export function literalsIn(arg) {
  const quoted = []
  const templates = []
  for (const m of arg.matchAll(/(['"])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|\$\{[^}]*\}|[^`\\])*)`/g)) {
    if (m[3] !== undefined) templates.push(m[3])
    else quoted.push(m[2])
  }
  return { quoted, templates }
}

/** A template literal's key pattern: its fixed parts, anything in between. Null when it has no fixed dotted prefix. */
export function templatePattern(template) {
  const parts = template.split(/\$\{[^}]*\}/)
  if (!/^[a-z][a-zA-Z0-9_]*\./.test(parts[0] ?? '')) return null
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${parts.map(escape).join('.+')}$`)
}

/** Every key reference in one file's source. */
export function scanSource(text, file = '<source>') {
  const literal = []
  const dynamic = []
  for (const m of text.matchAll(CALL_RE)) {
    const open = m.index + m[0].length - 1
    const { quoted, templates } = literalsIn(firstArgument(text, open))
    const line = lineAt(text, m.index)
    for (const key of quoted) {
      if (KEY_RE.test(key)) literal.push({ file, line, key })
      // t('costs.filter.' + f): a prefix with the rest appended, read like a template.
      else if (PREFIX_RE.test(key)) dynamic.push({ file, line, template: `${key}\${…}`, pattern: templatePattern(`${key}\${…}`) })
    }
    for (const template of templates) {
      if (!template.includes('${')) {
        if (KEY_RE.test(template)) literal.push({ file, line, key: template })
        continue
      }
      dynamic.push({ file, line, template, pattern: templatePattern(template) })
    }
  }
  for (const m of text.matchAll(KEY_BUILDER_RE)) {
    // Builders of other strings (cache keys) have no fixed dotted prefix and are not translation keys.
    const pattern = templatePattern(m[1])
    if (pattern) dynamic.push({ file, line: lineAt(text, m.index), template: m[1], pattern })
  }
  for (const re of [HTML_PROP_RE, API_ERROR_RE, KEY_PROP_RE]) {
    for (const m of text.matchAll(re)) {
      if (KEY_RE.test(m[2])) literal.push({ file, line: lineAt(text, m.index), key: m[2] })
    }
  }
  return { literal, dynamic }
}

/** en's keys, read from the locale sources with the shared parity tooling's reader. */
export async function readEnKeys() {
  const { listDomainFiles, readCatalog } = await import(pathToFileURL(join(SHARED_SCRIPTS, 'i18n-catalog.mjs')).href)
  const keys = new Set()
  for (const file of listDomainFiles('en')) for (const { key } of readCatalog('en', file)) keys.add(key)
  if (keys.size === 0) throw new Error('shared/src/i18n/en holds no keys: the reader or the path is broken')
  return keys
}

export const hasKey = (enKeys, key) => enKeys.has(key) || enKeys.has(`${key}.other`)

/**
 * The verdict over a scan: literal keys en lacks, template keys no en key
 * matches (unless allowed), allow-list entries nothing uses any more, and
 * the en keys nothing reaches.
 */
export function evaluate(scan, enKeys, allowed = DYNAMIC_ALLOWED) {
  const missing = scan.literal.filter(({ key }) => !hasKey(enKeys, key))
  const allowedTemplates = new Set(allowed.map((a) => a.template))
  const unmatched = scan.dynamic.filter(
    ({ template, pattern }) =>
      !allowedTemplates.has(template) && !(pattern && [...enKeys].some((k) => pattern.test(k))),
  )
  const usedTemplates = new Set(scan.dynamic.map((d) => d.template))
  const stale = allowed.filter((a) => !usedTemplates.has(a.template) || a.resolves.some((k) => !hasKey(enKeys, k)))
  const reached = new Set([...scan.literal.map((l) => l.key), ...allowed.flatMap((a) => a.resolves)])
  const patterns = scan.dynamic.map((d) => d.pattern).filter(Boolean)
  const base = (k) => k.replace(/\.(?:zero|one|two|few|many|other)$/, '')
  const unused = [...enKeys].filter(
    (k) => !reached.has(k) && !reached.has(base(k)) && !patterns.some((p) => p.test(k) || p.test(base(k))),
  )
  return { missing, unmatched, stale, unused }
}

export function scanTree(root = SRC) {
  if (!existsSync(root)) throw new Error(`${root} does not exist`)
  const scan = { literal: [], dynamic: [] }
  for (const path of walk(root)) {
    const found = scanSource(readFileSync(path, 'utf8'), relative(root, path).split('\\').join('/'))
    scan.literal.push(...found.literal)
    scan.dynamic.push(...found.dynamic)
  }
  if (scan.literal.length === 0) throw new Error(`no translation key found under ${root}: the scanner is broken`)
  return scan
}

// Compared by real path, so the check still runs when the script is started through a symlink.
const isCli =
  Boolean(process.argv[1]) && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  try {
    const scan = scanTree()
    const enKeys = await readEnKeys()
    const { missing, unmatched, stale, unused } = evaluate(scan, enKeys)
    for (const { file, line, key } of missing) {
      console.error(`FAIL  ${file}:${line}: '${key}' is not a key in shared/src/i18n/en`)
    }
    for (const { file, line, template } of unmatched) {
      console.error(`FAIL  ${file}:${line}: \`${template}\` matches no key in shared/src/i18n/en`)
    }
    for (const { template } of stale) {
      console.error(`FAIL  DYNAMIC_ALLOWED lists \`${template}\`, which no file uses any more: remove the entry`)
    }
    if (process.argv.includes('--unused')) for (const key of unused.sort()) console.log(`unused  ${key}`)
    console.log(
      `i18n keys: ${new Set(scan.literal.map((l) => l.key)).size} literal and ${scan.dynamic.length} template ` +
        `reference(s) checked against ${enKeys.size} en keys; ${unused.length} en key(s) reached by neither ` +
        '(information, --unused lists them)',
    )
    if (missing.length || unmatched.length || stale.length) process.exit(1)
  } catch (err) {
    console.error(`FAIL  ${err.message}`)
    process.exit(1)
  }
}
