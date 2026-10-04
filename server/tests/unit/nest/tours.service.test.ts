import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Logger } from '@nestjs/common';

const { legacyDatabaseAccess } = vi.hoisted(() => ({
  legacyDatabaseAccess: vi.fn((property: string | symbol): never => {
    throw new Error(`Unexpected legacy database access: ${String(property)}`);
  }),
}));

vi.mock('../../../src/config', () => ({
  ENCRYPTION_KEY: 'test-only-inert-key',
  JWT_SECRET: 'test-only-inert-secret',
  updateJwtSecret: vi.fn(),
}));
vi.mock('../../../src/db/database', () => ({
  db: new Proxy({}, {
    get: (_target, property: string | symbol) => legacyDatabaseAccess(property),
  }),
}));

import { ToursService } from '../../../src/nest/tours/tours.service';
import { tourCreateRequestSchema, type TourCreateRequest } from '@trek/shared';

function makeService() {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(`
    CREATE TABLE places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      lat REAL,
      lng REAL,
      transport_mode TEXT,
      route_geometry TEXT
    );
    CREATE TABLE day_assignments (place_id INTEGER);
    CREATE TABLE tour_types (key TEXT PRIMARY KEY);
    INSERT INTO tour_types (key) VALUES ('hike');
    CREATE TABLE tours (
      place_id INTEGER PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
      tour_type TEXT NOT NULL REFERENCES tour_types(key),
      distance REAL, elevation_gain REAL, elevation_loss REAL, duration REAL,
      difficulty TEXT, wanderer_ref TEXT, match_confidence REAL,
      tour_group_id INTEGER, max_hiking_difficulty INTEGER NOT NULL DEFAULT 2,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE tour_waypoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER NOT NULL REFERENCES tours(place_id) ON DELETE CASCADE,
      lat REAL NOT NULL, lng REAL NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('start', 'via', 'end')),
      sequence INTEGER NOT NULL,
      UNIQUE(place_id, sequence)
    );
  `);
  const db = {
    get: <T>(sql: string, ...params: unknown[]) => raw.prepare(sql).get(...params as never[]) as T | undefined,
    all: <T>(sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params as never[]) as T[],
    run: (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...params as never[]),
    prepare: (sql: string) => raw.prepare(sql),
    transaction: <T>(fn: () => T) => raw.transaction(fn)(),
    getPlaceWithTags: (id: number) => raw.prepare('SELECT * FROM places WHERE id = ?').get(id),
  };
  const places = { broadcast: vi.fn() };
  return { raw, places, service: new ToursService(db as never, places as never) };
}

const request: TourCreateRequest = {
  name: 'Ridge walk',
  tour_type: 'hike',
  route_geometry: [[48, 11, 600], [48.01, 11.02, 650], [48.02, 11.04, 630]],
  waypoints: [
    { lat: 48, lng: 11, role: 'start', sequence: 0 },
    { lat: 48.02, lng: 11.04, role: 'end', sequence: 1 },
  ],
  max_hiking_difficulty: 2,
  duration_seconds: 3600,
};

