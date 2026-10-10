import React,{useEffect,useRef,useState} from 'react';
import {WORLD_MAP,RESIDENT_POSITION,SIGHT_RANGE,VIEW_ANGLE_DEGREES,insidePolygon,type Actor,type Point} from '../shared/world';
type Asset={src:string;frameWidth?:number;frameHeight?:number;frames?:number;fps?:number;columns?:number;anchorY?:number};
type Manifest={environment?:Array<any>;props?:Record<string,Asset>;map?:string;characters?:Record<string,Record<string,{idle?:Asset|string;walk?:Asset|string}>>};
export function World({game,compact=false}:{game?:any;compact?:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),latest=useRef(game),images=useRef(new Map<string,HTMLImageElement>()),[manifest,setManifest]=useState<Manifest>({map:'/art/barcelona-map.webp'}),[guide,setGuide]=useState(true);
 latest.current=game;
 useEffect(()=>{fetch('/art/manifest.json').then(r=>r.ok?r.json():null).then(m=>m&&setManifest(m)).catch(()=>{});},[]);
 useEffect(()=>{
  let frame=0,live=true,coneKey='',cone:Point[]=[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const getImage=(src:string)=>{let im=images.current.get(src);if(!im){im=new Image();im.src=src.startsWith('/art/')?'/api'+src:src;images.current.set(src,im);}return im;};
  function draw(time:number){
   const c=canvas.current;if(!c||!live)return;const ctx=c.getContext('2d')!;ctx.clearRect(0,0,960,960);ctx.imageSmoothingEnabled=false;
   const image=getImage(manifest.map||'/art/barcelona-map.webp');
   const polygon=(points:readonly Point[])=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();};
   if(image.complete&&image.naturalWidth)ctx.drawImage(image,0,0,960,960);
   else{ctx.fillStyle='#ece0c4';ctx.fillRect(0,0,960,960);ctx.fillStyle='#737d78';for(const road of WORLD_MAP.roads){polygon(road.footprint);ctx.fill();}ctx.fillStyle='#dcc5a4';polygon(WORLD_MAP.home.footprint);ctx.fill();}
   const g=latest.current;
   if(!compact&&guide){
    // Match shared walkable street/crossing geometry rather than painting new routes.
    for(const road of WORLD_MAP.roads){polygon(road.footprint);ctx.fillStyle=road.type==='road'?'rgba(48,65,59,.20)':'rgba(240,238,213,.08)';ctx.fill();}
    for(const crossing of WORLD_MAP.crossings){const {x,y}=crossing.point;ctx.fillStyle='rgba(255,253,235,.93)';for(let i=0;i<6;i++)ctx.fillRect(x-27,y-25+i*9,54,5);}
    if(g?.courier){
     const a=g.courier,key=`${Math.round(a.x/6)}:${Math.round(a.y/6)}:${a.direction}`;
     if(key!==coneKey){coneKey=key;cone=[];const heading={north:-Math.PI/2,east:0,south:Math.PI/2,west:Math.PI}[a.direction as Actor['direction']];
      for(let ray=0;ray<=36;ray++){const angle=heading-VIEW_ANGLE_DEGREES*Math.PI/360+ray/36*VIEW_ANGLE_DEGREES*Math.PI/180;let point={x:a.x,y:a.y};for(let d=6;d<=SIGHT_RANGE;d+=6){const next={x:a.x+Math.cos(angle)*d,y:a.y+Math.sin(angle)*d};if(insidePolygon(next,WORLD_MAP.home.footprint)||WORLD_MAP.buildings.some(b=>insidePolygon(next,b.footprint)))break;point=next;}cone.push(point);}
     }
     // A projector needs a saturated field and a boundary that survives washed-out colours.
     ctx.save();polygon([a,...cone]);ctx.fillStyle='rgba(0,91,255,.43)';ctx.fill();ctx.lineJoin='round';
     ctx.strokeStyle='#07327f';ctx.lineWidth=15;ctx.stroke();
     ctx.strokeStyle='#00ddff';ctx.lineWidth=9;ctx.stroke();
     ctx.strokeStyle='#edffff';ctx.lineWidth=2.5;ctx.stroke();ctx.restore();
    }
   }
   for(const env of manifest.environment??[]){const asset=env.asset??env.animation??env;if(!asset.src)continue;const im=getImage(asset.src);if(!im.complete||!im.naturalWidth)continue;const fw=asset.frameWidth??im.naturalWidth,fh=asset.frameHeight??im.naturalHeight,cols=asset.columns??Math.floor(im.naturalWidth/fw),idx=reduced?0:Math.floor(time/1000*(asset.fps??12))%(asset.frames??1),w=env.width??82,h=env.height??100;ctx.drawImage(im,(idx%cols)*fw,Math.floor(idx/cols)*fh,fw,fh,(env.x??100)-w/2,(env.y??785)-h*(asset.anchorY??.95),w,h);}
   function label(text:string,p:Point,kind:'shop'|'home'|'courier'|'street'='shop'){
    const street=kind==='street';ctx.font=`${street?'600 27':'700 31'}px system-ui`;const w=ctx.measureText(text).width+24;ctx.fillStyle=kind==='courier'?'#b66a39':kind==='home'?'#294c36':street?'rgba(255,251,233,.82)':'#fffaf0';ctx.strokeStyle=kind==='courier'?'#fff5dd':'rgba(65,75,48,.6)';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(p.x-w/2,p.y-34,w,42,8);ctx.fill();ctx.stroke();ctx.fillStyle=kind==='courier'||kind==='home'?'#fff9e8':'#293b2c';ctx.textAlign='center';ctx.fillText(text,p.x,p.y-5);
   }
   if(!compact){
    const names:Record<string,string>={'bar-llevant':'BAR LLEVANT','bar-ponent':'BAR PONENT',mercat:'MERCAT',fruita:'FRUITA',forn:'FORN',perruqueria:'PERRUQUERIA'};
    for(const b of WORLD_MAP.buildings)label(names[b.id]??b.name.toUpperCase(),b.sign);
    label('SOUTH ENTRANCE',{x:WORLD_MAP.home.entrance.x,y:WORLD_MAP.home.entrance.y-20},'home');
    ctx.fillStyle='#fff8db';ctx.strokeStyle='#bb783c';ctx.lineWidth=4;ctx.beginPath();ctx.arc(WORLD_MAP.home.entrance.x,WORLD_MAP.home.entrance.y,10,0,Math.PI*2);ctx.fill();ctx.stroke();
    if(guide){if(!g?.courier||Math.hypot(g.courier.x-570,g.courier.y-208)>170)label('NORTH STREET',{x:570,y:208},'street');if(!g?.courier||Math.hypot(g.courier.x-630,g.courier.y-707)>170)label('SOUTH STREET',{x:630,y:707},'street');}
   }
   function actor(name:'courier'|'resident',a:Actor){
    const mode=name==='resident'?'idle':a.moving?'walk':'idle',d=manifest.characters?.[name]?.[a.direction]?.[mode],asset:Asset=typeof d==='string'?{src:d}:d??{src:`/art/characters/${name}-${a.direction}-still.png`};
    const im=getImage(asset.src);ctx.fillStyle='rgba(44,41,30,.2)';ctx.beginPath();ctx.ellipse(a.x,a.y+1,15,6,0,0,Math.PI*2);ctx.fill();
    if(name==='courier'&&!compact){ctx.strokeStyle='#fcf8e8';ctx.lineWidth=4;ctx.fillStyle='#d78346';ctx.beginPath();ctx.arc(a.x,a.y+4,11,0,Math.PI*2);ctx.fill();ctx.stroke();}
    if(im.complete&&im.naturalWidth){const fw=asset.frameWidth??im.naturalWidth,fh=asset.frameHeight??im.naturalHeight,idx=!reduced&&asset.frames?Math.floor(time/1000*(asset.fps??12))%asset.frames:0,cols=asset.columns??Math.max(1,Math.floor(im.naturalWidth/fw)),h=compact?58:70,w=h*fw/fh;ctx.drawImage(im,(idx%cols)*fw,Math.floor(idx/cols)*fh,fw,fh,a.x-w/2,a.y-h*(asset.anchorY??.95),w,h);}
    else{ctx.fillStyle=name==='courier'?'#d97846':'#46796d';ctx.fillRect(a.x-10,a.y-30,20,28);ctx.fillStyle='#eac298';ctx.fillRect(a.x-8,a.y-44,16,16);}
    if(!compact)label(name==='courier'?'COURIER':'YOUR APARTMENT',{x:a.x,y:name==='courier'?a.y+47:a.y-76},name==='courier'?'courier':'home');
   }
   if(g){actor('courier',g.courier);actor('resident',g.resident);const im=getImage(manifest.props?.parcel?.src??'/art/parcel.png');if(im.complete&&im.naturalWidth&&g.parcel!=='returned'){const p=g.parcel==='resident'?g.resident:g.courier;ctx.drawImage(im,p.x+8,p.y-22,18,20);}}
   else{actor('courier',{x:210,y:250,direction:'north',moving:false});actor('resident',{...RESIDENT_POSITION,direction:'south',moving:false});}
   frame=requestAnimationFrame(draw);
  }
  frame=requestAnimationFrame(draw);return()=>{live=false;cancelAnimationFrame(frame);};
 },[manifest,compact,guide]);
 return <div className={`world ${compact?'compact':''}`}><canvas ref={canvas} width={960} height={960} aria-label="Barcelona delivery map. You remain in your central apartment. Guide the courier to your entrance on the south side. North and south streets have four zebra crossings. Two bars are on the north street."/>{!compact&&<><div className="map-compass" aria-label="Compass: north up, east right, south down, west left"><b className="north">N</b><b className="east">E</b><span>✦</span><b className="south">S</b><b className="west">W</b></div><button className="map-guide" aria-pressed={guide} onClick={()=>setGuide(!guide)}>{guide?'Street guide on':'Street guide off'}</button><span className="map-view-label">{game?.courier?`Looking ${game.courier.direction}`:'Eixample · Barcelona'}</span></>}</div>;
}
