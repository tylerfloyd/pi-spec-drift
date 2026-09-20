import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';

const cli = resolve('dist/cli.js');
const diff = readFileSync('test/fixtures/clean.diff', 'utf8');
function run(args: string[], env: Record<string,string> = {}): Promise<number> {
  return new Promise(done => execFile(process.execPath, [cli, ...args], {env: {...process.env, TYPESAFE_API_KEY: '', SPEC_DRIFT_BLOCK: '', SPEC_DRIFT_SPEC_GLOB: '', ...env}}, e => done(e ? Number(e.code) : 0)));
}
for (const mode of ['git-error', 'missing-spec', 'invalid-diff', 'exclude-all', 'malformed-200']) {
  test(`CLI ${mode} fails with a NOT_EVALUATED report`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'specdrift-failure-'));
    const json = join(root, 'result.json');
    const server = createServer((req, res) => { req.resume(); res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"answers":{}}'); });
    try {
      writeFileSync(join(root, 'SPEC.md'), 'A real specification');
      writeFileSync(join(root, 'input.diff'), mode === 'invalid-diff' ? 'not a git diff' : diff);
      if (mode === 'exclude-all') writeFileSync(join(root, '.spec-drift.json'), '{"excludeGlobs":["**"]}');
      let env: Record<string,string> = {};
      if (mode === 'malformed-200') {
        await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
        const addr = server.address() as {port:number};
        env = {TYPESAFE_API_KEY: 'test-only-placeholder', SPEC_DRIFT_BASE_URL: `http://127.0.0.1:${addr.port}`};
      }
      const args = ['review', '--root', root, '--report-json', json,
        '--spec-glob', mode === 'missing-spec' ? 'missing.md' : 'SPEC.md',
        ...(mode === 'git-error' ? ['--base', 'main', '--head', 'HEAD'] : ['--diff-file', 'input.diff'])];
      assert.equal(await run(args, env), 1);
      const report = JSON.parse(readFileSync(json, 'utf8'));
      assert.equal(report.verdict, 'NOT_EVALUATED');
      assert.equal(report.shouldFail, true);
    } finally { server.close(); rmSync(root, {recursive: true, force: true}); }
  });
}
