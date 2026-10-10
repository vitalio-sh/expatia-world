import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { allowedOrigin, createWorkerSession, signCapability, verifyCapability, type WorkerSocket } from '../src/server/worker.js';
import { DEFAULT_WEATHER, HOME_ENTRANCE } from '../src/shared/world.js';

const NOW = Date.parse('2026-10-10T10:00:00Z'), SECRET = 'a-test-only-signing-secret-of-more-than-32-characters';
const SESSION_ID = '11111111-1111-4111-a111-111111111111';
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
class Socket implements WorkerSocket {
  readyState = 1; messages: any[] = []; closed = false;
  send(data: string) { this.messages.push(JSON.parse(data)); }
  close() { this.closed = true; this.readyState = 3; }
  addEventListener() {}
}
function fixture(replyPhrases?: string[]) {
  let now = NOW, dialogueCalls = 0, voiceMessages = 0, disposed = false;
  const socket = new Socket();
  const voice = {
    async prepare() { return true; },
    async createTurn(_id: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      return { sendPhrase(_text: string) {}, async finish() {}, cancel() {} };
    },
    handle() { voiceMessages++; }, dispose() { disposed = true; },
  };
  const session = createWorkerSession(socket, SESSION_ID, {}, DEFAULT_WEATHER, {
    clock: () => now, timers: false, voice, decisionOptions: { key: '', telemetry: false },
    dialogue: async (_context, _decision, signal, onPhrase) => {
      signal?.throwIfAborted(); dialogueCalls++;
      const text = dialogueCalls === 1 ? 'I am beside a bar. Which way should I come?' : `Courier reply number ${dialogueCalls}.`;
      const phrases = dialogueCalls > 1 && replyPhrases ? replyPhrases : [text];
      for (const phrase of phrases) onPhrase?.(phrase);
      return { text: phrases.join(' '), model: 'test-fixture', live: false };
    },
  });
  return { session, socket, advance: (ms: number) => { now += ms; }, clock: () => now, counts: () => ({ dialogueCalls, voiceMessages, disposed }) };
}
const path = (suffix = '') => `/api/session/${SESSION_ID}${suffix}`;

