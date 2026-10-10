import React,{useState,useEffect} from 'react';
import {chooseDemoCue,demoConversationRevision,type DemoGame} from '../shared/demo-coach';

const steps = ['Find the courier','Check their view','Guide them home'];

/** Presenter prompts never send a turn or move the courier by themselves. */
export function DemoCoach({game,onUse,recovery=''}:{game:DemoGame;onUse:(phrase:string)=>void;recovery?:string}){
 const [manual,setManual]=useState<number|null>(null),[lifeline,setLifeline]=useState(false);
 const revision=demoConversationRevision(game);
 useEffect(()=>{setManual(null);setLifeline(false)},[revision]);
 const cue=chooseDemoCue(game,{manual,lifeline,recovery}),step=manual??cue.stage,atDoor=game?.canHandoff;
 return <aside className="demo-coach" aria-label="Demo teleprompter">
  <div className="demo-coach-heading"><b>READ ALOUD · SPANISH</b><span>{cue.title}</span></div>
  <p className="demo-spanish" lang="es">{cue.spanish}</p><p className="demo-translation">{cue.english}</p>
  <div className="demo-coach-controls"><div className="demo-steps" aria-label="Demo script steps">{steps.map((title,i)=><button key={title} aria-label={`Step ${i+1}: ${title}`} aria-pressed={!lifeline&&step===i} onClick={()=>{setManual(i);setLifeline(false)}}>{i+1}</button>)}</div><button className="demo-lifeline" aria-pressed={lifeline} onClick={()=>setLifeline(!lifeline)}>Speak slower</button><button className="demo-use" disabled={game?.phase!=='active'||atDoor} onClick={()=>onUse(cue.spanish)}>Use text</button></div>
 </aside>;
}
