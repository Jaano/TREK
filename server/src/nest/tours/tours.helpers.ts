/**
 * Pure geometry-metrics helpers for the Tours domain, separate from GPX parsing.
 * PlacesService prepares and persists imported places; these helpers derive
 * metrics from the resulting [[lat,lng,ele?]] geometry.
 */
import { haversineMetres } from '../common/geo';

/** One decoded `route_geometry` point: `[lat, lng]` or `[lat, lng, ele]`. */
export type GeometryPoint = [number, number] | [number, number, number];

export interface TourMetrics {
  /** Sum of segment haversine distances, in km. */
  distanceKm: number;
  /** Sum of positive elevation deltas, in metres. Null when the track carries no elevation. */
  elevationGainM: number | null;
  /** Sum of negative elevation deltas (as a positive number), in metres. Null when no elevation. */
  elevationLossM: number | null;
  /** Whether every point in the geometry carried a 3rd (elevation) value. */
  hasElevation: boolean;
}

/**
 * Derives distance/elevation from a parsed `route_geometry` array. Never throws —
 * A track with fewer than 2 points, or with missing/mixed
 * elevation, still yields a usable (if partial) result rather than blocking import.
 */
export function computeTourMetrics(points: GeometryPoint[]): TourMetrics {
  if (points.length < 2) {
    return { distanceKm: 0, elevationGainM: null, elevationLossM: null, hasElevation: false };
  }
  const hasElevation = points.every(p => p.length === 3 && Number.isFinite(p[2]));

  let distanceKm = 0;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < points.length; i++) {
    distanceKm += haversineMetres(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]) / 1000;
    if (hasElevation) {
      const delta = (points[i][2] as number) - (points[i - 1][2] as number);
      if (delta > 0) gain += delta;
      else loss += -delta;
    }
  }

  return {
    distanceKm,
    elevationGainM: hasElevation ? gain : null,
    elevationLossM: hasElevation ? loss : null,
    hasElevation,
  };
}

/**
 * Parses a `places.route_geometry` JSON string into typed points. Returns an empty
 * array for null/malformed input rather than throwing — a place created by the
 * GPX importer without geometry (shouldn't happen for routes/tracks, but never
 * trust stored JSON blindly) simply yields a zero-metric tour.
 */
export function parseRouteGeometry(routeGeometry: string | null | undefined): GeometryPoint[] {
  if (!routeGeometry) return [];
  try {
    const parsed = JSON.parse(routeGeometry);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is GeometryPoint =>
        Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every((n: unknown) => typeof n === 'number'),
    );
  } catch {
    return [];
  }
}

/** Confidence threshold: below this, the tour imports with a caution flag. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
