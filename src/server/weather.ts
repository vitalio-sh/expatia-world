import type { Weather } from '../shared/world';

const PRIMARY_URL = 'https://api.open-meteo.com/v1/forecast?latitude=41.3874&longitude=2.1686&current=temperature_2m,weather_code&timezone=Europe%2FMadrid&timeformat=unixtime';
const FALLBACK_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=41.3874&lon=2.1686';
const CACHE_MS = 300_000, RETRY_MS = 30_000;
const names: Record<number, string> = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Snow', 73: 'Snow', 75: 'Snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorm' };
interface WeatherOptions { fetchImpl?: typeof fetch; now?: () => number }
type Attempt = NonNullable<Weather['diagnostics']>[number];
function safeError(attempt: Attempt, error: unknown, began: number, now: number) {
  if (attempt.outcome === 'network_error') attempt.error = ['AbortError', 'TimeoutError', 'TypeError'].includes((error as Error)?.name) ? (error as Error).name : 'NetworkError';
  attempt.elapsedMs = Math.max(0, now - began);
}
function forecastDescription(symbol: string) {
  const condition = symbol.replace(/_(day|night|polartwilight)$/, '');
  const clear: Record<string, string> = { clearsky: 'Clear sky', fair: 'Mainly clear', partlycloudy: 'Partly cloudy', cloudy: 'Overcast', fog: 'Fog' };
  if (clear[condition]) return clear[condition];
  if (!/(rain|snow|sleet)/.test(condition)) return undefined;
  const intensity = condition.startsWith('light') ? 'Light ' : condition.startsWith('heavy') ? 'Heavy ' : '';
  const precipitation = condition.includes('snow') ? 'snow' : condition.includes('sleet') ? 'sleet' : 'rain';
  const description = intensity + precipitation + (condition.includes('showers') ? ' showers' : '') + (condition.includes('thunder') ? ' and thunder' : '');
  return description[0].toUpperCase() + description.slice(1);
}

