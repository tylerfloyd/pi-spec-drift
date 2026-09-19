import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('redaction handles a long non-secret identifier without quadratic scanning', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import {redact} from './dist/redact.js'; console.log(redact('x'.repeat(200000)).text.length);"
  ], {encoding: 'utf8', timeout: 5000});
  assert.equal(out.trim(), '200000');
});
