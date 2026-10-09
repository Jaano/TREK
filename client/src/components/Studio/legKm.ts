/**
 * Kilometres between two coordinates, along the great circle.
 *
 * Shared by the map element, which ramps how far a leg bows by it, and by the
 * road fetch, which refuses to route a leg past its ceiling. The clamp keeps
 * `asin` defined when rounding pushes two near antipodal points a hair past 1.
 */
export function legKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
