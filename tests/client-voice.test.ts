import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeVoice } from '../src/client/voice';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class TestSocket {
  static OPEN = 1;
  readyState = TestSocket.OPEN;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  constructor() { queueMicrotask(() => this.onopen?.()); }
  send(frame: string) {
    const message = JSON.parse(frame); this.sent.push(message);
    if (message.type === 'hello') queueMicrotask(() => this.emit({ type: 'ready' }));
  }
  emit(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

async function fixture(getUserMedia: () => Promise<MediaStream>) {
  const descriptors = new Map(['navigator', 'location', 'WebSocket'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let socket!: TestSocket;
  class ConnectedSocket extends TestSocket { constructor() { super(); socket = this; } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://voice.test/', protocol: 'https:' } });
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: ConnectedSocket });
  const statuses: string[] = [], transcripts: string[] = [], captions: string[] = [];
  const voice = new RealtimeVoice({ onStatus: status => statuses.push(status), onTranscript: text => transcripts.push(text), onCaption: text => captions.push(text) });
  const nodes: { disconnected: boolean; connect(): void; disconnect(): void; gain: { value: number }; onaudioprocess: unknown }[] = [];
  const node = () => { const value = { disconnected: false, connect() {}, disconnect() { this.disconnected = true; }, gain: { value: 1 }, onaudioprocess: null as unknown }; nodes.push(value); return value; };
  const context = { sampleRate: 48_000, destination: {}, createMediaStreamSource: node, createScriptProcessor: node, createGain: node } as unknown as AudioContext;
  voice.player.unlock = async () => context;
  await voice.connect('voice-test-session');
  return {
    voice, socket, statuses, transcripts, captions, nodes, context,
    cleanup() {
      voice.disconnect();
      for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    },
  };
}

function microphone() {
  let stopped = 0;
  return { stream: { getTracks: () => [{ stop: () => stopped++ }] } as unknown as MediaStream, get stopped() { return stopped; } };
}

test('typing during microphone permission releases a late stream and keeps the typed turn active', async () => {
  const permission = deferred<MediaStream>(), requested = deferred<void>(), mic = microphone();
  const f = await fixture(() => { requested.resolve(); return permission.promise; });
  try {
    const starting = f.voice.startRecording('mic-pending'); await requested.promise;
    assert.equal(f.voice.isRecording, true);
    f.voice.interrupt(); f.voice.beginTurn('typed-answer');
    permission.resolve(mic.stream);
    assert.equal(await starting, false);
    assert.equal(f.voice.isRecording, false);
    assert.equal(mic.stopped, 1);
    assert.equal(f.socket.sent.some(message => message.type === 'stt.start'), false);
    f.socket.emit({ type: 'npc.caption', turnId: 'typed-answer', text: 'Typed reply remains current.' });
    assert.deepEqual(f.captions, ['Typed reply remains current.']);
    assert.equal(f.statuses.includes('recording'), false);
  } finally { f.cleanup(); }
});

test('interrupt cancels capture and rejects pending STT while normal release commits its original turn', async () => {
  const mic = microphone(), f = await fixture(async () => mic.stream);
  try {
    assert.equal(await f.voice.startRecording('mic-committed'), true);
    const committed = f.voice.stopRecording();
    assert.equal(f.voice.isRecording, false);
    assert.deepEqual(f.socket.sent.filter(message => message.type === 'stt.commit').map(message => message.turnId), ['mic-committed']);
    f.socket.emit({ type: 'stt.final', turnId: 'mic-committed', text: 'Go south.', model: 'scribe_v2_realtime', live: true, elapsedMs: 100 });
    assert.equal((await committed).turnId, 'mic-committed');

    assert.equal(await f.voice.startRecording('mic-cancelled'), true);
    const cancelled = f.voice.stopRecording();
    f.voice.interrupt();
    await assert.rejects(cancelled, /Recording cancelled/);
    f.socket.emit({ type: 'stt.final', turnId: 'mic-cancelled', text: 'Late transcript.', live: true });
    assert.deepEqual(f.transcripts, ['Go south.']);
    assert.ok(f.nodes.every(node => node.disconnected));

    assert.equal(await f.voice.startRecording('mic-capturing'), true);
    f.voice.interrupt();
    assert.equal(f.voice.isRecording, false);
    assert.equal(mic.stopped, 3);
    assert.ok(f.nodes.every(node => node.disconnected));
  } finally { f.cleanup(); }
});

test('cancellation during audio unlock never requests microphone and stale denial does not report an error', async () => {
  let requests = 0;
  const permission = deferred<MediaStream>(), requested = deferred<void>();
  const f = await fixture(() => { requests++; requested.resolve(); return permission.promise; });
  try {
    const unlocking = deferred<AudioContext>(); f.voice.player.unlock = () => unlocking.promise;
    const beforePermission = f.voice.startRecording('before-permission');
    f.voice.interrupt(); unlocking.resolve(f.context);
    assert.equal(await beforePermission, false);
    assert.equal(requests, 0);

    f.voice.player.unlock = async () => f.context;
    const denied = f.voice.startRecording('late-denial'); await requested.promise;
    f.voice.interrupt(); permission.reject(new Error('Permission denied'));
    assert.equal(await denied, false);
    assert.equal(f.voice.isRecording, false);
    assert.equal(f.statuses.includes('microphone-denied'), false);
  } finally { f.cleanup(); }
});
