import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService } from '../src/server/weather.js';
const NOW = Date.parse('2026-10-10T11:00:00Z');
const valid = (temperature = 21.5, code = 3) => ({ current: { temperature_2m: temperature, weather_code: code, time: NOW / 1000 } });

test('weather exposes safe HTTP diagnostics without upstream body or headers', async () => {
  const weather = await createWeatherService({ now: () => NOW, fetchImpl: async () => new Response('upstream-private-body', { status: 429, headers: { 'private-header': 'private-value' } }) })();
  assert.equal(weather.status, 'offline'); assert.equal(weather.temperature, null);
  assert.deepEqual(weather.diagnostics, [{ source: 'Open-Meteo', outcome: 'http_error', status: 429, elapsedMs: 0 }]);
  assert.ok(!JSON.stringify(weather).includes('private'));
});
test('weather deduplicates concurrent requests and preserves retrieval time when stale', async () => {
  let now = NOW, calls = 0;
  const service = createWeatherService({ now: () => now, fetchImpl: async () => { calls++; return calls === 1 ? Response.json(valid()) : new Response(null, { status: 503 }); } });
  const [first, second] = await Promise.all([service(), service()]);
  assert.equal(calls, 1); assert.equal(first, second); assert.equal(first.validAt, new Date(NOW).toISOString());
  now += 300_001;
  const stale = await service();
  assert.equal(stale.status, 'stale'); assert.equal(stale.temperature, 21.5); assert.equal(stale.retrievedAt, first.retrievedAt); assert.notEqual(stale.checkedAt, first.checkedAt);
  await service(); assert.equal(calls, 2);
});
test('weather rejects null or old values instead of labeling fabricated data live', async () => {
  for (const payload of [valid(null as any), { current: { ...valid().current, time: NOW / 1000 - 8000 } }]) {
    const weather = await createWeatherService({ now: () => NOW, fetchImpl: async () => Response.json(payload) })();
    assert.equal(weather.status, 'offline'); assert.equal(weather.temperature, null); assert.equal(weather.diagnostics?.[0].outcome, 'invalid_data');
  }
});
