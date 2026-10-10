import WebSocket from 'ws';
import fs from 'node:fs';
const base=process.env.EXPATIA_QA_URL||'http://localhost:3317';
const started=new Date().toISOString();let token='',id='',turn='opening';const events=[];
async function api(path,body){const r=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
const {game,token:cap}=await api('session',{});token=cap;id=game.id;
const ws=new WebSocket(base.replace('http','ws')+'/realtime?token='+encodeURIComponent(token));
ws.on('message',b=>{const m=JSON.parse(b.toString());if(!m.audio)events.push({type:m.type,turnId:m.turnId,text:m.text,live:m.live,timings:m.timings});});
await new Promise(r=>ws.once('open',()=>{ws.send(JSON.stringify({type:'hello',sessionId:id}));r();}));
await new Promise(r=>setTimeout(r,1300));
const before=(await api('session/'+id)).game;
await api('session/'+id+'/answer',{turnId:turn});
let opening;for(let i=0;i<70;i++){await new Promise(r=>setTimeout(r,100));const g=(await api('session/'+id)).game;if(g.history.some(h=>h.role==='courier')){opening=g;break;}}
const clarify=await api('session/'+id+'/turn',{text:'Which bar are you beside? Can you read its name?',turnId:'clarify'});
const wrong=await api('session/'+id+'/turn',{text:'My entrance is on the north side. Please meet me there.',turnId:'wrong'});
await new Promise(r=>setTimeout(r,1700));
const correct=await api('session/'+id+'/turn',{text:'Sorry, I meant the south side of the central building. My entrance is at the bottom. Please meet me there.',turnId:'correct'});
for(let i=0;i<9;i++){await new Promise(r=>setTimeout(r,100));await api('session/'+id+'/move',{dx:0,dy:1,dt:.1});}
let arrival;for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,100));const g=(await api('session/'+id)).game;if(g.canHandoff){arrival=g;break;}}
if(!arrival)throw Error('Courier did not physically reach handoff');
const outcome=(await api('session/'+id+'/handoff',{})).game;
const report={started,completed:new Date().toISOString(),url:base,clockUntimed:before.deadline===null,deadlineExactly60000:opening?.deadline-opening?.startedAt===60000,opening:opening?.history.filter(h=>h.role==='courier'),clarification:clarify.game.inspector,wrongSide:wrong.game.inspector?.selected,correction:correct.game.inspector?.selected,outcome:outcome.outcome,parcel:outcome.parcel,remainingMs:outcome.remainingMs,usage:outcome.usage,turnTimings:[clarify.timings,wrong.timings,correct.timings],events};
fs.writeFileSync('docs/qa/live-node.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({clockUntimed:report.clockUntimed,deadlineExactly60000:report.deadlineExactly60000,wrongSide:report.wrongSide,correction:report.correction,outcome:report.outcome,turnTimings:report.turnTimings}));ws.close();
