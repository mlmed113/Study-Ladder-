import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, parseJSON } from '../lib/ai-handler.js';

function fakeRes() {
  const r = { statusCode: 0, body: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}
function setup({ allowed = true, reply = '{"a":1}', stop = 'end_turn', user = { id: 'u1' } } = {}) {
  const calls = { anthropic: [], rpc: [] };
  const supabaseAdmin = {
    auth: { getUser: async t => (t === 'good' ? { data: { user }, error: null } : { data: { user: null }, error: new Error('bad') }) },
    rpc: async (name, args) => { calls.rpc.push([name, args]); return { data: allowed, error: null }; },
  };
  const anthropic = { beta: { messages: { create: async p => { calls.anthropic.push(p); return { stop_reason: stop, content: [{ type: 'text', text: reply }] }; } } } };
  return { handler: makeHandler({ anthropic, supabaseAdmin, env: {} }), calls };
}
const req = (body, token = 'good') => ({ method: 'POST', headers: { authorization: 'Bearer ' + token }, body });

test('rejects signed-out callers before spending anything', async () => {
  const { handler, calls } = setup(); const res = fakeRes();
  await handler(req({ prompt: 'hi' }, 'bad'), res);
  assert.equal(res.statusCode, 401); assert.equal(calls.anthropic.length, 0); assert.equal(calls.rpc.length, 0);
});
test('daily limit stops the call', async () => {
  const { handler, calls } = setup({ allowed: false }); const res = fakeRes();
  await handler(req({ prompt: 'hi', kind: 'lesson' }), res);
  assert.equal(res.statusCode, 429); assert.equal(res.body.code, 'daily_limit'); assert.equal(calls.anthropic.length, 0);
  assert.deepEqual(calls.rpc[0], ['bump_usage', { p_user: 'u1', p_kind: 'lesson', p_limit: 3 }]);
});
test('json request returns parsed value with model, effort and fallbacks', async () => {
  const { handler, calls } = setup({ reply: '```json\n{"steps":[1]}\n```' }); const res = fakeRes();
  await handler(req({ prompt: 'make lesson', kind: 'lesson', tier: 'complex', json: true, images: [{ media_type: 'image/png', data: 'AAAA' }] }), res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body.value, { steps: [1] });
  const p = calls.anthropic[0];
  assert.equal(p.model, 'claude-opus-5-5'); assert.equal(p.output_config.effort, 'high'); assert.equal(p.fallbacks, 'default');
  assert.equal(p.messages[0].content[0].type, 'image'); assert.match(p.messages[0].content[1].text, /JSON object only/);
});
test('unreadable JSON and refusals are reported', async () => {
  let s = setup({ reply: 'sorry no json' }), res = fakeRes();
  await s.handler(req({ prompt: 'x', json: true }), res); assert.equal(res.body.code, 'invalid_json');
  s = setup({ stop: 'refusal' }); res = fakeRes();
  await s.handler(req({ prompt: 'x' }), res); assert.equal(res.body.code, 'refused');
});
test('rejects bad input', async () => {
  const { handler } = setup(); let res = fakeRes();
  await handler(req({ prompt: 'x', kind: 'hack' }), res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await handler(req({ prompt: 'x', images: [{ media_type: 'text/html', data: 'x' }] }), res); assert.equal(res.statusCode, 400);
  res = fakeRes(); await handler(req({ prompt: 'x'.repeat(300 * 1024) }), res); assert.equal(res.statusCode, 413);
});
test('parseJSON tolerates chatter', () => {
  assert.deepEqual(parseJSON('Here you go: {"a":2} hope that helps'), { a: 2 });
  assert.equal(parseJSON('nope'), undefined);
});
