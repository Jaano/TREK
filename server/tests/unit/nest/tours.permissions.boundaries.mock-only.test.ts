import 'reflect-metadata';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TourCreateRequest } from '@trek/shared';

vi.mock('../../../src/config', () => { throw new Error('Config initialization is forbidden in mock-only tests'); });
vi.mock('../../../src/nest/database/database.service', () => ({
  DatabaseService: vi.fn(() => { throw new Error('Database construction is forbidden in this suite'); }),
}));
vi.mock('../../../src/db/database', () => ({
  db: { prepare: vi.fn(() => { throw new Error('Legacy database access is forbidden in this suite'); }) },
}));
vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => { throw new Error('SQLite construction is forbidden in this suite'); }),
}));
vi.mock('../../../src/nest/permissions/permissions.service', () => ({ PermissionsService: class {} }));
vi.mock('../../../src/nest/places/places.service', () => ({ PlacesService: class {} }));
vi.mock('../../../src/nest/assignments/assignments.service', () => ({ AssignmentsService: class {} }));
vi.mock('../../../src/nest/app-config/runtime-env.service', () => ({ RuntimeEnvService: class {} }));
vi.mock('../../../src/nest/storage/storage.service', () => ({ StorageService: class {} }));
vi.mock('../../../src/nest/auth/jwt-verify', () => ({ extractToken: vi.fn(), verifyJwtAndLoadUser: vi.fn() }));

import { DatabaseService } from '../../../src/nest/database/database.service';
import { db as legacyDatabase } from '../../../src/db/database';
import SqliteDatabase from 'better-sqlite3';
import { PlacesController } from '../../../src/nest/places/places.controller';
import { DayAssignmentsController } from '../../../src/nest/assignments/assignments.controller';
import { ToursService } from '../../../src/nest/tours/tours.service';
import { JwtAuthGuard } from '../../../src/nest/auth/jwt-auth.guard';
import { TripAccessGuard, TRIP_PERMISSION_KEY } from '../../../src/nest/permissions/trip-access.guard';

const matrix = [[false, false], [true, false], [false, true], [true, true]] as const;

afterAll(() => {
  expect(DatabaseService).not.toHaveBeenCalled();
  expect(legacyDatabase.prepare).not.toHaveBeenCalled();
  expect(SqliteDatabase).not.toHaveBeenCalled();
});

function authorization(controller: typeof PlacesController | typeof DayAssignmentsController, handler: 'create' | 'remove', canEdit: boolean, canAssign: boolean, tripId = '7') {
  const request = { params: { tripId }, user: { id: 2, role: 'user' } };
  const trip = { id: 7, user_id: 1 };
  const access = vi.fn((id: number, userId: number) => id === 7 && userId === 2 ? trip : undefined);
  const permission = vi.fn((action: string) => action === 'place_edit' ? canEdit : action === 'day_edit' && canAssign);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
  } as unknown as ExecutionContext;
  const guard = new TripAccessGuard({ canAccessTrip: access } as never, { checkPermission: permission } as never, new Reflector());
  return { request, access, permission, context, guard };
}

async function rejected(action: () => unknown, status: number) {
  await expect(Promise.resolve().then(action)).rejects.toMatchObject({ status });
}

function placesFixture() {
  const places = {
    get: vi.fn(() => ({ id: 42, trip_id: 7 })),
    onDeleted: vi.fn(),
    linkedExpenseIds: vi.fn(() => []),
    remove: vi.fn(async () => ({ deleted: true, deletedTourPlaceIds: [], cancelled: { reservationIds: [], budgetItemIds: [] } })),
    broadcast: vi.fn(),
  };
  return { places, controller: new PlacesController(places as never, {} as never, {} as never) };
}

function assignmentsFixture() {
  const assignment = { id: 51, place_id: 42, day_id: 11 };
  const assignments = {
    dayExists: vi.fn(() => true),
    placeExists: vi.fn(() => true),
    assignmentExistsInDay: vi.fn(() => true),
    createAssignment: vi.fn(() => assignment),
    deleteAssignment: vi.fn(),
    broadcast: vi.fn(),
    reconcile: vi.fn(),
  };
  return { assignment, assignments, controller: new DayAssignmentsController(assignments as never) };
}

