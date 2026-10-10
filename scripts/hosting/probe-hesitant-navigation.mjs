/** Exact reported conversational fragments, using signed realtime RPC and real
 * provider decisions. Preserve the original discovery probe as separate coverage.
 * node scripts/hosting/probe-hesitant-navigation.mjs URL output.json [build]
 */
import WebSocket from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tsImport } from 'tsx/esm/api';
const { segmentClear } = await tsImport('../../src/shared/world.ts', import.meta.url);
const base = new URL(process.argv[2]), output = process.argv[3];
if (!output) throw new Error('Pass output JSON path.');
const expectedBuild = process.argv[4] || '2026-10-10-context-route';
const began = Date.now(), pending = new Map(), events = [], samples = [], cases = [];
const report = { at: new Date().toISOString(), url: base.origin, expectedBuild,
  scope: 'Exact user-reported hesitant text after the generated opening and visible bar-name question. Actual signed Worker RPC, real JEV/dialogue, authoritative physical positions and idle observations. Collision checks use current local authored geometry. No human microphone, hardware audio, keys or capabilities recorded.' };
let socket, sessionId;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const point = p => ({ x: p.x, y: p.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function send(message) { socket.send(JSON.stringify({ ...message, sessionId })); }
function rpc(suffix = '', body = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('RPC timed out: ' + suffix)); }, 15_000);
    pending.set(requestId, { resolve, reject, timer });
    send({ type: 'rpc', requestId, path: '/api/session/' + sessionId + suffix, body });
  });
}
function snapshot(game, stage) {
  const sample = { stage, atMs: Date.now() - began, position: point(game.courier), facing: game.courier.direction,
    moving: game.courier.moving, phase: game.phase, homeSide: game.facts?.homeSide,
    routeTargetId: game.routeTargetId, routeDestination: game.routeDestination, route: game.route,
    routeComplete: game.routeComplete, awaitingGuidance: game.awaitingGuidance, canHandoff: game.canHandoff,
    homeEntranceVisible: game.homeEntranceVisible, visibleLandmarks: game.visibleLandmarks,
    newlyVisibleLandmarks: game.newlyVisibleLandmarks, arrivalSequence: game.arrivalSequence };
  samples.push(sample); return sample;
}
async function waitForText(turnId) {
  const deadline = Date.now() + 8_000;
  while (!events.some(e => e.type === 'dialogue.status' && e.turnId === turnId) && Date.now() < deadline) await pause(100);
  if (!events.some(e => e.type === 'dialogue.status' && e.turnId === turnId)) throw new Error('Opening text did not finish.');
}
async function waitForStop(stage) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const { game } = await rpc(); snapshot(game, stage);
    if (!game.courier.moving && !game.route.length) return game;
    await pause(200);
  }
  throw new Error('Command did not stop within a bounded-leg window.');
}
try {
  report.health = await (await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(12_000) })).json();
  const response = await fetch(new URL('/api/session', base), { method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('Session HTTP ' + response.status);
  const created = await response.json(); sessionId = created.game.id;
  const url = new URL('/realtime', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', created.token);
  socket = new WebSocket(url, { headers: { Origin: base.origin } });
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  socket.on('message', frame => {
    const message = JSON.parse(frame.toString());
    if (message.type === 'ready') resolveReady();
    if (['npc.caption', 'npc.cancel', 'dialogue.status', 'npc.audio_error'].includes(message.type)) events.push({ type: message.type, turnId: message.turnId, text: message.text, atMs: Date.now() - began });
    if (message.type === 'rpc.result') {
      const waiter = pending.get(message.requestId);
      if (waiter) { clearTimeout(waiter.timer); pending.delete(message.requestId); message.error ? waiter.reject(new Error('RPC ' + message.status + ': ' + message.error)) : waiter.resolve(message.result); }
    }
  });
  socket.on('close', () => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Call socket closed.')); } pending.clear(); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  send({ type: 'hello', token: created.token });
  let readyTimer;
  try { await Promise.race([ready, new Promise((_, reject) => { readyTimer = setTimeout(() => reject(new Error('Worker ready timeout.')), 15_000); })]); }
  finally { clearTimeout(readyTimer); }
  await rpc('/answer', { turnId: 'hesitant-opening' }); await waitForText('hesitant-opening');
  report.opening = events.filter(e => e.type === 'npc.caption' && e.turnId === 'hesitant-opening').map(e => e.text).join(' ');
  let latest = (await rpc()).game; report.initial = snapshot(latest, 'initial');
  const entrance = latest.map.home.entrance, range = latest.courierView.range;
  const commands = ['Ah, ¿cómo se llama el bar?', 'Tal esta en la de sur.',
    'Ah, sigue, hasta la próxima vez que venga.', 'Ah, sigue por la-- sigue, sigue en este tramo.',
    'Ah, sigue hasta la próxima esquina.'];
  for (let i = 0; i < commands.length; i++) {
    const text = commands[i], turnId = 'hesitant-' + i, departure = point(latest.courier), priorArrival = latest.arrivalSequence;
    const result = await rpc('/turn', { text, turnId });
    const commanded = snapshot(result.game, turnId + '-applied');
    latest = await waitForStop(turnId + '-movement');
    const stopped = snapshot(latest, turnId + '-stop'), idle = [], idleStarted = Date.now();
    do { await pause(200); latest = (await rpc()).game; idle.push(snapshot(latest, turnId + '-idle')); }
    while (Date.now() - idleStarted < 1_000 || latest.arrivalSequence !== priorArrival &&
      !events.some(e => e.type === 'dialogue.status' && e.turnId === 'arrival-' + latest.arrivalSequence) && Date.now() - idleStarted < 5_000);
    cases.push({ text, turnId, selected: result.game.inspector?.selected, action: result.game.inspector?.action,
      commanded, stopped, displacementUnits: distance(departure, stopped.position), idleMs: Date.now() - idleStarted,
      idleStable: idle.every(s => !s.moving && !s.route.length && distance(s.position, stopped.position) < 0.01),
      captions: events.filter(e => e.type === 'npc.caption' && (e.turnId === turnId || latest.arrivalSequence !== priorArrival && e.turnId === 'arrival-' + latest.arrivalSequence)),
      spokenHistory: latest.history.filter(h => h.role === 'courier').map(h => ({ text: h.text, turnId: h.turnId })) });
  }
  report.final = snapshot(latest, 'final');
  report.finalHistory = latest.history.map(h => ({ role: h.role, text: h.text, turnId: h.turnId }));
  report.validation = {
    healthBuildVerified: report.health.build === expectedBuild,
    visibleBarRead: cases[0].selected === 'reveal:bar-llevant' && cases[0].captions.some(e => e.text?.includes('Bar Llevant')),
    truncatedSideReplyLearnsSouth: cases[1].commanded.homeSide === 'south',
    truncatedReplyStartsHomeRoute: cases[1].commanded.routeTargetId === 'home-south',
    semanticHomeTargetPreserved: cases.slice(1).every(c => c.stopped.routeTargetId === 'home-south' && c.stopped.routeDestination && distance(c.stopped.routeDestination, entrance) < 0.1),
    allMovesBoundedByDepartureView: cases.every(c => c.displacementUnits <= range + 0.2),
    everyIdleStationary: cases.every(c => c.idleStable),
    collisionClearBetweenSamples: samples.slice(1).every((s, i) => segmentClear(samples[i].position, s.position)),
    noWalkingBelowEntranceStreet: samples.every(s => s.position.y <= entrance.y + 32.1),
    convergedToPhysicalSouthEntrance: cases[3].stopped.canHandoff === true && latest.canHandoff === true && distance(latest.courier, entrance) <= 32.1,
    extraCornerCommandDoesNotLoseDoor: distance(cases[3].stopped.position, cases[4].stopped.position) < 0.01 && cases[4].stopped.canHandoff === true,
    exactTranscriptPreserved: latest.history.filter(h => h.role === 'player').map(h => h.text).join('|') === commands.join('|'),
  };
  report.passed = Object.values(report.validation).every(Boolean);
  await rpc('/end');
} catch (error) { report.passed = false; report.error = error.message; }
finally {
  report.cases = cases; report.events = events; report.samples = samples; report.totalMs = Date.now() - began;
  socket?.close(); for (const waiter of pending.values()) clearTimeout(waiter.timer);
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ url: report.url, build: report.health?.build, passed: report.passed, error: report.error,
  validation: report.validation, cases: cases.map(c => ({ text: c.text, selected: c.selected,
    homeSide: c.commanded.homeSide, stop: c.stopped.position, target: c.stopped.routeTargetId,
    canHandoff: c.stopped.canHandoff, idleStable: c.idleStable, captions: c.captions.map(e => e.text) })),
  totalMs: report.totalMs }, null, 2));
if (!report.passed) process.exitCode = 1;
