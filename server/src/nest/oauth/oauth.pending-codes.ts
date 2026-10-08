/**
 * The short-lived authorization-code store.
 *
 * An injectable port, PendingCodeStore, with the in-memory implementation
 * below. One instance is process-wide, with an import-time sweep on purpose
 * (legacy parity, the atlas-geo interval precedent): OauthModule provides
 * that instance and a hand-built OauthService defaults to it. Sharing is not
 * a stylistic choice: the consent controller writes a code through the container OauthService and the SDK exchange path
 * (oauth-sdk.provider.ts) reads it back — through the same injected singleton
 * in production, but the integration harness and any second OauthService
 * instance must keep seeing the same map. Two maps would make the
 * authorization-code flow fail *silently* — the SDK only ever answers
 * "Authorization grant is invalid."
 *
 * No DB persistence: codes live two minutes and a restart invalidating them
 * is the correct behaviour.
 */

export interface PendingCode {
  clientId: string;
  userId: number;
  redirectUri: string;
  scopes: string[];
  resource: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresAt: number;
}

export const MAX_PENDING_CODES = 500;
export const AUTH_CODE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Where pending authorization codes are kept between the consent and the
 * token exchange. In memory today, which ties an authorization to the process
 * that issued it; a store shared between processes replaces the process
 * instance in OauthModule without touching OauthService.
 */
export abstract class PendingCodeStore {
  /** Keep `entry` under `code`; false when the store is at capacity (the caller answers with a null code). */
  abstract put(code: string, entry: PendingCode): boolean;
  /** Single use: the entry is removed even when it turns out to be expired, and an expired one is null. */
  abstract take(code: string): PendingCode | null;
  /** Drop everything past its TTL. */
  abstract sweep(now?: number): void;
}

/** The current behaviour: one capped map in this process's memory. */
export class InMemoryPendingCodeStore extends PendingCodeStore {
  private readonly codes = new Map<string, PendingCode>();

  put(code: string, entry: PendingCode): boolean {
    if (this.codes.size >= MAX_PENDING_CODES) return false;
    this.codes.set(code, entry);
    return true;
  }

  take(code: string): PendingCode | null {
    const entry = this.codes.get(code);
    if (!entry) return null;
    this.codes.delete(code);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }

  sweep(now = Date.now()): void {
    for (const [key, entry] of this.codes) {
      if (now > entry.expiresAt) this.codes.delete(key);
    }
  }
}

/** The one store this process shares: the consent route writes it, the SDK exchange reads it. */
export const processPendingCodes: PendingCodeStore = new InMemoryPendingCodeStore();

/** Drop everything past its TTL. Named so the interval body is reachable from a test. */
export function sweepPendingCodes(now = Date.now()): void {
  processPendingCodes.sweep(now);
}

setInterval(() => sweepPendingCodes(), 60_000).unref();

/** Returns false when the store is at capacity — the caller answers with a null code. */
export function putPendingCode(code: string, entry: PendingCode): boolean {
  return processPendingCodes.put(code, entry);
}

/** Single-use: the entry is removed even when it turns out to be expired. */
export function takePendingCode(code: string): PendingCode | null {
  return processPendingCodes.take(code);
}
