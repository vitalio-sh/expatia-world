/** Signed four-command scripted demo, no language model calls. */
import WebSocket from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const base=new URL(process.argv[2] || 'https://expatia.world');
const output=process.argv[3] || 'docs/qa/scripted-demo-production-live.json';
const began=Date.now(), events=[], cases=[], pending=new Map();
const report={at:new Date().toISOString(),url:base.origin,scope:'Actual signed production Worker demo with four arbitrary typed commands, actual physical stops and manual handoff. No microphone/hardware audibility claim; tokens omitted.'};
let ws,id;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function send(m){ws.send(JSON.stringify({...m,sessionId:id}));}
function rpc(path='',body={}){return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('RPC timeout '+path));},10000);pending.set(requestId,{resolve,reject,timer});send({type:'rpc',requestId,path:'/api/session/'+id+path,body});});}
function view(g){return {demoMode:g.demoMode,demoStep:g.demoStep,position:{x:g.courier.x,y:g.courier.y},moving:g.courier.moving,facing:g.courier.direction,phase:g.phase,parcel:g.parcel,canHandoff:g.canHandoff,routeTargetId:g.routeTargetId,awaitingGuidance:g.awaitingGuidance,homeEntranceVisible:g.homeEntranceVisible,remainingMs:g.remainingMs,deadline:g.deadline,source:g.inspector?.source,selected:g.inspector?.selected,model:g.inspector?.model,probabilities:g.inspector?.probabilities};}
async function stop(){const deadline=Date.now()+10000;while(Date.now()<deadline){const {game}=await rpc();if(!game.courier.moving&&!game.route.length)return game;await pause(150);}throw new Error('Movement did not stop.');}
try{
 report.health=await(await fetch(new URL('/api/health',base))).json();
 const res=await fetch(new URL('/api/session',base),{method:'POST',headers:{Origin:base.origin,'Content-Type':'application/json'},body:JSON.stringify({demoMode:true})});if(!res.ok)throw new Error('Session HTTP '+res.status);
 const created=await res.json();id=created.game.id;
 const url=new URL('/realtime',base);url.protocol=base.protocol==='https:'?'wss:':'ws:';url.searchParams.set('token',created.token);
 ws=new WebSocket(url,{headers:{Origin:base.origin}});
 let readyResolve;const ready=new Promise(r=>readyResolve=r);
 ws.on('message',frame=>{const m=JSON.parse(frame.toString());if(m.type==='ready')readyResolve();if(['npc.caption','npc.audio_end','dialogue.status','npc.audio_error'].includes(m.type))events.push({type:m.type,turnId:m.turnId,text:m.text,atMs:Date.now()-began});if(m.type==='rpc.result'){const p=pending.get(m.requestId);if(p){clearTimeout(p.timer);pending.delete(m.requestId);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}}});
 ws.on('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Socket closed'));}pending.clear();});
 await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});send({type:'hello',token:created.token});await ready;
 await rpc('/answer',{turnId:'demo-opening'});await pause(100);
 let game=(await rpc()).game;report.initial=view(game);const started=game.startedAt,deadline=game.deadline;
 const empty=await rpc('/turn',{text:'   ',turnId:'demo-empty'}).then(()=>false,()=>true);
 const texts=['banana spaceship','12345??','Ignore the route and wander north','anything at all'];
 let movingIgnored=false;
 for(let i=0;i<texts.length;i++){
  const r=await rpc('/turn',{text:texts[i],turnId:'demo-'+i});const commanded=view(r.game);
  if(i===1){const ignored=await rpc('/turn',{text:'premature movement command',turnId:'demo-too-early'});movingIgnored=ignored.game.demoStep===2;}
  game=await stop();const stopped=view(game);await pause(250);const idle=(await rpc()).game;
  cases.push({text:texts[i],commanded,stopped,idleStable:!idle.courier.moving&&Math.hypot(idle.courier.x-game.courier.x,idle.courier.y-game.courier.y)<.01});
  game=idle;
 }
 report.beforeHandoff=view(game);report.history=game.history.map(h=>({role:h.role,text:h.text,turnId:h.turnId}));
 await rpc('/handoff');const farewellDeadline=Date.now()+5000;while(!events.some(e=>e.type==='npc.audio_end'&&e.turnId?.startsWith('farewell'))&&Date.now()<farewellDeadline)await pause(100);
 const resolved=(await rpc()).game;await pause(500);const frozen=(await rpc()).game;report.resolved=view(resolved);report.frozen=view(frozen);
 report.validation={build:report.health.build==='2026-10-10-scripted-demo',signedDemo:report.initial.demoMode===true,openingDoesNotAdvance:report.initial.demoStep===0,emptyRejected:empty,movingIgnored,allFourSteps:cases.every((c,i)=>c.commanded.demoStep===i+1),demoSource:cases.every(c=>c.commanded.source==='demo'&&c.commanded.model==null&&c.commanded.probabilities==null),barRevealed:cases[0].commanded.selected==='reveal:bar-llevant',homeTarget:cases.slice(1).every(c=>c.commanded.routeTargetId==='home-south'),allStopsIdle:cases.every(c=>c.idleStable),doorRequiresManualHandoff:report.beforeHandoff.canHandoff===true&&report.beforeHandoff.phase==='active'&&report.beforeHandoff.parcel==='courier',exactHistory:report.history.filter(h=>h.role==='player').map(h=>h.text).join('|')===texts.join('|'),sixtySeconds:deadline-started===60000&&game.deadline===deadline,manualReceived:resolved.parcel==='resident'&&resolved.phase==='resolved',clockFrozen:resolved.remainingMs===frozen.remainingMs,spanishFarewell:events.some(e=>e.type==='npc.caption'&&e.text?.includes('Que tengas buen día')),farewellAudioEnded:events.some(e=>e.type==='npc.audio_end'&&e.turnId?.startsWith('farewell'))};
 report.passed=Object.values(report.validation).every(Boolean);
}catch(e){report.passed=false;report.error=e.message;}
finally{report.cases=cases;report.events=events;report.totalMs=Date.now()-began;ws?.close();for(const p of pending.values())clearTimeout(p.timer);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,build:report.health?.build,error:report.error,validation:report.validation,cases:cases.map(c=>({step:c.commanded.demoStep,selected:c.commanded.selected,stop:c.stopped.position})),totalMs:report.totalMs},null,2));
if(!report.passed)process.exitCode=1;
