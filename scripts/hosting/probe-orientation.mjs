/** Signed live orientation questions and the reported next-left phrase.
 * node scripts/hosting/probe-orientation.mjs URL output.json [expected-build]
 */
import WebSocket from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tsImport } from 'tsx/esm/api';
const { visiblePoint, segmentClear } = await tsImport('../../src/shared/world.ts', import.meta.url);
const base = new URL(process.argv[2]), output = process.argv[3];
if (!output) throw new Error('Pass output JSON path.');
const expectedBuild = process.argv[4] || '2026-10-10-courier-facing';
const began = Date.now(), pending = new Map(), events = [], samples = [], questions = [];
const report = { at: new Date().toISOString(), url: base.origin, expectedBuild,
  scope: 'Actual signed Worker RPC and real JEV/Spanish dialogue. Heading questions at four stationary orientations must describe current facing without movement or turns. The literal next-left command is courier-relative after user confirmation. Geometry checks use current local authored walls and view. No microphone, browser rendering, hardware audio or key/capability claim.' };
const es = { north: 'norte', south: 'sur', east: 'este', west: 'oeste' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const point = p => ({ x: p.x, y: p.y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let socket, sessionId;
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
  const sample = { stage, atMs: Date.now() - began, serverNow: game.serverNow, remainingMs: game.remainingMs,
    startedAt: game.startedAt, deadline: game.deadline, phase: game.phase, position: point(game.courier),
    facing: game.courier.direction, moving: game.courier.moving, route: game.route,
    routeTargetId: game.routeTargetId, routeDestination: game.routeDestination,
    awaitingGuidance: game.awaitingGuidance, routeComplete: game.routeComplete, canHandoff: game.canHandoff,
    homeEntranceVisible: game.homeEntranceVisible, visibleLandmarks: game.visibleLandmarks,
    visibleBuildings: game.visibleBuildings, arrivalSequence: game.arrivalSequence };
  samples.push(sample); return sample;
}
async function waitForText(turnId) {
  const deadline = Date.now() + 8_000;
  while (!events.some(e => e.type === 'dialogue.status' && e.turnId === turnId) && Date.now() < deadline) await pause(100);
  if (!events.some(e => e.type === 'dialogue.status' && e.turnId === turnId)) throw new Error('Opening text did not finish.');
}
async function stop(stage) {
  const limit = Date.now() + 12_000;
  let game;
  do { game = (await rpc()).game; snapshot(game, stage); if (game.courier.moving || game.route.length) await pause(200); }
  while ((game.courier.moving || game.route.length) && Date.now() < limit);
  if (game.courier.moving || game.route.length) throw new Error('Movement did not finish one visible leg.');
  const arrivalTurn = 'arrival-' + game.arrivalSequence, textLimit = Date.now() + 5_000;
  while (!events.some(e => e.type === 'dialogue.status' && e.turnId === arrivalTurn) && Date.now() < textLimit) { await pause(100); game = (await rpc()).game; snapshot(game, stage + '-observation'); }
  return game;
}
function visibleGeometryMatches(game) {
  return game.visibleLandmarks.every(item => {
    const landmark = game.map.landmarks.find(candidate => candidate.id === item.id);
    return !!landmark && visiblePoint(game.courier, landmark.point, undefined, game.courier.direction);
  }) && game.visibleBuildings.every(id => {
    const building = game.map.buildings.find(candidate => candidate.id === id);
    return !!building && visiblePoint(game.courier, building.sign, undefined, game.courier.direction);
  });
}
async function headingQuestion(expectedFacing, text) {
  const before = (await rpc()).game, turnId = 'heading-' + expectedFacing;
  const response = await rpc('/turn', { text, turnId });
  const after = response.game, spoken = events.filter(e => e.type === 'npc.caption' && e.turnId === turnId).map(e => e.text).join(' ');
  const stationary = point(after.courier); await pause(500); const idle = (await rpc()).game;
  const normalized = spoken.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const currentNamedClaim = after.map.buildings.every(building => !spoken.includes(building.name) || after.visibleBuildings.includes(building.id));
  const checks = {
    expectedHeadingReached: before.courier.direction === expectedFacing,
    describeAction: after.inspector?.selected === 'describe-surroundings',
    poseUnchanged: distance(before.courier, after.courier) < 0.01 && before.courier.direction === after.courier.direction,
    idleRemainsStationary: !idle.courier.moving && distance(stationary, idle.courier) < 0.01 && idle.courier.direction === expectedFacing,
    actualHeadingSpoken: new RegExp('(?:miro|mirando|orientad[oa]|mirada).{0,28}\\b' + es[expectedFacing] + '\\b').test(normalized),
    noSpokenTurnOrWalk: !/\b(?:avanzo|camino|giro|me giro|voy hacia)\b/.test(normalized),
    visibleGeometryMatches: visibleGeometryMatches(after),
    namedPlaceClaimsCurrentlyVisible: currentNamedClaim,
    deadlineUnchanged: before.deadline === after.deadline && after.deadline === idle.deadline,
    entranceTargetPreserved: JSON.stringify(before.routeDestination) === JSON.stringify(after.routeDestination),
  };
  const row = { text, expectedFacing, spoken, before: snapshot(before, turnId + '-before'), after: snapshot(after, turnId + '-after'), idle: snapshot(idle, turnId + '-idle'), checks };
  questions.push(row); return idle;
}
try {
  report.health = await (await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(12_000) })).json();
  const response = await fetch(new URL('/api/session', base), { method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('Session HTTP ' + response.status);
  const created = await response.json(); sessionId = created.game.id;
  const url = new URL('/realtime', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('token', created.token);
  socket = new WebSocket(url, { headers: { Origin: base.origin } });
  let resolveReady; const ready = new Promise(resolve => { resolveReady = resolve; });
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
  const answered = await rpc('/answer', { turnId: 'orientation-opening' }); report.answered = snapshot(answered.game, 'answered');
  await waitForText('orientation-opening');
  await headingQuestion('north', '¿En qué dirección estás mirando?');
  await rpc('/turn', { text: 'Mi portal está en el lado sur.', turnId: 'heading-south-leg' });
  const southwestStop = await stop('southwest-stop'); report.southwestStop = snapshot(southwestStop, 'southwest-stop');
  await headingQuestion('south', '¿Hacia dónde miras ahora?');
  const nextLeftText = 'sigue hasta próxima izquierda';
  const nextLeft = await rpc('/turn', { text: nextLeftText, turnId: 'heading-next-left' });
  const eastStop = await stop('next-left-stop');
  report.nextLeft = { text: nextLeftText, selected: nextLeft.game.inspector?.selected, action: nextLeft.game.inspector?.action,
    before: point(southwestStop.courier), after: snapshot(eastStop, 'next-left-stop'),
    captions: events.filter(e => e.type === 'npc.caption' && (e.turnId === 'heading-next-left' || e.turnId === 'arrival-' + eastStop.arrivalSequence)).map(e => e.text) };
  await headingQuestion('east', '¿En qué dirección estás mirando ahora?');
  const look = await rpc('/turn', { text: 'Mira hacia el oeste.', turnId: 'heading-look-west' });
  report.intentionalWestLook = { selected: look.game.inspector?.selected, state: snapshot(look.game, 'intentional-west-look') };
  const final = await headingQuestion('west', 'Which direction are you facing?');
  report.final = snapshot(final, 'final');
  report.finalHistory = final.history.map(h => ({ role: h.role, text: h.text, turnId: h.turnId }));
  report.validation = {
    healthBuildVerified: report.health.build === expectedBuild,
    allFourHeadingsChecked: questions.map(q => q.expectedFacing).join('|') === 'north|south|east|west',
    allHeadingQuestionChecksPass: questions.every(q => Object.values(q.checks).every(Boolean)),
    nextLeftPreservesHomeGoal: eastStop.routeTargetId === 'home-south' && eastStop.routeDestination?.x === final.map.home.entrance.x && eastStop.routeDestination?.y === final.map.home.entrance.y,
    nextLeftUsesBoundedCollisionClearCornerLeg: report.nextLeft.selected === 'continue' && distance(eastStop.courier, southwestStop.courier) <= final.courierView.range + 0.2 && segmentClear(southwestStop.courier, eastStop.courier),
    nextLeftTurnsEastAtCorner: eastStop.courier.direction === 'east' && eastStop.homeEntranceVisible && eastStop.visibleLandmarks.some(item => item.id === 'home-door'),
    noUnrequestedMovementOrTurns: questions.every(q => q.checks.poseUnchanged && q.checks.idleRemainsStationary),
    originalSixtySecondWindow: report.answered.deadline - report.answered.startedAt === 60_000 && final.deadline === report.answered.deadline && final.startedAt === report.answered.startedAt,
    timerOnlyAdvancesWithAuthoritativeClock: Math.abs((report.answered.remainingMs - final.remainingMs) - (final.serverNow - report.answered.serverNow)) < 10,
    finalCallStillActive: final.phase === 'active',
  };
  report.passed = Object.values(report.validation).every(Boolean); await rpc('/end');
} catch (error) { report.passed = false; report.error = error.message; }
finally {
  report.questions = questions; report.events = events; report.samples = samples; report.totalMs = Date.now() - began;
  socket?.close(); for (const waiter of pending.values()) clearTimeout(waiter.timer);
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ url: report.url, build: report.health?.build, passed: report.passed, error: report.error,
  validation: report.validation, questions: questions.map(q => ({ heading: q.expectedFacing, text: q.text, spoken: q.spoken, checks: q.checks })),
  nextLeft: report.nextLeft, totalMs: report.totalMs }, null, 2));
if (!report.passed) process.exitCode = 1;
