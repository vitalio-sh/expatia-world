import { actionCandidates, applyDecision, npcContext, recordHistory, tickGame } from './game.js';
import { distance, type Decision, type Game } from '../shared/world.js';

/** Explicit scripted lesson only. Normal mode continues to use live JEV. */
export function decideDemo(game: Game, text: string, now = Date.now()): Decision | null {
  tickGame(game, now, 0);
  const quote = text.trim().slice(0, 2_000);
  if (!game.demoMode || game.phase !== 'active' || !quote || game.courier.moving || game.route.length || game.demoStep >= 4) return null;
  recordHistory(game, { role: 'player', text: quote, at: now });
  if (game.demoStep === 1) game.facts.homeSide = 'south';
  const candidates = actionCandidates(game, 'directions', now);
  const wanted = game.demoStep === 0 ? candidates.filter(c => c.type === 'reveal' && game.knowledge[c.targetId!]?.category === 'bar').sort((a,b) => distance(game.courier, game.knowledge[a.targetId!].entrance)-distance(game.courier,game.knowledge[b.targetId!].entrance))[0]
    : candidates.find(c => c.id === (game.demoStep === 1 ? 'home:south' : 'continue'));
  if (!wanted) return null;
  const decision: Decision = { id: globalThis.crypto.randomUUID(), sequence: ++game.sequence, trigger: 'directions', source: 'demo', model: null, selected: wanted.id, action: wanted, candidates: [wanted], probabilities: null, confidence: null, evidence: ['The user selected the explicit four-command scripted demonstration.'], reason: 'scripted_demo', elapsedMs: 0, discarded: false };
  if (!applyDecision(game, decision, now)) { decision.discarded = true; return decision; }
  game.demoStep++;
  recordHistory(game, { role: 'event', text: `Scripted demonstration step ${game.demoStep} of four; no model prediction or probabilities were requested.`, at: now, turnId: decision.id });
  return decision;
}

type DemoContext = ReturnType<typeof npcContext>;
type ActionLike = { id?: string; type?: string } | { action?: { id?: string; type?: string } } | null;
export function scriptedDemoLine(context: DemoContext, _action?: ActionLike): string {
  const heading = {north:'el norte',east:'el este',south:'el sur',west:'el oeste'}[context.orientation.facing];
  if (context.phase === 'resolved') {
    if (context.parcel === 'resident') return 'Aquí tienes tu paquete. ¡Que tengas buen día!';
    if (context.parcel === 'drop') return 'He dejado el paquete en el lugar de recogida indicado. Tendrás que recogerlo allí.';
    return 'No hemos podido completar la entrega. El paquete vuelve al depósito.';
  }
  if (context.phase === 'timeout') return 'Se ha acabado el tiempo para entregar el paquete. Estoy comprobando un lugar de recogida.';
  if (context.demoStep === 0) return 'Hola, buenas. Tengo tu paquete y estoy junto a un bar; ¿por dónde voy?';
  if (context.navigation?.arrived && context.demoStep === 4) return 'Estoy en tu portal con el paquete. Ya puedes aceptarlo.';
  if (context.navigation?.awaitingGuidance) {
    if (context.homeEntranceVisible) return `Ahora miro hacia ${heading} y veo tu portal. Dime que vaya hasta él.`;
    const fresh = context.newlyVisibleLandmarks;
    const place = fresh.some(l=>l.type==='intersection') ? 'un cruce' : fresh.some(l=>l.type==='corner') ? 'la esquina del edificio' : fresh.some(l=>l.type==='crossing') ? 'un paso de peatones' : 'el siguiente tramo de la calle';
    return `Me he parado y ahora veo ${place}, mirando hacia ${heading}. Dime que siga.`;
  }
  if (context.demoStep === 1) {
    const bar = context.observations.find(b=>'name' in b && b.category==='bar') as {name?:string}|undefined;
    return `El cartel dice ${bar?.name ?? 'el nombre del bar'}. ¿En qué lado está tu portal?`;
  }
  if (context.navigation?.moving) return `Voy por este tramo hacia ${heading}. Me pararé antes de continuar.`;
  return `Estoy mirando hacia ${heading}. Espero tu siguiente indicación.`;
}
