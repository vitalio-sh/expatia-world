import { WORLD_MAP, directionBetween, type Direction, type HistoryEntry, type Point } from './world';

export interface DemoGame {
  id?: string; phase?: string; history?: HistoryEntry[];
  courier?: Point & { direction?: Direction; moving?: boolean };
  route?: Point[]; routeTargetId?: string | null; canHandoff?: boolean;
  parcel?: string; outcome?: { kind: string } | null; arrivalSequence?: number;
  visibleBuildings?: string[];
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

function homeCue(game: DemoGame, title = 'Guide them to your entrance'): DemoCue {
  const map = game.map ?? WORLD_MAP;
  const entrance = map.home.entrance;
  const center = map.residentPosition;
  const side = directionBetween(center, entrance);
  const position = game.courier;
  const west = !!position && position.x < center.x;
  const east = !!position && position.x > center.x;
  // The player's own entrance is known. This gives directions, never claims the
  // courier already sees the doorway or can pass through the solid courtyard.
  let spanish = `Mi portal está en el lado ${es[side]} del bloque. `;
  let english = `My entrance is on the ${side} side of the block. `;
  if (position && position.y < entrance.y - 55) {
    if (west || east) {
      const street = west ? 'west' : 'east';
      spanish += `Baja por la calle del ${es[street]} y rodea la esquina hasta el portal.`;
      english += `Go south along the ${street} street, around the corner, and come to the entrance.`;
    } else {
      spanish += 'Rodea el edificio por fuera y ven a ese portal.';
      english += 'Go around the outside of the building and come to that entrance.';
    }
  } else if (position && Math.abs(position.x - entrance.x) > 35) {
    const direction = position.x < entrance.x ? 'east' : 'west';
    spanish += `Ve hacia el ${es[direction]} por la fachada sur hasta la entrada.`;
    english += `Go ${direction} along the south frontage to the entrance.`;
  } else {
    spanish += 'Ven a la entrada por la calle; estoy en casa.';
    english += 'Come to the entrance from the street; I’m at home.';
  }
  return { title, spanish, english, stage: 2 };
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
    return { title, spanish: `¿Ves ${spanish}${side ? ` al ${es[side]}` : ''}? Dime si estás junto a ese punto.`, english: `Can you see ${english}${side ? ` to the ${side}` : ''}? Tell me whether you’re beside it.`, stage: 1 };
  }
  const position = game.courier;
  const facing = position ? directionBetween(position, map.home.entrance) : 'south';
  return { title, spanish: `Mira hacia el ${es[facing]} y dime qué ves.`, english: `Look ${facing} and tell me what you can see.`, stage: 1 };
}

function identifyCue(game: DemoGame, hasConversation: boolean): DemoCue {
  const context = conversation(game);
  if (context.identified || context.stage > 0) return { title: 'Check their current position', spanish: '¿Qué ves ahora mismo? ¿En qué lado del edificio estás?', english: 'What can you see right now? Which side of the building are you on?', stage: 0 };
  const barVisible = (game.visibleBuildings ?? []).some(id => (game.map ?? WORLD_MAP).buildings.find(building => building.id === id)?.category === 'bar');
  if (!hasConversation || barVisible || /\bbar\b/.test(context.all)) return { title: 'Find the courier', spanish: `${hasConversation ? '' : 'Hola, buenas. '}¿Puedes leer el nombre del bar?`, english: `${hasConversation ? '' : 'Hello! '}Can you read the bar’s name?`, stage: 0 };
  return { title: 'Find the courier', spanish: '¿Dónde estás ahora? Dime un punto de referencia que puedas ver.', english: 'Where are you now? Tell me one landmark you can see.', stage: 0 };
}