describe('Tours deletion and assignment authorization (mock-only)', () => {
  it('keeps existing Places deletion and day assignment endpoints wired to their exact permissions', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PlacesController)).toBe('api/trips/:tripId/places');
    expect(Reflect.getMetadata(GUARDS_METADATA, PlacesController)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, PlacesController.prototype.remove)).toEqual([TripAccessGuard]);
    expect(Reflect.getMetadata(TRIP_PERMISSION_KEY, PlacesController.prototype.remove)).toBe('place_edit');
    expect(Reflect.getMetadata(METHOD_METADATA, PlacesController.prototype.remove)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(PATH_METADATA, PlacesController.prototype.remove)).toBe(':id');
    expect(Reflect.getMetadata(PATH_METADATA, DayAssignmentsController)).toBe('api/trips/:tripId/days/:dayId/assignments');
    expect(Reflect.getMetadata(GUARDS_METADATA, DayAssignmentsController)).toEqual([JwtAuthGuard, TripAccessGuard]);
    for (const handler of ['create', 'remove'] as const) {
      expect(Reflect.getMetadata(TRIP_PERMISSION_KEY, DayAssignmentsController.prototype[handler])).toBe('day_edit');
    }
    expect(Reflect.getMetadata(METHOD_METADATA, DayAssignmentsController.prototype.create)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, DayAssignmentsController.prototype.remove)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(PATH_METADATA, DayAssignmentsController.prototype.remove)).toBe(':id');
  });

  it.each(matrix)('edit=%s assign=%s: tour deletion requires only place_edit', async (canEdit, canAssign) => {
    const auth = authorization(PlacesController, 'remove', canEdit, canAssign);
    const { places, controller } = placesFixture();
    const invoke = () => {
      auth.guard.canActivate(auth.context);
      return controller.remove(auth.request.user as never, '7', '42', 'socket');
    };
    if (canEdit) {
      await expect(invoke()).resolves.toEqual({ success: true, tourPlaceIds: [] });
      expect(places.get).toHaveBeenCalledWith('7', '42');
      expect(places.onDeleted).toHaveBeenCalledWith(42);
      expect(places.remove).toHaveBeenCalledWith('7', '42');
      expect(places.broadcast).toHaveBeenCalledWith('7', 'place:deleted', { placeId: 42 }, 'socket');
    } else {
      await rejected(invoke, 403);
      for (const method of Object.values(places)) expect(method).not.toHaveBeenCalled();
    }
    expect(auth.permission).toHaveBeenCalledExactlyOnceWith('place_edit', 'user', 1, 2, true);
  });

  describe.each(['create', 'remove'] as const)('assignment %s', handler => {
    it.each(matrix)('edit=%s assign=%s: requires only day_edit', async (canEdit, canAssign) => {
      const auth = authorization(DayAssignmentsController, handler, canEdit, canAssign);
      const { assignment, assignments, controller } = assignmentsFixture();
      const invoke = () => {
        auth.guard.canActivate(auth.context);
        return handler === 'create'
          ? controller.create(auth.request.user as never, '7', '11', { place_id: 42, notes: 'Tour' }, 'socket')
          : controller.remove(auth.request.user as never, '7', '11', '51', 'socket');
      };
      if (canAssign) {
        expect(invoke()).toEqual(handler === 'create' ? { assignment } : { success: true });
        if (handler === 'create') {
          expect(assignments.dayExists).toHaveBeenCalledWith('11', '7');
          expect(assignments.placeExists).toHaveBeenCalledWith(42, '7');
          expect(assignments.createAssignment).toHaveBeenCalledWith('11', 42, 'Tour');
          expect(assignments.deleteAssignment).not.toHaveBeenCalled();
          expect(assignments.broadcast).toHaveBeenCalledWith('7', 'assignment:created', { assignment }, 'socket');
        } else {
          expect(assignments.assignmentExistsInDay).toHaveBeenCalledWith('51', '11', '7');
          expect(assignments.deleteAssignment).toHaveBeenCalledWith('51');
          expect(assignments.createAssignment).not.toHaveBeenCalled();
          expect(assignments.broadcast).toHaveBeenCalledWith('7', 'assignment:deleted', { assignmentId: 51, dayId: 11 }, 'socket');
        }
        expect(assignments.reconcile).toHaveBeenCalledWith('7', 'socket');
      } else {
        await rejected(invoke, 403);
        for (const method of Object.values(assignments)) expect(method).not.toHaveBeenCalled();
      }
      expect(auth.permission).toHaveBeenCalledExactlyOnceWith('day_edit', 'user', 1, 2, true);
    });
  });

  it.each([
    [PlacesController, 'remove'],
    [DayAssignmentsController, 'create'],
    [DayAssignmentsController, 'remove'],
  ] as const)('%s.%s rejects an inaccessible route trip before checking permissions', async (owner, handler) => {
    const auth = authorization(owner, handler, true, true, '8');
    await rejected(() => auth.guard.canActivate(auth.context), 404);
    expect(auth.access).toHaveBeenCalledExactlyOnceWith(8, 2);
    expect(auth.permission).not.toHaveBeenCalled();
  });
});

