import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TourCreateRequest, TourCreateResponse, TourDetailResponse, TourListItem, TourWaypoint } from '@trek/shared';
import { DatabaseService } from '../database/database.service';
import { PlacesService } from '../places/places.service';
import { computeTourMetrics, parseRouteGeometry, LOW_CONFIDENCE_THRESHOLD, type GeometryPoint } from './tours.helpers';

export interface ImportGpxAsTourResult {
  tours: TourListItem[];
  caution: boolean;
  skipped: number;
}

type TourJoinRow = {
  place_id: number; name: string; tour_type: string; distance: number | null;
  elevation_gain: number | null; elevation_loss: number | null; duration: number | null;
  difficulty: string | null; wanderer_ref: string | null; match_confidence: number | null;
  tour_group_id: number | null; max_hiking_difficulty: number | null; planned: number; has_waypoints: number;
};

/**
 * Tours domain: the `tours` facet table (place_id PK/FK) carries tour-specific
 * metadata while existing places and day assignments are reused.
 * GPX parsing and persistence are reused through PlacesService.prepareGpxRows
 * and importPreparedGpx. Places and facet rows are persisted in one transaction,
 * with tour metrics derived from each place's route_geometry.
 */
@Injectable()
export class ToursService {
  private readonly logger = new Logger(ToursService.name);

  constructor(
    private readonly dbs: DatabaseService,
    private readonly places: PlacesService,
  ) {}

  private toItem(r: TourJoinRow): TourListItem {
    return {
      place_id: r.place_id,
      name: r.name,
      tour_type: r.tour_type as TourListItem['tour_type'],
      distance: r.distance,
      elevation_gain: r.elevation_gain,
      elevation_loss: r.elevation_loss,
      duration: r.duration,
      difficulty: r.difficulty,
      wanderer_ref: r.wanderer_ref,
      match_confidence: r.match_confidence,
      tour_group_id: r.tour_group_id,
      max_hiking_difficulty: r.max_hiking_difficulty ?? 2,
      planned: Boolean(r.planned),
      caution: r.match_confidence !== null && r.match_confidence < LOW_CONFIDENCE_THRESHOLD,
      has_waypoints: Boolean(r.has_waypoints),
    };
  }

  /** All tours (the facet + owning place) for a trip, newest first. */
  listTours(tripId: string): TourListItem[] {
    const rows = this.dbs.all<TourJoinRow>(`
      SELECT p.id AS place_id, p.name, t.tour_type, t.distance, t.elevation_gain,
             t.elevation_loss, t.duration, t.difficulty, t.wanderer_ref, t.match_confidence,
             t.tour_group_id, t.max_hiking_difficulty,
             EXISTS(SELECT 1 FROM day_assignments da WHERE da.place_id = p.id) AS planned,
             EXISTS(SELECT 1 FROM tour_waypoints tw WHERE tw.place_id = p.id) AS has_waypoints
        FROM tours t
        JOIN places p ON p.id = t.place_id
       WHERE p.trip_id = ?
       ORDER BY t.created_at DESC
    `, tripId);
    return rows.map(r => this.toItem(r));
  }

  /** One saved tour plus the persisted routing controls needed by the editor. */
  getTour(tripId: string, placeId: string): TourDetailResponse {
    const row = this.dbs.get<TourJoinRow>(`
      SELECT p.id AS place_id, p.name, t.tour_type, t.distance, t.elevation_gain,
             t.elevation_loss, t.duration, t.difficulty, t.wanderer_ref, t.match_confidence,
             t.tour_group_id, t.max_hiking_difficulty,
             EXISTS(SELECT 1 FROM day_assignments da WHERE da.place_id = p.id) AS planned,
             EXISTS(SELECT 1 FROM tour_waypoints tw WHERE tw.place_id = p.id) AS has_waypoints
        FROM tours t
        JOIN places p ON p.id = t.place_id
       WHERE p.trip_id = ? AND p.id = ?
    `, tripId, placeId);
    if (!row) throw new NotFoundException('Tour not found');

    let waypoints = this.dbs.all<TourWaypoint>(`
      SELECT lat, lng, role, sequence
        FROM tour_waypoints
       WHERE place_id = ?
       ORDER BY sequence
    `, placeId);
    // GPX tours created before tour_waypoints existed still belong in this
    // all-tours rail. A read-only endpoint must not backfill the database, so
    // expose their saved geometry endpoints as controls; the first edit/save
    // replaces them with normal persisted tour_waypoints transactionally.
    if (waypoints.length < 2) {
      const place = this.dbs.get<{ route_geometry: string | null }>(
        'SELECT route_geometry FROM places WHERE id = ? AND trip_id = ?', placeId, tripId,
      );
      const geometry = parseRouteGeometry(place?.route_geometry);
      if (geometry.length >= 2) {
        const start = geometry[0];
        const end = geometry[geometry.length - 1];
        waypoints = [
          { lat: start[0], lng: start[1], role: 'start', sequence: 0 },
          { lat: end[0], lng: end[1], role: 'end', sequence: 1 },
        ];
      }
    }

    return { tour: this.toItem(row), waypoints };
  }

