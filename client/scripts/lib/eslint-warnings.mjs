/*
 * The tally and the comparison behind lint:warnings (scripts/eslint-ratchet.mjs).
 */
import { ESLint } from 'eslint';
import { join } from 'node:path';
import { countMap, lowerCounts, readBaseline, TEST_FILE, toKey, writeBaseline } from './ratchet.mjs';

/**
 * Where a warning is counted: in the app code, in the tests, or, for a
 * message an eslint-disable comment silenced, among the suppressed ones. An
 * inline disable must not be the cheap way under the ratchet.
 */
export const AREAS = ['src', 'tests', 'suppressed'];

const areaOf = (key) => (key.startsWith('tests/') || TEST_FILE.test(key) ? 'tests' : 'src');

const ruleOf = (message) =>
  message.ruleId ?? (/eslint-disable/.test(message.message) ? 'unused-disable-directive' : '(no rule)');

/** A baseline: each area an object of rule → positive count. */
export function areaCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'it is not an object of area → rule counts';
  for (const area of Object.keys(value))
    if (!AREAS.includes(area)) return `"${area}" is not one of ${AREAS.join(', ')}`;
  for (const area of AREAS) {
    if (!(area in value)) return `the "${area}" area is missing`;
    const problem = countMap(value[area]);
    if (problem) return `in "${area}", ${problem}`;
  }
  return null;
}

/**
 * The warnings per area and rule in ESLint's results, the files behind each
 * count, and every error (an error, a parse failure included, always fails).
 */
export function tally(results, root) {
  const counts = Object.fromEntries(AREAS.map((area) => [area, {}]));
  const files = Object.fromEntries(AREAS.map((area) => [area, {}]));
  const errors = [];
  const add = (area, rule, key) => {
    counts[area][rule] = (counts[area][rule] ?? 0) + 1;
    const where = (files[area][rule] ??= {});
    where[key] = (where[key] ?? 0) + 1;
  };
  for (const result of results) {
    const key = toKey(root, result.filePath);
    for (const message of result.messages) {
      if (message.fatal || message.severity === 2)
        errors.push(`${key}:${message.line ?? 0}:${message.column ?? 0}  ${message.message} (${ruleOf(message)})`);
      else add(areaOf(key), ruleOf(message), key);
    }
    for (const message of result.suppressedMessages ?? []) add('suppressed', ruleOf(message), key);
  }
  return { counts, files, errors };
}

/**
 * The part of an ESLint result the tally reads.
 *
 * @typedef {{ ruleId: string | null, severity: number, message: string, fatal?: boolean, line?: number, column?: number }} LintMessage
 * @typedef {{ filePath: string, messages: LintMessage[], suppressedMessages?: LintMessage[] }} LintResult
 */

/**
 * ESLint over the whole client, with its own config, as `npm run lint:check` runs it.
 *
 * @param {string} root
 * @returns {Promise<LintResult[]>}
 */
export async function lintClient(root) {
  return new ESLint({ cwd: root }).lintFiles(['.']);
}

const sum = (map) => Object.values(map).reduce((a, b) => a + b, 0);

/**
 * Runs ESLint (or lint, in a test) and compares the warnings with the
 * baseline at baselinePath. Returns the exit code.
 */
export async function check({
  root,
  baselinePath = join(root, 'scripts/eslint-baseline.json'),
  update = false,
  lint = lintClient,
  log = console.log,
  error = console.error,
}) {
  let baseline = readBaseline(baselinePath, areaCounts);
  const { counts, files, errors } = tally(await lint(root), root);

  if (update) {
    baseline = Object.fromEntries(AREAS.map((area) => [area, lowerCounts(baseline[area], counts[area])]));
    writeBaseline(baselinePath, baseline);
  }

  for (const line of errors) error(`FAIL  ${line}`);
  let grown = 0;
  let lowerable = 0;
  for (const area of AREAS) {
    for (const [rule, n] of Object.entries(counts[area])) {
      const allowed = baseline[area][rule] ?? 0;
      if (n <= allowed) continue;
      grown++;
      const top = Object.entries(files[area][rule])
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([key, k]) => `${key} (${k})`);
      error(`FAIL  ${area}: ${n} ${rule} warning(s), baseline ${allowed}. Most in: ${top.join(', ')}`);
    }
    for (const [rule, allowed] of Object.entries(baseline[area])) if ((counts[area][rule] ?? 0) < allowed) lowerable++;
  }
  if (grown) {
    error(
      'Fix the new warning rather than silencing it: an eslint-disable comment is counted under "suppressed". ' +
        'Run npx eslint <file> to see each one.'
    );
  }
  if (lowerable && !update) log(`${lowerable} rule count(s) fell below the baseline: run with --update to lower it.`);
  log(
    `eslint: ${errors.length} error(s); warnings ${AREAS.map((area) => `${area} ${sum(counts[area])}/${sum(baseline[area])}`).join(', ')} (now/baseline)`
  );
  return errors.length || grown ? 1 : 0;
}
