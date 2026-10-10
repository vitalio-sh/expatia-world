import test from 'node:test';
import assert from 'node:assert/strict';
import { actionCandidates, answerCall, createGame, learnPlayerFacts, npcContext, recordHistory, recordSpeech } from '../src/server/game';
import { cleanSpeech, courierGrounding, dialogueMessages, generateDialogue, fallbackLine, spanishLandmarkLabel, speechIsGrounded } from '../src/server/dialogue';
import { deliveryCoachFlavor, deliveryOutcomeFlavor, deliveryPhrasebook } from '../src/shared/phrasebook';

test('opening speech guard withholds sign, invented visual details and the hidden entrance', () => {
  const game = createGame(); answerCall(game);
  const context = npcContext(game), action = actionCandidates(game, 'opening')[0];
  assert.equal(speechIsGrounded('I have your parcel and I am near a bar. Which way should I go?', context, action), true);
  assert.equal(speechIsGrounded('I am beside Bar Llevant.', context, action), false);
  assert.equal(speechIsGrounded('The bar has a red awning.', context, action), false);
  assert.equal(speechIsGrounded('People are having vermouth in the sunshine.', context, action), false);
  assert.equal(speechIsGrounded('Your entrance is on the south side.', context, action), false);
});

test('a selected visible sign is allowed while invented bars and completed movements are blocked', () => {
  const game = createGame(); answerCall(game); recordSpeech(game, 'I am near a bar. Which way should I go?');
  const context = npcContext(game), action = actionCandidates(game, 'directions').find(candidate => candidate.type === 'reveal')!;
  assert.ok(action);
  const sign = action.label.match(/visible (.+?) sign/)![1];
  assert.equal(speechIsGrounded(`The sign reads ${sign}. Which way from here?`, context, action), true);
  assert.equal(speechIsGrounded('The sign reads Bar Invented.', context, action), false);
  assert.equal(speechIsGrounded('I am walking north now.', context, action), false);
});

test('speech cannot claim receipt or completed collection before physical world outcome', () => {
  const context = { parcel: 'courier', factsLearned: { firstClueSpoken: true }, weather: { description: 'Overcast', isRain: false } };
  const drop = { type: 'drop', label: 'Leave for collection at Bar Llevant', reason: 'Observed eligible shop' };
  assert.equal(speechIsGrounded('I have left the parcel at the collection point.', context, drop), false);
  assert.equal(speechIsGrounded('Your parcel is safely with you.', context, drop), false);
  assert.equal(speechIsGrounded('I am taking it to the collection point. You will still need to collect it.', context, drop), true);
  assert.equal(speechIsGrounded('Your parcel is safely with you.', { ...context, parcel: 'resident' }, drop), true);
  assert.equal(speechIsGrounded('I have left the parcel at the collection point.', { ...context, parcel: 'drop' }, drop), true);
});

test('dialogue receives the selected action projection without route candidates or judge probabilities', () => {
  const messages = dialogueMessages({ history: [{ role: 'player', text: 'Which bar?' }] }, {
    selected: 'reveal', trigger: 'directions', action: { type: 'reveal', label: 'Read the visible Bar Llevant sign', reason: 'Sign is visible', target: { x: 123, y: 456 } },
    candidates: [{ label: 'Unselected route' }], probabilities: { reveal: .9, route: .1 },
  });
  const projection = JSON.parse(messages.at(-1)!.content).selectedDecision;
  assert.equal(projection.action.type, 'reveal');
  assert.equal(projection.action.target, undefined);
  assert.equal(projection.candidates, undefined);
  assert.equal(projection.probabilities, undefined);
  assert.equal(dialogueMessages({}, { type: 'wait', label: 'Wait for handoff', reason: 'Arrived' }).at(-1)!.content.includes('Wait for handoff'), true);
});

const richerContext = {
  phase: 'active', parcel: 'courier', remainingMs: 40_000, factsLearned: { firstClueSpoken: true },
  observations: [{ id: 'fruit', name: 'Fruita Fresca', category: 'fruit shop', distance: 213, direction: 'south', visible: true }],
  rememberedPlaces: [
    { id: 'fruit', name: 'Fruita Fresca', category: 'fruit shop', observedAt: 10 },
    { id: 'other-bar', name: 'Bar Ponent', category: 'bar', distance: 99, direction: 'east', observedAt: 5, visible: false },
  ],
  visibleLandmarks: [
    { id: 'corner', type: 'corner', label: 'West building corner', description: 'The apartment wall turns at this building corner', distance: 85, direction: 'west' },
    { id: 'junction', type: 'intersection', label: 'East street junction', description: 'Two streets meet here', distance: 180, direction: 'east' },
    { id: 'crossing', type: 'crossing', label: 'North crossing', description: 'A zebra crossing across the road', distance: 290, direction: 'north' },
  ],
  rememberedLandmarks: [{ id: 'old-tree', type: 'tree', label: 'South tree', observedAt: 4, distance: 20, direction: 'south' }],
  surroundings: { currentRoad: { id: 'road', label: 'the north street', type: 'road' } },
  history: [{ role: 'player', text: 'Can you see the produce shop?' }],
};
const describe = { type: 'describe', label: 'Describe currently visible surroundings', reason: 'Answer the player’s view question without moving' };

