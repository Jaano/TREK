import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { db } from '../../../src/db/database';
import { AppModule } from '../../../src/nest/app.module';
import { FeaturesController } from '../../../src/nest/health/features.controller';
import { DatabaseService } from '../../../src/nest/database/database.service';
import { AdminGuard } from '../../../src/nest/auth/admin.guard';

vi.mock('../../../src/config', async () => {
  const { readEnv } = await import('../../../src/app-config');
  const env = readEnv();
  return {
    ENCRYPTION_KEY: 'wiring-test-inert-encryption-key',
    JWT_SECRET: 'wiring-test-inert-jwt-secret',
    updateJwtSecret: vi.fn(),
    DEFAULT_LANGUAGE: env.app.defaultLanguage,
    SESSION_DURATION: env.session.duration,
    SESSION_DURATION_MS: env.session.durationMs,
    SESSION_DURATION_SECONDS: env.session.durationSeconds,
    SESSION_DURATION_REMEMBER: env.session.durationRemember,
    SESSION_DURATION_REMEMBER_MS: env.session.durationRememberMs,
    SESSION_DURATION_REMEMBER_SECONDS: env.session.durationRememberSeconds,
  };
});

function ctx(user: unknown) {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as never;
}

describe('AppModule wiring', () => {
  it('registers the pinned upstream module union and Tours exactly once', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as Array<Function | { module: Function }>;
    const names = imports.map(entry => (typeof entry === 'function' ? entry : entry.module).name);
    expect(names).toHaveLength(68);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      'GoogleQuotaModule', 'ReceiptScanModule', 'SchoolHolidaysModule', 'DocSyncModule',
      'DawarichModule', 'NotificationsModule', 'ToursModule',
    ]));
    expect(names.filter(name => name === 'ToursModule')).toHaveLength(1);
  });

  it('compiles with the global filter + DB provider and resolves the controller', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ get: () => ({ n: 0 }) })
      .compile();
    // The one test that builds the whole AppModule: resolving a controller out of
    // it proves every module in the graph compiled, not just this one.
    expect(moduleRef.get(FeaturesController)).toBeInstanceOf(FeaturesController);
  });
});

describe('AdminGuard', () => {
  const guard = new AdminGuard();
  it('allows admins', () => {
    expect(guard.canActivate(ctx({ role: 'admin' }))).toBe(true);
  });
  it('blocks non-admins and anonymous with 403 { error }', () => {
    expect(() => guard.canActivate(ctx({ role: 'user' }))).toThrow(HttpException);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(HttpException);
  });
});

describe('DatabaseService (shared connection)', () => {
  it('runs real queries against the existing SQLite connection', () => {
    const svc = new DatabaseService(db);
    expect(svc.get('SELECT 1 AS one')).toEqual({ one: 1 });
    expect(svc.all('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });
});
