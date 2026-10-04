import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

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

import { ToursController } from '../../../src/nest/tours/tours.controller';
import { TripAccessGuard, TRIP_PERMISSION_KEY, TRIP_REQUEST_KEY } from '../../../src/nest/permissions/trip-access.guard';
import { AddonGuard } from '../../../src/nest/addons/addon.guard';
import { JwtAuthGuard } from '../../../src/nest/auth/jwt-auth.guard';
import { extractToken, verifyJwtAndLoadUser } from '../../../src/nest/auth/jwt-verify';

function fixture(handler: keyof ToursController, canEdit = false, canAssign = false, tripId = '7') {
  const request = { params: { tripId }, user: { id: 2, role: 'user' } };
  const trip = { id: 7, user_id: 1 };
  const access = vi.fn((id: number, userId: number) => id === 7 && userId === 2 ? trip : undefined);
  const permission = vi.fn((action: string) => action === 'place_edit' ? canEdit : action === 'day_edit' && canAssign);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ToursController.prototype[handler],
    getClass: () => ToursController,
  } as unknown as ExecutionContext;
  const guard = new TripAccessGuard({ canAccessTrip: access } as never, { checkPermission: permission } as never, new Reflector());
  return { request, trip, access, permission, context, guard };
}

function expectStatus(action: () => unknown, status: number) {
  try {
    action();
    expect.fail('Expected guard rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
  }
}

describe('Tours permission contract (mock-only, no DB)', () => {
  it('retains addon/JWT/trip guard order and exact write metadata', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ToursController)).toEqual([AddonGuard, JwtAuthGuard, TripAccessGuard]);
    for (const handler of ['create', 'update', 'importGpx'] as const) {
      expect(Reflect.getMetadata(TRIP_PERMISSION_KEY, ToursController.prototype[handler])).toBe('place_edit');
    }
    for (const handler of ['list', 'detail'] as const) {
      expect(Reflect.getMetadata(TRIP_PERMISSION_KEY, ToursController.prototype[handler])).toBeUndefined();
    }
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])('edit=%s assign=%s permits reads and only place-edit writes', (canEdit, canAssign) => {
    for (const handler of ['list', 'detail'] as const) {
      const test = fixture(handler, canEdit, canAssign);
      expect(test.guard.canActivate(test.context)).toBe(true);
      expect(test.permission).not.toHaveBeenCalled();
      expect(test.request[TRIP_REQUEST_KEY as keyof typeof test.request]).toEqual(test.trip);
    }
    for (const handler of ['create', 'update', 'importGpx'] as const) {
      const test = fixture(handler, canEdit, canAssign);
      if (canEdit) expect(test.guard.canActivate(test.context)).toBe(true);
      else expectStatus(() => test.guard.canActivate(test.context), 403);
      expect(test.permission).toHaveBeenCalledWith('place_edit', 'user', 1, 2, true);
    }
  });

  it.each(['list', 'detail', 'create', 'update', 'importGpx'] as const)('%s rejects inaccessible route trips before any write permission check', handler => {
    const test = fixture(handler, true, true, '8');
    expectStatus(() => test.guard.canActivate(test.context), 404);
    expect(test.access).toHaveBeenCalledWith(8, 2);
    expect(test.permission).not.toHaveBeenCalled();
  });

  it('preserves addon and JWT refusal without reaching trip resolution', () => {
    const test = fixture('create', true, true);
    const addon = new AddonGuard({ isAddonEnabled: vi.fn(() => false) } as never, new Reflector());
    expectStatus(() => addon.canActivate(test.context), 404);
    vi.mocked(extractToken).mockReturnValue(null);
    const jwt = new JwtAuthGuard();
    expectStatus(() => jwt.canActivate(test.context), 401);
    vi.mocked(extractToken).mockReturnValue('token');
    vi.mocked(verifyJwtAndLoadUser).mockReturnValue(null);
    expectStatus(() => jwt.canActivate(test.context), 401);
    expect(test.access).not.toHaveBeenCalled();
  });

  it('delegates import with the route trip and preserves missing/empty-file prechecks', () => {
    const imported = { tours: [{ place_id: 42 }] };
    const importGpxAsTour = vi.fn(() => imported);
    const controller = new ToursController({ importGpxAsTour } as never);
    const buffer = Buffer.from('gpx');
    expect(controller.importGpx('7', { buffer, originalname: 'ridge.gpx' } as Express.Multer.File, 'socket')).toBe(imported);
    expect(importGpxAsTour).toHaveBeenCalledWith('7', buffer, 'ridge.gpx', 'socket');
    const allSkipped = { tours: [], caution: false, skipped: 2 };
    importGpxAsTour.mockReturnValueOnce(allSkipped as never);
    expect(controller.importGpx('7', { buffer, originalname: 'duplicates.gpx' } as Express.Multer.File)).toBe(allSkipped);
    expectStatus(() => controller.importGpx('7', undefined), 400);
    importGpxAsTour.mockReturnValueOnce(null as never);
    expectStatus(() => controller.importGpx('7', { buffer, originalname: 'empty.gpx' } as Express.Multer.File), 400);
  });
});