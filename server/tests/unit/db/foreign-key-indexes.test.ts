import type Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { createSnapshotTestDb } from '../../helpers/db-mock';

/**
 * Migration20200101042200 added 86 indexes by hand so that deleting a trip or a
 * user stops scanning every child table while it holds the one connection. A
 * hand-written list is a one-off, though: the next table with a trip_id or a
 * user_id foreign key would bring the full scans back without a signal, and
 * gen:entities regenerates entities without an @Index just as happily.
 *
 * This runs against the database the migrations build (the same snapshot every
 * test opens) and requires that the columns of every foreign key lead some
 * index or the primary key, in order, so SQLite can find the child rows of a
 * parent by seeking instead of scanning. A foreign key that deliberately goes
 * without one is listed in UNINDEXED_ALLOWED with the reason.
 */

/** `table.column` (comma-joined for a composite key) that may stay unindexed, each with its reason. */
const UNINDEXED_ALLOWED: Record<string, string> = {};

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
}

interface IndexListRow {
  name: string;
}

interface IndexInfoRow {
  seqno: number;
  name: string | null;
}

interface TableInfoRow {
  name: string;
  pk: number;
}

const testDb = createSnapshotTestDb();

afterAll(() => {
  testDb.close();
});

function tables(db: Database.Database): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
    name: string;
  }[];
  return rows.map((r) => r.name).sort();
}

/** Each foreign key of a table as its ordered child columns. */
function foreignKeys(db: Database.Database, table: string): string[][] {
  const rows = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as ForeignKeyRow[];
  const byId = new Map<number, ForeignKeyRow[]>();
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  return [...byId.values()].map((group) => group.sort((a, b) => a.seq - b.seq).map((r) => r.from));
}

/** Every index of a table, and its primary key, as ordered column lists. */
function indexedPrefixes(db: Database.Database, table: string): string[][] {
  const lists: string[][] = [];
  for (const { name } of db.prepare(`PRAGMA index_list("${table}")`).all() as IndexListRow[]) {
    const cols = (db.prepare(`PRAGMA index_info("${name}")`).all() as IndexInfoRow[])
      .sort((a, b) => a.seqno - b.seqno)
      // An expression column has no name and ends the usable prefix.
      .map((c) => c.name);
    const usable: string[] = [];
    for (const c of cols) {
      if (c === null) break;
      usable.push(c);
    }
    lists.push(usable);
  }
  const pk = (db.prepare(`PRAGMA table_info("${table}")`).all() as TableInfoRow[])
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  if (pk.length) lists.push(pk);
  return lists;
}

/** True when the foreign key's columns, in any order, are the leading columns of one index. */
function isLedByIndex(fk: string[], indexes: string[][]): boolean {
  const want = [...fk].sort().join(',');
  return indexes.some((cols) => cols.length >= fk.length && [...cols.slice(0, fk.length)].sort().join(',') === want);
}

function unindexed(db: Database.Database): string[] {
  const missing: string[] = [];
  for (const table of tables(db)) {
    const indexes = indexedPrefixes(db, table);
    for (const fk of foreignKeys(db, table)) {
      if (!isLedByIndex(fk, indexes)) missing.push(`${table}.${fk.join(',')}`);
    }
  }
  return missing;
}

describe('foreign key indexes', () => {
  it('FKIDX-001: every foreign key in the migrated schema leads an index or the primary key', () => {
    const missing = unindexed(testDb).filter((key) => !(key in UNINDEXED_ALLOWED));
    expect(missing, 'add a CREATE INDEX for each in a new migration, and an @Index on the entity').toEqual([]);
  });

  it('FKIDX-002: UNINDEXED_ALLOWED holds only keys that exist and are still unindexed', () => {
    const now = new Set(unindexed(testDb));
    expect(Object.keys(UNINDEXED_ALLOWED).filter((key) => !now.has(key))).toEqual([]);
  });

  it('FKIDX-003: the check fails on an unindexed foreign key and passes once it is indexed', () => {
    const Sqlite = testDb.constructor as unknown as new (path: string) => Database.Database;
    const db = new Sqlite(':memory:');
    try {
      db.exec(`
        CREATE TABLE parent (id INTEGER PRIMARY KEY, a INTEGER, b INTEGER, UNIQUE (a, b));
        CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id), note TEXT);
        CREATE TABLE pair (x INTEGER, y INTEGER, z INTEGER, FOREIGN KEY (x, y) REFERENCES parent(a, b));
        CREATE TABLE owned (parent_id INTEGER REFERENCES parent(id), slot INTEGER, PRIMARY KEY (parent_id, slot));
      `);
      // owned is covered by its primary key; child and pair are not.
      expect(unindexed(db)).toEqual(['child.parent_id', 'pair.x,y']);

      // An index that holds the column second does not help a lookup by it.
      db.exec('CREATE INDEX idx_child_note_parent ON child(note, parent_id)');
      expect(unindexed(db)).toContain('child.parent_id');

      db.exec('CREATE INDEX idx_child_parent ON child(parent_id)');
      db.exec('CREATE INDEX idx_pair_yx ON pair(y, x, z)');
      expect(unindexed(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