test('Worker capabilities bind session, expire, and reject tampering or weak secrets', async () => {
  const token = await signCapability(SESSION_ID, SECRET, NOW);
  assert.equal((await verifyCapability(token, SECRET, NOW + 1))?.id, SESSION_ID);
  assert.equal(await verifyCapability(token, SECRET, NOW + 600_000), null);
  assert.equal(await verifyCapability(token, 'different-key-with-sufficient-signing-length', NOW), null);
  const [body, signature] = token.split('.');
  const modified = Buffer.from(JSON.stringify({ v: 1, id: '22222222-2222-4222-a222-222222222222', exp: NOW + 600_000, issuedAt: NOW })).toString('base64url');
  assert.equal(await verifyCapability(`${modified}.${signature}`, SECRET, NOW), null);
  assert.equal(await verifyCapability(`${body}.${signature.slice(0, -3)}zzz`, SECRET, NOW), null);
  await assert.rejects(() => signCapability(SESSION_ID, 'short', NOW));
});
test('Worker HTTP origin and signing configuration fail closed; mutations require realtime owner', async () => {
  assert.equal(allowedOrigin(new Request('https://expatia.world/api/session', { headers: { Origin: 'https://expatia.world' } })), true);
  const foreign = new Request('https://expatia.world/api/session', { method: 'POST', headers: { Origin: 'https://evil.invalid' } });
  assert.equal((await worker.fetch(foreign, {})).status, 403);
  assert.equal((await worker.fetch(new Request('https://expatia.world/api/session', { method: 'POST' }), {})).status, 503);
  assert.equal((await worker.fetch(new Request(`https://expatia.world${path('/answer')}`, { method: 'POST' }), {})).status, 409);
  assert.equal((await worker.fetch(new Request('https://expatia.world/realtime', { headers: { Upgrade: 'websocket' } }), { EXPATIA_SESSION_SECRET: SECRET })).status, 401);
  const response = await worker.fetch(new Request('https://expatia.world/api/health'), {});
  assert.equal((await response.json() as { deployment: string }).deployment, 'connection-owned-worker');
});
test('Worker static asset delegation preserves original request and does not serialize secrets', async () => {
  const req = new Request('https://expatia.world/art/barcelona-map.webp'); let supplied: Request | undefined;
  const response = await worker.fetch(req, { EXPATIA_SESSION_SECRET: SECRET, JEV_API_KEY: 'fixture-private-key', ASSETS: { fetch: async request => { supplied = request; return new Response('asset'); } } });
  assert.equal(supplied, req); assert.equal(await response.text(), 'asset');
});
test('Worker game belongs to a single connection; no HTTP isolate map is needed', async () => {
  const f = fixture(), other = fixture();
  const before = await f.session.rpc('get1', path());
  assert.equal((before.result?.game as any).phase, 'incoming'); assert.equal((before.result?.game as any).deadline, null);
  f.advance(120_000); f.session.tick();
  await f.session.rpc('answer1', path('/answer'), { turnId: 'opening' });
  assert.equal(f.session.game.deadline, NOW + 180_000);
  assert.equal(other.session.game.deadline, null); assert.equal(other.session.game.phase, 'incoming');
  f.advance(10_000); await f.session.rpc('answer2', path('/answer'));
  assert.equal(f.session.game.deadline, NOW + 180_000);
  assert.ok(f.socket.messages.every(packet => packet.sessionId === SESSION_ID));
  assert.equal(f.socket.messages.find(packet => packet.requestId === 'answer1')?.type, 'rpc.result');
  f.session.dispose(); other.session.dispose();
});
test('duplicate Worker RPC request shares one decision and one exact history entry', async () => {
  const f = fixture(); await f.session.rpc('answer', path('/answer')); await settle();
  const [first, second] = await Promise.all([f.session.rpc('same-turn', path('/turn'), { text: 'Wait', turnId: 'player1' }), f.session.rpc('same-turn', path('/turn'), { text: 'Wait', turnId: 'player1' })]);
  assert.equal(first.status, 200); assert.deepEqual(second, first);
  assert.equal(f.session.game.history.filter(entry => entry.role === 'player' && entry.text === 'Wait').length, 1);
  assert.equal(f.counts().dialogueCalls, 2); f.session.dispose();
});
test('Worker RPC world and spoken phrase history use one scenario state', async () => {
  const f = fixture(); await f.session.rpc('answer', path('/answer')); await settle();
  const turn = await f.session.rpc('turn', path('/turn'), { text: 'The entrance is on the south side of my building', turnId: 'direction' });
  assert.equal(turn.status, 200); assert.equal(f.session.game.routeTargetId, 'home-south');
  assert.equal(f.session.game.facts.homeSide, 'south');
  assert.ok(f.session.game.history.some(entry => entry.role === 'courier' && entry.text === 'I am beside a bar. Which way should I come?'));
  assert.ok(f.session.game.history.some(entry => entry.role === 'courier' && entry.turnId === 'direction'));
  assert.equal((turn.result?.game as any).inspector.source, 'fallback'); f.session.dispose();
});
test('Worker deadline backgrounding is authoritative and invalid handoff never grants parcel', async () => {
  const f = fixture(); await f.session.rpc('answer', path('/answer')); await settle();
  assert.equal((await f.session.rpc('early', path('/handoff'))).status, 409);
  Object.assign(f.session.game.courier, HOME_ENTRANCE);
  f.advance(60_000);
  const expired = await f.session.rpc('late', path('/handoff'));
  assert.equal(expired.status, 409); assert.notEqual(f.session.game.parcel, 'resident'); assert.equal(f.session.game.deadline, NOW + 60_000);
  assert.equal((expired.result?.game as any).remainingMs, 0); f.session.dispose();
});
test('Worker valid handoff resolves world state and closes provider voice', async () => {
  const f = fixture(); await f.session.rpc('answer', path('/answer')); await settle();
  Object.assign(f.session.game.courier, HOME_ENTRANCE);
  const result = await f.session.rpc('handoff', path('/handoff'));
  assert.equal(result.status, 200); assert.equal(f.session.game.parcel, 'resident'); assert.equal(f.session.game.outcome?.kind, 'received'); assert.equal(f.counts().disposed, true);
  f.session.dispose();
});
test('Worker player turn cap bounds provider work within one round', async () => {
  const f = fixture(); await f.session.rpc('answer', path('/answer')); await settle();
  for (let i = 0; i < 24; i++) assert.equal((await f.session.rpc(`turn${i}`, path('/turn'), { text: 'Wait', turnId: `player${i}` })).status, 200);
  assert.equal((await f.session.rpc('too-many', path('/turn'), { text: 'Wait' })).status, 429);
  assert.equal(f.session.game.history.filter(entry => entry.role === 'player').length, 24); f.session.dispose();
});
test('Worker microphone is unavailable before answering and cross-session messages cannot act', () => {
  const f = fixture();
  f.session.message({ type: 'stt.start', sessionId: SESSION_ID, turnId: 'mic' });
  assert.equal(f.counts().voiceMessages, 0); assert.equal(f.socket.messages.at(-1).type, 'stt.error');
  f.session.message({ type: 'rpc', sessionId: 'different-session', requestId: 'bad', path: path('/answer') });
  assert.equal(f.session.game.phase, 'incoming'); f.session.dispose();
});
test('Worker ignores resident movement and wrong-path RPC cannot act', async () => {
  const f = fixture(); const y = f.session.game.resident.y;
  await f.session.rpc('move1', path('/move'), { dx: 0, dy: 1, dt: 10 });
  assert.equal(f.session.game.resident.y, y);
  f.advance(100); await f.session.rpc('move2', path('/move'), { dx: 0, dy: 1, dt: 10 });
  assert.equal(f.session.game.resident.y, y);
  assert.equal(f.session.game.resident.moving, false);
  assert.equal((await f.session.rpc('bad-path', '/api/session/another/answer')).status, 404);
  assert.equal(f.session.game.phase, 'incoming'); f.session.dispose();
});
test('Worker interrupt rejects a late direction and disconnect tears down providers', async () => {
  const socket = new Socket(); let now = NOW, release!: () => void, disposed = false;
  const session = createWorkerSession(socket, SESSION_ID, {}, DEFAULT_WEATHER, { clock: () => now, timers: false, decisionOptions: { key: '', telemetry: false },
    voice: { async prepare() { return true; }, async createTurn() { return { sendPhrase() {}, async finish() {}, cancel() {} }; }, handle() {}, dispose() { disposed = true; } },
    dialogue: async (_c, _d, signal, onPhrase) => { await new Promise<void>(resolve => { release = resolve; }); signal?.throwIfAborted(); onPhrase?.('Late reply.'); return { text: 'Late reply.', model: 'test', live: false }; },
  });
  await session.rpc('answer', path('/answer')); await settle(); release(); await settle();
  const pending = session.rpc('pending', path('/turn'), { text: 'Wait', turnId: 'pending' }); await settle();
  session.message({ type: 'interrupt', sessionId: SESSION_ID, turnId: 'next' }); release();
  assert.equal((await pending).status, 409);
  assert.ok(!session.game.history.some(entry => entry.turnId === 'pending' && entry.role === 'courier'));
  session.dispose(); assert.equal(disposed, true); assert.equal((await session.rpc('closed', path())).status, 410);
});


