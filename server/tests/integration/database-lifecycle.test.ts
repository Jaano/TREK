import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { buildApp } from '../../src/bootstrap';
import { DatabaseLifecycle } from '../../src/nest/database/database-lifecycle.service';

/**
 * The core database's lifecycle, owned by the DatabaseLifecycle provider, on a
 * real boot.
 *
 * The connection used to open as a side effect of importing db/database.ts and
 * was closed and reopened through module functions the restore and the demo
 * reset called directly. buildApp() now opens it through the provider, which
 * also binds the ORM to later swaps, and closes and reopens it through the
 * same provider. Unmocked on purpose: under NODE_ENV=test the
 * module opens a copy of the migrated schema snapshot, and every reopen opens a
 * pristine copy again, which is all these cases need.
 */
describe('the database connection lifecycle under buildApp()', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('LIFECYCLE-001: the boot opened the connection through the provider and the database answers', async () => {
    expect(app.get(DatabaseLifecycle).file).toBe(':memory:');

    const res = await request(app.getHttpServer()).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('LIFECYCLE-002: closed, the readiness probe answers 503; reopened, the ORM is bound to the new handle and it answers again', async () => {
    const lifecycle = app.get(DatabaseLifecycle);

    lifecycle.close();
    try {
      const down = await request(app.getHttpServer()).get('/api/health/ready');
      expect(down.status).toBe(503);
      expect(down.body).toEqual({ status: 'unavailable' });
    } finally {
      await lifecycle.reopen();
    }

    const up = await request(app.getHttpServer()).get('/api/health/ready');
    expect(up.status).toBe(200);
  });
});
