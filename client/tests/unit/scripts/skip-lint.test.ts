import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { RatchetError } from '../../../scripts/lib/ratchet.mjs';
import { check, modifiers } from '../../../scripts/lib/skips.mjs';
import { ratchetTree, type RatchetTree } from '../../helpers/ratchetFixture';

let tree: RatchetTree;
afterEach(() => tree?.remove());

const BASELINE = 'scripts/skip-baseline.json';
const PASSING = "it('works', () => {})\n";

function run(baseline: Record<string, number>, files: Record<string, string>, update = false) {
  tree = ratchetTree({
    [BASELINE]: JSON.stringify(baseline),
    'src/a.test.ts': PASSING,
    'tests/b.test.ts': PASSING,
    'e2e/c.spec.ts': PASSING,
    ...files,
  });
  return check({ root: tree.root, baselinePath: tree.path(BASELINE), update, ...tree.out });
}

describe('lint:skips', () => {
  it('SKIPS-001: finds declared skips, todos and the x-shorthands', () => {
    const source = [
      "it.skip('a', () => {})",
      "describe.skip('b', () => {})",
      "test.todo('c')",
      "it.skip.each([1])('d %s', () => {})",
      "test.describe.skip('e', () => {})",
      "xit('f', () => {})",
      "it.concurrent.skip('g', () => {})",
    ].join('\n');
    expect(modifiers(source, 'x.test.ts').skipped.map((s: string) => s.split(':')[0])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
  });

  it('SKIPS-002: leaves run-time skips, skipIf/runIf, comments and strings alone', () => {
    const source = [
      "test.skip(!seed.collectionId, 'collections addon unavailable')",
      "test('x', async () => { test.skip() })",
      "it.skipIf(process.platform === 'win32')('y', () => {})",
      "describe.runIf(hasS3)('z', () => {})",
      "// it.skip('commented out', () => {})",
      'const doc = "describe.only(\'in a string\')"',
      'ctx.skip()',
    ].join('\n');
    expect(modifiers(source, 'x.test.ts')).toEqual({ skipped: [], only: [] });
  });

  it('SKIPS-003: finds .only on any runner', () => {
    const source = "it.only('a', () => {})\ndescribe.only('b', () => {})\ntest.describe.only('c', () => {})\n";
    expect(modifiers(source, 'x.spec.ts').only).toHaveLength(3);
  });

  it('SKIPS-004: fails any .only, even in a file with a baseline entry', () => {
    expect(run({ 'tests/b.test.ts': 5 }, { 'tests/b.test.ts': "it.only('a', () => {})\n" })).toBe(1);
    expect(tree.error.join('\n')).toMatch(/tests\/b\.test\.ts: \.only runs this test alone/);
    tree.remove();
    expect(run({}, { 'e2e/c.spec.ts': "test.only('a', async () => {})\n" })).toBe(1);
  });

  it('SKIPS-005: fails a new skip and holds a baselined file at its entry', () => {
    expect(run({}, { 'src/a.test.ts': "it.skip('a', () => {})\n" })).toBe(1);
    expect(tree.error.join('\n')).toMatch(/src\/a\.test\.ts: 1 skipped or todo test\(s\), baseline 0/);
    tree.remove();
    expect(run({ 'src/a.test.ts': 1 }, { 'src/a.test.ts': "it.skip('a', () => {})\n" })).toBe(0);
  });

  it('SKIPS-006: only scans test files under src/', () => {
    expect(run({}, { 'src/helper.ts': "it.skip('not a test file', () => {})\n" })).toBe(0);
  });

  it('SKIPS-007: --update lowers the baseline and never raises it', () => {
    run(
      { 'src/a.test.ts': 3, 'tests/b.test.ts': 1 },
      { 'src/a.test.ts': "it.skip('a', () => {})\nit.skip('b', () => {})\n" },
      true
    );
    expect(JSON.parse(readFileSync(tree.path(BASELINE), 'utf8'))).toEqual({ 'src/a.test.ts': 2 });
  });

  it('SKIPS-008: a missing baseline or test directory stops the check', () => {
    tree = ratchetTree({ 'src/a.test.ts': PASSING, 'tests/b.test.ts': PASSING, 'e2e/c.spec.ts': PASSING });
    expect(() => check({ root: tree.root, baselinePath: tree.path(BASELINE), ...tree.out })).toThrow(RatchetError);
    tree.remove();
    tree = ratchetTree({ [BASELINE]: '{}', 'src/a.test.ts': PASSING, 'tests/b.test.ts': PASSING });
    expect(() => check({ root: tree.root, baselinePath: tree.path(BASELINE), ...tree.out })).toThrow(
      /e2e\/ does not exist/
    );
  });
});
