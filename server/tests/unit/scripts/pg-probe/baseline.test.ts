/**
 * The Postgres probe's ratchet (scripts/pg-probe/baseline.ts). The probe
 * itself only runs in CI against a Postgres service, so the rules that decide
 * whether that job passes are pinned here: a method may not fail more
 * statements than its entry, a stale entry fails until it is lowered, an
 * unmeasured baseline has nothing to compare (the run fails on it, see
 * report.test.ts), and --update never raises or adds.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareWithBaseline, formatBaseline, lowerBaseline, parseBaseline } from '../../../../scripts/pg-probe/baseline';

const now = (entries: Record<string, number>): Map<string, number> => new Map(Object.entries(entries));

describe('pg-probe baseline', () => {
  it('PGPROBE-001: parses a measured and an unmeasured baseline', () => {
    expect(parseBaseline('{"failing": null}', 'b.json')).toEqual({ failing: null });
    expect(parseBaseline('{"failing": {"TagsRepository.listByUser": 2}}', 'b.json')).toEqual({ failing: { 'TagsRepository.listByUser': 2 } });
  });

  it('PGPROBE-002: refuses a malformed baseline instead of reading it as empty', () => {
    expect(() => parseBaseline('nope', 'b.json')).toThrow(/b.json is not valid JSON/);
    expect(() => parseBaseline('{}', 'b.json')).toThrow(/"failing" key/);
    expect(() => parseBaseline('[]', 'b.json')).toThrow(/"failing" key/);
    expect(() => parseBaseline('{"failing": []}', 'b.json')).toThrow(/null or an object/);
    expect(() => parseBaseline('{"failing": {"listByUser": 1}}', 'b.json')).toThrow(/not a Class.method key/);
    expect(() => parseBaseline('{"failing": {"A.b": 0}}', 'b.json')).toThrow(/expected a positive integer/);
    expect(() => parseBaseline('{"failing": {"A.b": 1.5}}', 'b.json')).toThrow(/expected a positive integer/);
  });

  it('PGPROBE-003: an unmeasured baseline is flagged instead of compared', () => {
    expect(compareWithBaseline({ failing: null }, now({ 'A.b': 3 }))).toEqual({ unseeded: true, grown: [], stale: [] });
  });

  it('PGPROBE-004: a method failing more statements than its entry (or any without one) fails', () => {
    const verdict = compareWithBaseline({ failing: { 'A.b': 1 } }, now({ 'A.b': 2, 'C.d': 1, 'E.f': 0 }));
    expect(verdict.grown).toEqual([
      { method: 'A.b', allowed: 1, now: 2 },
      { method: 'C.d', allowed: 0, now: 1 },
    ]);
    expect(verdict.stale).toEqual([]);
  });

  it('PGPROBE-005: an entry above what its method fails now is stale, also when the method is gone', () => {
    const verdict = compareWithBaseline({ failing: { 'A.b': 2, 'Gone.away': 1 } }, now({ 'A.b': 1 }));
    expect(verdict.grown).toEqual([]);
    expect(verdict.stale).toEqual([
      { method: 'A.b', allowed: 2, now: 1 },
      { method: 'Gone.away', allowed: 1, now: 0 },
    ]);
  });

  it('PGPROBE-006: --update lowers and drops entries but never raises or adds one', () => {
    const lowered = lowerBaseline({ failing: { 'A.b': 2, 'C.d': 1, 'Gone.away': 1 } }, now({ 'A.b': 1, 'C.d': 5, 'New.one': 3 }));
    expect(lowered).toEqual({ failing: { 'A.b': 1, 'C.d': 1 } });
  });

  it('PGPROBE-007: the first --update seeds an unmeasured baseline with what fails, sorted', () => {
    expect(lowerBaseline({ failing: null }, now({ 'Z.z': 1, 'A.a': 2, 'M.m': 0 }))).toEqual({ failing: { 'A.a': 2, 'Z.z': 1 } });
  });

  it('PGPROBE-008: the checked-in baseline parses and formats back to itself', () => {
    const file = path.join(__dirname, '../../../../scripts/pg-probe-baseline.json');
    const text = readFileSync(file, 'utf8');
    expect(formatBaseline(parseBaseline(text, file))).toBe(text.replace(/\r\n/g, '\n'));
  });
});
