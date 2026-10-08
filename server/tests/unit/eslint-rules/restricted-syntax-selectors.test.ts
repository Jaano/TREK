import tsParser from '@typescript-eslint/parser';

import { ESLint, Linter } from 'eslint';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

// The outbound-timeout guard is no-restricted-syntax selectors in
// eslint.config.mjs, and a selector that stops matching fails silently: the
// lint stays green and nothing is checked. This asks ESLint for the options it
// really applies to a given path (so the flat-config blocks and their ignores
// are part of what is tested) and runs those selectors over small snippets.

const serverRoot = path.resolve(__dirname, '../../..');
const eslint = new ESLint({ cwd: serverRoot });

type RuleEntry = [string, ...unknown[]];

async function selectorsFor(file: string): Promise<unknown[]> {
  const config = (await eslint.calculateConfigForFile(path.join(serverRoot, file))) as {
    rules?: Record<string, RuleEntry>;
  };
  const entry = config.rules?.['no-restricted-syntax'];
  if (!entry) throw new Error(`no-restricted-syntax is not configured for ${file}`);
  return entry.slice(1);
}

function messages(options: unknown[], code: string): string[] {
  const linter = new Linter({ configType: 'flat' });
  const result = linter.verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tsParser },
        rules: { 'no-restricted-syntax': ['error', ...(options as object[])] },
      },
    ],
    'probe.ts',
  );
  return result.map((m) => m.message);
}

const PRELUDE = `
declare function fetch(url: string, init?: object): Promise<unknown>;
declare function safeFetch(url: string, init?: object, options?: object): Promise<unknown>;
declare function safeFetchFollow(url: string, init?: object, options?: object): Promise<unknown>;
declare function safeFetchAdminConfigured(url: string, init?: object): Promise<unknown>;
declare function safeFetchLlm(url: string, init?: object): Promise<unknown>;
declare const url: string;
declare const init: object;
declare const signal: AbortSignal;
`;

const TIMEOUT = 'Outbound fetch needs a timeout: pass { signal: AbortSignal.timeout(ms) }.';

describe('outbound fetch timeout selectors', () => {
  let options: unknown[];
  beforeAll(async () => {
    options = await selectorsFor('src/nest/memories/probe.service.ts');
  });

  it.each([
    ['fetch(url)'],
    ["fetch(url, { method: 'POST' })"],
    ['safeFetch(url)'],
    ['safeFetch(url, undefined, { rejectUnauthorized: false })'],
    ['safeFetchFollow(url, undefined, { bypassInternalIpAllowed: true })'],
    ["safeFetchFollow(url, { headers: { a: 'b' } })"],
    ['safeFetchAdminConfigured(url, {})'],
  ])('flags %s', (call) => {
    expect(messages(options, `${PRELUDE}\nvoid ${call};`)).toEqual([TIMEOUT]);
  });

  it.each([
    ['fetch(url, init)'],
    ['fetch(url, { signal })'],
    ['safeFetch(url, { signal: AbortSignal.timeout(5000) })'],
    ['safeFetch(url, { ...init })'],
    ['safeFetch(url, init, { rejectUnauthorized: false })'],
    // The options object in third place carries no signal and must not be mistaken for the init.
    ['safeFetchFollow(url, { signal }, { bypassInternalIpAllowed: true })'],
    // safeFetchLlm takes its deadline from LLM_TIMEOUT_MS inside the wrapper.
    ["safeFetchLlm(url, { method: 'POST' })"],
  ])('accepts %s', (call) => {
    expect(messages(options, `${PRELUDE}\nvoid ${call};`)).toEqual([]);
  });

  it('holds in the repositories too, whose block restates the selectors', async () => {
    const repo = await selectorsFor('src/db/repositories/Probe.repository.ts');
    expect(messages(repo, `${PRELUDE}\nvoid safeFetch(url, undefined, {});`)).toEqual([TIMEOUT]);
  });
});
