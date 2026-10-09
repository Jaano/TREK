import { describe, expect, it } from 'vitest';
import { legKm } from './legKm';

describe('legKm', () => {
  it('is zero between a point and itself', () => {
    expect(legKm({ lat: 48.1, lng: 11.6 }, { lat: 48.1, lng: 11.6 })).toBe(0);
  });

  it('measures a degree of latitude as about 111 km', () => {
    expect(legKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
  });

  it('is the same both ways', () => {
    const a = { lat: 35.68, lng: 139.69 };
    const b = { lat: 34.05, lng: -118.24 };
    expect(legKm(a, b)).toBeCloseTo(legKm(b, a), 9);
    expect(legKm(a, b)).toBeGreaterThan(8700);
    expect(legKm(a, b)).toBeLessThan(8900);
  });

  it('stays defined for antipodal points', () => {
    expect(legKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo((12742 * Math.PI) / 2, 3);
  });
});
