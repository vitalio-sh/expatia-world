#!/usr/bin/env python3
"""Reproducible chromakey processing of the single generated idle pilot.
Only video-frame postprocessing authorized by the user; no imagegen replacement.
"""
from pathlib import Path
import subprocess,json
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]; out=ROOT/'public/art/meridian'; frames=out/'idle-frames'; frames.mkdir(exist_ok=True)
source=out/'pip-idle-source.mp4'
if not source.exists():raise SystemExit('Resume the recorded GMI job first; no source video yet.')
filt='format=rgba,colorkey=0x00FF00:0.22:0.08,scale=128:144:force_original_aspect_ratio=decrease,pad=128:144:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=12'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-vf',filt,'-frames:v','48',str(frames/'%03d.png')],check=True)
images=[Image.open(p).convert('RGBA') for p in sorted(frames.glob('*.png'))]
if len(images)!=48:raise SystemExit(f'Expected 48 frames, got {len(images)}')
images[0].save(out/'pip-idle.webp',save_all=True,append_images=images[1:],duration=[83,83,84]*16,loop=0,quality=88,method=6)
sheet=Image.new('RGBA',(12*128,4*144))
for i,im in enumerate(images):sheet.paste(im,((i%12)*128,(i//12)*144))
sheet.save(out/'pip-idle-sheet.png')
# Contact sheet with matte checker for alpha/edge inspection.
proof=Image.new('RGB',(6*192,2*224),(204,199,179))
for n,i in enumerate([0,4,8,12,16,20,24,28,32,36,40,47]):
 im=images[i].resize((192,216));proof.paste(im,((n%6)*192,(n//6)*224),im)
proof.save(out/'pip-idle-proof.jpg',quality=91)
(out/'pip-idle-sheet.json').write_text(json.dumps(dict(frameWidth=128,frameHeight=144,columns=12,rows=4,frames=48,fps=12,durationMs=4000,loop=True,source='pip-idle-source.mp4',alpha='colorkey 00ff00 similarity .22 blend .08',acceptance='needs visual seam and silhouette review'),indent=2)+'\n')
print('Processed 48 frames, 4 second WebP loop, sheet, contact proof; visual acceptance still required.')
