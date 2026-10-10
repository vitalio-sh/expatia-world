import {
  BUILDINGS, COURIER_SPEED, DEFAULT_WEATHER, HOME_ENTRANCE, RESIDENT_POSITION, LANDMARKS, ROADS, SIGHT_RANGE, VIEW_ANGLE_DEGREES,
  ROUND_MS, WORLD_MAP, barcelonaTime, directionBetween, relativeDirection, distance, findRoute, isOpen,
  segmentClear, visiblePoint, visibleRouteLeg, walkable, insidePolygon, type ActionCandidate, type Decision, type Game,
  type HistoryEntry, type Observation, type LandmarkObservation, type Point, type Weather,
} from '../shared/world.js';

export function createGame(weather: Weather = DEFAULT_WEATHER, now = Date.now()): Game {
  const game: Game = {
    id: globalThis.crypto.randomUUID(), phase: 'incoming', demoMode: false, demoStep: 0, startedAt: null, deadline: null, resolvedAt: null, updatedAt: now,
    courier: { x: 210, y: 250, direction: 'north', moving: false },
    resident: { ...RESIDENT_POSITION, direction: 'south', moving: false },
    route: [], routeTargetId: null, routeDestination: null, routeComplete: false, legEndsAtWaypoint: false, awaitingGuidance: false, previousDestination: null, parcel: 'courier', dropLocationId: null,
    outcome: null, history: [], weather: { ...weather }, knowledge: {}, landmarkKnowledge: {}, departureVisibleBuildingIds: [], departureVisibleLandmarkIds: [], newlyVisibleBuildingIds: [], newlyVisibleLandmarkIds: [],
    facts: { homeSide: null, signDisclosed: false, firstClueSpoken: false, lastClarification: null },
    decision: null, decisions: [], sequence: 0, timeoutPending: false, timeoutStartedAt: null, arrivalSequence: 0,
  };
  rememberObservations(game, now);
  return game;
}
export function remainingMs(game: Game, now = Date.now()) { return game.deadline === null ? ROUND_MS : Math.max(0, game.deadline - (game.resolvedAt ?? now)); }
export function recordHistory(game: Game, entry: HistoryEntry) {
  // One round is short; keep every actual turn, never a separate director memory.
  game.history.push({ ...entry, text: entry.text.slice(0, 2_000) });
}
export function recordSpeech(game: Game, text: string, turnId?: string, now = Date.now()) {
  const accumulated = text.trim().slice(0, 2_000);
  if (!accumulated) return;
  const existing = turnId ? game.history.find(h => h.role === 'courier' && h.turnId === turnId) : undefined;
  if (existing) existing.text = accumulated;
  else recordHistory(game, { role: 'courier', text: accumulated, at: now, turnId });
  game.facts.firstClueSpoken = true;
  game.facts.lastClarification = accumulated.includes('?') ? accumulated : null;
}
export function answerCall(game: Game, now = Date.now()) {
  if (game.phase !== 'incoming') return false;
  game.startedAt = now; game.deadline = now + ROUND_MS; game.updatedAt = now; game.phase = 'active';
  recordHistory(game, { role: 'event', text: 'The resident answered the incoming delivery call. The 60-second delivery window began.', at: now });
  return true;
}
export function perception(game: Game, now = game.updatedAt): { buildings: Observation[]; landmarks: LandmarkObservation[]; residentVisible: boolean; homeEntranceVisible: boolean; directions: Record<string, boolean> } {
  const sees = (point: Point) => visiblePoint(game.courier, point, undefined, game.courier.direction);
  const buildings = BUILDINGS.filter(b => sees(b.sign)).map(b => ({
    id: b.id, name: b.name, category: b.category, entrance: { ...b.entrance }, observedAt: now, source: 'observed' as const,
    acceptsParcels: b.acceptsParcels, accessible: b.accessible, sheltered: b.sheltered, openingHours: b.openingHours,
    distance: Math.round(distance(game.courier, b.sign)), direction: directionBetween(game.courier, b.sign), open: isOpen(b, now),
  }));
  const landmarks = LANDMARKS.filter(l => sees(l.point)).map(l => {
    const building = BUILDINGS.find(b => b.id === l.buildingId);
    const named = !building || !!game.knowledge[building.id] || buildings.some(b => b.id === building.id);
    const scoped = building && !named ? { ...l, label: l.label.replaceAll(building.name, `a ${building.category}`), description: l.description.replaceAll(building.name, `a ${building.category}`) } : l;
    return { ...scoped, observedAt: now, source: 'observed' as const, distance: Math.round(distance(game.courier, l.point)), direction: directionBetween(game.courier, l.point) }; });
  const offsets = { north: { x: 0, y: -45 }, east: { x: 45, y: 0 }, south: { x: 0, y: 45 }, west: { x: -45, y: 0 } };
  return { buildings, landmarks, residentVisible: sees(game.resident), homeEntranceVisible: sees(HOME_ENTRANCE),
    directions: Object.fromEntries(Object.entries(offsets).map(([d, p]) => [d, segmentClear(game.courier, { x: game.courier.x + p.x, y: game.courier.y + p.y })])) };
}
export function rememberObservations(game: Game, now = game.updatedAt) {
  const view = perception(game, now);
  for (const observed of view.buildings) {
    const { distance: _distance, direction: _direction, open: _open, ...known } = observed;
    game.knowledge[observed.id] = known;
  }
  for (const observed of view.landmarks) {
    const { distance: _distance, direction: _direction, ...known } = observed;
    game.landmarkKnowledge[observed.id] = known;
  }
}
/** A physical stationary scan learns only range/LOS-visible facts, then restores heading. */
export function scanSurroundings(game: Game, now = game.updatedAt) {
  const original = game.courier.direction;
  for (const facing of ['north','east','south','west'] as const) { game.courier.direction = facing; rememberObservations(game, now); }
  game.courier.direction = original;
}
export function routeDistance(start: Point, route: Point[] | undefined) {
  return route?.reduce((sum, p, i) => sum + distance(i ? route[i - 1] : start, p), 0) ?? Infinity;
}
/** The resident stays inside the apartment; legacy movement messages are inert. */
export function moveResident(game: Game, _dx: number, _dy: number, _dt: number) {
  Object.assign(game.resident, RESIDENT_POSITION, { moving: false });
  return false;
}
export function canHandoff(game: Game, now = Date.now()) {
  return game.phase === 'active' && game.parcel === 'courier' && remainingMs(game, now) > 0
    && distance(game.courier, HOME_ENTRANCE) <= 32 && segmentClear(game.courier, HOME_ENTRANCE);
}
export function handoff(game: Game, now = Date.now()) {
  tickGame(game, now, 0);
  if (!canHandoff(game, now)) return false;
  game.parcel = 'resident'; game.phase = 'resolved'; game.resolvedAt = now; game.route = []; game.courier.moving = false; game.resident.moving = false;
  game.outcome = { kind: 'received', title: 'Parcel received!', detail: 'You guided the courier to your apartment entrance and accepted the parcel.', feedback: game.facts.signDisclosed ? 'Asking for the sign removed the ambiguity. Clear directions brought the courier to the entrance.' : 'Your directions brought the courier to the apartment door. A landmark name can make the next delivery even easier.' };
  recordHistory(game, { role: 'event', text: 'The courier physically reached the apartment entrance and the resident accepted the parcel.', at: now });
  return true;
}
export function enterTimeout(game: Game, now = Date.now()) {
  if (game.phase !== 'active' || game.deadline === null || now < game.deadline) return false;
  game.phase = 'timeout'; game.route = []; game.courier.moving = false; game.resident.moving = false;
  game.timeoutPending = true; game.timeoutStartedAt = now; game.sequence++;
  recordHistory(game, { role: 'event', text: 'The 60-second window ended without a handoff. The parcel is still with the courier while an observed collection alternative is evaluated.', at: game.deadline });
  return true;
}
function returnParcel(game: Game, now: number, detail: string) {
  game.parcel = 'returned'; game.phase = 'resolved'; game.resolvedAt = now; game.timeoutPending = false; game.route = []; game.courier.moving = false;
  game.outcome = { kind: 'returned', title: 'Delivery missed', detail, feedback: 'Clarify the landmark, give the entrance side, then guide the courier to the door and accept the parcel.' };
  recordHistory(game, { role: 'event', text: 'No physical handoff or suitable completed drop-off. The courier kept the parcel for return to the depot.', at: now });
}
function finishRoute(game: Game, now: number) {
  game.courier.moving = false;
  if (game.phase === 'active') {
    // A stationary look makes the next visible cue useful without authorizing
    // another movement leg or projecting the unseen remainder of the route.
    if (!game.routeComplete && game.legEndsAtWaypoint && game.routeDestination) {
      const next = findRoute(game.courier, game.routeDestination)?.find(point => distance(game.courier, point) > 0.1);
      if (next) {
        game.courier.direction = directionBetween(game.courier, next);
        recordHistory(game, { role: 'event', text: `At the visible-leg stop the courier looked ${game.courier.direction} while standing still, to inspect the next visible direction. No new movement was started.`, at: now });
      }
    }
    rememberObservations(game, now);
    const view = perception(game, now);
    game.newlyVisibleBuildingIds = view.buildings.filter(b => !game.departureVisibleBuildingIds.includes(b.id)).map(b => b.id);
    game.newlyVisibleLandmarkIds = view.landmarks.filter(l => !game.departureVisibleLandmarkIds.includes(l.id)).map(l => l.id);
  }
  game.arrivalSequence++;
  if (game.phase === 'timeout' && game.routeTargetId) {
    const location = BUILDINGS.find(b => b.id === game.routeTargetId);
    if (!location || !game.knowledge[location.id] || !isOpen(location, now) || !location.acceptsParcels || !location.accessible || (game.weather.isRain && !location.sheltered) || distance(game.courier, location.entrance) > 15) {
      returnParcel(game, now, 'The observed alternative could not accept the parcel on arrival. It is returning to the depot; arrange another delivery.'); return;
    }
    game.parcel = 'drop'; game.dropLocationId = location.id; game.phase = 'resolved'; game.resolvedAt = now; game.timeoutPending = false;
    game.outcome = { kind: 'collection', title: 'Parcel waiting for collection', detail: `The courier reached ${location.name} and left your parcel there. You still need to collect it from the shop.`, feedback: 'The alternative kept the parcel accessible. Next time, confirm the bar name and say which side has your entrance.' };
    recordHistory(game, { role: 'event', text: `The courier physically reached the open ${location.name} entrance and left the parcel for collection. The resident has not received it.`, at: now });
  } else if (game.routeTargetId && !(game.routeComplete && game.routeTargetId === 'home-south' && canHandoff(game, now))) {
    game.awaitingGuidance = true;
    recordHistory(game, { role: 'event', text: `The courier stopped at the end of the current visible movement leg. ${game.routeComplete ? 'The requested waypoint was reached.' : 'The intended destination remains remembered, but has not been reached.'} The courier awaits a new resident command and does not start another leg automatically.`, at: now });
  } else if (game.routeTargetId) {
    game.awaitingGuidance = false;
    const label = game.routeTargetId === 'home-south' ? 'the entrance described by the resident' : game.knowledge[game.routeTargetId]?.name ?? game.landmarkKnowledge[game.routeTargetId]?.label ?? 'the requested waypoint';
    recordHistory(game, { role: 'event', text: `The courier arrived at ${label}. The parcel remains with the courier until a physical handoff.`, at: now });
  }
}
export function tickGame(game: Game, now = Date.now(), dt = Math.max(0, (now - game.updatedAt) / 1000)) {
  if (!Number.isFinite(now) || now < game.updatedAt) return;
  Object.assign(game.resident, RESIDENT_POSITION, { moving: false });
  const prior = game.updatedAt;
  let travelSeconds = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, (now - prior) / 1000));
  if (game.phase === 'active' && game.deadline !== null) travelSeconds = Math.min(travelSeconds, Math.max(0, (game.deadline - prior) / 1000));
  game.updatedAt = now;
  if (game.phase === 'active' || (game.phase === 'timeout' && !game.timeoutPending)) {
    let available = COURIER_SPEED * travelSeconds;
    while (game.route.length && available > 0) {
      const target = game.route[0], d = distance(game.courier, target);
      const step = Math.min(available, d), next = { x: game.courier.x + (target.x - game.courier.x) * step / Math.max(d, 0.001), y: game.courier.y + (target.y - game.courier.y) * step / Math.max(d, 0.001) };
      if (!segmentClear(game.courier, next)) { game.route = []; game.courier.moving = false; recordHistory(game, { role: 'event', text: 'The courier stopped at an obstruction; a new direction is needed.', at: now }); break; }
      if (game.phase === 'active' && game.parcel === 'courier') {
        const start = { x: game.courier.x, y: game.courier.y }, dx = next.x - start.x, dy = next.y - start.y;
        const fraction = Math.max(0, Math.min(1, ((HOME_ENTRANCE.x - start.x) * dx + (HOME_ENTRANCE.y - start.y) * dy) / Math.max(dx * dx + dy * dy, 0.000001)));
        const nearest = { x: start.x + dx * fraction, y: start.y + dy * fraction };
        if (distance(nearest, HOME_ENTRANCE) <= 32 && segmentClear(nearest, HOME_ENTRANCE)) {
          // Swept proximity catches a door crossed between ticks. Any alignment
          // is an actual collision-clear walk within this tick's travel budget.
          const aligned = distance(start, nearest) + distance(nearest, HOME_ENTRANCE) <= available && segmentClear(start, HOME_ENTRANCE);
          Object.assign(game.courier, aligned ? HOME_ENTRANCE : nearest, { direction: directionBetween(start, HOME_ENTRANCE), moving: false });
          game.route = []; game.routeTargetId = 'home-south'; game.routeDestination = { ...HOME_ENTRANCE }; game.routeComplete = true; game.legEndsAtWaypoint = true; game.awaitingGuidance = false;
          rememberObservations(game, now); finishRoute(game, now); break;
        }
      }
      game.courier.direction = directionBetween(game.courier, target); game.courier.x = next.x; game.courier.y = next.y; game.courier.moving = step > 0; available -= step;
      rememberObservations(game, now);
      if (d <= step + 0.01) { game.route.shift(); if (!game.route.length) finishRoute(game, now); }
    }
  }
  rememberObservations(game, now);
  enterTimeout(game, now);
  // A broken network cannot keep an expired round pending forever. No false drop.
  if (game.phase === 'timeout' && game.timeoutStartedAt !== null && now - game.timeoutStartedAt > 20_000) returnParcel(game, now, 'The courier could not complete a suitable collection drop-off. The parcel is returning to the depot; arrange another delivery.');
}

