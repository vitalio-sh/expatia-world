import type { Weather } from '../shared/world';

const PRIMARY_URL = 'https://api.open-meteo.com/v1/forecast?latitude=41.3874&longitude=2.1686&current=temperature_2m,weather_code&timezone=Europe%2FMadrid&timeformat=unixtime';
const CACHE_MS = 300_000, RETRY_MS = 30_000;
const names: Record<number, string> = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Snow', 73: 'Snow', 75: 'Snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorm' };
interface WeatherOptions { fetchImpl?: typeof fetch; now?: () => number }

/** Only fixed provider/status/error-class metadata is exposed. No upstream bodies or request headers. */
export function createWeatherService(options: WeatherOptions = {}) {
  const request = options.fetchImpl ?? fetch, clock = options.now ?? Date.now;
  let cached: Weather | undefined, lastResult: Weather | undefined, nextCheck = 0, pending: Promise<Weather> | undefined;
  async function refresh(): Promise<Weather> {
    const began = clock(), checkedAt = new Date(began).toISOString();
    const attempt: NonNullable<Weather['diagnostics']>[number] = { source: 'Open-Meteo', outcome: 'network_error', elapsedMs: 0 };
    try {
      const response = await request(PRIMARY_URL, { signal: AbortSignal.timeout(4000), redirect: 'manual' });
      attempt.status = response.status;
      if (!response.ok) { attempt.outcome = 'http_error'; throw new Error('weather_http_error'); }
      let data: any;
      try { data = await response.json(); } catch { attempt.outcome = 'invalid_data'; throw new Error('weather_invalid_json'); }
      const temperature = data.current?.temperature_2m, code = data.current?.weather_code, seconds = data.current?.time;
      if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < -70 || temperature > 65
        || typeof code !== 'number' || !Number.isInteger(code) || !names[code]
        || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds * 1000 > clock() + 1_800_000 || seconds * 1000 < clock() - 7_200_000) {
        attempt.outcome = 'invalid_data'; throw new Error('weather_invalid_data');
      }
      attempt.outcome = 'live'; attempt.elapsedMs = Math.max(0, clock() - began);
      const retrievedAt = new Date(clock()).toISOString();
      cached = { temperature, description: names[code], code, isRain: [51,53,55,61,63,65,80,81,82,95].includes(code), retrievedAt, checkedAt, validAt: new Date(seconds * 1000).toISOString(), source: 'Open-Meteo', status: 'live', timeZone: 'Europe/Madrid', diagnostics: [attempt] };
      nextCheck = clock() + CACHE_MS;
      return lastResult = cached;
    } catch (error) {
      if (attempt.outcome === 'network_error') attempt.error = ['AbortError', 'TimeoutError', 'TypeError'].includes((error as Error)?.name) ? (error as Error).name : 'NetworkError';
      attempt.elapsedMs = Math.max(0, clock() - began);
      nextCheck = clock() + RETRY_MS;
      return lastResult = cached ? { ...cached, status: 'stale', checkedAt, diagnostics: [attempt] }
        : { temperature: null, description: 'Weather unavailable', code: null, isRain: false, retrievedAt: checkedAt, checkedAt, status: 'offline', timeZone: 'Europe/Madrid', diagnostics: [attempt] };
    }
  }
  return async function getWeather(): Promise<Weather> {
    if (lastResult && clock() < nextCheck) return lastResult;
    if (!pending) pending = refresh().finally(() => { pending = undefined; });
    return pending;
  };
}
export const getWeather = createWeatherService();
