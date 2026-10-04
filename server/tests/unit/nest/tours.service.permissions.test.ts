import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config', () => { throw new Error('Config initialization is forbidden in mock-only tests'); });
vi.mock('../../../src/db/database', () => { throw new Error('Legacy database imports are forbidden in mock-only tests'); });
vi.mock('../../../src/nest/database/database.service', () => ({
  DatabaseService: vi.fn(() => { throw new Error('Database construction is forbidden in mock-only tests'); }),
}));
vi.mock('better-sqlite3', () => { throw new Error('SQLite imports are forbidden in mock-only tests'); });
vi.mock('../../../src/nest/places/places.service', () => ({ PlacesService: class {} }));

import { ToursService } from '../../../src/nest/tours/tours.service';
import { tourCreateRequestSchema, type TourCreateRequest } from '@trek/shared';

function makeService() {
  const row = {
    place_id: 42, name: request.name, tour_type: 'hike', distance: 3,
    elevation_gain: 50, elevation_loss: 20, duration: 60, difficulty: null,
    wanderer_ref: null, match_confidence: 1, tour_group_id: null,
    max_hiking_difficulty: 2, planned: 0, has_waypoints: 1,
  };
  let inTransaction = false;
  const waypointRun = vi.fn(() => { expect(inTransaction).toBe(true); });
  const db = {
    get: vi.fn((): unknown => row),
    all: vi.fn((sql: string): unknown[] => sql.includes('JOIN places') ? [row] : request.waypoints),
    run: vi.fn<(sql: string, ...params: unknown[]) => { lastInsertRowid: number }>(() => {
      expect(inTransaction).toBe(true);
      return { lastInsertRowid: 42 };
    }),
    prepare: vi.fn(() => {
      expect(inTransaction).toBe(true);
      return { run: waypointRun };
    }),
    transaction: vi.fn((write: () => void) => {
      inTransaction = true;
      try { write(); } finally { inTransaction = false; }
    }),
    getPlaceWithTags: vi.fn(() => ({ id: 42, trip_id: 7 })),
  };
  const places = { broadcast: vi.fn() };
  return { db, waypointRun, places, service: new ToursService(db as never, places as never) };
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

describe('ToursService planner contracts (mock-only; SQLite rollback semantics require separate integration coverage)', () => {
  let setup: ReturnType<typeof makeService>;
  beforeEach(() => { setup = makeService(); });

  it('TOURS-SVC-001: sends geometry, metrics, and ordered controls through one injected transaction', () => {
    const result = setup.service.createTour('7', request, 'socket-1');

    expect(setup.db.transaction).toHaveBeenCalledOnce();
    expect(setup.db.run).toHaveBeenCalledTimes(2);
    expect(setup.db.run).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO places'), '7', request.name, 48, 11, JSON.stringify(request.route_geometry));
    expect(setup.db.run).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO tours'), 42, 'hike', expect.any(Number), 50, 20, 60, 2);
    expect(setup.db.run.mock.calls[1][3]).toBeGreaterThan(0);
    expect(setup.waypointRun).toHaveBeenCalledTimes(2);
    for (const waypoint of request.waypoints) {
      expect(setup.waypointRun).toHaveBeenCalledWith(42, waypoint.lat, waypoint.lng, waypoint.role, waypoint.sequence);
    }
    expect(result.tour).toMatchObject({ name: 'Ridge walk', planned: false, has_waypoints: true });
    expect(result.waypoints).toEqual(request.waypoints);
    expect(setup.places.broadcast).toHaveBeenNthCalledWith(1, '7', 'tours:changed', { placeIds: [42] }, 'socket-1');
    expect(setup.places.broadcast).toHaveBeenNthCalledWith(2, '7', 'place:created', { place: { id: 42, trip_id: 7 } }, 'socket-1');
  });

  it('TOURS-SVC-002: propagates injected waypoint failure without publishing or reading an uncommitted create', () => {
    const failure = new Error('Injected waypoint failure');
    setup.waypointRun.mockImplementationOnce(() => { throw failure; });
    expect(() => setup.service.createTour('7', request)).toThrow(failure);
    expect(setup.db.transaction).toHaveBeenCalledOnce();
    expect(setup.db.all).not.toHaveBeenCalled();
    expect(setup.db.getPlaceWithTags).not.toHaveBeenCalled();
    expect(setup.places.broadcast).not.toHaveBeenCalled();
  });

  it('TOURS-SVC-003: validates and rounds fractional routed duration before the create write', () => {
    const validated = tourCreateRequestSchema.parse({ ...request, duration_seconds: 3599.5 });
    const result = setup.service.createTour('7', validated);
    expect(setup.db.run).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO tours'), 42, 'hike', expect.any(Number), 50, 20, 60, 2);
    expect(result.tour).toMatchObject({ name: 'Ridge walk', planned: false });
  });

  it('TOURS-SVC-004: scopes detail reads to the trip and derives legacy GPX controls without writes', () => {
    expect(setup.service.getTour('7', '42').waypoints).toEqual(request.waypoints);
    expect(setup.db.get).toHaveBeenCalledWith(expect.stringMatching(/WHERE p.trip_id = \? AND p.id = \?/), '7', '42');
    expect(setup.db.all).toHaveBeenCalledWith(expect.stringContaining('ORDER BY sequence'), '42');
    setup.db.get.mockReturnValueOnce(undefined);
    setup.db.all.mockClear();
    expect(() => setup.service.getTour('8', '42')).toThrow('Tour not found');
    expect(setup.db.all).not.toHaveBeenCalled();
    setup.db.get.mockReturnValueOnce({ place_id: 42, has_waypoints: 0 }).mockReturnValueOnce({ route_geometry: JSON.stringify(request.route_geometry) });
    setup.db.all.mockReturnValueOnce([]);
    const legacyGpx = setup.service.getTour('7', '42');
    expect(legacyGpx.tour.has_waypoints).toBe(false);
    expect(legacyGpx.waypoints).toEqual([
      { lat: 48, lng: 11, role: 'start', sequence: 0 },
      { lat: 48.02, lng: 11.04, role: 'end', sequence: 1 },
    ]);
    for (const method of [setup.db.transaction, setup.db.run, setup.db.prepare, setup.waypointRun, setup.places.broadcast]) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('TOURS-SVC-005: updates route data and replaces controls through the injected transaction', () => {
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

    setup.service.updateTour('7', '42', update, 'socket-2');
    expect(setup.db.transaction).toHaveBeenCalledOnce();
    expect(setup.db.run).toHaveBeenCalledTimes(3);
    expect(setup.db.run).toHaveBeenNthCalledWith(1, expect.stringMatching(/WHERE id = \? AND trip_id = \?/), update.name, 49, 12, JSON.stringify(update.route_geometry), '42', '7');
    expect(setup.db.run).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE tours'), 'hike', expect.any(Number), 60, 0, 45, 2, '42');
    expect(setup.db.run).toHaveBeenNthCalledWith(3, 'DELETE FROM tour_waypoints WHERE place_id = ?', '42');
    expect(setup.waypointRun).toHaveBeenCalledTimes(3);
    for (const waypoint of update.waypoints) {
      expect(setup.waypointRun).toHaveBeenCalledWith('42', waypoint.lat, waypoint.lng, waypoint.role, waypoint.sequence);
    }
    expect(setup.places.broadcast).toHaveBeenCalledWith(
      '7', 'place:updated', expect.objectContaining({ place: expect.anything() }), 'socket-2',
    );
  });

  it('TOURS-SVC-006: propagates injected replacement failure without publishing or reloading', () => {
    const failure = new Error('Injected replacement failure');
    setup.waypointRun.mockImplementationOnce(() => { throw failure; });
    expect(() => setup.service.updateTour('7', '42', request)).toThrow(failure);
    expect(setup.db.transaction).toHaveBeenCalledOnce();
    expect(setup.db.get).toHaveBeenCalledTimes(1);
    expect(setup.db.getPlaceWithTags).not.toHaveBeenCalled();
    expect(setup.places.broadcast).not.toHaveBeenCalled();
  });
});