test('fruit, corners and crossings use visible semantic facts instead of denying known objects', () => {
  assert.equal(speechIsGrounded('I cannot see any fruit shop.', richerContext, describe), false);
  assert.equal(speechIsGrounded("I don't know any greengrocer here.", richerContext, describe), false);
  assert.equal(speechIsGrounded('There are no corners nearby.', richerContext, describe), false);
  assert.equal(speechIsGrounded("I can't see a crosswalk.", richerContext, describe), false);
  assert.equal(speechIsGrounded('I can see Fruita Fresca to the south.', richerContext, describe), true);
  assert.match(fallbackLine(richerContext, describe), /Fruita Fresca al sur/);
  assert.match(fallbackLine({ ...richerContext, history: [{ role: 'player', text: 'Which corner do you see?' }] }, describe), /esquina oeste/);
  assert.match(fallbackLine({ ...richerContext, history: [{ role: 'player', text: 'What street are you on?' }] }, describe), /calle norte/);
});

test('building corners, street junctions and crossings remain distinct; look and arrival reflect selected actions', () => {
  const junctionOnly = { ...richerContext, visibleLandmarks: [richerContext.visibleLandmarks[1]], rememberedLandmarks: [] };
  assert.equal(speechIsGrounded('I cannot see a building corner.', junctionOnly, describe), true);
  assert.equal(speechIsGrounded('I cannot see a street junction.', junctionOnly, describe), false);
  const looking = { ...richerContext, history: [{ role: 'player', text: 'Turn to look at the fruit shop.' }] };
  const line = fallbackLine(looking, { type: 'look', facing: 'west', label: 'Look west' });
  assert.match(line, /Fruita Fresca/); assert.doesNotMatch(line, /walking|heading/);
  assert.match(fallbackLine(richerContext, { id: 'arrival', type: 'wait', label: 'Wait at the home entrance' }), /Estoy abajo.*entrada.*recogerlo/);
  assert.doesNotMatch(fallbackLine(richerContext, { id: 'wait', type: 'wait', label: 'Stop and wait' }), /entrada|recogerlo/);
});

test('memory-only facts remain known without being described as currently visible or given live distances', () => {
  const facts = courierGrounding(richerContext);
  assert.equal(facts.remembered.some(item => item.id === 'fruit'), false);
  assert.equal(facts.remembered.find(item => item.id === 'other-bar')?.distance, undefined);
  assert.equal(facts.remembered.find(item => item.id === 'old-tree')?.direction, undefined);
  assert.equal(speechIsGrounded('I can see Bar Ponent.', richerContext, describe), false);
  assert.equal(speechIsGrounded('Bar Ponent is visible.', richerContext, describe), false);
  assert.equal(speechIsGrounded('I remember Bar Ponent from earlier.', richerContext, describe), true);
  const outOfView = { ...richerContext, observations: [], rememberedPlaces: [richerContext.rememberedPlaces[0]] };
  assert.equal(speechIsGrounded('I cannot see the fruit shop now.', outOfView, describe), true);
  assert.equal(speechIsGrounded('I can see the produce shop.', outOfView, describe), false);
  assert.equal(speechIsGrounded('I do not know any fruit shop.', outOfView, describe), false);
  assert.match(fallbackLine(outOfView, describe), /Recuerdo Fruita Fresca.*no lo veo/);
});

test('furthest answers compare actual visible facts and never borrow remembered distance or invent metre conversions', () => {
  const facts = courierGrounding(richerContext);
  assert.equal(facts.nearestVisible?.id, 'corner');
  assert.equal(facts.furthestVisible?.id, 'crossing');
  const question = { ...richerContext, history: [{ role: 'player', text: 'What is the furthest thing you can see?' }] };
  assert.match(fallbackLine(question, describe), /m[aá]s lejano.*paso de peatones del norte al norte/);
  assert.equal(speechIsGrounded('The fruit shop is about 210 units south.', richerContext, describe), true);
  assert.equal(speechIsGrounded('The fruit shop is 900 units away.', richerContext, describe), false);
  assert.equal(speechIsGrounded('The fruit shop is 213 metres away.', richerContext, describe), false);
});

