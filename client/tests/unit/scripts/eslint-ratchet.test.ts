import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { areaCounts, check, tally } from '../../../scripts/lib/eslint-warnings.mjs';
import { RatchetError } from '../../../scripts/lib/ratchet.mjs';
import { ratchetTree, type RatchetTree } from '../../helpers/ratchetFixture';

let tree: RatchetTree;
afterEach(() => tree?.remove());

const BASELINE = 'scripts/eslint-baseline.json';

interface Message {
  ruleId: string | null;
  severity: number;
  message?: string;
  fatal?: boolean;
  line?: number;
  column?: number;
}

const warn = (ruleId: string | null, message = 'm'): Message => ({ ruleId, severity: 1, message });

function result(root: string, key: string, messages: Message[], suppressed: Message[] = []) {
  return {
    filePath: join(root, key),
    messages: messages.map((m) => ({ message: 'm', ...m })),
    suppressedMessages: suppressed.map((m) => ({ message: 'm', ...m })),
  };
}

const empty = { src: {}, tests: {}, suppressed: {} };

async function run(baseline: object, results: (root: string) => ReturnType<typeof result>[], update = false) {
  tree = ratchetTree({ [BASELINE]: JSON.stringify(baseline) });
  return check({
    root: tree.root,
    baselinePath: tree.path(BASELINE),
    update,
    lint: async (root: string) => results(root),
    ...tree.out,
  });
}

describe('lint:warnings', () => {
  it('ESLINT-001: counts warnings per rule for app code, tests and suppressed messages', () => {
    const root = join('/r');
    const { counts, files, errors } = tally(
      [
        result(
          root,
          'src/a.tsx',
          [warn('no-empty'), warn('no-empty'), warn(null, 'Unused eslint-disable directive')],
          [warn('react-hooks/exhaustive-deps')]
        ),
        result(root, 'src/a.test.tsx', [warn('@typescript-eslint/no-explicit-any')]),
        result(root, 'tests/unit/b.ts', [warn('@typescript-eslint/no-explicit-any')]),
      ],
      root
    );
    expect(counts).toEqual({
      src: { 'no-empty': 2, 'unused-disable-directive': 1 },
      tests: { '@typescript-eslint/no-explicit-any': 2 },
      suppressed: { 'react-hooks/exhaustive-deps': 1 },
    });
    expect(files.src['no-empty']).toEqual({ 'src/a.tsx': 2 });
    expect(errors).toEqual([]);
  });

  it('ESLINT-002: passes when no count passes its entry', async () => {
    const code = await run({ ...empty, src: { 'no-empty': 2 } }, (root) => [
      result(root, 'src/a.ts', [warn('no-empty')]),
    ]);
    expect(code).toBe(0);
    expect(tree.log.join('\n')).toMatch(/fell below the baseline/);
  });

  it('ESLINT-003: fails a new warning and names the files behind it', async () => {
    const code = await run({ ...empty, src: { 'no-empty': 1 } }, (root) => [
      result(root, 'src/a.ts', [warn('no-empty')]),
      result(root, 'src/b.ts', [warn('no-empty')]),
    ]);
    expect(code).toBe(1);
    expect(tree.error.join('\n')).toMatch(
      /src: 2 no-empty warning\(s\), baseline 1\. Most in: src\/a\.ts \(1\), src\/b\.ts \(1\)/
    );
  });

  it('ESLINT-004: an eslint-disable comment does not get a warning past the ratchet', async () => {
    const code = await run(empty, (root) => [result(root, 'src/a.ts', [], [warn('react-hooks/exhaustive-deps')])]);
    expect(code).toBe(1);
    expect(tree.error.join('\n')).toMatch(/suppressed: 1 react-hooks\/exhaustive-deps warning/);
  });

  it('ESLINT-005: app code cannot spend the headroom the tests left', async () => {
    const code = await run({ ...empty, tests: { 'no-empty': 5 } }, (root) => [
      result(root, 'src/a.ts', [warn('no-empty')]),
    ]);
    expect(code).toBe(1);
  });

  it('ESLINT-006: any error fails, a parse failure included', async () => {
    const code = await run(empty, (root) => [
      result(root, 'src/a.ts', [
        { ruleId: null, severity: 2, fatal: true, message: 'Parsing error', line: 3, column: 1 },
      ]),
    ]);
    expect(code).toBe(1);
    expect(tree.error.join('\n')).toMatch(/src\/a\.ts:3:1 {2}Parsing error/);
  });

  it('ESLINT-007: --update lowers and drops counts and never raises one', async () => {
    await run(
      { src: { 'no-empty': 3, 'no-useless-escape': 1 }, tests: {}, suppressed: {} },
      (root) => [result(root, 'src/a.ts', [warn('no-empty'), warn('no-unused-vars')])],
      true
    );
    expect(JSON.parse(readFileSync(tree.path(BASELINE), 'utf8'))).toEqual({
      src: { 'no-empty': 1 },
      suppressed: {},
      tests: {},
    });
  });

  it('ESLINT-008: a baseline without all three areas, or with a stray one, stops the check', async () => {
    expect(areaCounts({ src: {}, tests: {} })).toMatch(/"suppressed" area is missing/);
    expect(areaCounts({ ...empty, other: {} })).toMatch(/"other" is not one of/);
    expect(areaCounts({ ...empty, src: { a: -1 } })).toMatch(/in "src"/);
    await expect(run({ src: {} }, () => [])).rejects.toThrow(RatchetError);
  });
});
