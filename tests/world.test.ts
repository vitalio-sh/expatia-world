import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, DEFAULT_WEATHER, HOME_ENTRANCE, barcelonaTime, distance, findRoute, isOpen, segmentClear, visiblePoint, walkable } from '../src/shared/world.js';
import { actionCandidates, answerCall, canHandoff, createGame, handoff, moveResident, npcContext, perception, publicGame, recordSpeech, tickGame } from '../src/server/game.js';
import { buildJevRequest, decide, queryJev, resolveTimeout } from '../src/server/jev.js';

const SATURDAY_NOON = Date.parse('2026-10-10T10:00:00Z');
const fresh = () => createGame(DEFAULT_WEATHER, SATURDAY_NOON);
const active = () => { const game = fresh(); answerCall(game, SATURDAY_NOON); recordSpeech(game, 'I am near a bar. Which way should I go?', 'opening', SATURDAY_NOON); return game; };
const offline = { key: '', now: () => SATURDAY_NOON, telemetry: false };
function mockJev(select: (criteria: Record<string, unknown>) => string): typeof fetch {
  return (async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(init.body as string), options = Object.keys(request.questions.action.criteria), chosen = select(request.questions.action.criteria);
    return Response.json({ model: 'jev-test-fixture', answers: { action: { choice: chosen, confidence: 0.9, probabilities: Object.fromEntries(options.map(id => [id, id === chosen ? 1 : 0])) } }, usage: { input_tokens: 40, output_tokens: 10 } });
  }) as typeof fetch;
}