/** Deterministic navigation vocabulary only. Original player quotes stay in history. */
export function navigationText(text: string) {
  const vocabulary: Record<string,string> = { por:'on', de:'on', del:'on the', mueve:'move', mover:'move', ir:'go', venir:'come', llegues:'reach', llegar:'reach', vuelve:'go back', no:'not', es:'is', ese:'that', esa:'that', si:'yes', vale:'okay', sigue:'continue', siga:'continue', continua:'continue', continue:'continue', adelante:'forward', gira:'turn', gire:'turn', girar:'turn', vuelva:'go back', vete:'go', vaya:'go', camina:'walk', camine:'walk', anda:'walk', andando:'walking', bajar:'go south', baja:'go south', perdon:'sorry', otro:'other', otra:'other', que:'what', cual:'which', como:'how', llama:'called', ves:'see', ve:'go', ven:'come', mira:'look', cruza:'cross', rodea:'go around', edificio:'building', fruteria:'fruit shop', frutas:'fruit', fruta:'fruit', calle:'street', interseccion:'intersection', cruce:'intersection', esquina:'corner', entrada:'entrance', portal:'door', puerta:'door', casa:'home', apartamento:'apartment', piso:'flat', lado:'side', sur:'south', norte:'north', este:'east', oeste:'west', abajo:'bottom', arriba:'top', derecha:'right', izquierda:'left', recto:'straight', delante:'forward', atras:'back', espera:'wait', detente:'stop', hacia:'toward', esta:'is', en:'on', al:'on the', el:'the', la:'the', mi:'my', tu:'your' };
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/^\s*para(?:te)?(?:\s+(?:aqui|ahi|un momento|por favor))?[.!?]*\s*$/, 'stop')
    .replace(/\bpaso de peatones\b/g,'pedestrian crossing')
    // Spanish demonstrative este is not the compass east in “este tramo”.
    .replace(/\beste\s+(tramo|calle|camino|edificio|lado|lugar|punto|portal|paso|cruce|barrio)\b/g,'this $1')
    .replace(/\b[a-z]+\b/g, word=>vocabulary[word]??word)
    .replace(/\bside\s+(north|south|east|west)\b/g,'$1 side')
    .replace(/\b(entrance|door)\s*,\s*((?:on|at)\s+(?:the\s+)?(?:north|south|east|west)\s+side)/g,'$1 $2');
}
export function hasNegatedNavigation(text: string) {
  return /\b(?:not|don't|do not)\s+(?:go|walk|head|come|reach|approach|navigate|move|turn|look|face|wait|stop|mires|vayas|vengas|camines|gires|avances)\b/.test(navigationText(text));
}
export function isOrientationQuestion(text: string) {
  const words = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const heading = /\b(facing|looking|face|look|miras|mirando|orientado|orientada)\b/.test(words);
  const asksHeading = /\b(where|which\s+(?:way|direction)|what\s+direction|donde|direccion|(?:que|cual)\s+lado)\b/.test(words);
  const asksCurrent = /\b(?:are\s+you\s+(?:facing|looking)|do\s+you\s+face|estas\s+(?:mirando|orientad[oa]))\b/.test(words) && /[?¿]/.test(words);
  return heading && (asksHeading || asksCurrent);
}
function contextualEntranceStatement(game: Game, text: string) {
  const lastCourier = navigationText(game.history.filter(h => h.role === 'courier').at(-1)?.text ?? '');
  const statement = navigationText(text);
  // A broken declarative answer can retain the delivery subject from an actual
  // “where next?” question. An explicit walking instruction remains a street step.
  const nextWayQuestion = /\?/.test(lastCourier) && /\b(donde|where|which way|which direction)\b/.test(lastCourier) && /\b(continue|go|head|walk|sigo|voy|follow)\b/.test(lastCourier);
  const identifiedBar = game.facts.signDisclosed || game.decision?.action.type === 'reveal' || Object.values(game.knowledge).some(b => b.category === 'bar' && lastCourier.includes(navigationText(b.name)) && !/\bnot\b/.test(lastCourier));
  // Facts are learned before selecting the action for this same turn, so an
  // entrance route (not the freshly learned side flag) marks assigned routing.
  const unassignedDeliverySubject = identifiedBar && !game.routeTargetId?.startsWith('home-');
  return (nextWayQuestion || unassignedDeliverySubject)
    && /\b(is|located|faces)\b/.test(statement)
    && !/\b(not|go|walk|head|come|reach|approach|navigate|move|turn|look|face|cross|stop|wait|bar|shop|bakery|fruit|supermarket|hairdresser|peluqueria|perruqueria|mercat|forn|intersection|junction|street|road|corner|crossing|tree|fountain|crate)\b/.test(statement)
    && !Object.values(game.knowledge).some(b => statement.includes(navigationText(b.name)))
    && !/[?¿]/.test(text);
}
function requestedNextTurn(text: string): 'left' | 'right' | null {
  return navigationText(text).match(/\b(?:next|proxim[ao])\b[^.!?]{0,40}\b(left|right)\b/)?.[1] as 'left' | 'right' | undefined ?? null;
}
function pendingRouteTurns(game: Game, side: 'left' | 'right') {
  if (!game.routeTargetId?.startsWith('home-') || game.routeComplete || !game.routeDestination) return false;
  const forward = { north: {x:0,y:-1}, east:{x:1,y:0}, south:{x:0,y:1}, west:{x:-1,y:0} }[game.courier.direction];
  let anchor = {x:game.courier.x,y:game.courier.y};
  for (const point of findRoute(anchor, game.routeDestination) ?? []) {
    const dx=point.x-anchor.x,dy=point.y-anchor.y,length=Math.hypot(dx,dy),turn=forward.x*dy-forward.y*dx;
    if (Math.abs(turn)>length*0.25) return (turn<0?'left':'right')===side;
    anchor=point;
  }
  return false;
}
export function learnPlayerFacts(game: Game, text: string) {
  if (isOrientationQuestion(text)) return;
  // Learn an explicit side claim, rather than treating every direction elsewhere
  // in a multi-step instruction as an entrance coordinate. It remains a belief.
  const mapping: Record<string, NonNullable<Game['facts']['homeSide']>> = { south: 'south', bottom: 'south', lower: 'south', back: 'south', north: 'north', top: 'north', upper: 'north', east: 'east', right: relativeDirection(game.courier.direction,'right'), west: 'west', left: relativeDirection(game.courier.direction,'left') };
  const lastCourier = navigationText(game.history.filter(entry => entry.role === 'courier').at(-1)?.text ?? '');
  const normalized = navigationText(text).replace(/\b(?:eh+|um+|uh+|em+|mmm+)\b/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const shortAnswer = normalized.trim().replace(/[.!?¿¡]/g, '');
  const priorSide = game.facts.homeSide;
  const retractsEntrance = /\b(?:is not|isn't|not is)\s+(?:my|the|your)\s+(?:entrance|door)|\bwrong\s+(?:entrance|door)/.test(normalized);
  const retractsSide = priorSide && new RegExp(`\\b(?:entrance|door)\\b[^.!?;]{0,30}\\bnot\\b[^.!?;]{0,20}\\b${priorSide}\\b`).test(normalized);
  if (priorSide && (retractsEntrance || retractsSide)) {
    game.facts.homeSide = null;
    if (game.routeTargetId === `home-${priorSide}`) { game.route = []; game.routeTargetId = null; game.courier.moving = false; recordHistory(game, { role: 'event', text: 'The resident retracted the reported entrance; the courier stopped the old entrance route and needs the corrected side.', at: game.updatedAt }); }
  }
  const answerSides = shortAnswer.match(/\b(south|north|east|west|left|right|bottom|back|top)\b/g) ?? [];
  const answeringSide = /\b(entrance|door|side)\b[^?]*\?/.test(lastCourier) || contextualEntranceStatement(game, text);
  const directionalAnswer = [...new Set(answerSides)];
  const deniedSide = /\b(?:not|isn't|is not|do not|don't)\b[^.!?;]{0,30}\b(?:south|north|east|west|left|right|bottom|back|top)\b/.test(shortAnswer) && !/^not\s+sorry\b/.test(shortAnswer);
  const homeTopic = /\b(entrance|door|home|house|flat|apartment)\b/.test(shortAnswer);
  if ((answeringSide || homeTopic) && directionalAnswer.length === 1 && !deniedSide && !hasNegatedNavigation(text) && !/\b(go|walk|head|turn|cross|look|around|continue)\b/.test(shortAnswer)) game.facts.homeSide = mapping[directionalAnswer[0]];
  for (const clause of normalized.split(/[.!?;]/)) {
    if (!/\b(entrance|door|home|house|flat|apartment)\b/.test(clause)) continue;
    const positions: { side: string; index: number }[] = [];
    for (const match of clause.matchAll(/\b(south|bottom|lower|back|north|top|upper|east|right|west|left)\b/g)) {
      const index = match.index!, before = clause.slice(Math.max(0, index - 20), index), after = clause.slice(index + match[0].length, index + match[0].length + 35);
      if (/\bnot\b[^,.!?]*$|isn't\s+(?:on\s+the\s+)?$/.test(before)) continue;
      const sideNoun = /^\s+(?:side|entrance|door|end|face)\b/.test(after);
      const entranceBefore = /\b(entrance|door)\b[^.!?;,]{0,45}\b(on|at|faces|facing|is)\b[^.!?;,]{0,15}$/.test(clause.slice(0, index)) || /\b(entrance|door)\s+(?:the\s+)?$/.test(clause.slice(0,index));
      if (sideNoun || entranceBefore) positions.push({ side: match[0], index });
    }
    if (positions.length === 1) game.facts.homeSide = mapping[positions[0].side];
  }
}
export function npcContext(game: Game, now = game.updatedAt) {
  const view = perception(game, now), opening = !game.facts.firstClueSpoken && !game.history.some(h => h.role === 'player');
  const visibleFacts = [...view.landmarks.map(l => ({ id: l.id, label: l.label, type: l.type as string, distance: l.distance, direction: l.direction })), ...view.buildings.map(b => ({ id: b.id, label: b.name, type: b.category, distance: b.distance, direction: b.direction }))].sort((a, b) => a.distance - b.distance);
  const road = ROADS.find(r => insidePolygon(game.courier, r.footprint));
  const lastCourier = game.history.filter(h => h.role === 'courier').at(-1)?.text ?? '';
  const actualQuestion = lastCourier.includes('?') ? lastCourier : null;
  const destination = game.routeTargetId ? { id: game.routeTargetId, label: game.routeTargetId.startsWith('home-') ? `reported ${game.routeTargetId.slice(5)} entrance` : game.knowledge[game.routeTargetId]?.name ?? game.landmarkKnowledge[game.routeTargetId]?.label ?? game.routeTargetId.replace(':',' ') } : null;
  const scopedBuilding = (b: typeof view.buildings[number] | Game['knowledge'][string]) => opening ? { category: b.category, direction: directionBetween(game.courier, b.entrance), distance: Math.round(distance(game.courier, b.entrance)), visible: view.buildings.some(v => v.id === b.id) } : { ...b, open: isOpen(b, now), visible: view.buildings.some(v => v.id === b.id) };
  return {
    premise: 'You are a human parcel courier helping an expat resident in Barcelona. The shops and hours are authored scenario facts. Respond in concise conversational Spanish.',
    phase: game.phase, demoMode: game.demoMode, demoStep: game.demoStep, remainingMs: remainingMs(game, now), parcel: game.parcel,
    position: { x: Math.round(game.courier.x), y: Math.round(game.courier.y), facing: game.courier.direction },
    orientation: { facing: game.courier.direction, viewAngleDegrees: VIEW_ANGLE_DEGREES, sightRange: SIGHT_RANGE, navigationFrame: 'courier', left: relativeDirection(game.courier.direction,'left'), right: relativeDirection(game.courier.direction,'right') },
    visibleLandmarks: opening ? [] : view.landmarks.map(({ approach: _approach, crossTo: _crossTo, ...landmark }) => landmark),
    newlyVisibleLandmarks: opening ? [] : view.landmarks.filter(l => game.newlyVisibleLandmarkIds.includes(l.id)).map(({ approach: _approach, crossTo: _crossTo, ...landmark }) => landmark),
    newlyVisibleBuildings: opening ? [] : view.buildings.filter(b => game.newlyVisibleBuildingIds.includes(b.id)).map(scopedBuilding),
    rememberedLandmarks: opening ? [] : Object.values(game.landmarkKnowledge).map(({ approach: _approach, crossTo: _crossTo, ...landmark }) => landmark),
    surroundings: { currentRoad: opening || !road ? null : { id: road.id, label: road.label, type: road.type }, nearestVisible: opening ? null : visibleFacts[0] ?? null, furthestVisible: opening ? null : visibleFacts.at(-1) ?? null },
    residentInside: true,
    observations: view.buildings.map(scopedBuilding), rememberedPlaces: opening ? [] : Object.values(game.knowledge).map(scopedBuilding),
    residentVisible: view.residentVisible, residentPosition: view.residentVisible ? { x: game.resident.x, y: game.resident.y } : null,
    homeEntranceVisible: view.homeEntranceVisible, homeEntrance: view.homeEntranceVisible ? HOME_ENTRANCE : null,
    walkableDirections: view.directions, factsLearned: { ...game.facts, lastClarification: actualQuestion },
    navigation: opening ? null : { destination, moving: game.courier.moving, remainingRouteUnits: Math.round(routeDistance(game.courier, game.route)), segmentDestination: game.route.at(-1) ?? null, segmentReachesDestination: game.routeComplete, awaitingGuidance: game.awaitingGuidance, arrived: !!destination && game.routeComplete && game.route.length === 0 && !!game.routeDestination && distance(game.courier, game.routeDestination) < 1 },
    history: game.history.map(entry => ({ ...entry })), time: barcelonaTime(now), weather: { ...game.weather },
    activeDestination: game.routeTargetId, lastClarification: actualQuestion,
    policy: opening
      ? 'FIRST CLUE: describe your position near a BAR using category only. Do not say a shop name, sign, colour, left-versus-right distinguishing detail or the hidden home entrance. Ask for directions. No names have been exposed to you.'
      : 'Describe current visible landmarks and their relative distances separately from remembered places. Navigation left/izquierda and right/derecha are relative to the courier current facing, as supplied in orientation. Forward/straight follows the current heading; compass directions remain absolute. A request for the next left/right turn follows the pending route only when its actual upcoming turn matches; do not immediately walk into a wall. Solid walls block sight; looking changes facing, walking changes position. Read a visible distinguishing sign when a clarifying question/selected reveal action calls for it. Follow the selected grounded decision; do not invent movement, handoff, unseen shops, or delivery success. A dropped parcel requires collection.',
    decision: game.decision ? { selected: game.decision.selected, action: { type: game.decision.action.type, label: game.decision.action.label, reason: game.decision.action.reason }, source: game.decision.source } : null,
  };
}

export function actionCandidates(game: Game, trigger: Decision['trigger'], now = game.updatedAt, playerText = ''): ActionCandidate[] {
  const view = perception(game, now);
  if (trigger === 'opening') return [{ id: 'describe', type: 'describe', label: 'Describe being near a bar', reason: 'First clue gives the landmark category and deliberately withholds the visible sign.' }];
  const candidates: ActionCandidate[] = [];
  if (trigger === 'timeout') {
    // Only places actually observed and remembered can become collection sites.
    for (const known of Object.values(game.knowledge)) {
      if (!known.acceptsParcels || !known.accessible || !isOpen(known, now) || (game.weather.isRain && !known.sheltered)) continue;
      const route = findRoute(game.courier, known.entrance);
      const length = routeDistance(game.courier, route ?? undefined);
      if (!route || length > COURIER_SPEED * 14) continue;
      candidates.push({ id: `drop:${known.id}`, type: 'drop', targetId: known.id, target: known.entrance, route, label: `Leave for collection at ${known.name}`, reason: `Previously observed ${known.category}; open now, accepts parcels, accessible, ${known.sheltered ? 'sheltered' : 'unsheltered'}, current-position walking route ${length.toFixed(1)} map units. The resident must collect it.` });
    }
    candidates.sort((a, b) => routeDistance(game.courier, a.route) - routeDistance(game.courier, b.route));
    candidates.forEach((candidate, index) => { candidate.reason = `Walking-distance rank ${index + 1} of ${candidates.length}; ${index === 0 ? 'CLOSEST eligible collection location from the courier current position. ' : ''}${candidate.reason}`; });
    candidates.push({ id: 'return', type: 'return', label: 'Keep parcel for return to depot', reason: 'Use if no observed open accessible parcel-accepting place is appropriate; never invent an unseen collection location.' });
    return candidates;
  }
  candidates.push({ id: 'describe-surroundings', type: 'describe', label: 'Describe what is visible now, including nearest and furthest landmarks', reason: 'Answer environment, fruit, what-can-you-see and furthest-visible questions without moving; distinguish visible facts from memory.' });
  if (isOrientationQuestion(playerText)) return [{ id: 'describe-surroundings', type: 'describe', label: `Describe currently facing ${game.courier.direction}`, reason: `Answer the courier's actual current heading (${game.courier.direction}) and scoped forward view. This is an orientation question, not a request to look, turn, walk or change the remembered entrance.` }];
  for (const facing of ['north', 'east', 'south', 'west'] as const) candidates.push({ id: `look:${facing}`, type: 'look', facing, label: `Look ${facing}`, reason: 'Turn to inspect the finite forward field of view; no walking or hidden map information.' });
  candidates.push({ id: 'look:around', type: 'look', label: 'Look around in all four directions', reason: 'Physically turn and observe each direction, then return to the original heading; no movement.' });
  candidates.push({ id: 'clarify', type: 'clarify', label: 'Ask for a clearer landmark or entrance side', reason: 'Best when the instruction is ambiguous, incomplete, impossible or refers to an unseen place.' });
  candidates.push({ id: 'wait', type: 'wait', label: 'Stop and wait', reason: 'Use for an explicit wait/stop request; do not claim a handoff or parcel receipt.' });
  if (game.routeTargetId === 'home-south' && game.routeComplete && canHandoff(game, now)) return candidates.filter(c => c.type !== 'look');
  if (game.route.length) candidates.push({ id: 'continue', type: 'continue', label: 'Continue the current visible movement leg', reason: 'Finish only the movement leg already in progress; do not queue another leg.' });
  else if (game.awaitingGuidance && game.routeDestination && !game.routeComplete) {
    const route = findRoute(game.courier, game.routeDestination);
    if (route) candidates.push({ id: 'continue', type: 'continue', target: { ...game.routeDestination }, targetId: game.routeTargetId ?? undefined, route, label: 'Advance one newly visible leg toward the remembered destination', reason: 'Only a new resident command permits another visible movement leg; the old route was discarded at the previous stop.' });
  }
  for (const observed of view.buildings) candidates.push({ id: `reveal:${observed.id}`, type: 'reveal', targetId: observed.id, label: `Read the visible ${observed.name} sign`, reason: `Reveal the distinguishing sign of this currently visible ${observed.category} after a relevant clarification question; no movement.` });
  for (const known of Object.values(game.knowledge)) {
    const route = findRoute(game.courier, known.entrance);
    if (route) candidates.push({ id: `go:${known.id}`, type: 'move', targetId: known.id, target: known.entrance, route, label: `Walk to ${known.name}`, reason: `Navigate to the ${known.category} actually observed${view.buildings.some(v => v.id === known.id) ? ' and currently visible' : ' earlier'}. May be a plausible interpretation of an ambiguous landmark; do not imply it is the home.` });
  }
  const knownLandmarks = Object.values(game.landmarkKnowledge).sort((a, b) => distance(game.courier, a.approach ?? a.point) - distance(game.courier, b.approach ?? b.point));
  // Nearby observed affordances form a bounded action set; the geometry remains internal.
  for (const landmark of knownLandmarks.filter(l => l.affordances.includes('walk')).slice(0, 10)) {
    const target = landmark.approach ?? landmark.point, route = findRoute(game.courier, target);
    if (!route || distance(game.courier, target) < 12) continue;
    candidates.push({ id: `landmark:${landmark.id}`, type: 'move', targetId: landmark.id, target, route, label: `Approach ${landmark.label}`, reason: `Previously observed ${landmark.type}: ${landmark.description}` });
    if (landmark.type === 'corner') candidates.push({ id: `around:${landmark.id}`, type: 'move', targetId: landmark.id, target, route, label: `Go around the building toward ${landmark.label}`, reason: 'Follow a collision-safe exterior route to an observed corner; do not invent an unseen entrance.' });
  }
  for (const landmark of knownLandmarks.filter(l => l.affordances.includes('cross') && l.crossTo?.length === 2).slice(0, 4)) {
    const ends = [...landmark.crossTo!].sort((a, b) => distance(game.courier, a) - distance(game.courier, b));
    const approach = findRoute(game.courier, ends[0]);
    if (!approach || !segmentClear(ends[0], ends[1])) continue;
    candidates.push({ id: `cross:${landmark.id}`, type: 'move', targetId: landmark.id, target: ends[1], route: [...approach, ends[1]], label: `Cross ${landmark.label}`, reason: `Cross the observed ${landmark.type} via its actual ${landmark.type === 'crossing' ? 'white pedestrian stripes' : 'junction'}; first approach the near side, then walk across to the opposite side.` });
  }
  const side = game.facts.homeSide;
  if (side || view.homeEntranceVisible) {
    // Player-provided side defines a hypothesis. Wrong sides route to a real wall,
    // never silently corrected using the private home solution.
    const entrances: Record<string, Point> = { south: HOME_ENTRANCE, north: { x: 480, y: 200 }, east: { x: 700, y: 470 }, west: { x: 260, y: 470 } };
    const heard = side ?? 'south', target = entrances[heard], route = findRoute(game.courier, target);
    if (route) candidates.push({ id: `home:${heard}`, type: 'move', targetId: heard === 'south' ? 'home-south' : `home-${heard}`, target, route, label: `Navigate around the apartment walls to the reported ${heard} entrance destination`, reason: view.homeEntranceVisible && heard === 'south' ? 'The home entrance is now physically visible.' : `Complete exterior route to the resident's reported ${heard} entrance, including all necessary turns around solid walls. Corners are intermediate waypoints, not this destination. This side is a conversational belief, not proof; verify on arrival.` });
  }
  for (const [direction, vector] of Object.entries({ north: { x: 0, y: -1 }, south: { x: 0, y: 1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 } })) {
    let target = { x: game.courier.x, y: game.courier.y };
    for (let step = 20; step <= SIGHT_RANGE + 20; step += 20) { const q = { x: game.courier.x + vector.x * step, y: game.courier.y + vector.y * step }; if (!segmentClear(game.courier, q)) break; target = q; }
    if (distance(game.courier, target) > 15) candidates.push({ id: `walk:${direction}`, type: 'move', target, route: [target], label: `Walk ${direction} along the clear street`, reason: `Grounded cardinal movement; currently facing ${game.courier.direction}. Courier-relative left is ${relativeDirection(game.courier.direction,'left')} and right is ${relativeDirection(game.courier.direction,'right')}. Forward follows the current heading. Stop before solid buildings.` });
  }
  if (game.awaitingGuidance && game.routeComplete && game.routeTargetId?.startsWith('walk:')) {
    const next = candidates.find(c => c.id === game.routeTargetId);
    if (next) candidates.push({ ...next, id: 'continue', type: 'continue', targetId: game.routeTargetId, label: 'Continue one newly visible straight movement leg', reason: 'A new resident confirmation authorizes another bounded leg in the same cardinal direction.' });
  }
  if (game.previousDestination && distance(game.courier, game.previousDestination) > 20) {
    const route = findRoute(game.courier, game.previousDestination);
    if (route) candidates.push({ id: 'go-back', type: 'move', target: game.previousDestination, route, label: 'Go back to the previous position', reason: 'Recover from a wrong turn using remembered movement, rather than restarting.' });
  }
  // Every active command authorizes just one fixed-view straight leg.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if ((candidate.type !== 'move' && candidate.type !== 'continue') || !candidate.route || !candidate.target) continue;
    const departure = candidate.route.find(p => distance(game.courier, p) > 0.01);
    if (!departure) continue;
    const facing = directionBetween(game.courier, departure), leg = visibleRouteLeg(game.courier, candidate.route, facing);
    if (!leg.length) { candidates.splice(i, 1); continue; }
    candidate.route = leg; candidate.facing = facing; candidate.routeComplete = distance(leg.at(-1)!, candidate.target) < 0.1; candidate.legEndsAtWaypoint = distance(leg.at(-1)!, departure) < 0.1;
    candidate.label = `Walk one visible leg toward ${candidate.targetId?.startsWith('home-') ? `the reported ${candidate.targetId.slice(5)} entrance` : candidate.label.replace(/^(Walk to|Approach|Go around the building toward|Cross|Go back to)\s*/,'')}`;
    candidate.reason = `Turn to face ${facing}, then walk only ${routeDistance(game.courier, leg).toFixed(1)} map units inside the current departure-position view and collision-clear first leg. ${candidate.routeComplete ? 'This leg reaches the requested destination.' : 'Stop at the visible leg boundary and await a NEW resident command. The semantic destination remains remembered; no queued turns or automatic route continuation.'}`;
  }
  // An explicitly requested entrance is one destination. Intermediate corners
  // cannot replace it merely because the sentence also says 'go around'.
  if (side && /\b(entrance|door)\b/i.test(navigationText(playerText)) && /\b(go|walk|head|come|reach|approach|bring|navigate|around)\b/i.test(navigationText(playerText))) {
    const destination = candidates.find(c => c.id === `home:${side}`);
    if (destination) return candidates.filter(c => c === destination || ['clarify','wait','continue'].includes(c.id));
  }
  const instruction = navigationText(playerText);
  const nextTurn=requestedNextTurn(playerText);
  if(nextTurn) return candidates.filter(c=>c.id==='clarify'||c.id==='wait'||(c.id==='continue'&&!/\b(?:not|don't|do not)\b|[?¿]/.test(instruction)&&pendingRouteTurns(game,nextTurn)));
  const horizontal = /\bleft\b/.test(instruction) && !/\bright\b/.test(instruction) ? relativeDirection(game.courier.direction,'left') : /\bright\b/.test(instruction) && !/\bleft\b/.test(instruction) ? relativeDirection(game.courier.direction,'right') : null;
  // Simple left/right commands use the courier's actual facing.
  const simpleHorizontal = horizontal && !/\b(north|south|east|west|up|down|top|bottom|entrance|door|home|house|flat|apartment|building|bar|fruit|shop|bakery|supermarket|corner|intersection|crossing|crate|what|which|see|called|name|sign)\b/.test(instruction);
  if (simpleHorizontal) {
    const actionId = /\b(look|face)\b/.test(instruction) ? `look:${horizontal}` : `walk:${horizontal}`;
    return candidates.filter(c => c.id === actionId || ['clarify','wait'].includes(c.id));
  }
  return candidates;
}

/** Explicit legal user commands do not require a fresh entrance interrogation. */
export function explicitNavigationAction(game: Game, candidates: ActionCandidate[], text: string): ActionCandidate | null {
  const normalized = navigationText(text), byId = (id: string) => candidates.find(c=>c.id===id) ?? null;
  if (isOrientationQuestion(text)) return byId('describe-surroundings');
  const nextTurn=requestedNextTurn(text);
  if(nextTurn) return !/\b(?:not|don't|do not)\b|[?¿]/.test(normalized) && pendingRouteTurns(game,nextTurn) ? byId('continue') : byId('clarify');
  const requestsPlace = Object.values(game.knowledge).some(b=>normalized.includes(navigationText(b.name))) || /\b(bar|fruit|shop|bakery|supermarket|greengrocer|mercat|forn)\b/.test(normalized);
  if (hasNegatedNavigation(text)) return null;
  const asksInformation = /\b(what|which|name|called|see|describe|where)\b/.test(normalized.replace(/\b(?:creo|pienso|think|believe)\s+what\b/g, ''));
  const verb = /\b(go|walk|head|come|reach|approach|navigate|around|move|turn)\b/.test(normalized);
  if (/\b(stop|wait|stay|hold on)\b/.test(normalized)) return byId('wait');
  const directions = [...normalized.matchAll(/\b(north|south|east|west|left|right|top|bottom|up|down)\b/g)].map(m=>({north:'north',south:'south',east:'east',west:'west',left:relativeDirection(game.courier.direction,'left'),right:relativeDirection(game.courier.direction,'right'),top:'north',bottom:'south',up:'north',down:'south'}[m[0]]!));
  const uniqueDirections = [...new Set(directions)];
  if (/\b(look|face)\b/.test(normalized)) return uniqueDirections.length===1 ? byId(`look:${uniqueDirections[0]}`) : /\baround\b/.test(normalized) ? byId('look:around') : null;
  if (/\bcontinue\b/.test(normalized) && uniqueDirections.length === 0 && !verb && !requestsPlace && !/[?¿]/.test(text) && !/\b(not|cross|look|face)\b/.test(normalized)) {
    if (byId('continue')) return byId('continue');
    if (game.routeTargetId === 'home-south' && game.routeComplete && canHandoff(game,game.updatedAt)) return byId('wait');
  }
  if (asksInformation) return null;
  const lastCourier = navigationText(game.history.filter(h=>h.role==='courier').at(-1)?.text ?? '');
  const sideAnswer = (/\b(entrance|door|side)\b[^?]*\?/.test(lastCourier) || contextualEntranceStatement(game,text)) && uniqueDirections.length===1 && !verb && !/\bnot\b/.test(normalized.replace(/^\s*not\s*,?\s*sorry\s*,?/,''));
  const entranceRequest = /\b(entrance|door|home|house|apartment|flat)\b/.test(normalized) && !/\bnot\b/.test(normalized);
  if (game.facts.homeSide && (sideAnswer || entranceRequest)) return byId(`home:${game.facts.homeSide}`);
  if (/\b(yes|okay|continue)\b/.test(normalized) && !verb && !requestsPlace && uniqueDirections.length===0) {
    if (byId('continue')) return byId('continue');
    const lastMove=[...game.decisions].reverse().find(d=>d.action.type==='move');
    return lastMove ? byId(lastMove.selected) : null;
  }
  if (verb || /\bcontinue\b/.test(normalized)) {
    const named=Object.values(game.knowledge).filter(b=>normalized.includes(navigationText(b.name)));
    if(named.length===1) return byId(`go:${named[0].id}`);
    const category= /\b(fruit|greengrocer)\b/.test(normalized)?'fruit shop':/\b(bakery|forn)\b/.test(normalized)?'bakery':/\b(supermarket|mercat)\b/.test(normalized)?'supermarket':null;
    if(category){const places=Object.values(game.knowledge).filter(b=>b.category===category);if(places.length===1)return byId(`go:${places[0].id}`);}
  }
  const simpleTerrain = !/\b(entrance|door|home|house|apartment|flat|building|bar|fruit|shop|bakery|supermarket|corner|intersection|crossing|crate|not)\b/.test(normalized);
  if (simpleTerrain && uniqueDirections.length===1) return byId(`walk:${uniqueDirections[0]}`);
  if (simpleTerrain && uniqueDirections.length===0 && /\b(forward|straight)\b/.test(normalized)) return byId('continue') ?? byId(`walk:${game.courier.direction}`);
  return null;
}

export function applyDecision(game: Game, decision: Decision, now = game.updatedAt) {
  tickGame(game, now, 0);
  if (decision.discarded || decision.sequence !== game.sequence || (decision.trigger === 'timeout' ? game.phase !== 'timeout' : game.phase !== 'active')) return false;
  // Rebuild the legal set after the async provider returns. No arbitrary targets.
  const lastPlayerQuote = game.history.filter(h => h.role === 'player').at(-1)?.text ?? '';
  const legal = actionCandidates(game, decision.trigger, now, decision.trigger === 'directions' && !game.demoMode ? lastPlayerQuote : '').find(option => option.id === decision.selected);
  if (!legal) return false;
  decision.action = legal; game.decision = decision; game.decisions.push(decision);
  if (legal.type === 'move' || legal.type === 'drop' || (legal.type === 'continue' && legal.route)) {
    const route = legal.route ?? (legal.target ? findRoute(game.courier, legal.target) : null);
    if (!route) return false;
    game.previousDestination = { x: game.courier.x, y: game.courier.y };
    game.route = route; game.routeTargetId = legal.targetId ?? legal.id; game.routeDestination = legal.target ? { ...legal.target } : null; game.routeComplete = legal.type === 'drop' || !!legal.routeComplete; game.legEndsAtWaypoint = !!legal.legEndsAtWaypoint; game.awaitingGuidance = false; game.courier.direction = legal.facing ?? game.courier.direction; game.courier.moving = true;
    rememberObservations(game, now);
    const departureView = perception(game, now);
    game.departureVisibleBuildingIds = departureView.buildings.map(b => b.id); game.departureVisibleLandmarkIds = departureView.landmarks.map(l => l.id);
    game.newlyVisibleBuildingIds = []; game.newlyVisibleLandmarkIds = [];
    if (legal.type === 'drop') game.timeoutPending = false;
    recordHistory(game, { role: 'event', text: `Courier started: ${legal.label}. ${legal.type === 'drop' ? 'The parcel remains with the courier until arrival.' : 'Arrival and handoff have not yet happened.'}`, at: now, turnId: decision.id });
    if (distance(game.courier, legal.target!) < 1) { game.route = []; finishRoute(game, now); }
  } else if (legal.type === 'look') {
    game.route = []; game.courier.moving = false;
    game.newlyVisibleBuildingIds = []; game.newlyVisibleLandmarkIds = [];
    const original = game.courier.direction;
    if (legal.id === 'look:around') scanSurroundings(game, now);
    game.courier.direction = legal.facing ?? original; rememberObservations(game, now);
    recordHistory(game, { role: 'event', text: `Courier ${legal.id === 'look:around' ? 'looked around and returned to the original heading' : `turned to face ${legal.facing}`}. The parcel remains with the courier.`, at: now, turnId: decision.id });
  } else if (legal.type === 'reveal') {
    game.facts.signDisclosed = true;
    recordHistory(game, { role: 'event', text: `The courier read the currently visible sign: ${game.knowledge[legal.targetId!]?.name}.`, at: now, turnId: decision.id });
  } else if (legal.type === 'clarify') {
    game.facts.lastClarification = 'Which landmark or which side of the building do you mean?';
  } else if (legal.type === 'wait') { game.route = []; game.courier.moving = false; }
  else if (legal.type === 'return') returnParcel(game, now, 'No appropriate observed collection alternative was selected. The parcel is returning to the depot; arrange another delivery.');
  return true;
}
export function publicGame(game: Game, now = Date.now()) {
  const view = perception(game, now);
  return {
    id: game.id, phase: game.phase, demoMode: game.demoMode, demoStep: game.demoStep, startedAt: game.startedAt, deadline: game.deadline, resolvedAt: game.resolvedAt,
    serverNow: now, remainingMs: remainingMs(game, now), courier: { ...game.courier }, resident: { ...game.resident },
    route: game.route.map(p => ({ ...p })), routeTargetId: game.routeTargetId, routeDestination: game.routeDestination ? { ...game.routeDestination } : null, routeComplete: game.routeComplete, awaitingGuidance: game.awaitingGuidance, parcel: game.parcel, facts: { ...game.facts },
    dropLocationId: game.dropLocationId, outcome: game.outcome, history: game.history.map(h => ({ ...h })),
    weather: { ...game.weather }, time: barcelonaTime(now), map: WORLD_MAP, canHandoff: canHandoff(game, now),
    homeEntranceVisible: view.homeEntranceVisible, newlyVisibleBuildings: view.buildings.filter(b => game.newlyVisibleBuildingIds.includes(b.id)).map(b => b.id), newlyVisibleLandmarks: view.landmarks.filter(l => game.newlyVisibleLandmarkIds.includes(l.id)).map(({ id, type, label, distance, direction }) => ({ id, type, label, distance, direction })),
    visibleBuildings: view.buildings.map(b => b.id), visibleLandmarks: view.landmarks.map(({ id, type, label, distance, direction }) => ({ id, type, label, distance, direction })), courierView: { facing: game.courier.direction, angle: VIEW_ANGLE_DEGREES, range: SIGHT_RANGE }, furthestVisible: [...view.landmarks.map(l => ({ id: l.id, label: l.label, distance: l.distance })), ...view.buildings.map(b => ({ id: b.id, label: b.name, distance: b.distance }))].sort((a, b) => b.distance - a.distance)[0] ?? null, arrivalSequence: game.arrivalSequence,
    inspector: game.decision ? { ...game.decision, candidates: game.decision.candidates.map(({ route: _route, ...c }) => c), action: { ...game.decision.action, route: undefined }, note: 'Model probabilities are scores, not calibrated guarantees. Fallback decisions have no invented probabilities.' } : null,
  };
}