const input: TourCreateRequest = {
  name: 'Ridge walk', tour_type: 'hike', max_hiking_difficulty: 2,
  route_geometry: [[48, 11, 600], [48.02, 11.04, 630]],
  waypoints: [
    { lat: 48, lng: 11, role: 'start', sequence: 0 },
    { lat: 48.02, lng: 11.04, role: 'end', sequence: 1 },
  ],
};

function tourDatabaseFixture(ownerTripId: string) {
  const row = {
    place_id: 42, name: 'Ridge walk', tour_type: 'hike', distance: 3,
    elevation_gain: 30, elevation_loss: 0, duration: null, difficulty: null,
    wanderer_ref: null, match_confidence: 1, tour_group_id: null,
    max_hiking_difficulty: 2, planned: 0, has_waypoints: 1,
  };
  const waypointRun = vi.fn();
  const db = {
    get: vi.fn((sql: string, tripId: string, placeId: string) => {
      expect(sql.replace(/\s+/g, ' ')).toContain('WHERE p.trip_id = ? AND p.id = ?');
      return tripId === ownerTripId && placeId === '42' ? row : undefined;
    }),
    all: vi.fn(() => input.waypoints),
    run: vi.fn(),
    prepare: vi.fn(() => ({ run: waypointRun })),
    transaction: vi.fn((write: () => void) => write()),
    getPlaceWithTags: vi.fn(() => ({ id: 42, trip_id: Number(ownerTripId) })),
  };
  const places = { broadcast: vi.fn() };
  return { db, waypointRun, places, service: new ToursService(db as never, places as never) };
}

describe('Real ToursService update trip boundary (mock database module)', () => {
  it('rejects a placeId belonging to another trip before any transaction or write', () => {
    const { db, waypointRun, places, service } = tourDatabaseFixture('8');
    expect(service.getTour('8', '42').tour.place_id).toBe(42);
    db.get.mockClear();
    db.all.mockClear();
    try {
      service.updateTour('7', '42', input, 'socket');
      expect.fail('Expected cross-trip rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(404);
      expect((error as Error).message).toBe('Tour not found');
    }
    expect(db.get).toHaveBeenCalledExactlyOnceWith(expect.any(String), '7', '42');
    for (const method of [db.all, db.transaction, db.run, db.prepare, waypointRun, db.getPlaceWithTags, places.broadcast]) {
      expect(method).not.toHaveBeenCalled();
    }
    expect(DatabaseService).not.toHaveBeenCalled();
  });

  it('allows a same-trip update through the fake transaction and prepare interface', () => {
    const { db, waypointRun, places, service } = tourDatabaseFixture('7');
    expect(service.updateTour('7', '42', input, 'socket').tour.place_id).toBe(42);
    expect(db.get).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.run).toHaveBeenCalledTimes(3);
    expect(db.run).toHaveBeenNthCalledWith(1, expect.stringMatching(/WHERE id = \? AND trip_id = \?/), input.name, 48, 11, JSON.stringify(input.route_geometry), '42', '7');
    expect(db.prepare).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('INSERT INTO tour_waypoints'));
    expect(waypointRun).toHaveBeenCalledTimes(2);
    for (const waypoint of input.waypoints) {
      expect(waypointRun).toHaveBeenCalledWith('42', waypoint.lat, waypoint.lng, waypoint.role, waypoint.sequence);
    }
    expect(db.getPlaceWithTags).toHaveBeenCalledWith(42);
    expect(places.broadcast).toHaveBeenCalledWith('7', 'place:updated', { place: { id: 42, trip_id: 7 } }, 'socket');
    expect(DatabaseService).not.toHaveBeenCalled();
  });
});