import React,{useEffect,useRef,useState} from 'react';
import {WORLD_MAP,type Actor,type Point} from '../shared/world';
type Asset={src:string;frameWidth?:number;frameHeight?:number;frames?:number;fps?:number;columns?:number};
type Manifest={map?:string;characters?:Record<string,Record<string,{idle?:Asset|string;walk?:Asset|string}>>};
export function World({game,compact=false}:{game?:any;compact?:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null), latest=useRef(game), images=useRef(new Map<string,HTMLImageElement>()), [manifest,setManifest]=useState<Manifest>({map:'/art/barcelona-map.webp'});
 latest.current=game;
 useEffect(()=>{fetch('/art/manifest.json').then(r=>r.ok?r.json():null).then(m=>m&&setManifest(m)).catch(()=>{});},[]);
 useEffect(()=>{
  let frame=0;let live=true;
  const getImage=(src:string)=>{let im=images.current.get(src);if(!im){im=new Image();im.src=src;images.current.set(src,im);}return im;};
  function draw(time:number){
   const c=canvas.current;if(!c||!live)return;const ctx=c.getContext('2d')!;ctx.clearRect(0,0,960,960);ctx.imageSmoothingEnabled=false;
   const m=getImage(manifest.map||'/art/barcelona-map.webp');
   if(m.complete&&m.naturalWidth)ctx.drawImage(m,0,0,960,960);
   else {ctx.fillStyle='#ece0c4';ctx.fillRect(0,0,960,960);ctx.fillStyle='#737d78';ctx.fillRect(0,235,960,60);ctx.fillRect(0,730,960,60);ctx.fillStyle='#dcc5a4';ctx.beginPath();WORLD_MAP.home.footprint.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();}
   const g=latest.current;
   function label(text:string,p:Point,home=false){ctx.font=`${home?'600 24':'600 22'}px system-ui`;const w=ctx.measureText(text).width+22;ctx.fillStyle=home?'#fff3c5':'#fffaf0';ctx.strokeStyle='#474e40';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(p.x-w/2,p.y-30,w,34,6);ctx.fill();ctx.stroke();ctx.fillStyle='#293b2c';ctx.textAlign='center';ctx.fillText(text,p.x,p.y-6);}
   if(!compact){label('YOUR ENTRANCE',{x:480,y:679},true);ctx.fillStyle='#df8a40';ctx.beginPath();ctx.moveTo(471,637);ctx.lineTo(489,637);ctx.lineTo(480,653);ctx.fill();}
   function actor(name:string,a:Actor){
    const mode=a.moving?'walk':'idle';const d=manifest.characters?.[name]?.[a.direction]?.[mode];
    const asset:Asset=typeof d==='string'?{src:d}:d??{src:`/art/characters/${name}-${a.direction}-still.png`};
    const im=getImage(asset.src);ctx.fillStyle='rgba(44,41,30,.2)';ctx.beginPath();ctx.ellipse(a.x,a.y+1,14,6,0,0,Math.PI*2);ctx.fill();
    if(im.complete&&im.naturalWidth){let fw=asset.frameWidth??im.naturalWidth,fh=asset.frameHeight??im.naturalHeight;let idx=asset.frames?Math.floor(time/1000*(asset.fps??12))%asset.frames:0;let columns=asset.columns??Math.max(1,Math.floor(im.naturalWidth/fw));let h=58,w=h*fw/fh;ctx.drawImage(im,(idx%columns)*fw,Math.floor(idx/columns)*fh,fw,fh,a.x-w/2,a.y-h,w,h);}
    else {ctx.fillStyle=name==='courier'?'#d97846':'#726cba';ctx.fillRect(a.x-10,a.y-30,20,28);ctx.fillStyle='#eac298';ctx.fillRect(a.x-8,a.y-44,16,16);}
    if(!compact)label(name==='courier'?'COURIER':'YOU',{x:a.x,y:a.y-61},name!=='courier');
   }
   if(g){actor('courier',g.courier);actor('resident',g.resident);if(g.parcel==='drop'){ctx.font='30px system-ui';ctx.fillText('📦',g.courier.x,g.courier.y);}}
   else {actor('courier',{x:210,y:250,direction:'south',moving:false});actor('resident',{x:480,y:565,direction:'south',moving:false});}
   // Quiet live scene detail: birds drift over the rooftops; parcel beacon breathes.
   if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!compact){ctx.strokeStyle='#455957';ctx.lineWidth=2;let x=760+(time/80)%170,y=290+Math.sin(time/1100)*7;ctx.beginPath();ctx.moveTo(x-7,y-3);ctx.quadraticCurveTo(x-3,y-7,x,y);ctx.quadraticCurveTo(x+3,y-7,x+7,y-3);ctx.stroke();}
   frame=requestAnimationFrame(draw);
  }
  frame=requestAnimationFrame(draw);return()=>{live=false;cancelAnimationFrame(frame);};
 },[manifest,compact]);
 return <div className={`world ${compact?'compact':''}`}><canvas ref={canvas} width={960} height={960} aria-label="Barcelona block: your home is in the centre, its entrance is south. The courier begins northwest. Two bars are along the north street."/><div className="map-compass"><b>N</b><span>↑</span></div>{!compact&&<div className="map-caption">Eixample · Barcelona <span>Tap the arrows to move</span></div>}</div>;
}