describe('ToursService planner creation', () => {
  let setup: ReturnType<typeof makeService>;
  beforeEach(() => { setup = makeService(); });

  it('does not access the legacy global database initializer', () => {
    expect(legacyDatabaseAccess).not.toHaveBeenCalled();
  });

  it('TOURS-SVC-001: atomically stores full geometry, derived metrics, and ordered control points', () => {
    const writeStates: boolean[] = [];
    setup.places.broadcast.mockImplementation(() => { writeStates.push(setup.raw.inTransaction); });
    const result = setup.service.createTour('7', request, 'socket-1');

    const place = setup.raw.prepare('SELECT * FROM places').get() as Record<string, unknown>;
    const tour = setup.raw.prepare('SELECT * FROM tours').get() as Record<string, unknown>;
    const points = setup.raw.prepare('SELECT role, sequence FROM tour_waypoints ORDER BY sequence').all();

    expect(JSON.parse(String(place.route_geometry))).toEqual(request.route_geometry);
    expect(tour.distance).toBeGreaterThan(0);
    expect(tour.elevation_gain).toBe(50);
    expect(tour.elevation_loss).toBe(20);
    expect(tour.duration).toBe(60);
    expect(points).toEqual([{ role: 'start', sequence: 0 }, { role: 'end', sequence: 1 }]);
    expect(result.tour).toMatchObject({ name: 'Ridge walk', planned: false, has_waypoints: true });
    expect(setup.places.broadcast).toHaveBeenNthCalledWith(1, '7', 'tours:changed', { placeIds: [1] }, 'socket-1');
    expect(setup.places.broadcast).toHaveBeenNthCalledWith(2, '7', 'place:created', { place: expect.anything() }, 'socket-1');
    expect(setup.places.broadcast).toHaveBeenCalledTimes(2);
    expect(writeStates).toEqual([false, false]);
  });

  it('TOURS-SVC-002: rolls the owning place and facet back when a waypoint insert fails', () => {
    const invalid = {
      ...request,
      waypoints: [request.waypoints[0], { ...request.waypoints[1], sequence: 0 }],
    } as TourCreateRequest;

    expect(() => setup.service.createTour('7', invalid)).toThrow();
    expect(setup.raw.prepare('SELECT count(*) AS n FROM places').get()).toEqual({ n: 0 });
    expect(setup.raw.prepare('SELECT count(*) AS n FROM tours').get()).toEqual({ n: 0 });
    expect(setup.places.broadcast).not.toHaveBeenCalled();
  });

  it('TOURS-SVC-003: validates a fractional routed duration before the atomic create', () => {
    const validated = tourCreateRequestSchema.parse({ ...request, duration_seconds: 3599.5 });

    const result = setup.service.createTour('7', validated);

    expect(setup.raw.prepare('SELECT count(*) AS n FROM places').get()).toEqual({ n: 1 });
    expect(setup.raw.prepare('SELECT count(*) AS n FROM tours').get()).toEqual({ n: 1 });
    expect(setup.raw.prepare('SELECT count(*) AS n FROM tour_waypoints').get()).toEqual({ n: 2 });
    expect(setup.raw.prepare('SELECT duration FROM tours').get()).toEqual({ duration: 60 });
    expect(result.tour).toMatchObject({ name: 'Ridge walk', planned: false });
  });

  it('TOURS-SVC-004: loads only a trip-owned tour with its ordered control points', () => {
    const created = setup.service.createTour('7', request);

    expect(setup.service.getTour('7', String(created.tour.place_id))).toEqual(created);
    expect(() => setup.service.getTour('8', String(created.tour.place_id))).toThrow('Tour not found');

    setup.raw.prepare('DELETE FROM tour_waypoints WHERE place_id = ?').run(created.tour.place_id);
    const legacyGpx = setup.service.getTour('7', String(created.tour.place_id));
    expect(legacyGpx.tour.has_waypoints).toBe(false);
    expect(legacyGpx.waypoints).toEqual([
      { lat: 48, lng: 11, role: 'start', sequence: 0 },
      { lat: 48.02, lng: 11.04, role: 'end', sequence: 1 },
    ]);
  });

  it('TOURS-SVC-005: atomically updates route data and replaces persisted control points', () => {
    const created = setup.service.createTour('7', request);
    setup.places.broadcast.mockClear();
    const writeStates: boolean[] = [];
    setup.places.broadcast.mockImplementation(() => { writeStates.push(setup.raw.inTransaction); });
    const update: TourCreateRequest = {
      ...request,
      name: 'Updated ridge walk',
      route_geometry: [[49, 12, 700], [49.02, 12.04, 760]],
      waypoints: [
        { lat: 49, lng: 12, role: 'start', sequence: 0 },
        { lat: 49.01, lng: 12.02, role: 'via', sequence: 1 },
        { lat: 49.02, lng: 12.04, role: 'end', sequence: 2 },
      ],
      duration_seconds: 2700.5,
    };

    const result = setup.service.updateTour('7', String(created.tour.place_id), update, 'socket-2');

    expect(result.tour).toMatchObject({ place_id: created.tour.place_id, name: 'Updated ridge walk' });
    expect(result.waypoints).toEqual(update.waypoints);
    expect(setup.raw.prepare('SELECT name, lat, lng FROM places').get()).toEqual({
      name: 'Updated ridge walk', lat: 49, lng: 12,
    });
    expect(setup.raw.prepare('SELECT duration FROM tours').get()).toEqual({ duration: 45 });
    expect(setup.places.broadcast).toHaveBeenNthCalledWith(1, '7', 'tours:changed', { placeIds: [created.tour.place_id] }, 'socket-2');
    expect(setup.places.broadcast).toHaveBeenNthCalledWith(2,
      '7', 'place:updated', expect.objectContaining({ place: expect.anything() }), 'socket-2',
    );
    expect(writeStates).toEqual([false, false]);
  });

  it('TOURS-SVC-006: rolls an invalid waypoint replacement back to the previous saved tour', () => {
    const created = setup.service.createTour('7', request);
    const invalid = {
      ...request,
      name: 'Must roll back',
      waypoints: [request.waypoints[0], { ...request.waypoints[1], sequence: 0 }],
    } as TourCreateRequest;

    expect(() => setup.service.updateTour('7', String(created.tour.place_id), invalid)).toThrow();
    expect(setup.raw.prepare('SELECT name FROM places').get()).toEqual({ name: 'Ridge walk' });
    expect(setup.service.getTour('7', String(created.tour.place_id)).waypoints).toEqual(request.waypoints);
  });

  it('keeps a committed create successful when Tours invalidation publication fails', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    setup.places.broadcast.mockImplementation((_tripId, event) => {
      if (event === 'tours:changed') throw new Error('transport unavailable');
    });

    const result = setup.service.createTour('7', request);

    expect(result.tour.name).toBe('Ridge walk');
    expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM places').get()).toEqual({ count: 1 });
    expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM tours').get()).toEqual({ count: 1 });
    expect(setup.places.broadcast).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
  });
});
