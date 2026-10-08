/**
 * scripts/size-lint.mjs is the CI gate that keeps a server source file from
 * growing past 1000 lines (or past its baseline entry). A gate nobody tests
 * passes forever once it breaks, so this runs the real script as a child
 * process against throwaway server roots (--dir) and proves both that it
 * fails on a violation and that it refuses to run on a broken setup instead
 * of passing silently.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '../../../scripts/size-lint.mjs');

interface ExecError {
  status: number | null;
  stdout: string;
  stderr: string;
}

const roots: string[] = [];

function serverRoot(files: Record<string, string>, baseline: unknown = {}): string {
  // null writes no baseline file at all.
  const dir = mkdtempSync(path.join(tmpdir(), 'trek-size-lint-'));
  roots.push(dir);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  if (baseline !== null) {
    writeFileSync(
      path.join(dir, 'scripts/size-baseline.json'),
      typeof baseline === 'string' ? baseline : JSON.stringify(baseline),
    );
  }
  return dir;
}

function run(dir: string, ...args: string[]): { status: number | null; out: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, `--dir=${dir}`, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out: stdout };
  } catch (err) {
    const { status, stdout, stderr } = err as ExecError;
    return { status, out: `${stdout}${stderr}` };
  }
}

const lines = (n: number, width = 10) => `${'x'.repeat(width)}\n`.repeat(n);

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('size-lint.mjs', () => {
  it('SIZE-001: passes when every file is at or under the limit', () => {
    const dir = serverRoot({ 'src/a.ts': lines(1000), 'scripts/b.mjs': lines(10) });
    const { status, out } = run(dir);
    expect(status).toBe(0);
    expect(out).toContain('size: 2 file(s), 0 over 1000 lines');
  });

  it('SIZE-002: fails on a new file past the limit', () => {
    const dir = serverRoot({ 'src/nest/big/big.service.ts': lines(1001) });
    const { status, out } = run(dir);
    expect(status).toBe(1);
    expect(out).toContain('FAIL  src/nest/big/big.service.ts: 1001 lines, the limit is 1000.');
  });

  it('SIZE-003: fails when a baselined file grows past its entry, passes at or under it', () => {
    expect(run(serverRoot({ 'src/a.ts': lines(1201) }, { 'src/a.ts': 1200 })).status).toBe(1);
    expect(run(serverRoot({ 'src/a.ts': lines(1200) }, { 'src/a.ts': 1200 })).status).toBe(0);
    expect(run(serverRoot({ 'src/a.ts': lines(1100) }, { 'src/a.ts': 1200 })).out).toContain('run with --update');
  });

  it('SIZE-004: counts a long line once per 120 columns, so joining lines buys nothing', () => {
    // 400 lines of 300 columns read like 1200 lines.
    const { status, out } = run(serverRoot({ 'src/dense.ts': lines(400, 300) }));
    expect(status).toBe(1);
    expect(out).toContain('src/dense.ts: 1200 lines');
    // Exactly 120 columns is still one line.
    expect(run(serverRoot({ 'src/edge.ts': lines(1000, 120) })).status).toBe(0);
  });

  it('SIZE-005: a CRLF checkout counts the same as an LF one', () => {
    const crlf = lines(1001).replace(/\n/g, '\r\n');
    const { out } = run(serverRoot({ 'src/a.ts': crlf }));
    expect(out).toContain('src/a.ts: 1001 lines');
  });

  it('SIZE-006: skips tests and non-source files, walks scripts/ as well as src/', () => {
    const dir = serverRoot({
      'src/a.test.ts': lines(2000),
      'src/notes.md': lines(2000),
      'scripts/tool.mjs': lines(1001),
    });
    const { status, out } = run(dir);
    expect(status).toBe(1);
    expect(out).toContain('scripts/tool.mjs');
    expect(out).not.toContain('a.test.ts');
  });

  it('SIZE-007: fails closed on a missing, unparsable or malformed baseline', () => {
    const missing = serverRoot({ 'src/a.ts': lines(1) }, null);
    expect(run(missing).status).toBe(1);
    expect(run(missing).out).toContain('size-baseline.json cannot be read');

    expect(run(serverRoot({ 'src/a.ts': lines(1) }, '{ not json')).status).toBe(1);
    expect(run(serverRoot({ 'src/a.ts': lines(1) }, '[]')).status).toBe(1);
    // An entry at or under the limit, or not a whole number, is a hand edit gone wrong.
    expect(run(serverRoot({ 'src/a.ts': lines(1) }, { 'src/a.ts': 900 })).status).toBe(1);
    expect(run(serverRoot({ 'src/a.ts': lines(1) }, { 'src/a.ts': '1200' })).status).toBe(1);
  });

  it('SIZE-008: fails closed when a scanned root is missing', () => {
    const dir = serverRoot({ 'src/a.ts': lines(1) });
    rmSync(path.join(dir, 'src'), { recursive: true });
    const { status, out } = run(dir);
    expect(status).toBe(1);
    expect(out).toContain('src/ does not exist');
  });

  it('SIZE-009: --update only lowers, drops files back under the limit, and never adds one', () => {
    const dir = serverRoot(
      {
        'src/shrunk.ts': lines(1100),
        'src/fixed.ts': lines(50),
        'src/grown.ts': lines(1500),
        'src/new.ts': lines(1300),
      },
      { 'src/shrunk.ts': 1200, 'src/fixed.ts': 1300, 'src/grown.ts': 1400, 'src/gone.ts': 1100 },
    );
    const { status } = run(dir, '--update');
    const baseline: unknown = JSON.parse(readFileSync(path.join(dir, 'scripts/size-baseline.json'), 'utf8'));
    expect(baseline).toEqual({ 'src/grown.ts': 1400, 'src/shrunk.ts': 1100 });
    // The grown file and the new one still fail after the update.
    expect(status).toBe(1);
  });
});
