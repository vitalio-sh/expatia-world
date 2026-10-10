/** Free-host adapter: one accepted WebSocket owns one complete short scenario.
 * It never assumes another HTTP request reaches the same Worker isolate. */
import { answerCall, createGame, handoff, moveResident, npcContext, publicGame, recordSpeech, tickGame } from './game.js';
import { decide, resolveTimeout, type DecisionOptions } from './jev.js';
import { generateDialogue, type DialogueResult } from './dialogue.js';
import { configureProviders } from './providers.js';
import { WorkerVoice } from './worker-voice.js';
import { recordUsage, usageSummary } from './usage.js';
import { getWeather } from './weather.js';
import type { Decision, Game, Weather } from '../shared/world.js';

export interface WorkerEnv {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  EXPATIA_SESSION_SECRET?: string; JEV_API_KEY?: string; OPENROUTER_API_KEY?: string; ELEVENLABS_API_KEY?: string;
  EXPATIA_DIALOGUE_MODEL?: string; EXPATIA_COURIER_VOICE?: string;
  [name: string]: unknown;
}
export interface WorkerSocket {
  readyState: number; accept?(): void; send(data: string): void; close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}
interface VoiceTurn { sendPhrase(text: string): void; finish(): Promise<unknown>; cancel(): void }
interface VoiceAdapter { prepare(): Promise<boolean>; createTurn(turnId: string, signal?: AbortSignal): Promise<VoiceTurn>; handle(message: Record<string, any>): void; dispose(): void }
interface Dependencies {
  clock?: () => number; timers?: boolean; voice?: VoiceAdapter;
  decisionOptions?: DecisionOptions;
  dialogue?: (context: unknown, decision: unknown, signal?: AbortSignal, onPhrase?: (phrase: string) => void) => Promise<DialogueResult>;
}
export interface RpcResult { status: number; result?: Record<string, unknown>; error?: string }
interface Capability { v: 1; id: string; exp: number; issuedAt: number }
const CAPABILITY_TTL = 10 * 60_000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const securityHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'microphone=(self), geolocation=()' };
const encoder = new TextEncoder(), decoder = new TextDecoder();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: securityHeaders });
function base64url(bytes: Uint8Array) { let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unbase64url(value: string) { const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, character => character.charCodeAt(0)); }
async function hmacKey(secret: string) { return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function signCapability(id: string, secret: string, now = Date.now()) {
  if (secret.length < 32) throw new Error('session_secret_not_configured');
  const body = base64url(encoder.encode(JSON.stringify({ v: 1, id, exp: now + CAPABILITY_TTL, issuedAt: now } satisfies Capability)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}
export async function verifyCapability(token: string, secret: string, now = Date.now()): Promise<Capability | null> {
  try {
    if (secret.length < 32 || token.length > 800 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const [body, signature] = token.split('.');
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), unbase64url(signature), encoder.encode(body))) return null;
    const value = JSON.parse(decoder.decode(unbase64url(body))) as Capability;
    if (value.v !== 1 || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.id)
      || !Number.isSafeInteger(value.exp) || !Number.isSafeInteger(value.issuedAt)
      || value.issuedAt > now + 5_000 || value.exp <= now || value.exp - value.issuedAt !== CAPABILITY_TTL) return null;
    return value;
  } catch { return null; }
}
export function allowedOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  return origin === null || origin === new URL(request.url).origin;
}