  /** Create the owning Place, Tours facet, and ordered control points as one write. */
  createTour(tripId: string, input: TourCreateRequest, socketId?: string): TourCreateResponse {
    const geometry = input.route_geometry as GeometryPoint[];
    const metrics = computeTourMetrics(geometry);
    const start = input.route_geometry[0];
    let placeId = 0;

    this.dbs.transaction(() => {
      const place = this.dbs.run(`
        INSERT INTO places (trip_id, name, lat, lng, transport_mode, route_geometry)
        VALUES (?, ?, ?, ?, 'walking', ?)
      `, tripId, input.name, start[0], start[1], JSON.stringify(input.route_geometry));
      placeId = Number(place.lastInsertRowid);

      this.dbs.run(`
        INSERT INTO tours (
          place_id, tour_type, distance, elevation_gain, elevation_loss, duration, match_confidence,
          max_hiking_difficulty
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `, placeId, input.tour_type, metrics.distanceKm, metrics.elevationGainM,
      metrics.elevationLossM, input.duration_seconds == null ? null : Math.round(input.duration_seconds / 60),
      input.max_hiking_difficulty);

      const insertWaypoint = this.dbs.prepare(`
        INSERT INTO tour_waypoints (place_id, lat, lng, role, sequence)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const waypoint of input.waypoints) {
        insertWaypoint.run(placeId, waypoint.lat, waypoint.lng, waypoint.role, waypoint.sequence);
      }
    });

    const tour = this.listTours(tripId).find(item => item.place_id === placeId);
    const place = this.dbs.getPlaceWithTags(placeId);
    if (!tour || !place) throw new Error('Created tour could not be loaded');
    const waypoints = this.dbs.all<TourWaypoint>(`
      SELECT lat, lng, role, sequence
        FROM tour_waypoints
       WHERE place_id = ?
       ORDER BY sequence
    `, placeId);

    // Only announce after every row committed. The originating client reloads
    // explicitly because socket-id exclusion intentionally suppresses its echo.
    this.broadcastToursChanged(tripId, [placeId], socketId);
    try {
      this.places.broadcast(tripId, 'place:created', { place }, socketId);
    } catch {
      this.logger.warn(`Committed Tour ${placeId}: place notification failed`);
    }
    return { tour, waypoints };
  }

  /** Replace a saved tour's derived route and routing controls as one write. */
  updateTour(tripId: string, placeId: string, input: TourCreateRequest, socketId?: string): TourDetailResponse {
    // The trip predicate is the cross-trip boundary. Do this before any write so
    // an id from another accessible trip cannot be moved into the current one.
    this.getTour(tripId, placeId);
    const geometry = input.route_geometry as GeometryPoint[];
    const metrics = computeTourMetrics(geometry);
    const start = input.route_geometry[0];

    this.dbs.transaction(() => {
      this.dbs.run(`
        UPDATE places
           SET name = ?, lat = ?, lng = ?, transport_mode = 'walking', route_geometry = ?
         WHERE id = ? AND trip_id = ?
      `, input.name, start[0], start[1], JSON.stringify(input.route_geometry), placeId, tripId);
      this.dbs.run(`
        UPDATE tours
             SET tour_type = ?, distance = ?, elevation_gain = ?, elevation_loss = ?,
               duration = ?, match_confidence = 1, max_hiking_difficulty = ?
         WHERE place_id = ?
      `, input.tour_type, metrics.distanceKm, metrics.elevationGainM, metrics.elevationLossM,
      input.duration_seconds == null ? null : Math.round(input.duration_seconds / 60), input.max_hiking_difficulty, placeId);
      this.dbs.run('DELETE FROM tour_waypoints WHERE place_id = ?', placeId);

      const insertWaypoint = this.dbs.prepare(`
        INSERT INTO tour_waypoints (place_id, lat, lng, role, sequence)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const waypoint of input.waypoints) {
        insertWaypoint.run(placeId, waypoint.lat, waypoint.lng, waypoint.role, waypoint.sequence);
      }
    });

    const result = this.getTour(tripId, placeId);
    const place = this.dbs.getPlaceWithTags(Number(placeId));
    if (!place) throw new Error('Updated tour could not be loaded');
    this.broadcastToursChanged(tripId, [Number(placeId)], socketId);
    try {
      this.places.broadcast(tripId, 'place:updated', { place }, socketId);
    } catch {
      this.logger.warn(`Committed Tour ${placeId}: place notification failed`);
    }
    return result;
  }

