import test from 'node:test';
import assert from 'node:assert/strict';
import { configureProviders, openRouterStream } from '../src/server/providers';
import { usageEntries, usageSummary } from '../src/server/usage';

test('OpenRouter accounts for cancelled and HTTP-error attempts before stream headers', async () => {
  const previousFetch = globalThis.fetch;
  const workerRuntime = Object.getOwnPropertyDescriptor(globalThis, 'WebSocketPair');
  Object.defineProperty(globalThis, 'WebSocketPair', { configurable: true, value: class {} });
  configureProviders({ OPENROUTER_API_KEY: 'unit-test-placeholder' });
  const sessionId = 'provider-pre-header-accounting-test';
  try {
    const abort = new AbortController(); abort.abort();
    globalThis.fetch = async () => { throw new DOMException('Cancelled before headers', 'AbortError'); };
    await assert.rejects(openRouterStream([], () => {}, abort.signal, { sessionId, turnId: 'cancelled' }), { name: 'AbortError' });
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(openRouterStream([], () => {}, undefined, { sessionId, turnId: 'http-error' }), /openrouter_http_503/);
    const entries = usageEntries(sessionId);
    assert.deepEqual(entries.map(entry => entry.outcome), ['cancelled', 'error']);
    assert.ok(entries.every(entry => entry.inputTokens === undefined && entry.outputTokens === undefined && entry.costUsd === undefined));
    assert.equal(usageSummary(sessionId).unreportedTokenCalls, 2);
    assert.equal(JSON.stringify(entries).includes('unit-test-placeholder'), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (workerRuntime) Object.defineProperty(globalThis, 'WebSocketPair', workerRuntime);
    else Reflect.deleteProperty(globalThis, 'WebSocketPair');
    configureProviders({});
  }
});
