import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, answerCall, tickGame, publicGame, npcContext, handoff } from '../src/server/game.js';
import { decideDemo, scriptedDemoLine } from '../src/server/demo.js';
import { HOME_ENTRANCE } from '../src/shared/world.js';
const start=Date.parse('2026-10-10T10:00:00Z');
test('scripted demo is explicit, four commands, three bounded physical legs and manual handoff',()=>{
  const game=createGame(undefined,start);game.demoMode=true;answerCall(game,start);
  assert.equal(decideDemo(game,'',start),null);assert.equal(game.demoStep,0);assert.ok(scriptedDemoLine(npcContext(game)).includes('junto a un bar'));
  const quotes=['cualquier frase uno','¿Hacia dónde miras?','no sigas','palabras cuatro'];
  const expected=['reveal:bar-llevant','home:south','continue','continue'];
  let now=start;
  for(let i=0;i<4;i++){
    const result=decideDemo(game,quotes[i],now);assert.equal(result?.source,'demo');assert.equal(result?.selected,expected[i]);assert.equal(result?.probabilities,null);assert.equal(game.demoStep,i+1);
    if(i>0){assert.equal(game.route.length,1);assert.equal(decideDemo(game,'otra frase mientras camina',now),null);assert.equal(game.demoStep,i+1);now+=5_000;tickGame(game,now,5);assert.equal(game.courier.moving,false);const position={x:game.courier.x,y:game.courier.y};now+=1_000;tickGame(game,now,1);assert.deepEqual({x:game.courier.x,y:game.courier.y},position);}
  }
  assert.deepEqual({x:game.courier.x,y:game.courier.y},HOME_ENTRANCE);assert.equal(publicGame(game,now).canHandoff,true);assert.equal(game.parcel,'courier');assert.equal(decideDemo(game,'quinta frase',now),null);assert.equal(game.demoStep,4);
  assert.deepEqual(game.history.filter(h=>h.role==='player').map(h=>h.text),quotes);assert.ok(scriptedDemoLine(npcContext(game)).includes('Ya puedes aceptarlo'));
  assert.equal(handoff(game,now),true);assert.ok(scriptedDemoLine(npcContext(game)).includes('Que tengas buen día'));
});
test('normal mode cannot enter the script and the authoritative timer still expires',()=>{
  const normal=createGame(undefined,start);answerCall(normal,start);assert.equal(decideDemo(normal,'hola',start),null);assert.equal(normal.demoStep,0);
  const game=createGame(undefined,start);game.demoMode=true;answerCall(game,start);tickGame(game,start+60_000,60);assert.equal(decideDemo(game,'hola',start+60_000),null);assert.equal(game.phase,'timeout');assert.equal(game.demoStep,0);
});
