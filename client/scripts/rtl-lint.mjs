#!/usr/bin/env node
/*
 * lint:rtl: keeps the layout following the reading direction.
 *
 * Arabic runs the app with dir="rtl". A physical class or style (ml-2,
 * text-left, paddingLeft, left: 0) stays on the same side in either direction,
 * so a gap, an indent or an alignment that follows the text in English lands
 * on the wrong side in Arabic. The logical forms (ms-2, text-start,
 * paddingInlineStart, insetInlineStart) follow the direction, and in a
 * left-to-right language they are exactly the physical ones.
 *
 * Some things are physical on purpose: a map, a chart axis, a drag handle, a
 * popover placed at measured coordinates. Those stay. Every file's physical
 * uses are counted against scripts/rtl-baseline.json, and the check fails when
 * a file holds more than its entry (a file without an entry holds none), so
 * new code reaches for the logical forms. A line that is physical on purpose
 * in new code carries `rtl-lint-disable` in a comment.
 *
 *   npm run lint:rtl              check against the baseline (CI)
 *   npm run lint:rtl -- --list    print every counted use, file by file
 *   npm run lint:rtl -- --update  lower the baseline to what the files hold now;
 *                                 it never raises an entry
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const BASELINE = fileURLToPath(new URL('./rtl-baseline.json', import.meta.url))

// Tailwind utilities that name a physical side, with any variant prefix
// (sm:, hover:, group-hover:) and the negative form (-ml-2).
const CLASS = new RegExp(
  String.raw`(?<![\w-])(?:[\w-]+:)*-?(?:` +
    [
      String.raw`(?:ml|mr|pl|pr|left|right|scroll-m[lr]|scroll-p[lr])-(?:\[[^\]\s]+\]|[\w./]+)`,
      String.raw`text-(?:left|right)(?![\w-])`,
      String.raw`border-[lr](?:-[\w[\]#./()-]+)?(?![\w-])`,
      String.raw`rounded-(?:l|r|tl|tr|bl|br)(?:-[\w[\]./]+)?(?![\w-])`,
      String.raw`(?:float|clear)-(?:left|right)(?![\w-])`,
      String.raw`space-x-[\w.]+`,
    ].join('|') +
    ')',
  'g',
)
// The same sides as React style keys, and as properties in a stylesheet.
const STYLE =
  /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|border(?:Top|Bottom)(?:Left|Right)Radius|left|right)\s*:|\b(?:textAlign|float)\s*:\s*['"](?:left|right)['"]/g
const CSS =
  /(?<![\w-])(?:margin-left|margin-right|padding-left|padding-right|border-left[\w-]*|border-right[\w-]*|border-(?:top|bottom)-(?:left|right)-radius|left|right)\s*:|(?<![\w-])(?:text-align|float)\s*:\s*(?:left|right)\b/g

const DISABLE = 'rtl-lint-disable'

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (/\.(?:tsx?|css)$/.test(name) && !/\.(?:test|spec)\./.test(name)) files.push(path)
  }
  return files
}

/**
 * The source with its comments blanked out, so prose like "top right" or
 * "left out" is no side. TypeScript finds the comments in a .ts/.tsx file,
 * which keeps `/*` and `//` inside strings and JSX text where they belong
 * (accept="image/*", a URL); a stylesheet only has block comments.
 */
function withoutComments(source, file) {
  const chars = source.split('')
  const blank = (pos, end) => {
    for (let i = pos; i < end; i++) if (chars[i] !== '\n') chars[i] = ' '
  }
  if (file.endsWith('.css')) {
    for (const m of source.matchAll(/\/\*[\s\S]*?\*\//g)) blank(m.index, m.index + m[0].length)
    return chars.join('')
  }
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const seen = new Set()
  const take = (ranges) => {
    for (const r of ranges ?? []) {
      if (seen.has(r.pos)) continue
      seen.add(r.pos)
      blank(r.pos, r.end)
    }
  }
  const visit = (node) => {
    take(ts.getLeadingCommentRanges(source, node.pos))
    take(ts.getTrailingCommentRanges(source, node.end))
    // JSX text holds no comments, and asking for them there would read `//` in a URL as one.
    if (!ts.isJsxText(node)) for (const child of node.getChildren(sf)) visit(child)
  }
  visit(sf)
  take(ts.getLeadingCommentRanges(source, sf.endOfFileToken.pos))
  return chars.join('')
}

/** Every physical use in one file, as `line: match`. */
export function physicalUses(source, file) {
  const isCss = file.endsWith('.css')
  const uses = []
  const lines = source.split('\n')
  withoutComments(source, file).split('\n').forEach((code, i) => {
    if (lines[i].includes(DISABLE)) return
    const patterns = isCss ? [CSS] : [CLASS, STYLE]
    for (const re of patterns) for (const m of code.match(re) ?? []) uses.push(`${i + 1}: ${m.trim()}`)
  })
  return uses
}

function scan() {
  const counts = {}
  const listed = {}
  for (const file of walk(SRC)) {
    const uses = physicalUses(readFileSync(file, 'utf8'), file)
    if (!uses.length) continue
    const key = relative(SRC, file).replace(/\\/g, '/')
    counts[key] = uses.length
    listed[key] = uses
  }
  return { counts, listed }
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    return {}
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isCli) {
  const { counts, listed } = scan()
  const baseline = readBaseline()

  if (process.argv.includes('--list')) {
    for (const [file, uses] of Object.entries(listed).sort()) {
      console.log(`${file} (${uses.length}, baseline ${baseline[file] ?? 0})`)
      for (const use of uses) console.log(`  ${use}`)
    }
  }

  if (process.argv.includes('--update')) {
    const lowered = {}
    for (const [file, allowed] of Object.entries(baseline)) {
      const now = counts[file] ?? 0
      if (now > 0) lowered[file] = Math.min(allowed, now)
    }
    const sorted = Object.fromEntries(Object.entries(lowered).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n')
  }

  const grown = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0))
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const allowed = Object.values(baseline).reduce((a, b) => a + b, 0)
  const lowerable = Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) < n)

  for (const [file, n] of grown) {
    console.error(
      `FAIL  ${file}: ${n} physical side(s), baseline ${baseline[file] ?? 0}. ` +
        'Use ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e ' +
        'or marginInlineStart/paddingInlineEnd/insetInlineStart/textAlign: start. ' +
        `If the side is geometry, mark the line with ${DISABLE}.`,
    )
  }
  if (lowerable.length && !process.argv.includes('--update')) {
    console.log(`${lowerable.length} file(s) now hold fewer physical sides than the baseline: run with --update to lower it.`)
  }
  console.log(`rtl: ${total} physical side(s) in ${Object.keys(counts).length} file(s), baseline allows ${allowed}`)
  if (grown.length) process.exit(1)
}