test('Worker streaming retains the final clarification and one coherent courier turn', async () => {
  const phrases = ['Vale.', 'Recuerdo tu edificio.', '¿En qué lado está tu portal?'];
  const f = fixture(phrases);
  try {
    await f.session.rpc('answer', path('/answer')); await settle();
    await f.session.rpc('question', path('/turn'), {text:'Ven a mi portal.',turnId:'clarification'});
    const entries=f.session.game.history.filter(h=>h.role==='courier'&&h.turnId==='clarification');
    assert.equal(entries.length,1);
    assert.equal(entries[0].text,phrases.join(' '));
    assert.equal(f.session.game.facts.lastClarification,phrases.join(' '));
    await f.session.rpc('side', path('/turn'), {text:'Por el sur.',turnId:'south-answer'});
    assert.equal(f.session.game.routeTargetId,'home-south');
  } finally {f.session.dispose();}
});

test('interrupting an unspoken greeting preserves the next command and its history instead of reopening onboarding', async () => {
  const socket = new Socket(); let releaseOpening!: () => void, dialogueCalls = 0;
  const contexts: any[] = [];
  const session = createWorkerSession(socket, SESSION_ID, {}, DEFAULT_WEATHER, { clock: () => NOW, timers: false, decisionOptions: { key: '', telemetry: false },
    voice: { async prepare() { return true; }, async createTurn() { return { sendPhrase() {}, async finish() {}, cancel() {} }; }, handle() {}, dispose() {} },
    dialogue: async (context, _decision, signal, onPhrase) => {
      contexts.push(context); dialogueCalls++;
      if (dialogueCalls === 1) await new Promise<void>(resolve => { releaseOpening = resolve; });
      signal?.throwIfAborted();
      const text = 'Voy hacia tu entrada por el sur.'; onPhrase?.(text);
      return { text, model: 'test-fixture', live: false };
    },
  });
  try {
    await session.rpc('answer', path('/answer')); await settle();
    assert.equal(session.game.facts.firstClueSpoken, false);
    session.message({ type: 'interrupt', sessionId: SESSION_ID }); releaseOpening();
    const text = 'Mi portal está en el lado sur. Ven a la entrada.';
    const result = await session.rpc('spoken-command', path('/turn'), { text, turnId: 'microphone-command' });
    assert.equal(result.status, 200);
    assert.equal(session.game.facts.homeSide, 'south');
    assert.equal(session.game.routeTargetId, 'home-south');
    assert.deepEqual(session.game.history.filter(entry => entry.role === 'player').map(entry => entry.text), [text]);
    assert.equal(contexts.at(-1).policy.includes('FIRST CLUE'), false);
    assert.equal(contexts.at(-1).history.filter((entry: any) => entry.role === 'player').at(-1).text, text);
    assert.equal(session.game.history.some(entry => entry.role === 'courier' && entry.turnId === 'opening'), false);
  } finally { session.dispose(); }
});

