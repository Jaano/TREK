/**
 * What the Postgres probe reports and when it passes (scripts/pg-probe/report.ts
 * and the entry point's argument and exit-code rules in scripts/pg-probe.ts).
 * The CI job's verdict is exactly `exitCode()`, so it is pinned here rather
 * than discovered in a red run.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exitCode, parseArgs, repositoryFiles } from '../../../../scripts/pg-probe';
import type { BaselineVerdict } from '../../../../scripts/pg-probe/baseline';
import type { HelperResult } from '../../../../scripts/pg-probe/helper-cases';
import { formatConsole, formatMarkdown, oneLine, passed, summarize, type MethodResult, type ReportInput } from '../../../../scripts/pg-probe/report';

const ok = (sql: string) => ({ sql, outcome: { ok: true as const } });
const refused = (sql: string, code = '42883', message = 'function datetime(unknown) does not exist') => ({
  sql,
  outcome: { ok: false as const, code, message },
});

const RESULTS: MethodResult[] = [
  { key: 'A.clean', statements: [ok('select 1'), ok('select 1'), ok('select 2')] },
  { key: 'B.broken', statements: [refused('select datetime(1)'), refused('select datetime(1)'), ok('select 3'), refused('insert or ignore', '42601', 'syntax error')] },
  { key: 'C.silent', statements: [] },
  { key: 'D.hung', statements: [ok('select 4')], timedOut: true },
  { key: 'E.skipped', statements: [], unprobeable: 'fn: a function parameter' },
];

const CLEAN: BaselineVerdict = { unseeded: false, grown: [], stale: [] };
const helper = (failure: string | null): HelperResult => ({ engine: 'postgres', name: 'dateOf', failure });

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return { summary: summarize(RESULTS), verdict: CLEAN, helpers: [helper(null)], schemaFailures: [], results: RESULTS, ...overrides };
}

describe('pg-probe report', () => {
  it('PGPROBE-060: counts methods and distinct statements, and what Postgres refused per method and SQLSTATE', () => {
    const summary = summarize(RESULTS);
    expect(summary).toMatchObject({ methods: 5, called: 4, unprobeable: 1, withoutSql: 1, timedOut: 1, statements: 6 });
    expect(summary.failingByMethod).toEqual(new Map([['A.clean', 0], ['B.broken', 2], ['C.silent', 0], ['D.hung', 0]]));
    expect(summary.failuresByCode).toEqual(new Map([['42883', 1], ['42601', 1]]));
    expect(summary.failedStatements.map((f) => `${f.method} ${f.code}`)).toEqual(['B.broken 42883', 'B.broken 42601']);
  });

  it('PGPROBE-061: passes only with every helper case green and the ratchet held', () => {
    expect(passed(input())).toBe(true);
    expect(passed(input({ helpers: [helper('expected 1, got 2')] }))).toBe(false);
    expect(passed(input({ verdict: { ...CLEAN, grown: [{ method: 'B.broken', allowed: 1, now: 2 }] } }))).toBe(false);
    expect(passed(input({ verdict: { ...CLEAN, stale: [{ method: 'B.broken', allowed: 3, now: 2 }] } }))).toBe(false);
    expect(passed(input({ verdict: { unseeded: true, grown: [], stale: [] } }))).toBe(true);
  });

  it('PGPROBE-062: --update forgives a stale entry but never a grown one or a failing helper', () => {
    const stale = input({ verdict: { ...CLEAN, stale: [{ method: 'B.broken', allowed: 3, now: 2 }] } });
    expect(exitCode(stale, false)).toBe(1);
    expect(exitCode(stale, true)).toBe(0);
    expect(exitCode(input({ verdict: { ...CLEAN, grown: [{ method: 'B.broken', allowed: 1, now: 2 }] } }), true)).toBe(1);
    expect(exitCode(input({ helpers: [helper('threw: boom')] }), true)).toBe(1);
    expect(exitCode(input(), false)).toBe(0);
  });

  it('PGPROBE-063: the console log names every refused statement and every ratchet failure', () => {
    const text = formatConsole(
      input({
        helpers: [helper('expected 1, got 2')],
        verdict: { unseeded: false, grown: [{ method: 'B.broken', allowed: 1, now: 2 }], stale: [{ method: 'Z.gone', allowed: 1, now: 0 }] },
        schemaFailures: [{ statement: 'create table "x" (a text collate "NOCASE")', message: 'collation "NOCASE" does not exist' }],
      }),
    );
    expect(text).toContain('FAIL  [postgres] dateOf: expected 1, got 2');
    expect(text).toContain('collation "NOCASE" does not exist');
    expect(text).toContain('Statements: 6 distinct, 2 refused by Postgres.');
    expect(text).toContain('B.broken  42883  function datetime(unknown) does not exist');
    expect(text).toContain('FAIL  B.broken sends 2 statement(s) Postgres refuses, 1 allowed.');
    expect(text).toContain('FAIL  Z.gone is held at 1 failing statement(s) but fails 0 now; lower the baseline.');
    expect(text.trim().endsWith('Postgres probe failed.')).toBe(true);
    expect(formatConsole(input({ verdict: { unseeded: true, grown: [], stale: [] } }))).toContain('Baseline: not measured yet');
  });

  it('PGPROBE-064: the step summary is a Markdown table with escaped cells', () => {
    const md = formatMarkdown(input({ helpers: [{ engine: 'postgres', name: 'a|b', failure: 'got `x`' }] }));
    expect(md).toContain('## Postgres probe');
    expect(md).toContain('Result: **failed**');
    expect(md).toContain('| postgres | a\\|b | got \'x\' |');
    expect(md).toContain('| 42883 | 1 |');
    expect(md).toContain('| E.skipped | fn: a function parameter |');
    expect(formatMarkdown(input({ verdict: { unseeded: true, grown: [], stale: [] } }))).toContain('has not been measured yet');
  });

  it('PGPROBE-065: flattens and cuts SQL for a log line', () => {
    expect(oneLine('select\n  1,\n  2')).toBe('select 1, 2');
    expect(oneLine('x'.repeat(10), 5)).toBe('xxxx…');
  });
});

describe('pg-probe entry point', () => {
  it('PGPROBE-070: takes the URL from the environment or --url and refuses to run without one', () => {
    expect(parseArgs([], { TREK_PG_PROBE_URL: 'postgres://u:p@h:5432/d' })).toEqual({
      url: 'postgres://u:p@h:5432/d',
      update: false,
      nextBaseline: null,
      report: null,
      summary: null,
    });
    const args = parseArgs(['--url=postgresql://h/d', '--update', '--next-baseline=n.json', '--report=r.json', '--summary=s.md'], {});
    expect(args).toEqual({ url: 'postgresql://h/d', update: true, nextBaseline: 'n.json', report: 'r.json', summary: 's.md' });
    expect(parseArgs([], { TREK_PG_PROBE_URL: 'postgres://h/d', GITHUB_STEP_SUMMARY: '/tmp/summary' }).summary).toBe('/tmp/summary');
    expect(() => parseArgs([], {})).toThrow(/no Postgres URL/);
    expect(() => parseArgs(['--url=mysql://h/d'], {})).toThrow(/no Postgres URL/);
    expect(() => parseArgs(['--verbose'], { TREK_PG_PROBE_URL: 'postgres://h/d' })).toThrow(/unknown argument --verbose/);
    expect(() => parseArgs(['--update=yes'], { TREK_PG_PROBE_URL: 'postgres://h/d' })).toThrow(/unknown argument/);
  });

  it('PGPROBE-071: probes every repository file and none of the shared helpers', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'trek-pg-probe-files-'));
    try {
      mkdirSync(path.join(dir, '_shared'));
      for (const name of ['B.repository.ts', 'A.repository.ts', 'types.d.ts', 'notes.md', '_shared/base.ts']) {
        writeFileSync(path.join(dir, name), '');
      }
      expect(repositoryFiles(dir).map((file) => path.basename(file))).toEqual(['A.repository.ts', 'B.repository.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
