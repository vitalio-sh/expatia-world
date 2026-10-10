import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDemoCue, demoConversationRevision, type DemoGame } from '../src/shared/demo-coach';
import { WORLD_MAP, type HistoryEntry } from '../src/shared/world';

const line = (role: HistoryEntry['role'], text: string, at = 1): HistoryEntry => ({ role, text, at });
const opening = line('courier', 'Hola, tengo tu paquete y estoy cerca de un bar. ¿Por dónde voy?');
const identified = [opening, line('player', '¿Cómo se llama el bar?', 2), line('event', 'The courier read the currently visible sign: Bar Llevant.', 3), line('courier', 'El cartel pone Bar Llevant. ¿Por dónde sigo?', 4)];
const base: DemoGame = { id: 'round', phase: 'active', courier: { x: 210, y: 250, direction: 'north', moving: false }, map: WORLD_MAP, route: [], visibleBuildings: ['bar-llevant'], visibleLandmarks: [], history: [opening] };
const failed = { sequence: 5, selected: 'clarify', action: { type: 'clarify' } };

test('short opening cue and repeated clarifications preserve everything already learned', () => {
  assert.equal(chooseDemoCue(base).spanish, '¿Cómo se llama el bar?');
  const history = [...identified, line('player', 'No me has entendido', 5), line('courier', '¿Puedes repetir?', 6)];
  for (let i = 0; i < 4; i++) {
    const cue = chooseDemoCue({ ...base, history, inspector: { ...failed, sequence: 5 + i } });
    assert.doesNotMatch(cue.spanish, /Hola|nombre del bar|se llama el bar/);
    assert.match(cue.spanish, /portal.*sur/);
    assert.ok(cue.stage >= 2);
    history.push(line('player', 'Perdona, lo repito', 7 + i * 2), line('courier', 'No entiendo, ¿qué referencia dices?', 8 + i * 2));
  }
});

test('an entrance question is answered even on a clarify decision and before sign disclosure', () => {
  const cue = chooseDemoCue({ ...base, inspector: failed, history: [opening, line('courier', '¿En qué lado está tu portal?', 2)] });
  assert.match(cue.spanish, /portal.*lado sur/);
  assert.doesNotMatch(cue.spanish, /nombre del bar/);
  assert.match(cue.english, /south side/);
});

test('the courier’s next-direction question advances from the named bar to the entrance', () => {
  const cue = chooseDemoCue({ ...base, history: identified, inspector: { selected: 'reveal:bar-llevant', action: { type: 'reveal' } } });
  assert.match(cue.spanish, /portal.*sur/);
  assert.doesNotMatch(cue.spanish, /calle|rodea|Baja/);
  assert.equal(cue.stage, 2);
});

test('a long conversation retains prior progress when the latest action is wait or a provider fallback', () => {
  const history = [...identified, line('player', 'Mira al sur, ¿ves la frutería?', 5), line('courier', 'Veo las cajas de fruta.', 6), line('player', 'Un momento', 7), line('courier', 'Vale, espero aquí.', 8)];
  const cue = chooseDemoCue({ ...base, history, inspector: { selected: 'wait', action: { type: 'wait' } } });
  assert.equal(cue.stage, 2);
  assert.match(cue.spanish, /portal.*sur/);
  assert.doesNotMatch(cue.spanish, /Hola|nombre del bar/);
});

test('movement continues toward the actual route target without pretending to be at the door', () => {
  const game: DemoGame = { ...base, history: [...identified, line('player', 'Ven a mi portal en el lado sur', 5)], courier: { x: 230, y: 390, direction: 'south', moving: true }, route: [{ x: 230, y: 580 }, { x: 480, y: 645 }], routeTargetId: 'home:south', inspector: { selected: 'continue', action: { type: 'continue' } } };
  const cue = chooseDemoCue(game);
  assert.equal(cue.stage, 3);
  assert.equal(cue.spanish, 'Sí, sigue.');
  assert.doesNotMatch(cue.spanish, /te espero en la entrada|ya puedes entregarme|Hola/);
  const detour = chooseDemoCue({ ...game, routeTargetId: 'bar-llevant' });
  assert.equal(detour.spanish, 'Sí, sigue.');
  assert.doesNotMatch(detour.spanish, /hasta mi portal/);
});