test('interrupting after visible speech preserves its words and applied route for the next player question', async () => {
  const socket = new Socket(); let releaseReply!: () => void, dialogueCalls = 0;
  const contexts: any[] = [];
  const session = createWorkerSession(socket, SESSION_ID, {}, DEFAULT_WEATHER, { clock: () => NOW, timers: false, decisionOptions: { key: '', telemetry: false },
    voice: { async prepare() { return true; }, async createTurn(turnId) { return { sendPhrase(text) { socket.send(JSON.stringify({ type: 'npc.caption', turnId, text })); }, async finish() {}, cancel() {} }; }, handle() {}, dispose() {} },
    dialogue: async (context, _decision, signal, onPhrase) => {
      contexts.push(context); dialogueCalls++;
      const text = dialogueCalls === 1 ? '¿Por qué lado está tu portal?' : 'Voy hacia tu portal por el sur.';
      onPhrase?.(text);
      if (dialogueCalls === 2) await new Promise<void>(resolve => { releaseReply = resolve; });
      signal?.throwIfAborted();
      return { text, model: 'test-fixture', live: false };
    },
  });
  try {
    await session.rpc('answer', path('/answer')); await settle();
    const moving = session.rpc('moving', path('/turn'), { text: 'Mi portal está en el lado sur. Ven a la entrada.', turnId: 'visible-moving' });
    await settle();
    assert.equal(session.game.routeTargetId, 'home-south');
    assert.equal(session.game.courier.moving, true);
    assert.ok(socket.messages.some(packet => packet.type === 'npc.caption' && packet.text === 'Voy hacia tu portal por el sur.'));
    session.message({ type: 'interrupt', sessionId: SESSION_ID });
    assert.equal(session.game.routeTargetId, 'home-south');
    assert.equal(session.game.courier.moving, true);
    releaseReply(); assert.equal((await moving).status, 409);
    assert.equal((await session.rpc('question', path('/turn'), { text: '¿Qué ves ahora?', turnId: 'next-question' })).status, 200);
    assert.equal(session.game.routeTargetId, 'home-south');
    assert.ok(contexts.at(-1).history.some((entry: any) => entry.role === 'courier' && entry.text === 'Voy hacia tu portal por el sur.'));
    assert.equal(session.game.history.filter(entry => entry.role === 'courier' && entry.turnId === 'visible-moving').length, 1);
  } finally { session.dispose(); }
});

