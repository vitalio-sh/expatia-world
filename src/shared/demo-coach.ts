import { WORLD_MAP, directionBetween, type Direction, type HistoryEntry, type Point } from './world';

export interface DemoGame {
  id?: string; phase?: string; history?: HistoryEntry[];
  courier?: Point & { direction?: Direction; moving?: boolean };
  route?: Point[]; routeTargetId?: string | null; canHandoff?: boolean;
  routeDestination?: Point | null; routeComplete?: boolean; awaitingGuidance?: boolean;
  parcel?: string; outcome?: { kind: string } | null; arrivalSequence?: number;
  visibleBuildings?: string[];
  newlyVisibleLandmarks?: { id: string; type: string; label: string; direction?: Direction; distance?: number }[];
  newlyVisibleBuildings?: string[]; homeEntranceVisible?: boolean;
  visibleLandmarks?: { id: string; type: string; label: string; direction?: Direction; distance?: number }[];
  map?: typeof WORLD_MAP;
  facts?: { homeSide?: Direction | null; signDisclosed?: boolean };
  decision?: DemoDecision | null; inspector?: DemoDecision | null;
}
interface DemoDecision { sequence?: number; selected?: string; action?: { type?: string; label?: string; targetId?: string; facing?: Direction } }
export interface DemoCue { title: string; spanish: string; english: string; stage: 0 | 1 | 2 | 3 }
export interface DemoCueOptions { manual?: number | null; lifeline?: boolean; recovery?: string }

const es: Record<Direction, string> = { north: 'norte', south: 'sur', east: 'este', west: 'oeste' };
const clean = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const homeWords = /\b(portal|entrada|puerta|casa|domicilio|home|entrance|door|apartment)\b/;
const routeWords = /\b(ve|ven|baja|sube|gira|rodea|sigue|camina|anda|continua|norte|sur|este|oeste|go|come|walk|turn|around|north|south|east|west)\b/;
const unclearWords = /no (?:te |lo )?(?:entiendo|he entendido|escucho)|no entiendo|repite|repetir|que has dicho|puedes repetir|didn.t (?:understand|catch)|don.t understand|misunderstood|say (?:that )?again|which landmark|que punto de referencia|que referencia/;

/** This uses the complete conversation, rather than the last (possibly failed) action. */
function conversation(game: DemoGame) {
  const history = game.history ?? [];
  const decision = game.decision ?? game.inspector;
  const spoken = history.filter(entry => entry.role !== 'event');
  const players = history.filter(entry => entry.role === 'player');
  const lastCourier = [...spoken].reverse().find(entry => entry.role === 'courier');
  const lastPlayer = players.at(-1);
  // A later player utterance means an older courier question has already been answered.
  const courierQuestion = lastCourier && (!lastPlayer || history.indexOf(lastCourier) > history.indexOf(lastPlayer)) ? clean(lastCourier.text) : '';
  const all = clean(history.map(entry => entry.text).join('\n'));
  const map = game.map ?? WORLD_MAP;
  const disclosed = map.buildings.filter(building => history.some(entry => entry.role !== 'player' && clean(entry.text).includes(clean(building.name))));
  const identified = !!game.facts?.signDisclosed || disclosed.length > 0 || /read the currently visible sign|el cartel pone|el bar se llama/.test(all);
  const oriented = history.some(entry => entry.role === 'event' && /turned to face|looked around/.test(entry.text)) || players.some(entry => /\b(mira|mirar|ves|ver|look|see|fruteria|fruit|esquina|corner)\b/.test(clean(entry.text)) || routeWords.test(clean(entry.text))) || history.some(entry => entry.role === 'courier' && /\b(fruteria|cajas de fruta|esquina|cruce|paso de peatones|fruit shop|corner|crossing)\b/.test(clean(entry.text)));
  const homeDiscussed = players.some(entry => homeWords.test(clean(entry.text)) && routeWords.test(clean(entry.text))) || /courier started:.*(?:entrance|home)|courier arrived at.*entrance/.test(all);
  const homeTarget = /^(home[:-]|home$)/.test(game.routeTargetId ?? '') || /^home[:-]/.test(decision?.selected ?? '');
  const stage: DemoCue['stage'] = homeDiscussed || homeTarget ? (game.courier?.moving ? 3 : 2) : oriented ? 2 : identified ? 1 : 0;
  return { history, players, lastPlayer, courierQuestion, all, map, disclosed, identified, stage, homeTarget, decision };
}

