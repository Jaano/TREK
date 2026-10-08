import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSnapshotTestDb } from '../../../helpers/db-mock';
import { resetTestDb } from '../../../helpers/test-db';
import { createTestOrm, type TestOrm } from '../../../helpers/test-orm';
import { createUser } from '../../../helpers/factories';
import { UserSessions } from '../../../../src/db/entities/UserSessions.entity';
import type { UserSessionsRepository } from '../../../../src/db/repositories/UserSessions.repository';

const testDb = createSnapshotTestDb();
let t: TestOrm;
let sessions: UserSessionsRepository;

const NOW = '2026-10-08 12:00:00';
const LATER = '2026-11-07 12:00:00';
const EARLIER = '2026-10-01 12:00:00';

beforeAll(async () => {
  t = await createTestOrm(testDb);
  sessions = t.repo(UserSessions);
});
beforeEach(() => { resetTestDb(testDb); t.clear(); });
afterAll(async () => { await t.close(); testDb.close(); });

function row(id: string) {
  return testDb.prepare('SELECT * FROM user_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

async function add(id: string, userId: number, overrides: { created_at?: string; expires_at?: string; user_agent?: string | null } = {}) {
  await sessions.insertSession({
    id,
    user_id: userId,
    created_at: overrides.created_at ?? EARLIER,
    expires_at: overrides.expires_at ?? LATER,
    user_agent: overrides.user_agent ?? null,
  });
}

describe('UserSessionsRepository', () => {
  it('SESSREPO-001: insert writes the row, last_seen_at starting at created_at', async () => {
    const { user } = createUser(testDb);
    await add('s1', user.id, { user_agent: 'Firefox' });
    expect(row('s1')).toStrictEqual({
      id: 's1',
      user_id: user.id,
      created_at: EARLIER,
      last_seen_at: EARLIER,
      expires_at: LATER,
      revoked_at: null,
      user_agent: 'Firefox',
    });
  });

  it('SESSREPO-002: findActive matches only an unrevoked, unexpired session of that user', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    await add('live', user.id);
    await add('expired', user.id, { expires_at: NOW });
    await add('revoked', user.id);
    testDb.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = 'revoked'").run(EARLIER);

    expect(await sessions.findActive('live', user.id, NOW)).toEqual({ id: 'live', last_seen_at: EARLIER });
    expect(await sessions.findActive('live', other.id, NOW)).toBeNull();
    expect(await sessions.findActive('expired', user.id, NOW)).toBeNull();
    expect(await sessions.findActive('revoked', user.id, NOW)).toBeNull();
    expect(await sessions.findActive('missing', user.id, NOW)).toBeNull();
  });

  it('SESSREPO-003: touchLastSeen moves last_seen_at only', async () => {
    const { user } = createUser(testDb);
    await add('s1', user.id);
    await sessions.touchLastSeen('s1', NOW);
    expect(row('s1')).toEqual(expect.objectContaining({ last_seen_at: NOW, created_at: EARLIER, expires_at: LATER }));
  });

  it('SESSREPO-004: extendActive moves the expiry of an active session and refuses an ended one', async () => {
    const { user } = createUser(testDb);
    await add('live', user.id);
    await add('revoked', user.id);
    testDb.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = 'revoked'").run(EARLIER);

    expect(await sessions.extendActive('live', user.id, NOW, '2026-12-01 00:00:00')).toBe(true);
    expect(row('live')).toEqual(expect.objectContaining({ expires_at: '2026-12-01 00:00:00', last_seen_at: NOW }));
    expect(await sessions.extendActive('revoked', user.id, NOW, '2026-12-01 00:00:00')).toBe(false);
    expect(row('revoked')).toEqual(expect.objectContaining({ expires_at: LATER }));
  });

  it('SESSREPO-005: listActiveForUser lists the active sessions, most recently seen first', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    await add('older', user.id, { user_agent: 'A' });
    await add('newer', user.id, { user_agent: 'B' });
    await add('ended', user.id);
    await add('theirs', other.id);
    await sessions.touchLastSeen('newer', NOW);
    testDb.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = 'ended'").run(EARLIER);

    expect(await sessions.listActiveForUser(user.id, NOW)).toEqual([
      { id: 'newer', created_at: EARLIER, last_seen_at: NOW, expires_at: LATER, user_agent: 'B' },
      { id: 'older', created_at: EARLIER, last_seen_at: EARLIER, expires_at: LATER, user_agent: 'A' },
    ]);
  });

  it('SESSREPO-006: revokeForUser ends one session of that user, once', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    await add('s1', user.id);

    expect(await sessions.revokeForUser('s1', other.id, NOW)).toBe(false);
    expect(row('s1')).toEqual(expect.objectContaining({ revoked_at: null }));
    expect(await sessions.revokeForUser('s1', user.id, NOW)).toBe(true);
    expect(row('s1')).toEqual(expect.objectContaining({ revoked_at: NOW }));
    expect(await sessions.revokeForUser('s1', user.id, NOW)).toBe(false);
  });

  it('SESSREPO-007: revokeAllForUser ends every session of the user, or all but one', async () => {
    const { user } = createUser(testDb);
    const { user: other } = createUser(testDb);
    await add('a', user.id);
    await add('b', user.id);
    await add('c', user.id);
    await add('theirs', other.id);

    expect(await sessions.revokeAllForUser(user.id, NOW, 'b')).toBe(2);
    expect(row('b')).toEqual(expect.objectContaining({ revoked_at: null }));
    expect(await sessions.revokeAllForUser(user.id, NOW)).toBe(1);
    expect(row('a')).toEqual(expect.objectContaining({ revoked_at: NOW }));
    expect(row('theirs')).toEqual(expect.objectContaining({ revoked_at: null }));
  });

  it('SESSREPO-008: deleteInactive removes the expired and the revoked rows and keeps the live ones', async () => {
    const { user } = createUser(testDb);
    await add('live', user.id);
    await add('expired', user.id, { expires_at: NOW });
    await add('revoked', user.id);
    testDb.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = 'revoked'").run(EARLIER);

    expect(await sessions.deleteInactive(NOW)).toBe(2);
    expect(row('live')).toBeDefined();
    expect(row('expired')).toBeUndefined();
    expect(row('revoked')).toBeUndefined();
  });

  it('SESSREPO-009: the rows go with their user', async () => {
    const { user } = createUser(testDb);
    await add('s1', user.id);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    expect(row('s1')).toBeUndefined();
  });

  it('SESSREPO-010: listActiveToCarry reads every active session with the email of its owner', async () => {
    const { user } = createUser(testDb, { email: 'carry-a@example.test' });
    const { user: other } = createUser(testDb, { email: 'carry-b@example.test' });
    await add('a1', user.id, { user_agent: 'A' });
    await add('b1', other.id);
    await add('expired', user.id, { expires_at: NOW });
    await add('revoked', other.id);
    testDb.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = 'revoked'").run(EARLIER);

    expect(await sessions.listActiveToCarry(NOW)).toEqual([
      { id: 'a1', user_id: user.id, email: 'carry-a@example.test', created_at: EARLIER, last_seen_at: EARLIER, expires_at: LATER, user_agent: 'A' },
      { id: 'b1', user_id: other.id, email: 'carry-b@example.test', created_at: EARLIER, last_seen_at: EARLIER, expires_at: LATER, user_agent: null },
    ]);
    expect(await sessions.listActiveToCarry(LATER)).toEqual([]);
  });

  it('SESSREPO-011: restoreCarried puts the rows back for the same account only, and keeps a row already there', async () => {
    const { user } = createUser(testDb, { email: 'kept@example.test' });
    const { user: renamed } = createUser(testDb, { email: 'renamed@example.test' });
    await add('kept', user.id, { user_agent: 'Kept' });
    await add('present', user.id);
    await add('elsewhere', renamed.id);
    const carried = await sessions.listActiveToCarry(NOW);

    // What a swap does: the rows are gone (or ended), and one id now names somebody else.
    testDb.prepare("DELETE FROM user_sessions WHERE id IN ('kept', 'elsewhere')").run();
    testDb.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = 'present'").run(EARLIER);
    testDb.prepare("UPDATE users SET email = 'someone-else@example.test' WHERE id = ?").run(renamed.id);
    t.clear();

    expect(await sessions.restoreCarried(carried)).toBe(2);
    expect(row('kept')).toStrictEqual({
      id: 'kept',
      user_id: user.id,
      created_at: EARLIER,
      last_seen_at: EARLIER,
      expires_at: LATER,
      revoked_at: null,
      user_agent: 'Kept',
    });
    // The swapped-in file's own row wins, ended or not.
    expect(row('present')).toEqual(expect.objectContaining({ revoked_at: EARLIER }));
    expect(row('elsewhere')).toBeUndefined();
  });

  it('SESSREPO-012: restoreCarried drops a session whose user is gone, and does nothing for none', async () => {
    const { user } = createUser(testDb, { email: 'gone@example.test' });
    await add('orphan', user.id);
    const carried = await sessions.listActiveToCarry(NOW);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    t.clear();

    expect(await sessions.restoreCarried(carried)).toBe(0);
    expect(row('orphan')).toBeUndefined();
    expect(await sessions.restoreCarried([])).toBe(0);
  });
});
