import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const action = readFileSync('action.yml', 'utf8');
test('action run block treats hostile inputs as literal argv', () => {
  const script = action.match(/      run: \|\n([\s\S]*)$/)?.[1]?.replace(/^        /gm, '');
  assert.ok(script);
  assert.ok(!script.includes('${{'), 'no Actions expressions inside shell source');
  const dir = mkdtempSync(join(tmpdir(), 'specdrift-action-'));
  try {
    mkdirSync(join(dir, 'bin'));
    const argsFile = join(dir, 'args.json');
    writeFileSync(join(dir, 'bin', 'node'), `#!${process.execPath}\nrequire('fs').writeFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)));\n`, {mode: 0o755});
    const marker = join(dir, 'pwned');
    const hostile = `\"; touch ${marker}; # $(touch ${marker})\nsecond line`;
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], {env: {
      ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH,
      RUNNER_TEMP: dir, GITHUB_OUTPUT: join(dir, 'outputs'), GITHUB_WORKSPACE: dir,
      BOT_PATH: dir, REVIEW_ROOT: dir, INPUT_BASE: 'base', INPUT_HEAD: 'head',
      INPUT_TITLE: hostile, INPUT_DESC: hostile, INPUT_GLOB: '**/*.md',
      INPUT_MODEL: 'jev-latest', INPUT_BLOCK: 'false', INPUT_REPO: 'owner/repo',
      ARGS_FILE: argsFile,
    }});
    const args = JSON.parse(readFileSync(argsFile, 'utf8'));
    assert.equal(args[args.indexOf('--pr-title') + 1], hostile);
    assert.equal(args[args.indexOf('--pr-desc') + 1], hostile);
    assert.ok(!existsSync(marker));
    const reportPath = args[args.indexOf('--report-md') + 1];
    assert.ok(reportPath.startsWith(dir + '/specdrift-'));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('reusable workflow calls trusted action directory, not caller action.yml', () => {
  const workflow = readFileSync('.github/workflows/spec-drift.yml', 'utf8');
  assert.ok(!workflow.includes('uses: ./action.yml'));
  assert.ok(workflow.includes('uses: ./_specdrift'));
  assert.ok(!workflow.includes('pull_request_target'));
  assert.ok(workflow.includes('persist-credentials: false'));
});
