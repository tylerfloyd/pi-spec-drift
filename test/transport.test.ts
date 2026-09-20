import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { systemOne, JevRequestError } from '../dist/client.js';

const questions = { q: {type: 'noul' as const, instructions: 'Does it conform?'} };
const answers = { q: {type: 'noul', noul: 0.9} };
test('usage metadata only carries validated numeric token counts', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ answers, usage: {input_tokens: 1, output_tokens: 2, extra: 'private response detail'} }))) as typeof fetch;
  const result = await systemOne('state', questions, {apiKey: 'test-placeholder', fetchImpl});
  assert.deepEqual(result.usage, {input_tokens: 1, output_tokens: 2});
});
test('invalid usage metadata is rejected rather than copied into reports', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ answers, usage: {input_tokens: 'private response detail', output_tokens: 2} }))) as typeof fetch;
  await assert.rejects(systemOne('state', questions, {apiKey: 'test-placeholder', fetchImpl}), JevRequestError);
});
test('timeout covers a stalled response body after successful headers', {timeout: 3000}, async () => {
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write('{"answers":');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    const {port} = server.address() as {port: number};
    await assert.rejects(systemOne('state', questions, {apiKey: 'test-placeholder', baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 100, maxRetries: 0}), JevRequestError);
  } finally { server.closeAllConnections(); server.close(); }
});
