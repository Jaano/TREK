import { afterEach, describe, expect, it } from 'vitest';
import {
  countMap,
  fileList,
  listFiles,
  lowerCounts,
  lowerList,
  RatchetError,
  readBaseline,
  readText,
  writeBaseline,
} from '../../../scripts/lib/ratchet.mjs';
import { ratchetTree, type RatchetTree } from '../../helpers/ratchetFixture';

let tree: RatchetTree;
afterEach(() => tree?.remove());

describe('scripts/lib/ratchet', () => {
  it('RATCHET-001: lists the accepted files under each directory, sorted', () => {
    tree = ratchetTree({ 'src/b.ts': '', 'src/a/c.tsx': '', 'src/d.css': '', 'tests/e.ts': '' });
    const files = listFiles(tree.root, ['src', 'tests'], (key: string) => /\.tsx?$/.test(key));
    expect(
      files.map((f: string) =>
        f
          .slice(tree.root.length + 1)
          .split('\\')
          .join('/')
      )
    ).toEqual(['src/a/c.tsx', 'src/b.ts', 'tests/e.ts']);
  });

  it('RATCHET-002: a directory that is not there stops the scan instead of passing it', () => {
    tree = ratchetTree({ 'src/a.ts': '' });
    expect(() => listFiles(tree.root, ['src', 'tests'], () => true)).toThrow(RatchetError);
    expect(() => listFiles(tree.root, ['src', 'tests'], () => true)).toThrow(/tests\/ does not exist/);
  });

  it('RATCHET-003: a scan that finds no file at all fails', () => {
    tree = ratchetTree({ 'src/a.md': '' });
    expect(() => listFiles(tree.root, ['src'], (key: string) => key.endsWith('.ts'))).toThrow(/no file to check/);
  });

  it('RATCHET-004: reads CRLF and a byte order mark as the LF text git holds', () => {
    tree = ratchetTree({ 'a.ts': '\uFEFFone\r\ntwo\r\n' });
    expect(readText(tree.path('a.ts'))).toBe('one\ntwo\n');
  });

  it('RATCHET-005: a missing, broken or misshapen baseline is an error, never an empty one', () => {
    tree = ratchetTree({
      'broken.json': '{ "a": ',
      'array.json': '["a"]',
      'zero.json': '{ "a": 0 }',
      'twice.json': '["a", "a"]',
    });
    expect(() => readBaseline(tree.path('missing.json'), countMap)).toThrow(/cannot be read/);
    expect(() => readBaseline(tree.path('broken.json'), countMap)).toThrow(/not valid JSON/);
    expect(() => readBaseline(tree.path('array.json'), countMap)).toThrow(/wrong shape/);
    expect(() => readBaseline(tree.path('zero.json'), countMap)).toThrow(/positive whole number/);
    expect(() => readBaseline(tree.path('twice.json'), fileList)).toThrow(/listed twice/);
  });

  it('RATCHET-006: writes a baseline sorted, with a final newline, and reads it back', () => {
    tree = ratchetTree();
    writeBaseline(tree.path('b.json'), { 'src/z.ts': 2, 'src/a.ts': 1 });
    expect(readText(tree.path('b.json'))).toBe('{\n  "src/a.ts": 1,\n  "src/z.ts": 2\n}\n');
    expect(readBaseline(tree.path('b.json'), countMap)).toEqual({ 'src/a.ts': 1, 'src/z.ts': 2 });
  });

  it('RATCHET-007: lowering never raises an entry, never adds one and drops what fell to the floor', () => {
    const lowered = lowerCounts(
      { grew: 5, shrank: 5, gone: 5, floor: 5 },
      { grew: 9, shrank: 3, floor: 2, fresh: 7 },
      2
    );
    expect(lowered).toEqual({ grew: 5, shrank: 3 });
    expect(lowerCounts({ a: 9 }, { a: 4 }, (key: string) => (key === 'a' ? 4 : 0))).toEqual({});
  });

  it('RATCHET-008: a file list only loses the files that stopped offending', () => {
    expect(lowerList(['a', 'b', 'c'], ['c', 'a', 'new'])).toEqual(['a', 'c']);
  });
});
