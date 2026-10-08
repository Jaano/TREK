/**
 * The process-local state behind injectable ports: the rate-limit counters,
 * the OAuth pending codes, the OIDC login states and codes, the permissions
 * cache and the WebSocket rooms. Each has an in-memory implementation that
 * behaves exactly as the state did before, is provided by its module, and is
 * what a hand-built consumer falls back to; a shared store can replace it in
 * the module. PORTS-001 through PORTS-014.
 */
import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { RateLimitModule } from '../../../src/nest/common/rate-limit.module';
import { RateLimitService } from '../../../src/nest/common/rate-limit.service';
import { InMemoryRateLimitStore, RateLimitStore } from '../../../src/nest/common/rate-limit.store';
import {
  InMemoryPendingCodeStore,
  MAX_PENDING_CODES,
  PendingCodeStore,
  processPendingCodes,
  type PendingCode,
} from '../../../src/nest/oauth/oauth.pending-codes';
import { OauthService } from '../../../src/nest/oauth/oauth.service';
import { InMemoryOidcFlowStore, OidcFlowStore } from '../../../src/nest/oidc/oidc-flow.store';
import { OidcModule } from '../../../src/nest/oidc/oidc.module';
import {
  InMemoryPermissionsCacheStore,
  PermissionsCacheStore,
  invalidatePermissionsCache,
  processPermissionsCache,
} from '../../../src/nest/permissions/permissions-cache';
import { PermissionsModule } from '../../../src/nest/permissions/permissions.module';
import { PermissionsService } from '../../../src/nest/permissions/permissions.service';
import { InMemoryRoomRegistry, RoomRegistry, processRooms, type TrekWebSocket } from '../../../src/nest/realtime/ws-state';
import { RealtimeGatewayModule } from '../../../src/nest/realtime/realtime-gateway.module';
import { expectRegisteredProvider } from '../../helpers/module-providers';

const WINDOW = 60_000;

function code(over: Partial<PendingCode> = {}): PendingCode {
  return {
    clientId: 'c',
    userId: 1,
    redirectUri: 'https://app.example/cb',
    scopes: ['trips:read'],
    resource: null,
    codeChallenge: 'x',
    codeChallengeMethod: 'S256',
    expiresAt: Date.now() + 60_000,
    ...over,
  };
}

describe('rate limits', () => {
  it('PORTS-001: RateLimitService counts through the store it is given', () => {
    const store = { hit: vi.fn(() => false), reset: vi.fn() } as unknown as RateLimitStore;
    const service = new RateLimitService(store);
    expect(service.check('login', '1.2.3.4', 5, WINDOW, 1_000)).toBe(false);
    expect(store.hit).toHaveBeenCalledWith('login', '1.2.3.4', 5, WINDOW, 1_000);
    service.reset('login');
    expect(store.reset).toHaveBeenCalledWith('login');
  });

  it('PORTS-002: RateLimitModule provides the in-memory store, and the service gets it', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [RateLimitModule] }).compile();
    try {
      const service = moduleRef.get(RateLimitService);
      expect((service as unknown as { store: unknown }).store).toBeInstanceOf(InMemoryRateLimitStore);
      for (let i = 0; i < 3; i++) expect(service.check('mfa', 'k', 3, WINDOW, 1_000)).toBe(true);
      expect(service.check('mfa', 'k', 3, WINDOW, 1_000)).toBe(false);
    } finally {
      await moduleRef.close();
    }
  });

  it('PORTS-003: two hand-built services keep their own counters, as before', () => {
    const a = new RateLimitService();
    const b = new RateLimitService();
    a.check('login', 'k', 1, WINDOW, 1_000);
    expect(a.check('login', 'k', 1, WINDOW, 1_000)).toBe(false);
    expect(b.check('login', 'k', 1, WINDOW, 1_000)).toBe(true);
  });
});

describe('OAuth pending codes', () => {
  it('PORTS-004: a code is single use, and an expired one is burnt and refused', () => {
    const store = new InMemoryPendingCodeStore();
    expect(store.put('a', code())).toBe(true);
    expect(store.take('a')?.clientId).toBe('c');
    expect(store.take('a')).toBeNull();
    store.put('old', code({ expiresAt: Date.now() - 1 }));
    expect(store.take('old')).toBeNull();
  });

  it('PORTS-005: the store refuses past its capacity and the sweep frees expired entries', () => {
    const store = new InMemoryPendingCodeStore();
    for (let i = 0; i < MAX_PENDING_CODES; i++) store.put(`c${i}`, code({ expiresAt: 10 }));
    expect(store.put('one-more', code())).toBe(false);
    store.sweep(11);
    expect(store.put('one-more', code())).toBe(true);
  });

  it('PORTS-006: OauthService issues and redeems codes through the injected store', () => {
    const store = new InMemoryPendingCodeStore();
    const service = new OauthService({} as never, {} as never, {} as never, {} as never, {} as never, store);
    const issued = service.createAuthCode({
      clientId: 'c',
      userId: 1,
      redirectUri: 'https://app.example/cb',
      scopes: [],
      resource: null,
      codeChallenge: 'x',
      codeChallengeMethod: 'S256',
    });
    expect(issued).toMatch(/^[0-9a-f]{64}$/);
    expect(processPendingCodes.take(issued!)).toBeNull();
    expect(service.consumeAuthCode(issued!)?.clientId).toBe('c');
  });

  it('PORTS-007: OauthModule provides the process-wide store, the one a hand-built service defaults to', async () => {
    const { OauthModule } = await import('../../../src/nest/oauth/oauth.module');
    expectRegisteredProvider(OauthModule, { provide: PendingCodeStore, useValue: processPendingCodes });
    const service = new OauthService({} as never, {} as never, {} as never, {} as never, {} as never);
    expect((service as unknown as { pendingCodes: unknown }).pendingCodes).toBe(processPendingCodes);
  });
});

