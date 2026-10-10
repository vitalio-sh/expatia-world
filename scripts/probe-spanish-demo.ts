/** Actual JEV + dialogue requests. Authored fixture history and frozen clock;
 * authoritative movement is advanced explicitly, not measured as browser time. */
import {config} from 'dotenv';
import {writeFileSync} from 'node:fs';
import {createGame,answerCall,recordSpeech,npcContext,tickGame,canHandoff,handoff} from '../src/server/game.js';
import {decide} from '../src/server/jev.js';
import {generateDialogue,speechIsGrounded} from '../src/server/dialogue.js';
import {segmentClear,HOME_ENTRANCE,distance,type Game} from '../src/shared/world.js';
import {usageSummary,flushUsage} from '../src/server/usage.js';
config({path:'.env.local',quiet:true});
const sequences=[
 {name:'Spanish navigation demo',steps:[
  {text:'¿Qué bar?',intent:/^reveal:bar-/},
  {text:'¿Cómo se llama?',intent:/^reveal:bar-/},
  {text:'¿Qué ves?',intent:/^describe-surroundings$/},
  {text:'Mira hacia el sur.',intent:/^look:south$/},
  {text:'Ve a la frutería.',intent:/^go:fruita$|^landmark:fruit-display$/,travel:3},
  {text:'Cruza la calle por el paso de peatones.',intent:/^cross:crossing-/,travel:5},
  {text:'Rodea el edificio y ven a mi portal, en el lado sur.',intent:/^home:south$/},
  {text:'Estoy en casa; la entrada está al sur.',intent:/^home:south$|^continue$/},
 ]},
 {name:'Exact UI coaching sequence',steps:[
  {text:'Hola, buenas. ¿Cómo se llama el bar?',intent:/^reveal:bar-/},
  {text:'Mira hacia el sur. ¿Ves la frutería?',intent:/^look:south$/},
  {text:'Rodea el edificio y ven a mi portal, en el lado sur.',intent:/^home:south$/},
 ]},
];
const reports=[];
for(const sequence of sequences){
 let now=Date.now();const game:Game=createGame(undefined,now);answerCall(game,now);
 recordSpeech(game,'Tengo tu paquete. Estoy cerca de un bar. ¿Por dónde voy?','authored-opening-fixture',now);
 const rows=[];
 for(const step of sequence.steps){
  const initialFacing=game.courier.direction;
  const decision=await decide(game,step.text,undefined,{now:()=>now});if(!decision)throw Error('Missing decision');
  const context=npcContext(game,now),speech=await generateDialogue({...context,sessionId:game.id,turnId:decision.id},decision);
  let anchor={x:game.courier.x,y:game.courier.y},routeLegal=true;
  for(const waypoint of game.route){routeLegal=routeLegal&&segmentClear(anchor,waypoint);anchor=waypoint;}
  rows.push({input:step.text,initialFacing,selected:decision.selected,source:decision.source,model:decision.model,probabilities:decision.probabilities,elapsedMs:decision.elapsedMs,intentMatched:step.intent.test(decision.selected),routeLegal,speech:speech.text,speechLive:speech.live,grounded:speechIsGrounded(speech.text,context,decision)});
  recordSpeech(game,speech.text,decision.id,now);
  if('travel' in step && step.travel){now+=step.travel*1000;tickGame(game,now,step.travel);}
 }
 now+=10_000;tickGame(game,now,10);const reached=distance(game.courier,HOME_ENTRANCE)<1;
 const eligible=canHandoff(game,now),received=handoff(game,now);
 reports.push({name:sequence.name,pass:rows.every(r=>r.source==='jev'&&r.intentMatched&&r.routeLegal&&r.grounded&&r.speechLive)&&reached&&eligible&&received,steps:rows,reached,eligible,received,outcome:game.outcome,resident:{...game.resident},usage:usageSummary(game.id)});
}
await flushUsage();
const report={at:new Date().toISOString(),scope:'Live JEV and Spanish dialogue, authored opening fixture, frozen clock with explicit authoritative travel. No browser/microphone/time-speed claim.',pass:reports.every(r=>r.pass),sequences:reports};
writeFileSync('docs/qa/spanish-demo-live.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,sequences:reports.map(r=>({name:r.name,pass:r.pass,selected:r.steps.map(s=>s.selected),liveJev:r.steps.every(s=>s.source==='jev'),liveSpeech:r.steps.every(s=>s.speechLive),grounded:r.steps.every(s=>s.grounded),received:r.received}))},null,2));
if(!report.pass)process.exitCode=1;
