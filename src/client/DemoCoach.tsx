import React,{useState,useEffect} from 'react';
import {deliveryPhrasebook} from '../shared/phrasebook';

const cues = [
 {title:'Find the courier',spanish:'Hola, buenas. ¿Cómo se llama el bar?',english:'Hello! What is the bar called?'},
 {title:'Show what they can see',spanish:'Mira hacia el sur. ¿Ves la frutería?',english:'Look south. Can you see the fruit shop?'},
 {title:'Guide them home',spanish:'Rodea el edificio y ven a mi portal, en el lado sur.',english:'Go around the building to my entrance on the south side.'},
 {title:'While they walk',spanish:'Vale, te espero en la entrada.',english:'OK, I’ll wait for you at the entrance.'},
];

/** Presenter prompts never send a turn or move the courier by themselves. */
export function DemoCoach({game,onUse}:{game:any;onUse:(phrase:string)=>void}){
 const [manual,setManual]=useState<number|null>(null),[lifeline,setLifeline]=useState(false);
 useEffect(()=>{setManual(null);setLifeline(false)},[game?.id,game?.decision?.sequence??game?.inspector?.sequence]);
 const selected=game?.decision?.selected??game?.inspector?.selected;
 const suggested=String(selected).startsWith('home:')?3:String(selected).startsWith('look:')?2:String(selected).startsWith('reveal:')?1:0;
 const step=manual??suggested,atDoor=game?.canHandoff,done=game?.outcome;
 const cue=lifeline?{title:'Take a breath',spanish:deliveryPhrasebook.coach.clarify.spanish,english:deliveryPhrasebook.coach.clarify.translation}:atDoor||done?{title:atDoor?'At your door':'A little win',spanish:'Perfecto, gracias. ¡Hasta luego!',english:atDoor?'Click Receive parcel to finish the delivery.':'Perfect, thank you. See you!'}:cues[step];
 return <aside className="demo-coach" aria-label="Demo teleprompter">
  <div className="demo-coach-heading"><b>READ ALOUD · SPANISH</b><span>{cue.title}</span></div>
  <p className="demo-spanish" lang="es">{cue.spanish}</p><p className="demo-translation">{cue.english}</p>
  <div className="demo-coach-controls"><div className="demo-steps" aria-label="Demo script steps">{cues.slice(0,3).map((c,i)=><button key={c.title} aria-label={`Step ${i+1}: ${c.title}`} aria-pressed={!lifeline&&step===i} onClick={()=>{setManual(i);setLifeline(false)}}>{i+1}</button>)}</div><button className="demo-lifeline" aria-pressed={lifeline} onClick={()=>setLifeline(!lifeline)}>Speak slower</button><button className="demo-use" disabled={game?.phase!=='active'||atDoor} onClick={()=>onUse(cue.spanish)}>Use text</button></div>
 </aside>;
}