test('every courier fallback is Spanish and proper storefront names survive translation', () => {
  const prompt = dialogueMessages(richerContext, describe)[0].content;
  assert.match(prompt, /Castilian Spanish \(es-ES\)/);
  assert.match(prompt, /Output ONLY spoken Spanish/);
  assert.doesNotMatch(prompt, /Output ONLY spoken English/);
  assert.equal(spanishLandmarkLabel('northwest corner of Fruita Fresca'), 'la esquina noroeste de Fruita Fresca');
  assert.equal(spanishLandmarkLabel('northwest corner of a fruit shop'), 'la esquina noroeste de una frutería');
  const variants = [
    fallbackLine({ factsLearned: { firstClueSpoken: false } }, { type: 'describe' }),
    ...['wait', 'look', 'clarify', 'move', 'return', 'drop'].map(type => fallbackLine({}, { type })),
    fallbackLine({ parcel: 'resident' }, { type: 'wait' }),
    fallbackLine({ parcel: 'drop' }, { type: 'drop' }),
    fallbackLine(richerContext, { type: 'reveal', label: 'Read the visible Fruita Fresca sign' }),
  ];
  assert.ok(variants.every(line => !/\b(I|your|parcel|which|here|the sign|point)\b/.test(line)));
  assert.match(variants[0], /Hola, buenas, tengo tu paquete/);
  assert.equal(variants[0].split(/[.!?]/).filter(sentence => sentence.trim()).length, 2);
  assert.match(variants.at(-1)!, /El cartel pone Fruita Fresca/);
  assert.match(fallbackLine({ ...richerContext, history: [{ role: 'player', text: '¿Ves la frutería?' }] }, describe), /Veo Fruita Fresca al sur/);
});

test('Spanish speech preserves current sight, colors, truthful arrival and physical parcel outcomes', () => {
  assert.equal(speechIsGrounded('No veo ninguna frutería.', richerContext, describe), false);
  assert.equal(speechIsGrounded('No conozco ninguna frutería.', richerContext, describe), false);
  assert.equal(speechIsGrounded('Veo Fruita Fresca al sur.', richerContext, describe), true);
  assert.equal(speechIsGrounded('Veo Bar Ponent.', richerContext, describe), false);
  assert.equal(speechIsGrounded('Recuerdo Bar Ponent, pero ahora no lo veo.', richerContext, describe), true);
  assert.equal(speechIsGrounded('Estoy caminando hacia el norte.', richerContext, describe), false);
  assert.equal(speechIsGrounded('Ya tienes tu paquete.', richerContext, describe), false);
  assert.equal(speechIsGrounded('He dejado el paquete en el bar.', richerContext, { type: 'drop' }), false);
  assert.equal(speechIsGrounded('Voy a dejarlo en un punto de recogida.', richerContext, { type: 'drop' }), true);
  assert.equal(speechIsGrounded('Ya tienes tu paquete.', { ...richerContext, parcel: 'resident' }, describe), true);
  assert.equal(speechIsGrounded('Estoy abajo.', richerContext, { type: 'wait', id: 'wait' }), false);
  assert.equal(speechIsGrounded('Estoy abajo.', richerContext, { type: 'wait', id: 'arrival', label: 'Wait at the home entrance' }), true);
  const awning = { ...richerContext, visibleLandmarks: [{ id: 'awning', type: 'awning', label: 'red bar awning', description: 'A red awning' }] };
  assert.equal(speechIsGrounded('Veo un toldo rojo.', awning, describe), true);
  assert.equal(speechIsGrounded('Veo un toldo azul.', awning, describe), false);
  assert.equal(speechIsGrounded('La frutería está a 213 metros.', richerContext, describe), false);
});

test('first clue still hides all rich landmarks and urgent dialogue skips optional humor', () => {
  const opening = { ...richerContext, history: [], factsLearned: { firstClueSpoken: false } };
  const summary = courierGrounding(opening);
  assert.deepEqual(summary.visible, []); assert.deepEqual(summary.remembered, []);
  assert.equal(summary.currentRoad, null);
  assert.equal(speechIsGrounded('I am near a bar and a fruit shop.', opening, describe), false);
  const stable = JSON.parse(dialogueMessages(richerContext, { type: 'move', label: 'Follow the clear street' }).at(-1)!.content);
  assert.equal(stable.optionalHumor.cue, deliveryPhrasebook.courier.move);
  const urgent = JSON.parse(dialogueMessages({ ...richerContext, remainingMs: 10_000 }, { type: 'move' }).at(-1)!.content);
  assert.equal(urgent.optionalHumor, null);
  assert.equal(JSON.parse(dialogueMessages(opening, describe).at(-1)!.content).optionalHumor, null);
});

