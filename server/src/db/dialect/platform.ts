import type { Platform } from '@mikro-orm/core';
import { SqlitePlatform } from '@mikro-orm/sql';

/**
 * Which engine a dialect helper is spelling for.
 *
 * Every helper in `sql-functions.ts` and `kysely-functions.ts` dispatches on
 * the live MikroORM platform (`em.getPlatform()`). Anything the dialect layer
 * has no spelling for fails closed through {@link unsupported} rather than
 * guessing.
 */
export function isSqlite(platform: Platform): boolean {
  return platform instanceof SqlitePlatform;
}

export function unsupported(platform: Platform): never {
  throw new Error(`sql-functions: no implementation for platform ${platform.constructor.name}`);
}
