import type Database from 'better-sqlite3';
import { sharedTestOrm } from './test-uow';
import { UserSessions } from '../../src/db/entities/UserSessions.entity';
import type { UserSessionsRepository } from '../../src/db/repositories/UserSessions.repository';
import { SessionsService } from '../../src/nest/sessions/sessions.service';

/**
 * The `user_sessions` table behind `SessionsService`, bound to a suite's own
 * better-sqlite3 handle through the memoised `sharedTestOrm`, so a session row
 * written inside a hand-built service's `UnitOfWork` transaction lands on the
 * same connection the suite reads back.
 */
export function createTestUserSessionsRepo(db: Database.Database): Promise<UserSessionsRepository> {
  return sharedTestOrm(db).then((t) => t.repo(UserSessions));
}

/** A real `SessionsService` over that repository, for the hand-constructed `AuthService`/`AdminService`. */
export async function createTestSessionsService(db: Database.Database): Promise<SessionsService> {
  return new SessionsService(await createTestUserSessionsRepo(db));
}

/** The session rows of a user, oldest first, straight from the table. */
export function sessionRows(
  db: Database.Database,
  userId: number,
): { id: string; revoked_at: string | null; expires_at: string; user_agent: string | null }[] {
  return db
    .prepare('SELECT id, revoked_at, expires_at, user_agent FROM user_sessions WHERE user_id = ? ORDER BY created_at, id')
    .all(userId) as { id: string; revoked_at: string | null; expires_at: string; user_agent: string | null }[];
}