  private broadcastToursChanged(tripId: string, placeIds: number[], socketId?: string): void {
    try {
      this.places.broadcast(tripId, 'tours:changed', { placeIds }, socketId);
    } catch {
      this.logger.warn(`Committed Tours change for trip ${tripId}: realtime invalidation failed`);
    }
  }

  /**
  * The tours-mode GPX import prepares rows through PlacesService.prepareGpxRows
  * with waypoints excluded. PlacesService.importPreparedGpx persists the places
  * in the same transaction as their `tours` facet rows, whose metrics are
  * derived from route_geometry.
   *
  * Missing or implausible metrics do not block import:
   * a track without elevation still imports, just flagged with a low
   * match_confidence so the client can surface a "with caution" toast.
   */
  importGpxAsTour(tripId: string, fileBuffer: Buffer, defaultName?: string, socketId?: string): ImportGpxAsTourResult | null {
    const rows = this.places.prepareGpxRows(fileBuffer, {
      importWaypoints: false, importRoutes: true, importTracks: true, defaultName,
    });
    if (rows.length === 0) return null;

    const insertTour = this.dbs.prepare(`
      INSERT INTO tours (place_id, tour_type, distance, elevation_gain, elevation_loss, duration, match_confidence, max_hiking_difficulty)
      VALUES (?, 'hike', ?, ?, ?, NULL, ?, 2)
    `);

    const tours: TourListItem[] = [];
    const result = this.dbs.transaction(() => {
      const result = this.places.importPreparedGpx(tripId, rows);
      for (const place of result.places) {
        const points = parseRouteGeometry(place.route_geometry);
        const metrics = computeTourMetrics(points);
        const matchConfidence = metrics.hasElevation ? 1 : 0.3;
        insertTour.run(place.id, metrics.distanceKm, metrics.elevationGainM, metrics.elevationLossM, matchConfidence);
        tours.push(this.toItem({
          place_id: place.id,
          name: place.name,
          tour_type: 'hike',
          distance: metrics.distanceKm,
          elevation_gain: metrics.elevationGainM,
          elevation_loss: metrics.elevationLossM,
          duration: null,
          difficulty: null,
          wanderer_ref: null,
          match_confidence: matchConfidence,
          tour_group_id: null,
          max_hiking_difficulty: 2,
          planned: 0,
          has_waypoints: 0,
        }));
      }
      return result;
    });

    if (result.places.length === 0) return { tours: [], caution: false, skipped: result.skipped };
    this.broadcastToursChanged(tripId, result.places.map(place => place.id), socketId);
    for (const place of result.places) {
      try {
        this.places.broadcast(tripId, 'place:created', { place }, socketId);
      } catch {
        this.logger.warn(`Committed GPX place ${place.id}: realtime notification failed`);
      }
    }
    return { tours, caution: tours.some(t => t.caution), skipped: result.skipped };
  }
}
