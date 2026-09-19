import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diffFromGit } from '../dist/diff.js';

test('git diff does not execute external diff helpers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'specdrift-git-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], {stdio: 'pipe'}).toString().trim();
  const previous = process.env.GIT_EXTERNAL_DIFF;
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(dir, 'file'), 'before'); git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'file'), 'after'); git('add', '.'); git('commit', '-qm', 'head');
    const helper = join(dir, 'external'); const marker = join(dir, 'ran');
    writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\n`, {mode: 0o755});
    process.env.GIT_EXTERNAL_DIFF = helper;
    const result = diffFromGit(dir, base, 'HEAD');
    assert.ok(!existsSync(marker), 'external helper executed');
    assert.match(result, /diff --git/);
    assert.throws(() => diffFromGit(dir, '--output=unexpected', 'HEAD'));
  } finally {
    if (previous === undefined) delete process.env.GIT_EXTERNAL_DIFF; else process.env.GIT_EXTERNAL_DIFF = previous;
    rmSync(dir, {recursive: true, force: true});
  }
});
