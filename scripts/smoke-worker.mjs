/** Actual Worker integration rounds. No clock overrides, keys or token logging.
 * EXPATIA_QA_URL=https://your-host EXPATIA_QA_REPORT=docs/qa/live-worker.json node scripts/smoke-worker.mjs */
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const base = String(process.env.EXPATIA_QA_URL || process.argv[2] || 'http://localhost:3318').replace(/\/$/, '');
const output = process.env.EXPATIA_QA_REPORT || 'docs/qa/live-worker-local.json';
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

async function handoffRound() {
  const connection = await connect('handoff');
  const scenario = { name: 'Clarification, wrong north entrance, correction, physical handoff', sessionId: connection.id, started: new Date().toISOString() };
  report.scenarios.push(scenario); persist();
  try {
    await sleep(1_300); const before = await connection.state();
    scenario.clockUntimed = before.phase === 'incoming' && before.deadline === null && before.remainingMs === 60_000;
    check(scenario.clockUntimed, 'Scenario entry consumed the delivery clock');
    const answered = (await connection.call('/answer', { turnId: 'opening' })).game;
    scenario.deadlineExactly60000 = answered.deadline - answered.startedAt === 60_000;
    check(scenario.deadlineExactly60000, 'Worker deadline was not exactly 60 seconds');
    const opening = await connection.until(game => game.history.some(entry => entry.role === 'courier'));
    await connection.waitAudio('opening');
    scenario.opening = opening.history.filter(entry => entry.role === 'courier');
    check(!/Llevant|Ponent|Fruita|Forn|south|bottom/i.test(scenario.opening[0].text), 'Opening leaked a distinguishing sign or hidden entrance');
    const clarify = await connection.call('/turn', { text: 'Which bar are you beside? Can you read its name?', turnId: 'clarify' });
    await connection.waitAudio('clarify'); scenario.clarification = clarify.game.inspector;
    check(clarify.game.inspector?.source === 'jev', 'Clarification was not a live JEV decision');
    const wrong = await connection.call('/turn', { text: 'My entrance is on the north side. Please meet me there.', turnId: 'wrong' });
    await connection.waitAudio('wrong'); scenario.wrongDecision = wrong.game.inspector;
    check(wrong.game.inspector?.selected === 'home:north', 'The north entrance hypothesis was not applied');
    scenario.wrongArrival = await connection.until(game => game.courier.y === 200 && Math.abs(game.courier.x - 480) < 1 && game.route.length === 0, 9_000);
    check(scenario.wrongArrival.parcel === 'courier' && !scenario.wrongArrival.canHandoff, 'Wrong-side arrival falsely handed over parcel');
    const correction = await connection.call('/turn', { text: 'Sorry, I meant the south side of the central building. My entrance is at the bottom. Please meet me there.', turnId: 'correct' });
    scenario.correction = correction.game.inspector;
    check(correction.game.inspector?.selected === 'home:south', 'The corrected south entrance was not applied');
    for (let i = 0; i < 7; i++) { await sleep(110); await connection.call('/move', { dx: 0, dy: 1, dt: .1 }); }
    scenario.arrival = await connection.until(game => game.canHandoff, 16_000, 150);
    const outcome = (await connection.call('/handoff', {})).game;
    check(outcome.phase === 'resolved' && outcome.parcel === 'resident' && outcome.outcome?.kind === 'received', 'Physical handoff did not resolve received outcome');
    scenario.final = outcome; scenario.events = connection.events; scenario.audio = connection.audio;
    scenario.turnTimings = Object.fromEntries(Object.entries(connection.timings).map(([id, value]) => [id, { ...value, sentAt: undefined }]));
    scenario.completed = new Date().toISOString(); scenario.pass = true;
  } finally { await connection.close(); persist(); }
}

