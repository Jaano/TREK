import type { PermissionLevel } from './permissions.service';

/**
 * Where the loaded permission levels are kept between requests.
 *
 * An injectable port (PermissionsService takes it, PermissionsModule provides
 * it) so a store shared between processes can replace the in-memory one
 * without touching the service: today a permission change on one process is
 * only seen by that process, which is right while TREK runs as one.
 */
export abstract class PermissionsCacheStore {
  /** The cached levels, or null when nothing is cached. */
  abstract get(): Map<string, PermissionLevel> | null;
  /** Install a completed read and return it. */
  abstract set(next: Map<string, PermissionLevel>): Map<string, PermissionLevel>;
  /** Drop the cache, so the next reader loads the stored levels again. */
  abstract invalidate(): void;
}

/** The current behaviour: one map in this process's memory. */
export class InMemoryPermissionsCacheStore extends PermissionsCacheStore {
  private cache: Map<string, PermissionLevel> | null = null;

  get(): Map<string, PermissionLevel> | null {
    return this.cache;
  }

  set(next: Map<string, PermissionLevel>): Map<string, PermissionLevel> {
    this.cache = next;
    return next;
  }

  invalidate(): void {
    this.cache = null;
  }
}

/**
 * The one store this process shares, in its own home (the
 * oauth.pending-codes.ts precedent) so every path that must see the same
 * cache does: PermissionsModule provides this instance to the container's
 * PermissionsService, a hand-built PermissionsService (the no-Nest test
 * harnesses) defaults to it, and the plain backup restore path
 * (backup.impl.ts), which is free functions by design, flushes it through
 * invalidatePermissionsCache() below after a restore rewrites app_settings.
 */
export const processPermissionsCache: PermissionsCacheStore = new InMemoryPermissionsCacheStore();

export function getPermissionsCache(): Map<string, PermissionLevel> | null {
  return processPermissionsCache.get();
}

/** Install a fresh cache map and return it (the loader fills it in place). */
export function setPermissionsCache(next: Map<string, PermissionLevel>): Map<string, PermissionLevel> {
  return processPermissionsCache.set(next);
}

export function invalidatePermissionsCache(): void {
  processPermissionsCache.invalidate();
}
