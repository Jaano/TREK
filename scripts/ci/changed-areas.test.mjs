import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AREAS, classify } from './changed-areas.mjs';

const script = fileURLToPath(new URL('./changed-areas.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'changed-areas-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const none = Object.fromEntries(Object.keys(AREAS).map((area) => [area, false]));
const every = Object.fromEntries(Object.keys(AREAS).map((area) => [area, true]));

function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '', ...env },
  });
}

describe('classify', () => {
  it('runs nothing for a docs-only change', () => {
    assert.deepEqual(classify(['wiki/Home.md', 'README.md', 'server/CLAUDE.md', 'docs/logo-trek-dark.svg']), none);
  });

  it('runs the tests and the image for a server change', () => {
    assert.deepEqual(classify(['server/src/nest/weather/weather.service.ts']), { code: true, image: true, deploy: false });
  });

  it('runs the tests but not the image for a plugin-sdk change', () => {
    assert.deepEqual(classify(['plugin-sdk/src/index.ts']), { code: true, image: false, deploy: false });
  });

  it('runs the image but not the tests for a .dockerignore change', () => {
    assert.deepEqual(classify(['.dockerignore']), { code: false, image: true, deploy: false });
  });

  it('runs the chart and compose checks for a chart template or a compose file', () => {
    assert.deepEqual(classify(['charts/trek/templates/deployment.yaml']), { code: false, image: false, deploy: true });
    assert.deepEqual(classify(['docker-compose.minio-test.yml']), { code: false, image: false, deploy: true });
    assert.equal(classify(['charts/README.md']).deploy, false);
    assert.equal(classify(['server/docker-compose.yml']).deploy, false);
  });

  it('runs everything when the workflow or the classifier itself changes', () => {
    assert.deepEqual(classify(['.github/workflows/test.yml']), every);
    assert.deepEqual(classify(['scripts/ci/changed-areas.mjs']), every);
  });

  it('matches whole file names, not prefixes of them', () => {
    assert.deepEqual(classify(['package.json.bak', 'Dockerfile.old', 'serverless/x.ts']), none);
  });

  it('runs everything when there is no list, an empty one or a quoted path', () => {
    assert.deepEqual(classify(null), every);
    assert.deepEqual(classify(['', '  ']), every);
    assert.deepEqual(classify(['"wiki/\\303\\244.md"']), every);
  });

  it('reads CRLF lists the same as LF ones', () => {
    assert.deepEqual(classify(['wiki/Home.md\r', 'server/src/index.ts\r']), { code: true, image: true, deploy: false });
  });
});

describe('the command line', () => {
  it('writes the areas to stdout and to GITHUB_OUTPUT', () => {
    const list = join(scratch, 'list.txt');
    const output = join(scratch, 'output.txt');
    writeFileSync(list, 'charts/trek/values.yaml\n');
    writeFileSync(output, '');
    const result = run(['--files', list], { GITHUB_OUTPUT: output });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'code=false\nimage=false\ndeploy=true\n');
    assert.equal(readFileSync(output, 'utf8'), 'code=false\nimage=false\ndeploy=true\n');
  });

  it('turns everything on with --all', () => {
    const result = run(['--all']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'code=true\nimage=true\ndeploy=true\n');
  });

  it('fails on a list it cannot read', () => {
    const result = run(['--files', join(scratch, 'missing.txt')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
    assert.equal(result.stdout, '');
  });

  it('fails on arguments it does not know', () => {
    for (const args of [[], ['--files'], ['--all', '--files', 'x'], ['list.txt']]) {
      const result = run(args);
      assert.equal(result.status, 1, `args ${JSON.stringify(args)}`);
      assert.match(result.stderr, /usage/);
    }
  });
});
