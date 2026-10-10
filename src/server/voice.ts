import WebSocket from 'ws';
import { COURIER_VOICE, ELEVEN_MODEL } from './providers';
import { recordUsage } from './usage';
import { cleanSpeech } from './dialogue';

export type RelayClient = { readyState: number; send(data: string): void };
export type TurnId = string | number;
export interface SpeechResult { live: boolean; model: string; characters: number; audioBytes: number; timings: { connectMs: number; firstAudioMs?: number; elapsedMs: number }; error?: string }
export interface SpeechTurn { sendPhrase(text: string): void; finish(): Promise<SpeechResult>; cancel(): void }
type WarmConnection = { socket: WebSocket; ready: Promise<void>; created: number; heartbeat: ReturnType<typeof setInterval>; expiry: ReturnType<typeof setTimeout> };
const warm = new Map<string, WarmConnection>();
const active = new Map<string, { turnId: TurnId; cancel: () => void }>();

export function relay(client: RelayClient | undefined, message: unknown) {
  if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
}
function openVoice(): { socket: WebSocket; ready: Promise<void> } {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('eleven_not_configured');
  const socket = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=${ELEVEN_MODEL}&output_format=pcm_24000`, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, handshakeTimeout: 8_000, maxPayload: 2 * 1024 * 1024 });
  const ready = new Promise<void>((resolve, reject) => {
    socket.once('open', () => { socket.send(JSON.stringify({ voices: [COURIER_VOICE] })); resolve(); });
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => { reject(new Error(`eleven_http_${response.statusCode}`)); socket.terminate(); });
  });
  // Retain an error listener after the readiness Promise resolves.
  socket.on('error', () => {});
  return { socket, ready };
}

/** Prepare while the incoming call is visible. A socket belongs exclusively to one utterance. */
export async function prewarmSpeech(sessionId: string): Promise<boolean> {
  const existing = warm.get(sessionId);
  if (existing) { try { await existing.ready; return true; } catch { return false; } }
  if (warm.size >= 6 || !process.env.ELEVENLABS_API_KEY) return false;
  const created = performance.now();
  const { socket, ready } = openVoice();
  const heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ keep_alive: true })); }, 10_000);
  const expiry = setTimeout(() => releaseWarm(sessionId), 90_000);
  const connection = { socket, ready, created, heartbeat, expiry };
  warm.set(sessionId, connection);
  try { await ready; return true; }
  catch { if (warm.get(sessionId) === connection) releaseWarm(sessionId); return false; }
}
function releaseWarm(sessionId: string) {
  const connection = warm.get(sessionId);
  if (!connection) return;
  warm.delete(sessionId); clearInterval(connection.heartbeat); clearTimeout(connection.expiry); connection.socket.terminate();
}
export function cancelSpeech(sessionId: string) { active.get(sessionId)?.cancel(); }
export function closeSpeech(sessionId: string) { cancelSpeech(sessionId); releaseWarm(sessionId); }

export async function createSpeechTurn(sessionId: string, turnId: TurnId, client: RelayClient, signal?: AbortSignal): Promise<SpeechTurn> {
  cancelSpeech(sessionId);
  signal?.throwIfAborted();
  const started = performance.now();
  let connection = warm.get(sessionId);
  if (connection) { warm.delete(sessionId); clearInterval(connection.heartbeat); clearTimeout(connection.expiry); }
  if (!connection || connection.socket.readyState === WebSocket.CLOSED || connection.socket.readyState === WebSocket.CLOSING) {
    const opened = openVoice(); connection = { ...opened, created: started, heartbeat: setInterval(() => {}, 60_000), expiry: setTimeout(() => {}, 60_000) }; clearInterval(connection.heartbeat); clearTimeout(connection.expiry);
  }
  const socket = connection.socket;
  await connection.ready;
  signal?.throwIfAborted();
  const connectMs = performance.now() - started;
  let textSent: number | undefined, firstAudioMs: number | undefined, audioBytes = 0, characters = 0, settled = false, closing = false;
  let resolveResult!: (value: SpeechResult) => void;
  const result = new Promise<SpeechResult>(resolve => { resolveResult = resolve; });
  const timer = setTimeout(() => finish('speech_timeout'), 20_000);
  const abort = () => finish('cancelled');
  const isOwner = () => active.get(sessionId)?.turnId === turnId && !signal?.aborted && !settled;
  function finish(error?: string) {
    if (settled) return; settled = true;
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (active.get(sessionId)?.cancel === abort) active.delete(sessionId);
    socket.terminate();
    const measured: SpeechResult = { live: !error && audioBytes > 0, model: ELEVEN_MODEL, characters, audioBytes, timings: { connectMs, firstAudioMs, elapsedMs: performance.now() - started }, ...(error ? { error } : {}) };
    recordUsage({ provider: 'elevenlabs', operation: 'ttd-stream', sessionId, turnId, model: ELEVEN_MODEL, characters, audioBytes, audioSeconds: audioBytes / 48_000, firstAudioMs, elapsedMs: measured.timings.elapsedMs, live: measured.live, outcome: error || 'complete', estimatedCostUsd: characters / 1000 * .04 });
    relay(client, { type: error === 'cancelled' ? 'npc.cancel' : error ? 'npc.audio_error' : 'npc.audio_end', sessionId, turnId, live: measured.live, error, timings: measured.timings });
    resolveResult(measured);
  }
  active.set(sessionId, { turnId, cancel: abort }); signal?.addEventListener('abort', abort, { once: true });
  relay(client, { type: 'npc.audio_begin', sessionId, turnId, format: 'pcm_24000', model: ELEVEN_MODEL });
  socket.on('message', frame => {
    if (!isOwner()) return;
    try {
      const message = JSON.parse(frame.toString());
      if (message.error) { finish(`eleven_${String(message.error).slice(0, 60)}`); return; }
      if (message.audio) {
        const bytes = Buffer.from(message.audio, 'base64');
        if (bytes.length) { firstAudioMs ??= performance.now() - (textSent || started); audioBytes += bytes.length; relay(client, { type: 'npc.audio', sessionId, turnId, format: 'pcm_24000', audio: message.audio }); }
      }
      if (message.is_final) finish(audioBytes ? undefined : 'empty_audio');
    } catch { finish('invalid_audio_event'); }
  });
  socket.on('error', () => finish('eleven_connection_error'));
  socket.on('close', () => { if (!settled) finish('eleven_closed_before_final'); });
  return {
    sendPhrase(raw) {
      if (!isOwner() || closing) return;
      const text = cleanSpeech(raw);
      if (!text || characters + text.length > 700) return;
      textSent ??= performance.now(); characters += text.length;
      relay(client, { type: 'npc.caption', sessionId, turnId, text });
      socket.send(JSON.stringify({ inputs: [{ text: `${text} `, voice_id: COURIER_VOICE, new_turn: false }] }));
      socket.send(JSON.stringify({ flush: true }));
    },
    finish() { if (!settled && !closing) { closing = true; socket.send(JSON.stringify({ close_socket: true })); } return result; },
    cancel: abort,
  };
}

export async function streamSpeech(text: string, sessionId: string, turnId: TurnId, client: RelayClient, signal?: AbortSignal): Promise<SpeechResult> {
  try { const stream = await createSpeechTurn(sessionId, turnId, client, signal); stream.sendPhrase(text); return stream.finish(); }
  catch (error) {
    signal?.throwIfAborted();
    relay(client, { type: 'npc.audio_error', sessionId, turnId, error: 'speech_unavailable', live: false });
    return { live: false, model: ELEVEN_MODEL, characters: 0, audioBytes: 0, timings: { connectMs: 0, elapsedMs: 0 }, error: error instanceof Error ? error.message : 'speech_unavailable' };
  }
}

export async function transcribe(buffer: Buffer, mimeType: string, signal?: AbortSignal, language: 'es' | 'en' = 'es') {
  const started = performance.now();
  if (language !== 'es' && language !== 'en') throw new Error('unsupported_transcription_language');
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('transcription_not_configured');
  if (buffer.length > 2 * 1024 * 1024) throw new Error('audio_too_large');
  const form = new FormData();
  form.set('model_id', 'scribe_v2'); form.set('tag_audio_events', 'false'); form.set('language_code', language);
  form.set('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), mimeType.includes('wav') ? 'turn.wav' : 'turn.webm');
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`transcription_http_${response.status}`);
  const json = await response.json() as { text?: string };
  const elapsedMs = performance.now() - started;
  recordUsage({ provider: 'elevenlabs', operation: 'stt-file-fallback', model: 'scribe_v2', elapsedMs, live: true, outcome: 'complete' });
  return { text: String(json.text || '').trim(), language, model: 'scribe_v2', live: true, elapsedMs };
}