function boundedMovementFixture(holdCommand = false) {
  const socket = new Socket(); let now = NOW, releaseCommand!: () => void;
  const replies: { id: string; signal?: AbortSignal }[] = [];
  const session = createWorkerSession(socket, SESSION_ID, {}, DEFAULT_WEATHER, {
    clock: () => now, timers: false, decisionOptions: { key: '', telemetry: false },
    voice: { async prepare() { return true; }, async createTurn() { return { sendPhrase() {}, async finish() {}, cancel() {} }; }, handle() {}, dispose() {} },
    dialogue: async (_context, decision: any, signal, onPhrase) => {
      replies.push({ id: decision?.id, signal });
      if (holdCommand && replies.length === 2) await new Promise<void>(resolve => { releaseCommand = resolve; });
      signal?.throwIfAborted();
      const text = decision?.id === 'visibility-stop' ? 'Me he parado; dime por dónde sigo.' : 'Voy hacia el portal por el sur.';
      onPhrase?.(text); return { text, model: 'test-fixture', live: false };
    },
  });
  return { session, replies, advance(ms: number) { now += ms; session.tick(); }, release() { releaseCommand(); } };
}

test('Worker visible movement stop reports surroundings once, stays still, and requires a new continue command', async () => {
  const f = boundedMovementFixture();
  try {
    await f.session.rpc('answer', path('/answer')); await settle();
    const direction = await f.session.rpc('direction', path('/turn'), { text: 'Mi portal, eh, está en la de sur.', turnId: 'direction' });
    assert.equal(direction.status, 200);
    assert.equal(f.session.game.facts.homeSide, 'south');
    assert.equal(f.session.game.courier.moving, true);
    f.advance(4_000); await settle();
    const stop = { x: f.session.game.courier.x, y: f.session.game.courier.y };
    assert.equal(f.session.game.awaitingGuidance, true);
    assert.equal(f.session.game.routeComplete, false);
    assert.equal(f.session.getState().canHandoff, false);
    assert.deepEqual(f.session.game.routeDestination, HOME_ENTRANCE);
    assert.equal(f.session.game.route.length, 0);
    assert.equal(f.replies.filter(reply => reply.id === 'visibility-stop').length, 1);
    assert.ok(Math.hypot(stop.x - HOME_ENTRANCE.x, stop.y - HOME_ENTRANCE.y) > 32);
    f.advance(2_000); await settle();
    assert.deepEqual({ x: f.session.game.courier.x, y: f.session.game.courier.y }, stop);
    assert.equal(f.session.game.courier.moving, false);
    assert.equal(f.replies.filter(reply => reply.id === 'visibility-stop').length, 1);
    assert.equal(f.replies.filter(reply => reply.id === 'arrival').length, 0);
    const next = await f.session.rpc('continue', path('/turn'), { text: 'Sí, sigue.', turnId: 'continue' });
    assert.equal(next.status, 200); assert.equal(f.session.game.courier.moving, true);
    assert.deepEqual(f.session.game.routeDestination, HOME_ENTRANCE);
    f.advance(500); await settle();
    assert.ok(Math.hypot(f.session.game.courier.x - stop.x, f.session.game.courier.y - stop.y) > 1);
    assert.equal(f.session.game.facts.homeSide, 'south');
  } finally { f.session.dispose(); }
});

test('Worker defers visibility-stop speech until the pending player reply completes without aborting it', async () => {
  const f = boundedMovementFixture(true);
  try {
    await f.session.rpc('answer', path('/answer')); await settle();
    const pending = f.session.rpc('direction', path('/turn'), { text: 'Mi portal está en el lado sur.', turnId: 'held-direction' });
    await settle();
    assert.equal(f.replies.length, 2); assert.equal(f.session.game.courier.moving, true);
    const commandSignal = f.replies[1].signal;
    f.advance(4_000); await settle();
    assert.equal(f.session.game.awaitingGuidance, true);
    assert.equal(commandSignal?.aborted, false);
    assert.equal(f.replies.filter(reply => reply.id === 'visibility-stop').length, 0);
    f.release(); assert.equal((await pending).status, 200);
    assert.equal(commandSignal?.aborted, false);
    f.advance(1); await settle();
    assert.equal(f.replies.filter(reply => reply.id === 'visibility-stop').length, 1);
    assert.equal(f.session.game.courier.moving, false);
    assert.ok(f.session.game.history.some(entry => entry.role === 'courier' && entry.turnId === 'held-direction' && entry.text === 'Voy hacia el portal por el sur.'));
    f.advance(1_000); await settle();
    assert.equal(f.replies.filter(reply => reply.id === 'visibility-stop').length, 1);
  } finally { f.session.dispose(); }
});
