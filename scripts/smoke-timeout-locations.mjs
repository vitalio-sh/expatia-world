/** Actual Worker integration rounds. No clock overrides, keys or token logging.
 * EXPATIA_QA_URL=https://your-host EXPATIA_QA_REPORT=docs/qa/live-worker.json node scripts/smoke-worker.mjs */
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const base = String(process.env.EXPATIA_QA_URL || process.argv[2] || 'http://localhost:3318').replace(/\/$/, '');
const output = process.env.EXPATIA_QA_REPORT || 'docs/qa/timeout-locations-public.json';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const report = { started: new Date().toISOString(), completed: null, url: base, transport: 'Connection-owned native Worker WebSocket RPC', scenarios: [],
  measurementBoundary: 'Actual provider-backed typed input and returned PCM transport. This script does not play audio or use a physical microphone; first audible and human STT latency are unavailable.',
};
function persist() { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
const active = new Set();

async function connect(name) {
  const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { Origin: new URL(base).origin, 'Content-Type': 'application/json' }, body: '{}' });
  const capability = await response.json();
  check(response.ok && capability.realtimeRpc === true && capability.token && capability.game?.id, 'Worker session capability unavailable');
  const id = capability.game.id, events = [], timings = {}, audio = {}, pending = new Map();
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/realtime?token=${encodeURIComponent(capability.token)}`, { headers: { Origin: new URL(base).origin } });
  const connectedAt = performance.now();
  const log = message => {
    if (message.type === 'npc.audio') {
      const entry = audio[message.turnId] ||= { frames: 0, bytes: 0 };
      entry.frames++; entry.bytes += Buffer.from(message.audio || '', 'base64').length;
      const timing = timings[message.turnId];
      if (timing) timing.firstReceivedPcmMs ??= performance.now() - timing.sentAt;
      return;
    }
    if (message.type === 'npc.caption') {
      const timing = timings[message.turnId];
      if (timing) timing.firstReceivedCaptionMs ??= performance.now() - timing.sentAt;
    }
    if (message.type !== 'rpc.result') events.push({ atMs: Math.round(performance.now() - connectedAt), type: message.type, turnId: message.turnId, text: message.text, live: message.live, error: message.error, model: message.model, timings: message.timings });
  };
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker hello timed out')), 10_000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', sessionId: id, token: capability.token })));
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'ready') { clearTimeout(timer); check(message.realtimeRpc === true, 'Host did not enable Worker RPC'); resolve(); }
      log(message);
      if (message.type === 'rpc.result') {
        const request = pending.get(message.requestId); if (!request) return;
        clearTimeout(request.timer); pending.delete(message.requestId);
        if (message.status >= 400) { const error = new Error(String(message.error || 'Worker RPC failed')); error.game = message.result?.game; request.reject(error); }
        else request.resolve(message.result);
      }
    });
    socket.on('error', () => { clearTimeout(timer); reject(new Error('Worker socket connection failed')); });
    socket.on('close', () => {
      clearTimeout(timer);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Worker call connection closed')); }
      pending.clear();
    });
  });
  await ready;
  const call = (suffix = '', body) => {
    const requestId = randomUUID();
    if (body?.turnId) timings[body.turnId] = { sentAt: performance.now() };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Worker RPC request timed out')); }, 15_000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'rpc', sessionId: id, requestId, path: `/api/session/${id}${suffix}`, body }));
    });
  };
  const state = async () => (await call()).game;
  const until = async (predicate, timeoutMs = 15_000, pollMs = 150) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) { const game = await state(); if (predicate(game)) return game; await sleep(pollMs); }
    throw new Error(`Worker ${name} did not reach the expected world condition`);
  };
  const waitAudio = async (turnId, timeoutMs = 4_000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end && !(audio[turnId]?.bytes > 0)) await sleep(50);
    return audio[turnId]?.bytes || 0;
  };
  const close = async () => { try { if (socket.readyState === 1) await call('/end', {}); } catch { /* already closed */ } socket.close(); active.delete(close); };
  active.add(close);
  return { id, call, state, until, waitAudio, close, events, timings, audio };
}


async function locationRound(name,steps,expected) {
 const c=await connect(name),scenario={name,sessionId:c.id,expected,started:new Date().toISOString()};report.scenarios.push(scenario);
 try {
  const answered=(await c.call('/answer',{turnId:name+'-opening'})).game;
  await c.until(g=>g.history.some(h=>h.role==='courier'));
  for(let i=0;i<steps.length;i++){
   const result=(await c.call('/turn',{text:steps[i],turnId:name+'-'+i})).game;
   check(result.inspector?.source==='jev','Movement must use live JEV');
   await c.until(g=>g.route.length===0,12000);
  }
  scenario.beforeTimeout=await c.state();
  const final=await c.until(g=>g.phase==='resolved',82000,350);
  scenario.elapsedServerMs=final.serverNow-answered.startedAt;
  check(scenario.elapsedServerMs>=60000,'Timeout was accelerated');
  check(final.inspector?.source==='jev'&&final.inspector?.trigger==='timeout','Timeout must use real JEV');
  check(final.dropLocationId===expected,`Expected ${expected}, got ${final.dropLocationId}`);
  const shop=final.map.buildings.find(b=>b.id===expected);
  check(final.parcel==='drop'&&Math.hypot(final.courier.x-shop.entrance.x,final.courier.y-shop.entrance.y)<1,'Drop must physically reach destination');
  scenario.final=final;scenario.pass=true;
 }catch(e){scenario.pass=false;scenario.error=String(e.message);try{scenario.lastState=await c.state()}catch{}}
 finally{scenario.events=c.events;await c.close();persist()}
}
await Promise.all([
 locationRound('northwest',[],'bar-llevant'),
 locationRound('east',['My entrance is on the east side. Please come to that entrance.'],'forn'),
 locationRound('northeast',['My entrance is on the north side. Please come to that entrance.','Walk east along this street.'],'mercat'),
]);
report.completed=new Date().toISOString();report.pass=report.scenarios.every(s=>s.pass);persist();
console.log(JSON.stringify({pass:report.pass,scenarios:report.scenarios.map(s=>({name:s.name,pass:s.pass,drop:s.final?.dropLocationId,error:s.error,elapsedServerMs:s.elapsedServerMs}))},null,2));
if(!report.pass)process.exitCode=1;
