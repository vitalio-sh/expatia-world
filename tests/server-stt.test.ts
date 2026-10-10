import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { WorkerVoice } from '../src/server/worker-voice';
import { attachRealtime } from '../src/server/realtime';
import { transcribe } from '../src/server/voice';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
class ProviderSocket extends EventEmitter {
  readyState = 1;
  frames: any[] = [];
  accepted = false;
  send(data: string) { this.frames.push(JSON.parse(data)); }
  accept() { this.accepted = true; }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
  addEventListener(type: string, handler: (event: any) => void) { this.on(type, handler); }
  native(message: unknown) { this.emit('message', { data: JSON.stringify(message) }); }
  node(message: unknown) { this.emit('message', Buffer.from(JSON.stringify(message))); }
}
function memoryAccounting() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'WebSocketPair');
  Object.defineProperty(globalThis, 'WebSocketPair', { configurable: true, value: class {} });
  return () => { if (previous) Object.defineProperty(globalThis, 'WebSocketPair', previous); else Reflect.deleteProperty(globalThis, 'WebSocketPair'); };
}
function workerFixture() {
  const previousFetch = globalThis.fetch, restoreAccounting = memoryAccounting();
  const requests: URL[] = [], provider = new ProviderSocket(), messages: any[] = [], transcripts: string[] = [];
  globalThis.fetch = async input => { requests.push(new URL(String(input))); return { status: 101, webSocket: provider } as unknown as Response; };
  const voice = new WorkerVoice({ readyState: 1, send: data => messages.push(JSON.parse(data)) }, { ELEVENLABS_API_KEY: 'unit-test-placeholder' }, 'stt-test', { onTranscript: (_turn, text) => transcripts.push(text) });
  return { voice, provider, requests, messages, transcripts, close() { voice.dispose(); globalThis.fetch = previousFetch; restoreAccounting(); } };
}

test('Worker STT defaults to Spanish, explicitly selects English, and rejects unsupported languages before connection', async () => {
  for (const [language, expected] of [[undefined, 'es'], ['es', 'es'], ['en', 'en']] as const) {
    const f = workerFixture();
    try {
      f.voice.handle({ type: 'stt.start', turnId: 'mic', ...(language ? { language } : {}) }); await settle();
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].searchParams.get('language_code'), expected);
      assert.equal(f.requests[0].searchParams.get('commit_strategy'), 'manual');
      f.provider.native({ message_type: 'session_started' });
      assert.equal(f.messages.find(packet => packet.type === 'stt.ready')?.language, expected);
      f.voice.handle({ type: 'stt.audio', turnId: 'mic', audio: Buffer.alloc(6400).toString('base64') });
      f.voice.handle({ type: 'stt.commit', turnId: 'mic' });
      f.provider.native({ message_type: 'committed_transcript', text: expected === 'es' ? 'Estoy en casa.' : 'I am at home.' });
      assert.equal(f.messages.find(packet => packet.type === 'stt.final')?.language, expected);
    } finally { f.close(); }
  }
  for (const language of ['ar', 'hi', 'spa', 'EN', null, { language: 'es' }]) {
    const f = workerFixture();
    try {
      f.voice.handle({ type: 'stt.start', turnId: 'invalid', language }); await settle();
      assert.equal(f.requests.length, 0);
      assert.match(f.messages[0]?.error, /Spanish or English/);
      assert.equal(f.messages[0]?.turnId, 'invalid');
    } finally { f.close(); }
  }
});

test('Worker STT preserves audio queued during connection and commits a brief turn only after all its chunks', async () => {
  const f = workerFixture();
  try {
    const audio = Buffer.alloc(3200, 4).toString('base64');
    f.voice.handle({ type: 'stt.start', turnId: 'short' });
    f.voice.handle({ type: 'stt.audio', turnId: 'short', audio });
    f.voice.handle({ type: 'stt.audio', turnId: 'wrong', audio });
    f.voice.handle({ type: 'stt.commit', turnId: 'short' });
    f.voice.handle({ type: 'stt.commit', turnId: 'short' });
    await settle(); assert.equal(f.provider.frames.length, 0);
    f.provider.native({ message_type: 'session_started' });
    assert.equal(f.provider.frames.length, 2);
    assert.deepEqual(f.provider.frames.map(frame => frame.commit), [false, true]);
    assert.equal(f.provider.frames[0].audio_base_64, audio);
    assert.equal(f.provider.frames.reduce((bytes, frame) => bytes + Buffer.from(frame.audio_base_64, 'base64').length, 0), 64000);
    f.provider.native({ message_type: 'committed_transcript', text: 'Sí.' });
    assert.deepEqual(f.transcripts, ['Sí.']);
  } finally { f.close(); }
});