function walkingCue(game: DemoGame): DemoCue {
  const context = conversation(game);
  const position = game.courier;
  const next = game.route?.find(point => !position || Math.hypot(point.x - position.x, point.y - position.y) > 12);
  const heading = position && next ? directionBetween(position, next) : position?.direction;
  const target = game.routeTargetId ?? context.decision?.action?.targetId;
  const knownPlace = context.disclosed.find(place => place.id === target);
  const suffix = context.homeTarget ? 'hasta mi portal, en el lado sur del edificio' : knownPlace ? `hasta ${knownPlace.name}` : 'hasta el punto que acordamos';
  const translation = context.homeTarget ? 'to my entrance on the south side of the building' : knownPlace ? `to ${knownPlace.name}` : 'to the point we agreed on';
  return { title: 'Keep the route going', spanish: `Sí, sigue${heading ? ` hacia el ${es[heading]}` : ' por esa ruta'} ${suffix}. Avísame cuando llegues.`, english: `Yes, keep going${heading ? ` ${heading}` : ' along that route'} ${translation}. Tell me when you arrive.`, stage: 3 };
}

/** Spanish presenter suggestions only: choosing a cue never sends or moves anything. */
export function chooseDemoCue(game: DemoGame = {}, options: DemoCueOptions = {}): DemoCue {
  const context = conversation(game);
  if (game.outcome || game.parcel === 'resident') {
    if (game.outcome?.kind === 'collection' || game.parcel === 'drop') return { title: 'Collection is still needed', spanish: 'Gracias. Iré al punto de recogida a buscar el paquete.', english: 'Thank you. I’ll collect the parcel from the pickup point.', stage: 3 };
    if (game.outcome?.kind === 'returned' || game.parcel === 'returned') return { title: 'Arrange another delivery', spanish: 'Entendido. Tendré que organizar otra entrega.', english: 'Understood. I’ll need to arrange another delivery.', stage: 3 };
    return { title: 'Parcel received', spanish: 'Perfecto, gracias. ¡Hasta luego!', english: 'Perfect, thank you. See you!', stage: 3 };
  }
  if (game.canHandoff) return { title: 'At your door', spanish: 'Perfecto, ya puedes entregarme el paquete. Gracias.', english: 'The courier has reached your entrance. Click Receive parcel to finish.', stage: 3 };
  if (!options.lifeline) {
    if (options.manual === 0) return identifyCue(game, context.players.length > 0);
    if (options.manual === 1) return sightCue(game);
    if (options.manual === 2) return homeCue(game);
  }
  const askingHome = /(?:que|cual|which|what).{0,28}(?:lado|side|entrada|entrance|puerta|door)|donde.{0,25}(?:casa|portal|entrada)|where.{0,25}(?:home|entrance|door)/.test(context.courierQuestion);
  const askingLook = /hacia donde miro|donde (?:miro|mirar)|que (?:punto de referencia|referencia) busco|where.{0,12}look|what.{0,24}look for/.test(context.courierQuestion);
  const recovery = options.lifeline || !!options.recovery || unclearWords.test(context.courierQuestion) || context.decision?.action?.type === 'clarify';
  if (recovery) {
    const cue = askingLook ? sightCue(game) : askingHome || context.stage >= 2 || context.identified ? homeCue(game) : sightCue(game);
    if (options.lifeline) return { ...cue, title: 'Ask for a slower reply', spanish: `¿Puedes hablar más despacio? ${cue.spanish}`, english: `Can you speak more slowly? ${cue.english}` };
    return { ...cue, title: options.lifeline ? 'Say it slowly, with context' : 'Try one clear instruction', spanish: `Perdona, lo repito despacio: ${cue.spanish}`, english: `Repeat slowly: ${cue.english}` };
  }
  const question = context.courierQuestion;
  if (askingHome) return homeCue(game, 'Answer the entrance question');
  if (askingLook) return sightCue(game, 'Answer what to look for');
  if (game.courier?.moving || (game.route?.length ?? 0) > 0) return walkingCue(game);
  if (/obstruction|stopped at|blocked/.test(clean(context.history.at(-1)?.text ?? ''))) return homeCue(game, 'Recover from the blocked route');
  if (context.stage >= 2) return homeCue(game);
  if (context.identified && /es (?:el|la|ese|esa)|el que dices|te refieres|is (?:that|this)|do you mean/.test(question)) {
    const cue = homeCue(game, 'Confirm and give the next direction');
    return { ...cue, spanish: `Gracias, esa referencia me ayuda. ${cue.spanish}`, english: `Thank you, that landmark helps. ${cue.english}` };
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
