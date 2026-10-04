import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';

vi.mock('../../../src/config', () => { throw new Error('Config initialization is forbidden in mock-only tests'); });
vi.mock('../../../src/db/database', () => { throw new Error('Legacy database imports are forbidden in mock-only tests'); });
vi.mock('better-sqlite3', () => { throw new Error('SQLite imports are forbidden in mock-only tests'); });
vi.mock('../../../src/nest/database/database.service', () => ({
  DatabaseService: vi.fn(() => { throw new Error('Database construction is forbidden in mock-only tests'); }),
}));
vi.mock('../../../src/nest/permissions/permissions.service', () => ({ PermissionsService: class {} }));
vi.mock('../../../src/nest/addons/addons.service', () => ({ AddonsService: class {} }));
vi.mock('../../../src/nest/tours/tours.service', () => ({ ToursService: class {} }));
vi.mock('../../../src/nest/auth/jwt-verify', () => ({ extractToken: vi.fn(), verifyJwtAndLoadUser: vi.fn() }));
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { TourCreateRequest } from '@trek/shared';
import { ToursController } from '../../../src/nest/tours/tours.controller';
import type { ToursService } from '../../../src/nest/tours/tours.service';
import { AddonGuard } from '../../../src/nest/addons/addon.guard';
import { JwtAuthGuard } from '../../../src/nest/auth/jwt-auth.guard';
import { TripAccessGuard } from '../../../src/nest/permissions/trip-access.guard';
import { REQUIRE_ADDON } from '../../../src/nest/addons/require-addon.decorator';

const request: TourCreateRequest = {
  name: 'Ridge walk',
  tour_type: 'hike' as const,
  route_geometry: [[48, 11, 600], [48.02, 11.04, 630]] as [number, number, number][],
  waypoints: [
    { lat: 48, lng: 11, role: 'start' as const, sequence: 0 },
    { lat: 48.02, lng: 11.04, role: 'end' as const, sequence: 1 },
  ],
  max_hiking_difficulty: 2,
  duration_seconds: 3600,
};

describe('ToursController planner routes', () => {
  it('TOURS-CTL-001: hides every Tours route behind the addon guard before auth', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ToursController) as unknown[];
    expect(guards).toEqual([AddonGuard, JwtAuthGuard, TripAccessGuard]);
    expect(Reflect.getMetadata(REQUIRE_ADDON, ToursController)).toEqual({ addonId: 'tours', label: 'Tours' });
  });

  it('TOURS-CTL-002: POST /tours delegates the validated payload and socket id', () => {
    const result = { tour: { place_id: 1 }, waypoints: request.waypoints };
    const service = { createTour: vi.fn().mockReturnValue(result) } as unknown as ToursService;
    const controller = new ToursController(service);

    expect(controller.create('7', request, 'socket-1')).toBe(result);
    expect(service.createTour).toHaveBeenCalledWith('7', request, 'socket-1');
  });

  it('TOURS-CTL-003: GET /tours/:placeId delegates within the guarded trip', () => {
    const result = { tour: { place_id: 1 }, waypoints: request.waypoints };
    const service = { getTour: vi.fn().mockReturnValue(result) } as unknown as ToursService;
    const controller = new ToursController(service);

    expect(controller.detail('7', '1')).toBe(result);
    expect(service.getTour).toHaveBeenCalledWith('7', '1');
  });

  it('TOURS-CTL-004: PUT /tours/:placeId delegates the validated payload and socket id', () => {
    const result = { tour: { place_id: 1 }, waypoints: request.waypoints };
    const service = { updateTour: vi.fn().mockReturnValue(result) } as unknown as ToursService;
    const controller = new ToursController(service);

    expect(controller.update('7', '1', request, 'socket-2')).toBe(result);
    expect(service.updateTour).toHaveBeenCalledWith('7', '1', request, 'socket-2');
  });
});
