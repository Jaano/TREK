import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Logger } from '@nestjs/common';

vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: vi.fn(),
}));
vi.mock('../../../src/db/database', () => ({
  db: {
    prepare: () => { throw new Error('Legacy database access forbidden'); },
    exec: () => { throw new Error('Legacy database access forbidden'); },
  },
}));
vi.mock('../../../src/nest/database/database.service', () => ({ DatabaseService: class {} }));
vi.mock('../../../src/websocket', () => ({ broadcast: vi.fn() }));

import { PlacesService } from '../../../src/nest/places/places.service';
import { ToursService } from '../../../src/nest/tours/tours.service';
import { gpxParser } from '../../../src/nest/places/places.helpers';

const mixedGpx = Buffer.from(`<gpx>
  <wpt lat="1" lon="2"><name>Ignored POI</name></wpt>
  <rte><desc>Route description</desc><rtept lat="48" lon="11"/><rtept lat="48.01" lon="11.01"/></rte>
  <trk><name>Ridge</name><desc>Track description</desc><trkseg>
    <trkpt lat="49" lon="12"><ele>100</ele></trkpt>
    <trkpt lat="49.01" lon="12.01"><ele>150</ele></trkpt>
  </trkseg><trkseg><trkpt lat="49.02" lon="12.02"><ele>120</ele></trkpt></trkseg></trk>
</gpx>`);

