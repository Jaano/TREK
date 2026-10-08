/**
 * Derive functions for the BOOT-STABLE values that Nest injects through a
 * registerAs token (src/nest/app-config/tokens.ts) and nothing else reads.
 *
 * Every environment variable has exactly one owner. A variable derived here is
 * owned by its token: `deriveAll()` (and so `readEnv()`) never reads it, which
 * tests/unit/app-config/config-ownership.test.ts checks by recording the keys
 * each side touches. A value that pre-container code needs, or that tests
 * mutate mid-lifetime, belongs in derive.ts instead.
 */
import { parseBool } from './parsers';
import type { RawEnv } from './derive';

/** What the pre-init Express layer and the HTTP server freeze when buildApp() runs. */
export function deriveHttpBoot(raw: RawEnv) {
  // env.schema.ts accepts 0 as a valid hop count, so `|| 1` would quietly turn
  // "trust nothing" into "trust one hop" and let a forged X-Forwarded-For through.
  const trustProxyHops = Number.parseInt(raw.TRUST_PROXY ?? '', 10);
  return {
    trustProxyRaw: raw.TRUST_PROXY,
    trustProxy: Number.isFinite(trustProxyHops) ? trustProxyHops : 1,
    hstsIncludeSubdomains: parseBool(raw.HSTS_INCLUDE_SUBDOMAINS) === true,
  };
}

/** Where the storage registry puts its conditional place-photo backend. */
export function deriveStorage(raw: RawEnv) {
  return {
    placePhotoDir: raw.TREK_PLACE_PHOTO_DIR,
  };
}

/** One entry per token: the namespace it registers under and the function it derives with. */
export const BOOT_DERIVERS = {
  http: deriveHttpBoot,
  storage: deriveStorage,
} as const;

export type BootNamespace = keyof typeof BOOT_DERIVERS;