test('entering never starts clock; Answer starts exactly 60 seconds once', () => {
  const game = fresh(); tickGame(game, SATURDAY_NOON + 300_000);
  assert.equal(game.phase, 'incoming'); assert.equal(game.deadline, null); assert.equal(publicGame(game).remainingMs, 60_000);
  const start = SATURDAY_NOON + 300_000;
  assert.equal(answerCall(game, start), true); assert.equal(game.deadline, start + 60_000);
  assert.equal(answerCall(game, start + 20_000), false); assert.equal(game.deadline, start + 60_000);
});
test('only physical meeting at correct entrance allows handoff', () => {
  const game = active(); assert.equal(handoff(game, SATURDAY_NOON + 1), false);
  game.courier.x = 480; game.courier.y = 200; game.resident.x = 480; game.resident.y = 195;
  assert.equal(handoff(game, SATURDAY_NOON + 2), false);
  Object.assign(game.courier, HOME_ENTRANCE); Object.assign(game.resident, { x: 480, y: 635 });
  assert.equal(canHandoff(game, SATURDAY_NOON + 3), true); assert.equal(handoff(game, SATURDAY_NOON + 3), true);
  assert.equal(game.parcel, 'resident'); assert.equal(game.outcome?.kind, 'received'); assert.equal(game.phase, 'resolved');
});
test('background/deadline cannot extend timer or turn late claims into success', () => {
  const game = active(); Object.assign(game.courier, HOME_ENTRANCE); Object.assign(game.resident, HOME_ENTRANCE);
  recordSpeech(game, 'I delivered it!', 'claim', SATURDAY_NOON + 5);
  assert.equal(game.parcel, 'courier');
  assert.equal(handoff(game, SATURDAY_NOON + 60_000), false); assert.equal(game.phase, 'timeout');
  assert.equal(game.deadline, SATURDAY_NOON + 60_000); assert.equal(publicGame(game, SATURDAY_NOON + 90_000).remainingMs, 0);
});
test('resident foyer has solid walls and a real southern exit', () => {
  const game = active();
  for (let i = 0; i < 30; i++) moveResident(game, -1, 0, 0.1);
  assert.ok(game.resident.x >= 460); assert.ok(walkable(game.resident, 'resident'));
  game.resident.x = 480;
  for (let i = 0; i < 10; i++) moveResident(game, 0, 1, 0.1);
  assert.ok(game.resident.y > 645); assert.ok(walkable(game.resident, 'resident'));
  assert.equal(walkable({ x: 480, y: 565 }, 'courier'), false);
});
test('range, cardinal blind spots and home occlusion are independent sight constraints', () => {
  const game = fresh(), view = perception(game);
  assert.ok(view.buildings.some(b => b.id === 'bar-llevant'));
  assert.ok(view.buildings.some(b => b.id === 'bar-ponent'));
  assert.ok(!view.buildings.some(b => b.id === 'forn'));
  assert.equal(view.homeEntranceVisible, false); assert.equal(view.residentVisible, false);
  assert.equal(visiblePoint({ x: 100, y: 600 }, { x: 200, y: 700 }), false); // clear terrain diagonal
  assert.equal(visiblePoint({ x: 260, y: 460 }, { x: 480, y: 460 }), false); // nearby but inside solid home
  assert.equal(visiblePoint({ x: 210, y: 250 }, { x: 780, y: 175 }), false); // outside range
});
test('opening context enforces category-only clue and excludes hidden entrance/map', () => {
  const game = fresh(); answerCall(game, SATURDAY_NOON);
  const context = npcContext(game), request = buildJevRequest(game, actionCandidates(game, 'opening'), 'opening', '', SATURDAY_NOON);
  const serialized = JSON.stringify(request);
  assert.equal(context.homeEntrance, null); assert.equal(context.rememberedPlaces.length, 0);
  assert.ok(!serialized.includes('Llevant')); assert.ok(!serialized.includes('Ponent')); assert.ok(!serialized.includes('645'));
  assert.ok(!serialized.includes('Forn')); assert.ok(!serialized.includes('footprint'));
});
test('navigation detours around generated roof footprint and never cuts through buildings', () => {
  const start = { x: 210, y: 250 }, target = { x: 780, y: 175 };
  assert.equal(segmentClear(start, target), false);
  const route = findRoute(start, target); assert.ok(route && route.length >= 2);
  let position = start;
  for (const waypoint of route) { assert.ok(segmentClear(position, waypoint)); position = waypoint; }
  assert.equal(distance(position, target), 0);
  const south = findRoute(start, HOME_ENTRANCE); assert.ok(south);
  position = start;
  for (const waypoint of south) { assert.ok(segmentClear(position, waypoint)); position = waypoint; }
});
test('actual JEV probabilities choose a real route and raw instructions cannot choose arbitrary coordinates', async () => {
  const game = active(), chosen = 'go:bar-ponent';
  const result = await decide(game, 'Go to the other bar', undefined, { ...offline, key: 'fixture', fetcher: mockJev(() => chosen) });
  assert.equal(result?.source, 'jev'); assert.equal(result?.selected, chosen); assert.equal(result?.probabilities?.[chosen], 1);
  assert.equal(game.routeTargetId, 'bar-ponent'); assert.ok(game.route.length > 0); assert.equal(game.parcel, 'courier');
  await assert.rejects(() => queryJev(buildJevRequest(game, actionCandidates(game, 'directions'), 'directions', 'teleport', SATURDAY_NOON), 'fixture', undefined, mockJev(() => 'teleport:480:645')));
});
test('JEV transport uses Worker-compatible manual redirects and never follows a provider redirect', async () => {
  const game = active(); let requests = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    requests++; assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/collect' } });
  }) as typeof fetch;
  await assert.rejects(() => queryJev(buildJevRequest(game, actionCandidates(game, 'directions'), 'directions', 'Go south', SATURDAY_NOON), 'fixture-private-key', undefined, fetcher), /provider_http_302/);
  assert.equal(requests, 1);
});
test('vague wrong turn is recoverable with south entrance clarification', async () => {
  const game = active();
  const wrong = await decide(game, 'Walk to the bar', undefined, offline); assert.equal(wrong?.selected, 'go:bar-llevant');
  tickGame(game, SATURDAY_NOON + 1_000, 1); assert.equal(game.routeTargetId, 'bar-llevant');
  const recovery = await decide(game, 'Sorry, my home entrance is on the south side. Walk around the building.', undefined, { ...offline, now: () => SATURDAY_NOON + 1_000 });
  assert.equal(recovery?.selected, 'home:south');
  tickGame(game, SATURDAY_NOON + 10_000, 9); assert.ok(distance(game.courier, HOME_ENTRANCE) < 1);
  assert.equal(game.parcel, 'courier'); assert.equal(game.phase, 'active');
  assert.ok(game.history.some(entry => entry.role === 'player' && entry.text.includes('Sorry')));
});
test('a wrong reported north entrance remains a hypothesis with a legal route', async () => {
  const game = active(); const result = await decide(game, 'The entrance is on the north side', undefined, offline);
  assert.equal(result?.selected, 'home:north'); assert.ok(game.route.length > 0);
  tickGame(game, SATURDAY_NOON + 4_000, 4); assert.equal(game.courier.y, 200); assert.equal(game.parcel, 'courier');
});
test('multi-step directions do not replace an explicit south entrance with a later right turn', async () => {
  const game = active();
  await decide(game, 'My entrance is on the south side, then turn right toward the door', undefined, offline);
  assert.equal(game.facts.homeSide, 'south'); assert.equal(game.routeTargetId, 'home-south');
  await decide(game, 'It is not the north entrance. The door is at the bottom.', undefined, offline);
  assert.equal(game.facts.homeSide, 'south');
});
test('a short answer to an actual courier entrance question shares its remembered meaning', async () => {
  const game = active(); recordSpeech(game, 'Which side has your entrance?', 'clarification', SATURDAY_NOON);
  await decide(game, 'South.', undefined, { ...offline, key: 'fixture', fetcher: mockJev(() => 'home:south') });
  assert.equal(game.facts.homeSide, 'south'); assert.equal(game.routeTargetId, 'home-south');
  assert.ok(npcContext(game).history.some(entry => entry.text === 'Which side has your entrance?'));
});
test('sign clarification reveals only a currently visible sign; full spoken history persists', async () => {
  const game = active(); const decision = await decide(game, 'Which bar? What is the sign called?', undefined, offline);
  assert.equal(decision?.selected, 'reveal:bar-llevant'); assert.equal(game.facts.signDisclosed, true);
  recordSpeech(game, 'The sign says Bar Llevant.', 'actual', SATURDAY_NOON + 100);
  for (let i = 0; i < 12; i++) recordSpeech(game, `Actual remark ${i}`, `remark-${i}`, SATURDAY_NOON + i + 200);
  const history = npcContext(game).history;
  assert.ok(history.some(item => item.text === 'The sign says Bar Llevant.')); assert.ok(history.some(item => item.text === 'Actual remark 0'));
  assert.ok(!actionCandidates(game, 'directions').some(c => c.id === 'reveal:forn'));
});
test('authored hours use Barcelona weekday, split hours and overnight intervals', () => {
  assert.equal(barcelonaTime(SATURDAY_NOON).day, 6); assert.equal(barcelonaTime(SATURDAY_NOON).minutes, 720);
  assert.equal(isOpen(BUILDINGS.find(b => b.id === 'fruita')!, SATURDAY_NOON), true);
  assert.equal(isOpen(BUILDINGS.find(b => b.id === 'fruita')!, Date.parse('2026-10-10T14:00:00Z')), false);
  assert.equal(isOpen(BUILDINGS.find(b => b.id === 'mercat')!, Date.parse('2026-10-11T10:00:00Z')), false);
  assert.equal(isOpen({ openingHours: [{ days: [6], from: '22:00', to: '02:00' }] }, Date.parse('2026-10-10T23:00:00Z')), true);
});
test('timeout selects observed eligible collection site and physically walks there before drop', async () => {
  const game = active(); tickGame(game, SATURDAY_NOON + 60_000, 60);
  const result = await resolveTimeout(game, undefined, { ...offline, now: () => SATURDAY_NOON + 60_000, key: 'fixture', fetcher: mockJev(() => 'drop:bar-llevant') });
  assert.equal(result?.source, 'jev'); assert.equal(game.phase, 'timeout'); assert.equal(game.parcel, 'courier');
  assert.equal(game.dropLocationId, null); assert.equal(game.routeTargetId, 'bar-llevant');
  tickGame(game, SATURDAY_NOON + 62_000, 2);
  assert.equal(game.parcel, 'drop'); assert.equal(game.phase, 'resolved'); assert.equal(game.outcome?.kind, 'collection');
  assert.ok(game.outcome?.detail.includes('still need to collect')); assert.equal(distance(game.courier, BUILDINGS[0].entrance), 0);
});
test('timeout alternatives honor opening hours, parcel acceptance, perception and rain', () => {
  const game = active(); game.weather = { ...DEFAULT_WEATHER, isRain: true, description: 'Rain', status: 'live' };
  const candidates = actionCandidates(game, 'timeout', SATURDAY_NOON);
  assert.ok(candidates.some(c => c.id === 'drop:bar-llevant'));
  assert.ok(!candidates.some(c => c.id === 'drop:bar-ponent')); // does not accept parcels
  assert.ok(!candidates.some(c => c.id === 'drop:forn')); // unseen
  assert.ok(!candidates.some(c => c.id === 'drop:fruita')); // unsuitable
  assert.deepEqual(actionCandidates(game, 'timeout', Date.parse('2026-10-10T02:00:00Z')).map(c => c.id), ['return']);
});
test('a shop that closes while the courier is en route cannot receive a physical drop', async () => {
  const base = Date.parse('2026-10-10T21:28:59Z'); // Barcelona 23:28:59; Llevant closes 23:30.
  const game = createGame(DEFAULT_WEATHER, base); answerCall(game, base);
  Object.assign(game.courier, { x: 250, y: 650 });
  tickGame(game, base + 60_000, 0);
  const result = await resolveTimeout(game, undefined, { key: '', now: () => base + 60_000, telemetry: false });
  assert.equal(result?.selected, 'drop:bar-llevant'); assert.equal(game.parcel, 'courier');
  tickGame(game, base + 65_000, 5);
  assert.equal(game.parcel, 'returned'); assert.equal(game.outcome?.kind, 'returned');
  assert.equal(game.dropLocationId, null);
});
test('late provider response cannot overwrite newer decision or deadline state', async () => {
  const game = active(); let release!: () => void;
  const blockedFetch = (async (_url: unknown, init: RequestInit) => { await new Promise<void>(resolve => { release = resolve; }); return mockJev(() => 'go:bar-llevant')('', init); }) as typeof fetch;
  const pending = decide(game, 'Go to the bar', undefined, { ...offline, key: 'fixture', fetcher: blockedFetch });
  await decide(game, 'Wait', undefined, offline); release();
  const result = await pending; assert.equal(result?.discarded, true); assert.equal(result?.reason, 'stale'); assert.equal(game.decision?.selected, 'wait');
  let clock = SATURDAY_NOON;
  const deadlineFetch = (async (_url: unknown, init: RequestInit) => { clock = SATURDAY_NOON + 60_000; return mockJev(() => 'go:bar-llevant')('', init); }) as typeof fetch;
  const expired = await decide(game, 'Go to the bar', undefined, { key: 'fixture', fetcher: deadlineFetch, now: () => clock, telemetry: false });
  assert.equal(expired?.discarded, true); assert.equal(game.phase, 'timeout'); assert.equal(game.route.length, 0);
});
test('timeout ownership avoids duplicate paid calls and replay resets all state', async () => {
  const game = active(); tickGame(game, SATURDAY_NOON + 60_000, 60); let calls = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => { calls++; return mockJev(() => 'drop:bar-llevant')('', init); }) as typeof fetch;
  await Promise.all([resolveTimeout(game, undefined, { ...offline, key: 'fixture', fetcher, now: () => SATURDAY_NOON + 60_000 }), resolveTimeout(game, undefined, { ...offline, key: 'fixture', fetcher, now: () => SATURDAY_NOON + 60_000 })]);
  assert.equal(calls, 1);
  const replay = fresh(); assert.notEqual(replay.id, game.id); assert.equal(replay.phase, 'incoming'); assert.equal(replay.deadline, null); assert.equal(replay.history.length, 0); assert.equal(replay.route.length, 0); assert.equal(replay.parcel, 'courier'); assert.equal(replay.facts.firstClueSpoken, false); assert.equal(replay.decision, null);
});
test('fallback/outage never invents probabilities and stalled timeout returns without teleporting', async () => {
  const game = active(); const decision = await decide(game, 'Go east', undefined, { ...offline, key: 'fixture', fetcher: (async () => { throw new Error('outage'); }) as typeof fetch });
  assert.equal(decision?.source, 'fallback'); assert.equal(decision?.probabilities, null); assert.equal(decision?.model, null);
  tickGame(game, SATURDAY_NOON + 60_000, 0); const position = { x: game.courier.x, y: game.courier.y };
  tickGame(game, SATURDAY_NOON + 81_000, 0); assert.equal(game.parcel, 'returned'); assert.equal(game.phase, 'resolved'); assert.equal(distance(game.courier, position), 0);
});