function makeHarness() {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(`
    CREATE TABLE places (id INTEGER PRIMARY KEY, trip_id TEXT, name TEXT, description TEXT,
      lat REAL, lng REAL, transport_mode TEXT, route_geometry TEXT, route_color TEXT,
      google_place_id TEXT, google_ftid TEXT, osm_id TEXT, amap_poi_id TEXT);
    CREATE TABLE tours (place_id INTEGER PRIMARY KEY REFERENCES places(id), tour_type TEXT,
      distance REAL, elevation_gain REAL, elevation_loss REAL, duration REAL,
      match_confidence REAL, max_hiking_difficulty INTEGER);
    CREATE TABLE tour_waypoints (id INTEGER PRIMARY KEY, tour_place_id INTEGER REFERENCES tours(place_id));
  `);
  const db = {
    connection: raw,
    prepare: (sql: string) => raw.prepare(sql),
    all: (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params),
    getPlaceWithTags: (id: number) => ({ ...raw.prepare('SELECT * FROM places WHERE id = ?').get(id) as object, tags: [] }),
    transaction: vi.fn(<Result>(write: (conn: Database.Database) => Result): Result => {
      expect(raw.inTransaction).toBe(false);
      return raw.transaction(() => write(raw))();
    }),
  };
  const broadcast = vi.fn();
  const places = new PlacesService(db as never, {} as never, { broadcast } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { raw, db, places, broadcast, tours: new ToursService(db as never, places) };
}

describe('Tours GPX atomic persistence and postcommit publication', () => {
  let setup: ReturnType<typeof makeHarness>;
  beforeEach(() => { setup = makeHarness(); });
  afterEach(() => { setup.raw.close(); vi.restoreAllMocks(); });

  function expectEmpty() {
    for (const table of ['places', 'tours', 'tour_waypoints']) {
      expect(setup.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(setup.broadcast).not.toHaveBeenCalled();
  }

  it('commits routes, tracks, colors and facets once before publishing, without Planner waypoints', () => {
    setup.broadcast.mockImplementation((tripId, event, payload, socketId) => {
      expect(setup.raw.inTransaction).toBe(false);
      expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM tours').get()).toEqual({ count: 2 });
      expect(tripId).toBe('7');
      if (event === 'tours:changed') {
        expect(payload).toEqual({ placeIds: [1, 2] });
        expect(socketId).toBe('socket');
      } else {
        expect(event).toBe('place:created');
        expect(socketId).toBe('socket');
        expect(payload.place.route_color).toBeTruthy();
      }
    });
    const result = setup.tours.importGpxAsTour('7', mixedGpx, 'walk.gpx', 'socket')!;
    expect(setup.db.transaction).toHaveBeenCalledOnce();
    expect(result.tours).toHaveLength(2);
    expect(result.skipped).toBe(0);
    expect(result.caution).toBe(true);
    expect(result.tours[0]).toMatchObject({ name: 'walk', tour_type: 'hike', max_hiking_difficulty: 2, planned: false, has_waypoints: false, caution: true });
    expect(result.tours[1]).toMatchObject({ name: 'Ridge', elevation_gain: 50, elevation_loss: 30, caution: false });
    const rows = setup.raw.prepare('SELECT * FROM places ORDER BY id').all() as { trip_id: string; description: string; route_geometry: string; route_color: string }[];
    expect(rows.map(row => row.trip_id)).toEqual(['7', '7']);
    expect(rows.map(row => row.description)).toEqual(['Route description', 'Track description']);
    expect(JSON.parse(rows[0].route_geometry)).toEqual([[48, 11], [48.01, 11.01]]);
    expect(JSON.parse(rows[1].route_geometry)).toEqual([[49, 12, 100], [49.01, 12.01, 150], [49.02, 12.02, 120]]);
    expect(new Set(rows.map(row => row.route_color)).size).toBe(2);
    expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM tour_waypoints').get()).toEqual({ count: 0 });
    expect(setup.broadcast.mock.calls.map(call => call[1])).toEqual(['tours:changed', 'place:created', 'place:created']);
    expect(setup.broadcast.mock.calls.slice(1).map(call => call[2].place.id)).toEqual(result.tours.map(tour => tour.place_id));
  });

  it.each([1, 2])('rolls back every carrier and facet when facet %i fails', (ordinal) => {
    setup.raw.exec(`CREATE TRIGGER fail_facet BEFORE INSERT ON tours
      WHEN (SELECT COUNT(*) FROM tours) = ${ordinal - 1}
      BEGIN SELECT RAISE(ABORT, 'facet failure'); END;`);
    expect(() => setup.tours.importGpxAsTour('7', mixedGpx)).toThrow('facet failure');
    expectEmpty();
  });

  it('rolls back earlier carriers when the later Place insert fails', () => {
    setup.raw.exec(`CREATE TRIGGER fail_place BEFORE INSERT ON places WHEN NEW.name = 'Ridge'
      BEGIN SELECT RAISE(ABORT, 'place failure'); END;`);
    expect(() => setup.tours.importGpxAsTour('7', mixedGpx)).toThrow('place failure');
    expectEmpty();
  });

  it('rolls back carriers and earlier colors when later coloring fails', () => {
    setup.raw.exec(`CREATE TRIGGER fail_color BEFORE UPDATE OF route_color ON places WHEN NEW.name = 'Ridge'
      BEGIN SELECT RAISE(ABORT, 'color failure'); END;`);
    expect(() => setup.tours.importGpxAsTour('7', mixedGpx)).toThrow('color failure');
    expectEmpty();
  });

  it.each(['<not-gpx/>', '<gpx/>', '<gpx><wpt lat="1" lon="2"/></gpx>', '<gpx><trk><trkseg><trkpt/></trkseg></trk></gpx>'])('does not write or publish unusable input %s', (xml) => {
    expect(setup.tours.importGpxAsTour('7', Buffer.from(xml))).toBeNull();
    expect(setup.db.transaction).not.toHaveBeenCalled();
    expectEmpty();
  });

  it('propagates parser failures before entering the transaction', () => {
    vi.spyOn(gpxParser, 'parse').mockImplementationOnce(() => { throw new Error('parser failure'); });
    expect(() => setup.tours.importGpxAsTour('7', mixedGpx)).toThrow('parser failure');
    expect(setup.db.transaction).not.toHaveBeenCalled();
    expectEmpty();
  });

  it('keeps a committed response and attempts remaining events if publication throws', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    setup.broadcast.mockImplementationOnce(() => { throw new Error('transport unavailable'); });
    expect(setup.tours.importGpxAsTour('7', mixedGpx)?.tours).toHaveLength(2);
    expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM tours').get()).toEqual({ count: 2 });
    expect(setup.broadcast).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('keeps committed rows and success response if the Tours invalidation event fails', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    setup.broadcast.mockImplementation((_tripId, event) => {
      if (event === 'tours:changed') throw new Error('invalidation unavailable');
    });

    const result = setup.tours.importGpxAsTour('7', mixedGpx);

    expect(result?.tours).toHaveLength(2);
    expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM places').get()).toEqual({ count: 2 });
    expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM tours').get()).toEqual({ count: 2 });
    expect(setup.broadcast.mock.calls.map(call => call[1])).toEqual(['tours:changed', 'place:created', 'place:created']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('returns a successful skipped result for duplicate-only imports without publishing events', () => {
    expect(setup.tours.importGpxAsTour('7', mixedGpx)?.tours).toHaveLength(2);
    const rowsBefore = setup.raw.prepare('SELECT id, trip_id, name FROM places ORDER BY id').all();
    const facetsBefore = setup.raw.prepare('SELECT place_id FROM tours ORDER BY place_id').all();
    setup.broadcast.mockClear();

    expect(setup.tours.importGpxAsTour('7', mixedGpx)).toEqual({ tours: [], caution: false, skipped: 2 });
    expect(setup.raw.prepare('SELECT id, trip_id, name FROM places ORDER BY id').all()).toEqual(rowsBefore);
    expect(setup.raw.prepare('SELECT place_id FROM tours ORDER BY place_id').all()).toEqual(facetsBefore);
    expect(setup.broadcast).not.toHaveBeenCalled();
  })

  it('imports only the new tracks and publishes only committed rows in a mixed result', () => {
    const existing = Buffer.from(`<gpx><trk><name>Ridge</name><trkseg>
      <trkpt lat="49" lon="12"><ele>100</ele></trkpt><trkpt lat="49.01" lon="12.01"><ele>150</ele></trkpt>
    </trkseg></trk></gpx>`)
    expect(setup.tours.importGpxAsTour('7', existing)?.tours).toHaveLength(1);
    setup.broadcast.mockClear();

    const result = setup.tours.importGpxAsTour('7', mixedGpx, 'walk.gpx', 'socket');

    expect(result?.tours).toHaveLength(1);
    expect(result?.tours[0].name).toBe('walk');
    expect(result?.skipped).toBe(1);
    expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM places').get()).toEqual({ count: 2 });
    expect(setup.raw.prepare('SELECT COUNT(*) AS count FROM tours').get()).toEqual({ count: 2 });
    expect(setup.broadcast.mock.calls.map(call => [call[1], call[2]])).toEqual([
      ['tours:changed', { placeIds: [2] }],
      ['place:created', expect.objectContaining({ place: expect.objectContaining({ id: 2, name: 'walk' }) })],
    ]);
  })

  it('preserves single-track response and trip scoping', () => {
    const single = Buffer.from('<gpx><trk><trkseg><trkpt lat="48" lon="11"/><trkpt lat="48.01" lon="11.01"/></trkseg></trk></gpx>');
    const result = setup.tours.importGpxAsTour('8', single, 'single.gpx')!;
    expect(result.tours).toHaveLength(1);
    expect(result.tours[0].name).toBe('single');
    expect(result.caution).toBe(true);
    expect(setup.broadcast.mock.calls.map(call => call[1])).toEqual(['tours:changed', 'place:created']);
  });

  it('rejects caller-owned persistence outside a transaction before writing', () => {
    expect(() => setup.places.importPreparedGpx('7', setup.places.prepareGpxRows(mixedGpx))).toThrow('active transaction');
    expectEmpty();
  });
});