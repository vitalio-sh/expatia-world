#!/usr/bin/env python3
"""Authorized chroma video postproduction to fixed-baseline game sprite sheets."""
import argparse, hashlib, json, math, subprocess
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'art-work/source'
RUNTIME=ROOT/'public/art/characters'
PROOFS=ROOT/'docs/art/proofs'
DIRECTIONS=['south','west','north','east']

def despill(image, preserve_green=False):
    p=np.array(image).copy();alpha=p[:,:,3]
    # Remove green from partially keyed edge pixels only; preserve opaque costumes.
    edge=(alpha>0)&(alpha<245)
    ceiling=np.maximum(p[:,:,0],p[:,:,2]).astype(np.float32)*1.15
    p[:,:,1]=np.where(edge,np.minimum(p[:,:,1],ceiling),p[:,:,1]).astype(np.uint8)
    if not preserve_green:
        saturated=p[:,:,1].astype(np.int16)>np.maximum(p[:,:,0],p[:,:,2]).astype(np.int16)+16
        p[:,:,1]=np.where(saturated,np.maximum(p[:,:,0],p[:,:,2]),p[:,:,1])
    p[alpha<24]=0
    return Image.fromarray(p,'RGBA')

def process(name):
    source=SOURCE/f'{name}.mp4'
    if not source.exists():return dict(name=name,status='awaiting source')
    framesdir=SOURCE/f'{name}-keyed';framesdir.mkdir(exist_ok=True)
    filt='format=rgba,colorkey=0x00FF00:0.18:0.05,fps=12'
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-vf',filt,'-frames:v','48',str(framesdir/'%03d.png')],check=True)
    source_frames=[despill(Image.open(p).convert('RGBA'),name=='orange-tree') for p in sorted(framesdir.glob('*.png'))]
    if len(source_frames)!=48:raise RuntimeError(f'Expected48frames got{len(source_frames)}')
    for path,im in zip(sorted(framesdir.glob('*.png')),source_frames):im.save(path)
    is_tree=name=='orange-tree';fw,fh=(144,176) if is_tree else (128,160)
    output_dir=ROOT/'public/art/environment' if is_tree else RUNTIME
    output_dir.mkdir(exist_ok=True);PROOFS.mkdir(parents=True,exist_ok=True)
    assets={}
    w,h=source_frames[0].size
    for direction_index,direction in enumerate(['tree'] if is_tree else DIRECTIONS):
        left=0 if is_tree else direction_index*w//4;right=w if is_tree else (direction_index+1)*w//4
        cells=[im.crop((left,0,right,h)) for im in source_frames]
        boxes=[im.getchannel('A').point(lambda p:255 if p>48 else 0).getbbox() for im in cells]
        boxes=[b for b in boxes if b]
        if not boxes:raise RuntimeError('No opaque pixels: bad chroma processing')
        bbox=(min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes))
        scale=min((fw-20)/(bbox[2]-bbox[0]),(fh-20)/(bbox[3]-bbox[1]))
        output=[]
        for im in cells:
            c=im.crop(bbox);c=c.resize((round(c.width*scale),round(c.height*scale)),Image.Resampling.NEAREST)
            cell=Image.new('RGBA',(fw,fh));cell.alpha_composite(c,((fw-c.width)//2,fh-8-c.height));output.append(cell)
        source_start,source_end=0,48
        raw_seam=float(np.abs(np.array(output[0]).astype(np.int16)-np.array(output[-1]).astype(np.int16)).mean())
        # A generated loop can fail its promised end pose. Trim only existing motion
        # to the closest repeated stance; never synthesize gait from a standing image.
        if name.endswith('-walk') and raw_seam>2:
            arrays=[np.array(im).astype(np.int16) for im in output]
            choices=[(float(np.abs(arrays[i]-arrays[j]).mean()),i,j) for i in range(4,20) for j in range(i+12,min(i+33,48))]
            _,source_start,source_end=min(choices)
            source_end+=1
            output=output[source_start:source_end]
        nframes=len(output)
        basename=name if is_tree else f'{name.rsplit("-",1)[0]}-{direction}-{name.rsplit("-",1)[1]}'
        sheet=Image.new('RGBA',(12*fw,math.ceil(nframes/12)*fh))
        for i,im in enumerate(output):sheet.alpha_composite(im,((i%12)*fw,(i//12)*fh))
        archival=ROOT/'art-work/renders';archival.mkdir(parents=True,exist_ok=True)
        sheet.save(archival/f'{basename}-sheet.png',optimize=True)
        sheet.save(output_dir/f'{basename}-sheet.webp',quality=92,method=6)
        output[0].save(archival/f'{basename}.webp',save_all=True,append_images=output[1:],duration=([83,83,84]*16)[:nframes],loop=0,quality=88,method=3)
        proof=Image.new('RGB',(6*fw,2*(fh+22)),(39,52,55));draw=ImageDraw.Draw(proof)
        for n,i in enumerate([round(i*(nframes-1)/11) for i in range(12)]):
            x=(n%6)*fw;y=(n//6)*(fh+22);proof.paste(output[i],(x,y),output[i]);draw.text((x+4,y+fh+4),f'{direction} frame {i}',fill=(225,224,204))
        proof.save(PROOFS/f'{basename}.jpg',quality=93)
        # Exact end frame seam and frame0 difference; a nonzero value is normal for breathing.
        start=np.array(output[0]).astype(np.int16);end=np.array(output[-1]).astype(np.int16)
        meta=dict(src=f'/art/{"environment" if is_tree else "characters"}/{basename}-sheet.webp',frameWidth=fw,frameHeight=fh,columns=12,rows=math.ceil(nframes/12),frames=nframes,fps=12,durationMs=round(nframes/12*1000),sourceFrames=48,sourceRange=[source_start,source_end],rawSeamMeanDifference=raw_seam,anchorX=.5,anchorY=(fh-8)/fh,generated=True,provider='GMI Cloud Seedance 2.5',sourceVideo=f'art-work/source/{name}.mp4',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),cropBox=bbox,scale=scale,seamMeanDifference=float(np.abs(start-end).mean()),acceptance='visual review pending')
        (output_dir/f'{basename}-sheet.json').write_text(json.dumps(meta,indent=2)+'\n');assets[direction]=meta
    return dict(name=name,status='processed',assets=assets)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('names',nargs='*');args=parser.parse_args()
    for name in args.names or ['courier-idle','courier-walk','resident-idle','resident-walk','orange-tree']:
        print(json.dumps(process(name)),flush=True)
