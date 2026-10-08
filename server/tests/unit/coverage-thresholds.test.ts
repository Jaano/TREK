import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

/**
 * The coverage gate is a ratchet per src/nest domain (vitest.config.ts). A
 * domain without its own entry falls into the pooled `src/nest/**` catch-all,
 * where its coverage is averaged with app.module.ts and the like and can drop
 * twenty points unseen; eleven domains had landed that way. This keeps every
 * domain folder on its own floor, and every entry pointing at a folder that
 * still exists.
 */

const NEST = path.resolve(__dirname, '../../src/nest');

function domains(): string[] {
  return readdirSync(NEST, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function domainKeys(): string[] {
  const thresholds = (config.test?.coverage as { thresholds?: Record<string, unknown> } | undefined)?.thresholds ?? {};
  return Object.keys(thresholds)
    .map((key) => key.match(/^src\/nest\/([^/*]+)\/\*\*\/\*\.ts$/)?.[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

describe('per-domain coverage thresholds', () => {
  it('COVT-001: the config holds the per-domain block at all', () => {
    expect(domainKeys().length).toBeGreaterThan(50);
    expect(domains().length).toBeGreaterThan(50);
  });

  it('COVT-002: every directory under src/nest has its own threshold entry', () => {
    const pinned = new Set(domainKeys());
    expect(
      domains().filter((d) => !pinned.has(d)),
      "add `'src/nest/<domain>/**/*.ts'` to vitest.config.ts, from `node scripts/coverage-thresholds.mjs` after a coverage run",
    ).toEqual([]);
  });

  it('COVT-003: every domain entry names a directory that exists', () => {
    const present = new Set(domains());
    expect(domainKeys().filter((d) => !present.has(d))).toEqual([]);
  });

  it('COVT-004: no domain entry sits above 100 or below 0', () => {
    const thresholds = (config.test?.coverage as { thresholds?: Record<string, Record<string, number>> }).thresholds ?? {};
    for (const domain of domainKeys()) {
      const entry = thresholds[`src/nest/${domain}/**/*.ts`];
      for (const metric of ['statements', 'branches', 'functions', 'lines']) {
        expect(entry?.[metric], `${domain}.${metric}`).toBeGreaterThanOrEqual(0);
        expect(entry?.[metric], `${domain}.${metric}`).toBeLessThanOrEqual(100);
      }
    }
  });
});
