/*
 * The matching and the comparison behind lint:rtl (scripts/rtl-lint.mjs).
 */
import { join } from 'node:path';
import ts from 'typescript';
import {
  countMap,
  listFiles,
  lowerCounts,
  readBaseline,
  readText,
  TEST_FILE,
  toKey,
  writeBaseline,
} from './ratchet.mjs';

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
  'g'
);
// The same sides as React style keys, and as properties in a stylesheet.
const STYLE =
  /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|border(?:Top|Bottom)(?:Left|Right)Radius|left|right)\s*:|\b(?:textAlign|float)\s*:\s*['"](?:left|right)['"]/g;
const CSS =
  /(?<![\w-])(?:margin-left|margin-right|padding-left|padding-right|border-left[\w-]*|border-right[\w-]*|border-(?:top|bottom)-(?:left|right)-radius|left|right)\s*:|(?<![\w-])(?:text-align|float)\s*:\s*(?:left|right)\b/g;

export const DISABLE = 'rtl-lint-disable';

/**
 * The source with its comments blanked out, so prose like "top right" or
 * "left out" is no side. TypeScript finds the comments in a .ts/.tsx file,
 * which keeps `/*` and `//` inside strings and JSX text where they belong
 * (accept="image/*", a URL); a stylesheet only has block comments.
 */
function withoutComments(source, file) {
  const chars = source.split('');
  const blank = (pos, end) => {
    for (let i = pos; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
  };
  if (file.endsWith('.css')) {
    for (const m of source.matchAll(/\/\*[\s\S]*?\*\//g)) blank(m.index, m.index + m[0].length);
    return chars.join('');
  }
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const seen = new Set();
  const take = (ranges) => {
    for (const r of ranges ?? []) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      blank(r.pos, r.end);
    }
  };
  const visit = (node) => {
    take(ts.getLeadingCommentRanges(source, node.pos));
    take(ts.getTrailingCommentRanges(source, node.end));
    // JSX text holds no comments, and asking for them there would read `//` in a URL as one.
    if (!ts.isJsxText(node)) for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  take(ts.getLeadingCommentRanges(source, sf.endOfFileToken.pos));
  return chars.join('');
}

/** Whether the line carries the marker inside a comment; in a string or in code it is no marker. */
function markedInComment(line, code) {
  for (let at = line.indexOf(DISABLE); at !== -1; at = line.indexOf(DISABLE, at + 1)) {
    if (!code.slice(at, at + DISABLE.length).trim()) return true;
  }
  return false;
}

/**
 * One file read once: every physical use as `line: match`, skipping the lines
 * marked as physical on purpose, and how many lines carry that mark.
 */
export function inspect(source, file) {
  const isCss = file.endsWith('.css');
  const uses = [];
  let markers = 0;
  const lines = source.split('\n');
  withoutComments(source, file)
    .split('\n')
    .forEach((code, i) => {
      if (markedInComment(lines[i], code)) {
        markers++;
        return;
      }
      const patterns = isCss ? [CSS] : [CLASS, STYLE];
      for (const re of patterns) for (const m of code.match(re) ?? []) uses.push(`${i + 1}: ${m.trim()}`);
    });
  return { uses, markers };
}

/** Every physical use in one file, as `line: match`. */
export function physicalUses(source, file) {
  return inspect(source, file).uses;
}

/** The physical uses and the disable markers per file under root/src, keyed by the path from src/. */
export function scan(root) {
  const counts = {};
  const listed = {};
  const markers = {};
  const accept = (key) => /\.(?:tsx?|css)$/.test(key) && !TEST_FILE.test(key);
  for (const path of listFiles(root, ['src'], accept)) {
    const found = inspect(readText(path), path);
    const key = toKey(join(root, 'src'), path);
    if (found.uses.length) {
      counts[key] = found.uses.length;
      listed[key] = found.uses;
    }
    if (found.markers) markers[key] = found.markers;
  }
  return { counts, listed, markers };
}

const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

/**
 * Runs the check against both baselines: rtl-baseline.json for the physical
 * sides, rtl-disable-baseline.json for the lines that opt out of the check. A
 * marker hides a side from the count, so the markers are a ratchet as well:
 * a file holds no more of them than its entry. Returns the exit code.
 */
export function check({
  root,
  baselinePath = join(root, 'scripts/rtl-baseline.json'),
  disableBaselinePath = join(root, 'scripts/rtl-disable-baseline.json'),
  update = false,
  list = false,
  log = console.log,
  error = console.error,
}) {
  const { counts, listed, markers } = scan(root);
  let baseline = readBaseline(baselinePath, countMap);
  let allowedMarkers = readBaseline(disableBaselinePath, countMap);

  if (list) {
    for (const [file, uses] of Object.entries(listed).sort()) {
      log(`${file} (${uses.length}, baseline ${baseline[file] ?? 0})`);
      for (const use of uses) log(`  ${use}`);
    }
  }

  if (update) {
    baseline = lowerCounts(baseline, counts);
    allowedMarkers = lowerCounts(allowedMarkers, markers);
    writeBaseline(baselinePath, baseline);
    writeBaseline(disableBaselinePath, allowedMarkers);
  }

  const grown = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0));
  const marked = Object.entries(markers).filter(([file, n]) => n > (allowedMarkers[file] ?? 0));
  const lowerable =
    Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) < n).length +
    Object.entries(allowedMarkers).filter(([file, n]) => (markers[file] ?? 0) < n).length;

  for (const [file, n] of grown) {
    error(
      `FAIL  ${file}: ${n} physical side(s), baseline ${baseline[file] ?? 0}. ` +
        'Use ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e ' +
        'or marginInlineStart/paddingInlineEnd/insetInlineStart/textAlign: start. ' +
        `If the side is geometry, mark the line with ${DISABLE} in a comment.`
    );
  }
  for (const [file, n] of marked) {
    error(
      `FAIL  ${file}: ${n} line(s) marked ${DISABLE}, scripts/rtl-disable-baseline.json allows ${allowedMarkers[file] ?? 0}. ` +
        'Use the logical form where the side follows the text. A side that is geometry on purpose ' +
        '(a map, a measured position, a time axis) needs a reviewer to raise the entry by hand.'
    );
  }
  if (lowerable && !update) {
    log(`${lowerable} entr(ies) are above what the files hold now: run with --update to lower them.`);
  }
  log(
    `rtl: ${sum(counts)} physical side(s) in ${Object.keys(counts).length} file(s), baseline allows ${sum(baseline)}; ` +
      `${sum(markers)} line(s) marked ${DISABLE}, baseline allows ${sum(allowedMarkers)}`
  );
  return grown.length || marked.length ? 1 : 0;
}
