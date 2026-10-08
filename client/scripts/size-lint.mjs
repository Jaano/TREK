#!/usr/bin/env node
/*
 * lint:size: keeps source files from growing into the next god file.
 *
 * A file past a thousand lines holds several concerns that no longer fit in
 * one reading, and every change to one of them risks the others. Each source
 * file under src/ (tests aside) may hold LIMIT lines; the files that were
 * already longer are listed in scripts/size-baseline.json with the length
 * they had, and the check fails when one of them grows past its entry. A
 * file that needs to grow is split by concern instead (the trip planner hook,
 * page and road trip sidebar are the precedent).
 *
 *   npm run lint:size              check against the baseline (CI)
 *   npm run lint:size -- --update  lower the baseline to what the files hold now;
 *                                  it never raises an entry, and drops a file
 *                                  that is back under the limit
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const BASELINE = fileURLToPath(new URL('./size-baseline.json', import.meta.url))

/** The most lines a file without a baseline entry may hold. */
export const LIMIT = 1000

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (/\.tsx?$/.test(name) && !/\.(?:test|spec)\./.test(name)) files.push(path)
  }
  return files
}

/** Lines as an editor numbers them: a final newline does not start another. */
export function lineCount(text) {
  if (text === '') return 0
  const breaks = text.split('\n').length - 1
  return text.endsWith('\n') ? breaks : breaks + 1
}

function scan() {
  const counts = {}
  for (const path of walk(SRC)) counts[relative(SRC, path).split('\\').join('/')] = lineCount(readFileSync(path, 'utf8'))
  return counts
}

/**
 * The baseline as committed. A missing file is an empty baseline. One that cannot be
 * read or parsed stops the run with its reason: read as empty, every long file would
 * fail with no hint at the cause, and --update would replace it with an empty one.
 */
function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    console.error(`FAIL  scripts/size-baseline.json cannot be read: ${err.message}`)
    console.error('Restore the file from git before running the check or --update again.')
    process.exit(1)
  }
}

// Compared by real path, so the check still runs when the script is started through a symlink.
const isCli =
  Boolean(process.argv[1]) && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const counts = scan()
  let baseline = readBaseline()

  if (process.argv.includes('--update')) {
    const lowered = {}
    for (const [file, allowed] of Object.entries(baseline)) {
      const now = counts[file] ?? 0
      if (now > LIMIT) lowered[file] = Math.min(allowed, now)
    }
    const sorted = Object.fromEntries(Object.entries(lowered).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n')
    baseline = sorted
  }

  const grown = Object.entries(counts).filter(([file, n]) => n > Math.max(baseline[file] ?? 0, LIMIT))
  const lowerable = Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) < n)

  for (const [file, n] of grown) {
    const entry = baseline[file]
    console.error(
      `FAIL  ${file}: ${n} lines, ` +
        (entry ? `its baseline is ${entry}. ` : `the limit is ${LIMIT}. `) +
        'Move a concern into a hook or component of its own instead of growing the file.',
    )
  }
  if (lowerable.length && !process.argv.includes('--update')) {
    console.log(`${lowerable.length} file(s) are shorter than their baseline now: run with --update to lower it.`)
  }
  const listed = Object.keys(baseline).length
  console.log(`size: ${Object.keys(counts).length} file(s), ${listed} over ${LIMIT} lines held at their baseline`)
  if (grown.length) process.exit(1)
}
