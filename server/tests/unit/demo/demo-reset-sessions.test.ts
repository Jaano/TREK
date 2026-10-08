/**
 * The hourly demo reset keeps everybody signed in.
 *
 * The reset copies the baseline over the live database file. That baseline
 * was saved at first seed, before anybody logged in, so it holds no
 * `user_sessions` rows, and a session token whose row is gone is refused.
 * Without carrying the active rows across the swap, every demo visitor and
 * the demo admin would get a 401 on the hour.
 *
 * The connection lifecycle is stubbed the way demo-reset-path.test.ts stubs
 * it, and the stubbed `reinitialize()` stands in for the file swap by
 * emptying `user_sessions`, which is exactly what the baseline brings back.
 * The reads and writes around it run for real against the snapshot schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createSnapshotTestDb } from '../../helpers/db-mock';
import { createTestOrm, type TestOrm } from '../../helpers/test-orm';
import { createUser } from '../../helpers/factories';
import { withRequestContext } from '../../../src/nest/database/request-context';

const LIVE_DB = path.join(path.sep, 'srv', 'trek', 'travel.db');

const { handleStub, swap, databaseModule } = vi.hoisted(() => {
  const handleStub = { name: '' };
  const swap: { run: () => void } = { run: () => undefined };
  return {
    handleStub,
    swap,
    databaseModule: {
      getRawConnection: () => handleStub,
      closeDb: vi.fn(),
      reinitialize: vi.fn(async () => {
        swap.run();
      }),
    },
  };
});
vi.mock('../../../src/db/database', () => databaseModule);

const BASELINE = path.resolve(__dirname, '..', '..', '..', 'data', 'travel-baseline.db');

import { resetDemoUser } from '../../../src/demo/demo-reset';
import { SessionsService } from '../../../src/nest/sessions/sessions.service';
import { verifyJwtAndLoadUser } from '../../../src/nest/auth/jwt-verify';
import { Users } from '../../../src/db/entities/Users.entity';
import { UserSessions } from '../../../src/db/entities/UserSessions.entity';

describe('demo reset and the signed-in sessions', () => {
  let ormDb: Database.Database;
  let t: TestOrm;

  beforeEach(async () => {
    handleStub.name = LIVE_DB;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    ormDb = createSnapshotTestDb();
    t = await createTestOrm(ormDb);
    swap.run = () => {
      ormDb.exec('DELETE FROM user_sessions');
    };
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'existsSync').mockImplementation(((p: fs.PathLike) => String(p) === BASELINE) as typeof fs.existsSync);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await t.close();
    ormDb.close();
  });

  const verify = (token: string) => verifyJwtAndLoadUser(token, t.repo(Users), t.repo(UserSessions));

  it('DEMORESET-SESS-001: a session signed in before the reset still authenticates after it', async () => {
    const { user } = createUser(ormDb, { email: 'demo-visitor@example.test' });
    const sessions = new SessionsService(t.repo(UserSessions));
    const token = await sessions.issue({ id: user.id, pv: 0 }, undefined, { userAgent: 'Visitor' });
    expect((await verify(token))?.id).toBe(user.id);

    await withRequestContext(t.orm, () => resetDemoUser());
    t.clear();

    expect(databaseModule.reinitialize).toHaveBeenCalled();
    expect((await verify(token))?.id).toBe(user.id);
    expect(ormDb.prepare('SELECT user_id, user_agent, revoked_at FROM user_sessions').all()).toEqual([
      { user_id: user.id, user_agent: 'Visitor', revoked_at: null },
    ]);
  });

  it('DEMORESET-SESS-002: a session that had already ended stays ended', async () => {
    const { user } = createUser(ormDb, { email: 'demo-ended@example.test' });
    const sessions = new SessionsService(t.repo(UserSessions));
    const token = await sessions.issue({ id: user.id, pv: 0 });
    await sessions.revokeAll(user.id);

    await withRequestContext(t.orm, () => resetDemoUser());
    t.clear();

    expect(await verify(token)).toBeNull();
    expect(ormDb.prepare('SELECT COUNT(*) AS n FROM user_sessions').get()).toEqual({ n: 0 });
  });

  it('DEMORESET-SESS-003: a session whose account the baseline does not hold is not brought back', async () => {
    const { user } = createUser(ormDb, { email: 'registered-after-seed@example.test' });
    const sessions = new SessionsService(t.repo(UserSessions));
    const token = await sessions.issue({ id: user.id, pv: 0 });
    swap.run = () => {
      ormDb.exec('DELETE FROM user_sessions');
      ormDb.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    };

    await withRequestContext(t.orm, () => resetDemoUser());
    t.clear();

    expect(await verify(token)).toBeNull();
    expect(ormDb.prepare('SELECT COUNT(*) AS n FROM user_sessions').get()).toEqual({ n: 0 });
  });
});
