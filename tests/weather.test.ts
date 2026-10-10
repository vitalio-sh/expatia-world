import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService } from '../src/server/weather.js';
const NOW = Date.parse('2026-10-10T11:00:00Z');
const valid = (temperature = 21.5, code = 3) => ({ current: { temperature_2m: temperature, weather_code: code, time: NOW / 1000 } });

test('weather exposes safe HTTP diagnostics without upstream body or headers', async () => {
  const weather = await createWeatherService({ now: () => NOW, fetchImpl: async () => new Response('upstream-private-body', { status: 429, headers: { 'private-header': 'private-value' } }) })();
  assert.equal(weather.status, 'offline'); assert.equal(weather.temperature, null);
  assert.deepEqual(weather.diagnostics, ['Open-Meteo', 'MET Norway'].map(source => ({ source, outcome: 'http_error', status: 429, elapsedMs: 0 })));
  assert.ok(!JSON.stringify(weather).includes('private'));
});
const forecast = (symbol = 'clearsky_day') => ({ properties: { meta: { updated_at: new Date(NOW - 3600_000).toISOString(), units: { air_temperature: 'celsius' } }, timeseries: [{ time: new Date(NOW).toISOString(), data: { instant: { details: { air_temperature: 20.7 } }, next_1_hours: { summary: { symbol_code: symbol }, details: { precipitation_amount: symbol.includes('rain') ? 2 : 0 } } } }] } });
test('primary HTTP 429 uses identified MET Norway fallback and retains both attempts', async () => {
  const service = createWeatherService({ now: () => NOW, fetchImpl: async (url, init) => {
    if (String(url).includes('open-meteo')) return new Response(null, { status: 429 });
    assert.equal(new Headers(init?.headers).get('User-Agent'), 'ExpatiaWorld/0.1 https://expatia.world');
    assert.ok(String(url).includes('lat=41.3874&lon=2.1686'));
    return Response.json(forecast('rainshowers_day'), { headers: { Expires: new Date(NOW + 900_000).toUTCString(), 'Last-Modified': new Date(NOW - 3600_000).toUTCString() } });
  } });
  const weather = await service();
  assert.equal(weather.status, 'live'); assert.equal(weather.source, 'MET Norway'); assert.equal(weather.dataKind, 'current-forecast');
  assert.equal(weather.temperature, 20.7); assert.equal(weather.isRain, true); assert.equal(weather.code, null);
  assert.equal(weather.validAt, new Date(NOW).toISOString()); assert.equal(weather.modelUpdatedAt, new Date(NOW - 3600_000).toISOString());
  assert.deepEqual(weather.diagnostics?.map(attempt => [attempt.source, attempt.status, attempt.outcome]), [['Open-Meteo', 429, 'http_error'], ['MET Norway', 200, 'live']]);
});
test('MET cache respects Expires and sends If-Modified-Since on expiry without changing retrieval stamp on 304', async () => {
  let now = NOW, metCalls = 0;
  const modified = new Date(NOW - 3600_000).toUTCString();
  const service = createWeatherService({ now: () => now, fetchImpl: async (url, init) => {
    if (String(url).includes('open-meteo')) return new Response(null, { status: 429 });
    metCalls++;
    if (metCalls === 1) return Response.json(forecast(), { headers: { Expires: new Date(NOW + 900_000).toUTCString(), 'Last-Modified': modified } });
    assert.equal(new Headers(init?.headers).get('If-Modified-Since'), modified);
    return new Response(null, { status: 304, headers: { Expires: new Date(now + 900_000).toUTCString() } });
  } });
  const first = await service(); now += 300_001;
  const reused = await service(); assert.equal(metCalls, 1); assert.equal(reused.diagnostics?.[1].cached, true);
  now = NOW + 900_001; const validated = await service();
  assert.equal(metCalls, 2); assert.equal(validated.status, 'live'); assert.equal(validated.retrievedAt, first.retrievedAt); assert.equal(validated.diagnostics?.[1].status, 304);
});
test('failed fallback preserves previous real data as stale; unknown/expired forecasts stay offline', async () => {
  for (const data of [forecast('unknown_condition'), { ...forecast(), properties: { ...forecast().properties, timeseries: [{ ...forecast().properties.timeseries[0], time: new Date(NOW - 7200_000).toISOString() }] } }]) {
    const weather = await createWeatherService({ now: () => NOW, fetchImpl: async url => String(url).includes('open-meteo') ? new Response(null, { status: 429 }) : Response.json(data) })();
    assert.equal(weather.status, 'offline'); assert.equal(weather.temperature, null); assert.equal(weather.diagnostics?.[1].outcome, 'invalid_data');
  }
});
test('weather deduplicates concurrent requests and preserves retrieval time when stale', async () => {
  let now = NOW, calls = 0;
  const service = createWeatherService({ now: () => now, fetchImpl: async () => { calls++; return calls === 1 ? Response.json(valid()) : new Response(null, { status: 503 }); } });
  const [first, second] = await Promise.all([service(), service()]);
  assert.equal(calls, 1); assert.equal(first, second); assert.equal(first.validAt, new Date(NOW).toISOString());
  now += 300_001;
  const stale = await service();
  assert.equal(stale.status, 'stale'); assert.equal(stale.temperature, 21.5); assert.equal(stale.retrievedAt, first.retrievedAt); assert.notEqual(stale.checkedAt, first.checkedAt);
  await service(); assert.equal(calls, 3);
});
test('weather rejects null or old values instead of labeling fabricated data live', async () => {
  for (const payload of [valid(null as any), { current: { ...valid().current, time: NOW / 1000 - 8000 } }]) {
    const weather = await createWeatherService({ now: () => NOW, fetchImpl: async () => Response.json(payload) })();
    assert.equal(weather.status, 'offline'); assert.equal(weather.temperature, null); assert.equal(weather.diagnostics?.[0].outcome, 'invalid_data');
  }
});