function homeCue(game: DemoGame, title = 'Tell them your entrance side'): DemoCue {
  const map = game.map ?? WORLD_MAP;
  const side = directionBetween(map.residentPosition, map.home.entrance);
  // Give one useful fact, then one action. Never ask the presenter to narrate
  // every intermediate turn of a route the navigation engine already knows.
  if (game.facts?.homeSide === side) return nextStepCue(game);
  return { title, spanish: `Mi portal está en el lado ${es[side]}.`, english: `My entrance is on the ${side} side.`, stage: 2 };
}

function nextStepCue(game: DemoGame): DemoCue {
  const map = game.map ?? WORLD_MAP;
  if (game.homeEntranceVisible || (game.visibleLandmarks ?? []).some(item => item.id === 'home-door')) return { title: 'Guide the final visible step', spanish: 'Ven a mi portal.', english: 'Come to my entrance.', stage: 2 };
  const side = directionBetween(map.residentPosition, map.home.entrance);
  if (game.facts?.homeSide !== side) return { title: 'Tell them your entrance side', spanish: `Mi portal está en el lado ${es[side]}.`, english: `My entrance is on the ${side} side.`, stage: 2 };
  // Only continue a real unfinished entrance route. A finished cardinal walk,
  // shop trip or stale target must not send the courier farther along that route.
  const pendingHome = [`home-${side}`, `home:${side}`].includes(game.routeTargetId ?? '') && !!game.routeDestination && game.routeDestination.x === map.home.entrance.x && game.routeDestination.y === map.home.entrance.y && game.routeComplete === false;
  if (game.awaitingGuidance && pendingHome) return { title: 'Continue toward your entrance', spanish: 'Sigue.', english: 'Continue one short stretch toward my entrance, then stop.', stage: 2 };
  // The resident may tell the courier their entrance; this does not claim it is
  // visible. The navigation engine validates and bounds the resulting move.
  return { title: 'Guide them toward your entrance', spanish: `Ven a mi portal por el ${es[side]}.`, english: `Come toward my ${side} entrance, one short stretch.`, stage: 2 };
}

function sightCue(game: DemoGame, title = 'Choose a clear reference'): DemoCue {
  const map = game.map ?? WORLD_MAP;
  const visible = [...(game.visibleLandmarks ?? [])].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  const fruit = visible.find(item => item.type === 'fruit-display');
  const corner = visible.find(item => item.type === 'corner');
  const crossing = visible.find(item => item.type === 'crossing');
  const item = fruit ?? corner ?? crossing;
  if (item) {
    const names = { 'fruit-display': ['las cajas de fruta', 'the fruit crates'], corner: ['la esquina del edificio', 'the building corner'], crossing: ['el paso de peatones', 'the zebra crossing'] };
    const [spanish, english] = names[item.type as keyof typeof names];
    const side = item.direction;
    return { title, spanish: `¿Ves ${spanish}${side ? ` al ${es[side]}` : ''}?`, english: `Can you see ${english}${side ? ` to the ${side}` : ''}?`, stage: 1 };
  }
  const position = game.courier;
  const facing = position ? directionBetween(position, map.home.entrance) : 'south';
  return { title, spanish: `Mira hacia el ${es[facing]}.`, english: `Look ${facing}.`, stage: 1 };
}

function identifyCue(game: DemoGame, hasConversation: boolean): DemoCue {
  const context = conversation(game);
  if (context.identified || context.stage > 0) return { title: 'Check their current position', spanish: '¿Qué ves ahora mismo?', english: 'What can you see right now?', stage: 0 };
  const barVisible = (game.visibleBuildings ?? []).some(id => (game.map ?? WORLD_MAP).buildings.find(building => building.id === id)?.category === 'bar');
  if (!hasConversation || barVisible || /\bbar\b/.test(context.all)) return { title: 'Find the courier', spanish: '¿Cómo se llama el bar?', english: 'What is the bar called?', stage: 0 };
  return { title: 'Find the courier', spanish: '¿Qué ves cerca de ti?', english: 'What can you see nearby?', stage: 0 };
}

function walkingCue(_game: DemoGame): DemoCue {
  return { title: 'They are walking — no need to speak', spanish: 'Sí, sigue.', english: 'Yes, keep going. Let them finish this short move.', stage: 3 };
}

