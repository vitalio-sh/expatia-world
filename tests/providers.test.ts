import test from 'node:test';
import assert from 'node:assert/strict';
import { configureProviders, openRouterStream, isServiceErrorText } from '../src/server/providers';
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

test('stream error events and nested error frames never become dialogue deltas', async () => {
  const previousFetch = globalThis.fetch;
  const workerRuntime = Object.getOwnPropertyDescriptor(globalThis, 'WebSocketPair');
  Object.defineProperty(globalThis, 'WebSocketPair', { configurable: true, value: class {} });
  configureProviders({ OPENROUTER_API_KEY: 'unit-test-placeholder' });
  const encoder = new TextEncoder();
  const frames = [
    'data: {"error":{"code":503,"message":"provider unavailable"}}\n\n',
    'event: error\ndata: {"message":"upstream unavailable"}\n\n',
    'data: {"choices":[{"error":{"code":503},"delta":{"content":"Do not speak this"}}]}\n\n',
    'data: {"choices":[{"delta":{"error":"failed","content":"Do not speak this"}}]}\n\n',
    'data: {"choices":[{"finish_reason":"error","delta":{"content":"Do not speak this"}}]}',
    'data: {"choices":[{"delta":{"content":"Connection closed. Please type."}}]}\n\n',
  ];
  try {
    for (const frame of frames) {
      globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(frame)); controller.close(); } }));
      const deltas: string[] = [];
      await assert.rejects(openRouterStream([], text => deltas.push(text)), /openrouter_(?:stream_error|service_payload)/);
      assert.deepEqual(deltas, []);
    }
    const valid = 'data: {"choices":[{"delta":{"content":"No entiendo. ¿Puedes repetir?"}}]}\n\ndata: [DONE]\n\n';
    globalThis.fetch = async () => new Response(valid);
    const deltas: string[] = [];
    assert.equal((await openRouterStream([], text => deltas.push(text))).text, 'No entiendo. ¿Puedes repetir?');
    assert.deepEqual(deltas, ['No entiendo. ¿Puedes repetir?']);
    assert.equal(isServiceErrorText('No entiendo.'), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (workerRuntime) Object.defineProperty(globalThis, 'WebSocketPair', workerRuntime); else Reflect.deleteProperty(globalThis, 'WebSocketPair');
    configureProviders({});
  }
});