test('Worker STT retains provider segments before push-to-talk release instead of truncating later speech', async () => {
  const f = workerFixture();
  try {
    f.voice.handle({ type: 'stt.start', turnId: 'segments' }); await settle();
    f.provider.native({ message_type: 'session_started' });
    f.voice.handle({ type: 'stt.audio', turnId: 'segments', audio: Buffer.alloc(3200).toString('base64') });
    f.provider.native({ message_type: 'committed_transcript', text: 'Hola,' });
    assert.equal(f.messages.some(packet => packet.type === 'stt.final'), false);
    assert.equal(f.provider.readyState, 1);
    f.voice.handle({ type: 'stt.audio', turnId: 'segments', audio: Buffer.alloc(3200).toString('base64') });
    f.provider.native({ message_type: 'partial_transcript', text: 'estoy junto al bar.' });
    assert.equal(f.messages.at(-1)?.text, 'Hola, estoy junto al bar.');
    f.voice.handle({ type: 'stt.commit', turnId: 'segments' });
    f.provider.native({ message_type: 'committed_transcript', text: 'estoy junto al bar.' });
    assert.deepEqual(f.transcripts, ['Hola, estoy junto al bar.']);
    f.provider.native({ message_type: 'committed_transcript_with_timestamps', text: 'duplicate' });
    assert.equal(f.messages.filter(packet => packet.type === 'stt.final').length, 1);
  } finally { f.close(); }
});

test('Worker STT grants finalization time after a long recording and rejects late events after interruption', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = workerFixture();
  try {
    f.voice.handle({ type: 'stt.start', turnId: 'long' }); await settle();
    f.provider.native({ message_type: 'session_started' });
    t.mock.timers.tick(17000);
    f.voice.handle({ type: 'stt.commit', turnId: 'long' });
    t.mock.timers.tick(9000);
    assert.equal(f.messages.some(packet => packet.type === 'stt.error'), false);
    t.mock.timers.tick(1001);
    assert.match(f.messages.at(-1)?.error, /Transcription timed out/);
    f.provider.native({ message_type: 'committed_transcript', text: 'too late' });
    assert.deepEqual(f.transcripts, []);
  } finally { f.close(); }
  const interrupted = workerFixture();
  try {
    interrupted.voice.handle({ type: 'stt.start', turnId: 'cancelled' }); await settle();
    interrupted.provider.native({ message_type: 'session_started' });
    interrupted.voice.handle({ type: 'interrupt', turnId: 'typed' });
    interrupted.provider.native({ message_type: 'committed_transcript', text: 'stale microphone result' });
    assert.equal(interrupted.messages.some(packet => packet.type === 'stt.final'), false);
    assert.deepEqual(interrupted.transcripts, []);
  } finally { interrupted.close(); }
});

test('cancelling Worker STT closes transcription without cancelling a courier action', async () => {
  const f = workerFixture();
  let speechCancellations = 0, interrupts = 0;
  try {
    (f.voice as any).callbacks.onInterrupt = () => interrupts++;
    f.voice.handle({ type: 'stt.start', turnId: 'recording-at-deadline' }); await settle();
    f.provider.native({ message_type: 'session_started' });
    // The deadline controller starts its courier action after microphone capture.
    (f.voice as any).active = { turnId: 'timeout-courier', cancel: () => speechCancellations++ };
    const before = interrupts;
    f.voice.handle({ type: 'stt.cancel' });
    assert.equal(f.provider.readyState, 3);
    assert.equal(speechCancellations, 0);
    assert.equal(interrupts, before);
    f.provider.native({ message_type: 'committed_transcript', text: 'stale direction' });
    assert.deepEqual(f.transcripts, []);
    f.voice.handle({ type: 'interrupt' });
    assert.equal(speechCancellations, 1);
    assert.equal(interrupts, before + 1);
  } finally { f.close(); }
});

