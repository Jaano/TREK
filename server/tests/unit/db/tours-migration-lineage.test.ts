import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { createMigrationPrefixDatabase } from '../../helpers/migration-prefix-db';

vi.mock('../../../src/config', () => ({
  ENCRYPTION_KEY: 'r3-test-only-key',
  JWT_SECRET: 'r3-test-only-secret',
  updateJwtSecret: vi.fn(),
}));
vi.mock('../../../src/db/database', () => {
  throw new Error('Tours migration lineage tests must not import the global database');
});

const repositoryRoot = resolve(__dirname, '../../../..');
const databases: Database.Database[] = [];
const disposableDirectories: string[] = [];

function migrationPrefixDatabase(version: number): Database.Database {
  const db = createMigrationPrefixDatabase(version);
  databases.push(db);
  expect(cursor(db)).toBe(version);
  return db;
}

function addToursSchemaStage(db: Database.Database, stage: number): void {
  db.exec(`
    CREATE TABLE tour_types (
      key TEXT PRIMARY KEY, label_key TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
      routing_profile TEXT, is_sport INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  if (stage >= 2) {
    db.exec(`
      CREATE TABLE tours (
        place_id INTEGER PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
        tour_type TEXT NOT NULL REFERENCES tour_types(key), distance REAL, elevation_gain REAL,
        elevation_loss REAL, duration REAL, difficulty TEXT, wanderer_ref TEXT, match_confidence REAL,
        tour_group_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('CREATE INDEX idx_tours_tour_type ON tours(tour_type)');
  }
  if (stage >= 3) {
    db.exec(`
      CREATE TABLE tour_waypoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        place_id INTEGER NOT NULL REFERENCES tours(place_id) ON DELETE CASCADE,
        lat REAL NOT NULL CHECK(lat >= -90 AND lat <= 90),
        lng REAL NOT NULL CHECK(lng >= -180 AND lng <= 180),
        role TEXT NOT NULL CHECK(role IN ('start', 'via', 'end')),
        sequence INTEGER NOT NULL CHECK(sequence >= 0), UNIQUE(place_id, sequence)
      )
    `);
    db.exec('CREATE INDEX idx_tour_waypoints_place ON tour_waypoints(place_id, sequence)');
  }
  if (stage >= 4) {
    db.exec('ALTER TABLE tours ADD COLUMN max_hiking_difficulty INTEGER NOT NULL DEFAULT 2 CHECK(max_hiking_difficulty BETWEEN 1 AND 6)');
  }
}

function createUpstream242Fixture(): Database.Database {
  return migrationPrefixDatabase(242);
}

function createUpstream258Fixture(): Database.Database {
  return migrationPrefixDatabase(258);
}

function createLegacyToursFixture(version: number): Database.Database {
  if (version < 216 || version > 218) throw new Error(`Unsupported legacy Tours fixture version: ${version}`);
  const db = migrationPrefixDatabase(215);
  addToursSchemaStage(db, version - 215);
  db.prepare('UPDATE schema_version SET version = ?').run(version);
  return db;
}

function createLegacyTours218Fixture(): Database.Database {
  return createLegacyToursFixture(218);
}

function createFrozenToursFixture(version: number): Database.Database {
  if (version < 243 || version > 246) throw new Error(`Unsupported frozen Tours fixture version: ${version}`);
  const db = createUpstream242Fixture();
  addToursSchemaStage(db, version - 242);
  db.prepare('UPDATE schema_version SET version = ?').run(version);
  return db;
}

function createFrozenTours246Fixture(): Database.Database {
  return createFrozenToursFixture(246);
}

function createAmbiguousToursFixture(mutation: string, lineage: 'legacy' | 'frozen' = 'frozen'): Database.Database {
  const db = lineage === 'legacy' ? createLegacyTours218Fixture() : createFrozenTours246Fixture();
  seedTour(db);
  db.exec(mutation);
  return db;
}

function emptyDb(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys = ON');
  createTables(db);
  return db;
}

function cursor(db: Database.Database): number {
  return (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version;
}

function snapshot(db: Database.Database): Record<string, unknown[]> {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map(row => row.name));
  return Object.fromEntries(['places', 'tours', 'tour_waypoints', 'day_assignments'].filter(table => tables.has(table)).map(table => [
    table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ]));
}

function schemaSnapshot(db: Database.Database): unknown[] {
  return db.prepare(`
    SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
  `).all();
}

function expectRowsPreserved(actual: unknown[], before: unknown[]): void {
  expect(actual).toHaveLength(before.length);
  for (const [index, previous] of before.entries()) {
    const values = previous as Record<string, unknown>;
    const row = actual[index] as Record<string, unknown>;
    expect(Object.fromEntries(Object.keys(values).map(key => [key, row[key]]))).toEqual(values);
  }
}

function seedTour(db: Database.Database): void {
  db.exec(`
    INSERT INTO users (id, username, email, password_hash) VALUES (71, 'lineage-test', 'lineage@example.invalid', 'not-a-password');
    INSERT INTO trips (id, user_id, title) VALUES (81, 71, 'Synthetic Tours');
    INSERT INTO days (id, trip_id, day_number) VALUES (91, 81, 1);
    INSERT INTO places (id, trip_id, name, route_geometry) VALUES
      (101, 81, 'Historical tour', '[[48,11,600],[48.01,11.02,650],[48.02,11.04,630]]');
    INSERT INTO tour_types (key, label_key, icon, color) VALUES ('hike', 'tours.types.hike', 'Mountain', '#008800');
    INSERT INTO tours (place_id, tour_type, difficulty) VALUES (101, 'hike', 'T3');
    INSERT INTO tour_waypoints (id, place_id, lat, lng, role, sequence) VALUES
      (201, 101, 48, 11, 'start', 0), (203, 101, 48.01, 11.02, 'via', 1),
      (207, 101, 48.02, 11.04, 'end', 2);
    INSERT INTO day_assignments (id, day_id, place_id, order_index) VALUES (301, 91, 101, 0);
  `);
}

function expectFinalSchema(db: Database.Database): void {
  expect(cursor(db)).toBe(262);
  expect(db.pragma('foreign_key_check')).toEqual([]);
  const markers: Record<string, string[]> = {
    users: ['immich_allow_insecure_tls'], day_assignments: ['route_excluded'],
    packing_items: ['packed_quantity'], bucket_list: ['region_code'], vacay_company_holidays: ['fraction'],
    journey_entries: ['is_draft'], share_tokens: ['share_travel_only', 'share_hide_images'],
    budget_settlements: ['note'], packing_template_items: ['weight_grams', 'quantity', 'bag_name'],
    journeys: ['status_override', 'photo_location'], places: ['email', 'opening_hours'],
    tours: ['max_hiking_difficulty'],
  };
  for (const [table, columns] of Object.entries(markers)) {
    const actual = (db.pragma(`table_info(${table})`) as { name: string }[]).map(column => column.name);
    expect(actual).toEqual(expect.arrayContaining(columns));
  }
  for (const name of ['tour_types', 'tours', 'tour_waypoints', 'push_subscriptions', 'google_api_usage',
    'trg_place_regions_follow_place', 'idx_push_subscriptions_user', 'idx_tours_tour_type', 'idx_tour_waypoints_place']) {
    expect(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(name)).toBeDefined();
  }
  runMigrations(db);
  expect(cursor(db)).toBe(262);
  expect(db.pragma('foreign_key_check')).toEqual([]);
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`Migration exit ${code}`); });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of disposableDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Tours migration sequence', () => {
  it('replays the current upstream 258 prefix with the current Tours tail', () => {
    const db = createUpstream258Fixture();
    expect(cursor(db)).toBe(258);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'tours'").get()).toBeUndefined();
    runMigrations(db);
    expectFinalSchema(db);
  });
});