/** Spanish presenter suggestions only: choosing a cue never sends or moves anything. */
export function chooseDemoCue(game: DemoGame = {}, options: DemoCueOptions = {}): DemoCue {
  const context = conversation(game);
  if (game.outcome || game.parcel === 'resident') {
    if (game.outcome?.kind === 'collection' || game.parcel === 'drop') return { title: 'Collection is still needed', spanish: 'Gracias. Iré al punto de recogida a buscar el paquete.', english: 'Thank you. I’ll collect the parcel from the pickup point.', stage: 3 };
    if (game.outcome?.kind === 'returned' || game.parcel === 'returned') return { title: 'Arrange another delivery', spanish: 'Entendido. Tendré que organizar otra entrega.', english: 'Understood. I’ll need to arrange another delivery.', stage: 3 };
    return { title: 'Parcel received', spanish: 'Perfecto, gracias. ¡Hasta luego!', english: 'Perfect, thank you. See you!', stage: 3 };
  }
  if (game.canHandoff) return { title: 'At your door', spanish: 'Perfecto, ya puedes entregarme el paquete. Gracias.', english: 'The courier has reached your entrance. Click Collect your parcel to finish.', stage: 3 };
  if (!options.lifeline) {
    if (options.manual === 0) return identifyCue(game, context.players.length > 0);
    if (options.manual === 1) return sightCue(game);
    if (options.manual === 2) return homeCue(game);
  }
  const askingHome = /(?:que|cual|which|what).{0,28}(?:lado|side|entrada|entrance|puerta|door)|donde.{0,25}(?:casa|portal|entrada)|where.{0,25}(?:home|entrance|door)/.test(context.courierQuestion);
  const askingLook = /hacia donde miro|donde (?:miro|mirar)|que (?:punto de referencia|referencia) busco|where.{0,12}look|what.{0,24}look for/.test(context.courierQuestion);
  if (!options.lifeline && !game.awaitingGuidance && (game.courier?.moving || (game.route?.length ?? 0) > 0) && (!askingHome || game.facts?.homeSide)) return walkingCue(game);
  const recovery = options.lifeline || !!options.recovery || unclearWords.test(context.courierQuestion) || context.decision?.action?.type === 'clarify';
  if (recovery) {
    const cue = askingLook ? sightCue(game) : askingHome || context.stage >= 2 || context.identified ? homeCue(game) : sightCue(game);
    if (options.lifeline) return { ...cue, title: 'Ask for a slower reply', spanish: 'Más despacio, por favor.', english: 'More slowly, please.' };
    return { ...cue, title: 'Try this short phrase' };
  }
  const question = context.courierQuestion;
  if (game.awaitingGuidance || context.decision?.selected === 'visibility-stop') return nextStepCue(game);
  if (askingHome) return homeCue(game, 'Answer the entrance question');
  if (askingLook) return sightCue(game, 'Answer what to look for');
  if (!game.awaitingGuidance && (game.courier?.moving || (game.route?.length ?? 0) > 0)) return walkingCue(game);
  if (/obstruction|stopped at|blocked/.test(clean(context.history.at(-1)?.text ?? ''))) return homeCue(game, 'Recover from the blocked route');
  if (context.stage >= 2) return homeCue(game);
  if (context.identified && /es (?:el|la|ese|esa)|el que dices|te refieres|is (?:that|this)|do you mean/.test(question)) {
    const cue = homeCue(game, 'Confirm and give the next direction');
    return cue;
  }
  if (context.identified && /(?:por donde|hacia donde|que camino|which way|where.{0,12}(?:go|next)|por donde sigo)/.test(question)) return homeCue(game, 'Answer the next-direction question');
  if (context.identified) return sightCue(game, 'Build on the landmark they gave');
  return identifyCue(game, context.players.length > 0);
}

/** Polling changes positions constantly; only real conversation/arrival changes reset manual controls. */
export function demoConversationRevision(game: DemoGame = {}): string {
  const decision = game.decision ?? game.inspector;
  const last = game.history?.at(-1);
  return JSON.stringify([game.id, decision?.sequence, decision?.selected, game.history?.length ?? 0, last?.at, last?.text, game.arrivalSequence, game.canHandoff, game.outcome?.kind]);
}