export function createWorkerSession(client: WorkerSocket, sessionId: string, env: WorkerEnv, weather: Weather, dependencies: Dependencies = {}) {
  const clock = dependencies.clock ?? Date.now;
  const game = createGame(weather, clock()); game.id = sessionId;
  let controller: AbortController | undefined, currentTurn: string | undefined, disposed = false;
  let dialogueLive: boolean | undefined, lastMove = clock(), lastActivity = clock(), timeoutRunning = false, arrival = 0;
  let turns = 0;
  const completed = new Map<string, Promise<RpcResult>>();
  const send = (message: Record<string, unknown>) => {
    if (disposed || client.readyState !== 1) return;
    try { client.send(JSON.stringify({ sessionId, ...message })); } catch { dispose(); }
  };
  const voice = dependencies.voice ?? new WorkerVoice(client as any, env as any, sessionId, {
    onInterrupt: () => controller?.abort(),
    onPlaybackTiming: (turnId: string | number, timings: Record<string, number>) => recordUsage({ provider: 'browser', operation: 'playback', sessionId, turnId, ...timings, elapsedMs: timings.speechEndToFirstScheduledMs, live: true }),
  });
  const getState = () => ({ ...publicGame(game, clock()), dialogueLive, usage: usageSummary(sessionId), realtimeRpc: true, connectionOwned: true });
  function beginTurn(turnId: string) {
    controller?.abort();
    if (currentTurn) send({ type: 'npc.cancel', turnId: currentTurn });
    controller = new AbortController(); currentTurn = turnId;
    return controller.signal;
  }
  async function speak(decision: Partial<Decision> | null, turnId: string, signal: AbortSignal) {
    let speech: VoiceTurn | undefined;
    try { speech = await voice.createTurn(turnId, signal); } catch {
      signal.throwIfAborted(); send({ type: 'npc.audio_error', turnId, error: 'Live voice unavailable. Subtitles remain available.' });
    }
    signal.throwIfAborted();
    let words = '';
    const reply = await (dependencies.dialogue ?? generateDialogue)({ ...npcContext(game, clock()), sessionId, turnId }, decision?.action ?? decision, signal, phrase => {
      if (disposed || signal.aborted || currentTurn !== turnId) return;
      words += (words ? ' ' : '') + phrase;
      const existing = game.history.find(entry => entry.role === 'courier' && entry.turnId === turnId);
      if (existing) existing.text = words; else recordSpeech(game, phrase, turnId, clock());
      if (speech) speech.sendPhrase(phrase); else send({ type: 'npc.caption', turnId, text: phrase });
    });
    if (disposed || signal.aborted || currentTurn !== turnId) throw new DOMException('Turn replaced', 'AbortError');
    dialogueLive = reply.live;
    send({ type: 'dialogue.status', turnId, live: reply.live, model: reply.model });
    if (speech) void speech.finish().then(() => { if (!disposed && game.phase === 'active') void voice.prepare(); }).catch(() => {});
    return reply;
  }
  const decisionOptions = () => ({ ...dependencies.decisionOptions, now: clock, key: dependencies.decisionOptions?.key ?? env.JEV_API_KEY });
  function tick() {
    if (disposed) return;
    const now = clock();
    if (game.phase === 'active' || game.phase === 'timeout') tickGame(game, now);
    if (game.phase === 'timeout' && game.timeoutPending && !timeoutRunning) {
      timeoutRunning = true;
      const turnId = `timeout-${crypto.randomUUID()}`, signal = beginTurn(turnId);
      void resolveTimeout(game, signal, decisionOptions()).then(decision => {
        if (!decision?.discarded && !disposed && !signal.aborted) return speak(decision, turnId, signal);
      }).catch(() => {});
    }
    if (game.arrivalSequence !== arrival) {
      arrival = game.arrivalSequence;
      const home = game.phase === 'active' && game.routeTargetId === 'home-south';
      const drop = game.phase === 'resolved' && game.parcel === 'drop';
      if (home || drop) {
        const turnId = `arrival-${arrival}`, signal = beginTurn(turnId);
        const action = { id: 'arrival', type: 'wait' as const, label: home ? 'Wait at the home entrance for the resident to accept the parcel' : 'Explain that the parcel is physically at the collection shop', reason: home ? 'Real arrival occurred; parcel is still with the courier.' : game.outcome!.detail };
        void speak({ action }, turnId, signal).catch(() => {});
      }
    }
    if (now - lastActivity > CAPABILITY_TTL) { send({ type: 'session.expired', error: 'This call expired. Start a new call.' }); dispose(); client.close(1000, 'Call expired'); }
  }
  async function perform(path: string, body: Record<string, any>): Promise<RpcResult> {
    if (disposed) return { status: 410, error: 'This call ended. Start a new call.' };
    lastActivity = clock(); tick();
    const base = `/api/session/${sessionId}`;
    if (!path.startsWith(base) || (path !== base && path[base.length] !== '/')) return { status: 404, error: 'Unknown call action.' };
    const action = path.slice(base.length);
    if (!action || action === '/') return { status: 200, result: { game: getState() } };
    if (action === '/answer') {
      if (!answerCall(game, clock())) return { status: 200, result: { game: getState() } };
      const turnId = String(body.turnId ?? 'opening').slice(0, 80), signal = beginTurn(turnId);
      void decide(game, '', signal, decisionOptions()).then(decision => {
        if (!decision?.discarded && !signal.aborted && game.phase === 'active') return speak(decision, turnId, signal);
      }).catch(() => {});
      return { status: 200, result: { game: getState() } };
    }
    if (action === '/turn') {
      if (game.phase !== 'active') return { status: 409, error: 'The call window has ended.', result: { game: getState() } };
      const text = String(body.text ?? '').trim().slice(0, 500);
      if (!text) return { status: 400, error: 'Say or type a direction first.' };
      if (turns >= 24) return { status: 429, error: 'Give the courier a moment to listen.' };
      turns++;
      const turnId = String(body.turnId ?? crypto.randomUUID()).slice(0, 80), signal = beginTurn(turnId), started = performance.now();
      try {
        const decision = await decide(game, text, signal, decisionOptions());
        if (signal.aborted || currentTurn !== turnId || decision?.discarded) return { status: 409, error: 'A newer turn or world change replaced this direction.', result: { game: getState() } };
        tick();
        if (game.phase !== 'active') return { status: 200, result: { game: getState() } };
        const reply = await speak(decision, turnId, signal);
        return { status: 200, result: { game: getState(), timings: { decisionMs: decision?.elapsedMs, ...reply.timings, totalMs: performance.now() - started } } };
      } catch {
        return signal.aborted ? { status: 409, error: 'The conversation moved on.', result: { game: getState() } } : { status: 503, error: 'The connection paused. Try a shorter direction.', result: { game: getState() } };
      }
    }
    if (action === '/move') {
      const now = clock(), elapsed = Math.max(0, (now - lastMove) / 1000); lastMove = now;
      moveResident(game, Number(body.dx), Number(body.dy), Math.min(Number(body.dt) || 0, elapsed, 0.15));
      return { status: 200, result: { game: getState() } };
    }
    if (action === '/handoff') {
      if (!handoff(game, clock())) return { status: 409, error: 'Meet the courier at your entrance before the deadline.', result: { game: getState() } };
      controller?.abort(); voice.dispose();
      return { status: 200, result: { game: getState() } };
    }
    if (action === '/end') { controller?.abort(); voice.dispose(); return { status: 200, result: { ok: true } }; }
    return { status: 404, error: 'Unknown call action.' };
  }
  async function rpc(requestId: string, path: string, body: Record<string, any> = {}) {
    if (!requestId || requestId.length > 100 || typeof path !== 'string' || path.length > 200 || !body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, error: 'Invalid call request.' } satisfies RpcResult;
    let pending = completed.get(requestId);
    if (!pending) { pending = perform(path, body); completed.set(requestId, pending); if (completed.size > 256) completed.delete(completed.keys().next().value!); }
    const result = await pending;
    send({ type: 'rpc.result', requestId, status: result.status, result: result.result, error: result.error });
    if (path.endsWith('/end')) { dispose(); client.close(1000, 'Call ended'); }
    return result;
  }
  function message(packet: Record<string, any>) {
    if (disposed || (packet.sessionId && packet.sessionId !== sessionId)) return;
    if (packet.type === 'rpc') { void rpc(String(packet.requestId ?? ''), packet.path, packet.body ?? {}).catch(() => send({ type: 'rpc.result', requestId: packet.requestId, status: 500, error: 'The call connection paused.' })); return; }
    if (packet.type === 'interrupt') { controller?.abort(); game.sequence++; }
    if (String(packet.type).startsWith('stt.') && game.phase !== 'active') { send({ type: 'stt.error', turnId: packet.turnId, error: 'Answer the call before recording directions.' }); return; }
    voice.handle(packet);
  }
  let ticker: ReturnType<typeof setInterval> | undefined;
  function dispose() { if (disposed) return; disposed = true; controller?.abort(); game.sequence++; voice.dispose(); if (ticker) clearInterval(ticker); }
  if (dependencies.timers !== false) ticker = setInterval(tick, 50);
  return { game, rpc, message, tick, dispose, getState, prepare: () => voice.prepare() };
}