describe('Tours migration lineage matrix', () => {
  it('migrates a fresh disposable database from zero and safely reruns', () => {
    const db = emptyDb();
    runMigrations(db);
    expectFinalSchema(db);
  });

  it('accepts the exact public upstream schema at historical version 218', () => {
    const db = migrationPrefixDatabase(218);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'tours'").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'roadtrip_day_boundaries'").get()).toBeDefined();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'school_holiday_periods'").get()).toBeDefined();
    expect(db.pragma('table_info(day_assignments)')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'end_day' }),
    ]));

    runMigrations(db);
    expectFinalSchema(db);
  });

  it.each([242, 243, 244, 245, 246, 258])('migrates pure upstream %i without a rewind', (version) => {
    const db = migrationPrefixDatabase(version);
    const writes: number[] = [];
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      const statement = prepare(sql);
      if (sql.includes('UPDATE schema_version SET version')) {
        const run = statement.run.bind(statement);
        statement.run = ((value: number) => { writes.push(value); return run(value); }) as typeof statement.run;
      }
      return statement;
    }) as typeof db.prepare);
    runMigrations(db);
    expect(writes.every(value => value > version)).toBe(true);
    expectFinalSchema(db);
  });

  it('accepts upstream Web Push at historical slot 244 and restores the Atlas trigger at 246', () => {
    const db = migrationPrefixDatabase(245);
    db.exec('DROP TRIGGER trg_place_regions_follow_place; UPDATE schema_version SET version = 244');
    runMigrations(db);
    expectFinalSchema(db);
  });

  it('rejects an upstream cursor carrying impossible later schema markers without rewriting it', () => {
    const db = migrationPrefixDatabase(243);
    db.exec('ALTER TABLE day_assignments ADD COLUMN route_excluded INTEGER NOT NULL DEFAULT 0');
    const beforeSchema = schemaSnapshot(db);
    const beforeRows = snapshot(db);
    expect(() => runMigrations(db)).toThrow(/Unsafe Tours migration lineage/);
    expect(cursor(db)).toBe(243);
    expect(schemaSnapshot(db)).toEqual(beforeSchema);
    expect(snapshot(db)).toEqual(beforeRows);
  });

  it.each([216, 217, 218])('recognizes the exact legacy Tours %i schema', (version) => {
    const db = createLegacyToursFixture(version);
    const before = version === 218 ? (seedTour(db), snapshot(db)) : undefined;
    runMigrations(db);
    expectFinalSchema(db);
    if (before) {
      const after = snapshot(db);
      for (const table of ['places', 'tour_waypoints']) expectRowsPreserved(after[table], before[table]);
      expect(after.tours).toEqual(before.tours.map(row => ({ ...row as object, max_hiking_difficulty: 2 })));
      expect((after.tours[0] as { place_id: number; tour_type: string }).place_id).toBe(101);
      expect((after.tours[0] as { tour_type: string }).tour_type).toBe('hike');
      expect(after.tour_waypoints.map(row => (row as { id: number }).id)).toEqual([201, 203, 207]);
      expect(after.day_assignments).toEqual(before.day_assignments.map(row => ({
        ...row as object, end_day: 0, route_excluded: 0, accommodation_id: null,
      })));
    }
  });

  it.each([243, 244, 245, 246])('recognizes the exact frozen Tours %i schema', (version) => {
    const db = createFrozenToursFixture(version);
    if (version === 246) {
      seedTour(db);
      db.prepare('UPDATE tours SET max_hiking_difficulty = 5').run();
    }
    const before = version === 246 ? snapshot(db) : undefined;
    runMigrations(db);
    expectFinalSchema(db);
    if (before) {
      const after = snapshot(db);
      for (const table of ['places', 'tours', 'tour_waypoints']) expectRowsPreserved(after[table], before[table]);
      expect((after.tours[0] as { place_id: number; tour_type: string }).place_id).toBe(101);
      expect((after.tours[0] as { tour_type: string }).tour_type).toBe('hike');
      expect((after.tours[0] as { max_hiking_difficulty: number }).max_hiking_difficulty).toBe(5);
      expect(after.tour_waypoints.map(row => (row as { id: number }).id)).toEqual([201, 203, 207]);
      expect(after.day_assignments).toEqual(before.day_assignments.map(row => ({ ...row as object, route_excluded: 0 })));
      expect(() => db.prepare('UPDATE tours SET max_hiking_difficulty = 7').run()).toThrow();
      db.prepare('DELETE FROM places WHERE id = 101').run();
      expect(db.prepare('SELECT * FROM tours').all()).toEqual([]);
      expect(db.prepare('SELECT * FROM tour_waypoints').all()).toEqual([]);
    }
  });

  it.each([
    "ALTER TABLE users ADD COLUMN immich_allow_insecure_tls INTEGER NOT NULL DEFAULT 0",
    'CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY)',
    'ALTER TABLE tours ADD COLUMN unknown_manual_column TEXT',
    'DROP INDEX idx_tour_waypoints_place',
    'UPDATE schema_version SET version = 244',
  ])('rejects mixed or contradictory frozen schemas without changing cursor or data: %s', (mutation) => {
    const db = createAmbiguousToursFixture(mutation, 'frozen');
    const before = snapshot(db);
    const beforeSchema = schemaSnapshot(db);
    const version = cursor(db);
    expect(() => runMigrations(db)).toThrow(/Unsafe Tours migration lineage/);
    expect(cursor(db)).toBe(version);
    expect(snapshot(db)).toEqual(before);
    expect(schemaSnapshot(db)).toEqual(beforeSchema);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['legacy', 'frozen'] as const)('rolls a recognized %s bridge and its cursor back if replay fails, then restarts safely', (lineage) => {
    const version = lineage === 'legacy' ? 218 : 246;
    const db = lineage === 'legacy' ? createLegacyTours218Fixture() : createFrozenTours246Fixture();
    seedTour(db);
    const before = snapshot(db);
    const beforeSchema = schemaSnapshot(db);
    const exec = db.exec.bind(db);
    vi.spyOn(db, 'exec').mockImplementation((sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS push_subscriptions')) throw new Error('Injected migration failure');
      return exec(sql);
    });
    expect(() => runMigrations(db)).toThrow();
    expect(cursor(db)).toBe(version);
    expect(snapshot(db)).toEqual(before);
    expect(schemaSnapshot(db)).toEqual(beforeSchema);
    expect(process.exit).not.toHaveBeenCalled();
    expect(db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'immich_allow_insecure_tls'").get()).toBeUndefined();
    vi.mocked(db.exec).mockRestore();
    runMigrations(db);
    expectFinalSchema(db);
  });

  it.each([
    'CREATE TABLE school_holiday_countries (code TEXT PRIMARY KEY, name TEXT NOT NULL)',
    'ALTER TABLE day_assignments ADD COLUMN end_day INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tour_types ADD COLUMN unknown_manual_column TEXT',
    'UPDATE schema_version SET version = 216',
  ])('rejects ambiguous legacy Tours schemas without rewinding: %s', (mutation) => {
    const db = createAmbiguousToursFixture(mutation, 'legacy');
    const before = snapshot(db);
    const beforeSchema = schemaSnapshot(db);
    const version = cursor(db);
    expect(() => runMigrations(db)).toThrow(/Unsafe Tours migration lineage/);
    expect(cursor(db)).toBe(version);
    expect(snapshot(db)).toEqual(before);
    expect(schemaSnapshot(db)).toEqual(beforeSchema);
  });

  it('upgrades a copied synthetic frozen-246 database and safely reopens it without touching its source', async () => {
    const source = createFrozenTours246Fixture();
    seedTour(source);
    source.prepare('UPDATE tours SET max_hiking_difficulty = 5').run();
    const before = snapshot(source);
    const parent = resolve(repositoryRoot, 'server/data/tmp');
    mkdirSync(parent, { recursive: true });
    const directory = mkdtempSync(resolve(parent, 'b1-tours-lineage-'));
    disposableDirectories.push(directory);
    const filename = resolve(directory, 'synthetic-frozen-copy.sqlite');
    await source.backup(filename);
    const copy = new Database(filename);
    databases.push(copy);
    copy.pragma('foreign_keys = ON');
    runMigrations(copy);
    expectFinalSchema(copy);
    const after = snapshot(copy);
    for (const table of ['places', 'tours', 'tour_waypoints', 'day_assignments']) {
      expectRowsPreserved(after[table], before[table]);
    }
    copy.close();
    const reopened = new Database(filename);
    databases.push(reopened);
    reopened.pragma('foreign_keys = ON');
    runMigrations(reopened);
    expectFinalSchema(reopened);
    expect(snapshot(reopened)).toEqual(after);
    expect(cursor(source)).toBe(246);
    expect(snapshot(source)).toEqual(before);
  });
});