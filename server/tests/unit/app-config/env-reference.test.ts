/**
 * server/.env.example is the env-var reference (root CLAUDE.md), and the Zod
 * schema in env.schema.ts is what the server actually validates. Nothing tied
 * the two together, so about forty variables the server reads were missing
 * from the reference. These cases fail on drift in either direction.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { envSchema } from '../../../src/app-config/env.schema';

const ENV_EXAMPLE = path.join(__dirname, '..', '..', '..', '.env.example');

/**
 * Schema entries an operator never sets, with the reason. Everything else in
 * the schema has a line in .env.example, commented out when it is optional.
 */
const NOT_OPERATOR_SETTINGS: Record<string, string> = {
  PATH: 'the OS search path, validated only so the kitinerary probe can resolve its binary',
  Path: 'the Windows spelling of PATH',
  APP_VERSION: 'set by the image build; the VERSION file wins over it',
  TREK_DB_FILE: 'points the Playwright harness at a throwaway database',
};

/** Every variable named on a `KEY=` line, set or commented out. */
function documentedVariables(): Set<string> {
  const names = new Set<string>();
  for (const line of fs.readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/)) {
    const match = /^#?\s*([A-Za-z][A-Za-z0-9_]*)=/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

const schemaKeys = Object.keys(envSchema.shape);
const documented = documentedVariables();

describe('server/.env.example against the validated schema', () => {
  it('ENV-REF-001: documents every variable the schema validates', () => {
    const missing = schemaKeys.filter((key) => !documented.has(key) && !(key in NOT_OPERATOR_SETTINGS));
    expect(missing).toEqual([]);
  });

  it('ENV-REF-002: names no variable the server does not validate', () => {
    const schema = new Set(schemaKeys);
    expect([...documented].filter((key) => !schema.has(key))).toEqual([]);
  });

  it('ENV-REF-003: the exceptions are real schema entries that the reference leaves out', () => {
    for (const key of Object.keys(NOT_OPERATOR_SETTINGS)) {
      expect(schemaKeys).toContain(key);
      expect(documented.has(key)).toBe(false);
    }
  });
});