test('orientation suggestions distinguish current sight from a previously remembered fruit shop', () => {
  const memoryOnly = { ...base, history: [...identified, line('courier', 'Recuerdo Fruita Fresca, pero ahora no la veo.', 5)] };
  const cue = chooseDemoCue(memoryOnly, { manual: 1 });
  assert.match(cue.spanish, /Mira hacia/);
  assert.doesNotMatch(cue.spanish, /fruta|Fruita|frutería/);
  const visible = chooseDemoCue({ ...memoryOnly, visibleLandmarks: [{ id: 'fruit-display', type: 'fruit-display', label: 'fruit crates', direction: 'south', distance: 90 }] }, { manual: 1 });
  assert.match(visible.spanish, /¿Ves las cajas de fruta al sur/);
});

test('a speech error without a new server history turn gives contextual recovery', () => {
  const game = { ...base, history: identified };
  const cue = chooseDemoCue(game, { recovery: 'No speech heard. Try again.' });
  assert.ok(cue.spanish.split(/\s+/).length <= 10);
  assert.match(cue.spanish, /portal.*sur/);
  assert.doesNotMatch(cue.spanish, /Hola|nombre del bar/);
  const slow = chooseDemoCue(game, { lifeline: true });
  assert.equal(slow.spanish, 'Más despacio, por favor.');
  assert.equal(slow.title, 'Ask for a slower reply');
  assert.ok(slow.spanish.split(/\s+/).length <= 6);
  assert.doesNotMatch(slow.spanish, /lo repito despacio/);
});

test('manual steps remain available but checking location never repeats an already identified bar', () => {
  const game = { ...base, history: identified };
  assert.match(chooseDemoCue(game, { manual: 0 }).spanish, /Qué ves ahora mismo/);
  assert.doesNotMatch(chooseDemoCue(game, { manual: 0 }).spanish, /Hola|nombre del bar/);
  assert.equal(chooseDemoCue(game, { manual: 1 }).stage, 1);
  assert.match(chooseDemoCue(game, { manual: 2 }).spanish, /portal.*sur/);
  assert.match(chooseDemoCue({ ...game, inspector: failed }, { manual: 0 }).spanish, /Qué ves ahora mismo/);
  assert.equal(chooseDemoCue({ ...game, inspector: failed }, { manual: 1 }).stage, 1);
});

test('actual home-south route ID retains entrance destination through a continue decision', () => {
  const cue = chooseDemoCue({ ...base, courier: { x: 230, y: 390, moving: true }, routeTargetId: 'home-south', route: [{ x: 230, y: 600 }], inspector: { selected: 'continue', action: { type: 'continue' } } });
  assert.equal(cue.spanish, 'Sí, sigue.');
  assert.equal(cue.stage, 3);
});

test('a question about where to look gets an orientation cue instead of a walking instruction', () => {
  const cue = chooseDemoCue({ ...base, history: [...identified, line('courier', 'Recuerdo Fruita Fresca, pero ahora no la veo. ¿Hacia dónde miro?', 5)], inspector: failed });
  assert.match(cue.spanish, /Mira hacia el sur/);
  assert.doesNotMatch(cue.spanish, /Baja|fruta|Fruita|Hola/);
});

test('a named-sign confirmation gets acknowledgement and an actionable next step', () => {
  const cue = chooseDemoCue({ ...base, history: [...identified.slice(0, -1), line('courier', 'El cartel pone Bar Llevant. ¿Es el que dices?', 4)] });
  assert.ok(cue.spanish.split(/\s+/).length <= 10);
  assert.match(cue.spanish, /portal.*sur/);
});