test('curated bilingual delivery flavor keeps collection distinct from successful receipt', () => {
  assert.equal(deliveryCoachFlavor('clarify').spanish, '¿Puede hablar más despacio?');
  assert.equal(deliveryCoachFlavor('clarify').translation, 'Can you speak more slowly?');
  assert.equal(deliveryOutcomeFlavor('collection').spanish, 'Punto de recogida');
  assert.match(deliveryOutcomeFlavor('collection').note, /still need to collect/);
  assert.notEqual(deliveryOutcomeFlavor('returned').note, deliveryOutcomeFlavor('received').note);
});

test('dialogue gets real Spanish conversation roles and targets a missing entrance side', () => {
  const context={...richerContext,history:[{role:'player',text:'No, perdón, voy a mi casa.'},{role:'courier',text:'¿En qué lado está tu portal?'},{role:'player',text:'Por el sur.'}],factsLearned:{firstClueSpoken:true,homeSide:'south'}};
  const messages=dialogueMessages(context,{type:'move',label:'Go to reported south entrance'});
  assert.deepEqual(messages.slice(1,-1).map(m=>({role:m.role,content:m.content})),[{role:'user',content:'No, perdón, voy a mi casa.'},{role:'assistant',content:'¿En qué lado está tu portal?'},{role:'user',content:'Por el sur.'}]);
  assert.match(fallbackLine({...context,history:[{role:'player',text:'Ven a mi casa.'}],factsLearned:{firstClueSpoken:true}}, {type:'clarify'}), /¿En qué lado está la entrada/);
  assert.equal(speechIsGrounded('¿Voy hacia tu entrada?',context,{type:'clarify'}),true);
  assert.equal(speechIsGrounded('Voy hacia tu entrada.',context,{type:'clarify'}),false);
});
test('streaming emits short acknowledgements promptly and retains the essential clarification question', async () => {
  const phrases:string[]=[];
  const streamer=(async(_messages,onText)=>{
    onText('Vale. ');assert.deepEqual(phrases,['Vale.']);
    onText('Recuerdo Bar Ponent. ¿En qué lado está tu portal?');
    return {text:'Vale. Recuerdo Bar Ponent. ¿En qué lado está tu portal?',model:'fixture',live:true,timings:{firstTextMs:0,elapsedMs:1},usage:undefined};
  }) as Parameters<typeof generateDialogue>[4];
  const result=await generateDialogue(richerContext,{type:'clarify'},undefined,p=>{phrases.push(p);},streamer);
  assert.equal(phrases.length,3);assert.equal(phrases.at(-1),'¿En qué lado está tu portal?');
  assert.ok(result.text.includes('¿En qué lado está tu portal?'));assert.equal(result.live,true);
});

