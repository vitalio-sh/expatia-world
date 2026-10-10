import { config } from 'dotenv';
config({path:'.env.local',quiet:true});
import {setDefaultResultOrder} from 'node:dns';
setDefaultResultOrder('ipv4first');
import express from 'express';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {createGame,answerCall,tickGame,moveResident,handoff,npcContext,publicGame,recordSpeech,recordHistory} from './game';
import {decide,resolveTimeout} from './jev';
import {getWeather} from './weather';
import {generateDialogue} from './dialogue';
import {attachRealtime} from './realtime';
import {createSpeechTurn,prewarmSpeech,closeSpeech,relay} from './voice';
import {recordUsage,usageSummary} from './usage';
import type {Game,Decision} from '../shared/world';
const app=express(),server=createServer(app);
app.disable('x-powered-by');app.use(express.json({limit:'12kb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','microphone=(self), geolocation=()');if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`${req.headers['x-forwarded-proto']??req.protocol}://${req.headers.host}`){res.status(403).json({error:'This action requires the game origin.'});return;}next();});
app.use('/api/art',express.static(resolve('public/art'),{maxAge:'1m'}));
type Session={game:Game;token:string;controller?:AbortController;turnId?:string;lastActivity:number;lastMove:number;turnTimes:number[];arrival:number;timeoutRunning:boolean;dialogueLive?:boolean};
const sessions=new Map<string,Session>();
const limits=new Map<string,{count:number;reset:number}>();
function authorize(id:string,token:string){return sessions.get(id)?.token===token;}
const realtime=attachRealtime(server,{verifySession:(id,req)=>{const u=new URL(req?.url??'/','http://localhost');return authorize(id,u.searchParams.get('token')??'');},onInterrupt:(id)=>{sessions.get(id)?.controller?.abort();},onPlaybackTiming:(id,turnId,timings)=>recordUsage({provider:'browser',operation:'playback',sessionId:id,turnId,...timings,elapsedMs:timings.speechEndToFirstScheduledMs,live:true})});
function state(s:Session){return {...publicGame(s.game),dialogueLive:s.dialogueLive,usage:usageSummary(s.game.id)};}
function obtain(req:express.Request,res:express.Response):Session|undefined{const s=sessions.get(String(req.params.id));if(!s||!authorize(s.game.id,String(req.headers.authorization??'').replace(/^Bearer /,''))){res.status(404).json({error:'This call is no longer available. Start another call.'});return;}s.lastActivity=Date.now();tickGame(s.game);return s;}
async function speak(s:Session,decision:Partial<Decision>|null,turnId:string,signal:AbortSignal){
 const client=realtime.getClient(s.game.id);let speech:any;
 // Speech preparation can fail independently; subtitles and world actions still work.
 if(client)try{speech=await createSpeechTurn(s.game.id,turnId,client,signal);}catch{relay(client,{type:'npc.audio_error',sessionId:s.game.id,turnId,error:'Live voice unavailable. Subtitles remain available.'});}
 let words='';const started=performance.now();
 const reply=await generateDialogue({...npcContext(s.game),sessionId:s.game.id,turnId},decision?.action??decision,signal,phrase=>{
  if(signal.aborted||s.turnId!==turnId)return;
  words+=(words?' ':'')+phrase;
  // Store precisely the emitted phrases immediately, so an interruption preserves what was said.
  const entry=s.game.history.find(h=>h.role==='courier'&&h.turnId===turnId);
  if(entry)entry.text=words;else recordSpeech(s.game,phrase,turnId);
  if(speech)speech.sendPhrase(phrase);else relay(client,{type:'npc.caption',sessionId:s.game.id,turnId,text:phrase});
 });
 if(signal.aborted||s.turnId!==turnId)throw new DOMException('Cancelled','AbortError');
 s.dialogueLive=reply.live;
 realtime.send(s.game.id,{type:'dialogue.status',sessionId:s.game.id,turnId,live:reply.live,model:reply.model});
 if(speech)void speech.finish().finally(()=>{if(s.game.phase==='active')void prewarmSpeech(s.game.id)});
 return {reply,timings:{...reply.timings,dialogueTotalMs:performance.now()-started}};
}
function beginTurn(s:Session,turnId:string){s.controller?.abort();s.controller=new AbortController();s.turnId=turnId;return s.controller.signal;}
app.get('/api/health',(_req,res)=>res.json({ok:true,product:'Expatia World',speech:'eleven_v4_turbo',deployment:'portable-node',build:'2026-10-10-spanish-demo'}));
app.get('/api/weather',async(_req,res)=>res.json(await getWeather()));
app.post('/api/session',async(req,res)=>{const ip=req.ip??'unknown',now=Date.now(),limit=limits.get(ip);if(limit&&limit.reset>now&&limit.count>=20){res.status(429).json({error:'A few too many calls. Please take a short break.'});return;}limits.set(ip,{count:limit&&limit.reset>now?limit.count+1:1,reset:now+600000});if(sessions.size>150){res.status(503).json({error:'All couriers are busy. Please try again shortly.'});return;}const game=createGame(await getWeather());const s:Session={game,token:randomBytes(24).toString('base64url'),lastActivity:now,lastMove:now,turnTimes:[],arrival:0,timeoutRunning:false};sessions.set(game.id,s);void prewarmSpeech(game.id);res.json({game:state(s),token:s.token});});
app.get('/api/session/:id',(req,res)=>{const s=obtain(req,res);if(s)res.json({game:state(s)});});
app.post('/api/session/:id/answer',(req,res)=>{const s=obtain(req,res);if(!s)return;if(!answerCall(s.game)){res.json({game:state(s)});return;}const turnId=String(req.body.turnId??'opening').slice(0,80),signal=beginTurn(s,turnId);res.json({game:state(s)});void (async()=>{const decision=await decide(s.game,'',signal);if(signal.aborted||s.game.phase!=='active')return;await speak(s,decision,turnId,signal);})().catch(()=>{});});
app.post('/api/session/:id/turn',async(req,res)=>{const s=obtain(req,res);if(!s)return;if(s.game.phase!=='active'){res.status(409).json({error:'The call window has ended.',game:state(s)});return;}const text=String(req.body.text??'').trim().slice(0,500),turnId=String(req.body.turnId??randomBytes(8).toString('hex')).slice(0,80);if(!text){res.status(400).json({error:'Say or type a direction first.'});return;}const now=Date.now();s.turnTimes=s.turnTimes.filter(t=>now-t<60000);if(s.turnTimes.length>=24){res.status(429).json({error:'Give the courier a moment to listen.'});return;}s.turnTimes.push(now);const signal=beginTurn(s,turnId),started=performance.now();try{const decision=await decide(s.game,text,signal);if(signal.aborted||s.turnId!==turnId||decision?.discarded){res.status(409).json({error:'A newer turn replaced this one.',game:state(s)});return;}tickGame(s.game);if(s.game.phase!=='active'){res.json({game:state(s)});return;}const result=await speak(s,decision,turnId,signal);res.json({game:state(s),timings:{decisionMs:decision?.elapsedMs,...result.timings,totalMs:performance.now()-started}});}catch(e){if(signal.aborted){res.status(409).json({error:'The conversation moved on.',game:state(s)});return;}res.status(503).json({error:'The connection paused. Try a shorter direction.',game:state(s)});}});
app.post('/api/session/:id/move',(req,res)=>{const s=obtain(req,res);if(!s)return;const now=Date.now(),elapsed=Math.max(0,(now-s.lastMove)/1000);s.lastMove=now;moveResident(s.game,Number(req.body.dx),Number(req.body.dy),Math.min(Number(req.body.dt)||0,elapsed,.15));res.json({game:state(s)});});
app.post('/api/session/:id/handoff',(req,res)=>{const s=obtain(req,res);if(!s)return;if(!handoff(s.game)){res.status(409).json({error:'Guide the courier to your entrance before the deadline, then accept the parcel.',game:state(s)});return;}s.controller?.abort();closeSpeech(s.game.id);res.json({game:state(s)});});
app.post('/api/session/:id/end',(req,res)=>{const s=obtain(req,res);if(!s)return;s.controller?.abort();closeSpeech(s.game.id);sessions.delete(s.game.id);res.json({ok:true});});
setInterval(()=>{const now=Date.now();for(const [id,s] of sessions){tickGame(s.game,now);if(s.game.phase==='timeout'&&s.game.timeoutPending&&!s.timeoutRunning){s.timeoutRunning=true;const turnId='timeout-'+(++s.game.arrivalSequence),signal=beginTurn(s,turnId);realtime.send(id,{type:'npc.cancel',sessionId:id,turnId:s.turnId});void resolveTimeout(s.game,signal).then(d=>speak(s,d,turnId,signal)).catch(()=>{});}if(s.game.arrivalSequence!==s.arrival){s.arrival=s.game.arrivalSequence;if(s.game.phase==='active'&&s.game.routeTargetId==='home-south'&&!s.controller?.signal.aborted){const turnId='arrival-'+s.arrival,signal=beginTurn(s,turnId);void speak(s,{action:{type:'wait',id:'arrival',label:'Wait at the entrance for the resident to accept the parcel',reason:'Physical arrival occurred; parcel still with courier.'}},turnId,signal).catch(()=>{});}}if(now-s.lastActivity>600000){s.controller?.abort();closeSpeech(id);sessions.delete(id);}}for(const [ip,l] of limits)if(l.reset<now)limits.delete(ip);},50);
if(process.env.NODE_ENV==='production'){const base=existsSync(resolve('dist/client/index.html'))?'dist/client':'dist';app.use(express.static(resolve(base),{maxAge:'1h'}));app.get('/{*path}',(_req,res)=>res.sendFile(resolve(base,'index.html')));}else{const {createServer:createViteServer}=await import('vite');const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
const port=Number(process.env.PORT)||3317;server.listen(port,'0.0.0.0',()=>console.log(`Expatia World ready: http://localhost:${port}`));