async function timeoutRound() {
  const connection = await connect('timeout');
  const scenario = { name: 'Actual 60-second timeout and physical collection drop', sessionId: connection.id, started: new Date().toISOString(), checkpoints: [] };
  report.scenarios.push(scenario); persist();
  try {
    await sleep(1_300); const before = await connection.state();
    scenario.clockUntimed = before.deadline === null; check(scenario.clockUntimed, 'Second incoming call was timed before answering');
    const answered = (await connection.call('/answer', { turnId: 'timeout-opening' })).game;
    const wallStarted = performance.now(); scenario.deadlineExactly60000 = answered.deadline - answered.startedAt === 60_000;
    check(scenario.deadlineExactly60000, 'Timeout round deadline was not exactly 60 seconds');
    let lastPhase = '', lastParcel = '', lastDecision = '', firstTimeoutAt, resolved;
    const end = Date.now() + 83_000;
    while (Date.now() < end) {
      const game = await connection.state();
      if (game.phase !== lastPhase || game.parcel !== lastParcel || game.inspector?.id !== lastDecision) {
        scenario.checkpoints.push({ observedAt: new Date().toISOString(), serverNow: game.serverNow, phase: game.phase, parcel: game.parcel, remainingMs: game.remainingMs, courier: game.courier, route: game.route, inspector: game.inspector });
        lastPhase = game.phase; lastParcel = game.parcel; lastDecision = game.inspector?.id;
      }
      if (game.phase === 'timeout' && firstTimeoutAt === undefined) {
        firstTimeoutAt = performance.now(); scenario.timeoutObservedAfterMs = game.serverNow - game.startedAt;
        check(game.serverNow >= game.deadline && game.remainingMs === 0, 'Timeout happened before authoritative deadline');
      }
      if (game.phase === 'resolved') { resolved = game; break; }
      await sleep(350);
    }
    check(resolved, 'Actual timeout did not resolve within its legal drop-off grace period');
    scenario.elapsedWallMs = performance.now() - wallStarted;
    check(scenario.elapsedWallMs >= 59_500, 'Script did not wait for the actual 60-second round');
    check(resolved.inspector?.trigger === 'timeout' && resolved.inspector?.source === 'jev', 'Timeout did not use live JEV selection');
    scenario.timeoutDecision = resolved.inspector;
    check(resolved.parcel === 'drop' && resolved.outcome?.kind === 'collection', 'Expected suitable observed shop collection outcome');
    const shop = resolved.map.buildings.find(building => building.id === resolved.dropLocationId);
    check(shop && Math.hypot(resolved.courier.x - shop.entrance.x, resolved.courier.y - shop.entrance.y) < 1, 'Collection drop did not physically reach its shop entrance');
    check(resolved.history.some(entry => entry.role === 'event' && entry.text.includes('physically reached')), 'No physical drop event entered shared history');
    // Let the validated arrival explanation and transport settle before measuring totals.
    await sleep(3_000);
    scenario.final = await connection.state(); scenario.events = connection.events; scenario.audio = connection.audio;
    scenario.turnTimings = Object.fromEntries(Object.entries(connection.timings).map(([id, value]) => [id, { ...value, sentAt: undefined }]));
    scenario.completed = new Date().toISOString(); scenario.pass = true;
  } finally { await connection.close(); persist(); }
}

try {
  await handoffRound(); console.log(JSON.stringify({ scenario: 'handoff', pass: true, next: 'Waiting for actual 60-second timeout round' }));
  await timeoutRound();
  report.completed = new Date().toISOString(); report.pass = report.scenarios.every(scenario => scenario.pass);
  const ledgers = report.scenarios.map(scenario => scenario.final.usage);
  report.totals = ledgers.reduce((sum, item) => ({ calls: sum.calls + item.calls, inputTokens: sum.inputTokens + item.inputTokens, outputTokens: sum.outputTokens + item.outputTokens, returnedCostUsd: sum.returnedCostUsd + item.returnedCostUsd, estimatedCostUsd: sum.estimatedCostUsd + item.estimatedCostUsd, voiceCharacters: sum.voiceCharacters + item.voiceCharacters }), { calls: 0, inputTokens: 0, outputTokens: 0, returnedCostUsd: 0, estimatedCostUsd: 0, voiceCharacters: 0 });
  persist();
  console.log(JSON.stringify({ pass: report.pass, url: base, report: output, totals: report.totals, scenarios: report.scenarios.map(scenario => ({ name: scenario.name, pass: scenario.pass, outcome: scenario.final.outcome, turnTimings: scenario.turnTimings, timeoutObservedAfterMs: scenario.timeoutObservedAfterMs })) }));
} catch (error) {
  report.completed = new Date().toISOString(); report.pass = false; report.failure = String(error?.message || error).replace(/([?&]token=)[^\s]+/g, '$1[redacted]').slice(0, 400); persist();
  console.error(JSON.stringify({ pass: false, error: report.failure, report: output })); process.exitCode = 1;
} finally { await Promise.allSettled([...active].map(close => close())); }