describe('OIDC login states and codes', () => {
  it('PORTS-008: states and codes are single use', () => {
    const store = new InMemoryOidcFlowStore();
    store.putState('s', { createdAt: 1, redirectUri: '/', codeVerifier: 'v' });
    expect(store.takeState('s')?.codeVerifier).toBe('v');
    expect(store.takeState('s')).toBeNull();
    store.putCode('c', { token: 't', created: 1, bindingHash: 'h' });
    expect(store.takeCode('c')?.token).toBe('t');
    expect(store.takeCode('c')).toBeNull();
  });

  it('PORTS-009: the sweeps drop only what is past its TTL', () => {
    const store = new InMemoryOidcFlowStore();
    store.putState('old', { createdAt: 0, redirectUri: '/', codeVerifier: 'v' });
    store.putState('new', { createdAt: 900, redirectUri: '/', codeVerifier: 'v' });
    store.putCode('old', { token: 't', created: 0, bindingHash: 'h' });
    store.putCode('new', { token: 't', created: 900, bindingHash: 'h' });
    store.sweepStates(1_000, 500);
    store.sweepCodes(1_000, 500);
    expect(store.takeState('old')).toBeNull();
    expect(store.takeState('new')).not.toBeNull();
    expect(store.takeCode('old')).toBeNull();
    expect(store.takeCode('new')).not.toBeNull();
  });

  it('PORTS-010: OidcModule provides the in-memory store', () => {
    expectRegisteredProvider(OidcModule, { provide: OidcFlowStore, useClass: InMemoryOidcFlowStore });
  });
});

describe('the permissions cache', () => {
  it('PORTS-011: PermissionsService reads, fills and drops the cache through the store it is given', async () => {
    const store = new InMemoryPermissionsCacheStore();
    const appSettings = { findByKeyPrefix: vi.fn(async () => [{ key: 'perm_trip_create', value: 'admin' }]) };
    const service = new PermissionsService(appSettings as never, {} as never, store);
    expect(await service.getPermissionLevel('trip_create')).toBe('admin');
    expect(store.get()?.get('trip_create')).toBe('admin');
    await service.getPermissionLevel('trip_create');
    expect(appSettings.findByKeyPrefix).toHaveBeenCalledTimes(1);
    service.invalidatePermissionsCache();
    expect(store.get()).toBeNull();
  });

  it('PORTS-012: the module, a hand-built service and the restore path share the process-wide store', () => {
    expectRegisteredProvider(PermissionsModule, { provide: PermissionsCacheStore, useValue: processPermissionsCache });
    const service = new PermissionsService({} as never, {} as never);
    expect((service as unknown as { cacheStore: unknown }).cacheStore).toBe(processPermissionsCache);
    processPermissionsCache.set(new Map([['trip_create', 'admin']]));
    invalidatePermissionsCache();
    expect(processPermissionsCache.get()).toBeNull();
  });
});

describe('the WebSocket rooms', () => {
  const socket = () => ({}) as TrekWebSocket;

  it('PORTS-013: joins, leaves and per-socket bookkeeping behave as the module maps did', () => {
    const rooms = new InMemoryRoomRegistry();
    const a = socket();
    const b = socket();
    rooms.register(a);
    rooms.register(b);
    rooms.join(a, 1);
    rooms.join(b, 1);
    rooms.join(a, 2);
    expect([...rooms.members(1)!]).toEqual([a, b]);
    rooms.leaveAll(a);
    expect([...rooms.members(1)!]).toEqual([b]);
    expect(rooms.members(2)).toBeUndefined();
    rooms.joinBook(a, 7);
    rooms.joinBook(a, 8);
    expect(rooms.leaveAllBooks(a)).toEqual([7, 8]);
    expect(rooms.bookMembers(7)).toBeUndefined();
  });

  it('PORTS-014: RealtimeGatewayModule provides the process-wide registry the broadcasts read', () => {
    expectRegisteredProvider(RealtimeGatewayModule, { provide: RoomRegistry, useValue: processRooms });
  });
});