test('Node realtime applies the same Spanish/English contract and keeps audio until manual release', async () => {
  const previousKey = process.env.ELEVENLABS_API_KEY, restoreAccounting = memoryAccounting();
  // The hello prewarm is deliberately unconfigured; no test may contact a provider.
  delete process.env.ELEVENLABS_API_KEY;
  const server = createServer(), requests: URL[] = [], providers: ProviderSocket[] = [], transcripts: string[] = [];
  let interrupts = 0;
  const realtime = attachRealtime(server, { verifySession: id => id === 'node-stt-test', onInterrupt: () => interrupts++, onTranscript: (_session, _turn, text) => transcripts.push(text), connectTranscription: url => { requests.push(new URL(url)); const socket = new ProviderSocket(); providers.push(socket); return socket as unknown as WebSocket; } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/realtime`), messages: any[] = [];
  client.on('message', raw => messages.push(JSON.parse(raw.toString())));
  const waitFor = async (type: string, turnId?: string) => { for (let i = 0; i < 100; i++) { const packet = messages.find(message => message.type === type && (!turnId || message.turnId === turnId)); if (packet) return packet; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error(`Missing ${type}`); };
  try {
    await once(client, 'open'); client.send(JSON.stringify({ type: 'hello', sessionId: 'node-stt-test' })); await waitFor('voice.prepared');
    process.env.ELEVENLABS_API_KEY = 'unit-test-placeholder';
    client.send(JSON.stringify({ type: 'stt.start', turnId: 'bad', language: 'hi' })); await waitFor('stt.error');
    assert.equal(requests.length, 0);
    client.send(JSON.stringify({ type: 'stt.start', turnId: 'node' }));
    while (!providers.length) await settle();
    assert.equal(requests[0].searchParams.get('language_code'), 'es');
    providers[0].node({ message_type: 'session_started' });
    assert.equal((await waitFor('stt.ready')).language, 'es');
    providers[0].node({ message_type: 'committed_transcript', text: 'Estoy' });
    await settle(); assert.equal(messages.some(packet => packet.type === 'stt.final'), false);
    client.send(JSON.stringify({ type: 'stt.audio', turnId: 'node', audio: Buffer.alloc(3200).toString('base64') }));
    client.send(JSON.stringify({ type: 'stt.commit', turnId: 'node' }));
    while (!providers[0].frames.some(frame => frame.commit)) await settle();
    providers[0].node({ message_type: 'committed_transcript', text: 'en casa.' });
    const final = await waitFor('stt.final'); assert.equal(final.language, 'es'); assert.equal(final.text, 'Estoy en casa.');
    assert.deepEqual(transcripts, ['Estoy en casa.']);
    await new Promise(resolve => setTimeout(resolve, 810));
    client.send(JSON.stringify({ type: 'stt.start', turnId: 'english', language: 'en' }));
    while (providers.length < 2) await settle();
    assert.equal(requests[1].searchParams.get('language_code'), 'en');
    providers[0].emit('unexpected-response', {}, { statusCode: 401 });
    providers[1].node({ message_type: 'session_started' });
    assert.equal((await waitFor('stt.ready', 'english')).language, 'en');
    assert.equal(messages.some(packet => packet.type === 'stt.error' && packet.turnId === 'english'), false);
    const before = interrupts;
    client.send(JSON.stringify({ type: 'stt.cancel', turnId: 'english' }));
    while (providers[1].readyState !== 3) await settle();
    assert.equal(interrupts, before);
    providers[1].node({ message_type: 'committed_transcript', text: 'cancelled result' });
    await settle();
    assert.equal(messages.some(packet => packet.type === 'stt.final' && packet.turnId === 'english'), false);
  } finally {
    if (client.readyState !== WebSocket.CLOSED) { const closed = once(client, 'close'); client.close(); await closed; }
    realtime.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = previousKey;
    restoreAccounting();
  }
});

test('file transcription explicitly uses Spanish by default and validates the English override before fetch', async () => {
  const previousFetch = globalThis.fetch, previousKey = process.env.ELEVENLABS_API_KEY, restoreAccounting = memoryAccounting();
  const languages: unknown[] = [];
  process.env.ELEVENLABS_API_KEY = 'unit-test-placeholder';
  globalThis.fetch = async (_input, init) => { languages.push((init?.body as FormData).get('language_code')); return Response.json({ text: ' Estoy aquí. ' }); };
  try {
    assert.equal((await transcribe(Buffer.alloc(3200), 'audio/wav')).language, 'es');
    assert.equal((await transcribe(Buffer.alloc(3200), 'audio/wav', undefined, 'en')).language, 'en');
    assert.deepEqual(languages, ['es', 'en']);
    await assert.rejects(transcribe(Buffer.alloc(3200), 'audio/wav', undefined, 'ar' as 'es'), /unsupported_transcription_language/);
    assert.equal(languages.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = previousKey;
    restoreAccounting();
  }
});