/** Only fixed provider/status/error-class metadata is exposed. No upstream bodies or request headers. */
export function createWeatherService(options: WeatherOptions = {}) {
  const request = options.fetchImpl ?? fetch, clock = options.now ?? Date.now;
  let cached: Weather | undefined, lastResult: Weather | undefined, nextCheck = 0, pending: Promise<Weather> | undefined;
  let metData: any, metExpires = 0, metLastModified: string | undefined, metRetrievedAt: string | undefined;
  async function refresh(): Promise<Weather> {
    const began = clock(), checkedAt = new Date(began).toISOString();
    const attempts: Attempt[] = [];
    const attempt: Attempt = { source: 'Open-Meteo', outcome: 'network_error', elapsedMs: 0 }; attempts.push(attempt);
    try {
      const response = await request(PRIMARY_URL, { signal: AbortSignal.timeout(4000), redirect: 'manual' });
      attempt.status = response.status;
      if (!response.ok) { attempt.outcome = 'http_error'; throw new Error('weather_http_error'); }
      let data: any;
      try { data = await response.json(); } catch { attempt.outcome = 'invalid_data'; throw new Error('weather_invalid_json'); }
      const temperature = data?.current?.temperature_2m, code = data?.current?.weather_code, seconds = data?.current?.time;
      if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < -70 || temperature > 65
        || typeof code !== 'number' || !Number.isInteger(code) || !names[code]
        || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds * 1000 > clock() + 1_800_000 || seconds * 1000 < clock() - 7_200_000) {
        attempt.outcome = 'invalid_data'; throw new Error('weather_invalid_data');
      }
      attempt.outcome = 'live'; attempt.elapsedMs = Math.max(0, clock() - began);
      const retrievedAt = new Date(clock()).toISOString();
      cached = { temperature, description: names[code], code, isRain: [51,53,55,61,63,65,80,81,82,95].includes(code), retrievedAt, checkedAt, validAt: new Date(seconds * 1000).toISOString(), source: 'Open-Meteo', dataKind: 'current-model', status: 'live', timeZone: 'Europe/Madrid', diagnostics: attempts };
      nextCheck = clock() + CACHE_MS;
      return lastResult = cached;
    } catch (error) {
      safeError(attempt, error, began, clock());
    }
    const fallbackBegan = clock(), fallback: Attempt = { source: 'MET Norway', outcome: 'network_error', elapsedMs: 0 }; attempts.push(fallback);
    try {
      if (!metData || clock() >= metExpires) {
        const headers: Record<string, string> = { 'User-Agent': 'ExpatiaWorld/0.1 https://expatia.world' };
        if (metLastModified) headers['If-Modified-Since'] = metLastModified;
        const response = await request(FALLBACK_URL, { headers, signal: AbortSignal.timeout(4000), redirect: 'follow' });
        fallback.status = response.status;
        if (!response.ok && response.status !== 304) { fallback.outcome = 'http_error'; throw new Error('weather_http_error'); }
        if (response.status !== 304) {
          try { metData = await response.json(); } catch { fallback.outcome = 'invalid_data'; throw new Error('weather_invalid_json'); }
          metRetrievedAt = new Date(clock()).toISOString();
          metLastModified = response.headers.get('Last-Modified') ?? undefined;
        }
        const expires = Date.parse(response.headers.get('Expires') ?? '');
        metExpires = Number.isFinite(expires) && expires > clock() ? expires : clock() + CACHE_MS;
      } else { fallback.cached = true; }
      const points: any[] = metData?.properties?.timeseries;
      const point = Array.isArray(points) ? points.filter(value => value && Number.isFinite(Date.parse(value.time)) && Date.parse(value.time) <= clock()).sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).at(-1) : undefined;
      const period = point?.data?.next_1_hours ?? point?.data?.next_6_hours;
      const symbol = period?.summary?.symbol_code;
      const description = typeof symbol === 'string' ? forecastDescription(symbol) : undefined;
      const temperature = point?.data?.instant?.details?.air_temperature;
      const validAt = point?.time, updated = metData?.properties?.meta?.updated_at;
      if (!point || typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < -70 || temperature > 65 || !description
        || clock() - Date.parse(validAt) > 5_400_000 || !Number.isFinite(Date.parse(updated)) || Date.parse(updated) > clock() + 300_000 || clock() - Date.parse(updated) > 86_400_000
        || metData?.properties?.meta?.units?.air_temperature !== 'celsius' || !metRetrievedAt) {
        fallback.outcome = 'invalid_data'; throw new Error('weather_invalid_data');
      }
      fallback.outcome = 'live'; fallback.elapsedMs = Math.max(0, clock() - fallbackBegan);
      cached = { temperature, description, code: null, isRain: /rain|sleet/.test(symbol), retrievedAt: metRetrievedAt, checkedAt, validAt, modelUpdatedAt: updated, source: 'MET Norway', dataKind: 'current-forecast', cacheExpiresAt: new Date(metExpires).toISOString(), status: 'live', timeZone: 'Europe/Madrid', diagnostics: attempts };
      nextCheck = clock() + CACHE_MS;
      return lastResult = cached;
    } catch (error) {
      safeError(fallback, error, fallbackBegan, clock());
      if (fallback.outcome === 'invalid_data') { metData = undefined; metExpires = 0; metLastModified = undefined; }
    }
    nextCheck = clock() + RETRY_MS;
    return lastResult = cached ? { ...cached, status: 'stale', checkedAt, diagnostics: attempts }
      : { temperature: null, description: 'Weather unavailable', code: null, isRain: false, retrievedAt: checkedAt, checkedAt, status: 'offline', timeZone: 'Europe/Madrid', diagnostics: attempts };
  }
  return async function getWeather(): Promise<Weather> {
    if (lastResult && clock() < nextCheck) return lastResult;
    if (!pending) pending = refresh().finally(() => { pending = undefined; });
    return pending;
  };
}
export const getWeather = createWeatherService();
