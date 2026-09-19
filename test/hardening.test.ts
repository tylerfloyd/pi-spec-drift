import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderJson } from '../dist/report.js';
import { buildState } from '../dist/state.js';

const ev = { verdict: 'DRIFT' as const, evaluated: true, questions: [], noulResults: [] };
test('blocking report describes a failing check', () => {
  const md = renderMarkdown(ev, { blocking: true });
  assert.ok(!md.includes('advisory and is not blocking'));
  assert.match(md, /fail/i);
});
test('review verdict explains blocking policy without claiming drift', () => {
  const md = renderMarkdown({ ...ev, verdict: 'REVIEW' }, { blocking: true });
  assert.ok(!md.includes('This check is advisory'));
  assert.match(md, /clear drift/i);
});
test('PR title and error reason are redacted in reports', () => {
  const secret = 'ghp_1234567890abcdef1234567890abcdef';
  assert.ok(!renderMarkdown(ev, { prTitle: secret }).includes(secret));
  assert.ok(!renderJson({ ...ev, reason: secret }, false, {}).includes(secret));
});
test('bounds metadata and total spec text', () => {
  const s = buildState({ specFiles: Array.from({length: 200}, () => ({path: 'x'.repeat(2000), content: 'y'.repeat(5000)})), diff: 'z'.repeat(5000), maxSpecChars: 300, maxDiffChars: 300 });
  assert.ok(s.spec.content.length <= 300);
  assert.ok(s.change.diff.length <= 300);
  assert.ok(s.spec.files.length <= 100);
});