test('the presenter gives one entrance fact then one action, from either side', () => {
  for (const courier of [{x:730,y:400},{x:730,y:650},{x:230,y:650}]) {
    const game = { ...base, courier, history: identified };
    assert.equal(chooseDemoCue(game).spanish, 'Mi portal está en el lado sur.');
    assert.match(chooseDemoCue({...game, facts:{homeSide:'south'}}).spanish, /^(?:Mira|Camina)/);
  }
});

test('physical handoff and all three outcomes get truthful cues', () => {
  const door = chooseDemoCue({ ...base, canHandoff: true });
  assert.match(door.english, /Click Collect your parcel/);
  assert.match(chooseDemoCue({ ...base, outcome: { kind: 'received' } }).title, /received/);
  assert.match(chooseDemoCue({ ...base, outcome: { kind: 'collection' } }).english, /collect.*pickup/);
  assert.match(chooseDemoCue({ ...base, outcome: { kind: 'returned' } }).english, /another delivery/);
});

test('manual revision follows dialogue and arrival, not movement polling', () => {
  const first = demoConversationRevision(base);
  assert.equal(demoConversationRevision({ ...base, courier: { x: 210, y: 350, moving: true } }), first);
  assert.notEqual(demoConversationRevision({ ...base, history: identified }), first);
  assert.notEqual(demoConversationRevision({ ...base, canHandoff: true, arrivalSequence: 1 }), first);
});

test('all core demo prompts stay short even during repeated recovery', () => {
  const games: DemoGame[] = [base, {...base,history:identified}, {...base,history:identified,inspector:failed}, {...base,history:identified,facts:{homeSide:'south'}}, {...base,courier:{x:230,y:390,moving:true},route:[{x:230,y:600}],routeTargetId:'home-south'}];
  for (const game of games) for (const options of [{},{recovery:'Try again'},{manual:0},{manual:1},{manual:2},{lifeline:true}]) {
    const cue=chooseDemoCue(game,options);
    assert.ok(cue.spanish.split(/\s+/).length<=11, cue.spanish);
    assert.doesNotMatch(cue.spanish,/rodea.*portal|baja.*esquina|lo repito despacio/i);
  }
});

test('visible-edge stop suggests one short direction and keeps the learned entrance side', () => {
  const game: DemoGame = { ...base, history: [...identified, line('player', 'Mi portal está al sur.', 5)], facts: { homeSide: 'south' }, awaitingGuidance: true, routeComplete: false, courier: { x: 230, y: 500, direction: 'south', moving: false }, inspector: { selected: 'visibility-stop', action: { type: 'describe' } } };
  const cue = chooseDemoCue(game);
  assert.equal(cue.spanish, 'Sí, sigue.');
  assert.doesNotMatch(cue.spanish, /portal|rodea|entrada|Hola/);
  const look = chooseDemoCue({ ...game, courier: { ...game.courier!, direction: 'north' } });
  assert.equal(look.spanish, 'Sí, sigue.');
  assert.equal(game.facts?.homeSide, 'south');
});

test('demo only suggests the final portal step when the actual doorway is visible', () => {
  const game: DemoGame = { ...base, history: identified, facts: { homeSide: 'south' }, awaitingGuidance: false, courier: { x: 230, y: 645, direction: 'east', moving: false } };
  assert.equal(chooseDemoCue(game).spanish, 'Camina un poco hacia el este.');
  assert.equal(chooseDemoCue({ ...game, visibleLandmarks: [{ id: 'home-door', label: 'south apartment entrance', type: 'entrance' }] }).spanish, 'Ven a mi portal.');
  assert.equal(chooseDemoCue({ ...game, awaitingGuidance: true, visibleLandmarks: [{ id: 'home-door', label: 'south apartment entrance', type: 'entrance' }] }).spanish, 'Sí, sigue.');
});