test('service prose is rejected before phrase callback and uses a grounded courier fallback', async () => {
  for (const payload of ['Connection closed. Start another call.', '{"error":"provider unavailable"}', 'openrouter_http_503']) {
    const phrases: string[] = [];
    const streamer = (async (_messages, onText) => { onText(payload); return { text: payload, model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
    const result = await generateDialogue(richerContext, { type: 'clarify' }, undefined, phrase => { phrases.push(phrase); }, streamer);
    assert.equal(result.live, false);
    assert.equal(phrases.length, 1);
    assert.doesNotMatch(phrases[0], /Connection|provider|openrouter|error/);
    assert.equal(speechIsGrounded(payload, richerContext, { type: 'clarify' }), false);
  }
  assert.equal(speechIsGrounded('No entiendo. ¿En qué lado está tu portal?', richerContext, { type: 'clarify' }), true);
});

test('service failure after valid speech keeps only the useful spoken phrase', async () => {
  const phrases: string[] = [];
  const streamer = (async (_messages, onText) => { onText('Vale. '); onText('Connection closed. '); throw new Error('provider_timeout'); }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(richerContext, { type: 'clarify' }, undefined, phrase => { phrases.push(phrase); }, streamer);
  assert.deepEqual(phrases, ['Vale.']);
  assert.equal(result.text, 'Vale.');
  assert.equal(result.error, 'stream_interrupted');
});

test('known entrance and selected movement reject repeated location questions and speak the actual route', async () => {
  const context = { ...richerContext, factsLearned: { firstClueSpoken: true, homeSide: 'south' }, activeDestination: 'home-south', history: [{ role: 'player', text: 'Ven a mi portal.' }, { role: 'courier', text: '¿En qué lado está tu portal?' }, { role: 'player', text: 'Por el sur. Rodea el edificio y ven a la entrada.' }] };
  const move = { id: 'home:south', type: 'move', targetId: 'home-south', label: 'Navigate to the reported south entrance destination' };
  assert.equal(speechIsGrounded('¿En qué lado está tu portal?', context, move), false);
  assert.equal(speechIsGrounded('¿Por dónde sigo?', context, move), false);
  assert.equal(speechIsGrounded('Vale, voy hacia tu portal en el lado sur.', context, move), true);
  const phrases: string[] = [];
  const streamer = (async (_messages, onText) => { onText('¿En qué lado está tu portal?'); return { text: '¿En qué lado está tu portal?', model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, move, undefined, phrase => { phrases.push(phrase); }, streamer);
  assert.match(result.text, /voy hacia tu portal en el lado sur/);
  assert.doesNotMatch(result.text, /\?/);
  assert.deepEqual(phrases, [result.text]);
  assert.equal(result.live, false);
});

test('a rejected question after streamed acknowledgement is completed with the selected movement', async () => {
  const context = { ...richerContext, factsLearned: { firstClueSpoken: true, homeSide: 'south' }, activeDestination: 'home-south' };
  const move = { type: 'continue', label: 'Continue current route' };
  const phrases: string[] = [];
  const streamer = (async (_messages, onText) => { onText('Vale. '); onText('¿Dónde está tu entrada?'); return { text: 'Vale. ¿Dónde está tu entrada?', model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, move, undefined, phrase => { phrases.push(phrase); }, streamer);
  assert.equal(phrases[0], 'Vale.');
  assert.match(phrases[1], /Voy hacia tu portal en el lado sur/);
  assert.doesNotMatch(result.text, /dónde|\?/);
});

test('known-side clarification acknowledges that answer and asks for a missing route reference only', () => {
  const context = { ...richerContext, factsLearned: { firstClueSpoken: true, homeSide: 'south' }, history: [{ role: 'player', text: 'Por el sur.' }] };
  assert.match(fallbackLine(context, { type: 'clarify' }), /Recuerdo.*sur.*esquina/);
  assert.doesNotMatch(fallbackLine(context, { type: 'clarify' }), /En qué lado|Quieres que siga/);
  assert.equal(speechIsGrounded('¿En qué lado está tu portal?', context, { type: 'clarify' }), false);
  assert.equal(speechIsGrounded('Recuerdo tu portal al sur. ¿Qué esquina uso para llegar?', context, { type: 'clarify' }), true);
});

test('interrupted greeting followed by a concrete command is a real directions turn', async () => {
  const context = { ...richerContext, policy: 'FIRST CLUE: near a bar', factsLearned: { firstClueSpoken: false, homeSide: 'south' }, history: [{ role: 'player', text: 'Mi entrada está al sur. Camina hasta mi portal.' }] };
  const move = { id: 'home:south', type: 'move', targetId: 'home-south', label: 'Go to reported south entrance' };
  const expected = 'Voy hacia tu portal en el lado sur.';
  assert.equal(speechIsGrounded(expected, context, move), true);
  assert.ok(courierGrounding(context).visible.length > 0);
  assert.match(dialogueMessages(context, move)[0].content, /interrupted greeting/);
  const streamer = (async (_messages, onText) => { onText(expected); return { text: expected, model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, move, undefined, undefined, streamer);
  assert.equal(result.text, expected);
  assert.equal(result.live, true);
});

test('movement fallback follows its selected street or known landmark without inventing entrance arrival', () => {
  assert.match(fallbackLine(richerContext, { id: 'walk:west', type: 'move', label: 'Walk west' }), /camino hacia el oeste/);
  const place = fallbackLine(richerContext, { type: 'move', targetId: 'fruit', label: 'Go to Fruita Fresca' });
  assert.match(place, /sigo la ruta hacia Fruita Fresca/);
  assert.doesNotMatch(place, /portal|Estoy abajo|ya tienes/);
});

test('a valid movement acknowledgement is not repeated when an unnecessary follow-up question is omitted', async () => {
  const context = { ...richerContext, factsLearned: { firstClueSpoken: true, homeSide: 'south' }, activeDestination: 'home-south' };
  const move = { type: 'move', targetId: 'home-south', label: 'Go to reported entrance' };
  const phrases: string[] = [];
  const streamer = (async (_messages, onText) => { onText('Vale, voy hacia tu portal en el lado sur. '); onText('¿Quieres que siga?'); return { text: '', model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, move, undefined, phrase => { phrases.push(phrase); }, streamer);
  assert.deepEqual(phrases, ['Vale, voy hacia tu portal en el lado sur.']);
  assert.equal(result.text, phrases[0]);
});

test('literal disfluent entrance answer is learned before dialogue acknowledges its actual movement', async () => {
  const game = createGame(); answerCall(game);
  recordSpeech(game, '¿En qué lado está tu portal?');
  const literal = 'Mi portal, eh, está en la de sur.';
  recordHistory(game, { role: 'player', text: literal, at: game.updatedAt });
  learnPlayerFacts(game, literal);
  assert.equal(game.facts.homeSide, 'south');
  const move = actionCandidates(game, 'directions', game.updatedAt, literal).find(action => action.id === 'home:south')!;
  assert.ok(move);
  const context = npcContext(game), phrases: string[] = [];
  const expected = fallbackLine(context, move);
  const streamer = (async (_messages, onText) => { onText(expected); return { text: '', model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, move, undefined, phrase => { phrases.push(phrase); }, streamer);
  assert.equal(result.live, true);
  assert.match(result.text, /límite de lo que veo y paro/);
  assert.equal(result.text, expected);
  assert.doesNotMatch(result.text, /\?/);
});

test('dialogue cannot verbally learn an entrance side that authoritative facts did not learn', async () => {
  const context = { ...richerContext, history: [{ role: 'player', text: 'Mi portal, eh, está en la de sur.' }], factsLearned: { firstClueSpoken: true, homeSide: null } };
  assert.equal(speechIsGrounded('Tu portal está al sur.', context, { type: 'clarify' }), false);
  const streamer = (async (_messages, onText) => { onText('Tu portal está al sur.'); return { text: '', model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, { type: 'clarify' }, undefined, undefined, streamer);
  assert.equal(result.live, false);
  assert.doesNotMatch(result.text, /(?:portal|entrada).*sur|voy|camino/);
});

test('clarification after a known entrance route preserves that route context without inventing movement', () => {
  const context = { ...richerContext, factsLearned: { firstClueSpoken: true, homeSide: 'south' }, activeDestination: 'home-south', navigation: { destination: { id: 'home-south' }, moving: false } };
  const line = fallbackLine(context, { type: 'clarify' });
  assert.match(line, /Recuerdo tu portal al sur.*parte de la ruta/);
  assert.doesNotMatch(line, /en qué lado|voy|camino|sigo la ruta/);
  assert.equal(speechIsGrounded(line, context, { type: 'clarify' }), true);
});

test('clipped home movement acknowledges its visible leg rather than promising the entrance', async () => {
  const context = { ...richerContext, factsLearned: { firstClueSpoken: true, homeSide: 'south' }, navigation: { segmentReachesDestination: false, awaitingGuidance: false } };
  const move = { id: 'home:south', type: 'move', targetId: 'home-south', label: 'Go toward reported south entrance' };
  assert.equal(speechIsGrounded('Voy hacia tu portal en el lado sur.', context, move), false);
  const streamer = (async (_messages, onText) => { onText('Voy hacia tu portal en el lado sur.'); return { text: '', model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, move, undefined, undefined, streamer);
  assert.match(result.text, /límite de lo que veo y paro/);
  assert.doesNotMatch(result.text, /portal|llegado|\?/);
});

test('visible-edge stop describes current sight and asks only for the next step', async () => {
  const context = { ...richerContext, factsLearned: { firstClueSpoken: true, homeSide: 'south' }, history: [{ role: 'player', text: 'Mi portal está al sur.' }], navigation: { segmentReachesDestination: false, awaitingGuidance: true, arrived: false } };
  const stop = { id: 'visibility-stop', type: 'describe', label: 'Describe current stopping point' };
  const line = fallbackLine(context, stop);
  assert.match(line, /Ahora veo el cruce de calles del este.*¿Sigo desde aquí\?/);
  assert.equal(line.split('?').length - 1, 1);
  assert.doesNotMatch(line, /portal|entrada|Estoy abajo|he llegado/);
  assert.equal(speechIsGrounded('Estoy abajo, en la entrada.', context, stop), false);
  assert.equal(speechIsGrounded(line, context, stop), true);
  const streamer = (async () => { throw new Error('fixture_offline'); }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, stop, undefined, undefined, streamer);
  assert.equal(result.text, line);
  const legacy = fallbackLine(context, { id: 'arrival', type: 'wait', label: 'Wait at entrance' });
  assert.equal(legacy, line);
});

test('a final physical leg and actual doorway arrival retain truthful entrance wording', () => {
  const context = { ...richerContext, factsLearned: { firstClueSpoken: true, homeSide: 'south' }, navigation: { segmentReachesDestination: true, awaitingGuidance: false, arrived: true } };
  assert.match(fallbackLine(context, { id: 'home:south', type: 'move', targetId: 'home-south' }), /voy hacia tu portal en el lado sur/);
  assert.match(fallbackLine(context, { id: 'arrival', type: 'wait', label: 'Wait at home entrance' }), /Estoy abajo/);
});

test('stationary visibility-stop rejects the exact live false walking line but permits its next-step question', async () => {
  const context = { ...richerContext, navigation: { moving: false, awaitingGuidance: true, segmentReachesDestination: false } };
  const stop = { id: 'visibility-stop', type: 'describe' };
  const failed = 'Avanzo hacia el sur solo hasta donde veo y me detengo. Veo el cruce. ¿Por dónde sigo?';
  assert.equal(speechIsGrounded(failed, context, stop), false);
  assert.equal(speechIsGrounded('¿Por dónde sigo?', context, stop), true);
  const phrases: string[] = [];
  const streamer = (async (_messages, onText) => { onText(failed); return { text: failed, model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, stop, undefined, phrase => { phrases.push(phrase); }, streamer);
  assert.deepEqual(phrases, [fallbackLine(context, stop)]);
  assert.match(result.text, /^Ahora veo .*¿Sigo desde aquí\?$/);
  assert.doesNotMatch(result.text, /Avanzo|camino|me dirijo|voy/);
});


test('stop discovery prefers a newly visible junction over a remembered nearby wall', () => {
  const context = { ...richerContext, navigation: { moving: false, awaitingGuidance: true }, newlyVisibleLandmarks: [{ id: 'junction' }], visibleLandmarks: [...richerContext.visibleLandmarks, { id: 'wall', type: 'wall', label: 'Old wall', distance: 2, direction: 'west' }] };
  const line = fallbackLine(context, { id: 'visibility-stop', type: 'describe' });
  assert.match(line, /Ahora veo el cruce de calles del este/);
  assert.doesNotMatch(line, /Old wall/);
});

test('stop discovery prioritizes the actual visible doorway and ignores stale discovery IDs', () => {
  const context = { ...richerContext, navigation: { moving: false, awaitingGuidance: true }, newlyVisibleLandmarks: [{ id: 'home-door' }, { id: 'junction' }] };
  const stop = { id: 'visibility-stop', type: 'describe' };
  assert.doesNotMatch(fallbackLine(context, stop), /entrada|portal/);
  const actual = { ...context, visibleLandmarks: [...context.visibleLandmarks, { id: 'home-door', type: 'entrance', label: 'South apartment entrance', distance: 110, direction: 'east' }] };
  assert.match(fallbackLine(actual, stop), /Ahora veo .*entrada.*¿Me acerco/);
  assert.doesNotMatch(fallbackLine(actual, stop), /Estoy abajo|he llegado/);
});

test('a received parcel farewell remains short and plays through fallback generation', async () => {
  const context = { ...richerContext, parcel: 'resident', phase: 'resolved' };
  const action = { id: 'farewell', type: 'wait' };
  const expected = '¡Aquí tienes! Gracias, ¡que tengas buen día!';
  assert.equal(fallbackLine(context, action), expected);
  const phrases: string[] = [];
  const offline = (async () => { throw new Error('fixture_offline'); }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, action, undefined, phrase => { phrases.push(phrase); }, offline);
  assert.equal(result.text, expected);
  assert.deepEqual(phrases, [expected]);
});


test('a bounded avanzo acknowledgement is not repeated after rejecting an extra question', async () => {
  const context = { ...richerContext, navigation: { moving: true, awaitingGuidance: false, segmentReachesDestination: false } };
  const action = { id: 'home:south', type: 'move', targetId: 'home-south' };
  const accepted = 'Vale, avanzo hasta donde veo y me detengo.';
  const phrases: string[] = [];
  const streamer = (async (_messages, onText) => { onText(accepted + ' '); onText('¿Por dónde sigo?'); return { text: '', model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
  const result = await generateDialogue(context, action, undefined, phrase => { phrases.push(phrase); }, streamer);
  assert.deepEqual(phrases, [accepted]);
  assert.equal(result.text, accepted);
});


test('Spanish and English facing questions answer every actual cardinal heading without changing context', () => {
  const questions = ['¿Hacia dónde miras?', '¿En qué dirección estás mirando?', '¿En qué dirección miras?', 'Which way are you facing?', 'What direction are you looking?'];
  for (const [facing, spanish] of Object.entries({ north: 'norte', south: 'sur', east: 'este', west: 'oeste' })) for (const question of questions) {
    const context = { ...richerContext, orientation: { facing }, position: { facing: 'north' }, history: [{ role: 'player', text: question }] };
    const snapshot = JSON.stringify(context);
    const line = fallbackLine(context, describe);
    assert.match(line, new RegExp(`^Miro hacia el ${spanish}; veo`));
    assert.doesNotMatch(line, /camino|avanzo|me dirijo|Bar Ponent/);
    assert.equal(speechIsGrounded(line, context, describe), true);
    assert.equal(JSON.stringify(context), snapshot);
  }
});

test('heading statements cannot substitute landmark bearing for actual orientation', () => {
  const context = { ...richerContext, orientation: { facing: 'west' }, history: [{ role: 'player', text: '¿Hacia dónde miras?' }] };
  assert.equal(speechIsGrounded('Miro hacia el oeste.', context, describe), true);
  assert.equal(speechIsGrounded('Estoy mirando al norte.', context, describe), false);
  assert.equal(speechIsGrounded('Estoy orientado hacia el sur.', context, describe), false);
  assert.equal(speechIsGrounded('Miro hacia el oeste y veo Fruita Fresca al sur.', context, describe), true);
  assert.equal(speechIsGrounded('Miro hacia el oeste y veo Bar Ponent.', context, describe), false);
});

test('stationary look and useful stop explicitly state heading while preserving scoped discovery', () => {
  const context = { ...richerContext, orientation: { facing: 'east', left: 'north', right: 'south' }, navigation: { moving: false, awaitingGuidance: true }, newlyVisibleLandmarks: [{ id: 'junction' }] };
  const stop = fallbackLine(context, { id: 'visibility-stop', type: 'describe' });
  assert.match(stop, /^Miro hacia el este; ahora veo el cruce de calles del este/);
  assert.equal(stop.split('?').length - 1, 1);
  const look = fallbackLine(context, { id: 'look:east', type: 'look', facing: 'east' });
  assert.match(look, /^Miro hacia el este;/);
  const messages = dialogueMessages(context, describe);
  assert.match(messages[0].content, /relative to the courier current facing/);
  assert.match(messages[0].content, /FIRST phrase.*actual orientation.facing/);
});

test('live captions missing or contradicting heading fall back before reaching the phrase callback', async () => {
  for (const failed of ['Veo la esquina oeste del edificio.', 'Miro hacia el norte.']) {
    const context = { ...richerContext, orientation: { facing: 'west' }, history: [{ role: 'player', text: '¿En qué dirección estás mirando?' }] };
    const phrases: string[] = [];
    const streamer = (async (_messages, onText) => { onText(failed); return { text: failed, model: 'fixture', live: true, timings: { elapsedMs: 1 }, usage: undefined }; }) as Parameters<typeof generateDialogue>[4];
    const result = await generateDialogue(context, describe, undefined, phrase => { phrases.push(phrase); }, streamer);
    assert.equal(result.live, false);
    assert.deepEqual(phrases, [fallbackLine(context, describe)]);
    assert.match(result.text, /^Miro hacia el oeste;/);
  }
});

test('a heading answer with no current objects does not resurrect remembered landmarks', () => {
  const context = { ...richerContext, orientation: { facing: 'north' }, observations: [], visibleLandmarks: [], history: [{ role: 'player', text: 'Which way are you facing?' }] };
  const answer = fallbackLine(context, describe);
  assert.equal(answer, 'Miro hacia el norte; no veo una referencia clara.');
  assert.doesNotMatch(answer, /Fruita|Bar Ponent|esquina/);
});

test('structural English corner leakage is translated while preserving storefront names', () => {
  assert.equal(cleanSpeech('Veo el noreste corner of Fruita Fresca cerca.'), 'Veo la esquina noreste de Fruita Fresca cerca.');
  assert.equal(cleanSpeech('Veo the northeast corner of Bar Llevant.'), 'Veo la esquina noreste de Bar Llevant.');
});
