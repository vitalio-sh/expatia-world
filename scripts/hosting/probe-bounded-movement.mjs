/** Real signed Worker RPC: one visible movement leg per resident command.
 * node scripts/hosting/probe-bounded-movement.mjs URL output.json [expected-build]
 * Uses real provider decisions/dialogue and authoritative elapsed time, no mic.
 */
import WebSocket from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tsImport } from 'tsx/esm/api';
const { chooseDemoCue } = await tsImport('../../src/shared/demo-coach.ts', import.meta.url);

const base = new URL(process.argv[2]);
const output = process.argv[3];
if (!output) throw new Error('Pass an output JSON path.');
const expectedBuild = process.argv[4] || '2026-10-10-route-discovery';
const started = Date.now(), pending = new Map(), events = [], samples = [];
const report = { at: new Date().toISOString(), url: base.origin, expectedBuild,
  scope: 'Actual signed Worker websocket with real JEV and generated Spanish courier captions. Authoritative wall-clock movement, three explicit commands, fresh stationary stop views and three-second idle periods. Coach fields are the local current shared helper evaluated on authoritative remote game snapshots, not browser rendering. No human microphone or hardware audio claim; no keys, session capabilities or provider token data.' };
let socket, sessionId;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = p => ({ x: p.x, y: p.y });
const send = message => socket.send(JSON.stringify({ ...message, sessionId }));
function rpc(suffix = '', body = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('RPC timeout: ' + suffix)); }, 15_000);
    pending.set(requestId, { resolve, reject, timer });
    send({ type: 'rpc', requestId, path: '/api/session/' + sessionId + suffix, body });
  });
}
function snapshot(game, stage) {
  const sample = { stage, atMs: Date.now() - started, position: point(game.courier), moving: game.courier.moving,
    phase: game.phase, homeSide: game.facts?.homeSide, route: game.route, routeTargetId: game.routeTargetId,
    routeDestination: game.routeDestination, routeComplete: game.routeComplete, awaitingGuidance: game.awaitingGuidance,
    canHandoff: game.canHandoff, arrivalSequence: game.arrivalSequence, facing: game.courier.direction,
    courierView: game.courierView, visibleBuildings: game.visibleBuildings, visibleLandmarks: game.visibleLandmarks,
    homeEntranceVisible: game.homeEntranceVisible ?? game.visibleLandmarks?.some(item => item.id === 'home-door'),
    newlyVisibleLandmarks: game.newlyVisibleLandmarks, newlyVisibleBuildings: game.newlyVisibleBuildings,
    coach: chooseDemoCue(game) };
  samples.push(sample); return sample;
}
async function observeStationaryStop(game, stage, minimumIdleMs = 3_000) {
  const turnId = 'arrival-' + game.arrivalSequence, began = Date.now(), idle = [];
  let latest = game;
  do {
    await pause(200); latest = (await rpc()).game; idle.push(snapshot(latest, stage + '-idle'));
  } while (Date.now() - began < minimumIdleMs ||
    (!events.some(event => event.type === 'dialogue.status' && event.turnId === turnId) && Date.now() - began < 8_000));
  return { game: latest, idle, idleMs: Date.now() - began,
    captions: events.filter(event => event.type === 'npc.caption' && event.turnId === turnId) };
}
function captionReview(captions) {
  const text = captions.map(event => event.text).join(' ');
  return { text, noPresentWalkingClaim: !/\b(?:avanzo|camino|voy hacia|sigo avanzando)\b/i.test(text),
    asksNextStep: /¿[^?]+\?/.test(text), describesNavigationLandmark: /(?:esquina|cruce|paso de peatones)/i.test(text),
    seesEntrance: /veo.{0,90}(?:entrada|portal|puerta)/i.test(text),
    noFalseArrivalClaim: !/(?:he llegado|estoy (?:ya )?(?:en|junto a) (?:tu|el) (?:portal|entrada|puerta))/i.test(text) };
}
async function waitForStop(stage) {
  const deadline = Date.now() + 16_000;
  while (Date.now() < deadline) {
    const { game } = await rpc(); snapshot(game, stage);
    if (!game.courier.moving && game.route.length === 0) return game;
    await pause(200);
  }
  throw new Error('Courier did not stop within the movement observation window.');
}
function commandResult(game, text, turnId) {
  return { text, turnId, selected: game.inspector?.selected, action: game.inspector?.action,
    state: snapshot(game, turnId), playerHistory: game.history.filter(h => h.role === 'player').map(h => h.text),
    spokenHistory: game.history.filter(h => h.role === 'courier').map(h => ({ text: h.text, turnId: h.turnId })) };
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
    if (message.type === 'ready') resolveReady(message);
    if (['npc.caption', 'npc.cancel', 'npc.audio_end', 'npc.audio_error', 'dialogue.status'].includes(message.type)) events.push({ type: message.type, turnId: message.turnId, text: message.text, atMs: Date.now() - started });
    if (message.type === 'rpc.result') {
      const waiter = pending.get(message.requestId);
      if (waiter) { pending.delete(message.requestId); clearTimeout(waiter.timer); message.error ? waiter.reject(new Error('RPC ' + message.status + ': ' + message.error)) : waiter.resolve(message.result); }
    }
  });
  const rejectPending = () => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Call websocket closed.')); } pending.clear(); };
  socket.on('close', rejectPending);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  send({ type: 'hello', token: created.token });
  let readyTimer;
  try { await Promise.race([ready, new Promise((_, reject) => { readyTimer = setTimeout(() => reject(new Error('Worker ready timeout.')), 15_000); })]); }
  finally { clearTimeout(readyTimer); }
  const answered = await rpc('/answer', { turnId: 'bounded-opening' });
  send({ type: 'interrupt' });
  report.openingCaptionsBeforeInterrupt = events.filter(e => e.type === 'npc.caption').length;
  report.initial = snapshot(answered.game, 'initial');
  const entrance = answered.game.map.home.entrance;
  const firstText = 'Mi portal, eh, está en la de sur.';
  const first = await rpc('/turn', { text: firstText, turnId: 'bounded-first' });
  report.firstCommand = commandResult(first.game, firstText, 'bounded-first');
  let firstStop = await waitForStop('first-leg');
  report.firstDisplacementUnits = distance(report.initial.position, firstStop.courier);
  report.firstStopDistanceFromEntrance = distance(firstStop.courier, entrance);
  const firstObservation = await observeStationaryStop(firstStop, 'first-stop'); firstStop = firstObservation.game;
  report.firstStop = snapshot(firstStop, 'first-stop'); report.idleMs = firstObservation.idleMs;
  report.stopCaptionsBeforeContinue = firstObservation.captions;
  report.firstCaptionReview = captionReview(firstObservation.captions);
  const secondText = report.firstStop.coach.spanish || 'Sí, sigue.';
  const second = await rpc('/turn', { text: secondText, turnId: 'bounded-continue' });
  report.continueCommand = commandResult(second.game, secondText, 'bounded-continue');
  let secondStop = await waitForStop('second-leg');
  report.secondDisplacementUnits = distance(firstStop.courier, secondStop.courier);
  const secondObservation = await observeStationaryStop(secondStop, 'second-stop'); secondStop = secondObservation.game;
  report.secondStop = snapshot(secondStop, 'second-stop'); report.secondIdleMs = secondObservation.idleMs;
  report.secondStopCaptions = secondObservation.captions; report.secondCaptionReview = captionReview(secondObservation.captions);
  const thirdText = report.secondStop.coach.spanish || 'Ven a mi portal.';
  const third = await rpc('/turn', { text: thirdText, turnId: 'bounded-final' });
  report.finalCommand = commandResult(third.game, thirdText, 'bounded-final');
  const thirdStop = await waitForStop('third-leg');
  report.thirdStop = snapshot(thirdStop, 'third-stop');
  report.thirdDisplacementUnits = distance(secondStop.courier, thirdStop.courier);
  const arrivalObservation = await observeStationaryStop(thirdStop, 'door-arrival', 500);
  report.doorArrivalCaptions = arrivalObservation.captions;
  const handoffAtMs = Date.now() - started;
  const received = await rpc('/handoff'); report.received = snapshot(received.game, 'received');
  let afterReceipt = received.game;
  const farewellDeadline = Date.now() + 8_000;
  while (Date.now() < farewellDeadline && !events.some(e => ['npc.audio_end', 'npc.audio_error'].includes(e.type) && e.turnId?.startsWith('farewell-'))) {
    await pause(200); afterReceipt = (await rpc()).game; snapshot(afterReceipt, 'farewell-wait');
  }
  report.farewellCaptions = events.filter(e => e.type === 'npc.caption' && e.atMs >= handoffAtMs);
  report.farewellAudioCompleted = events.some(e => e.type === 'npc.audio_end' && e.turnId?.startsWith('farewell-'));
  report.farewellAudioUnavailable = events.some(e => e.type === 'npc.audio_error' && e.turnId?.startsWith('farewell-'));
  if (report.farewellAudioUnavailable) {
    while (Date.now() < farewellDeadline && !events.some(e => e.type === 'dialogue.status' && e.turnId?.startsWith('farewell-'))) { await pause(200); afterReceipt = (await rpc()).game; }
    report.farewellCaptions = events.filter(e => e.type === 'npc.caption' && e.atMs >= handoffAtMs);
  }
  report.remainingMsAtReceipt = received.game.remainingMs;
  await pause(1_000); afterReceipt = (await rpc()).game;
  report.remainingMsAfterReceipt = afterReceipt.remainingMs;
  report.outcome = afterReceipt.outcome;
  report.finalHistory = afterReceipt.history.map(h => ({ role: h.role, text: h.text, turnId: h.turnId }));
  report.validation = {
    healthBuildVerified: report.health.build === expectedBuild,
    southLearnedAndRetained: firstStop.facts?.homeSide === 'south' && secondStop.facts?.homeSide === 'south',
    firstLegMoved: report.firstDisplacementUnits > 1,
    firstLegBoundedByDepartureView: report.firstDisplacementUnits <= answered.game.courierView.range + 0.2,
    firstStopAwayFromEntrance: report.firstStopDistanceFromEntrance > 32 && !firstStop.canHandoff,
    firstStopAwaitsGuidance: firstStop.awaitingGuidance === true && firstStop.routeComplete === false,
    semanticDestinationRemembered: !!firstStop.routeDestination && distance(firstStop.routeDestination, entrance) < 0.1,
    noAutomaticIdleMovement: firstObservation.idle.every(s => !s.moving && s.route.length === 0 && distance(s.position, firstStop.courier) < 0.01),
    stopReportedOnce: new Set(report.stopCaptionsBeforeContinue.map(e => e.turnId)).size === 1,
    explicitContinueAdvances: report.secondDisplacementUnits > 1,
    secondLegBoundedByNewDepartureView: report.secondDisplacementUnits <= answered.game.courierView.range + 0.2,
    secondStopConsistent: secondStop.awaitingGuidance === true && secondStop.routeComplete === false || secondStop.routeComplete === true && secondStop.canHandoff === true,
    firstStopDescribesNewNavigationLandmark: firstStop.newlyVisibleLandmarks?.some(item => ['intersection', 'crossing', 'corner'].includes(item.type)) === true && report.firstCaptionReview.describesNavigationLandmark,
    firstStopTruthfulAndUseful: report.firstCaptionReview.noPresentWalkingClaim && report.firstCaptionReview.noFalseArrivalClaim && report.firstCaptionReview.asksNextStep,
    secondStopFacesEast: secondStop.courier.direction === 'east',
    secondStopSeesActualEntrance: secondStop.homeEntranceVisible === true && secondStop.visibleLandmarks.some(item => item.id === 'home-door'),
    secondStopReportsEntranceWithoutArrival: report.secondCaptionReview.seesEntrance && report.secondCaptionReview.noFalseArrivalClaim && report.secondCaptionReview.noPresentWalkingClaim && report.secondCaptionReview.asksNextStep,
    noAutomaticSecondIdleMovement: secondObservation.idle.every(s => !s.moving && s.route.length === 0 && distance(s.position, secondStop.courier) < 0.01),
    secondStopCueRequestsFinalStep: report.secondStop.coach.spanish === 'Ven a mi portal.',
    thirdCommandActuallyReachesDoor: thirdStop.canHandoff === true && thirdStop.routeComplete === true && !thirdStop.awaitingGuidance && distance(thirdStop.courier, entrance) <= 32.1,
    handoffReceived: afterReceipt.phase === 'resolved' && afterReceipt.parcel === 'resident' && afterReceipt.outcome?.kind === 'received',
    resolvedClockFrozen: received.game.remainingMs === afterReceipt.remainingMs,
    finalSpanishGoodbye: /(?:hasta luego|adiós|que tengas (?:un )?buen día)/i.test(report.farewellCaptions.map(e => e.text).join(' ')),
    farewellAudioCompletes: report.farewellAudioCompleted,
    exactCommandsInHistory: thirdStop.history.filter(h => h.role === 'player').map(h => h.text).join('|') === [firstText, secondText, thirdText].join('|'),
  };
  report.passed = Object.values(report.validation).every(Boolean);
  await rpc('/end');
} catch (error) { report.passed = false; report.error = error.message; }
finally {
  report.events = events; report.samples = samples; report.totalMs = Date.now() - started;
  socket?.close(); for (const waiter of pending.values()) clearTimeout(waiter.timer); pending.clear();
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ url: report.url, build: report.health?.build, passed: report.passed, error: report.error,
  validation: report.validation, firstStop: report.firstStop, continue: report.continueCommand?.selected,
  secondStop: report.secondStop, thirdStop: report.thirdStop, firstCaption: report.firstCaptionReview?.text,
  secondCaption: report.secondCaptionReview?.text, totalMs: report.totalMs }, null, 2));
if (!report.passed) process.exitCode = 1;