declare const WebSocketPair: { new(): { 0: WorkerSocket; 1: WorkerSocket } };
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if ((request.method === 'POST' || url.pathname === '/realtime') && !allowedOrigin(request)) return json({ error: 'This action requires the game origin.' }, 403);
    if (url.pathname.startsWith('/api/art/')) {
      if (!['GET','HEAD'].includes(request.method)) return json({ error: 'Read-only art endpoint.' }, 405);
      if (!env.ASSETS) return new Response('Art unavailable.', { status: 503 });
      const assetUrl = new URL(request.url); assetUrl.pathname = assetUrl.pathname.slice(4);
      const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (asset.headers.get('Content-Type')?.includes('text/html')) return new Response('Art asset not found.', { status: 404 });
      const headers = new Headers(asset.headers);
      if (url.pathname.endsWith('.webp')) headers.set('Content-Type', 'image/webp');
      headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Cache-Control', 'public, max-age=60, must-revalidate');
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
    }
    if (url.pathname === '/api/health') return json({ ok: true, product: 'Expatia World', speech: 'eleven_v4_turbo', deployment: 'connection-owned-worker', build: '0.1.0' });
    if (url.pathname === '/api/weather') return json(await getWeather());
    if (url.pathname === '/api/session' && request.method === 'POST') {
      if (!env.EXPATIA_SESSION_SECRET || env.EXPATIA_SESSION_SECRET.length < 32) return json({ error: 'Game session signing is not configured.' }, 503);
      const game = createGame(await getWeather());
      const token = await signCapability(game.id, env.EXPATIA_SESSION_SECRET);
      return json({ game: publicGame(game), token, realtimeRpc: true, connectionOwned: true });
    }
    if (url.pathname === '/realtime') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'A realtime connection is required.' }, 426);
      const token = url.searchParams.get('token') ?? '', capability = await verifyCapability(token, env.EXPATIA_SESSION_SECRET ?? '');
      if (!capability) return json({ error: 'This call expired or is unavailable. Start a new call.' }, 401);
      configureProviders(env as any);
      const weather = await getWeather(), pair = new WebSocketPair(), client = pair[0], server = pair[1];
      server.accept?.();
      let session: ReturnType<typeof createWorkerSession> | undefined, initializing = false;
      const helloTimeout = setTimeout(() => { if (!session) server.close(1008, 'Session required'); }, 5_000);
      server.addEventListener('message', event => {
        if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_BYTES) { session?.dispose(); server.close(1009, 'Message too large'); return; }
        let packet: Record<string, any>;
        try { packet = JSON.parse(event.data); if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('invalid'); } catch { server.close(1008, 'Invalid message'); return; }
        if (!session) {
          if (initializing || packet.type !== 'hello' || packet.sessionId !== capability.id || (packet.token && packet.token !== token)) { server.close(1008, 'Invalid session'); return; }
          initializing = true; clearTimeout(helloTimeout);
          session = createWorkerSession(server, capability.id, env, weather);
          server.send(JSON.stringify({ type: 'ready', sessionId: capability.id, speechModel: 'eleven_v4_turbo', transcriptionModel: 'scribe_v2_realtime', realtimeRpc: true, connectionOwned: true }));
          void session.prepare().then(live => { if (server.readyState === 1) server.send(JSON.stringify({ type: 'voice.prepared', sessionId: capability.id, live })); }).catch(() => {});
          return;
        }
        session.message(packet);
      });
      const end = () => { clearTimeout(helloTimeout); session?.dispose(); };
      server.addEventListener('close', end); server.addEventListener('error', end);
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }
    if (url.pathname.startsWith('/api/session/')) return json({ error: 'Use the call realtime connection for this action.', realtimeRpc: true }, 409);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Unknown game endpoint.' }, 404);
    if (!env.ASSETS) return new Response('Expatia World assets are not configured.', { status: 503, headers: securityHeaders });
    const asset = await env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/art/')) {
      if (asset.headers.get('Content-Type')?.includes('text/html')) return new Response('Art asset not found.', { status: 404 });
      const headers = new Headers(asset.headers);
      if (url.pathname.endsWith('.webp')) headers.set('Content-Type', 'image/webp');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
    }
    return asset;
  },
};
