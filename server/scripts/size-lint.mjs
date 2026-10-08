#!/usr/bin/env node
/*
 * lint:size: keeps server source files from growing into the next god service.
 *
 * The same ratchet as client/scripts/size-lint.mjs. A file past a thousand
 * lines holds several concerns that no longer fit in one reading (maps,
 * places and journey are the cautionary tales), and every change to one of
 * them risks the others. Each source file under src/ and scripts/ may hold
 * LIMIT lines; the files that were already longer are listed in
 * scripts/size-baseline.json with the length they had, and the check fails
 * when one of them grows past its entry. A file that needs to grow is split
 * by concern instead (trips into trips/trip-members/trip-membership/
 * trip-invite/trip-read-model/calendar is the precedent). An entry above what
 * its file holds now, or for a file that is gone, fails as well until
 * --update lowers it: otherwise the file could grow back unseen, and a new
 * file at a deleted path would inherit its allowance.
 *
 * Lines are counted the way they read, not the way they are stored: a line
 * longer than LINE_WIDTH (prettier's printWidth) counts once per LINE_WIDTH
 * columns it spans, so joining lines does not buy room under the limit.
 *
 *   npm run lint:size              check against the baseline (CI)
 *   npm run lint:size -- --update  lower the baseline to what the files hold now;
 *                                  it never raises an entry, and drops a file
 *                                  that is back under the limit
 *
 * --dir=<path> points the check at another server root (the unit tests use it).
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The most lines a file without a baseline entry may hold. */
export const LIMIT = 1000;

/** prettier's printWidth for the server: a line past it counts once per width it spans. */
export const LINE_WIDTH = 120;

/** The trees the check walks, relative to the server root. Each one must exist. */
export const ROOTS = ['src', 'scripts'];

const SOURCE = /\.(?:[cm]?[jt]s)$/;
const TEST = /\.(?:test|spec)\./;

/**
 * Lines as an editor numbers them (a final newline does not start another),
 * with every line longer than LINE_WIDTH weighted by the widths it spans.
 * A CRLF checkout counts the same as an LF one.
 */
export function lineCount(text) {
  if (text === '') return 0;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let total = 0;
  for (const line of lines) total += Math.max(1, Math.ceil(line.length / LINE_WIDTH));
  return total;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (SOURCE.test(name) && !TEST.test(name)) files.push(path);
  }
  return files;
}

/** Weighted line counts keyed by the server-relative POSIX path. A missing root is an error. */
export function scan(serverDir) {
  const counts = {};
  for (const root of ROOTS) {
    const dir = join(serverDir, root);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`${root}/ does not exist under ${serverDir}: the check would pass without looking at anything`);
    }
    for (const path of walk(dir)) {
      counts[relative(serverDir, path).split('\\').join('/')] = lineCount(readFileSync(path, 'utf8'));
    }
  }
  return counts;
}

/**
 * The baseline as committed. Missing, unreadable or malformed stops the run: read as
 * empty, every long file would fail with no hint at the cause, and --update would
 * replace it with an empty one.
 */
export function readBaseline(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`scripts/size-baseline.json cannot be read: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('scripts/size-baseline.json must be an object of file paths to line counts');
  }
  for (const [file, n] of Object.entries(parsed)) {
    if (!Number.isInteger(n) || n <= LIMIT) {
      throw new Error(`scripts/size-baseline.json: ${file} holds ${JSON.stringify(n)}, expected an integer above ${LIMIT}`);
    }
  }
  return parsed;
}

/** The baseline lowered to what the files hold now. Never raises an entry, never adds one. */
export function lowerBaseline(baseline, counts) {
  const lowered = {};
  for (const [file, allowed] of Object.entries(baseline)) {
    const now = counts[file] ?? 0;
    if (now > LIMIT) lowered[file] = Math.min(allowed, now);
  }
  return Object.fromEntries(Object.entries(lowered).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Files over their allowance, and the baseline entries that allow more than
 * their file holds now (shrunk, back under the limit, or gone): exactly the
 * entries lowerBaseline would lower or drop.
 */
export function compare(baseline, counts) {
  const grown = Object.entries(counts).filter(([file, n]) => n > Math.max(baseline[file] ?? 0, LIMIT));
  const lowered = lowerBaseline(baseline, counts);
  const stale = Object.entries(baseline).filter(([file, n]) => lowered[file] !== n);
  return { grown, stale };
}

function main(argv) {
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const serverDir = dirArg ? resolve(dirArg.slice('--dir='.length)) : fileURLToPath(new URL('..', import.meta.url));
  const baselinePath = join(serverDir, 'scripts', 'size-baseline.json');
  const update = argv.includes('--update');

  const counts = scan(serverDir);
  let baseline = readBaseline(baselinePath);
  if (update) {
    baseline = lowerBaseline(baseline, counts);
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  }

  const { grown, stale } = compare(baseline, counts);
  for (const [file, n] of grown) {
    const entry = baseline[file];
    console.error(
      `FAIL  ${file}: ${n} lines, ` +
        (entry ? `its baseline is ${entry}. ` : `the limit is ${LIMIT}. `) +
        'Split a concern into a service, helper or module of its own instead of growing the file.',
    );
  }
  for (const [file, entry] of stale) {
    console.error(
      `FAIL  ${file} is held at ${entry} in scripts/size-baseline.json, ` +
        (file in counts ? `but it has ${counts[file]} lines now.` : 'but the file is gone.'),
    );
  }
  if (stale.length) {
    console.error(
      'Run npm run lint:size -- --update to lower the baseline with the change that made it smaller: ' +
        'an entry above the file lets it grow back unseen.',
    );
  }
  console.log(
    `size: ${Object.keys(counts).length} file(s), ${Object.keys(baseline).length} over ${LIMIT} lines held at their baseline`,
  );
  return grown.length || stale.length ? 1 : 0;
}

// Compared by real path, so the check still runs when the script is started through a symlink.
const isCli =
  Boolean(process.argv[1]) && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`FAIL  ${err.message}`);
    process.exitCode = 1;
  }
}
