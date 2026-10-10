import { recordUsage, type UsageEntry } from './usage';

const runtimeEnv = () => typeof process !== 'undefined' ? process.env : {};
let configured: Record<string, string | undefined> = {};
export let DIALOGUE_MODEL = runtimeEnv().EXPATIA_DIALOGUE_MODEL || 'google/gemini-3.5-flash-lite';
export let COURIER_VOICE = runtimeEnv().EXPATIA_COURIER_VOICE || 'iP95p4xoKVk53GoZ742B';
export const ELEVEN_MODEL = 'eleven_v4_turbo';
export function configureProviders(env: Record<string, string | undefined>) {
  configured = { ...env };
  DIALOGUE_MODEL = env.EXPATIA_DIALOGUE_MODEL || runtimeEnv().EXPATIA_DIALOGUE_MODEL || DIALOGUE_MODEL;
  COURIER_VOICE = env.EXPATIA_COURIER_VOICE || runtimeEnv().EXPATIA_COURIER_VOICE || COURIER_VOICE;
}
export function providerKey(name: string) { return configured[name] || runtimeEnv()[name]; }

export interface ModelUsage {
  prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}
export function accountModelUsage(usage?: ModelUsage): Partial<UsageEntry> {
  return usage ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens, cachedInputTokens: usage.prompt_tokens_details?.cached_tokens, reasoningTokens: usage.completion_tokens_details?.reasoning_tokens, costUsd: usage.cost } : {};
}

/** Match service diagnostics, never ordinary in-world uncertainty such as “no entiendo”. */
export function isServiceErrorText(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const text = value.trim();
  return /^(?:\{\s*"(?:error|status|statusCode)"\s*:|\[\s*\{\s*"error"\s*:|(?:openrouter|elevenlabs|provider|upstream|websocket|stt)[_:-](?:error|http|stream|timeout|not_configured)|(?:call |voice |microphone |game |the game )?connection (?:closed|failed|lost|timed out|interrupted|unavailable)|(?:live voice|voice transcription|speech|transcription|microphone transcription) (?:unavailable|failed|timed out)|game request (?:failed|timed out)|error:\s*(?:connection|provider|service|upstream|network|HTTP))/i.test(text);
}

function streamFrameError(chunk: any, eventType: string): boolean {
  const choice = chunk?.choices?.[0];
  return eventType === 'error' || !!chunk?.error || chunk?.type === 'error' || chunk?.object === 'error' || Number(chunk?.status ?? chunk?.status_code) >= 400 || !!choice?.error || !!choice?.delta?.error || choice?.finish_reason === 'error';
}

/** Node transport: IPv4 avoids intermittent local dual-stack connection failures.
 * A Worker adapter can replace this function with fetch without changing prompts. */
export async function providerRequest(url: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  if ('WebSocketPair' in globalThis) return fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const { request: httpsRequest } = await import('node:https');
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = httpsRequest(url, { method: 'POST', family: 4, headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(json)) } }, res => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          res.on('data', chunk => controller.enqueue(new Uint8Array(chunk)));
          res.on('end', () => { try { controller.close(); } catch { /* cancelled */ } });
          res.on('error', error => { try { controller.error(error); } catch { /* cancelled */ } });
        },
        cancel() { res.destroy(); req.destroy(); },
      });
      resolve(new Response(stream, { status: res.statusCode || 500 }));
    });
    const abort = () => req.destroy(new DOMException('Request cancelled', 'AbortError'));
    if (signal?.aborted) { abort(); reject(signal.reason); return; }
    signal?.addEventListener('abort', abort, { once: true });
    req.on('error', reject);
    req.on('close', () => signal?.removeEventListener('abort', abort));
    req.setTimeout(12_000, () => req.destroy(new Error('provider_timeout')));
    req.end(json);
  });
}

export async function openRouterStream(messages: { role: string; content: string }[], onText: (text: string) => void, signal?: AbortSignal, metadata: { sessionId?: string; turnId?: string | number; operation?: string } = {}) {
  const started = performance.now();
  if (!providerKey('OPENROUTER_API_KEY')) throw new Error('openrouter_not_configured');
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const decoder = new TextDecoder();
  let pending = '', text = '', eventType = '', usage: ModelUsage | undefined, firstTextMs: number | undefined, requestId: string | undefined;
  try {
    const response = await providerRequest('https://openrouter.ai/api/v1/chat/completions', {
      model: DIALOGUE_MODEL, messages, stream: true, max_tokens: 110, temperature: 0.5,
    }, { Authorization: `Bearer ${providerKey('OPENROUTER_API_KEY')}`, 'HTTP-Referer': 'https://expatia.world', 'X-Title': 'Expatia World' }, signal);
    if (!response.ok) throw new Error(`openrouter_http_${response.status}`);
    if (!response.body) throw new Error('openrouter_empty_stream');
    reader = response.body.getReader();
    const consume = (raw: string) => {
      const line = raw.trim();
      if (!line) { eventType = ''; return; }
      if (line.startsWith('event:')) { eventType = line.slice(6).trim(); return; }
      if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') return;
      const chunk = JSON.parse(line.slice(5).trim());
      if (streamFrameError(chunk, eventType)) throw new Error('openrouter_stream_error');
      requestId ||= typeof chunk.id === 'string' ? chunk.id : undefined;
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        if (isServiceErrorText(delta)) throw new Error('openrouter_service_payload');
        firstTextMs ??= performance.now() - started; text += delta; onText(delta);
      }
    };
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1); consume(line);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
    const elapsedMs = performance.now() - started;
    recordUsage({ provider: 'openrouter', operation: metadata.operation || 'dialogue', model: DIALOGUE_MODEL, ...metadata, ...accountModelUsage(usage), requestId, elapsedMs, firstTextMs, live: true, outcome: 'complete' });
    return { text, usage, timings: { firstTextMs, elapsedMs }, model: DIALOGUE_MODEL, live: true };
  } catch (error) {
    recordUsage({ provider: 'openrouter', operation: metadata.operation || 'dialogue', model: DIALOGUE_MODEL, ...metadata, ...accountModelUsage(usage), requestId, elapsedMs: performance.now() - started, firstTextMs, live: false, outcome: signal?.aborted ? 'cancelled' : 'error', error: error instanceof Error ? error.name : 'error' });
    throw error;
  } finally { if (reader) { try { await reader.cancel(); } catch { /* already failed */ } reader.releaseLock(); } }
}
