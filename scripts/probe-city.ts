/** Actual provider semantic probe, with authored initial positions and a frozen
 * test clock. This is not real-time browser/hardware timing or physical travel. */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { createGame, answerCall, recordSpeech, npcContext } from '../src/server/game.js';
import { decide } from '../src/server/jev.js';
import { generateDialogue, speechIsGrounded } from '../src/server/dialogue.js';
import { segmentClear, type Point, type Direction } from '../src/shared/world.js';
import { usageSummary } from '../src/server/usage.js';
config({ path: '.env.local', quiet: true });
const cases = [
  {name:'current and furthest observation',text:'What can you see from where you are? What is the furthest thing you can see?',intent:/describe|look|observe|view|survey/i},
  {name:'fruit shop recognition',facing:'south',text:'Walk to the fruit shop, Fruita Fresca, with the fruit crates.',intent:/fruita|fruit/i},
  {name:'building corner',facing:'east',text:'Go to the northwest corner of the central apartment building.',intent:/corner|northwest|north-west/i},
  {name:'cross the street',text:'Cross the street using the nearest pedestrian crossing.',intent:/cross/i},
  {name:'intersection',facing:'east',text:'Walk to the nearest intersection.',intent:/intersection|junction/i},
  {name:'cross intersection',facing:'east',text:'Cross the nearest intersection.',intent:/cross:intersection/i},
  {name:'turn to look',text:'Look south.',intent:/look:south/i},
  {name:'around building',text:'Go around the central building to my entrance on the south side.',intent:/home:south|home-south/i},
];
const rows = await Promise.all(cases.map(async sample => {
 const now=Date.now(), game=createGame(undefined,now); answerCall(game,now);
 recordSpeech(game,'I have your parcel. I am near a bar. Which way should I go?','opening',now);
 if(sample.facing)game.courier.direction=sample.facing as Direction;
 const decision=await decide(game,sample.text,undefined,{now:()=>now});
 if(!decision)throw Error('No decision');
 const context=npcContext(game,now), speech=await generateDialogue({...context,sessionId:game.id,turnId:'semantic'},decision);
 let anchor:Point=game.courier, routeLegal=true;
 for(const waypoint of decision.action.route??[]){routeLegal=routeLegal&&segmentClear(anchor,waypoint);anchor=waypoint;}
 return {name:sample.name,input:sample.text,initialFacing:sample.facing??'north',selected:decision.selected,label:decision.action.label,reason:decision.action.reason,source:decision.source,model:decision.model,
 speech:speech.text,speechLive:speech.live,grounded:speechIsGrounded(speech.text,context,decision),routeLegal,
 intentMatched:sample.intent.test(decision.selected+' '+decision.action.label),usage:usageSummary(game.id)};
}));
const report={at:new Date().toISOString(),scope:'Real JEV and dialogue requests; fresh authored scenario per case and frozen test clock. No browser microphone or physical-time movement.',pass:rows.every(r=>r.source==='jev'&&r.intentMatched&&r.grounded&&r.routeLegal),cases:rows};
writeFileSync('docs/qa/city-semantics-live.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.pass)process.exitCode=1;
