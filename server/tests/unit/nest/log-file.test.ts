/**
 * BufferedLogFile (nest/audit/log-file.ts), the file half of the server log,
 * against a real temporary directory: LOGFILE-001 through LOGFILE-009.
 *
 * What it promises: a write never touches the disk on the caller's turn,
 * queued lines reach the file in order through one append per batch, the file
 * rotates the way trek.log always did (`.1` newest, `maxFiles` in total), a
 * rotation another process already did is not repeated, and a failing disk is
 * reported instead of thrown.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BufferedLogFile } from '../../../src/nest/audit/log-file';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trek-logfile-'));
  dirs.push(dir);
  return dir;
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('BufferedLogFile', () => {
  it('LOGFILE-001: a write returns before anything reaches the disk', () => {
    const dir = path.join(tmpDir(), 'logs');
    const sink = new BufferedLogFile({ dir, onError: vi.fn() });
    sink.write('first');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('LOGFILE-002: flush creates the directory and appends every queued line in order', async () => {
    const dir = path.join(tmpDir(), 'logs');
    const sink = new BufferedLogFile({ dir, onError: vi.fn() });
    sink.write('one');
    sink.write('two');
    await sink.flush();
    sink.write('three');
    await sink.flush();
    expect(read(path.join(dir, 'trek.log'))).toBe('one\ntwo\nthree\n');
  });

  it('LOGFILE-003: one batch is one append, however many lines it holds', async () => {
    const dir = tmpDir();
    const append = vi.spyOn(fs.promises, 'appendFile');
    const sink = new BufferedLogFile({ dir, onError: vi.fn() });
    for (let i = 0; i < 100; i++) sink.write(`line ${i}`);
    await sink.flush();
    expect(append).toHaveBeenCalledTimes(1);
    expect(read(sink.path).split('\n')).toHaveLength(101);
  });

  it('LOGFILE-004: the queued lines flush by themselves after the batching delay', async () => {
    const dir = tmpDir();
    const sink = new BufferedLogFile({ dir, flushDelayMs: 5, onError: vi.fn() });
    sink.write('later');
    await vi.waitFor(() => expect(fs.existsSync(sink.path) && read(sink.path)).toBe('later\n'));
  });

  it('LOGFILE-005: a file at the cap rotates to .1 and older files shift, the oldest falling off', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'trek.log');
    fs.writeFileSync(file, 'x'.repeat(100));
    fs.writeFileSync(`${file}.1`, 'one');
    fs.writeFileSync(`${file}.2`, 'two');
    const sink = new BufferedLogFile({ dir, maxBytes: 100, maxFiles: 3, onError: vi.fn() });
    sink.write('fresh');
    await sink.flush();
    expect(read(file)).toBe('fresh\n');
    expect(read(`${file}.1`)).toBe('x'.repeat(100));
    expect(read(`${file}.2`)).toBe('one');
    expect(fs.existsSync(`${file}.3`)).toBe(false);
  });

  it('LOGFILE-006: below the cap nothing rotates, and the size it tracks triggers the next rotation', async () => {
    const dir = tmpDir();
    const sink = new BufferedLogFile({ dir, maxBytes: 10, onError: vi.fn() });
    sink.write('12345');
    await sink.flush();
    expect(fs.existsSync(`${sink.path}.1`)).toBe(false);
    sink.write('67890');
    await sink.flush();
    // 12 bytes on disk now, past the cap of 10: the next batch rotates first.
    sink.write('next');
    await sink.flush();
    expect(read(`${sink.path}.1`)).toBe('12345\n67890\n');
    expect(read(sink.path)).toBe('next\n');
  });

  it('LOGFILE-007: a rotation another process already did is not repeated', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'trek.log');
    const sink = new BufferedLogFile({ dir, maxBytes: 10, onError: vi.fn() });
    sink.write('0123456789');
    await sink.flush();
    // The other process rotates and starts a fresh file.
    fs.renameSync(file, `${file}.1`);
    fs.writeFileSync(file, 'theirs\n');
    sink.write('mine');
    await sink.flush();
    expect(read(file)).toBe('theirs\nmine\n');
    expect(read(`${file}.1`)).toBe('0123456789\n');
    expect(fs.existsSync(`${file}.2`)).toBe(false);
  });

  it('LOGFILE-008: a failing append is reported, never thrown, and the next batch tries again', async () => {
    const dir = tmpDir();
    const onError = vi.fn();
    const sink = new BufferedLogFile({ dir, onError });
    vi.spyOn(fs.promises, 'appendFile').mockRejectedValueOnce(new Error('disk full'));
    sink.write('lost');
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith('log file write failed: disk full');
    sink.write('kept');
    await sink.flush();
    expect(read(sink.path)).toBe('kept\n');
  });

  it('LOGFILE-009: flushSync writes what is queued at once, for the exit handler', () => {
    const dir = path.join(tmpDir(), 'logs');
    const sink = new BufferedLogFile({ dir, onError: vi.fn() });
    sink.write('last words');
    sink.flushSync();
    expect(read(sink.path)).toBe('last words\n');
    sink.flushSync();
    expect(read(sink.path)).toBe('last words\n');
  });

  it('LOGFILE-010: past the memory ceiling lines are dropped and the count is logged once there is room', async () => {
    const dir = tmpDir();
    const sink = new BufferedLogFile({ dir, maxBufferedBytes: 12, onError: vi.fn() });
    sink.write('aaaaa'); // 6 bytes queued
    sink.write('bbbbb'); // 12 bytes queued, at the ceiling
    sink.write('ccccc'); // dropped
    await sink.flush();
    sink.write('d');
    await sink.flush();
    const lines = read(sink.path).trim().split('\n');
    expect(lines[0]).toBe('aaaaa');
    expect(lines[1]).toBe('bbbbb');
    expect(lines).not.toContain('ccccc');
    expect(lines.some((line) => line.includes('1 log line(s) dropped'))).toBe(true);
    expect(lines.at(-1)).toBe('d');
  });
});
