import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, DEFAULT_WEATHER, HOME_ENTRANCE, RESIDENT_POSITION, WALLS, LANDMARKS, barcelonaTime, distance, findRoute, isOpen, segmentClear, visiblePoint, walkable } from '../src/shared/world.js';
import { actionCandidates, answerCall, canHandoff, createGame, handoff, moveResident, npcContext, perception, publicGame, recordSpeech, rememberObservations, tickGame } from '../src/server/game.js';
import { buildJevRequest, decide, fallbackChoice, queryJev, resolveTimeout } from '../src/server/jev.js';

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
test('only courier physical arrival at the correct entrance allows handoff while resident stays inside', () => {
  const game = active(); assert.equal(handoff(game, SATURDAY_NOON + 1), false);
  game.courier.x = 480; game.courier.y = 200;
  assert.equal(handoff(game, SATURDAY_NOON + 2), false);
  Object.assign(game.courier, HOME_ENTRANCE);
  assert.deepEqual({x:game.resident.x,y:game.resident.y},RESIDENT_POSITION);
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
test('resident is fixed inside the apartment and legacy movement cannot relocate them', () => {
  const game = active();
  for (const input of [[1,0,10],[-1,1,1],[0,0,0],[Infinity,NaN,-1]]) assert.equal(moveResident(game, ...input as [number,number,number]), false);
  assert.deepEqual({x:game.resident.x,y:game.resident.y}, RESIDENT_POSITION); assert.equal(game.resident.moving,false);
  assert.equal(walkable(RESIDENT_POSITION), false);
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


test('facing restricts current perception while observed places remain distinct memory', async () => {
  const game = active();
  const result = await decide(game, 'Look south', undefined, offline);
  assert.equal(result?.selected,'look:south'); assert.equal(game.courier.direction,'south');
  assert.ok(!perception(game).buildings.some(b=>b.id==='bar-llevant'));
  assert.ok(game.knowledge['bar-llevant']);
  const context=npcContext(game);
  assert.ok(context.rememberedPlaces.some(b=>'name' in b && b.name==='Bar Llevant' && !b.visible));
  assert.ok(!context.visibleLandmarks.some(l=>l.id==='courtyard-fountain'));
  assert.ok(!JSON.stringify(context).includes('footprint'));
});
test('fruit crates, awning and visible distances are grounded without seeing through shop walls', () => {
  const game=active(); Object.assign(game.courier,{x:260,y:460,direction:'west'}); rememberObservations(game);
  const context=npcContext(game), view=perception(game);
  assert.ok(view.buildings.some(b=>b.id==='fruita'));
  assert.ok(context.visibleLandmarks.some(l=>l.id==='fruit-display' && l.type==='fruit-display'));
  assert.ok(context.visibleLandmarks.some(l=>l.id==='fruit-awning'));
  assert.equal(context.surroundings.furthestVisible?.distance, Math.max(...view.landmarks.map(l=>l.distance),...view.buildings.map(b=>b.distance)));
  assert.ok(context.rememberedLandmarks.every(l=>!('distance' in l) && !('direction' in l)));
  assert.equal(visiblePoint({x:190,y:400},{x:20,y:400},undefined,'west'),false);
  assert.ok(WALLS.some(w=>w.buildingId==='fruita')); assert.ok(LANDMARKS.some(l=>l.buildingId==='forn' && l.type==='corner'));
});
test('street crossing follows actual stripes and real JEV selects only observed affordances', async () => {
  const game=active();
  const candidates=actionCandidates(game,'directions');
  assert.ok(candidates.some(c=>c.id==='cross:crossing-nw'));
  assert.ok(!candidates.some(c=>c.id==='cross:crossing-ne'));
  const selected='cross:crossing-nw';
  const result=await decide(game,'Cross the street via the pedestrian crossing',undefined,{...offline,key:'fixture',fetcher:mockJev(()=>selected)});
  assert.equal(result?.source,'jev'); assert.equal(result?.probabilities?.[selected],1);
  assert.deepEqual(game.route.slice(-2),[{x:180,y:250},{x:180,y:175}]);
  let start={x:game.courier.x,y:game.courier.y}; for(const end of game.route){assert.ok(segmentClear(start,end));start=end;}
  tickGame(game,SATURDAY_NOON+2_000,2); assert.equal(game.courier.x,180); assert.equal(game.courier.y,175);
});
test('relative turns use actual courier heading and description requests do not move', async () => {
  const game=active(); Object.assign(game.courier,{x:230,y:400,direction:'east'}); rememberObservations(game);
  const result=await decide(game,'Walk left',undefined,offline);
  assert.equal(result?.selected,'walk:north');
  const before={x:game.courier.x,y:game.courier.y};
  const description=await decide(game,'What is the furthest thing you can see?',undefined,offline);
  assert.equal(description?.selected,'describe-surroundings'); assert.deepEqual({x:game.courier.x,y:game.courier.y},before);
});
test('observed corners and intersections have physical routes while hidden ones stay excluded', async () => {
  const game=active(); await decide(game,'Look south',undefined,offline);
  const candidates=actionCandidates(game,'directions');
  assert.ok(candidates.some(c=>c.id==='landmark:home-corner-nw'));
  assert.ok(!candidates.some(c=>c.id==='landmark:home-corner-ne'));
  const result=await decide(game,'Go around the building to its northwest corner',undefined,{...offline,key:'fixture',fetcher:mockJev(()=> 'around:home-corner-nw')});
  assert.equal(result?.selected,'around:home-corner-nw');
  tickGame(game,SATURDAY_NOON+1_000,1); assert.ok(distance(game.courier,{x:260,y:285})<1);
  await decide(game,'Look around',undefined,{...offline,now:()=>SATURDAY_NOON+1_000});
  const junction=actionCandidates(game,'directions').find(c=>c.id==='landmark:intersection-nw'); assert.ok(junction);
});

test('a visible corner never reveals a business name before its sign is observed', () => {
  const game=active(); Object.assign(game.courier,{x:40,y:40,direction:'south'}); rememberObservations(game);
  assert.equal(game.knowledge.fruita,undefined);
  const corner=perception(game).landmarks.find(l=>l.id==='fruita-corner-0'); assert.ok(corner);
  assert.equal(corner.label,'northwest corner of a fruit shop');
  const request=buildJevRequest(game,actionCandidates(game,'directions'),'directions','Go around that fruit shop',SATURDAY_NOON);
  assert.ok(!JSON.stringify(request).includes('Fruita Fresca'));
  assert.ok(npcContext(game).rememberedLandmarks.some(l=>l.id==='fruita-corner-0' && !l.label.includes('Fruita Fresca')));
  Object.assign(game.courier,{x:260,y:460,direction:'west'}); rememberObservations(game);
  assert.equal(game.knowledge['fruita' as string].name,'Fruita Fresca');
  Object.assign(game.courier,{x:40,y:40,direction:'south'}); rememberObservations(game);
  assert.equal(perception(game).landmarks.find(l=>l.id==='fruita-corner-0')?.label,'northwest corner of Fruita Fresca');
});

test('explicit south entrance route wins over intermediate corners while facing south', async () => {
  const game=active(); await decide(game,'Look south.',undefined,offline);
  const phrase='Go around the central apartment building to my entrance on the south side.';
  let checked=false;
  const result=await decide(game,phrase,undefined,{...offline,key:'fixture',fetcher:mockJev(criteria=>{
    assert.ok(criteria['home:south']); assert.ok(!Object.keys(criteria).some(id=>id.startsWith('landmark:') || id.startsWith('around:')));
    assert.ok(JSON.stringify(criteria['home:south']).includes('Complete exterior route'));
    checked=true;return 'home:south';
  })});
  assert.ok(checked);assert.equal(result?.source,'jev');assert.equal(result?.selected,'home:south');
  assert.deepEqual(game.route.at(-1),HOME_ENTRANCE);
  tickGame(game,SATURDAY_NOON+10_000,10);assert.ok(canHandoff(game,SATURDAY_NOON+10_000));
});

test('Spanish demo commands map to grounded intents and preserve original conversation words', async () => {
  const game=active();
  assert.equal((await decide(game,'¿Qué bar? ¿Cómo se llama?',undefined,offline))?.selected,'reveal:bar-llevant');
  assert.equal((await decide(game,'¿Qué ves?',undefined,offline))?.selected,'describe-surroundings');
  assert.equal((await decide(game,'Mira hacia el sur.',undefined,offline))?.selected,'look:south');
  assert.equal((await decide(game,'Ve a la frutería.',undefined,offline))?.selected,'go:fruita');
  assert.equal((await decide(game,'Cruza la calle por el paso de peatones.',undefined,offline))?.selected,'cross:crossing-nw');
  const phrase='Rodea el edificio y ven a mi portal, en el lado sur.';
  const result=await decide(game,phrase,undefined,{...offline,key:'fixture',fetcher:mockJev(criteria=>{assert.ok(criteria['home:south']);assert.ok(!criteria['landmark:home-corner-nw']);return 'home:south';})});
  assert.equal(result?.source,'jev');assert.equal(result?.selected,'home:south');assert.equal(game.facts.homeSide,'south');
  assert.ok(game.history.some(h=>h.role==='player' && h.text===phrase));
  assert.deepEqual(game.route.at(-1),HOME_ENTRANCE);
});
test('Spanish entrance-side beliefs, negation and short answers remain conversational hypotheses', async () => {
  const game=active();
  await decide(game,'Estoy en casa; la entrada está al sur.',undefined,offline);assert.equal(game.facts.homeSide,'south');
  await decide(game,'La entrada no está al norte. Está en el lado sur.',undefined,offline);assert.equal(game.facts.homeSide,'south');
  recordSpeech(game,'¿En qué lado está tu portal?','side-question',SATURDAY_NOON);
  await decide(game,'Norte.',undefined,offline);assert.equal(game.facts.homeSide,'north');
  assert.deepEqual(game.route.at(-1),{x:480,y:200});
});

test('timeout scans current surroundings and chooses the nearest eligible physical walking route', async () => {
  for(const fixture of [{x:210,y:250,shop:'bar-llevant'},{x:730,y:250,shop:'mercat'},{x:730,y:460,shop:'forn'},{x:730,y:640,shop:'forn'}]){
    const game=active();Object.assign(game.courier,{x:fixture.x,y:fixture.y,direction:'west'});
    tickGame(game,SATURDAY_NOON+60_000,0);
    const decision=await resolveTimeout(game,undefined,{...offline,now:()=>SATURDAY_NOON+60_000});
    assert.equal(decision?.selected,`drop:${fixture.shop}`);assert.equal(game.courier.direction,'west');
    assert.ok(game.knowledge[fixture.shop]);assert.ok(decision?.action.reason.includes('Walking-distance rank 1'));
    let anchor={x:game.courier.x,y:game.courier.y};for(const p of game.route){assert.ok(segmentClear(anchor,p));anchor=p;}
    tickGame(game,SATURDAY_NOON+72_000,12);assert.equal(game.dropLocationId,fixture.shop);assert.equal(game.parcel,'drop');assert.equal(game.outcome?.kind,'collection');
  }
});
test('timeout fallback compares walking route lengths rather than Euclidean target distance', () => {
  const game=active();
  const far={id:'drop:far',type:'drop' as const,label:'far straight line',reason:'fixture',target:{x:250,y:250},route:[{x:250,y:250}]};
  const near={id:'drop:near',type:'drop' as const,label:'near but detour',reason:'fixture',target:{x:220,y:250},route:[{x:210,y:500},{x:220,y:500},{x:220,y:250}]};
  assert.equal(fallbackChoice(game,[near,far],'timeout','').id,'drop:far');
});

test('streamed speech upserts one accumulated turn and learns the actual final Spanish question', async () => {
  const game=active();const id='stream-question';
  recordSpeech(game,'Vale, te escucho.',id,SATURDAY_NOON);
  assert.equal(game.facts.lastClarification,null);
  recordSpeech(game,'Vale, te escucho. ¿En qué lado está tu portal?',id,SATURDAY_NOON+10);
  assert.equal(game.history.filter(h=>h.turnId===id).length,1);
  assert.equal(game.facts.lastClarification,'Vale, te escucho. ¿En qué lado está tu portal?');
  assert.equal(npcContext(game).lastClarification,game.facts.lastClarification);
  const result=await decide(game,'Por el sur.',undefined,offline);
  assert.equal(game.facts.homeSide,'south');assert.equal(result?.selected,'home:south');
});
test('Spanish preposition para does not stop navigation and accented confirmation preserves the active route', async () => {
  const game=active();
  const route=await decide(game,'Para llegar a mi portal, la entrada está al sur.',undefined,offline);
  assert.equal(route?.selected,'home:south');const destination=game.route.at(-1);
  const confirmation=await decide(game,'Sí, continúa adelante.',undefined,offline);
  assert.equal(confirmation?.selected,'continue');assert.deepEqual(game.route.at(-1),destination);
  await decide(game,'Para aquí.',undefined,offline);assert.equal(game.route.length,0);
});
test('a wrong-side correction and Spanish short answer recover without resetting heard facts', async () => {
  const game=active();await decide(game,'La entrada está al norte.',undefined,offline);
  tickGame(game,SATURDAY_NOON+2_000,2);assert.ok(game.courier.y<=250);
  recordSpeech(game,'¿En qué lado está tu portal?', 'actual-side',SATURDAY_NOON+2_000);
  const answer=await decide(game,'No, perdón, por el sur.',undefined,{...offline,now:()=>SATURDAY_NOON+2_000});
  assert.equal(game.facts.homeSide,'south');assert.equal(answer?.selected,'home:south');
  tickGame(game,SATURDAY_NOON+12_000,10);assert.ok(canHandoff(game,SATURDAY_NOON+12_000));
});

test('explicit retraction clears the wrong entrance hypothesis and pauses that route until corrected', async () => {
  const game=active();await decide(game,'La entrada está al norte.',undefined,offline);
  await decide(game,'No, ese no es mi portal.',undefined,offline);
  assert.equal(game.facts.homeSide,null);assert.equal(game.route.length,0);assert.equal(game.courier.moving,false);
  recordSpeech(game,'¿En qué lado está tu portal?', 'correction-question',SATURDAY_NOON);
  assert.equal((await decide(game,'Por el sur.',undefined,offline))?.selected,'home:south');
  assert.equal(game.facts.homeSide,'south');
});
