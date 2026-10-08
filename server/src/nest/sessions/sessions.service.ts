import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import type { UserSession } from '@trek/shared';
import { JWT_SECRET, SESSION_DURATION_SECONDS, SESSION_DURATION_REMEMBER_SECONDS } from '../../config';
import { UserSessions } from '../../db/entities/UserSessions.entity';
import type { UserSessionsRepository } from '../../db/repositories/UserSessions.repository';
import { dbNow } from '../../db/types';

/** The longest User-Agent kept, the same cap a Web Push device's gets. */
export const USER_AGENT_MAX_LENGTH = 256;

/** What the issuing request tells about the device a session belongs to. */
export interface SessionClient {
  userAgent?: string | null;
}

/** The claims a session token is renewed from (decoded by the caller after a guard verified it). */
export interface RenewableSessionClaims {
  id: number;
  pv?: number;
  remember?: boolean;
  jti?: string;
}

/** The device description of a request: its User-Agent header, when it sent one. */
export function sessionClientFrom(req: Pick<Request, 'headers'>): SessionClient {
  const agent = req.headers['user-agent'];
  return { userAgent: typeof agent === 'string' && agent.length > 0 ? agent : null };
}

/**
 * Session tokens and the `user_sessions` rows behind them.
 *
 * Every token issued here carries a random `jti` naming its row, and
 * `verifyJwtAndLoadUser` (auth/jwt-verify.ts) refuses a token whose row is
 * revoked, expired or gone. That is what lets a logout end the token instead
 * of only clearing the cookie, and lets a user sign out a device. A token
 * without a `jti` was issued before sessions were tracked: it is never looked
 * up here and stays valid until it expires or the password changes, so the
 * upgrade signs nobody out.
 *
 * Its own domain, with no import of auth, because auth, oidc and admin all end
 * or start sessions; a home inside auth would have made oidc's and admin's
 * reach for it a reach into auth's internals.
 */
@Injectable()
export class SessionsService {
  constructor(@InjectRepository(UserSessions) private readonly sessions: UserSessionsRepository) {}

  /**
   * Mint a session token for the user and record its session.
   *
   * `remember` picks the lifetime (true: the long "remember me" one) and is
   * kept as a claim so sliding renewal keeps the same cookie semantics; it is
   * left out when the caller made no choice, as before.
   *
   * @txStandalone the row only makes the token it returns usable: if the
   * caller fails after it, nobody holds that token and the row expires with it.
   */
  async issue(user: { id: number; pv: number }, remember?: boolean, client: SessionClient = {}): Promise<string> {
    const jti = randomUUID();
    const token = this.sign(user, remember, jti);
    const { iat, exp } = this.lifetimeOf(token);
    await this.sessions.insertSession({
      id: jti,
      user_id: user.id,
      created_at: dbNow(new Date(iat * 1000)),
      expires_at: dbNow(new Date(exp * 1000)),
      user_agent: clipUserAgent(client.userAgent),
    });
    return token;
  }

  /**
   * Sliding renewal of a verified token past half its life. A tracked token
   * is re-signed under the same id and its row's expiry moves with it; a
   * token from before sessions were tracked becomes a tracked session here.
   * Null when the session ended in the meantime, so nothing is renewed.
   *
   * @txStandalone one statement either way, and a renewal stands on its own:
   * the old token keeps working until its own expiry whatever happens next.
   */
  async renew(claims: RenewableSessionClaims, client: SessionClient = {}): Promise<string | null> {
    const user = { id: claims.id, pv: claims.pv ?? 0 };
    if (claims.jti === undefined) return this.issue(user, claims.remember, client);
    const token = this.sign(user, claims.remember, claims.jti);
    const { exp } = this.lifetimeOf(token);
    const extended = await this.sessions.extendActive(claims.jti, claims.id, dbNow(), dbNow(new Date(exp * 1000)));
    return extended ? token : null;
  }

  /** The user's active sessions, most recently used first, the one in `currentId` flagged. */
  async list(userId: number, currentId?: string): Promise<UserSession[]> {
    const rows = await this.sessions.listActiveForUser(userId, dbNow());
    return rows.map((row) => ({ ...row, current: row.id === currentId }));
  }

  /** End one of the user's sessions. False when the user has no active session by that id. */
  async revoke(userId: number, sessionId: string): Promise<boolean> {
    return this.sessions.revokeForUser(sessionId, userId, dbNow());
  }

  /**
   * Logout: end the session a verified token names. False for no token, or
   * for one from before sessions were tracked, which has no session to end.
   */
  async endSession(claims: { id: number; jti?: string } | null): Promise<boolean> {
    if (!claims || typeof claims.jti !== 'string') return false;
    return this.revoke(claims.id, claims.jti);
  }

  /**
   * End every session of the user, or every one but `exceptId`. Answers how
   * many ended. Runs inside the caller's transaction where there is one (a
   * password change revokes the sessions with the password write).
   */
  async revokeAll(userId: number, exceptId?: string): Promise<number> {
    return this.sessions.revokeAllForUser(userId, dbNow(), exceptId);
  }

  /** Remove the rows that refuse their token anyway: expired or revoked. */
  async purgeInactive(now: Date): Promise<number> {
    return this.sessions.deleteInactive(dbNow(now));
  }

  private sign(user: { id: number; pv: number }, remember: boolean | undefined, jti: string): string {
    // "Remember me" extends the JWT lifetime to match the persistent cookie
    // maxAge; the cookie service decides session-vs-persistent off the same flag.
    const expiresIn = remember === true ? SESSION_DURATION_REMEMBER_SECONDS : SESSION_DURATION_SECONDS;
    return jwt.sign(
      { id: user.id, pv: user.pv, ...(typeof remember === 'boolean' ? { remember } : {}) },
      JWT_SECRET,
      { expiresIn, algorithm: 'HS256', jwtid: jti },
    );
  }

  /** `iat` and `exp` of a token this service just signed. */
  private lifetimeOf(token: string): { iat: number; exp: number } {
    const { iat, exp } = jwt.decode(token) as { iat: number; exp: number };
    return { iat, exp };
  }
}

function clipUserAgent(agent: string | null | undefined): string | null {
  return agent ? agent.slice(0, USER_AGENT_MAX_LENGTH) : null;
}
