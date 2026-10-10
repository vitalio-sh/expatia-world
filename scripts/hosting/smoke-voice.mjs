/** Real signed-session Worker STT relay probe. Uses the opening's generated PCM as
 * synthetic microphone input. No human recording, provider keys or extra TTS call.
 * Usage: node scripts/hosting/smoke-voice.mjs https://published-host [output.json]
 */
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
const base = process.argv[2];
if (!base) throw new Error('Pass the published Worker URL.');
const destination = new URL(base);
const started = performance.now();
const initial = await fetch(new URL('/api/session', destination), { method: 'POST', headers: { Origin: destination.origin, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(12_000) });
if (!initial.ok) throw new Error(`Session creation failed (${initial.status}).`);
const session = await initial.json();
const sessionId = session.game.id;
const socketUrl = new URL('/realtime', destination); socketUrl.protocol = destination.protocol === 'https:' ? 'wss:' : 'ws:'; socketUrl.searchParams.set('token', session.token);
const socket = new WebSocket(socketUrl, { headers: { Origin: destination.origin } });
const waiters = new Set();
const rpcWaiters = new Map();
const audio = [];
let openingText = '', firstAudioAt, answeredAt, sttCommittedAt;
const openingTurn = `voice-probe-opening-${Date.now()}`;
const micTurn = `voice-probe-mic-${Date.now()}`;
function waitFor(test, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const waiter = { test, resolve, reject, timer: setTimeout(() => { waiters.delete(waiter); reject(new Error('Voice probe event timed out.')); }, timeout) };
    waiters.add(waiter);
  });
}
function send(message) { socket.send(JSON.stringify({ ...message, sessionId })); }
function rpc(path, body = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { rpcWaiters.delete(requestId); reject(new Error('Voice probe RPC timed out.')); }, 15_000);
    rpcWaiters.set(requestId, { resolve, reject, timer }); send({ type: 'rpc', requestId, path, body });
  });
}
socket.on('message', frame => {
  const message = JSON.parse(frame.toString());
  if (message.type === 'rpc.result') {
    const pending = rpcWaiters.get(message.requestId);
    if (pending) { clearTimeout(pending.timer); rpcWaiters.delete(message.requestId); if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result); }
  }
  if (message.turnId === openingTurn) {
    if (message.type === 'npc.audio') { firstAudioAt ??= performance.now(); audio.push(Buffer.from(message.audio, 'base64')); }
    if (message.type === 'npc.caption') openingText += `${openingText ? ' ' : ''}${message.text}`;
  }
  for (const waiter of [...waiters]) if (waiter.test(message)) { clearTimeout(waiter.timer); waiters.delete(waiter); waiter.resolve(message); }
});
socket.on('error', error => {
  for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(new Error(`Voice probe socket error (${error.name}).`)); } waiters.clear();
});
const report = { at: new Date().toISOString(), url: destination.origin, scope: 'Real native Worker TTD and Scribe relay, synthetic speech from its opening PCM. Timings are measured by this Node client; no browser/hardware audibility or human microphone claim.' };
try {
  const ready = waitFor(m => m.type === 'ready');
  const prepared = waitFor(m => m.type === 'voice.prepared');
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  send({ type: 'hello', token: session.token });
  const readyMessage = await ready;
  const preparedMessage = await prepared;
  report.connection = { realtimeRpc: readyMessage.realtimeRpc === true, speechPrepared: preparedMessage.live === true, elapsedMs: Math.round(performance.now() - started) };
  if (!report.connection.realtimeRpc || !report.connection.speechPrepared) throw new Error('Worker realtime voice was not ready.');
  const speechEnded = waitFor(m => m.turnId === openingTurn && ['npc.audio_end', 'npc.audio_error'].includes(m.type));
  answeredAt = performance.now();
  await rpc(`/api/session/${sessionId}/answer`, { turnId: openingTurn });
  const ended = await speechEnded;
  if (ended.type === 'npc.audio_error' || !audio.length) throw new Error('Worker TTD returned no PCM.');
  const pcm = Buffer.concat(audio);
  report.ttd = { model: 'eleven_v4_turbo', firstReceivedMs: Math.round(firstAudioAt - answeredAt), audioBytes: pcm.length, audioSeconds: pcm.length / 48_000, serverTimings: ended.timings, live: ended.live, completeTextCharacters: openingText.length };
  const sttReady = waitFor(m => m.type === 'stt.ready' && m.turnId === micTurn);
  const sttFinal = waitFor(m => m.turnId === micTurn && ['stt.final', 'stt.error'].includes(m.type));
  send({ type: 'stt.start', turnId: micTurn }); const sttReadyMessage = await sttReady;
  if (sttReadyMessage.language !== 'es') throw new Error('Spanish is not the default recognition language.');
  const source = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const sampled = Buffer.alloc(Math.floor(source.length / 1.5) * 2);
  for (let i = 0; i < sampled.length / 2; i++) {
    const position = i * 1.5, index = Math.floor(position), fraction = position - index;
    sampled.writeInt16LE(Math.round(source[index] * (1 - fraction) + (source[index + 1] || 0) * fraction), i * 2);
  }
  for (let offset = 0; offset < sampled.length; offset += 6400) send({ type: 'stt.audio', turnId: micTurn, audio: sampled.subarray(offset, offset + 6400).toString('base64') });
  sttCommittedAt = performance.now(); send({ type: 'stt.commit', turnId: micTurn });
  const transcript = await sttFinal;
  if (transcript.type === 'stt.error') throw new Error(transcript.error);
  const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  report.stt = { language: transcript.language, defaultLanguageConfirmed: sttReadyMessage.language === 'es', model: transcript.model, live: transcript.live, commitToFinalMs: Math.round(performance.now() - sttCommittedAt), serverCommitToFinalMs: transcript.elapsedMs, transcriptMatchesGeneratedWords: normalize(transcript.text) === normalize(openingText), transmittedPcmSeconds: sampled.length / 32_000, silencePaddingIncludedByServer: true };
  const state = await rpc(`/api/session/${sessionId}`);
  report.jev = { status: state.game.inspector?.status || state.game.inspector?.source, selected: state.game.inspector?.selected, probabilities: state.game.inspector?.probabilities };
  report.usage = state.game.usage;
  await rpc(`/api/session/${sessionId}/end`);
  report.passed = report.stt.language === 'es' && report.stt.defaultLanguageConfirmed && report.stt.live && report.stt.transcriptMatchesGeneratedWords && report.ttd.live;
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1; }
finally {
  socket.close();
  for (const waiter of waiters) clearTimeout(waiter.timer);
  for (const pending of rpcWaiters.values()) clearTimeout(pending.timer);
  report.totalMs = Math.round(performance.now() - started);
  if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
