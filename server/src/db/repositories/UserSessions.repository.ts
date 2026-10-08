import type { UserSessions } from '../entities/UserSessions.entity';
import type { AssertRowKeys } from './_shared/rows';
import { TrekRepository } from './_shared/trek-repository';

/** A `user_sessions` row exactly as `SELECT *` reads it. */
export interface UserSessionRow {
  id: string;
  user_id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
}

const _userSessionRowKeys: AssertRowKeys<UserSessionRow, UserSessions> = true;

/** What a session list shows: the row without its owner, who is the caller. */
export type UserSessionListRow = Omit<UserSessionRow, 'user_id' | 'revoked_at'>;

/** The columns a new sign-in writes; `last_seen_at` starts at `created_at`. */
export interface NewUserSessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
}

/**
 * `user_sessions`: one row per issued session token, keyed by the token's
 * `jti`. Every timestamp is the `YYYY-MM-DD HH:MM:SS` text the column type
 * stores, and the caller passes "now" in that same form, so "active" (not
 * revoked, `expires_at` still ahead) is one comparison the database makes and
 * a test can pin a clock for.
 */
export class UserSessionsRepository extends TrekRepository<UserSessions> {
  /** `INSERT INTO user_sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)`. */
  async insertSession(row: NewUserSessionRow): Promise<void> {
    await this.insert({
      id: row.id,
      user: row.user_id,
      created_at: row.created_at,
      last_seen_at: row.created_at,
      expires_at: row.expires_at,
      user_agent: row.user_agent,
    });
  }

  /**
   * The check behind every session token that carries an id:
   * `SELECT id, last_seen_at FROM user_sessions WHERE id = ? AND user_id = ?
   *  AND revoked_at IS NULL AND expires_at > ?`. The owner is part of the
   * match, so a token can only ever name a session of the user it was signed for.
   */
  async findActive(id: string, userId: number, now: string): Promise<{ id: string; last_seen_at: string } | null> {
    const row = await this.findOne(
      { id, user: userId, revoked_at: null, expires_at: { $gt: now } },
      { fields: ['id', 'last_seen_at'] },
    );
    return row ? { id: row.id, last_seen_at: row.last_seen_at } : null;
  }

  /** `UPDATE user_sessions SET last_seen_at = ? WHERE id = ?`. */
  async touchLastSeen(id: string, now: string): Promise<void> {
    await this.nativeUpdate({ id }, { last_seen_at: now });
  }

  /**
   * Sliding renewal: `UPDATE user_sessions SET expires_at = ?, last_seen_at = ?
   *  WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?`.
   * Answers whether the session was still active, so a session revoked a
   * moment ago is never brought back.
   */
  async extendActive(id: string, userId: number, now: string, expiresAt: string): Promise<boolean> {
    const changed = await this.nativeUpdate(
      { id, user: userId, revoked_at: null, expires_at: { $gt: now } },
      { expires_at: expiresAt, last_seen_at: now },
    );
    return changed > 0;
  }

  /**
   * `SELECT id, created_at, last_seen_at, expires_at, user_agent FROM user_sessions
   *  WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
   *  ORDER BY last_seen_at DESC, id ASC`.
   */
  async listActiveForUser(userId: number, now: string): Promise<UserSessionListRow[]> {
    const rows = await this.find(
      { user: userId, revoked_at: null, expires_at: { $gt: now } },
      {
        fields: ['id', 'created_at', 'last_seen_at', 'expires_at', 'user_agent'],
        orderBy: { last_seen_at: 'desc', id: 'asc' },
      },
    );
    return rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      last_seen_at: row.last_seen_at,
      expires_at: row.expires_at,
      user_agent: row.user_agent ?? null,
    }));
  }

  /**
   * `UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`;
   * answers whether a session of that user was revoked. Another user's id
   * matches nothing, the same answer as an id that never existed.
   */
  async revokeForUser(id: string, userId: number, now: string): Promise<boolean> {
    return (await this.nativeUpdate({ id, user: userId, revoked_at: null }, { revoked_at: now })) > 0;
  }

  /**
   * `UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
   * with `AND id <> ?` when one session is kept. Answers how many were revoked.
   */
  async revokeAllForUser(userId: number, now: string, exceptId?: string): Promise<number> {
    return await this.nativeUpdate(
      exceptId === undefined
        ? { user: userId, revoked_at: null }
        : { user: userId, revoked_at: null, id: { $ne: exceptId } },
      { revoked_at: now },
    );
  }

  /**
   * The nightly purge: `DELETE FROM user_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL`.
   * A row that is gone refuses its token just as a revoked one does, so
   * nothing depends on keeping them.
   */
  async deleteInactive(now: string): Promise<number> {
    return await this.nativeDelete({ $or: [{ expires_at: { $lte: now } }, { revoked_at: { $ne: null } }] });
  }
}
