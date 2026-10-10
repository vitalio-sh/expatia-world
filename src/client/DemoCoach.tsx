import React,{useState,useEffect} from 'react';
import {chooseDemoCue,demoConversationRevision,type DemoGame} from '../shared/demo-coach';

const steps = ['Find the courier','Check their view','Guide them home'];

/** Presenter prompts never send a turn or move the courier by themselves. */
export function DemoCoach({game,onUse,recovery=''}:{game:DemoGame;onUse:(phrase:string)=>void;recovery?:string}){
 const [manual,setManual]=useState<number|null>(null),[lifeline,setLifeline]=useState(false);
 const revision=demoConversationRevision(game);
 useEffect(()=>{setManual(null);setLifeline(false)},[revision]);
 const guided=!!game.demoMode,guidedStep=Math.max(0,Math.min(3,Math.floor(game.demoStep??0)))+1;
 const cue=chooseDemoCue(game,{manual,lifeline,recovery}),step=manual??cue.stage,atDoor=game?.canHandoff,moving=!!game.courier?.moving;
 return <aside className="demo-coach" aria-label="Demo teleprompter">
  <div className="demo-coach-heading"><b>{guided?`Guided demo · Step ${guidedStep} of 4`:'READ ALOUD · SPANISH'}</b><span>{cue.title}</span></div>
  <p className="demo-spanish" lang="es">{cue.spanish}</p><p className="demo-translation">{cue.english}</p>
  <div className="demo-coach-controls">{!guided&&<><div className="demo-steps" aria-label="Demo script steps">{steps.map((title,i)=><button key={title} aria-label={`Step ${i+1}: ${title}`} aria-pressed={!lifeline&&step===i} onClick={()=>{setManual(i);setLifeline(false)}}>{i+1}</button>)}</div><button className="demo-lifeline" aria-pressed={lifeline} onClick={()=>setLifeline(!lifeline)}>Speak slower</button></>}{guided&&<span className="demo-guided-status" role="status">{moving?'Wait for the courier to stop.':atDoor?'Collect your parcel below.':'Read this phrase, then wait.'}</span>}<button className="demo-use" disabled={game?.phase!=='active'||atDoor||(guided&&(moving||(game.demoStep??0)>=4))} onClick={()=>onUse(cue.spanish)}>Use text</button></div>
 </aside>;
}
