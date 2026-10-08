/**
 * Sessions e2e: session tokens that can be ended before they expire.
 *
 * Boots AuthModule (which brings SessionsModule) against the snapshot schema,
 * with the real JwtAuthGuard, the real cookie service and the real
 * renewal interceptor, then drives the flows a browser would: sign in on two
 * devices, list the sessions, end one, end the others, log out, change the
 * password. A token from before sessions were tracked (the harness's
 * `sessionCookie`, which carries no `jti`) must keep working throughout.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import { sessionCookie } from './harness';

vi.mock('../../src/db/database', async () => {
  const { createSnapshotTestDb } = await import('../helpers/db-mock');
  const db = createSnapshotTestDb();
  return {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: () => undefined,
    isOwner: () => false,
  };
});

vi.mock('../../src/websocket', () => ({ broadcastToUser: vi.fn(), broadcast: vi.fn() }));
vi.mock('../../src/nest/audit/audit-log.logger', () => ({ LOG_LEVEL: 'error', logInfo: vi.fn(), logDebug: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

import { MailerService } from '../../src/nest/notifications/mailer/mailer.service';
import { db } from '../../src/db/database';
import { createUser } from '../helpers/factories';
import { resetRateLimits } from '../helpers/test-db';
import { AuthModule } from '../../src/nest/auth/auth.module';
import { SessionsService } from '../../src/nest/sessions/sessions.service';
import { SessionRenewalInterceptor } from '../../src/nest/auth/session-renewal.interceptor';
import { TrekExceptionFilter } from '../../src/nest/common/trek-exception.filter';
import { ZodValidationPipe } from '../../src/nest/common/zod-validation.pipe';
import { TestUnitOfWorkModule } from '../helpers/test-uow';
import { createTestMikroOrmModule } from '../helpers/test-orm';

describe('Sessions e2e (sign-in sessions that can be ended)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;

  async function build() {
    const moduleRef = await Test.createTestingModule({
      imports: [await TestUnitOfWorkModule.forRoot(db), await createTestMikroOrmModule(db), AuthModule],
    })
      .overrideProvider(MailerService)
      .useValue({ sendPasswordResetEmail: vi.fn().mockResolvedValue({ delivered: 'email' }) })
      .compile();
    const nest = moduleRef.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalFilters(new TrekExceptionFilter());
    nest.useGlobalPipes(new ZodValidationPipe());
    nest.useGlobalInterceptors(new SessionRenewalInterceptor(moduleRef.get(SessionsService)));
    await nest.init();
    return nest;
  }

  beforeAll(async () => {
    app = await build();
    server = app.getHttpServer();
  });

  beforeEach(() => resetRateLimits(app));

  afterAll(async () => {
    await app.close();
  });

  /** Sign in as the user from a device; returns the `trek_session=…` cookie pair. */
  async function signIn(email: string, password: string, device: string): Promise<string> {
    const res = await request(server).post('/api/auth/login').set('User-Agent', device).send({ email, password });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('trek_session='))!;
    return /^(trek_session=[^;]+)/.exec(cookie)![1];
  }

  const sessionIdOf = (cookie: string) => (jwt.decode(cookie.slice('trek_session='.length)) as { jti: string }).jti;
  const me = (cookie: string) => request(server).get('/api/auth/me').set('Cookie', cookie);

  function freshUser(name: string) {
    return createUser(db as never, { username: name, email: `${name}@example.test` });
  }

  it('a login is listed as the current session, with its device', async () => {
    const { user, password } = freshUser('sess-list');
    const laptop = await signIn(user.email, password, 'Laptop Browser');
    const phone = await signIn(user.email, password, 'Phone Browser');

    const res = await request(server).get('/api/auth/sessions').set('Cookie', laptop);
    expect(res.status).toBe(200);
    expect(res.body.current_tracked).toBe(true);
    const byId = Object.fromEntries((res.body.sessions as { id: string; user_agent: string; current: boolean }[]).map((s) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual([sessionIdOf(laptop), sessionIdOf(phone)].sort());
    expect(byId[sessionIdOf(laptop)]).toEqual(expect.objectContaining({ user_agent: 'Laptop Browser', current: true }));
    expect(byId[sessionIdOf(phone)]).toEqual(expect.objectContaining({ user_agent: 'Phone Browser', current: false }));
  }, 15000);

  it('the session routes need a session', async () => {
    expect((await request(server).get('/api/auth/sessions')).status).toBe(401);
    expect((await request(server).post('/api/auth/sessions/revoke-others')).status).toBe(401);
  });

  it('logout ends the session itself, so a copy of the cookie stops working', async () => {
    const { user, password } = freshUser('sess-logout');
    const cookie = await signIn(user.email, password, 'Browser');
    expect((await me(cookie)).status).toBe(200);

    const out = await request(server).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true });

    expect((await me(cookie)).status).toBe(401);
  }, 10000);

  it('ending another session signs that device out and leaves this one signed in', async () => {
    const { user, password } = freshUser('sess-revoke-one');
    const laptop = await signIn(user.email, password, 'Laptop');
    const phone = await signIn(user.email, password, 'Phone');

    const res = await request(server).delete(`/api/auth/sessions/${sessionIdOf(phone)}`).set('Cookie', laptop);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(((res.headers['set-cookie'] ?? []) as unknown as string[]).some((c) => c.startsWith('trek_session='))).toBe(false);

    expect((await me(phone)).status).toBe(401);
    expect((await me(laptop)).status).toBe(200);
    // Ended already: the same id now answers like one that never existed.
    expect((await request(server).delete(`/api/auth/sessions/${sessionIdOf(phone)}`).set('Cookie', laptop)).status).toBe(404);
  }, 15000);

  it('ending the current session is a logout: the cookie is cleared and stops working', async () => {
    const { user, password } = freshUser('sess-revoke-self');
    const cookie = await signIn(user.email, password, 'Browser');

    const res = await request(server).delete(`/api/auth/sessions/${sessionIdOf(cookie)}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(((res.headers['set-cookie'] ?? []) as unknown as string[]).some((c) => c.startsWith('trek_session=;'))).toBe(true);
    expect((await me(cookie)).status).toBe(401);
  }, 10000);

  it('another user\'s session id answers 404 and stays signed in; a malformed id answers 400', async () => {
    const owner = freshUser('sess-owner');
    const intruder = freshUser('sess-intruder');
    const ownerCookie = await signIn(owner.user.email, owner.password, 'Owner');
    const intruderCookie = await signIn(intruder.user.email, intruder.password, 'Intruder');

    const res = await request(server).delete(`/api/auth/sessions/${sessionIdOf(ownerCookie)}`).set('Cookie', intruderCookie);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
    expect((await me(ownerCookie)).status).toBe(200);

    const bad = await request(server).delete('/api/auth/sessions/not-a-session').set('Cookie', intruderCookie);
    expect(bad.status).toBe(400);
  }, 15000);

  it('signing out the other sessions keeps only this one', async () => {
    const { user, password } = freshUser('sess-others');
    const here = await signIn(user.email, password, 'Here');
    const there = await signIn(user.email, password, 'There');
    const elsewhere = await signIn(user.email, password, 'Elsewhere');

    const res = await request(server).post('/api/auth/sessions/revoke-others').set('Cookie', here);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, revoked: 2 });

    expect((await me(here)).status).toBe(200);
    expect((await me(there)).status).toBe(401);
    expect((await me(elsewhere)).status).toBe(401);
    const list = await request(server).get('/api/auth/sessions').set('Cookie', here);
    expect((list.body.sessions as { id: string }[]).map((s) => s.id)).toEqual([sessionIdOf(here)]);
  }, 20000);

  it('a password change ends every other session; the re-issued cookie is a new session', async () => {
    const { user, password } = freshUser('sess-password');
    const here = await signIn(user.email, password, 'Here');
    const there = await signIn(user.email, password, 'There');

    const change = await request(server)
      .put('/api/auth/me/password')
      .set('Cookie', here)
      .set('User-Agent', 'Here')
      .send({ current_password: password, new_password: 'New1234!x' });
    expect(change.status).toBe(200);
    const reissued = ((change.headers['set-cookie'] ?? []) as unknown as string[]).filter((c) => c.startsWith('trek_session=')).pop()!;
    const next = /^(trek_session=[^;]+)/.exec(reissued)![1];

    expect((await me(there)).status).toBe(401);
    expect((await me(here)).status).toBe(401);
    expect((await me(next)).status).toBe(200);
    const list = await request(server).get('/api/auth/sessions').set('Cookie', next);
    expect(list.body.sessions).toEqual([expect.objectContaining({ id: sessionIdOf(next), user_agent: 'Here', current: true })]);
  }, 15000);

  it('a token from before sessions were tracked keeps working, is listed as untracked, and survives "sign out others"', async () => {
    const { user, password } = freshUser('sess-legacy');
    const legacy = sessionCookie(user.id);
    const tracked = await signIn(user.email, password, 'Tracked');

    const list = await request(server).get('/api/auth/sessions').set('Cookie', legacy);
    expect(list.status).toBe(200);
    expect(list.body.current_tracked).toBe(false);
    expect((list.body.sessions as { current: boolean }[]).every((s) => !s.current)).toBe(true);

    const res = await request(server).post('/api/auth/sessions/revoke-others').set('Cookie', legacy);
    expect(res.body).toEqual({ success: true, revoked: 1 });
    expect((await me(tracked)).status).toBe(401);
    expect((await me(legacy)).status).toBe(200);
  }, 10000);

  it('sliding renewal keeps the session id, and a renewed token from before tracking becomes a session', async () => {
    const { user } = freshUser('sess-renew');
    const old = sessionCookie(user.id, 0, { lifetime: 86400, consumed: 60000 });

    const first = await request(server).get('/api/auth/me').set('Cookie', old).set('User-Agent', 'Renewed');
    expect(first.status).toBe(200);
    const renewedCookie = ((first.headers['set-cookie'] ?? []) as unknown as string[]).find((c) => c.startsWith('trek_session='))!;
    const renewed = /^(trek_session=[^;]+)/.exec(renewedCookie)![1];

    const list = await request(server).get('/api/auth/sessions').set('Cookie', renewed);
    expect(list.body.current_tracked).toBe(true);
    expect(list.body.sessions).toEqual([expect.objectContaining({ id: sessionIdOf(renewed), user_agent: 'Renewed', current: true })]);
  }, 10000);

  it("on a demo instance, visitors of the shared demo account neither see nor end each other's sessions", async () => {
    createUser(db as never, { username: 'demo', email: 'demo@trek.app' });
    vi.stubEnv('DEMO_MODE', 'true');
    try {
      const visit = async (device: string) => {
        const res = await request(server).post('/api/auth/demo-login').set('User-Agent', device);
        expect(res.status).toBe(200);
        const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('trek_session='))!;
        return /^(trek_session=[^;]+)/.exec(cookie)![1];
      };
      const first = await visit('First visitor');
      const second = await visit('Second visitor');

      const list = await request(server).get('/api/auth/sessions').set('Cookie', first);
      expect(list.status).toBe(200);
      expect(list.body.sessions).toEqual([expect.objectContaining({ id: sessionIdOf(first), user_agent: 'First visitor', current: true })]);

      const one = await request(server).delete(`/api/auth/sessions/${sessionIdOf(second)}`).set('Cookie', first);
      expect(one.status).toBe(403);
      expect(one.body).toEqual({ error: 'Sessions cannot be ended in demo mode.' });
      const others = await request(server).post('/api/auth/sessions/revoke-others').set('Cookie', first);
      expect(others.status).toBe(403);
      expect(others.body).toEqual({ error: 'Sessions cannot be ended in demo mode.' });

      expect((await me(second)).status).toBe(200);
      expect((await me(first)).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 15000);
});
